//! Private AI validation gate (PRD 20).
//!
//! Setup may only be marked complete when real local inference has been
//! demonstrated. Two rules matter more than the individual checks:
//!
//!   * The installer never silently substitutes a model. A slow-but-working
//!     profile produces a warning and an *advisory* smaller-profile suggestion;
//!     the selected model in the report is always the one the user chose.
//!   * Loopback-only binding is confirmed with an actual socket test against
//!     this machine's real network address, not inferred from configuration.

use std::future::Future;
use std::net::{IpAddr, SocketAddr, TcpStream, UdpSocket};
use std::time::Duration;

use serde::Serialize;

const VALIDATION_SCHEMA_VERSION: u32 = 1;
/// Below this fraction of the profile's target throughput we warn and offer a
/// smaller profile. Chosen so a merely-modest machine does not nag.
const SLOW_TPS_FRACTION: f64 = 0.5;
/// A first token that takes longer than this makes the app feel broken.
const MAX_TIME_TO_FIRST_TOKEN_MS: u64 = 15_000;
const SOCKET_TEST_TIMEOUT: Duration = Duration::from_millis(750);

// ---------------------------------------------------------------------------
// Report types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CheckStatus {
    Passed,
    Failed,
    /// Not determinable on this platform. Never a substitute for Failed.
    Skipped,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationCheck {
    pub id: &'static str,
    pub title: &'static str,
    pub status: CheckStatus,
    pub detail: String,
}

