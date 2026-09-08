//! Private AI provisioning: the resumable path from "the user chose a model"
//! to "validated local inference".
//!
//! Every stage is idempotent — it checks its own postcondition before doing
//! work — so a run interrupted by a crash, a closed lid or a cancel resumes
//! from where it stopped rather than from the beginning. Progress is
//! journaled to installer-resume-state.v1 between stages.
//!
//! Nothing here weakens the layers below it: the catalogue and component
//! manifest are signature-verified, the download is hash-verified, the
//! archive is safely extracted, the runtime is loopback-only, and setup is
//! marked complete only when the validation gate passes.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::mpsc;

use crate::catalogue::LoadedCatalogue;
use crate::component_manifest::{self, Component};
use crate::download::download_component;
use crate::events::StageState;
use crate::extract::extract_runtime_archive;
use crate::ollama_api::{ensure_immutable_tag, verify_installed_model, ExpectedModel, OllamaClient};
use crate::private_ai::{
    LegalModelProfile, OllamaRuntimeConfig, RuntimeCatalogConfig, RuntimeConfig,
    RuntimeModelsConfig, RuntimePrivacyConfig,
};
use crate::runtime::{self, ManagedRuntimePaths, DEFAULT_OLLAMA_PORT};
use crate::validation::{validate_private_ai, ValidationReport, ValidationRequest};
use crate::AppState;

pub const CHANNEL: &str = "private-ai";
const CANCELLED: &str = "Private AI setup was cancelled";
const HEALTH_TIMEOUT: Duration = Duration::from_secs(90);
const RESUME_SCHEMA_VERSION: u32 = 1;

/// Stage names in order. Also the vocabulary of the resume journal.
pub const STAGES: &[(&str, &str)] = &[
    ("resolve", "Check the approved runtime and models"),
    ("download-runtime", "Download the Private AI runtime"),
    ("install-runtime", "Install the runtime"),
    ("start-runtime", "Start the runtime"),
    ("install-generation-model", "Download the legal model"),
    ("install-embedding-model", "Download the document-search model"),
    ("verify-models", "Verify the models"),
    ("write-config", "Save the configuration"),
    ("validate", "Test local AI"),
];

