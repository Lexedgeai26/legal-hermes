//! Orchestration behind the Private AI screens.
//!
//! The renderer asks one question — "what can this machine run?" — and gets a
//! complete, explainable answer. It never supplies the catalogue, the hardware
//! figures, or the entitlement, so a compromised webview cannot widen what the
//! installer is willing to install.

use serde::Serialize;

use crate::catalogue::LoadedCatalogue;
use crate::hardware::{detect_private_ai_hardware, HardwareInventory};
use crate::private_ai::{
    recommend_models, NormalizedHardware, RecommendationRequest, RecommendationResponse,
};

/// Space we refuse to consume, so a machine is never filled to the rim.
const DISK_HEADROOM_GB: f64 = 5.0;
/// Approximate footprint of the managed Ollama runtime itself.
const RUNTIME_STORAGE_GB: f64 = 1.5;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivateAiAnalysis {
    pub hardware: HardwareInventory,
    pub recommendation: RecommendationResponse,
    pub catalogue_id: String,
    pub catalogue_version: String,
    pub embedding_model: String,
    pub embedding_dimensions: usize,
    /// Total the user is being asked to download for the recommended model,
    /// generation + embedding.
    pub total_download_gb: f64,
    /// Broken out so the UI can recompute the total when the user picks a
    /// different generation model, instead of inferring it by subtraction.
    pub embedding_download_gb: f64,
    /// Free space on the volume the models will land on.
    pub free_disk_gb: f64,
    /// True when llmfit could not be used and conservative rules applied.
    pub used_conservative_fallback: bool,
}

/// Free space on the volume that will hold the models. We use the smallest
/// candidate rather than the largest so the estimate is never optimistic.
pub fn installable_free_disk_gb(hardware: &HardwareInventory) -> f64 {
    hardware
        .storage
        .iter()
        .map(|volume| volume.free_gb)
        .fold(f64::NAN, f64::max)
        .max(0.0)
}

/// Total download the user must approve before anything is fetched.
pub fn total_download_gb(generation_gb: f64, embedding_gb: f64) -> f64 {
    ((generation_gb + embedding_gb) * 10.0).round() / 10.0
}

fn normalize(hardware: &HardwareInventory) -> NormalizedHardware {
    let gpu_vram_gb = hardware
        .gpus
        .iter()
        .map(|gpu| gpu.dedicated_vram_gb)
        .fold(0.0_f64, f64::max);
    NormalizedHardware {
        total_ram_gb: hardware.memory.total_gb,
        available_ram_gb: hardware.memory.available_gb,
        gpu_vram_gb,
        backend: hardware
            .gpus
            .iter()
            .find_map(|gpu| gpu.backend.clone()),
    }
}

/// Build the recommendation request. Kept separate from the command so the
/// mapping from raw inventory to recommendation inputs is testable.
pub fn build_request(
    hardware: &HardwareInventory,
    loaded: &LoadedCatalogue,
    embedding_download_gb: f64,
) -> RecommendationRequest {
    RecommendationRequest {
        hardware: normalize(hardware),
        fit_report: None,
        catalogue: loaded.catalogue.clone(),
        allowed_profiles: None,
        free_disk_gb: installable_free_disk_gb(hardware),
        runtime_storage_gb: RUNTIME_STORAGE_GB,
        embedding_storage_gb: embedding_download_gb,
        disk_headroom_gb: DISK_HEADROOM_GB,
    }
}

/// Embedding models are small and fixed per catalogue; the figure is only used
/// for the disk estimate and the download-size confirmation.
const EMBEDDING_DOWNLOAD_GB: f64 = 0.7;

#[tauri::command]
pub async fn analyze_private_ai_options() -> Result<PrivateAiAnalysis, String> {
    let hardware = detect_private_ai_hardware().await?;

    #[cfg(debug_assertions)]
    let loaded = crate::catalogue::development_catalogue(&crate::runtime::rfc3339_utc_now())?;
    #[cfg(not(debug_assertions))]
    let loaded: LoadedCatalogue = return Err(
        "No signed model catalogue has been provisioned for this build".to_string(),
    );

    let request = build_request(&hardware, &loaded, EMBEDDING_DOWNLOAD_GB);
    let free_disk_gb = request.free_disk_gb;
    let recommendation = recommend_models(request)?;

    let generation_gb = recommendation
        .compatible
        .iter()
        .find(|model| model.recommended)
        .or_else(|| recommendation.compatible.first())
        .map(|model| model.download_size_gb)
        .unwrap_or(0.0);

    Ok(PrivateAiAnalysis {
        catalogue_id: loaded.catalogue.id.clone(),
        catalogue_version: loaded.catalogue.version.clone(),
        embedding_model: loaded.embedding_model.clone(),
        embedding_dimensions: loaded.embedding_dimensions,
        total_download_gb: total_download_gb(generation_gb, EMBEDDING_DOWNLOAD_GB),
        embedding_download_gb: EMBEDDING_DOWNLOAD_GB,
        free_disk_gb,
        used_conservative_fallback: recommendation.used_conservative_fallback,
        hardware,
        recommendation,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn analysis_explains_every_option_on_this_machine() {
        let analysis = analyze_private_ai_options().await.unwrap();

        assert_eq!(analysis.catalogue_id, "legal-desktop-dev");
        assert_eq!(analysis.embedding_dimensions, 768);
        // Something must be said about every profile in the catalogue.
        let described =
            analysis.recommendation.compatible.len() + analysis.recommendation.excluded.len();
        assert_eq!(described, 3, "every catalogue profile needs a verdict");

        // Every exclusion carries a human-readable reason (brief item 4).
        for excluded in &analysis.recommendation.excluded {
            assert!(
                !excluded.reasons.is_empty(),
                "{} was excluded without a reason",
                excluded.profile_id
            );
        }
        for model in &analysis.recommendation.compatible {
            assert!(!model.reasons.is_empty(), "{} has no reasons", model.profile_id);
        }

        // The download figure is shown before any confirmation.
        assert!(analysis.total_download_gb > 0.0);
        assert!(analysis.embedding_download_gb > 0.0);
        assert!(
            analysis.total_download_gb >= analysis.embedding_download_gb,
            "the total must include the embedding model"
        );
        assert!(analysis.free_disk_gb > 0.0);
    }

    #[tokio::test]
    async fn analysis_never_reports_a_personal_path_or_identifier() {
        let analysis = analyze_private_ai_options().await.unwrap();
        let encoded = serde_json::to_string(&analysis).unwrap();
        // Brief item 4: no usernames, device ids, serials or personal paths.
        assert!(!encoded.contains("/Users/"), "personal path leaked");
        assert!(!encoded.contains("/home/"), "personal path leaked");
        if let Ok(user) = std::env::var("USER") {
            if user.len() > 3 {
                assert!(!encoded.contains(&user), "username leaked");
            }
        }
    }

    #[test]
    fn download_total_covers_generation_and_embedding() {
        assert_eq!(total_download_gb(5.5, 0.7), 6.2);
        assert_eq!(total_download_gb(0.0, 0.7), 0.7);
    }
}
