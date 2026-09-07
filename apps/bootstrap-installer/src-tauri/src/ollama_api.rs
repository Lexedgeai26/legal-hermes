//! HTTP client for the managed Private AI runtime.
//!
//! Two boundaries are enforced here rather than trusted from configuration:
//!
//!   * the client refuses to talk to anything but loopback, so a tampered
//!     `runtime.json` cannot redirect inference off the machine;
//!   * every model tag is checked for immutability before it is pulled, so a
//!     mutable `latest` can never enter the managed model store.
//!
//! Download progress aggregation and digest verification are pure functions so
//! their behaviour is covered without a live runtime.

use std::collections::BTreeMap;
use std::time::{Duration, Instant};

use futures::StreamExt as _;
use serde::{Deserialize, Serialize};

use crate::validation::{RuntimeProbe, StreamSample};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);
const HEALTH_POLL_INTERVAL: Duration = Duration::from_millis(250);
/// Installed size may differ slightly from the catalogue figure across Ollama
/// releases; a wider drift means we did not get the artifact we expected.
const SIZE_TOLERANCE_FRACTION: f64 = 0.05;

// ---------------------------------------------------------------------------
// Tag policy
// ---------------------------------------------------------------------------

/// Reject anything that could resolve differently tomorrow than it does today.
pub fn ensure_immutable_tag(tag: &str) -> Result<(), String> {
    let trimmed = tag.trim();
    if trimmed.is_empty() {
        return Err("Model tag is empty".to_string());
    }
    let Some((name, version)) = trimmed.rsplit_once(':') else {
        return Err(format!(
            "Model tag {trimmed} has no explicit version; an implicit tag resolves to latest"
        ));
    };
    if name.is_empty() || version.is_empty() {
        return Err(format!("Model tag {trimmed} is malformed"));
    }
    if version.eq_ignore_ascii_case("latest") {
        return Err(format!(
            "Model tag {trimmed} is mutable; pin an exact version or digest"
        ));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Pull progress
// ---------------------------------------------------------------------------

/// One NDJSON frame from `/api/pull`.
#[derive(Debug, Clone, Deserialize)]
pub struct PullLine {
    #[serde(default)]
    pub status: String,
    pub digest: Option<String>,
    pub total: Option<u64>,
    pub completed: Option<u64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullProgress {
    pub status: String,
    pub completed_bytes: u64,
    pub total_bytes: u64,
    pub fraction: f64,
}

/// Aggregates per-layer byte counts into one figure for the UI. Ollama reports
/// each layer separately and repeats layers on resume, so the tracker keeps the
/// highest value seen per digest rather than summing deltas.
#[derive(Debug, Default)]
pub struct PullTracker {
    layers: BTreeMap<String, (u64, u64)>,
    status: String,
}

impl PullTracker {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn observe(&mut self, line: &PullLine) -> Result<PullProgress, String> {
        if let Some(error) = &line.error {
            // Surface a category, never raw server text, to the UI.
            return Err(sanitize_pull_error(error));
        }
        if !line.status.is_empty() {
            self.status = line.status.clone();
        }
        if let (Some(digest), Some(total)) = (&line.digest, line.total) {
            let completed = line.completed.unwrap_or(0).min(total);
            let entry = self.layers.entry(digest.clone()).or_insert((0, total));
            // Resume replays lower values for a layer already further along.
            entry.0 = entry.0.max(completed);
            entry.1 = total;
        }
        Ok(self.progress())
    }

    pub fn progress(&self) -> PullProgress {
        let completed_bytes: u64 = self.layers.values().map(|(done, _)| *done).sum();
        let total_bytes: u64 = self.layers.values().map(|(_, total)| *total).sum();
        PullProgress {
            status: self.status.clone(),
            completed_bytes,
            total_bytes,
            fraction: if total_bytes == 0 {
                0.0
            } else {
                (completed_bytes as f64 / total_bytes as f64).clamp(0.0, 1.0)
            },
        }
    }
}

fn sanitize_pull_error(raw: &str) -> String {
    let lowered = raw.to_ascii_lowercase();
    if lowered.contains("no space") || lowered.contains("disk") {
        "The download ran out of disk space".to_string()
    } else if lowered.contains("not found") || lowered.contains("manifest") {
        "The pinned model was not found in the registry".to_string()
    } else if lowered.contains("connection") || lowered.contains("timeout") || lowered.contains("eof")
    {
        "The download connection was interrupted".to_string()
    } else {
        "The model download failed".to_string()
    }
}

// ---------------------------------------------------------------------------
// Installed-model verification
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledModel {
    #[serde(alias = "name", alias = "model")]
    pub name: String,
    #[serde(default)]
    pub digest: String,
    #[serde(default)]
    pub size: u64,
}

/// The expected identity of a model, taken from the signed catalogue.
#[derive(Debug, Clone)]
pub struct ExpectedModel {
    pub tag: String,
    pub digest: Option<String>,
    pub size_bytes: Option<u64>,
}

/// Fails closed on tag, digest and size. A model that does not match exactly is
/// not the model the catalogue approved.
pub fn verify_installed_model(
    installed: &[InstalledModel],
    expected: &ExpectedModel,
) -> Result<InstalledModel, String> {
    ensure_immutable_tag(&expected.tag)?;
    let found = installed
        .iter()
        .find(|m| m.name == expected.tag)
        .ok_or_else(|| format!("{} is not installed", expected.tag))?;

    if let Some(expected_digest) = &expected.digest {
        let normalized_found = found.digest.trim().trim_start_matches("sha256:");
        let normalized_expected = expected_digest.trim().trim_start_matches("sha256:");
        if normalized_expected.is_empty() {
            return Err("The catalogue digest for this model is empty".to_string());
        }
        if !normalized_found.eq_ignore_ascii_case(normalized_expected) {
            return Err(format!(
                "{} does not match the approved digest",
                expected.tag
            ));
        }
    }

    if let Some(expected_size) = expected.size_bytes {
        if expected_size > 0 {
            let drift = (found.size as f64 - expected_size as f64).abs() / expected_size as f64;
            if drift > SIZE_TOLERANCE_FRACTION {
                return Err(format!(
                    "{} is {:.0}% away from the approved installed size",
                    expected.tag,
                    drift * 100.0
                ));
            }
        }
    }

    Ok(found.clone())
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

pub struct OllamaClient {
    base_url: String,
    client: reqwest::Client,
}

impl OllamaClient {
    /// Refuses any non-loopback base URL. This is the last line of defence if
    /// `runtime.json` is tampered with between validation and use.
    pub fn new(base_url: &str) -> Result<Self, String> {
        let parsed = reqwest::Url::parse(base_url.trim())
            .map_err(|_| "The managed runtime URL is invalid".to_string())?;
        if parsed.scheme() != "http" {
            return Err("The managed runtime URL must use http on loopback".to_string());
        }
        let host = parsed
            .host_str()
            .ok_or_else(|| "The managed runtime URL has no host".to_string())?;
        if !matches!(host, "127.0.0.1" | "localhost" | "::1" | "[::1]") {
            return Err("The managed runtime URL must point at loopback".to_string());
        }
        let client = reqwest::Client::builder()
            .timeout(REQUEST_TIMEOUT)
            // Never route loopback inference through a proxy (PRD 23).
            .no_proxy()
            .build()
            .map_err(|_| "Unable to create the runtime client".to_string())?;
        Ok(Self {
            base_url: parsed.as_str().trim_end_matches('/').to_string(),
            client,
        })
    }

    fn url(&self, path: &str) -> String {
        format!("{}{path}", self.base_url)
    }

    /// Poll until the runtime answers, or give up. Used after spawn and after
    /// any supervised restart.
    pub async fn wait_for_health(&self, timeout: Duration) -> Result<String, String> {
        let deadline = Instant::now() + timeout;
        let mut last = "The managed runtime did not become ready".to_string();
        while Instant::now() < deadline {
            match self.version().await {
                Ok(version) => return Ok(version),
                Err(err) => last = err,
            }
            tokio::time::sleep(HEALTH_POLL_INTERVAL).await;
        }
        Err(last)
    }

    /// Stream a model pull, reporting aggregate progress. Ollama resumes
    /// partially-downloaded blobs on its own, so a retry of this call continues
    /// rather than restarting.
    pub async fn pull_model(
        &self,
        tag: &str,
        mut on_progress: impl FnMut(PullProgress),
    ) -> Result<PullProgress, String> {
        ensure_immutable_tag(tag)?;
        let response = self
            .client
            .post(self.url("/api/pull"))
            .json(&serde_json::json!({ "model": tag, "stream": true }))
            .send()
            .await
            .map_err(|_| "Unable to reach the managed runtime to download the model".to_string())?;
        if !response.status().is_success() {
            return Err("The managed runtime refused the model download".to_string());
        }

        let mut tracker = PullTracker::new();
        let mut buffer = Vec::new();
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|_| "The model download was interrupted".to_string())?;
            buffer.extend_from_slice(&chunk);
            while let Some(position) = buffer.iter().position(|b| *b == b'\n') {
                let line: Vec<u8> = buffer.drain(..=position).collect();
                if let Some(progress) = parse_pull_frame(&mut tracker, &line)? {
                    on_progress(progress);
                }
            }
        }
        if let Some(progress) = parse_pull_frame(&mut tracker, &buffer)? {
            on_progress(progress);
        }
        Ok(tracker.progress())
    }

    pub async fn installed_models_detailed(&self) -> Result<Vec<InstalledModel>, String> {
        #[derive(Deserialize)]
        struct Tags {
            #[serde(default)]
            models: Vec<InstalledModel>,
        }
        let response = self
            .client
            .get(self.url("/api/tags"))
            .send()
            .await
            .map_err(|_| "Unable to list installed models".to_string())?;
        if !response.status().is_success() {
            return Err("The managed runtime could not list installed models".to_string());
        }
        Ok(response
            .json::<Tags>()
            .await
            .map_err(|_| "The installed-model list was not readable".to_string())?
            .models)
    }

    /// Warm the model with synthetic text. Client documents and user prompts
    /// must never be used for warm-up.
    pub async fn warm_up(&self, tag: &str) -> Result<StreamSample, String> {
        self.generate_stream(tag, "Reply with the single word: ready.")
            .await
    }
}

fn parse_pull_frame(
    tracker: &mut PullTracker,
    raw: &[u8],
) -> Result<Option<PullProgress>, String> {
    let text = String::from_utf8_lossy(raw);
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    let line = serde_json::from_str::<PullLine>(trimmed)
        .map_err(|_| "The model download reported an unreadable status".to_string())?;
    tracker.observe(&line).map(Some)
}

impl RuntimeProbe for OllamaClient {
    async fn version(&self) -> Result<String, String> {
        #[derive(Deserialize)]
        struct Version {
            version: String,
        }
        let response = self
            .client
            .get(self.url("/api/version"))
            .timeout(Duration::from_secs(5))
            .send()
            .await
            .map_err(|_| "The managed runtime is not answering".to_string())?;
        if !response.status().is_success() {
            return Err("The managed runtime returned an error".to_string());
        }
        Ok(response
            .json::<Version>()
            .await
            .map_err(|_| "The runtime version was not readable".to_string())?
            .version)
    }

    async fn installed_models(&self) -> Result<Vec<String>, String> {
        Ok(self
            .installed_models_detailed()
            .await?
            .into_iter()
            .map(|m| m.name)
            .collect())
    }

    async fn generate_stream(&self, model: &str, prompt: &str) -> Result<StreamSample, String> {
        #[derive(Deserialize)]
        struct Frame {
            #[serde(default)]
            response: String,
            #[serde(default)]
            done: bool,
            load_duration: Option<u64>,
            eval_count: Option<u64>,
            eval_duration: Option<u64>,
        }

        let started = Instant::now();
        let response = self
            .client
            .post(self.url("/api/generate"))
            .json(&serde_json::json!({
                "model": model,
                "prompt": prompt,
                "stream": true,
                "options": { "num_predict": 32 }
            }))
            .send()
            .await
            .map_err(|_| "The managed runtime did not accept the request".to_string())?;
        if !response.status().is_success() {
            return Err("The managed runtime refused the generation request".to_string());
        }

        let mut sample = StreamSample::default();
        let mut first_token_at: Option<Instant> = None;
        let mut buffer = Vec::new();
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|_| "The response stream was interrupted".to_string())?;
            buffer.extend_from_slice(&chunk);
            while let Some(position) = buffer.iter().position(|b| *b == b'\n') {
                let line: Vec<u8> = buffer.drain(..=position).collect();
                let text = String::from_utf8_lossy(&line);
                let trimmed = text.trim();
                if trimmed.is_empty() {
                    continue;
                }
                let Ok(frame) = serde_json::from_str::<Frame>(trimmed) else {
                    continue;
                };
                if !frame.response.is_empty() {
                    if first_token_at.is_none() {
                        first_token_at = Some(Instant::now());
                    }
                    sample.token_count += 1;
                    sample.text.push_str(&frame.response);
                }
                if frame.done {
                    sample.model_load_ms = frame.load_duration.map(|ns| ns / 1_000_000);
                    if let (Some(count), Some(duration)) = (frame.eval_count, frame.eval_duration) {
                        if duration > 0 {
                            sample.tokens_per_second =
                                Some(count as f64 / (duration as f64 / 1_000_000_000.0));
                        }
                        sample.token_count = sample.token_count.max(count);
                    }
                }
            }
        }
        sample.time_to_first_token_ms = first_token_at
            .unwrap_or_else(Instant::now)
            .duration_since(started)
            .as_millis() as u64;
        Ok(sample)
    }

    async fn generate_json(&self, model: &str, prompt: &str) -> Result<String, String> {
        #[derive(Deserialize)]
        struct Once {
            #[serde(default)]
            response: String,
        }
        let response = self
            .client
            .post(self.url("/api/generate"))
            .json(&serde_json::json!({
                "model": model,
                "prompt": prompt,
                "stream": false,
                // Ask the runtime itself to constrain the grammar to JSON.
                "format": "json",
                "options": { "temperature": 0 }
            }))
            .send()
            .await
            .map_err(|_| "The managed runtime did not accept the request".to_string())?;
        if !response.status().is_success() {
            return Err("The managed runtime refused the structured request".to_string());
        }
        Ok(response
            .json::<Once>()
            .await
            .map_err(|_| "The structured response was not readable".to_string())?
            .response)
    }

    async fn embed(&self, model: &str, text: &str) -> Result<(Vec<f64>, u64), String> {
        #[derive(Deserialize)]
        struct Embeddings {
            #[serde(default)]
            embeddings: Vec<Vec<f64>>,
        }
        let started = Instant::now();
        let response = self
            .client
            .post(self.url("/api/embed"))
            .json(&serde_json::json!({ "model": model, "input": text }))
            .send()
            .await
            .map_err(|_| "The managed runtime did not accept the embedding request".to_string())?;
        if !response.status().is_success() {
            return Err("The managed runtime refused the embedding request".to_string());
        }
        let body = response
            .json::<Embeddings>()
            .await
            .map_err(|_| "The embedding response was not readable".to_string())?;
        let vector = body
            .embeddings
            .into_iter()
            .next()
            .ok_or_else(|| "The runtime returned no embedding vector".to_string())?;
        Ok((vector, started.elapsed().as_millis() as u64))
    }

    async fn execution_mode(&self, model: &str) -> Option<String> {
        #[derive(Deserialize)]
        struct Running {
            #[serde(default)]
            models: Vec<RunningModel>,
        }
        #[derive(Deserialize)]
        struct RunningModel {
            #[serde(alias = "name", alias = "model")]
            name: String,
            #[serde(default)]
            size: u64,
            #[serde(default, alias = "size_vram")]
            size_vram: u64,
        }
        let response = self.client.get(self.url("/api/ps")).send().await.ok()?;
        let running = response.json::<Running>().await.ok()?;
        let entry = running.models.iter().find(|m| m.name == model)?;
        Some(classify_execution_mode(entry.size, entry.size_vram))
    }
}