// ---------------------------------------------------------------------------
// Events (Rust → React), channel "private-ai"
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StageDescriptor {
    pub name: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum PrivateAiEvent {
    Manifest {
        stages: Vec<StageDescriptor>,
    },
    Stage {
        name: String,
        state: StageState,
        #[serde(skip_serializing_if = "Option::is_none")]
        detail: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
    Progress {
        stage: String,
        fraction: f64,
        detail: String,
    },
    Complete {
        report: ValidationReport,
        config: RuntimeConfig,
    },
    Failed {
        #[serde(skip_serializing_if = "Option::is_none")]
        stage: Option<String>,
        error: String,
        /// True when running again continues from the failed stage.
        resumable: bool,
    },
}

/// Where events go. The Tauri command wires this to the webview channel; the
/// end-to-end test wires it to a vector. The orchestration itself never
/// knows which.
pub type EventSink = Arc<dyn Fn(PrivateAiEvent) + Send + Sync>;

fn emit(sink: &EventSink, event: PrivateAiEvent) {
    if let PrivateAiEvent::Stage { name, state, error, .. } = &event {
        tracing::info!(stage = %name, ?state, ?error, "private-ai stage");
    }
    (sink)(event);
}

// ---------------------------------------------------------------------------
// Resume journal — schemas/installer-resume-state.v1.schema.json
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ResumeStatus {
    Running,
    Cancelled,
    Failed,
    Completed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResumeState {
    pub schema_version: u32,
    pub session_id: String,
    pub status: ResumeStatus,
    #[serde(default)]
    pub current_stage: Option<String>,
    pub completed_stages: Vec<String>,
    #[serde(default)]
    pub selected_profile_id: Option<String>,
    #[serde(default)]
    pub selected_model_root: Option<String>,
    #[serde(default)]
    pub download_ids: Vec<String>,
    pub updated_at: String,
}

impl ResumeState {
    fn new(profile_id: &str, model_root: &Path) -> Self {
        Self {
            schema_version: RESUME_SCHEMA_VERSION,
            session_id: uuid::Uuid::new_v4().to_string(),
            status: ResumeStatus::Running,
            current_stage: None,
            completed_stages: Vec::new(),
            selected_profile_id: Some(profile_id.to_string()),
            selected_model_root: Some(model_root.to_string_lossy().into_owned()),
            download_ids: Vec::new(),
            updated_at: runtime::rfc3339_utc_now(),
        }
    }

    /// A prior journal may be continued only if it is for the same profile
    /// and did not already finish. Anything else starts a fresh session.
    pub fn resume_or_new(prior: Option<ResumeState>, profile_id: &str, model_root: &Path) -> Self {
        match prior {
            Some(state)
                if state.schema_version == RESUME_SCHEMA_VERSION
                    && state.selected_profile_id.as_deref() == Some(profile_id)
                    && state.status != ResumeStatus::Completed =>
            {
                ResumeState {
                    status: ResumeStatus::Running,
                    current_stage: None,
                    updated_at: runtime::rfc3339_utc_now(),
                    ..state
                }
            }
            _ => Self::new(profile_id, model_root),
        }
    }

    fn mark_running(&mut self, stage: &str) {
        self.current_stage = Some(stage.to_string());
        self.updated_at = runtime::rfc3339_utc_now();
    }

    fn mark_done(&mut self, stage: &str) {
        if !self.completed_stages.iter().any(|s| s == stage) {
            self.completed_stages.push(stage.to_string());
        }
        self.current_stage = None;
        self.updated_at = runtime::rfc3339_utc_now();
    }

    fn finish(&mut self, status: ResumeStatus) {
        self.status = status;
        self.updated_at = runtime::rfc3339_utc_now();
    }
}

fn journal_path(paths: &ManagedRuntimePaths) -> PathBuf {
    paths.root.join("provision-state.json")
}

fn load_journal(paths: &ManagedRuntimePaths) -> Option<ResumeState> {
    let bytes = std::fs::read(journal_path(paths)).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn save_journal(paths: &ManagedRuntimePaths, state: &ResumeState) {
    if let Ok(encoded) = serde_json::to_vec_pretty(state) {
        if let Err(err) = runtime::write_atomic(&journal_path(paths), &encoded) {
            tracing::warn!(%err, "unable to write the provisioning journal");
        }
    }
}

// ---------------------------------------------------------------------------
// Plan — everything resolved up front from signed inputs
// ---------------------------------------------------------------------------

#[derive(Debug)]
struct Plan {
    component: Component,
    profile: LegalModelProfile,
    loaded: LoadedCatalogue,
    smaller_profile_id: Option<String>,
}

/// The next smaller compatible profile, offered (never applied) when the
/// chosen one validates slowly.
pub fn next_smaller_profile(catalogue: &[LegalModelProfile], selected: &LegalModelProfile) -> Option<String> {
    catalogue
        .iter()
        .filter(|p| {
            p.id != selected.id
                && p.enabled
                && !p.retired
                && p.legal_benchmark.approved
                && p.recommended_ram_gb < selected.recommended_ram_gb
        })
        .max_by(|a, b| a.recommended_ram_gb.total_cmp(&b.recommended_ram_gb))
        .map(|p| p.id.clone())
}

/// Path recorded in runtime.json, relative to HERMES_HOME.
pub fn relative_runtime_path() -> String {
    if cfg!(target_os = "windows") {
        "private-ai/runtime/ollama.exe".to_string()
    } else {
        "private-ai/runtime/ollama".to_string()
    }
}

fn resolve_plan(profile_id: &str) -> Result<Plan, String> {
    let now = runtime::rfc3339_utc_now();

    #[cfg(debug_assertions)]
    let (loaded, manifest) = (
        crate::catalogue::development_catalogue(&now)?,
        component_manifest::development_component_manifest(&now)?,
    );
    #[cfg(not(debug_assertions))]
    let (loaded, manifest): (LoadedCatalogue, component_manifest::ComponentManifest) = {
        let _ = now;
        return Err("No signed catalogue or component manifest has been provisioned for this build".to_string());
    };

    let profile = loaded
        .catalogue
        .profiles
        .iter()
        .find(|p| p.id == profile_id)
        .cloned()
        .ok_or_else(|| "The selected model is not in the approved catalogue".to_string())?;
    if !profile.enabled || profile.retired || !profile.legal_benchmark.approved {
        return Err("The selected model is not available for installation".to_string());
    }
    ensure_immutable_tag(&profile.ollama_model)?;
    if loaded.embedding_model.trim().is_empty() {
        return Err("The catalogue names no embedding model".to_string());
    }
    ensure_immutable_tag(&loaded.embedding_model)?;

    let platform = component_manifest::current_platform()
        .ok_or_else(|| "This operating system is not supported for Private AI".to_string())?;
    let architecture = component_manifest::current_architecture()
        .ok_or_else(|| "This processor architecture is not supported for Private AI".to_string())?;
    let component = manifest
        .select("ollama", platform, architecture)
        .cloned()
        .ok_or_else(|| "No approved runtime is available for this computer".to_string())?;

    let smaller_profile_id = next_smaller_profile(&loaded.catalogue.profiles, &profile);
    Ok(Plan { component, profile, loaded, smaller_profile_id })
}

// ---------------------------------------------------------------------------
// Public Tauri surface
// ---------------------------------------------------------------------------

pub struct ProvisionHandle {
    pub cancel_tx: mpsc::Sender<()>,
    pub running: bool,
    pub completed: bool,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvisionStatus {
    pub running: bool,
    pub completed: bool,
    pub last_error: Option<String>,
}

#[tauri::command]
pub async fn start_private_ai_provisioning(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    profile_id: String,
) -> Result<(), String> {
    let mut guard = state.private_ai.lock().await;
    if guard.as_ref().is_some_and(|h| h.running) {
        return Err("Private AI setup is already running".to_string());
    }
    let (cancel_tx, cancel_rx) = mpsc::channel::<()>(1);
    *guard = Some(ProvisionHandle {
        cancel_tx,
        running: true,
        completed: false,
        last_error: None,
    });
    drop(guard);

    let app_for_emit = app.clone();
    let sink: EventSink = Arc::new(move |event| {
        if let Err(err) = app_for_emit.emit(CHANNEL, &event) {
            tracing::warn!(?err, "failed to emit private-ai event");
        }
    });
    let state_for_task = state.inner().clone();
    tokio::spawn(async move {
        let outcome = run(sink, state_for_task.clone(), profile_id, cancel_rx).await;
        let mut guard = state_for_task.private_ai.lock().await;
        if let Some(h) = guard.as_mut() {
            h.running = false;
            match &outcome {
                Ok(()) => {
                    h.completed = true;
                    h.last_error = None;
                }
                Err(err) => {
                    h.completed = false;
                    h.last_error = Some(err.clone());
                }
            }
        }
    });
    Ok(())
}

#[tauri::command]
pub async fn cancel_private_ai_provisioning(state: State<'_, Arc<AppState>>) -> Result<(), String> {
    if let Some(h) = state.private_ai.lock().await.as_ref() {
        let _ = h.cancel_tx.try_send(());
    }
    Ok(())
}

#[tauri::command]
pub async fn get_private_ai_provisioning_status(
    state: State<'_, Arc<AppState>>,
) -> Result<ProvisionStatus, String> {
    let guard = state.private_ai.lock().await;
    Ok(match guard.as_ref() {
        Some(h) => ProvisionStatus {
            running: h.running,
            completed: h.completed,
            last_error: h.last_error.clone(),
        },
        None => ProvisionStatus { running: false, completed: false, last_error: None },
    })
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

async fn cancellable<T>(
    fut: impl std::future::Future<Output = Result<T, String>>,
    cancel: &mut mpsc::Receiver<()>,
) -> Result<T, String> {
    tokio::select! {
        result = fut => result,
        _ = cancel.recv() => Err(CANCELLED.to_string()),
    }
}

struct Stage<'a> {
    sink: &'a EventSink,
    paths: &'a ManagedRuntimePaths,
    journal: &'a mut ResumeState,
    name: &'static str,
    started: Instant,
}

impl<'a> Stage<'a> {
    fn begin(sink: &'a EventSink, paths: &'a ManagedRuntimePaths, journal: &'a mut ResumeState, name: &'static str) -> Self {
        journal.mark_running(name);
        save_journal(paths, journal);
        emit(sink, PrivateAiEvent::Stage { name: name.to_string(), state: StageState::Running, detail: None, error: None });
        Self { sink, paths, journal, name, started: Instant::now() }
    }
    fn progress(&self, fraction: f64, detail: impl Into<String>) {
        emit(self.sink, PrivateAiEvent::Progress { stage: self.name.to_string(), fraction: fraction.clamp(0.0, 1.0), detail: detail.into() });
    }
    fn done(self, detail: impl Into<String>) -> u64 {
        self.journal.mark_done(self.name);
        save_journal(self.paths, self.journal);
        emit(self.sink, PrivateAiEvent::Stage { name: self.name.to_string(), state: StageState::Succeeded, detail: Some(detail.into()), error: None });
        self.started.elapsed().as_millis() as u64
    }
    fn skipped(self, detail: impl Into<String>) {
        self.journal.mark_done(self.name);
        save_journal(self.paths, self.journal);
        emit(self.sink, PrivateAiEvent::Stage { name: self.name.to_string(), state: StageState::Skipped, detail: Some(detail.into()), error: None });
    }
}

fn fail(sink: &EventSink, paths: &ManagedRuntimePaths, journal: &mut ResumeState, stage: &str, error: String) -> String {
    let cancelled = error == CANCELLED;
    journal.finish(if cancelled { ResumeStatus::Cancelled } else { ResumeStatus::Failed });
    save_journal(paths, journal);
    emit(sink, PrivateAiEvent::Stage { name: stage.to_string(), state: StageState::Failed, detail: None, error: Some(error.clone()) });
    emit(sink, PrivateAiEvent::Failed { stage: Some(stage.to_string()), error: error.clone(), resumable: true });
    error
}

async fn run(
    sink: EventSink,
    state: Arc<AppState>,
    profile_id: String,
    mut cancel: mpsc::Receiver<()>,
) -> Result<(), String> {
    let paths = ManagedRuntimePaths::resolve();
    paths.create_directories()?;
    let mut journal = ResumeState::resume_or_new(load_journal(&paths), &profile_id, &paths.models_dir);
    save_journal(&paths, &journal);
    emit(&sink, PrivateAiEvent::Manifest {
        stages: STAGES.iter().map(|(n, t)| StageDescriptor { name: n.to_string(), title: t.to_string() }).collect(),
    });

    // Anything below that returns Err has already emitted its failure.
    macro_rules! stage_try {
        ($stage:expr, $expr:expr) => {
            match $expr {
                Ok(v) => v,
                Err(e) => return Err(fail(&sink, &paths, &mut journal, $stage, e)),
            }
        };
    }

    // 1. resolve -----------------------------------------------------------
    let stage = Stage::begin(&sink, &paths, &mut journal, "resolve");
    let plan = stage_try!("resolve", resolve_plan(&profile_id));
    stage.done(format!("Runtime {} · {} · {}", plan.component.version, plan.profile.ollama_model, plan.loaded.embedding_model));

    // 2. download-runtime ----------------------------------------------------
    let stage = Stage::begin(&sink, &paths, &mut journal, "download-runtime");
    let downloads = paths.root.join("downloads");
    let total_mb = plan.component.size_bytes as f64 / 1_048_576.0;
    let sink_p = sink.clone();
    let archive = stage_try!("download-runtime", cancellable(
        download_component(&plan.component, &downloads, move |p| {
            emit(&sink_p, PrivateAiEvent::Progress {
                stage: "download-runtime".to_string(),
                fraction: p.fraction,
                detail: format!("{:.0} of {:.0} MB", p.received_bytes as f64 / 1_048_576.0, total_mb),
            });
        }),
        &mut cancel,
    ).await);
    stage.done(format!("Verified {:.0} MB", total_mb));

    // 3. install-runtime -----------------------------------------------------
    let stage = Stage::begin(&sink, &paths, &mut journal, "install-runtime");
    let already = runtime::read_ownership_marker(&paths)
        .is_some_and(|m| m.runtime_version == plan.component.version)
        && paths.executable().is_file();
    if already {
        stage.skipped(format!("Runtime {} is already installed", plan.component.version));
    } else {
        stage.progress(0.0, "Unpacking");
        let staging = paths.root.join(format!("runtime.staging-{}", uuid::Uuid::new_v4()));
        let archive_for_task = archive.clone();
        let staging_for_task = staging.clone();
        let extracted = stage_try!("install-runtime", cancellable(
            async move {
                tokio::task::spawn_blocking(move || extract_runtime_archive(&archive_for_task, &staging_for_task))
                    .await
                    .map_err(|_| "Runtime extraction was interrupted".to_string())?
            },
            &mut cancel,
        ).await);
        stage_try!("install-runtime", install_runtime_dir(&paths, &staging, &plan.component.version));
        stage.done(format!("Installed {} files", extracted.files));
    }

    // 4. start-runtime -------------------------------------------------------
    let stage = Stage::begin(&sink, &paths, &mut journal, "start-runtime");
    let port = stage_try!("start-runtime", runtime::choose_loopback_port(DEFAULT_OLLAMA_PORT));
    if port != DEFAULT_OLLAMA_PORT {
        stage.progress(0.1, format!("Port {DEFAULT_OLLAMA_PORT} is in use; using {port}"));
    }
    // Replace any runtime we started earlier this session.
    if let Some(mut old) = state.managed_runtime.lock().await.take() {
        let _ = old.kill().await;
    }
    let startup = Instant::now();
    let child = stage_try!("start-runtime", runtime::spawn_managed_runtime(&paths, port).await);
    *state.managed_runtime.lock().await = Some(child);
    let client = stage_try!("start-runtime", OllamaClient::new(&runtime::base_url(port)));
    let version = match cancellable(client.wait_for_health(HEALTH_TIMEOUT), &mut cancel).await {
        Ok(v) => v,
        Err(e) => {
            if let Some(mut c) = state.managed_runtime.lock().await.take() {
                let _ = c.kill().await;
            }
            return Err(fail(&sink, &paths, &mut journal, "start-runtime", e));
        }
    };
    if version != plan.component.version {
        let e = format!("The runtime reported version {version}, expected {}", plan.component.version);
        if let Some(mut c) = state.managed_runtime.lock().await.take() {
            let _ = c.kill().await;
        }
        return Err(fail(&sink, &paths, &mut journal, "start-runtime", e));
    }
    let runtime_startup_ms = startup.elapsed().as_millis() as u64;
    stage.done(format!("Ollama {version} on 127.0.0.1:{port}"));

    // 5 + 6. models ----------------------------------------------------------
    let generation = ExpectedModel {
        tag: plan.profile.ollama_model.clone(),
        digest: plan.profile.expected_digest.clone(),
        size_bytes: plan.profile.expected_size_bytes,
    };
    let embedding = ExpectedModel {
        tag: plan.loaded.embedding_model.clone(),
        digest: plan.loaded.embedding_expected_digest.clone(),
        size_bytes: plan.loaded.embedding_expected_size_bytes,
    };
    for (name, expected) in [("install-generation-model", &generation), ("install-embedding-model", &embedding)] {
        let stage = Stage::begin(&sink, &paths, &mut journal, name);
        let installed = stage_try!(name, client.installed_models_detailed().await);
        if verify_installed_model(&installed, expected).is_ok() {
            stage.skipped(format!("{} is already installed and verified", expected.tag));
            continue;
        }
        let sink_p = sink.clone();
        let stage_name = name.to_string();
        stage_try!(name, cancellable(
            client.pull_model(&expected.tag, move |p| {
                emit(&sink_p, PrivateAiEvent::Progress {
                    stage: stage_name.clone(),
                    fraction: p.fraction,
                    detail: if p.total_bytes > 0 {
                        format!("{:.0} of {:.0} MB", p.completed_bytes as f64 / 1_048_576.0, p.total_bytes as f64 / 1_048_576.0)
                    } else {
                        p.status.clone()
                    },
                });
            }),
            &mut cancel,
        ).await);
        stage.done(format!("Downloaded {}", expected.tag));
    }

    // 7. verify-models -------------------------------------------------------
    let stage = Stage::begin(&sink, &paths, &mut journal, "verify-models");
    let installed = stage_try!("verify-models", client.installed_models_detailed().await);
    let gen_found = stage_try!("verify-models", verify_installed_model(&installed, &generation));
    let emb_found = stage_try!("verify-models", verify_installed_model(&installed, &embedding));
    stage.progress(0.4, "Warming up the legal model with synthetic text");
    stage_try!("verify-models", cancellable(client.warm_up(&generation.tag), &mut cancel).await);
    stage.progress(0.7, "Warming up the document-search model");
    let cold_embed_ms = stage_try!(
        "verify-models",
        cancellable(client.warm_up_embedding(&embedding.tag), &mut cancel).await
    );
    stage.done(format!(
        "{} ({}) · {} ({}) · first document-search load took {:.1}s",
        gen_found.name,
        short_digest(&gen_found.digest),
        emb_found.name,
        short_digest(&emb_found.digest),
        cold_embed_ms as f64 / 1000.0
    ));

    // 8. write-config --------------------------------------------------------
    let stage = Stage::begin(&sink, &paths, &mut journal, "write-config");
    let mut config = RuntimeConfig {
        schema_version: 1,
        managed: true,
        ollama: OllamaRuntimeConfig {
            base_url: runtime::base_url(port),
            runtime_version: plan.component.version.clone(),
            cloud_disabled: true,
            managed_process: true,
            runtime_path: relative_runtime_path(),
            models_path: "private-ai/models".to_string(),
        },
        models: RuntimeModelsConfig {
            profile_id: plan.profile.id.clone(),
            generation: plan.profile.ollama_model.clone(),
            embedding: plan.loaded.embedding_model.clone(),
            context_tokens: plan.profile.operational_context_tokens,
        },
        catalog: RuntimeCatalogConfig {
            id: plan.loaded.catalogue.id.clone(),
            version: plan.loaded.catalogue.version.clone(),
        },
        privacy: RuntimePrivacyConfig { bind_localhost_only: true, telemetry_enabled: false },
        installed_at: Some(runtime::rfc3339_utc_now()),
        validated_at: None,
    };
    stage_try!("write-config", runtime::write_runtime_config_atomic(&paths, &config));
    stage.done("runtime.json written");

    // 9. validate ------------------------------------------------------------
    let stage = Stage::begin(&sink, &paths, &mut journal, "validate");
    let request = ValidationRequest {
        port,
        expected_runtime_version: plan.component.version.clone(),
        generation_model: generation.tag.clone(),
        embedding_model: embedding.tag.clone(),
        expected_embedding_dimensions: plan.loaded.embedding_dimensions,
        target_tokens_per_second: plan.profile.target_tps,
        smaller_profile_id: plan.smaller_profile_id.clone(),
        runtime_startup_ms: Some(runtime_startup_ms),
    };
    let report = stage_try!("validate", cancellable(
        async { Ok::<_, String>(validate_private_ai(&client, &request).await) },
        &mut cancel,
    ).await);
    if !report.passed {
        let failed: Vec<String> = report.failed_checks().map(|c| format!("{}: {}", c.title, c.detail)).collect();
        return Err(fail(&sink, &paths, &mut journal, "validate", format!("Local AI validation failed — {}", failed.join("; "))));
    }
    config.validated_at = Some(runtime::rfc3339_utc_now());
    stage_try!("validate", runtime::write_runtime_config_atomic(&paths, &config));
    stage.done(format!(
        "{} checks passed{}",
        report.checks.len(),
        if report.warnings.is_empty() { String::new() } else { format!(", {} warning(s)", report.warnings.len()) }
    ));

    journal.finish(ResumeStatus::Completed);
    save_journal(&paths, &journal);
    emit(&sink, PrivateAiEvent::Complete { report, config });
    Ok(())
}

/// Move a freshly extracted staging directory into place. A previous managed
/// runtime is set aside (never deleted); a directory we do not own is never
/// touched.
fn install_runtime_dir(paths: &ManagedRuntimePaths, staging: &Path, version: &str) -> Result<(), String> {
    if paths.runtime_dir.exists() {
        let has_content = std::fs::read_dir(&paths.runtime_dir).map(|mut d| d.next().is_some()).unwrap_or(false);
        if has_content {
            if !runtime::runtime_is_managed_by_us(paths) {
                let _ = std::fs::remove_dir_all(staging);
                return Err("A runtime directory exists that LexEdge did not install; refusing to replace it".to_string());
            }
            let previous = paths.root.join(format!("runtime.previous-{}", runtime::rfc3339_utc_now().replace([':', '-'], "")));
            std::fs::rename(&paths.runtime_dir, &previous)
                .map_err(|_| "Unable to set aside the previous runtime".to_string())?;
        } else {
            let _ = std::fs::remove_dir(&paths.runtime_dir);
        }
    }
    std::fs::rename(staging, &paths.runtime_dir)
        .map_err(|_| "Unable to move the runtime into place".to_string())?;
    runtime::write_ownership_marker(paths, version)?;
    if !paths.executable().is_file() {
        return Err("The installed runtime has no executable".to_string());
    }
    Ok(())
}

fn short_digest(digest: &str) -> String {
    let d = digest.trim_start_matches("sha256:");
    d.chars().take(12).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::private_ai::LegalBenchmark;

    fn profile(id: &str, ram: f64, enabled: bool) -> LegalModelProfile {
        LegalModelProfile {
            id: id.to_string(),
            friendly_name: id.to_string(),
            ollama_model: format!("{id}:1b"),
            llmfit_aliases: vec![],
            enabled,
            retired: false,
            minimum_ram_gb: ram - 2.0,
            recommended_ram_gb: ram,
            minimum_vram_gb: 0.0,
            requires_gpu: false,
            required_backend: None,
            download_size_gb: 1.0,
            operational_context_tokens: 8192,
            target_tps: 20.0,
            expected_digest: None,
            expected_size_bytes: None,
            legal_benchmark: LegalBenchmark { approved: true, score: 70.0, version: "1".to_string() },
        }
    }

    #[test]
    fn next_smaller_picks_the_largest_profile_below_the_selection() {
        let cat = vec![profile("xl", 64.0, true), profile("l", 24.0, true), profile("m", 12.0, true), profile("s", 6.0, true)];
        assert_eq!(next_smaller_profile(&cat, &cat[1]).as_deref(), Some("m"));
        assert_eq!(next_smaller_profile(&cat, &cat[3]), None, "nothing below the smallest");
        // Disabled profiles are never offered.
        let mut cat2 = cat.clone();
        cat2[2].enabled = false;
        assert_eq!(next_smaller_profile(&cat2, &cat2[1]).as_deref(), Some("s"));
    }

    #[test]
    fn journal_resumes_only_the_same_unfinished_profile() {
        let root = Path::new("/x/models");
        let mut prior = ResumeState::new("legal-standard", root);
        prior.completed_stages = vec!["resolve".to_string(), "download-runtime".to_string()];
        prior.status = ResumeStatus::Failed;

        let resumed = ResumeState::resume_or_new(Some(prior.clone()), "legal-standard", root);
        assert_eq!(resumed.session_id, prior.session_id);
        assert_eq!(resumed.completed_stages, prior.completed_stages);
        assert_eq!(resumed.status, ResumeStatus::Running);

        // A different profile starts over.
        let fresh = ResumeState::resume_or_new(Some(prior.clone()), "legal-compact", root);
        assert_ne!(fresh.session_id, prior.session_id);
        assert!(fresh.completed_stages.is_empty());

        // A completed journal is never resumed into.
        let mut done = prior.clone();
        done.status = ResumeStatus::Completed;
        assert_ne!(ResumeState::resume_or_new(Some(done), "legal-standard", root).session_id, prior.session_id);
        assert!(ResumeState::resume_or_new(None, "legal-standard", root).completed_stages.is_empty());
    }

    #[test]
    fn journal_matches_the_resume_state_schema() {
        let s = ResumeState::new("p", Path::new("/m"));
        let json = serde_json::to_string(&s).unwrap();
        for key in ["\"schemaVersion\":1", "\"sessionId\"", "\"status\":\"running\"", "\"completedStages\":[]", "\"updatedAt\""] {
            assert!(json.contains(key), "missing {key} in {json}");
        }
        assert_eq!(serde_json::from_str::<ResumeState>(&json).unwrap(), s);
        assert!(serde_json::from_str::<ResumeState>(&json.replace("\"status\"", "\"bogus\":1,\"status\"")).is_err());
    }

    #[test]
    fn stage_vocabulary_is_stable_and_ordered() {
        let names: Vec<&str> = STAGES.iter().map(|(n, _)| *n).collect();
        assert_eq!(names.first(), Some(&"resolve"));
        assert_eq!(names.last(), Some(&"validate"));
        assert_eq!(names.len(), 9);
        assert!(relative_runtime_path().starts_with("private-ai/runtime/ollama"));
        assert_eq!(short_digest("sha256:abcdef0123456789ffff"), "abcdef012345");
    }

    /// The whole pipeline against the live network on this machine: signed
    /// manifest → verified download → safe extract → loopback runtime on a
    /// free port → verified model pulls → runtime.json → validation gate.
    ///
    /// Ignored by default (downloads ~1.2 GB, needs internet). Run with:
    ///   cargo test provisions_private_ai_end_to_end -- --ignored --nocapture
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    #[ignore]
    async fn provisions_private_ai_end_to_end() {
        // LEXEDGE_E2E_HOME reuses a previous run's home, which is how resume is
        // exercised: stages whose postconditions already hold must be skipped.
        let home = std::env::var("LEXEDGE_E2E_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| std::env::temp_dir().join(format!("lexedge-e2e-{}", uuid::Uuid::new_v4())));
        std::fs::create_dir_all(&home).unwrap();
        // Never the real profile: everything lands in this throwaway home.
        std::env::set_var("HERMES_HOME", &home);

        let state = Arc::new(crate::AppState::new(crate::AppMode::Install));
        let events: Arc<std::sync::Mutex<Vec<PrivateAiEvent>>> = Arc::new(std::sync::Mutex::new(Vec::new()));
        let last_bucket = Arc::new(std::sync::Mutex::new(String::new()));
        let (sink_events, sink_bucket) = (events.clone(), last_bucket.clone());
        let sink: EventSink = Arc::new(move |e| {
            match &e {
                PrivateAiEvent::Stage { name, state, detail, error } => eprintln!(
                    "[stage] {name:<26} {state:?} {}{}",
                    detail.clone().unwrap_or_default(),
                    error.as_ref().map(|x| format!(" ERROR: {x}")).unwrap_or_default()
                ),
                PrivateAiEvent::Progress { stage, fraction, detail } => {
                    let bucket = format!("{stage}:{}", ((fraction * 10.0) as u32) * 10);
                    let mut last = sink_bucket.lock().unwrap();
                    if *last != bucket {
                        *last = bucket;
                        eprintln!("[progress] {stage:<26} {:>3.0}%  {detail}", fraction * 100.0);
                    }
                }
                PrivateAiEvent::Failed { error, .. } => eprintln!("[FAILED] {error}"),
                PrivateAiEvent::Complete { report, config } => {
                    eprintln!(
                        "[complete] passed={} model={} embedding={} runtime={} at {}",
                        report.passed, config.models.generation, config.models.embedding,
                        config.ollama.runtime_version, config.ollama.base_url
                    );
                    let m = &report.metrics;
                    eprintln!(
                        "[metrics] startup={:?}ms load={:?}ms first_token={:?}ms tps={:?} embed={:?}ms mode={:?}",
                        m.runtime_startup_ms, m.model_load_ms, m.time_to_first_token_ms,
                        m.tokens_per_second.map(|v| (v * 10.0).round() / 10.0), m.embedding_latency_ms, m.execution_mode
                    );
                    for c in &report.checks {
                        eprintln!("[check] {:<26} {:?}  {}", c.id, c.status, c.detail);
                    }
                    for w in &report.warnings {
                        eprintln!("[warning] {w}");
                    }
                }
                PrivateAiEvent::Manifest { .. } => {}
            }
            sink_events.lock().unwrap().push(e);
        });

        let (_cancel_tx, cancel_rx) = mpsc::channel::<()>(1);
        let started = Instant::now();
        let result = run(sink, state.clone(), "legal-compact-dev".to_string(), cancel_rx).await;
        eprintln!("[e2e] finished in {:.0}s", started.elapsed().as_secs_f64());

        // Stop the runtime we started, whatever happened.
        if let Some(mut child) = state.managed_runtime.lock().await.take() {
            let _ = child.kill().await;
        }
        assert!(result.is_ok(), "provisioning failed: {result:?}");

        let evs = events.lock().unwrap();
        let (report, config) = evs
            .iter()
            .find_map(|e| match e {
                PrivateAiEvent::Complete { report, config } => Some((report.clone(), config.clone())),
                _ => None,
            })
            .expect("a Complete event");
        assert!(report.passed, "validation must pass: {:?}", report.failed_checks().collect::<Vec<_>>());
        assert_eq!(config.models.generation, "qwen2.5:0.5b");
        assert_eq!(config.models.embedding, "embeddinggemma:300m");
        assert_eq!(config.ollama.runtime_version, "0.33.3");
        assert!(config.ollama.base_url.starts_with("http://127.0.0.1:"));
        assert!(config.validated_at.is_some());

        // What is on disk is what the desktop will load.
        let paths = ManagedRuntimePaths::under(&home);
        let on_disk = runtime::read_runtime_config(&paths).expect("runtime.json validates");
        assert_eq!(on_disk, config);
        assert!(runtime::runtime_is_managed_by_us(&paths));
        assert!(paths.executable().is_file());
        // The user's own model store was never involved.
        assert!(!config.ollama.models_path.contains(".ollama"));
        eprintln!("[e2e] HERMES_HOME kept for inspection: {}", home.display());
    }

    #[test]
    fn resolve_plan_rejects_unknown_and_unavailable_profiles() {
        assert!(resolve_plan("no-such-profile").unwrap_err().contains("not in the approved catalogue"));
        // A real dev profile resolves to a runtime for this machine.
        if crate::component_manifest::current_platform() != Some(crate::component_manifest::Platform::Linux) {
            let plan = resolve_plan("legal-compact-dev").unwrap();
            assert_eq!(plan.component.id, "ollama");
            assert_eq!(plan.profile.ollama_model, "qwen2.5:0.5b");
            assert_eq!(plan.loaded.embedding_model, "embeddinggemma:300m");
            assert_eq!(plan.smaller_profile_id, None, "compact is the smallest");
            let std_plan = resolve_plan("legal-standard-dev").unwrap();
            assert_eq!(std_plan.smaller_profile_id.as_deref(), Some("legal-compact-dev"));
        }
    }
}
