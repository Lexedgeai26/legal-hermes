//! Local, non-identifying hardware inventory for Private AI setup.
//!
//! This module deliberately avoids serial numbers, device IDs, usernames and
//! personal paths. llmfit adds model-fit and accelerator detail later; this
//! inventory remains authoritative for OS, memory, selected-volume capacity
//! and whether a runtime is already listening on the standard loopback port.

use std::path::Path;
use std::time::Duration;

use serde::Serialize;
use sysinfo::{Disks, System};

use crate::private_ai::{validate_private_ai_runtime_config, RuntimeConfig};

const HARDWARE_SCHEMA_VERSION: u32 = 1;
const DEFAULT_OLLAMA_PORT: u16 = 11_434;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HardwareInventory {
    pub schema_version: u32,
    pub os: OsInventory,
    pub cpu: CpuInventory,
    pub memory: MemoryInventory,
    pub gpus: Vec<GpuInventory>,
    pub storage: Vec<StorageInventory>,
    pub power: PowerInventory,
    pub existing_runtime: ExistingRuntimeInventory,
}

#[derive(Debug, Clone, Serialize)]
pub struct OsInventory {
    pub name: String,
    pub version: String,
    pub build: String,
    pub arch: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CpuInventory {
    pub vendor: String,
    pub model: String,
    pub physical_cores: usize,
    pub logical_cores: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryInventory {
    pub total_gb: f64,
    pub available_gb: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuInventory {
    pub vendor: String,
    pub model: String,
    pub dedicated_vram_gb: f64,
    pub driver_version: Option<String>,
    pub backend: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageInventory {
    /// Volume/mount root only. Never a user-selected child path.
    pub volume: String,
    pub free_gb: f64,
    #[serde(rename = "type")]
    pub storage_type: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PowerInventory {
    pub is_laptop: bool,
    pub on_battery: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExistingRuntimeInventory {
    pub found: bool,
    pub version: Option<String>,
    pub port: Option<u16>,
    pub managed_by_product: bool,
    /// Models the detected runtime already holds, each interrogated for the
    /// context window and tool capability that decide reuse. Empty when no
    /// runtime was found, when it holds nothing, or when enumeration failed —
    /// all ordinary outcomes, not errors.
    #[serde(default)]
    pub models: Vec<DetectedModel>,
    /// Why discovery stopped short, when it did. Surfaced so a user whose
    /// runtime was skipped is told why instead of silently downloading again.
    #[serde(default)]
    pub scan_note: Option<String>,
}

/// One model observed in a detected runtime.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedModel {
    pub tag: String,
    pub digest: String,
    pub size_bytes: u64,
    pub context_length: Option<u64>,
    pub supports_tools: bool,
    pub capabilities_known: bool,
    /// Set when `/api/show` refused this particular model. Cloud-hosted entries
    /// answer 410 and a model removed mid-scan answers 404, so this is a
    /// per-model note and never aborts the sweep.
    pub describe_error: Option<String>,
}

#[tauri::command]
pub async fn detect_private_ai_hardware() -> Result<HardwareInventory, String> {
    let mut system = System::new_all();
    system.refresh_all();

    let cpus = system.cpus();
    let first_cpu = cpus.first();
    let logical_cores = cpus.len().max(1);
    let physical_cores = System::physical_core_count()
        .unwrap_or(logical_cores)
        .max(1);
    let total_gb = bytes_to_gb(system.total_memory());
    let available_gb = bytes_to_gb(system.available_memory()).min(total_gb);

    let mut disks = Disks::new_with_refreshed_list();
    disks.refresh(true);
    let storage = disks
        .list()
        .iter()
        .filter_map(|disk| {
            let mount = disk.mount_point();
            safe_volume_label(mount).map(|volume| StorageInventory {
                volume,
                free_gb: bytes_to_gb(disk.available_space()),
                storage_type: format!("{:?}", disk.kind()).to_ascii_lowercase(),
            })
        })
        .collect();

    Ok(HardwareInventory {
        schema_version: HARDWARE_SCHEMA_VERSION,
        os: OsInventory {
            name: System::name().unwrap_or_else(|| std::env::consts::OS.to_string()),
            version: System::os_version().unwrap_or_else(|| "unknown".to_string()),
            build: System::kernel_version().unwrap_or_default(),
            arch: normalized_arch(),
        },
        cpu: CpuInventory {
            vendor: first_cpu
                .map(|cpu| cpu.vendor_id().trim().to_string())
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| "unknown".to_string()),
            model: first_cpu
                .map(|cpu| cpu.brand().trim().to_string())
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| "unknown".to_string()),
            physical_cores,
            logical_cores,
        },
        memory: MemoryInventory {
            total_gb,
            available_gb,
        },
        gpus: conservative_native_gpu_inventory(),
        storage,
        power: PowerInventory {
            // Detailed power state is a soft scoring input and is deliberately
            // unknown/false until a platform adapter can prove it.
            is_laptop: false,
            on_battery: false,
        },
        existing_runtime: probe_default_ollama().await,
    })
}

fn bytes_to_gb(bytes: u64) -> f64 {
    ((bytes as f64 / 1_073_741_824.0) * 10.0).round() / 10.0
}

fn normalized_arch() -> String {
    match std::env::consts::ARCH {
        "x86_64" => "x64".to_string(),
        "aarch64" => "arm64".to_string(),
        other => other.to_string(),
    }
}

fn safe_volume_label(path: &Path) -> Option<String> {
    let value = path.to_string_lossy();
    if value.is_empty() {
        return None;
    }
    #[cfg(target_os = "windows")]
    {
        return path
            .components()
            .next()
            .map(|component| component.as_os_str().to_string_lossy().into_owned());
    }
    #[cfg(not(target_os = "windows"))]
    {
        if value == "/" || value.starts_with("/System/Volumes/") || value.starts_with("/Volumes/") {
            Some(value.into_owned())
        } else {
            // Avoid exposing mounts nested below a user's home directory.
            None
        }
    }
}

fn conservative_native_gpu_inventory() -> Vec<GpuInventory> {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        return vec![GpuInventory {
            vendor: "Apple".to_string(),
            model: "Apple Silicon (shared memory)".to_string(),
            dedicated_vram_gb: 0.0,
            driver_version: None,
            backend: Some("metal".to_string()),
        }];
    }
    #[allow(unreachable_code)]
    Vec::new()
}

/// Total time the model sweep may take, however many models are installed.
/// A developer machine can hold dozens; interrogating each one serially with no
/// ceiling would hang the analysis screen behind a progress state that never
/// resolves. Exceeding the budget yields a partial list plus a note, which is
/// strictly better than a stall.
const MODEL_SCAN_BUDGET: Duration = Duration::from_secs(20);
/// Upper bound on models interrogated, so a pathological store cannot blow the
/// budget check's granularity.
const MODEL_SCAN_LIMIT: usize = 60;

async fn probe_default_ollama() -> ExistingRuntimeInventory {
    let port = match discover_runtime_target() {
        Ok(port) => port,
        Err(note) => {
            return ExistingRuntimeInventory {
                scan_note: note,
                ..no_runtime()
            }
        }
    };
    let base_url = format!("http://127.0.0.1:{port}");
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_millis(1_500))
        .no_proxy()
        .build()
    {
        Ok(client) => client,
        Err(_) => return no_runtime(),
    };
    let response = match client.get(format!("{base_url}/api/version")).send().await {
        Ok(response) if response.status().is_success() => response,
        _ => return no_runtime(),
    };
    let version = response
        .text()
        .await
        .ok()
        .and_then(|body| serde_json::from_str::<serde_json::Value>(&body).ok())
        .and_then(|body| {
            body.get("version")
                .and_then(|value| value.as_str())
                .map(str::to_string)
        });

    let (models, scan_note) = sweep_models(&base_url).await;

    ExistingRuntimeInventory {
        found: true,
        version,
        port: Some(port),
        managed_by_product: configured_runtime_is_managed(&base_url),
        models,
        scan_note,
    }
}

/// Enumerate and interrogate what the detected runtime holds.
///
/// Every failure mode here is non-fatal by design. A runtime that cannot list
/// its models, a model that cannot be described, and a sweep that runs out of
/// time all degrade to "fewer reuse candidates" — never to a failed hardware
/// analysis, because Private AI must remain installable the ordinary way on a
/// machine whose existing Ollama is in any state at all.
async fn sweep_models(base_url: &str) -> (Vec<DetectedModel>, Option<String>) {
    let client = match crate::ollama_api::OllamaClient::new(base_url) {
        Ok(client) => client,
        Err(_) => return (Vec::new(), None),
    };
    let installed = match client.installed_models_detailed().await {
        Ok(installed) => installed,
        Err(_) => {
            return (
                Vec::new(),
                Some("An existing Ollama was found but its model list could not be read".to_string()),
            )
        }
    };
    if installed.is_empty() {
        return (Vec::new(), None);
    }

    let total = installed.len();
    let deadline = std::time::Instant::now() + MODEL_SCAN_BUDGET;
    let mut models = Vec::new();
    let mut truncated = false;

    for entry in installed.into_iter().take(MODEL_SCAN_LIMIT) {
        if std::time::Instant::now() >= deadline {
            truncated = true;
            break;
        }
        let described = client.show_model(&entry.name).await;
        models.push(match described {
            Ok(detail) => DetectedModel {
                tag: entry.name,
                digest: entry.digest,
                size_bytes: entry.size,
                context_length: detail.context_length,
                supports_tools: detail.supports_tools,
                capabilities_known: detail.capabilities_known,
                describe_error: None,
            },
            Err(err) => DetectedModel {
                tag: entry.name,
                digest: entry.digest,
                size_bytes: entry.size,
                context_length: None,
                supports_tools: false,
                capabilities_known: false,
                describe_error: Some(err),
            },
        });
    }

    let note = if truncated || total > MODEL_SCAN_LIMIT {
        Some(format!(
            "Checked {} of {total} installed models before the time limit",
            models.len()
        ))
    } else {
        None
    };
    (models, note)
}

fn no_runtime() -> ExistingRuntimeInventory {
    ExistingRuntimeInventory {
        found: false,
        version: None,
        port: None,
        managed_by_product: false,
        models: Vec::new(),
        scan_note: None,
    }
}

/// Where to look for an already-running Ollama.
///
/// `OLLAMA_HOST` is the only supported way to move Ollama off its default port,
/// so honouring it is what makes detection work on machines that are not the
/// default case — otherwise we miss the runtime entirely and download several
/// gigabytes the user already has.
///
/// A non-loopback `OLLAMA_HOST` is deliberately NOT probed. Reusing a runtime on
/// another host would send matter documents off this machine, which is the
/// opposite of what someone choosing Private AI asked for. It is reported as a
/// note rather than silently ignored.
fn discover_runtime_target() -> Result<u16, Option<String>> {
    resolve_runtime_target(std::env::var("OLLAMA_HOST").ok().as_deref())
}

/// The rule itself, separated from the environment so every branch is testable
/// without mutating process-wide state from parallel tests.
fn resolve_runtime_target(ollama_host: Option<&str>) -> Result<u16, Option<String>> {
    let Some(raw) = ollama_host else {
        return Ok(DEFAULT_OLLAMA_PORT);
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(DEFAULT_OLLAMA_PORT);
    }

    // OLLAMA_HOST is written both bare ("127.0.0.1:11435") and as a URL.
    let with_scheme = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        format!("http://{trimmed}")
    };
    let Ok(url) = reqwest::Url::parse(&with_scheme) else {
        return Err(Some(format!(
            "OLLAMA_HOST is set to \"{trimmed}\", which could not be read as an address"
        )));
    };
    let host = url.host_str().unwrap_or_default();
    let is_loopback = matches!(host, "127.0.0.1" | "localhost" | "::1" | "[::1]" | "0.0.0.0");
    if !is_loopback {
        return Err(Some(format!(
            "An Ollama on {host} was not used: Private AI keeps documents on this computer, so only a local runtime can be reused"
        )));
    }
    Ok(url.port().unwrap_or(DEFAULT_OLLAMA_PORT))
}

