//! Signed component manifest: where the managed runtime comes from, and how
//! we prove that what arrived is what LexEdge approved.
//!
//! Nothing is executed from a component that has not passed, in order:
//! envelope signature → schema version → expiry → https-only URL → exact
//! size → exact SHA-256. The download layer enforces the last three again at
//! the bytes; this module makes sure a bad manifest never reaches it.

use serde::Deserialize;

use crate::catalogue::{expiry_is_valid, trusted_keys};
use crate::signed_envelope::{verify_json_envelope, SignedEnvelope};

const SUPPORTED_MANIFEST_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Channel {
    Development,
    Canary,
    Stable,
    Enterprise,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Platform {
    Windows,
    Macos,
    Linux,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Architecture {
    X64,
    Arm64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Component {
    pub id: String,
    pub version: String,
    pub platform: Platform,
    pub architecture: Architecture,
    pub url: String,
    pub size_bytes: u64,
    pub sha256: String,
    pub license: String,
    pub notice_path: String,
    #[serde(default)]
    pub minimum_os_version: Option<String>,
    #[serde(default)]
    pub authenticode_required: bool,
    #[serde(default)]
    pub rollback_version: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ComponentManifest {
    pub schema_version: u32,
    pub release_id: String,
    pub channel: Channel,
    pub issued_at: String,
    pub expires_at: String,
    pub components: Vec<Component>,
}

impl ComponentManifest {
    /// The one component matching this machine. The manifest may list the
    /// same id for several platforms; only an exact platform+architecture
    /// match is ever considered, so an x64 archive can never land on arm64.
    pub fn select(&self, id: &str, platform: Platform, architecture: Architecture) -> Option<&Component> {
        self.components
            .iter()
            .find(|c| c.id == id && c.platform == platform && c.architecture == architecture)
    }
}

pub fn current_platform() -> Option<Platform> {
    match std::env::consts::OS {
        "macos" => Some(Platform::Macos),
        "windows" => Some(Platform::Windows),
        "linux" => Some(Platform::Linux),
        _ => None,
    }
}

pub fn current_architecture() -> Option<Architecture> {
    match std::env::consts::ARCH {
        "x86_64" => Some(Architecture::X64),
        "aarch64" => Some(Architecture::Arm64),
        _ => None,
    }
}

/// Verify and validate. `now_rfc3339` is injected so expiry is testable.
pub fn load_signed_component_manifest(
    envelope: &SignedEnvelope,
    now_rfc3339: &str,
) -> Result<ComponentManifest, String> {
    let verified = verify_json_envelope::<ComponentManifest>(envelope, &trusted_keys())?;
    let manifest = verified.value;

    if manifest.schema_version != SUPPORTED_MANIFEST_VERSION {
        return Err(format!(
            "Unsupported component manifest version {}",
            manifest.schema_version
        ));
    }
    if !expiry_is_valid(&manifest.expires_at, now_rfc3339) {
        return Err("The component manifest has expired".to_string());
    }
    if manifest.components.is_empty() {
        return Err("The component manifest lists no components".to_string());
    }
    for component in &manifest.components {
        validate_component(component)?;
    }
    Ok(manifest)
}

/// The schema constrains these too, but the schema is not what runs.
fn validate_component(component: &Component) -> Result<(), String> {
    if !component.url.starts_with("https://") {
        return Err(format!(
            "Component {} must be fetched over https",
            component.id
        ));
    }
    if component.size_bytes == 0 {
        return Err(format!("Component {} declares no size", component.id));
    }
    if component.sha256.len() != 64 || !component.sha256.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(format!(
            "Component {} has an invalid SHA-256",
            component.id
        ));
    }
    if component.version.trim().is_empty() || component.id.trim().is_empty() {
        return Err("Component id and version are required".to_string());
    }
    Ok(())
}

/// Development manifest pointing at official Ollama release artifacts, signed
/// at runtime with the debug-only key. Release builds cannot mint one and must
/// be provisioned with a manifest signed by release engineering.
#[cfg(debug_assertions)]
pub fn development_component_manifest(now_rfc3339: &str) -> Result<ComponentManifest, String> {
    use crate::catalogue::{DEV_KEY_ID, DEV_SIGNING_SEED};
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine as _;
    use ed25519_dalek::{Signer, SigningKey};

    const PAYLOAD: &str = include_str!("../test-fixtures/components/dev-components.json");
    let signing_key = SigningKey::from_bytes(&DEV_SIGNING_SEED);
    let envelope = SignedEnvelope {
        schema_version: 1,
        key_id: DEV_KEY_ID.to_string(),
        algorithm: "Ed25519".to_string(),
        payload: STANDARD.encode(PAYLOAD.as_bytes()),
        signature: STANDARD.encode(signing_key.sign(PAYLOAD.as_bytes()).to_bytes()),
    };
    load_signed_component_manifest(&envelope, now_rfc3339)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalogue::{DEV_KEY_ID, DEV_SIGNING_SEED};
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine as _;
    use ed25519_dalek::{Signer, SigningKey};

    const NOW: &str = "2026-09-08T00:00:00Z";

    fn manifest_json(url: &str, expires: &str) -> String {
        format!(
            r#"{{"schemaVersion":1,"releaseId":"t","channel":"stable",
                 "issuedAt":"2026-09-01T00:00:00Z","expiresAt":"{expires}",
                 "components":[{{"id":"ollama","version":"0.33.3","platform":"macos",
                 "architecture":"arm64","url":"{url}","sizeBytes":10,
                 "sha256":"{}","license":"MIT","noticePath":"n"}}]}}"#,
            "ab".repeat(32)
        )
    }

    fn sign(payload: &str, seed: [u8; 32]) -> SignedEnvelope {
        let key = SigningKey::from_bytes(&seed);
        SignedEnvelope {
            schema_version: 1,
            key_id: DEV_KEY_ID.to_string(),
            algorithm: "Ed25519".to_string(),
            payload: STANDARD.encode(payload.as_bytes()),
            signature: STANDARD.encode(key.sign(payload.as_bytes()).to_bytes()),
        }
    }

    #[test]
    fn a_valid_manifest_loads_and_selects_by_platform() {
        let env = sign(&manifest_json("https://x.example/a.tgz", "2099-01-01T00:00:00Z"), DEV_SIGNING_SEED);
        let m = load_signed_component_manifest(&env, NOW).unwrap();
        assert!(m.select("ollama", Platform::Macos, Architecture::Arm64).is_some());
        // Same id, wrong architecture: never a match.
        assert!(m.select("ollama", Platform::Macos, Architecture::X64).is_none());
        assert!(m.select("ollama", Platform::Windows, Architecture::Arm64).is_none());
    }

    #[test]
    fn untrusted_signature_and_expiry_fail_closed() {
        let forged = sign(&manifest_json("https://x.example/a.tgz", "2099-01-01T00:00:00Z"), [3_u8; 32]);
        assert!(load_signed_component_manifest(&forged, NOW).is_err());

        let expired = sign(&manifest_json("https://x.example/a.tgz", "2026-01-01T00:00:00Z"), DEV_SIGNING_SEED);
        assert!(load_signed_component_manifest(&expired, NOW)
            .unwrap_err()
            .contains("expired"));
    }

    #[test]
    fn plain_http_components_are_refused_even_when_signed() {
        let env = sign(&manifest_json("http://x.example/a.tgz", "2099-01-01T00:00:00Z"), DEV_SIGNING_SEED);
        assert!(load_signed_component_manifest(&env, NOW)
            .unwrap_err()
            .contains("https"));
    }

    #[test]
    fn development_manifest_covers_this_machine_with_real_hashes() {
        let m = development_component_manifest(NOW).unwrap();
        assert_eq!(m.channel, Channel::Development);
        let (Some(p), Some(a)) = (current_platform(), current_architecture()) else {
            return;
        };
        if p == Platform::Linux {
            return; // no linux artifact is pinned yet
        }
        let c = m.select("ollama", p, a).expect("a runtime for this machine");
        assert_eq!(c.version, "0.33.3");
        assert!(c.url.starts_with("https://github.com/ollama/ollama/releases/download/v0.33.3/"));
        assert_eq!(c.sha256.len(), 64);
        assert!(c.size_bytes > 100_000_000);
    }
}
