//! Reuse of models already present in an Ollama the user installed themselves.
//!
//! A machine that already holds a catalogue model should not download it again
//! — that is several gigabytes and, on a metered or slow connection, the
//! difference between a usable install and an abandoned one. On Linux, where
//! the component manifest ships no runtime artifact at all, an existing
//! installation may be the only route to Private AI.
//!
//! The reuse rule is deliberately narrower than "does this model work":
//!
//!   * **Catalogue membership is not optional.** The product tells the user
//!     that models "come from a signed LexEdge catalogue that has passed legal
//!     benchmark review". Reusing whatever happens to be on the machine would
//!     make that false, and would route legal work through a model no one
//!     reviewed. A technically capable model that is not in the catalogue is
//!     rejected, and says so.
//!
//!   * **Identity is the digest, not the tag.** Tags are mutable: `llama3.1:8b`
//!     and `llama3.1:latest` can point at the same blob today and different
//!     ones tomorrow, and a `latest` on the user's machine was resolved at
//!     whatever time they happened to pull it. Where the catalogue pins a
//!     digest, only the digest decides. `ensure_immutable_tag` already enforces
//!     this for pulls; reuse must not be the hole in that policy.
//!
//!   * **Unknown never becomes a pass.** Older runtimes omit `capabilities`
//!     entirely. That is not evidence of tool support, so it is rejected with a
//!     reason the user can act on rather than assumed either way.
//!
//! Hardware fit is deliberately *not* decided here. Being on disk says nothing
//! about whether this machine can run it — a 20 GB catalogue model already
//! present on a 16 GB laptop is still a bad recommendation. This module reports
//! which catalogue profiles are already satisfied on disk; the existing
//! recommendation engine then scores those profiles against the machine exactly
//! as it scores any other.

use serde::Serialize;

use crate::ollama_api::{ensure_immutable_tag, ModelDetail};
use crate::private_ai::LegalModelProfile;

/// One model observed in the detected runtime, after interrogation.
#[derive(Debug, Clone, PartialEq)]
pub struct InstalledCandidate {
    pub tag: String,
    pub digest: String,
    pub size_bytes: u64,
    /// `None` when `/api/show` could not describe this model. Expected in
    /// normal operation — cloud-hosted entries answer 410, and a model deleted
    /// mid-scan answers 404 — so it is a per-model outcome, never a failed scan.
    pub detail: Option<ModelDetail>,
}

/// Why a given installed model can or cannot stand in for a catalogue profile.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReuseCandidate {
    pub tag: String,
    /// Set only when this model satisfies a catalogue profile outright.
    pub profile_id: Option<String>,
    pub friendly_name: Option<String>,
    pub reusable: bool,
    pub size_bytes: u64,
    /// Plain-language grounds for the verdict, shown to the user. Populated for
    /// both outcomes: a rejection the user cannot understand reads as a bug.
    pub reasons: Vec<String>,
}

/// Decide, for every installed model, whether it can serve a catalogue profile.
///
/// Pure: every branch here is reachable in tests without a live runtime.
pub fn evaluate_reuse(
    installed: &[InstalledCandidate],
    profiles: &[LegalModelProfile],
    minimum_context_tokens: u64,
) -> Vec<ReuseCandidate> {
    installed
        .iter()
        .map(|candidate| evaluate_one(candidate, profiles, minimum_context_tokens))
        .collect()
}

