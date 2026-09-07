//! Verified, bounded llmfit execution.
//!
//! The process runner cannot be constructed from renderer input. A caller must
//! first prove the executable's SHA-256 against an already signature-verified
//! component manifest. Signature verification and package acquisition are a
//! separate layer because production public keys/URLs are product inputs.

use std::fmt::Write as _;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde::Serialize;
use sha2::{Digest, Sha256};
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::Command;

use crate::private_ai::LlmFitReport;

const SUPPORTED_LLMFIT_VERSION: &str = "1.1.14";
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_STDOUT_BYTES: usize = 10_000_000;
const MAX_STDERR_BYTES: usize = 1_000_000;
const MODEL_LIMIT: &str = "50";

#[derive(Debug)]
pub struct VerifiedLlmFit {
    executable: PathBuf,
    version: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmFitAnalysis {
    pub llmfit_version: String,
    pub report: LlmFitReport,
}

/// Verify the binary hash supplied by an already signature-verified component
/// manifest. This function intentionally does not accept a URL or renderer
/// input and does not weaken the requirement for manifest signature checking.
pub fn verify_llmfit_binary(
    executable: &Path,
    version: &str,
    expected_sha256: &str,
) -> Result<VerifiedLlmFit, String> {
    if version != SUPPORTED_LLMFIT_VERSION {
        return Err(format!("Unsupported llmfit version {version}"));
    }
    if expected_sha256.len() != 64 || !expected_sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return Err("Invalid expected llmfit SHA-256".to_string());
    }
    let bytes =
        std::fs::read(executable).map_err(|_| "Verified llmfit binary is missing".to_string())?;
    let actual = hex_digest(Sha256::digest(bytes));
    if !actual.eq_ignore_ascii_case(expected_sha256) {
        return Err("llmfit SHA-256 verification failed".to_string());
    }
    Ok(VerifiedLlmFit {
        executable: executable.to_path_buf(),
        version: version.to_string(),
    })
}

pub async fn run_verified_llmfit(tool: &VerifiedLlmFit) -> Result<LlmFitAnalysis, String> {
    run_verified_llmfit_with_limits(tool, DEFAULT_TIMEOUT, MAX_STDOUT_BYTES, MAX_STDERR_BYTES).await
}

async fn run_verified_llmfit_with_limits(
    tool: &VerifiedLlmFit,
    timeout: Duration,
    stdout_limit: usize,
    stderr_limit: usize,
) -> Result<LlmFitAnalysis, String> {
    let working_directory = tool
        .executable
        .parent()
        .ok_or_else(|| "Verified llmfit path has no parent directory".to_string())?;
    let mut command = Command::new(&tool.executable);
    command
        .args(["recommend", "--json", "--limit", MODEL_LIMIT])
        .current_dir(working_directory)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }

    let mut child = command
        .spawn()
        .map_err(|_| "Unable to start verified hardware analysis".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Unable to capture llmfit output".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Unable to capture llmfit diagnostics".to_string())?;
    let stdout_task = tokio::spawn(read_bounded(stdout, stdout_limit, "output"));
    let stderr_task = tokio::spawn(read_bounded(stderr, stderr_limit, "diagnostics"));

    let status = match tokio::time::timeout(timeout, child.wait()).await {
        Ok(Ok(status)) => status,
        Ok(Err(_)) => return Err("Hardware analysis process failed".to_string()),
        Err(_) => {
            terminate_process_tree(&mut child).await;
            return Err("Hardware analysis timed out".to_string());
        }
    };
    let stdout = stdout_task
        .await
        .map_err(|_| "Unable to collect llmfit output".to_string())??;
    let stderr = stderr_task
        .await
        .map_err(|_| "Unable to collect llmfit diagnostics".to_string())??;
    if !status.success() {
        let safe_category = if stderr.is_empty() {
            "without diagnostics"
        } else {
            "with diagnostics"
        };
        return Err(format!(
            "Hardware analysis exited unsuccessfully {safe_category}"
        ));
    }
    let text = String::from_utf8(stdout)
        .map_err(|_| "Hardware analysis returned invalid UTF-8".to_string())?;
    let report = serde_json::from_str::<LlmFitReport>(&text)
        .map_err(|_| "Hardware analysis returned invalid JSON".to_string())?;
    if report.models.is_empty() {
        return Err("Hardware analysis returned no model results".to_string());
    }
    Ok(LlmFitAnalysis {
        llmfit_version: tool.version.clone(),
        report,
    })
}

