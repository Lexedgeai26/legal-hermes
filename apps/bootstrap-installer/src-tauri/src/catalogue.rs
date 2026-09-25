//! Signed LexEdge legal-model catalogue loading.
//!
//! The renderer never supplies a catalogue. It is verified here against a
//! compile-time trusted key set, so a compromised webview cannot introduce a
//! model that LexEdge has not legally approved.
//!
//! Three controls live in this module:
//!   * signature verification against pinned keys, supporting rotation by key id;
//!   * expiry, so a catalogue cannot be replayed forever;
//!   * emergency disablement, so a single profile can be withdrawn without
//!     shipping a new installer.

use serde::Deserialize;

use crate::private_ai::{LegalModelCatalogue, LegalModelProfile};
use crate::signed_envelope::{verify_json_envelope, SignedEnvelope, TrustedKeySet};

const SUPPORTED_CATALOGUE_ENVELOPE_VERSION: u32 = 1;

/// Development signing seed. Debug builds only — a release build has no way to
/// mint a catalogue, so production must supply a properly signed one.
#[cfg(debug_assertions)]
pub const DEV_SIGNING_SEED: [u8; 32] = [42_u8; 32];
#[cfg(debug_assertions)]
pub const DEV_KEY_ID: &str = "lexedge-dev-2026";
/// Production signing key id. The private half lives outside this repository.
pub const PROD_KEY_ID: &str = "lexedge-prod-2026";

/// The signed payload. Expiry is inside the signature, so it cannot be edited
/// without invalidating the whole envelope.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignedCatalogue {
    pub schema_version: u32,
    /// RFC 3339. Past this instant the catalogue is refused.
    pub not_after: String,
    /// Profile ids withdrawn since the catalogue was cut. Emergency kill switch.
    #[serde(default)]
    pub disabled_profiles: Vec<String>,
    /// The embedding model is a catalogue-level decision: every profile in a
    /// catalogue shares one embedding space so matter indexes stay comparable.
    #[serde(default)]
    pub embedding_model: String,
    #[serde(default)]
    pub embedding_dimensions: usize,
    #[serde(default)]
    pub embedding_expected_digest: Option<String>,
    #[serde(default)]
    pub embedding_expected_size_bytes: Option<u64>,
    pub catalogue: LegalModelCatalogue,
}

/// A verified catalogue plus the catalogue-level model decisions.
#[derive(Debug, Clone)]
pub struct LoadedCatalogue {
    pub catalogue: LegalModelCatalogue,
    pub embedding_model: String,
    pub embedding_dimensions: usize,
    pub embedding_expected_digest: Option<String>,
    pub embedding_expected_size_bytes: Option<u64>,
}

/// Keys this build trusts. Rotation is additive: ship the new key alongside the
/// old one, re-sign, then drop the old key in a later release.
pub fn trusted_keys() -> TrustedKeySet {
    #[allow(unused_mut)]
    let mut entries: Vec<(String, [u8; 32])> = Vec::new();

    #[cfg(debug_assertions)]
    {
        use ed25519_dalek::SigningKey;
        entries.push((
            DEV_KEY_ID.to_string(),
            SigningKey::from_bytes(&DEV_SIGNING_SEED)
                .verifying_key()
                .to_bytes(),
        ));
    }

    // Production key. Safe to commit: a verifying key can check a signature but
    // never produce one. Rotation is additive — push the new key here, re-sign,
    // ship, and only then remove the old entry, so a release never rejects a
    // catalogue that is still in the field.
    entries.push((
        PROD_KEY_ID.to_string(),
        [
            41, 53, 126, 234, 231, 98, 166, 67, 146, 145, 99, 11, 33, 222, 202, 167,
            89, 23, 133, 44, 137, 134, 160, 203, 206, 48, 7, 91, 37, 40, 26, 216,
        ],
    ));

    TrustedKeySet::from_entries(entries)
}