fn evaluate_one(
    candidate: &InstalledCandidate,
    profiles: &[LegalModelProfile],
    minimum_context_tokens: u64,
) -> ReuseCandidate {
    let reject = |reasons: Vec<String>| ReuseCandidate {
        tag: candidate.tag.clone(),
        profile_id: None,
        friendly_name: None,
        reusable: false,
        size_bytes: candidate.size_bytes,
        reasons,
    };

    // 1. Catalogue membership, by digest wherever the catalogue pins one.
    let Some(profile) = match_profile(candidate, profiles) else {
        return reject(vec![
            "Not part of the approved LexEdge legal catalogue".to_string()
        ]);
    };

    // 2. The runtime must have been able to describe it at all.
    let Some(detail) = candidate.detail.as_ref() else {
        return reject(vec![format!(
            "{} could not be described by the runtime",
            candidate.tag
        )]);
    };

    let mut reasons = Vec::new();

    // 3. The two independent gates.
    if !detail.capabilities_known {
        return reject(vec![
            "This runtime is too old to report model capabilities — upgrade Ollama to reuse it"
                .to_string(),
        ]);
    }
    if !detail.supports_tools {
        return reject(vec![format!(
            "{} does not support tools, which every chat turn requires",
            candidate.tag
        )]);
    }
    match detail.context_length {
        None => {
            return reject(vec![
                "The runtime did not report a context window for this model".to_string(),
            ])
        }
        Some(context) if context < minimum_context_tokens => {
            return reject(vec![format!(
                "Context window {context} is below the {minimum_context_tokens} Hermes requires"
            )])
        }
        Some(context) => reasons.push(format!("Context window {context}")),
    }

    // 4. Size sanity, when the catalogue states one. A wide drift means this is
    //    not the artifact the catalogue describes, even under a matching tag.
    if let Some(expected) = profile.expected_size_bytes {
        if !size_within_tolerance(candidate.size_bytes, expected) {
            return reject(vec![format!(
                "Installed size does not match the catalogue entry for {}",
                profile.friendly_name
            )]);
        }
    }

    reasons.push("Already installed — no download needed".to_string());
    ReuseCandidate {
        tag: candidate.tag.clone(),
        profile_id: Some(profile.id.clone()),
        friendly_name: Some(profile.friendly_name.clone()),
        reusable: true,
        size_bytes: candidate.size_bytes,
        reasons,
    }
}

/// Find the catalogue profile this installed model actually is.
///
/// Digest first and, where the catalogue pins one, digest *only*: a matching
/// tag with a different digest is a different artifact and must not pass. Tag
/// matching is the fallback for catalogues predating digest pinning, and is
/// accepted only for immutable tags — a `latest` proves nothing about content.
fn match_profile<'a>(
    candidate: &InstalledCandidate,
    profiles: &'a [LegalModelProfile],
) -> Option<&'a LegalModelProfile> {
    let selectable = |p: &&LegalModelProfile| p.enabled && !p.retired && p.legal_benchmark.approved;

    if !candidate.digest.trim().is_empty() {
        if let Some(found) = profiles.iter().filter(selectable).find(|p| {
            p.expected_digest
                .as_deref()
                .is_some_and(|d| digests_equal(d, &candidate.digest))
        }) {
            return Some(found);
        }
    }

    profiles.iter().filter(selectable).find(|p| {
        p.expected_digest.is_none()
            && p.ollama_model == candidate.tag
            && ensure_immutable_tag(&candidate.tag).is_ok()
    })
}

/// Registry digests are case-insensitive hex and are written both bare and
/// `sha256:`-prefixed depending on the surface that emitted them.
fn digests_equal(left: &str, right: &str) -> bool {
    fn normalize(value: &str) -> String {
        value
            .trim()
            .trim_start_matches("sha256:")
            .to_ascii_lowercase()
    }
    let (left, right) = (normalize(left), normalize(right));
    !left.is_empty() && left == right
}