impl ValidationCheck {
    fn passed(id: &'static str, title: &'static str, detail: impl Into<String>) -> Self {
        Self { id, title, status: CheckStatus::Passed, detail: detail.into() }
    }
    fn failed(id: &'static str, title: &'static str, detail: impl Into<String>) -> Self {
        Self { id, title, status: CheckStatus::Failed, detail: detail.into() }
    }
    fn skipped(id: &'static str, title: &'static str, detail: impl Into<String>) -> Self {
        Self { id, title, status: CheckStatus::Skipped, detail: detail.into() }
    }
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceMetrics {
    pub runtime_startup_ms: Option<u64>,
    pub model_load_ms: Option<u64>,
    pub time_to_first_token_ms: Option<u64>,
    pub tokens_per_second: Option<f64>,
    pub embedding_latency_ms: Option<u64>,
    pub execution_mode: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationReport {
    pub schema_version: u32,
    pub passed: bool,
    pub checks: Vec<ValidationCheck>,
    pub metrics: PerformanceMetrics,
    pub warnings: Vec<String>,
    /// Advisory only — presented to the user as an option. The installer must
    /// never act on this by itself.
    pub suggested_smaller_profile: Option<String>,
    /// Echoed back so a caller can prove no substitution occurred.
    pub selected_generation_model: String,
    pub selected_embedding_model: String,
}

impl ValidationReport {
    pub fn failed_checks(&self) -> impl Iterator<Item = &ValidationCheck> {
        self.checks.iter().filter(|c| c.status == CheckStatus::Failed)
    }
}

// ---------------------------------------------------------------------------
// Probe boundary
// ---------------------------------------------------------------------------

/// One streamed generation, measured.
#[derive(Debug, Clone, Default)]
pub struct StreamSample {
    pub time_to_first_token_ms: u64,
    pub token_count: u64,
    pub tokens_per_second: Option<f64>,
    pub model_load_ms: Option<u64>,
    pub text: String,
}

/// The runtime surface validation needs. Abstracted so the decision logic can
/// be tested exhaustively without a live Ollama.
pub trait RuntimeProbe {
    fn version(&self) -> impl Future<Output = Result<String, String>>;
    fn installed_models(&self) -> impl Future<Output = Result<Vec<String>, String>>;
    fn generate_stream(
        &self,
        model: &str,
        prompt: &str,
    ) -> impl Future<Output = Result<StreamSample, String>>;
    fn generate_json(
        &self,
        model: &str,
        prompt: &str,
    ) -> impl Future<Output = Result<String, String>>;
    fn embed(&self, model: &str, text: &str)
        -> impl Future<Output = Result<(Vec<f64>, u64), String>>;
    fn execution_mode(&self, model: &str) -> impl Future<Output = Option<String>>;
}

#[derive(Debug, Clone)]
pub struct ValidationRequest {
    pub port: u16,
    pub expected_runtime_version: String,
    pub generation_model: String,
    pub embedding_model: String,
    pub expected_embedding_dimensions: usize,
    pub target_tokens_per_second: f64,
    /// The next smaller compatible profile, if one exists.
    pub smaller_profile_id: Option<String>,
    pub runtime_startup_ms: Option<u64>,
}

/// Synthetic probes only. Client documents and user prompts must never be used
/// to warm or validate a model.
const WARMUP_PROMPT: &str = "Reply with the single word: ready.";
const STRUCTURED_PROMPT: &str = concat!(
    "Return only JSON matching {\"status\":string,\"count\":number}. ",
    "Use status \"ok\" and count 1."
);
const EMBEDDING_PROBE: &str = "Synthetic validation sentence for embedding dimensions.";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

pub async fn validate_private_ai<P: RuntimeProbe>(
    probe: &P,
    request: &ValidationRequest,
) -> ValidationReport {
    let mut checks = Vec::new();
    let mut warnings = Vec::new();
    let mut metrics = PerformanceMetrics {
        runtime_startup_ms: request.runtime_startup_ms,
        ..Default::default()
    };

    // 1. Runtime process started.
    checks.push(match request.runtime_startup_ms {
        Some(ms) => ValidationCheck::passed(
            "runtime_started",
            "Runtime process starts",
            format!("Started in {ms} ms"),
        ),
        None => ValidationCheck::skipped(
            "runtime_started",
            "Runtime process starts",
            "Attached to an already-running managed runtime",
        ),
    });

    // 2 + 3. API responds, and the version matches the pinned policy.
    let version = probe.version().await;
    match &version {
        Ok(found) => {
            checks.push(ValidationCheck::passed(
                "api_responds",
                "API responds on loopback",
                format!("Runtime reported version {found}"),
            ));
            checks.push(if found == &request.expected_runtime_version {
                ValidationCheck::passed(
                    "runtime_version",
                    "Runtime version matches policy",
                    format!("Pinned version {found}"),
                )
            } else {
                ValidationCheck::failed(
                    "runtime_version",
                    "Runtime version matches policy",
                    format!(
                        "Expected {}, found {found}",
                        request.expected_runtime_version
                    ),
                )
            });
        }
        Err(err) => {
            checks.push(ValidationCheck::failed(
                "api_responds",
                "API responds on loopback",
                err.clone(),
            ));
            checks.push(ValidationCheck::failed(
                "runtime_version",
                "Runtime version matches policy",
                "Runtime did not respond",
            ));
        }
    }

    // 4 + 5. Both required models are present, by exact tag.
    match probe.installed_models().await {
        Ok(models) => {
            for (id, title, wanted) in [
                (
                    "generation_model",
                    "Generation model installed",
                    &request.generation_model,
                ),
                (
                    "embedding_model",
                    "Embedding model installed",
                    &request.embedding_model,
                ),
            ] {
                checks.push(if models.iter().any(|m| m == wanted) {
                    ValidationCheck::passed(id, title, format!("Found {wanted}"))
                } else {
                    ValidationCheck::failed(id, title, format!("{wanted} is not installed"))
                });
            }
        }
        Err(err) => {
            checks.push(ValidationCheck::failed(
                "generation_model",
                "Generation model installed",
                err.clone(),
            ));
            checks.push(ValidationCheck::failed(
                "embedding_model",
                "Embedding model installed",
                err,
            ));
        }
    }

    // 6. Deterministic structured extraction returns parseable JSON.
    checks.push(
        match probe
            .generate_json(&request.generation_model, STRUCTURED_PROMPT)
            .await
        {
            Ok(text) => match serde_json::from_str::<serde_json::Value>(&text) {
                Ok(value) if value.is_object() => ValidationCheck::passed(
                    "structured_json",
                    "Structured JSON output",
                    "Model returned a parseable JSON object",
                ),
                Ok(_) => ValidationCheck::failed(
                    "structured_json",
                    "Structured JSON output",
                    "Model returned JSON that was not an object",
                ),
                Err(_) => ValidationCheck::failed(
                    "structured_json",
                    "Structured JSON output",
                    "Model did not return parseable JSON",
                ),
            },
            Err(err) => {
                ValidationCheck::failed("structured_json", "Structured JSON output", err)
            }
        },
    );

    // 7. A short streamed response succeeds, and is timed.
    match probe
        .generate_stream(&request.generation_model, WARMUP_PROMPT)
        .await
    {
        Ok(sample) if sample.token_count > 0 => {
            metrics.time_to_first_token_ms = Some(sample.time_to_first_token_ms);
            metrics.tokens_per_second = sample.tokens_per_second;
            metrics.model_load_ms = sample.model_load_ms;
            checks.push(ValidationCheck::passed(
                "streamed_generation",
                "Streamed response generation",
                format!(
                    "{} tokens, first token in {} ms",
                    sample.token_count, sample.time_to_first_token_ms
                ),
            ));
            if sample.time_to_first_token_ms > MAX_TIME_TO_FIRST_TOKEN_MS {
                warnings.push(format!(
                    "The first token took {} ms, which will feel slow in normal use.",
                    sample.time_to_first_token_ms
                ));
            }
        }
        Ok(_) => checks.push(ValidationCheck::failed(
            "streamed_generation",
            "Streamed response generation",
            "The model produced no tokens",
        )),
        Err(err) => checks.push(ValidationCheck::failed(
            "streamed_generation",
            "Streamed response generation",
            err,
        )),
    }

    // 8. Embeddings generate at the expected dimension.
    checks.push(
        match probe
            .embed(&request.embedding_model, EMBEDDING_PROBE)
            .await
        {
            Ok((vector, latency_ms)) => {
                metrics.embedding_latency_ms = Some(latency_ms);
                if vector.len() == request.expected_embedding_dimensions {
                    ValidationCheck::passed(
                        "embedding_dimensions",
                        "Embedding generation and dimensions",
                        format!("{} dimensions", vector.len()),
                    )
                } else {
                    ValidationCheck::failed(
                        "embedding_dimensions",
                        "Embedding generation and dimensions",
                        format!(
                            "Expected {} dimensions, received {}",
                            request.expected_embedding_dimensions,
                            vector.len()
                        ),
                    )
                }
            }
            Err(err) => ValidationCheck::failed(
                "embedding_dimensions",
                "Embedding generation and dimensions",
                err,
            ),
        },
    );

    // 9. Execution mode, when the runtime can tell us.
    let execution_mode = probe.execution_mode(&request.generation_model).await;
    metrics.execution_mode = execution_mode.clone();
    checks.push(match &execution_mode {
        Some(mode) => ValidationCheck::passed(
            "execution_mode",
            "Execution mode recorded",
            format!("Running on {mode}"),
        ),
        None => ValidationCheck::skipped(
            "execution_mode",
            "Execution mode recorded",
            "The runtime did not report an execution mode",
        ),
    });

    // 10. Actual socket test: nothing may answer off loopback.
    checks.push(match non_loopback_listener(request.port) {
        NonLoopbackProbe::None => ValidationCheck::passed(
            "loopback_only",
            "Loopback-only network binding",
            "No listener answered on a non-loopback address",
        ),
        NonLoopbackProbe::Unavailable => ValidationCheck::passed(
            "loopback_only",
            "Loopback-only network binding",
            "No non-loopback address is configured on this machine",
        ),
        NonLoopbackProbe::Reachable(addr) => ValidationCheck::failed(
            "loopback_only",
            "Loopback-only network binding",
            format!("The runtime answered on {addr}, which is not loopback"),
        ),
    });

    // Throughput is a warning, never a failure, and never a substitution.
    let suggested_smaller_profile = evaluate_throughput(
        metrics.tokens_per_second,
        request.target_tokens_per_second,
        request.smaller_profile_id.as_deref(),
        &mut warnings,
    );

    let passed = !checks.iter().any(|c| c.status == CheckStatus::Failed);

    ValidationReport {
        schema_version: VALIDATION_SCHEMA_VERSION,
        passed,
        checks,
        metrics,
        warnings,
        suggested_smaller_profile,
        selected_generation_model: request.generation_model.clone(),
        selected_embedding_model: request.embedding_model.clone(),
    }
}

/// Returns the advisory smaller profile, if throughput warrants offering one.
fn evaluate_throughput(
    measured: Option<f64>,
    target: f64,
    smaller_profile: Option<&str>,
    warnings: &mut Vec<String>,
) -> Option<String> {
    let (Some(measured), true) = (measured, target > 0.0) else {
        return None;
    };
    if measured >= target * SLOW_TPS_FRACTION {
        return None;
    }
    warnings.push(format!(
        "This model runs at about {measured:.1} tokens per second on this machine, \
         below the {target:.0} expected for the profile."
    ));
    match smaller_profile {
        Some(profile) => {
            warnings.push(
                "A smaller compatible model is available. Your selected model has not been \
                 changed — switching is your choice."
                    .to_string(),
            );
            Some(profile.to_string())
        }
        None => None,
    }
}

// ---------------------------------------------------------------------------
// Socket test
// ---------------------------------------------------------------------------

#[derive(Debug, PartialEq, Eq)]
pub enum NonLoopbackProbe {
    /// Nothing answered off loopback.
    None,
    /// This machine has no usable non-loopback address to test against.
    Unavailable,
    /// Something answered — the binding is wrong.
    Reachable(SocketAddr),
}

/// Learn this machine's primary outbound address without sending a packet, then
/// try to reach `port` on it. A connection means the runtime is bound wider
/// than loopback.
pub fn non_loopback_listener(port: u16) -> NonLoopbackProbe {
    let Some(local) = primary_non_loopback_address() else {
        return NonLoopbackProbe::Unavailable;
    };
    let target = SocketAddr::new(local, port);
    match TcpStream::connect_timeout(&target, SOCKET_TEST_TIMEOUT) {
        Ok(_) => NonLoopbackProbe::Reachable(target),
        Err(_) => NonLoopbackProbe::None,
    }
}

fn primary_non_loopback_address() -> Option<IpAddr> {
    // Connecting a UDP socket assigns a source address from the routing table
    // without transmitting anything.
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("203.0.113.1:9").ok()?;
    let addr = socket.local_addr().ok()?.ip();
    (!addr.is_loopback() && !addr.is_unspecified()).then_some(addr)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Clone)]
    struct FakeProbe {
        version: Result<String, String>,
        models: Vec<String>,
        json: Result<String, String>,
        stream: Result<StreamSample, String>,
        embedding_dimensions: usize,
        mode: Option<String>,
    }