/// Verify an envelope and return the usable catalogue.
///
/// `now_rfc3339` is passed in rather than read from the clock so expiry is
/// deterministic under test.
pub fn load_signed_catalogue(
    envelope: &SignedEnvelope,
    now_rfc3339: &str,
) -> Result<LoadedCatalogue, String> {
    let verified = verify_json_envelope::<SignedCatalogue>(envelope, &trusted_keys())?;
    let signed = verified.value;

    if signed.schema_version != SUPPORTED_CATALOGUE_ENVELOPE_VERSION {
        return Err(format!(
            "Unsupported catalogue envelope version {}",
            signed.schema_version
        ));
    }
    if !expiry_is_valid(&signed.not_after, now_rfc3339) {
        return Err("The model catalogue has expired".to_string());
    }

    let mut catalogue = signed.catalogue;
    apply_emergency_disablement(&mut catalogue, &signed.disabled_profiles);
    if catalogue.profiles.iter().all(|p| !is_selectable(p)) {
        return Err("The model catalogue contains no available models".to_string());
    }
    Ok(LoadedCatalogue {
        catalogue,
        embedding_model: signed.embedding_model,
        embedding_dimensions: signed.embedding_dimensions,
        embedding_expected_digest: signed.embedding_expected_digest,
        embedding_expected_size_bytes: signed.embedding_expected_size_bytes,
    })
}

/// The synthetic catalogue used to exercise the screens before production
/// artifacts exist. Debug builds only: a release build cannot mint one, so it
/// must be given a properly signed catalogue.
#[cfg(debug_assertions)]
pub fn development_catalogue(now_rfc3339: &str) -> Result<LoadedCatalogue, String> {
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine as _;
    use ed25519_dalek::{Signer, SigningKey};

    const PAYLOAD: &str = include_str!("../test-fixtures/catalogue/dev-catalogue.json");
    let signing_key = SigningKey::from_bytes(&DEV_SIGNING_SEED);
    // Signed for real, then verified through the same path production uses.
    let envelope = SignedEnvelope {
        schema_version: 1,
        key_id: DEV_KEY_ID.to_string(),
        algorithm: "Ed25519".to_string(),
        payload: STANDARD.encode(PAYLOAD.as_bytes()),
        signature: STANDARD.encode(signing_key.sign(PAYLOAD.as_bytes()).to_bytes()),
    };
    load_signed_catalogue(&envelope, now_rfc3339)
}

/// The catalogue shipped with a release build.
///
/// The signed envelope is embedded rather than read from disk: a file beside
/// the binary could be swapped, and while the signature would catch that, an
/// embedded payload removes the failure mode entirely and keeps the installer
/// working with no network. Updating the catalogue therefore means shipping a
/// release — which is the right trade while `disabledProfiles` can withdraw a
/// profile and `notAfter` bounds how long any catalogue stays valid.
#[cfg(not(debug_assertions))]
pub fn production_catalogue(now_rfc3339: &str) -> Result<LoadedCatalogue, String> {
    const ENVELOPE: &str = include_str!("../catalogue/production-catalogue.signed.json");
    let envelope: SignedEnvelope = serde_json::from_str(ENVELOPE)
        .map_err(|_| "The bundled model catalogue could not be read".to_string())?;
    load_signed_catalogue(&envelope, now_rfc3339)
}

/// Lexicographic comparison is correct for RFC 3339 UTC timestamps of equal
/// shape, which is what we mint. Anything malformed fails closed.
pub(crate) fn expiry_is_valid(not_after: &str, now: &str) -> bool {
    if not_after.len() != 20 || !not_after.ends_with('Z') {
        return false;
    }
    if now.len() != 20 || !now.ends_with('Z') {
        return false;
    }
    now <= not_after
}

/// Withdraw profiles named in the signed kill list. The profile stays visible
/// as excluded rather than vanishing, so the user gets a reason.
fn apply_emergency_disablement(catalogue: &mut LegalModelCatalogue, disabled: &[String]) {
    for profile in &mut catalogue.profiles {
        if disabled.iter().any(|id| id == &profile.id) {
            profile.enabled = false;
        }
    }
}

fn is_selectable(profile: &LegalModelProfile) -> bool {
    profile.enabled && !profile.retired && profile.legal_benchmark.approved
}

#[cfg(test)]
mod prod_catalogue_tests {
    use super::*;

