//! Ed25519 verification boundary for installer-controlled JSON payloads.
//!
//! The envelope signs the exact decoded payload bytes, avoiding ambiguous JSON
//! reserialization. Production trusted keys are compiled/provisioned by release
//! engineering; renderer input can never add a trusted key.

use std::collections::HashMap;

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::de::DeserializeOwned;
use serde::Deserialize;
use sha2::{Digest, Sha256};

const ENVELOPE_SCHEMA_VERSION: u32 = 1;
const MAX_SIGNED_PAYLOAD_BYTES: usize = 5_000_000;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SignedEnvelope {
    pub schema_version: u32,
    pub key_id: String,
    pub algorithm: String,
    pub payload: String,
    pub signature: String,
}

#[derive(Debug)]
pub struct TrustedKeySet {
    keys: HashMap<String, [u8; 32]>,
}

#[derive(Debug)]
pub struct VerifiedPayload<T> {
    pub key_id: String,
    pub payload_sha256: String,
    pub value: T,
}

impl TrustedKeySet {
    pub fn from_entries(entries: impl IntoIterator<Item = (String, [u8; 32])>) -> Self {
        Self {
            keys: entries.into_iter().collect(),
        }
    }

    fn key(&self, key_id: &str) -> Option<&[u8; 32]> {
        self.keys.get(key_id)
    }
}

pub fn verify_json_envelope<T: DeserializeOwned>(
    envelope: &SignedEnvelope,
    trusted_keys: &TrustedKeySet,
) -> Result<VerifiedPayload<T>, String> {
    if envelope.schema_version != ENVELOPE_SCHEMA_VERSION {
        return Err(format!(
            "Unsupported signed-envelope schema version {}",
            envelope.schema_version
        ));
    }
    if envelope.algorithm != "Ed25519" {
        return Err("Unsupported signed-envelope algorithm".to_string());
    }
    let trusted_bytes = trusted_keys
        .key(&envelope.key_id)
        .ok_or_else(|| "Signed payload uses an unknown key".to_string())?;
    let payload = STANDARD
        .decode(&envelope.payload)
        .map_err(|_| "Signed payload encoding is invalid".to_string())?;
    if payload.is_empty() || payload.len() > MAX_SIGNED_PAYLOAD_BYTES {
        return Err("Signed payload size is invalid".to_string());
    }
    let signature_bytes = STANDARD
        .decode(&envelope.signature)
        .map_err(|_| "Signed payload signature encoding is invalid".to_string())?;
    let signature = Signature::from_slice(&signature_bytes)
        .map_err(|_| "Signed payload signature is invalid".to_string())?;
    let key = VerifyingKey::from_bytes(trusted_bytes)
        .map_err(|_| "Trusted signing key is invalid".to_string())?;
    key.verify(&payload, &signature)
        .map_err(|_| "Signed payload verification failed".to_string())?;

    let value = serde_json::from_slice::<T>(&payload)
        .map_err(|_| "Verified payload JSON is invalid".to_string())?;
    let payload_sha256 = Sha256::digest(&payload)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    Ok(VerifiedPayload {
        key_id: envelope.key_id.clone(),
        payload_sha256,
        value,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use serde_json::Value;

    fn signed_fixture() -> (SignedEnvelope, TrustedKeySet) {
        let signing_key = SigningKey::from_bytes(&[7_u8; 32]);
        let payload = br#"{"schemaVersion":1,"kind":"synthetic"}"#;
        let envelope = SignedEnvelope {
            schema_version: 1,
            key_id: "test-key".to_string(),
            algorithm: "Ed25519".to_string(),
            payload: STANDARD.encode(payload),
            signature: STANDARD.encode(signing_key.sign(payload).to_bytes()),
        };
        let keys = TrustedKeySet::from_entries([(
            "test-key".to_string(),
            signing_key.verifying_key().to_bytes(),
        )]);
        (envelope, keys)
    }

    #[test]
    fn valid_envelope_verifies_and_parses() {
        let (envelope, keys) = signed_fixture();
        let verified = verify_json_envelope::<Value>(&envelope, &keys).unwrap();
        assert_eq!(verified.key_id, "test-key");
        assert_eq!(verified.value["kind"], "synthetic");
        assert_eq!(verified.payload_sha256.len(), 64);
    }

    #[test]
    fn tampered_payload_fails_closed() {
        let (mut envelope, keys) = signed_fixture();
        envelope.payload = STANDARD.encode(br#"{"schemaVersion":1,"kind":"tampered"}"#);
        assert!(verify_json_envelope::<Value>(&envelope, &keys)
            .unwrap_err()
            .contains("verification failed"));
    }

    #[test]
    fn unknown_key_and_algorithm_fail_closed() {
        let (mut envelope, _) = signed_fixture();
        let empty = TrustedKeySet::from_entries([]);
        assert!(verify_json_envelope::<Value>(&envelope, &empty)
            .unwrap_err()
            .contains("unknown key"));

        let (_, keys) = signed_fixture();
        envelope.algorithm = "none".to_string();
        assert!(verify_json_envelope::<Value>(&envelope, &keys)
            .unwrap_err()
            .contains("algorithm"));
    }
}