    impl Default for FakeProbe {
        fn default() -> Self {
            Self {
                version: Ok("0.12.0".to_string()),
                models: vec!["legal-test:9b".to_string(), "embedding-test:300m".to_string()],
                json: Ok(r#"{"status":"ok","count":1}"#.to_string()),
                stream: Ok(StreamSample {
                    time_to_first_token_ms: 400,
                    token_count: 12,
                    tokens_per_second: Some(30.0),
                    model_load_ms: Some(900),
                    text: "ready".to_string(),
                }),
                embedding_dimensions: 768,
                mode: Some("metal".to_string()),
            }
        }
    }

    impl RuntimeProbe for FakeProbe {
        async fn version(&self) -> Result<String, String> {
            self.version.clone()
        }
        async fn installed_models(&self) -> Result<Vec<String>, String> {
            Ok(self.models.clone())
        }
        async fn generate_stream(&self, _: &str, _: &str) -> Result<StreamSample, String> {
            self.stream.clone()
        }
        async fn generate_json(&self, _: &str, _: &str) -> Result<String, String> {
            self.json.clone()
        }
        async fn embed(&self, _: &str, _: &str) -> Result<(Vec<f64>, u64), String> {
            Ok((vec![0.1; self.embedding_dimensions], 42))
        }
        async fn execution_mode(&self, _: &str) -> Option<String> {
            self.mode.clone()
        }
    }