fn configured_runtime_is_managed(base_url: &str) -> bool {
    let path = crate::paths::hermes_home()
        .join("private-ai")
        .join("config")
        .join("runtime.json");
    let Ok(contents) = std::fs::read_to_string(path) else {
        return false;
    };
    let Ok(config) = serde_json::from_str::<RuntimeConfig>(&contents) else {
        return false;
    };
    validate_private_ai_runtime_config(config.clone()).is_ok()
        && config.ollama.base_url.trim_end_matches('/') == base_url
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- runtime discovery -------------------------------------------------
    // Detection must work on machines that are not the default case: Ollama
    // moved to another port, or pointed at another host entirely.

    #[test]
    fn unset_ollama_host_uses_the_default_port() {
        assert_eq!(resolve_runtime_target(None), Ok(DEFAULT_OLLAMA_PORT));
        assert_eq!(resolve_runtime_target(Some("   ")), Ok(DEFAULT_OLLAMA_PORT));
    }

    #[test]
    fn a_custom_loopback_port_is_honoured() {
        // Missing this is what makes us re-download several gigabytes on a
        // machine whose Ollama simply is not on 11434.
        assert_eq!(resolve_runtime_target(Some("127.0.0.1:11435")), Ok(11435));
        assert_eq!(resolve_runtime_target(Some("http://127.0.0.1:9999")), Ok(9999));
        assert_eq!(resolve_runtime_target(Some("localhost:1234")), Ok(1234));
    }

    #[test]
    fn a_bare_loopback_host_without_a_port_falls_back_to_the_default() {
        assert_eq!(resolve_runtime_target(Some("127.0.0.1")), Ok(DEFAULT_OLLAMA_PORT));
    }

    #[test]
    fn a_remote_ollama_is_refused_with_a_reason() {
        // Reusing a runtime on another machine would send matter documents off
        // this computer — the opposite of what Private AI promises. Refusing
        // silently would leave the user wondering why their server was ignored.
        let outcome = resolve_runtime_target(Some("http://192.168.1.50:11434"));
        let Err(Some(note)) = outcome else {
            panic!("a remote host must be refused with an explanation");
        };
        assert!(note.contains("192.168.1.50"));
        assert!(note.to_lowercase().contains("this computer"));
    }

    #[test]
    fn an_unparseable_ollama_host_is_reported_rather_than_crashing() {
        let outcome = resolve_runtime_target(Some("::::not a url::::"));
        assert!(matches!(outcome, Err(Some(_))));
    }

    #[test]
    fn converts_bytes_to_binary_gigabytes() {
        assert_eq!(bytes_to_gb(1_073_741_824), 1.0);
        assert_eq!(bytes_to_gb(16 * 1_073_741_824), 16.0);
    }

    #[test]
    fn architecture_is_normalized_for_supported_targets() {
        assert!(!normalized_arch().is_empty());
        if cfg!(target_arch = "aarch64") {
            assert_eq!(normalized_arch(), "arm64");
        }
    }

    #[tokio::test]
    async fn local_inventory_has_safe_minimums() {
        let inventory = detect_private_ai_hardware().await.unwrap();
        assert_eq!(inventory.schema_version, 1);
        assert!(inventory.cpu.logical_cores >= 1);
        assert!(inventory.cpu.physical_cores >= 1);
        assert!(inventory.memory.total_gb > 0.0);
        assert!(inventory.memory.available_gb <= inventory.memory.total_gb);
        assert!(!inventory.storage.is_empty());
        assert!(inventory
            .storage
            .iter()
            .all(|volume| !volume.volume.contains("/Users/")));
    }
}
