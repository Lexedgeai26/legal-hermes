//! Private AI installer contracts and deterministic recommendation engine.
//!
//! This module is deliberately side-effect free. It implements Slice 1 of the
//! unified-installer plan: parse supported llmfit output, intersect it with the
//! LexEdge catalogue and an optional entitlement, apply hard safety filters,
//! and return explainable recommendations. Downloads and process management
//! belong to later slices and must not be smuggled into recommendation logic.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

const SUPPORTED_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationRequest {
    pub hardware: NormalizedHardware,
    pub fit_report: Option<LlmFitReport>,
    pub catalogue: LegalModelCatalogue,
    /// `None` means the deployment has no entitlement gate. `Some([])` means
    /// the resolved entitlement allows no profiles.
    pub allowed_profiles: Option<Vec<String>>,
    pub free_disk_gb: f64,
    #[serde(default)]
    pub runtime_storage_gb: f64,
    #[serde(default)]
    pub embedding_storage_gb: f64,
    #[serde(default = "default_disk_headroom_gb")]
    pub disk_headroom_gb: f64,
}

fn default_disk_headroom_gb() -> f64 {
    5.0
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedHardware {
    pub total_ram_gb: f64,
    #[serde(default)]
    pub available_ram_gb: f64,
    #[serde(default)]
    pub gpu_vram_gb: f64,
    pub backend: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LlmFitReport {
    #[serde(default)]
    pub models: Vec<LlmFitModel>,
    pub system: Option<LlmFitSystem>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LlmFitSystem {
    pub total_ram_gb: Option<f64>,
    pub gpu_vram_gb: Option<f64>,
    pub backend: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LlmFitModel {
    pub name: String,
    pub ollama_name: Option<String>,
    pub best_quant: Option<String>,
    pub fit_level: Option<String>,
    pub memory_required_gb: Option<f64>,
    pub estimated_tps: Option<f64>,
    pub run_mode: Option<String>,
    pub runtime: Option<String>,
    pub effective_context_length: Option<u64>,
    pub disk_size_gb: Option<f64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegalModelCatalogue {
    pub schema_version: u32,
    pub id: String,
    pub version: String,
    #[serde(default)]
    pub profiles: Vec<LegalModelProfile>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegalModelProfile {
    pub id: String,
    pub friendly_name: String,
    pub ollama_model: String,
    #[serde(default)]
    pub llmfit_aliases: Vec<String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub retired: bool,
    pub minimum_ram_gb: f64,
    pub recommended_ram_gb: f64,
    #[serde(default)]
    pub minimum_vram_gb: f64,
    #[serde(default)]
    pub requires_gpu: bool,
    pub required_backend: Option<String>,
    pub download_size_gb: f64,
    pub operational_context_tokens: u64,
    pub target_tps: f64,
    pub legal_benchmark: LegalBenchmark,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Deserialize)]
pub struct LegalBenchmark {
    pub approved: bool,
    pub score: f64,
    pub version: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationResponse {
    pub catalogue_id: String,
    pub catalogue_version: String,
    pub used_conservative_fallback: bool,
    pub compatible: Vec<ModelRecommendation>,
    pub excluded: Vec<ExcludedProfile>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelRecommendation {
    pub profile_id: String,
    pub friendly_name: String,
    pub ollama_model: String,
    pub fit: String,
    pub execution_mode: String,
    pub quantization: Option<String>,
    pub runtime: Option<String>,
    pub estimated_tokens_per_second: Option<f64>,
    pub estimated_memory_gb: Option<f64>,
    pub download_size_gb: f64,
    pub operational_context_tokens: u64,
    pub final_score: f64,
    pub recommended: bool,
    pub reasons: Vec<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExcludedProfile {
    pub profile_id: String,
    pub friendly_name: String,
    pub reasons: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeConfig {
    pub schema_version: u32,
    pub managed: bool,
    pub ollama: OllamaRuntimeConfig,
    pub models: RuntimeModelsConfig,
    pub catalog: RuntimeCatalogConfig,
    pub privacy: RuntimePrivacyConfig,
    pub installed_at: Option<String>,
    pub validated_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OllamaRuntimeConfig {
    pub base_url: String,
    pub runtime_version: String,
    pub cloud_disabled: bool,
    pub managed_process: bool,
    pub runtime_path: String,
    pub models_path: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeModelsConfig {
    pub profile_id: String,
    pub generation: String,
    pub embedding: String,
    pub context_tokens: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct RuntimeCatalogConfig {
    pub id: String,
    pub version: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimePrivacyConfig {
    pub bind_localhost_only: bool,
    pub telemetry_enabled: bool,
}

/// Tauri boundary for the future model-selection screen. Keeping the command
/// pure makes it safe to exercise before any downloads or configuration writes.
#[tauri::command]
pub fn recommend_private_ai_models(
    request: RecommendationRequest,
) -> Result<RecommendationResponse, String> {
    recommend_models(request)
}

/// Validate installer-authored runtime configuration before an atomic write.
/// Electron repeats this validation when loading the file because configuration
/// on disk crosses a separate trust boundary.
#[tauri::command]
pub fn validate_private_ai_runtime_config(config: RuntimeConfig) -> Result<(), String> {
    if config.schema_version != SUPPORTED_SCHEMA_VERSION {
        return Err(format!(
            "Unsupported runtime configuration schema version {}",
            config.schema_version
        ));
    }
    if !config.managed {
        return Err("Managed runtime configuration must set managed=true".to_string());
    }
    let base_url = reqwest::Url::parse(config.ollama.base_url.trim())
        .map_err(|_| "Managed runtime base URL is invalid".to_string())?;
    if base_url.scheme() != "http"
        || !matches!(
            base_url.host_str(),
            Some("127.0.0.1" | "::1" | "[::1]" | "localhost")
        )
        || base_url.port().is_none()
        || !base_url.username().is_empty()
        || base_url.password().is_some()
        || base_url.query().is_some()
        || base_url.fragment().is_some()
        || !matches!(base_url.path(), "" | "/")
    {
        return Err("Managed runtime host must be loopback-only".to_string());
    }
    if base_url.port().is_some_and(|port| port < 1024) {
        return Err("Managed runtime port must be between 1024 and 65535".to_string());
    }
    if !config.ollama.cloud_disabled {
        return Err("Managed Private AI runtime must disable Ollama cloud access".to_string());
    }
    if !config.ollama.managed_process {
        return Err("Managed runtime configuration must mark the process as managed".to_string());
    }
    if !config.privacy.bind_localhost_only {
        return Err("Managed runtime privacy must require loopback binding".to_string());
    }
    for (label, value) in [
        ("runtime version", config.ollama.runtime_version.as_str()),
        ("runtime path", config.ollama.runtime_path.as_str()),
        ("models path", config.ollama.models_path.as_str()),
        ("profile id", config.models.profile_id.as_str()),
        ("generation model", config.models.generation.as_str()),
        ("embedding model", config.models.embedding.as_str()),
        ("catalogue id", config.catalog.id.as_str()),
        ("catalogue version", config.catalog.version.as_str()),
    ] {
        if value.trim().is_empty() {
            return Err(format!("Managed runtime {label} cannot be empty"));
        }
    }
    if config.models.context_tokens == 0 {
        return Err("Managed runtime context tokens must be greater than zero".to_string());
    }
    for (label, model) in [
        ("generation model", config.models.generation.as_str()),
        ("embedding model", config.models.embedding.as_str()),
    ] {
        if !is_pinned_model_identity(model) {
            return Err(format!(
                "Managed runtime {label} must use an exact non-latest tag or digest"
            ));
        }
    }
    Ok(())
}

fn is_pinned_model_identity(value: &str) -> bool {
    let normalized = value.trim().to_ascii_lowercase();
    if normalized.is_empty() || normalized.ends_with(":latest") {
        return false;
    }
    normalized
        .split_once('@')
        .is_some_and(|(name, digest)| !name.is_empty() && !digest.is_empty())
        || normalized
            .rsplit_once(':')
            .is_some_and(|(name, tag)| !name.is_empty() && !tag.is_empty())
}

pub fn recommend_models(request: RecommendationRequest) -> Result<RecommendationResponse, String> {
    validate_request(&request)?;

    let entitlement = request
        .allowed_profiles
        .as_ref()
        .map(|values| values.iter().cloned().collect::<HashSet<_>>());
    let fit_index = build_fit_index(request.fit_report.as_ref());
    let fallback = request.fit_report.is_none();
    let mut compatible = Vec::new();
    let mut excluded = Vec::new();

    for profile in &request.catalogue.profiles {
        let mut hard_failures = Vec::new();

        if !profile.enabled {
            hard_failures.push("Profile is disabled by the catalogue".to_string());
        }
        if profile.retired {
            hard_failures.push("Profile is retired by the catalogue".to_string());
        }
        if !profile.legal_benchmark.approved {
            hard_failures.push("Profile has not passed the approved legal benchmark".to_string());
        }
        if let Some(allowed) = entitlement.as_ref() {
            if !allowed.contains(&profile.id) {
                hard_failures
                    .push("Profile is not included in the resolved entitlement".to_string());
            }
        }
        if request.hardware.total_ram_gb < profile.minimum_ram_gb {
            hard_failures.push(format!(
                "Requires at least {:.1} GB RAM; detected {:.1} GB",
                profile.minimum_ram_gb, request.hardware.total_ram_gb
            ));
        }
        if fallback && request.hardware.total_ram_gb < profile.recommended_ram_gb {
            hard_failures.push(format!(
                "Conservative fallback requires {:.1} GB recommended RAM; detected {:.1} GB",
                profile.recommended_ram_gb, request.hardware.total_ram_gb
            ));
        }
        if profile.requires_gpu && request.hardware.gpu_vram_gb < profile.minimum_vram_gb {
            hard_failures.push(format!(
                "Requires at least {:.1} GB GPU memory; detected {:.1} GB",
                profile.minimum_vram_gb, request.hardware.gpu_vram_gb
            ));
        }
        if let Some(required) = profile.required_backend.as_deref() {
            let actual = request.hardware.backend.as_deref().unwrap_or("");
            if !required.eq_ignore_ascii_case(actual) {
                hard_failures.push(format!(
                    "Requires {required} execution backend; detected {}",
                    if actual.is_empty() { "none" } else { actual }
                ));
            }
        }

        let fit = find_fit(profile, &fit_index);
        let model_download_gb = fit
            .and_then(|value| value.disk_size_gb)
            .map(|observed| observed.max(profile.download_size_gb))
            .unwrap_or(profile.download_size_gb);
        let required_disk = model_download_gb
            + request.runtime_storage_gb
            + request.embedding_storage_gb
            + request.disk_headroom_gb;
        if request.free_disk_gb < required_disk {
            hard_failures.push(format!(
                "Requires {:.1} GB free disk including safety headroom; detected {:.1} GB",
                required_disk, request.free_disk_gb
            ));
        }

        if let Some(fit) = fit {
            if normalized_fit_level(fit.fit_level.as_deref()) == "incompatible" {
                hard_failures.push("llmfit reports this model as incompatible".to_string());
            }
        } else if !fallback {
            hard_failures.push("No exact llmfit alias match was found".to_string());
        }

        if !hard_failures.is_empty() {
            excluded.push(ExcludedProfile {
                profile_id: profile.id.clone(),
                friendly_name: profile.friendly_name.clone(),
                reasons: hard_failures,
            });
            continue;
        }

        compatible.push(score_profile(
            profile,
            fit,
            &request.hardware,
            request.free_disk_gb,
            required_disk,
            fallback,
        ));
    }

    compatible.sort_by(|left, right| {
        right
            .final_score
            .total_cmp(&left.final_score)
            .then_with(|| left.profile_id.cmp(&right.profile_id))
    });

    let preferred = compatible
        .iter()
        .position(|candidate| matches!(candidate.fit.as_str(), "excellent" | "good"))
        .or_else(|| (!compatible.is_empty()).then_some(0));
    if let Some(index) = preferred {
        compatible[index].recommended = true;
    }

    Ok(RecommendationResponse {
        catalogue_id: request.catalogue.id,
        catalogue_version: request.catalogue.version,
        used_conservative_fallback: fallback,
        compatible,
        excluded,
    })
}

fn validate_request(request: &RecommendationRequest) -> Result<(), String> {
    if request.catalogue.schema_version != SUPPORTED_SCHEMA_VERSION {
        return Err(format!(
            "Unsupported catalogue schema version {}",
            request.catalogue.schema_version
        ));
    }
    for (label, value) in [
        ("total RAM", request.hardware.total_ram_gb),
        ("available RAM", request.hardware.available_ram_gb),
        ("GPU memory", request.hardware.gpu_vram_gb),
        ("free disk", request.free_disk_gb),
        ("runtime storage", request.runtime_storage_gb),
        ("embedding storage", request.embedding_storage_gb),
        ("disk headroom", request.disk_headroom_gb),
    ] {
        if !value.is_finite() || value < 0.0 {
            return Err(format!("Invalid {label} value"));
        }
    }
    if request.hardware.available_ram_gb > request.hardware.total_ram_gb {
        return Err("Available RAM cannot exceed total RAM".to_string());
    }
    if let Some(report) = request.fit_report.as_ref() {
        if let Some(system) = report.system.as_ref() {
            for (label, value) in [
                ("llmfit total RAM", system.total_ram_gb),
                ("llmfit GPU memory", system.gpu_vram_gb),
            ] {
                if value.is_some_and(|number| !number.is_finite() || number < 0.0) {
                    return Err(format!("Invalid {label} value"));
                }
            }
            if system
                .backend
                .as_deref()
                .is_some_and(|backend| backend.trim().is_empty())
            {
                return Err("Invalid empty llmfit backend".to_string());
            }
        }
    }

    let mut ids = HashSet::new();
    let mut aliases = HashMap::<String, String>::new();
    for profile in &request.catalogue.profiles {
        if profile.id.trim().is_empty() || !ids.insert(profile.id.clone()) {
            return Err(format!("Invalid or duplicate profile id: {}", profile.id));
        }
        if !profile.legal_benchmark.score.is_finite()
            || !(0.0..=100.0).contains(&profile.legal_benchmark.score)
        {
            return Err(format!("Invalid legal benchmark score for {}", profile.id));
        }
        for (label, value) in [
            ("minimum RAM", profile.minimum_ram_gb),
            ("recommended RAM", profile.recommended_ram_gb),
            ("minimum GPU memory", profile.minimum_vram_gb),
            ("download size", profile.download_size_gb),
            ("target speed", profile.target_tps),
        ] {
            if !value.is_finite() || value < 0.0 {
                return Err(format!("Invalid {label} for {}", profile.id));
            }
        }
        if profile.recommended_ram_gb < profile.minimum_ram_gb {
            return Err(format!(
                "Recommended RAM cannot be lower than minimum RAM for {}",
                profile.id
            ));
        }
        for alias in profile_aliases(profile) {
            if alias.is_empty() {
                return Err(format!("Empty llmfit alias for {}", profile.id));
            }
            if let Some(existing) = aliases.insert(alias, profile.id.clone()) {
                if existing != profile.id {
                    return Err(format!(
                        "llmfit alias is shared by profiles {existing} and {}",
                        profile.id
                    ));
                }
            }
        }
    }
    Ok(())
}

fn build_fit_index(report: Option<&LlmFitReport>) -> HashMap<String, &LlmFitModel> {
    let mut index = HashMap::new();
    if let Some(report) = report {
        for model in &report.models {
            index.insert(normalize_model_key(&model.name), model);
            if let Some(name) = model.ollama_name.as_deref() {
                index.insert(normalize_model_key(name), model);
            }
        }
    }
    index
}

fn find_fit<'a>(
    profile: &LegalModelProfile,
    fit_index: &'a HashMap<String, &'a LlmFitModel>,
) -> Option<&'a LlmFitModel> {
    profile_aliases(profile)
        .into_iter()
        .find_map(|alias| fit_index.get(&alias).copied())
}

fn profile_aliases(profile: &LegalModelProfile) -> Vec<String> {
    profile
        .llmfit_aliases
        .iter()
        .chain(std::iter::once(&profile.ollama_model))
        .map(|value| normalize_model_key(value))
        .collect()
}

fn normalize_model_key(value: &str) -> String {
    value
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .flat_map(|ch| ch.to_lowercase())
        .collect()
}

fn normalized_fit_level(value: Option<&str>) -> String {
    match value
        .unwrap_or("unknown")
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "perfect" | "excellent" => "excellent".to_string(),
        "good" => "good".to_string(),
        "marginal" | "partial" => "marginal".to_string(),
        "incompatible" | "no fit" | "none" => "incompatible".to_string(),
        _ => "unknown".to_string(),
    }
}

fn score_profile(
    profile: &LegalModelProfile,
    fit: Option<&LlmFitModel>,
    hardware: &NormalizedHardware,
    free_disk_gb: f64,
    required_disk_gb: f64,
    fallback: bool,
) -> ModelRecommendation {
    let fit_name = fit
        .map(|value| normalized_fit_level(value.fit_level.as_deref()))
        .unwrap_or_else(|| "unknown".to_string());
    let fit_score = match fit_name.as_str() {
        "excellent" => 100.0,
        "good" => 80.0,
        "marginal" => 45.0,
        _ => 35.0,
    };
    let estimated_tps = fit.and_then(|value| value.estimated_tps);
    let speed_score = if profile.target_tps > 0.0 {
        estimated_tps
            .map(|value| (value / profile.target_tps * 100.0).clamp(0.0, 100.0))
            .unwrap_or(35.0)
    } else {
        100.0
    };
    let effective_context = fit
        .and_then(|value| value.effective_context_length)
        .unwrap_or(profile.operational_context_tokens);
    let context_score = if profile.operational_context_tokens == 0 {
        100.0
    } else {
        (effective_context as f64 / profile.operational_context_tokens as f64 * 100.0)
            .clamp(0.0, 100.0)
    };
    let execution_mode = fit
        .and_then(|value| value.run_mode.clone())
        .unwrap_or_else(|| {
            if hardware.gpu_vram_gb > 0.0 {
                "unknown-gpu".to_string()
            } else {
                "cpu".to_string()
            }
        });
    let power_score = match execution_mode.to_ascii_lowercase().as_str() {
        "gpu" => 100.0,
        "cpu/gpu" | "cpu-gpu" | "hybrid" => 70.0,
        "cpu" => 50.0,
        _ => 40.0,
    };
    let storage_score = if free_disk_gb <= 0.0 {
        0.0
    } else {
        ((free_disk_gb - required_disk_gb) / free_disk_gb * 100.0).clamp(0.0, 100.0)
    };
    let mut final_score = profile.legal_benchmark.score * 0.35
        + fit_score * 0.25
        + speed_score * 0.20
        + context_score * 0.10
        + power_score * 0.05
        + storage_score * 0.05;
    if fallback {
        final_score = (final_score - 10.0).max(0.0);
    }

    let mut reasons = vec![format!(
        "Passed legal benchmark {}",
        profile.legal_benchmark.version
    )];
    let mut warnings = Vec::new();
    if fallback {
        reasons.push(format!(
            "Conservative RAM rule passed ({:.1} GB recommended; {:.1} GB detected)",
            profile.recommended_ram_gb, hardware.total_ram_gb
        ));
        warnings.push(
            "llmfit was unavailable; speed and execution mode require validation".to_string(),
        );
    } else {
        reasons.push(format!("llmfit reports {fit_name} fit"));
    }
    if estimated_tps.is_some_and(|value| value < profile.target_tps) {
        warnings.push(format!(
            "Estimated speed is below the {:.1} tokens/second target",
            profile.target_tps
        ));
    }

    ModelRecommendation {
        profile_id: profile.id.clone(),
        friendly_name: profile.friendly_name.clone(),
        ollama_model: profile.ollama_model.clone(),
        fit: fit_name,
        execution_mode,
        quantization: fit.and_then(|value| value.best_quant.clone()),
        runtime: fit.and_then(|value| value.runtime.clone()),
        estimated_tokens_per_second: estimated_tps,
        estimated_memory_gb: fit.and_then(|value| value.memory_required_gb),
        download_size_gb: profile.download_size_gb,
        operational_context_tokens: profile.operational_context_tokens,
        final_score: (final_score * 10.0).round() / 10.0,
        recommended: false,
        reasons,
        warnings,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile(id: &str, alias: &str, ram: f64, legal_score: f64) -> LegalModelProfile {
        LegalModelProfile {
            id: id.to_string(),
            friendly_name: id.to_string(),
            ollama_model: format!("{alias}:q4"),
            llmfit_aliases: vec![alias.to_string()],
            enabled: true,
            retired: false,
            minimum_ram_gb: ram,
            recommended_ram_gb: ram + 4.0,
            minimum_vram_gb: 0.0,
            requires_gpu: false,
            required_backend: None,
            download_size_gb: 5.0,
            operational_context_tokens: 8192,
            target_tps: 10.0,
            legal_benchmark: LegalBenchmark {
                approved: true,
                score: legal_score,
                version: "legal-v1".to_string(),
            },
        }
    }

    fn request() -> RecommendationRequest {
        RecommendationRequest {
            hardware: NormalizedHardware {
                total_ram_gb: 32.0,
                available_ram_gb: 24.0,
                gpu_vram_gb: 8.0,
                backend: Some("cuda".to_string()),
            },
            fit_report: Some(LlmFitReport {
                models: vec![
                    LlmFitModel {
                        name: "Vendor/Legal-9B".to_string(),
                        ollama_name: None,
                        best_quant: Some("Q4_K_M".to_string()),
                        fit_level: Some("Good".to_string()),
                        memory_required_gb: Some(10.0),
                        estimated_tps: Some(18.0),
                        run_mode: Some("GPU".to_string()),
                        runtime: Some("llama.cpp".to_string()),
                        effective_context_length: Some(8192),
                        disk_size_gb: Some(5.0),
                    },
                    LlmFitModel {
                        name: "Vendor/Legal-3B".to_string(),
                        ollama_name: None,
                        best_quant: Some("Q4_K_M".to_string()),
                        fit_level: Some("Excellent".to_string()),
                        memory_required_gb: Some(4.0),
                        estimated_tps: Some(30.0),
                        run_mode: Some("GPU".to_string()),
                        runtime: Some("llama.cpp".to_string()),
                        effective_context_length: Some(8192),
                        disk_size_gb: Some(2.0),
                    },
                ],
                system: None,
            }),
            catalogue: LegalModelCatalogue {
                schema_version: 1,
                id: "legal-desktop".to_string(),
                version: "test".to_string(),
                profiles: vec![
                    profile("legal-standard", "Vendor/Legal-9B", 12.0, 95.0),
                    profile("legal-light", "Vendor/Legal-3B", 8.0, 75.0),
                ],
            },
            allowed_profiles: None,
            free_disk_gb: 50.0,
            runtime_storage_gb: 1.0,
            embedding_storage_gb: 1.0,
            disk_headroom_gb: 5.0,
        }
    }

    fn runtime_config() -> RuntimeConfig {
        RuntimeConfig {
            schema_version: 1,
            managed: true,
            ollama: OllamaRuntimeConfig {
                base_url: "http://127.0.0.1:11434".to_string(),
                runtime_version: "0.12.0-test".to_string(),
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
            installed_at: Some("2026-09-07T00:00:00Z".to_string()),
            validated_at: None,
        }
    }

    #[test]
    fn exact_alias_match_tolerates_case_and_punctuation() {
        let mut request = request();
        request.catalogue.profiles[0].llmfit_aliases = vec!["vendor legal 9b".to_string()];
        let response = recommend_models(request).unwrap();
        assert!(response
            .compatible
            .iter()
            .any(|value| value.profile_id == "legal-standard"));
    }

    #[test]
    fn entitlement_is_a_hard_filter() {
        let mut request = request();
        request.allowed_profiles = Some(vec!["legal-light".to_string()]);
        let response = recommend_models(request).unwrap();
        assert_eq!(response.compatible.len(), 1);
        assert_eq!(response.compatible[0].profile_id, "legal-light");
        assert!(response.excluded[0].reasons[0].contains("entitlement"));
    }

    #[test]
    fn disk_and_ram_are_hard_filters() {
        let mut request = request();
        request.hardware.total_ram_gb = 9.0;
        request.hardware.available_ram_gb = 8.0;
        request.free_disk_gb = 6.0;
        let response = recommend_models(request).unwrap();
        assert!(response.compatible.is_empty());
        assert!(response.excluded.iter().all(|profile| {
            profile
                .reasons
                .iter()
                .any(|reason| reason.contains("free disk"))
        }));
        assert!(response
            .excluded
            .iter()
            .find(|profile| profile.profile_id == "legal-standard")
            .unwrap()
            .reasons
            .iter()
            .any(|reason| reason.contains("RAM")));
    }

    #[test]
    fn unmapped_llmfit_model_is_not_selectable() {
        let mut request = request();
        request.catalogue.profiles[0].llmfit_aliases = vec!["different-9b".to_string()];
        request.catalogue.profiles[0].ollama_model = "different:9b".to_string();
        let response = recommend_models(request).unwrap();
        assert!(response
            .excluded
            .iter()
            .find(|profile| profile.profile_id == "legal-standard")
            .unwrap()
            .reasons
            .iter()
            .any(|reason| reason.contains("exact llmfit alias")));
    }

    #[test]
    fn recommendation_is_deterministic_and_explainable() {
        let first = recommend_models(request()).unwrap();
        let second = recommend_models(request()).unwrap();
        let first_ids: Vec<_> = first
            .compatible
            .iter()
            .map(|item| &item.profile_id)
            .collect();
        let second_ids: Vec<_> = second
            .compatible
            .iter()
            .map(|item| &item.profile_id)
            .collect();
        assert_eq!(first_ids, second_ids);
        assert_eq!(
            first
                .compatible
                .iter()
                .filter(|item| item.recommended)
                .count(),
            1
        );
        assert!(first.compatible.iter().all(|item| !item.reasons.is_empty()));
    }

    #[test]
    fn missing_llmfit_uses_conservative_fallback() {
        let mut request = request();
        request.fit_report = None;
        request.hardware.total_ram_gb = 16.0;
        request.hardware.available_ram_gb = 12.0;
        let response = recommend_models(request).unwrap();
        assert!(response.used_conservative_fallback);
        assert!(response
            .compatible
            .iter()
            .all(|item| item.fit == "unknown" && !item.warnings.is_empty()));
    }

    #[test]
    fn conservative_fallback_requires_recommended_ram() {
        let mut request = request();
        request.fit_report = None;
        request.hardware.total_ram_gb = 14.0;
        request.hardware.available_ram_gb = 10.0;
        let response = recommend_models(request).unwrap();
        assert_eq!(response.compatible.len(), 1);
        assert_eq!(response.compatible[0].profile_id, "legal-light");
        assert!(response
            .excluded
            .iter()
            .find(|profile| profile.profile_id == "legal-standard")
            .unwrap()
            .reasons
            .iter()
            .any(|reason| reason.contains("Conservative fallback")));
    }

    #[test]
    fn duplicate_aliases_are_rejected() {
        let mut request = request();
        request.catalogue.profiles[1].llmfit_aliases = vec!["Vendor/Legal-9B".to_string()];
        assert!(recommend_models(request)
            .unwrap_err()
            .contains("shared by profiles"));
    }

    #[test]
    fn unknown_catalogue_schema_is_rejected() {
        let mut request = request();
        request.catalogue.schema_version = 2;
        assert!(recommend_models(request)
            .unwrap_err()
            .contains("Unsupported catalogue schema"));
    }

    #[test]
    fn parses_captured_llmfit_v1_1_14_shape() {
        let report: LlmFitReport = serde_json::from_str(include_str!(
            "../test-fixtures/llmfit/v1.1.14/recommend.json"
        ))
        .unwrap();
        assert_eq!(report.models.len(), 2);
        assert_eq!(
            report.models[0].ollama_name.as_deref(),
            Some("legal-test:9b")
        );
        assert_eq!(report.system.unwrap().backend.as_deref(), Some("metal"));
    }

    #[test]
    fn runtime_config_accepts_loopback_only() {
        for host in [
            "http://127.0.0.1:11434",
            "http://[::1]:11434",
            "http://localhost:11434",
        ] {
            let mut config = runtime_config();
            config.ollama.base_url = host.to_string();
            validate_private_ai_runtime_config(config).unwrap();
        }

        let mut config = runtime_config();
        config.ollama.base_url = "http://0.0.0.0:11434".to_string();
        assert!(validate_private_ai_runtime_config(config)
            .unwrap_err()
            .contains("loopback-only"));
    }

    #[test]
    fn runtime_config_fixture_is_canonical_and_valid() {
        let config: RuntimeConfig = serde_json::from_str(include_str!(
            "../test-fixtures/runtime-config/v1/canonical.json"
        ))
        .unwrap();
        validate_private_ai_runtime_config(config.clone()).unwrap();
        let serialized = serde_json::to_value(config).unwrap();
        assert_eq!(serialized["models"]["profileId"], "legal-standard");
        assert_eq!(serialized["privacy"]["bindLocalhostOnly"], true);
    }

    #[test]
    fn runtime_config_rejects_mutable_model_tags() {
        let mut config = runtime_config();
        config.models.generation = "legal-test:latest".to_string();
        assert!(validate_private_ai_runtime_config(config)
            .unwrap_err()
            .contains("exact non-latest"));
    }
}