    fn request() -> ValidationRequest {
        ValidationRequest {
            // Port 1 is never our runtime, so the socket test resolves cleanly.
            port: 1,
            expected_runtime_version: "0.12.0".to_string(),
            generation_model: "legal-test:9b".to_string(),
            embedding_model: "embedding-test:300m".to_string(),
            expected_embedding_dimensions: 768,
            target_tokens_per_second: 20.0,
            smaller_profile_id: Some("legal-compact".to_string()),
            runtime_startup_ms: Some(1_500),
        }
    }

    fn status(report: &ValidationReport, id: &str) -> CheckStatus {
        report.checks.iter().find(|c| c.id == id).unwrap().status
    }

    #[tokio::test]
    async fn a_healthy_runtime_passes_every_check() {
        let report = validate_private_ai(&FakeProbe::default(), &request()).await;
        assert!(report.passed, "failed: {:?}", report.failed_checks().collect::<Vec<_>>());
        assert_eq!(report.checks.len(), 10, "PRD 20.1 defines ten checks");
        assert!(report.warnings.is_empty());
        assert_eq!(report.suggested_smaller_profile, None);
        assert_eq!(report.metrics.tokens_per_second, Some(30.0));
        assert_eq!(report.metrics.embedding_latency_ms, Some(42));
        assert_eq!(report.metrics.execution_mode.as_deref(), Some("metal"));
    }

