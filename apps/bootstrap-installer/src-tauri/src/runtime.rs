//! Managed Private AI runtime (Ollama) lifecycle.
//!
//! Ownership rules this module enforces and never relaxes:
//!
//!   * A runtime we did not install is never modified, reconfigured, stopped
//!     or removed. We detect it, report it, and step around it by choosing a
//!     different loopback port.
//!   * Our managed runtime binds to loopback only, on a port we proved free.
//!   * Everything we own lives under `HERMES_HOME/private-ai` and is stamped
//!     with an ownership marker so repair and uninstall can be precise.
//!   * Cloud behaviour is disabled explicitly, never assumed off.
//!
//! Model acquisition and inference validation are separate layers. This module
//! owns process and configuration only.

use std::collections::BTreeMap;
use std::net::{Ipv4Addr, SocketAddrV4, TcpListener};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tokio::process::{Child, Command};

use crate::paths::hermes_home;
use crate::private_ai::{validate_private_ai_runtime_config, RuntimeConfig};

/// Ollama's documented default. We prefer it, but never assume it.
pub const DEFAULT_OLLAMA_PORT: u16 = 11_434;
/// How many ports above the preferred one we are willing to try.
const PORT_SCAN_LIMIT: u16 = 100;
const OWNERSHIP_MARKER_VERSION: u32 = 1;
const MANAGED_MARKER_FILE: &str = ".lexedge-managed.json";

/// Stamped into every artifact we own. Matches the bundle identifier so an
/// operator can trace a stray directory back to this installer.
pub const OWNER_ID: &str = "ai.lexedge.hermes.unified.setup";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/// Every path the managed runtime is allowed to touch. Nothing outside this
/// tree is ours, so nothing outside it may be repaired or deleted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedRuntimePaths {
    pub root: PathBuf,
    pub runtime_dir: PathBuf,
    pub models_dir: PathBuf,
    pub config_dir: PathBuf,
    pub config_file: PathBuf,
    pub marker_file: PathBuf,
}

impl ManagedRuntimePaths {
    /// Resolve against the live `HERMES_HOME`.
    pub fn resolve() -> Self {
        Self::under(&hermes_home())
    }

    /// Resolve against an explicit home. Tests use this to stay off the real
    /// user profile; it is also how a sandboxed install is exercised.
    pub fn under(home: &Path) -> Self {
        let root = home.join("private-ai");
        Self {
            runtime_dir: root.join("runtime"),
            models_dir: root.join("models"),
            config_dir: root.join("config"),
            config_file: root.join("config").join("runtime.json"),
            marker_file: root.join(MANAGED_MARKER_FILE),
            root,
        }
    }

    /// The managed Ollama executable. Never the one on `PATH` — that one may
    /// belong to the user.
    pub fn executable(&self) -> PathBuf {
        self.runtime_dir.join(if cfg!(target_os = "windows") {
            "ollama.exe"
        } else {
            "ollama"
        })
    }

    /// True when `candidate` lies inside the tree we own. Used as the guard on
    /// every destructive operation.
    pub fn owns(&self, candidate: &Path) -> bool {
        let Ok(root) = self.root.canonicalize() else {
            return candidate.starts_with(&self.root);
        };
        match candidate.canonicalize() {
            Ok(path) => path.starts_with(&root),
            // A path that does not exist yet is ours if its lexical form is
            // under the root. `..` segments are rejected outright.
            Err(_) => {
                !candidate
                    .components()
                    .any(|c| matches!(c, std::path::Component::ParentDir))
                    && candidate.starts_with(&self.root)
            }
        }
    }

