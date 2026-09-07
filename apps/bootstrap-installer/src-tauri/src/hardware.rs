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

async fn probe_default_ollama() -> ExistingRuntimeInventory {
    let base_url = format!("http://127.0.0.1:{DEFAULT_OLLAMA_PORT}");
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

    ExistingRuntimeInventory {
        found: true,
        version,
        port: Some(DEFAULT_OLLAMA_PORT),
        managed_by_product: configured_runtime_is_managed(&base_url),
    }
}

fn no_runtime() -> ExistingRuntimeInventory {
    ExistingRuntimeInventory {
        found: false,
        version: None,
        port: None,
        managed_by_product: false,
    }
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