/// Installed size drifts slightly across Ollama releases; a wider gap means a
/// different artifact.
fn size_within_tolerance(observed: u64, expected: u64) -> bool {
    if expected == 0 {
        return true;
    }
    let tolerance = (expected as f64 * 0.05).max(1.0);
    (observed as f64 - expected as f64).abs() <= tolerance
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::private_ai::LegalBenchmark;

    fn profile(id: &str, tag: &str) -> LegalModelProfile {
        LegalModelProfile {
            id: id.to_string(),
            friendly_name: format!("{id} (legal)"),
            ollama_model: tag.to_string(),
            llmfit_aliases: vec![],
            enabled: true,
            retired: false,
            minimum_ram_gb: 8.0,
            recommended_ram_gb: 16.0,
            minimum_vram_gb: 0.0,
            requires_gpu: false,
            required_backend: None,
            download_size_gb: 4.9,
            operational_context_tokens: 131072,
            target_tps: 10.0,
            legal_benchmark: LegalBenchmark {
                approved: true,
                score: 0.9,
                version: "v1".to_string(),
            },
            expected_digest: None,
            expected_size_bytes: None,
        }
    }

    fn detail(context: Option<u64>, tools: bool, known: bool) -> Option<ModelDetail> {
        Some(ModelDetail {
            context_length: context,
            supports_tools: tools,
            capabilities_known: known,
        })
    }

    fn candidate(tag: &str, digest: &str, detail: Option<ModelDetail>) -> InstalledCandidate {
        InstalledCandidate {
            tag: tag.to_string(),
            digest: digest.to_string(),
            size_bytes: 4_900_000_000,
            detail,
        }
    }

    // --- catalogue membership ----------------------------------------------

    #[test]
    fn a_capable_model_outside_the_catalogue_is_refused() {
        // The whole point of the signed catalogue. qwen3-coder clears both
        // technical gates comfortably and is still not a legally reviewed
        // model, so it must not be offered for legal work.
        let out = evaluate_reuse(
            &[candidate("qwen3-coder:latest", "abc", detail(Some(262144), true, true))],
            &[profile("legal-compact", "llama3.1:8b")],
            64_000,
        );
        assert!(!out[0].reusable);
        assert!(out[0].reasons[0].contains("approved LexEdge legal catalogue"));
    }

    #[test]
    fn a_retired_or_unapproved_profile_never_matches() {
        let mut retired = profile("legal-compact", "llama3.1:8b");
        retired.retired = true;
        let out = evaluate_reuse(
            &[candidate("llama3.1:8b", "abc", detail(Some(131072), true, true))],
            &[retired],
            64_000,
        );
        assert!(!out[0].reusable);

        let mut unapproved = profile("legal-compact", "llama3.1:8b");
        unapproved.legal_benchmark.approved = false;
        let out = evaluate_reuse(
            &[candidate("llama3.1:8b", "abc", detail(Some(131072), true, true))],
            &[unapproved],
            64_000,
        );
        assert!(!out[0].reusable);
    }

    // --- identity is the digest --------------------------------------------

    #[test]
    fn a_mutable_latest_tag_cannot_satisfy_a_profile_by_name() {
        // llama3.1:latest is not llama3.1:8b, even when today they happen to be
        // the same blob. Reuse must not become the hole in the tag policy that
        // ensure_immutable_tag closes for pulls.
        let out = evaluate_reuse(
            &[candidate("llama3.1:latest", "", detail(Some(131072), true, true))],
            &[profile("legal-compact", "llama3.1:latest")],
            64_000,
        );
        assert!(!out[0].reusable);
    }

    #[test]
    fn digest_match_wins_even_when_the_tag_differs() {
        let mut pinned = profile("legal-compact", "llama3.1:8b");
        pinned.expected_digest = Some("sha256:DEADBEEF".to_string());
        let out = evaluate_reuse(
            &[candidate("some-other-tag:v2", "deadbeef", detail(Some(131072), true, true))],
            &[pinned],
            64_000,
        );
        assert!(out[0].reusable);
        assert_eq!(out[0].profile_id.as_deref(), Some("legal-compact"));
    }

    #[test]
    fn matching_tag_with_the_wrong_digest_is_refused() {
        // Fail closed: the catalogue pinned a digest, so anything else under
        // that tag is a different artifact.
        let mut pinned = profile("legal-compact", "llama3.1:8b");
        pinned.expected_digest = Some("sha256:aaaa".to_string());
        let out = evaluate_reuse(
            &[candidate("llama3.1:8b", "bbbb", detail(Some(131072), true, true))],
            &[pinned],
            64_000,
        );
        assert!(!out[0].reusable);
    }

    #[test]
    fn immutable_tag_matches_when_the_catalogue_pins_no_digest() {
        let out = evaluate_reuse(
            &[candidate("llama3.1:8b", "abc", detail(Some(131072), true, true))],
            &[profile("legal-compact", "llama3.1:8b")],
            64_000,
        );
        assert!(out[0].reusable);
        assert!(out[0].reasons.iter().any(|r| r.contains("no download")));
    }

    // --- the two independent gates -----------------------------------------

    #[test]
    fn tools_and_context_are_checked_independently() {
        let profiles = [profile("legal-compact", "llama3.1:8b")];

        // functiongemma's shape: tools present, context under the floor.
        let out = evaluate_reuse(
            &[candidate("llama3.1:8b", "abc", detail(Some(32_768), true, true))],
            &profiles,
            64_000,
        );
        assert!(!out[0].reusable);
        assert!(out[0].reasons[0].contains("below the 64000"));

        // phi3.5's shape: ample context, no tools.
        let out = evaluate_reuse(
            &[candidate("llama3.1:8b", "abc", detail(Some(131_072), false, true))],
            &profiles,
            64_000,
        );
        assert!(!out[0].reusable);
        assert!(out[0].reasons[0].contains("does not support tools"));
    }

    #[test]
    fn an_old_runtime_that_reports_no_capabilities_is_not_assumed_capable() {
        let out = evaluate_reuse(
            &[candidate("llama3.1:8b", "abc", detail(Some(131_072), false, false))],
            &[profile("legal-compact", "llama3.1:8b")],
            64_000,
        );
        assert!(!out[0].reusable);
        assert!(out[0].reasons[0].contains("too old"));
    }

    #[test]
    fn a_missing_context_window_is_refused_rather_than_guessed() {
        let out = evaluate_reuse(
            &[candidate("llama3.1:8b", "abc", detail(None, true, true))],
            &[profile("legal-compact", "llama3.1:8b")],
            64_000,
        );
        assert!(!out[0].reusable);
    }

    // --- per-model probe failures ------------------------------------------

    #[test]
    fn a_model_the_runtime_could_not_describe_is_skipped_not_fatal() {
        // The `:cloud` entry that answers 410 Gone, and the model deleted
        // between /api/tags and /api/show. One bad entry must not stop the scan
        // or disqualify the models around it.
        let out = evaluate_reuse(
            &[
                candidate("kimi-k2.5:cloud", "", None),
                candidate("llama3.1:8b", "abc", detail(Some(131_072), true, true)),
            ],
            &[profile("legal-compact", "llama3.1:8b")],
            64_000,
        );
        assert_eq!(out.len(), 2);
        assert!(!out[0].reusable);
        assert!(out[1].reusable, "a later model must still be evaluated");
    }

    #[test]
    fn an_empty_runtime_yields_no_candidates_and_no_error() {
        assert!(evaluate_reuse(&[], &[profile("a", "b:1")], 64_000).is_empty());
    }

    // --- size sanity --------------------------------------------------------

    #[test]
    fn a_size_far_from_the_catalogue_entry_is_refused() {
        let mut sized = profile("legal-compact", "llama3.1:8b");
        sized.expected_size_bytes = Some(4_900_000_000);
        let mut wrong = candidate("llama3.1:8b", "abc", detail(Some(131_072), true, true));
        wrong.size_bytes = 1_000_000_000;
        let out = evaluate_reuse(&[wrong], &[sized], 64_000);
        assert!(!out[0].reusable);
    }

    #[test]
    fn small_size_drift_across_ollama_releases_is_tolerated() {
        let mut sized = profile("legal-compact", "llama3.1:8b");
        sized.expected_size_bytes = Some(4_900_000_000);
        let mut drifted = candidate("llama3.1:8b", "abc", detail(Some(131_072), true, true));
        drifted.size_bytes = 4_950_000_000;
        assert!(evaluate_reuse(&[drifted], &[sized], 64_000)[0].reusable);
    }

    #[test]
    fn digest_comparison_ignores_prefix_and_case() {
        assert!(digests_equal("sha256:ABCdef", "abcDEF"));
        assert!(!digests_equal("", ""));
        assert!(!digests_equal("sha256:", "abc"));
    }
}