    pub fn create_directories(&self) -> Result<(), String> {
        for dir in [&self.root, &self.runtime_dir, &self.models_dir, &self.config_dir] {
            std::fs::create_dir_all(dir)
                .map_err(|_| "Unable to create the managed runtime directories".to_string())?;
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Ownership marker
// ---------------------------------------------------------------------------

/// Written beside the managed runtime so repair and uninstall can prove a
/// directory is ours before touching it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OwnershipMarker {
    pub schema_version: u32,
    pub owner: String,
    pub runtime_version: String,
    pub installed_at: String,
}

impl OwnershipMarker {
    pub fn new(runtime_version: &str) -> Self {
        Self {
            schema_version: OWNERSHIP_MARKER_VERSION,
            owner: OWNER_ID.to_string(),
            runtime_version: runtime_version.to_string(),
            installed_at: rfc3339_utc_now(),
        }
    }

    /// Fails closed: an unreadable, unparsable, foreign or future-versioned
    /// marker means "not ours", never "probably ours".
    pub fn is_ours(&self) -> bool {
        self.schema_version == OWNERSHIP_MARKER_VERSION && self.owner == OWNER_ID
    }
}

pub fn write_ownership_marker(
    paths: &ManagedRuntimePaths,
    runtime_version: &str,
) -> Result<OwnershipMarker, String> {
    paths.create_directories()?;
    let marker = OwnershipMarker::new(runtime_version);
    let encoded = serde_json::to_vec_pretty(&marker)
        .map_err(|_| "Unable to encode the runtime ownership marker".to_string())?;
    write_atomic(&paths.marker_file, &encoded)?;
    Ok(marker)
}

pub fn read_ownership_marker(paths: &ManagedRuntimePaths) -> Option<OwnershipMarker> {
    let bytes = std::fs::read(&paths.marker_file).ok()?;
    let marker = serde_json::from_slice::<OwnershipMarker>(&bytes).ok()?;
    marker.is_ours().then_some(marker)
}

/// The single question every destructive path must ask first.
pub fn runtime_is_managed_by_us(paths: &ManagedRuntimePaths) -> bool {
    read_ownership_marker(paths).is_some()
}

// ---------------------------------------------------------------------------
// Port selection
// ---------------------------------------------------------------------------

/// A port is free only if we can actually bind it on loopback right now.
/// Probing with a connect() would race and would also mistake a firewalled
/// listener for a free port.
pub fn loopback_port_is_free(port: u16) -> bool {
    TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, port)).is_ok()
}

/// Prefer `preferred`; otherwise take the next free port above it. We never
/// evict whatever already holds the preferred port — that process may be the
/// user's own Ollama and is none of our business.
pub fn choose_loopback_port(preferred: u16) -> Result<u16, String> {
    if loopback_port_is_free(preferred) {
        return Ok(preferred);
    }
    for offset in 1..=PORT_SCAN_LIMIT {
        let Some(candidate) = preferred.checked_add(offset) else {
            break;
        };
        if loopback_port_is_free(candidate) {
            return Ok(candidate);
        }
    }
    Err("No free loopback port is available for the managed runtime".to_string())
}

pub fn base_url(port: u16) -> String {
    format!("http://127.0.0.1:{port}")
}

// ---------------------------------------------------------------------------
// Process environment
// ---------------------------------------------------------------------------

/// Environment variables that could route inference off this machine or leak
/// state into the user's own Ollama profile. Removed from the managed child.
pub const CLEARED_ENVIRONMENT: &[&str] = &[
    "OLLAMA_API_KEY",
    "OLLAMA_CLOUD",
    "OLLAMA_CLOUD_HOST",
    "OLLAMA_PROXY_URL",
    "OLLAMA_TMPDIR",
];

// NOTE: HTTP_PROXY/HTTPS_PROXY are deliberately NOT cleared. The managed
// runtime needs the system proxy to reach the model registry on an enterprise
// network (PRD 23). Loopback inference is kept off the proxy by NO_PROXY
// below, and our own client sets `.no_proxy()` independently.

/// The environment the managed runtime runs under. Loopback-only binding and
/// a private model directory are set here, not left to Ollama's defaults.
pub fn managed_environment(paths: &ManagedRuntimePaths, port: u16) -> BTreeMap<String, String> {
    let mut env = BTreeMap::new();
    // Binding host:port. Ollama binds exactly what OLLAMA_HOST names, so an
    // explicit 127.0.0.1 is what keeps this off every other interface.
    env.insert("OLLAMA_HOST".to_string(), format!("127.0.0.1:{port}"));
    // Our own model store, so we never read or write the user's ~/.ollama.
    env.insert(
        "OLLAMA_MODELS".to_string(),
        paths.models_dir.to_string_lossy().into_owned(),
    );
    // No browser origin may talk to this server.
    env.insert("OLLAMA_ORIGINS".to_string(), String::new());
    // PRD 23: never route localhost inference through a proxy, while leaving
    // the system proxy intact for registry downloads.
    env.insert(
        "NO_PROXY".to_string(),
        "127.0.0.1,localhost,::1".to_string(),
    );
    // Private-only mode. PRD 15.2 requires this explicitly rather than
    // relying on the absence of cloud credentials.
    env.insert("OLLAMA_NO_CLOUD".to_string(), "1".to_string());
    // Do not persist prompt history; client documents must not reach disk here.
    env.insert("OLLAMA_NOHISTORY".to_string(), "1".to_string());
    // Keep blob GC from touching partially-downloaded models on resume.
    env.insert("OLLAMA_NOPRUNE".to_string(), "1".to_string());
    env
}