    /// The envelope shipped in release builds must verify against the pinned
    /// production key. Without this, a mis-signed or truncated catalogue
    /// compiles perfectly and fails for the first customer who opens the app —
    /// the exact class of defect that left Private AI unavailable in every
    /// signed build before this. The payload is embedded the same way the
    /// release loader embeds it, so the test covers the real bytes.
    #[test]
    fn shipped_production_catalogue_verifies_against_the_pinned_key() {
        const ENVELOPE: &str = include_str!("../catalogue/production-catalogue.signed.json");
        let envelope: SignedEnvelope =
            serde_json::from_str(ENVELOPE).expect("bundled catalogue envelope must parse");

        assert_eq!(envelope.key_id, PROD_KEY_ID, "signed with an unexpected key");

        let loaded = load_signed_catalogue(&envelope, "2026-09-23T00:00:00Z")
            .expect("bundled catalogue must verify against the pinned production key");

        assert!(
            loaded.catalogue.profiles.iter().any(is_selectable),
            "a shipped catalogue with no selectable profile leaves Private AI unusable"
        );
    }

    /// The component manifest ships beside the catalogue and is verified with
    /// the same key. It was missed when the catalogue was first wired, so
    /// analysis succeeded while provisioning failed mid-install with "No signed
    /// catalogue or component manifest has been provisioned for this build" —
    /// the user reached the download stage before anything told them it could
    /// not work. Both artifacts are asserted here so neither can ship alone.
    #[test]
    fn shipped_component_manifest_verifies_against_the_pinned_key() {
        const ENVELOPE: &str = include_str!("../catalogue/production-components.signed.json");
        let envelope: SignedEnvelope =
            serde_json::from_str(ENVELOPE).expect("bundled component manifest must parse");
        assert_eq!(envelope.key_id, PROD_KEY_ID);

        let manifest = crate::component_manifest::load_signed_component_manifest(
            &envelope,
            "2026-09-25T00:00:00Z",
        )
        .expect("bundled component manifest must verify against the pinned key");

        // Every platform the installer can provision on needs an artifact, or
        // setup fails only on the machines nobody tested.
        use crate::component_manifest::{Architecture, Platform};
        for (platform, arch) in [
            (Platform::Macos, Architecture::Arm64),
            (Platform::Macos, Architecture::X64),
            (Platform::Windows, Architecture::X64),
        ] {
            assert!(
                manifest
                    .components
                    .iter()
                    .any(|c| c.platform == platform && c.architecture == arch),
                "no component for {platform:?}/{arch:?}"
            );
        }
    }