/// Ollama reports how much of a loaded model sits in VRAM. Everything in VRAM
/// means GPU; nothing means CPU; a split is worth naming explicitly because it
/// explains mediocre throughput to the user.
fn classify_execution_mode(total_size: u64, vram_size: u64) -> String {
    if vram_size == 0 {
        "cpu".to_string()
    } else if total_size > 0 && vram_size >= total_size {
        "gpu".to_string()
    } else {
        "hybrid gpu/cpu".to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mutable_tags_are_rejected() {
        assert!(ensure_immutable_tag("qwen3:8b-q4_K_M").is_ok());
        assert!(ensure_immutable_tag("embeddinggemma:300m").is_ok());

        for bad in ["qwen3:latest", "qwen3:LATEST", "qwen3", "", ":8b", "qwen3:"] {
            assert!(
                ensure_immutable_tag(bad).is_err(),
                "{bad:?} must be rejected"
            );
        }
    }

    #[test]
    fn client_refuses_any_non_loopback_runtime_url() {
        assert!(OllamaClient::new("http://127.0.0.1:11434").is_ok());
        assert!(OllamaClient::new("http://localhost:11435/").is_ok());

        for bad in [
            "http://0.0.0.0:11434",
            "http://192.168.1.10:11434",
            "http://ollama.example.com",
            "https://127.0.0.1:11434",
            "not a url",
        ] {
            assert!(OllamaClient::new(bad).is_err(), "{bad} must be refused");
        }
    }

    #[test]
    fn pull_progress_aggregates_layers_without_double_counting() {
        let mut tracker = PullTracker::new();
        tracker
            .observe(&PullLine {
                status: "pulling manifest".to_string(),
                digest: None,
                total: None,
                completed: None,
                error: None,
            })
            .unwrap();

        let a = |completed| PullLine {
            status: "downloading".to_string(),
            digest: Some("sha256:aaa".to_string()),
            total: Some(1_000),
            completed: Some(completed),
            error: None,
        };
        let b = |completed| PullLine {
            status: "downloading".to_string(),
            digest: Some("sha256:bbb".to_string()),
            total: Some(3_000),
            completed: Some(completed),
            error: None,
        };

        tracker.observe(&a(500)).unwrap();
        let progress = tracker.observe(&b(1_500)).unwrap();
        assert_eq!(progress.completed_bytes, 2_000);
        assert_eq!(progress.total_bytes, 4_000);
        assert!((progress.fraction - 0.5).abs() < f64::EPSILON);

        // The same layer reported again must replace, not add.
        let progress = tracker.observe(&a(1_000)).unwrap();
        assert_eq!(progress.completed_bytes, 2_500);
        assert_eq!(progress.total_bytes, 4_000);
    }

    #[test]
    fn resume_never_moves_progress_backwards() {
        let mut tracker = PullTracker::new();
        let layer = |completed| PullLine {
            status: "downloading".to_string(),
            digest: Some("sha256:aaa".to_string()),
            total: Some(1_000),
            completed: Some(completed),
            error: None,
        };
        tracker.observe(&layer(900)).unwrap();
        // A resumed pull replays earlier offsets for a layer already advanced.
        let progress = tracker.observe(&layer(100)).unwrap();
        assert_eq!(progress.completed_bytes, 900, "resume must not rewind");
    }

    #[test]
    fn progress_is_clamped_and_safe_when_totals_are_absent() {
        let mut tracker = PullTracker::new();
        let progress = tracker
            .observe(&PullLine {
                status: "verifying sha256 digest".to_string(),
                digest: None,
                total: None,
                completed: None,
                error: None,
            })
            .unwrap();
        assert_eq!(progress.fraction, 0.0);
        assert_eq!(progress.status, "verifying sha256 digest");

        // A layer claiming more completed than total must not exceed 1.0.
        tracker
            .observe(&PullLine {
                status: "downloading".to_string(),
                digest: Some("sha256:ccc".to_string()),
                total: Some(100),
                completed: Some(400),
                error: None,
            })
            .unwrap();
        assert!(tracker.progress().fraction <= 1.0);
    }

    #[test]
    fn download_errors_are_categorised_not_echoed() {
        let mut tracker = PullTracker::new();
        let err = tracker
            .observe(&PullLine {
                status: String::new(),
                digest: None,
                total: None,
                completed: None,
                error: Some("write /Users/jane/.ollama/blobs: no space left on device".to_string()),
            })
            .unwrap_err();
        assert_eq!(err, "The download ran out of disk space");
        // The user's path must not leak into the message.
        assert!(!err.contains("/Users/"));

        assert_eq!(
            sanitize_pull_error("manifest unknown: model not found"),
            "The pinned model was not found in the registry"
        );
        assert_eq!(
            sanitize_pull_error("unexpected EOF"),
            "The download connection was interrupted"
        );
    }

    fn installed() -> Vec<InstalledModel> {
        vec![
            InstalledModel {
                name: "legal-test:9b".to_string(),
                digest: "sha256:abc123".to_string(),
                size: 5_000_000_000,
            },
            InstalledModel {
                name: "embedding-test:300m".to_string(),
                digest: "sha256:def456".to_string(),
                size: 600_000_000,
            },
        ]
    }

    #[test]
    fn digest_and_size_must_both_match() {
        let ok = verify_installed_model(
            &installed(),
            &ExpectedModel {
                tag: "legal-test:9b".to_string(),
                digest: Some("abc123".to_string()),
                size_bytes: Some(5_000_000_000),
            },
        );
        assert!(ok.is_ok(), "{ok:?}");

        // Wrong digest — a different artifact under the same tag.
        let err = verify_installed_model(
            &installed(),
            &ExpectedModel {
                tag: "legal-test:9b".to_string(),
                digest: Some("999999".to_string()),
                size_bytes: None,
            },
        )
        .unwrap_err();
        assert!(err.contains("approved digest"), "{err}");

        // Size drift beyond tolerance.
        let err = verify_installed_model(
            &installed(),
            &ExpectedModel {
                tag: "legal-test:9b".to_string(),
                digest: None,
                size_bytes: Some(2_000_000_000),
            },
        )
        .unwrap_err();
        assert!(err.contains("installed size"), "{err}");
    }

    #[test]
    fn verification_tolerates_the_sha256_prefix_on_either_side() {
        for expected in ["sha256:abc123", "abc123", "ABC123"] {
            assert!(verify_installed_model(
                &installed(),
                &ExpectedModel {
                    tag: "legal-test:9b".to_string(),
                    digest: Some(expected.to_string()),
                    size_bytes: None,
                },
            )
            .is_ok());
        }
    }

    #[test]
    fn verification_rejects_a_missing_model_and_a_mutable_tag() {
        let err = verify_installed_model(
            &installed(),
            &ExpectedModel {
                tag: "absent:1b".to_string(),
                digest: None,
                size_bytes: None,
            },
        )
        .unwrap_err();
        assert!(err.contains("not installed"));

        let err = verify_installed_model(
            &installed(),
            &ExpectedModel {
                tag: "legal-test:latest".to_string(),
                digest: None,
                size_bytes: None,
            },
        )
        .unwrap_err();
        assert!(err.contains("mutable"));
    }

    #[test]
    fn an_empty_catalogue_digest_is_a_failure_not_a_pass() {
        let err = verify_installed_model(
            &installed(),
            &ExpectedModel {
                tag: "legal-test:9b".to_string(),
                digest: Some("   ".to_string()),
                size_bytes: None,
            },
        )
        .unwrap_err();
        assert!(err.contains("empty"), "{err}");
    }

    #[test]
    fn execution_mode_distinguishes_gpu_cpu_and_hybrid() {
        assert_eq!(classify_execution_mode(5_000, 5_000), "gpu");
        assert_eq!(classify_execution_mode(5_000, 6_000), "gpu");
        assert_eq!(classify_execution_mode(5_000, 0), "cpu");
        assert_eq!(classify_execution_mode(5_000, 2_000), "hybrid gpu/cpu");
    }
}