/// True when the environment cannot reach anything but loopback. Asserted in
/// tests and re-checked before the runtime is marked validated.
pub fn environment_is_loopback_only(env: &BTreeMap<String, String>) -> bool {
    env.get("OLLAMA_HOST")
        .is_some_and(|host| host.starts_with("127.0.0.1:"))
        && env.get("OLLAMA_ORIGINS").is_some_and(|o| o.is_empty())
        && env.get("OLLAMA_NO_CLOUD").is_some_and(|v| v == "1")
}

// ---------------------------------------------------------------------------
// Process supervision
// ---------------------------------------------------------------------------

/// Launch the managed runtime. Refuses to launch anything but our own verified
/// executable, and refuses a port we have not proved free.
pub async fn spawn_managed_runtime(
    paths: &ManagedRuntimePaths,
    port: u16,
) -> Result<Child, String> {
    let executable = paths.executable();
    if !paths.owns(&executable) {
        return Err("Refusing to launch a runtime outside the managed directory".to_string());
    }
    if !executable.is_file() {
        return Err("The managed runtime executable is missing".to_string());
    }
    if !runtime_is_managed_by_us(paths) {
        return Err("Refusing to launch a runtime without a valid ownership marker".to_string());
    }
    paths.create_directories()?;

    let mut command = Command::new(&executable);
    command
        .arg("serve")
        .current_dir(&paths.runtime_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    for key in CLEARED_ENVIRONMENT {
        command.env_remove(key);
    }
    for (key, value) in managed_environment(paths, port) {
        command.env(key, value);
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }

    command
        .spawn()
        .map_err(|_| "Unable to start the managed Private AI runtime".to_string())
}

// ---------------------------------------------------------------------------
// Runtime configuration
// ---------------------------------------------------------------------------

/// Validate, then write `runtime.json` atomically. Validation runs first so an
/// invalid configuration can never briefly exist on disk.
pub fn write_runtime_config_atomic(
    paths: &ManagedRuntimePaths,
    config: &RuntimeConfig,
) -> Result<(), String> {
    validate_private_ai_runtime_config(config.clone())?;
    if !paths.owns(&paths.config_file) {
        return Err("Refusing to write runtime configuration outside the managed directory"
            .to_string());
    }
    paths.create_directories()?;
    let encoded = serde_json::to_vec_pretty(config)
        .map_err(|_| "Unable to encode the runtime configuration".to_string())?;
    write_atomic(&paths.config_file, &encoded)
}

/// Read back and re-validate. Configuration on disk is a separate trust
/// boundary even when we wrote it ourselves.
pub fn read_runtime_config(paths: &ManagedRuntimePaths) -> Result<RuntimeConfig, String> {
    let bytes = std::fs::read(&paths.config_file)
        .map_err(|_| "The managed runtime configuration is missing".to_string())?;
    let config = serde_json::from_slice::<RuntimeConfig>(&bytes)
        .map_err(|_| "The managed runtime configuration is not readable".to_string())?;
    validate_private_ai_runtime_config(config.clone())?;
    Ok(config)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Write via a sibling temp file and rename. A crash mid-write leaves either
/// the old file or the new one, never a truncated one.
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Target path has no parent directory".to_string())?;
    std::fs::create_dir_all(parent)
        .map_err(|_| "Unable to create the target directory".to_string())?;
    let temp = parent.join(format!(
        ".{}.{}.tmp",
        path.file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "runtime".to_string()),
        uuid::Uuid::new_v4()
    ));
    std::fs::write(&temp, bytes).map_err(|_| "Unable to stage the file write".to_string())?;
    match std::fs::rename(&temp, path) {
        Ok(()) => Ok(()),
        Err(err) => {
            let _ = std::fs::remove_file(&temp);
            Err(format!("Unable to commit the file write: {}", err.kind()))
        }
    }
}

/// RFC 3339 UTC without pulling in a date library. Civil-from-days follows
/// Howard Hinnant's algorithm.
pub fn rfc3339_utc_now() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    rfc3339_from_unix(seconds)
}