    #[tokio::test]
    async fn a_wrong_runtime_version_fails_closed() {
        let mut probe = FakeProbe::default();
        probe.version = Ok("0.11.9".to_string());
        let report = validate_private_ai(&probe, &request()).await;
        assert!(!report.passed);
        assert_eq!(status(&report, "runtime_version"), CheckStatus::Failed);
        // The API still answered, so that check stands.
        assert_eq!(status(&report, "api_responds"), CheckStatus::Passed);
    }

    #[tokio::test]
    async fn a_missing_model_fails_and_is_named() {
        let mut probe = FakeProbe::default();
        probe.models = vec!["embedding-test:300m".to_string()];
        let report = validate_private_ai(&probe, &request()).await;
        assert!(!report.passed);
        assert_eq!(status(&report, "generation_model"), CheckStatus::Failed);
        assert_eq!(status(&report, "embedding_model"), CheckStatus::Passed);
    }

    #[tokio::test]
    async fn unparseable_structured_output_fails() {
        let mut probe = FakeProbe::default();
        probe.json = Ok("Certainly! Here is your JSON.".to_string());
        let report = validate_private_ai(&probe, &request()).await;
        assert!(!report.passed);
        assert_eq!(status(&report, "structured_json"), CheckStatus::Failed);
    }

    #[tokio::test]
    async fn a_json_array_is_not_an_acceptable_object() {
        let mut probe = FakeProbe::default();
        probe.json = Ok("[1,2,3]".to_string());
        let report = validate_private_ai(&probe, &request()).await;
        assert_eq!(status(&report, "structured_json"), CheckStatus::Failed);
    }

    #[tokio::test]
    async fn wrong_embedding_dimensions_fail() {
        let mut probe = FakeProbe::default();
        probe.embedding_dimensions = 384;
        let report = validate_private_ai(&probe, &request()).await;
        assert!(!report.passed);
        assert_eq!(status(&report, "embedding_dimensions"), CheckStatus::Failed);
    }

    #[tokio::test]
    async fn a_stream_with_no_tokens_fails() {
        let mut probe = FakeProbe::default();
        probe.stream = Ok(StreamSample { token_count: 0, ..Default::default() });
        let report = validate_private_ai(&probe, &request()).await;
        assert!(!report.passed);
        assert_eq!(status(&report, "streamed_generation"), CheckStatus::Failed);
    }

    #[tokio::test]
    async fn a_dead_runtime_fails_both_api_and_version_checks() {
        let mut probe = FakeProbe::default();
        probe.version = Err("connection refused".to_string());
        let report = validate_private_ai(&probe, &request()).await;
        assert!(!report.passed);
        assert_eq!(status(&report, "api_responds"), CheckStatus::Failed);
        assert_eq!(status(&report, "runtime_version"), CheckStatus::Failed);
    }