async fn read_bounded<R: AsyncRead + Unpin>(
    reader: R,
    limit: usize,
    label: &str,
) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    reader
        .take(limit.saturating_add(1) as u64)
        .read_to_end(&mut bytes)
        .await
        .map_err(|_| format!("Unable to read llmfit {label}"))?;
    if bytes.len() > limit {
        return Err(format!("Hardware analysis {label} exceeded the safe limit"));
    }
    Ok(bytes)
}

async fn terminate_process_tree(child: &mut tokio::process::Child) {
    #[cfg(target_os = "windows")]
    if let Some(pid) = child.id() {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await;
    }
    let _ = child.kill().await;
    let _ = child.wait().await;
}

fn hex_digest(bytes: impl AsRef<[u8]>) -> String {
    let mut encoded = String::with_capacity(64);
    for byte in bytes.as_ref() {
        let _ = write!(&mut encoded, "{byte:02x}");
    }
    encoded
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn fixture_script(tag: &str, body: &str) -> PathBuf {
        let directory =
            std::env::temp_dir().join(format!("lexedge-llmfit-{tag}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("llmfit");
        std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
        let mut permissions = std::fs::metadata(&path).unwrap().permissions();
        permissions.set_mode(0o700);
        std::fs::set_permissions(&path, permissions).unwrap();
        path
    }

    fn verified(path: &Path) -> VerifiedLlmFit {
        let hash = hex_digest(Sha256::digest(std::fs::read(path).unwrap()));
        verify_llmfit_binary(path, SUPPORTED_LLMFIT_VERSION, &hash).unwrap()
    }

    #[test]
    fn hash_verification_rejects_tampering_and_unknown_versions() {
        let path = fixture_script("hash", "exit 0");
        assert!(verify_llmfit_binary(&path, SUPPORTED_LLMFIT_VERSION, &"0".repeat(64)).is_err());
        let hash = hex_digest(Sha256::digest(std::fs::read(&path).unwrap()));
        assert!(verify_llmfit_binary(&path, "9.9.9", &hash)
            .unwrap_err()
            .contains("Unsupported"));
    }

    #[tokio::test]
    async fn fixed_command_parses_supported_json() {
        let fixture = include_str!("../test-fixtures/llmfit/v1.1.14/recommend.json");
        let escaped = fixture.replace('\'', "'\\''");
        let path = fixture_script("valid", &format!("printf '%s' '{escaped}'"));
        let analysis = run_verified_llmfit(&verified(&path)).await.unwrap();
        assert_eq!(analysis.llmfit_version, SUPPORTED_LLMFIT_VERSION);
        assert_eq!(analysis.report.models.len(), 2);
    }

    #[tokio::test]
    async fn timeout_is_bounded() {
        let path = fixture_script("timeout", "sleep 2");
        let error = run_verified_llmfit_with_limits(
            &verified(&path),
            Duration::from_millis(25),
            MAX_STDOUT_BYTES,
            MAX_STDERR_BYTES,
        )
        .await
        .unwrap_err();
        assert!(error.contains("timed out"));
    }

    #[tokio::test]
    async fn oversized_output_is_rejected() {
        let path = fixture_script("oversize", "printf '1234567890'");
        let error = run_verified_llmfit_with_limits(
            &verified(&path),
            Duration::from_secs(2),
            5,
            MAX_STDERR_BYTES,
        )
        .await
        .unwrap_err();
        assert!(error.contains("safe limit"));
    }

    #[tokio::test]
    async fn invalid_json_is_rejected() {
        let path = fixture_script("invalid", "printf 'not-json'");
        let error = run_verified_llmfit_with_limits(
            &verified(&path),
            Duration::from_secs(2),
            MAX_STDOUT_BYTES,
            MAX_STDERR_BYTES,
        )
        .await
        .unwrap_err();
        assert!(error.contains("invalid JSON"));
    }
}