fn rfc3339_from_unix(seconds: i64) -> String {
    let days = seconds.div_euclid(86_400);
    let time_of_day = seconds.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    let (hour, minute, second) = (
        time_of_day / 3_600,
        (time_of_day % 3_600) / 60,
        time_of_day % 60,
    );
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
}

fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::private_ai::{
        OllamaRuntimeConfig, RuntimeCatalogConfig, RuntimeModelsConfig, RuntimePrivacyConfig,
    };

    fn temp_home(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("lexedge-runtime-{tag}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn valid_config(port: u16) -> RuntimeConfig {
        RuntimeConfig {
            schema_version: 1,
            managed: true,
            ollama: OllamaRuntimeConfig {
                base_url: base_url(port),
                runtime_version: "0.12.0".to_string(),
                cloud_disabled: true,
                managed_process: true,
                runtime_path: "private-ai/runtime/ollama".to_string(),
                models_path: "private-ai/models".to_string(),
            },
            models: RuntimeModelsConfig {
                profile_id: "legal-standard".to_string(),
                generation: "legal-test:9b".to_string(),
                embedding: "embedding-test:300m".to_string(),
                context_tokens: 8192,
            },
            catalog: RuntimeCatalogConfig {
                id: "legal-desktop".to_string(),
                version: "test".to_string(),
            },
            privacy: RuntimePrivacyConfig {
                bind_localhost_only: true,
                telemetry_enabled: false,
            },
            installed_at: Some(rfc3339_from_unix(1_767_225_600)),
            validated_at: None,
        }
    }

    #[test]
    fn managed_paths_stay_under_private_ai() {
        let home = temp_home("paths");
        let paths = ManagedRuntimePaths::under(&home);
        assert_eq!(paths.root, home.join("private-ai"));
        assert!(paths.models_dir.starts_with(&paths.root));
        assert!(paths.config_file.starts_with(&paths.root));
        assert!(paths.executable().starts_with(&paths.runtime_dir));
    }

    #[test]
    fn ownership_guard_rejects_paths_outside_the_managed_tree() {
        let home = temp_home("owns");
        let paths = ManagedRuntimePaths::under(&home);
        paths.create_directories().unwrap();

        assert!(paths.owns(&paths.executable()));
        assert!(paths.owns(&paths.config_file));
        // The user's own Ollama, and an escape attempt, are both refused.
        assert!(!paths.owns(Path::new("/usr/local/bin/ollama")));
        assert!(!paths.owns(&home.join("private-ai/../../elsewhere")));
    }

    #[test]
    fn ownership_marker_round_trips_and_foreign_markers_fail_closed() {
        let home = temp_home("marker");
        let paths = ManagedRuntimePaths::under(&home);
        assert!(!runtime_is_managed_by_us(&paths));

        let written = write_ownership_marker(&paths, "0.12.0").unwrap();
        assert!(written.is_ours());
        assert!(runtime_is_managed_by_us(&paths));
        assert_eq!(read_ownership_marker(&paths).unwrap().runtime_version, "0.12.0");

        // A marker from another product must never read as ours.
        std::fs::write(
            &paths.marker_file,
            br#"{"schemaVersion":1,"owner":"com.example.other","runtimeVersion":"1","installedAt":"2026-01-01T00:00:00Z"}"#,
        )
        .unwrap();
        assert!(!runtime_is_managed_by_us(&paths));

        // So must a corrupt one.
        std::fs::write(&paths.marker_file, b"not json").unwrap();
        assert!(!runtime_is_managed_by_us(&paths));
    }

    #[test]
    fn occupied_port_is_stepped_around_not_evicted() {
        // Hold a port the way a user's own Ollama would.
        let squatter = TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0)).unwrap();
        let taken = squatter.local_addr().unwrap().port();

        assert!(!loopback_port_is_free(taken));
        let chosen = choose_loopback_port(taken).unwrap();
        assert_ne!(chosen, taken, "must not select the occupied port");
        assert!(chosen > taken);
        // The squatter is still listening: we stepped around it.
        assert!(squatter.local_addr().is_ok());
    }

    #[test]
    fn free_port_is_preferred_when_available() {
        let probe = TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = probe.local_addr().unwrap().port();
        drop(probe);
        assert_eq!(choose_loopback_port(port).unwrap(), port);
    }

    #[test]
    fn managed_environment_binds_loopback_and_isolates_model_storage() {
        let home = temp_home("env");
        let paths = ManagedRuntimePaths::under(&home);
        let env = managed_environment(&paths, 11_435);

        assert_eq!(env.get("OLLAMA_HOST").unwrap(), "127.0.0.1:11435");
        assert!(environment_is_loopback_only(&env));
        assert_eq!(
            env.get("OLLAMA_MODELS").unwrap(),
            &paths.models_dir.to_string_lossy().into_owned()
        );
        // Never the user's default store.
        assert!(!env.get("OLLAMA_MODELS").unwrap().ends_with(".ollama/models"));
        assert_eq!(env.get("OLLAMA_NOHISTORY").unwrap(), "1");
        // PRD 15.2: private-only mode is set explicitly.
        assert_eq!(env.get("OLLAMA_NO_CLOUD").unwrap(), "1");
        assert!(env.get("OLLAMA_ORIGINS").unwrap().is_empty());
    }

    #[test]
    fn environment_rejects_non_loopback_binding() {
        let home = temp_home("env-bad");
        let paths = ManagedRuntimePaths::under(&home);
        let mut env = managed_environment(&paths, 11_434);
        env.insert("OLLAMA_HOST".to_string(), "0.0.0.0:11434".to_string());
        assert!(!environment_is_loopback_only(&env));
    }

    #[test]
    fn cleared_environment_covers_cloud_credentials() {
        for key in ["OLLAMA_API_KEY", "OLLAMA_CLOUD", "OLLAMA_CLOUD_HOST"] {
            assert!(CLEARED_ENVIRONMENT.contains(&key), "{key} must be cleared");
        }
    }

    #[test]
    fn system_proxy_survives_for_downloads_but_never_for_loopback() {
        // PRD 23: enterprise proxies must still work for registry downloads.
        for key in ["HTTP_PROXY", "HTTPS_PROXY"] {
            assert!(
                !CLEARED_ENVIRONMENT.contains(&key),
                "{key} must survive so model pulls work behind a proxy"
            );
        }
        let home = temp_home("proxy");
        let paths = ManagedRuntimePaths::under(&home);
        let env = managed_environment(&paths, 11_434);
        let no_proxy = env.get("NO_PROXY").expect("NO_PROXY must be set");
        assert!(no_proxy.contains("127.0.0.1"));
        assert!(no_proxy.contains("localhost"));
    }

    #[test]
    fn runtime_config_is_written_atomically_and_reads_back() {
        let home = temp_home("config");
        let paths = ManagedRuntimePaths::under(&home);
        let config = valid_config(11_434);

        write_runtime_config_atomic(&paths, &config).unwrap();
        assert_eq!(read_runtime_config(&paths).unwrap(), config);

        // No temp files left behind.
        let leftovers: Vec<_> = std::fs::read_dir(&paths.config_dir)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "atomic write must not leave temp files");
    }

    #[test]
    fn invalid_runtime_config_is_never_written() {
        let home = temp_home("config-bad");
        let paths = ManagedRuntimePaths::under(&home);

        let mut config = valid_config(11_434);
        config.ollama.base_url = "http://0.0.0.0:11434".to_string();
        assert!(write_runtime_config_atomic(&paths, &config).is_err());
        assert!(!paths.config_file.exists(), "nothing may reach disk");

        let mut cloud = valid_config(11_434);
        cloud.ollama.cloud_disabled = false;
        assert!(write_runtime_config_atomic(&paths, &cloud).is_err());
        assert!(!paths.config_file.exists());
    }

    #[tokio::test]
    async fn spawn_refuses_without_executable_or_marker() {
        let home = temp_home("spawn");
        let paths = ManagedRuntimePaths::under(&home);
        paths.create_directories().unwrap();

        // No executable yet.
        let err = spawn_managed_runtime(&paths, 11_434).await.unwrap_err();
        assert!(err.contains("missing"), "got: {err}");

        // Executable present but unmarked: still refused.
        std::fs::write(paths.executable(), b"#!/bin/sh\nexit 0\n").unwrap();
        let err = spawn_managed_runtime(&paths, 11_434).await.unwrap_err();
        assert!(err.contains("ownership marker"), "got: {err}");
    }

    #[test]
    fn timestamps_are_rfc3339_utc() {
        assert_eq!(rfc3339_from_unix(0), "1970-01-01T00:00:00Z");
        assert_eq!(rfc3339_from_unix(1_767_225_600), "2026-01-01T00:00:00Z");
        assert!(rfc3339_utc_now().ends_with('Z'));
        assert_eq!(rfc3339_utc_now().len(), 20);
    }
}