    /// Expiry is the only thing that bounds how long a withdrawn catalogue
    /// stays usable, so a shipped one must not already be expired — and must
    /// not be so far out that the control is inert.
    #[test]
    fn shipped_production_catalogue_is_not_expired_today() {
        const ENVELOPE: &str = include_str!("../catalogue/production-catalogue.signed.json");
        let envelope: SignedEnvelope = serde_json::from_str(ENVELOPE).unwrap();
        // A date comfortably past this build but before the catalogue's expiry.
        assert!(load_signed_catalogue(&envelope, "2027-01-01T00:00:00Z").is_ok());
        // And it does expire eventually.
        assert!(load_signed_catalogue(&envelope, "2099-01-01T00:00:00Z").is_err());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine as _;
    use ed25519_dalek::{Signer, SigningKey};

    fn catalogue_json(disabled: &str) -> String {
        format!(
            r#"{{
              "schemaVersion": 1,
              "notAfter": "2099-01-01T00:00:00Z",
              "disabledProfiles": [{disabled}],
              "catalogue": {{
                "schemaVersion": 1,
                "id": "legal-desktop",
                "version": "1.0.0",
                "profiles": [
                  {{
                    "id": "legal-standard",
                    "friendlyName": "Legal Standard",
                    "ollamaModel": "legal-test:9b",
                    "minimumRamGb": 16,
                    "recommendedRamGb": 24,
                    "downloadSizeGb": 5.5,
                    "operationalContextTokens": 16384,
                    "targetTps": 20,
                    "legalBenchmark": {{"approved": true, "score": 82, "version": "1"}}
                  }},
                  {{
                    "id": "legal-compact",
                    "friendlyName": "Legal Compact",
                    "ollamaModel": "legal-test:3b",
                    "minimumRamGb": 8,
                    "recommendedRamGb": 12,
                    "downloadSizeGb": 2.1,
                    "operationalContextTokens": 8192,
                    "targetTps": 25,
                    "legalBenchmark": {{"approved": true, "score": 74, "version": "1"}}
                  }}
                ]
              }}
            }}"#
        )
    }

    fn sign(payload: &str, key_id: &str, seed: [u8; 32]) -> SignedEnvelope {
        let signing_key = SigningKey::from_bytes(&seed);
        SignedEnvelope {
            schema_version: 1,
            key_id: key_id.to_string(),
            algorithm: "Ed25519".to_string(),
            payload: STANDARD.encode(payload.as_bytes()),
            signature: STANDARD.encode(signing_key.sign(payload.as_bytes()).to_bytes()),
        }
    }

    fn dev_envelope(disabled: &str) -> SignedEnvelope {
        sign(&catalogue_json(disabled), DEV_KEY_ID, DEV_SIGNING_SEED)
    }

    const NOW: &str = "2026-09-07T00:00:00Z";

    #[test]
    fn a_correctly_signed_catalogue_loads() {
        let loaded = load_signed_catalogue(&dev_envelope(""), NOW).unwrap();
        let catalogue = &loaded.catalogue;
        assert_eq!(catalogue.id, "legal-desktop");
        assert_eq!(catalogue.profiles.len(), 2);
        assert!(catalogue.profiles.iter().all(is_selectable));
    }

    #[test]
    fn a_catalogue_signed_by_an_untrusted_key_is_refused() {
        let forged = sign(&catalogue_json(""), DEV_KEY_ID, [9_u8; 32]);
        let err = load_signed_catalogue(&forged, NOW).unwrap_err();
        assert!(err.contains("verification failed"), "{err}");
    }

    #[test]
    fn an_unknown_key_id_is_refused_even_with_a_valid_signature() {
        let other = sign(&catalogue_json(""), "rotated-out-key", DEV_SIGNING_SEED);
        let err = load_signed_catalogue(&other, NOW).unwrap_err();
        assert!(err.contains("unknown key"), "{err}");
    }

    #[test]
    fn tampering_with_the_payload_after_signing_is_refused() {
        let mut envelope = dev_envelope("");
        envelope.payload = STANDARD.encode(catalogue_json("").replace("16", "4").as_bytes());
        assert!(load_signed_catalogue(&envelope, NOW).is_err());
    }

    #[test]
    fn an_expired_catalogue_is_refused() {
        let payload = catalogue_json("").replace("2099-01-01", "2026-01-01");
        let envelope = sign(&payload, DEV_KEY_ID, DEV_SIGNING_SEED);
        let err = load_signed_catalogue(&envelope, NOW).unwrap_err();
        assert!(err.contains("expired"), "{err}");
    }

    #[test]
    fn a_malformed_expiry_fails_closed() {
        assert!(!expiry_is_valid("soon", NOW));
        assert!(!expiry_is_valid("2099-01-01", NOW));
        assert!(!expiry_is_valid("2099-01-01T00:00:00+05:30", NOW));
        assert!(expiry_is_valid("2099-01-01T00:00:00Z", NOW));
        // Expiring exactly now is still valid.
        assert!(expiry_is_valid(NOW, NOW));
    }

    #[test]
    fn emergency_disablement_withdraws_a_named_profile() {
        let catalogue = load_signed_catalogue(&dev_envelope("\"legal-standard\""), NOW).unwrap().catalogue;
        let standard = catalogue
            .profiles
            .iter()
            .find(|p| p.id == "legal-standard")
            .unwrap();
        assert!(!standard.enabled, "a withdrawn profile must be disabled");
        assert!(!is_selectable(standard));

        // It is still present, so the UI can explain why it is unavailable.
        assert_eq!(catalogue.profiles.len(), 2);
        // The untouched profile still works.
        assert!(is_selectable(
            catalogue.profiles.iter().find(|p| p.id == "legal-compact").unwrap()
        ));
    }

    #[test]
    fn disabling_every_profile_fails_rather_than_offering_nothing() {
        let envelope = dev_envelope("\"legal-standard\", \"legal-compact\"");
        let err = load_signed_catalogue(&envelope, NOW).unwrap_err();
        assert!(err.contains("no available models"), "{err}");
    }
}