    #[tokio::test]
    async fn an_unreported_execution_mode_is_skipped_not_failed() {
        let mut probe = FakeProbe::default();
        probe.mode = None;
        let report = validate_private_ai(&probe, &request()).await;
        assert_eq!(status(&report, "execution_mode"), CheckStatus::Skipped);
        assert!(report.passed, "a skipped optional check must not fail the gate");
    }

    #[tokio::test]
    async fn a_slow_model_warns_and_offers_but_never_substitutes() {
        let mut probe = FakeProbe::default();
        probe.stream = Ok(StreamSample {
            time_to_first_token_ms: 400,
            token_count: 12,
            tokens_per_second: Some(4.0), // target is 20
            model_load_ms: Some(900),
            text: "ready".to_string(),
        });
        let report = validate_private_ai(&probe, &request()).await;

        // Slow is a warning, not a failure: the model does work.
        assert!(report.passed);
        assert_eq!(report.suggested_smaller_profile.as_deref(), Some("legal-compact"));
        assert!(report.warnings.iter().any(|w| w.contains("tokens per second")));
        assert!(report
            .warnings
            .iter()
            .any(|w| w.contains("has not been changed")));
        // The selected model is untouched — no silent substitution.
        assert_eq!(report.selected_generation_model, "legal-test:9b");
    }

    #[tokio::test]
    async fn a_slow_model_with_no_smaller_option_warns_without_offering() {
        let mut probe = FakeProbe::default();
        probe.stream = Ok(StreamSample {
            tokens_per_second: Some(2.0),
            token_count: 5,
            ..Default::default()
        });
        let mut req = request();
        req.smaller_profile_id = None;
        let report = validate_private_ai(&probe, &req).await;
        assert_eq!(report.suggested_smaller_profile, None);
        assert!(!report.warnings.is_empty());
    }

    #[tokio::test]
    async fn a_slow_first_token_warns_without_failing() {
        let mut probe = FakeProbe::default();
        probe.stream = Ok(StreamSample {
            time_to_first_token_ms: 30_000,
            token_count: 3,
            tokens_per_second: Some(25.0),
            ..Default::default()
        });
        let report = validate_private_ai(&probe, &request()).await;
        assert!(report.passed);
        assert!(report.warnings.iter().any(|w| w.contains("feel slow")));
    }

    #[test]
    fn throughput_at_target_produces_no_warning() {
        let mut warnings = Vec::new();
        assert_eq!(
            evaluate_throughput(Some(20.0), 20.0, Some("smaller"), &mut warnings),
            None
        );
        assert!(warnings.is_empty());
        // Exactly on the warn boundary is still acceptable.
        assert_eq!(
            evaluate_throughput(Some(10.0), 20.0, Some("smaller"), &mut warnings),
            None
        );
        assert!(warnings.is_empty());
    }

    #[test]
    fn unknown_throughput_never_invents_a_recommendation() {
        let mut warnings = Vec::new();
        assert_eq!(evaluate_throughput(None, 20.0, Some("smaller"), &mut warnings), None);
        assert!(warnings.is_empty());
    }

    #[test]
    fn socket_test_reports_a_listener_bound_to_all_interfaces() {
        // Bind 0.0.0.0 the way a misconfigured runtime would.
        let listener = std::net::TcpListener::bind("0.0.0.0:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        match non_loopback_listener(port) {
            // On a machine with a routable address this must be caught.
            NonLoopbackProbe::Reachable(addr) => assert!(!addr.ip().is_loopback()),
            // A machine with no non-loopback address cannot be tested.
            NonLoopbackProbe::Unavailable => {}
            NonLoopbackProbe::None => panic!("a 0.0.0.0 listener must be detected"),
        }
    }

    #[test]
    fn socket_test_passes_for_a_loopback_only_listener() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        assert!(matches!(
            non_loopback_listener(port),
            NonLoopbackProbe::None | NonLoopbackProbe::Unavailable
        ));
    }
}
