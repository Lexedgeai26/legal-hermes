# Unified Online Installer implementation plan

Status: active implementation plan

Branch: `feature/unified-online-installer`

Source requirements: `Unified-Online-Installer-PRD-and-Technical-Specification(1).md`
Primary platform: Windows 10 22H2 and Windows 11 x64

## Decision rule

The PRD supplies product requirements. Existing, tested LexEdge behavior remains authoritative when a proposed implementation conflicts with it.

In particular, this work extends the existing Tauri bootstrap installer and Electron application. It does not introduce a second .NET/WiX installer stack. A later enterprise MSI may wrap or invoke the established installer, but it must not duplicate the orchestration and state ownership already present in the repository.

## Non-regression requirements

The unified installer must preserve:

- the current macOS and Windows installation paths;
- the existing `install.ps1` and `install.sh` stage protocol;
- packaged-source installation and commit pinning;
- install, update, retry, repair, cancellation, logging, and desktop hand-off;
- existing Hermes profiles, sessions, skills, Matter Workspaces, and user documents;
- provider onboarding and the ability to use cloud or custom providers;
- existing Ollama installations that are not marked as LexEdge-managed;
- profile-aware Hermes home resolution;
- the current Electron security boundary and preload API;
- a fully usable installation when Private AI setup is skipped or unavailable.

Private AI is an additional provider path. It must never silently replace an existing provider or silently fall back from a local model to a cloud model.

## Existing implementation to extend

| Existing component | Current responsibility | Unified-installer extension |
| --- | --- | --- |
| `apps/bootstrap-installer` | Tauri installer shell and React wizard | Add Private AI analysis, model choice, download, and validation screens |
| `bootstrap.rs` | Drives the existing installer state machine | Add additive Private AI states after the base runtime is installed |
| `install_script.rs` | Resolves pinned installer source | Resolve pinned, verified llmfit and Ollama component manifests |
| `paths.rs` | Canonical profile-aware install and log paths | Add managed Private AI runtime/config/model paths without changing Hermes home |
| `events.rs` and `store.ts` | Typed progress protocol | Add typed analysis, recommendation, download, and validation events |
| `scripts/install.ps1` | Installs the current application runtime | Remain the base installer; do not reimplement it in Rust or .NET |
| Electron main/preload | Owns privileged desktop operations | Own the managed Ollama process and expose narrow IPC methods |
| existing provider setup | Configures local and cloud model endpoints | Register the selected managed Ollama endpoint as a local provider |
| existing uninstall code | Removes app/runtime data according to user choice | Distinguish LexEdge-managed models/runtime from unrelated Ollama data |

## Revised installation sequence

The existing application install stays intact. Private AI is layered onto it:

```text
START
  -> EXISTING_BASE_INSTALL
  -> PRIVATE_AI_OFFER
  -> DETECT_HARDWARE
  -> VERIFY_AND_RUN_LLMFIT
  -> FETCH_AND_VERIFY_CATALOGUE
  -> RESOLVE_ENTITLEMENT_IF_REQUIRED
  -> RECOMMEND_MODEL
  -> USER_CONFIRMATION
  -> DOWNLOAD_AND_VERIFY_OLLAMA
  -> INSTALL_MANAGED_RUNTIME
  -> DOWNLOAD_GENERATION_MODEL
  -> DOWNLOAD_EMBEDDING_MODEL
  -> WRITE_RUNTIME_CONFIG
  -> HEALTH_AND_LOOPBACK_CHECK
  -> INFERENCE_AND_EMBEDDING_CHECK
  -> OPTIONAL_PERFORMANCE_WARNING
  -> EXISTING_DESKTOP_HANDOFF
```

Skipping Private AI transitions directly from `PRIVATE_AI_OFFER` to the existing desktop hand-off.

Every new state must be idempotent and record only non-sensitive resume metadata. A cancelled or failed Private AI step must not invalidate a successful base application install.

## Storage contract

Continue using the canonical Hermes home:

```text
Windows: %LOCALAPPDATA%\hermes
macOS/Linux: ~/.hermes
```

Add managed Private AI data below that root:

```text
<HERMES_HOME>/private-ai/
├── runtime/ollama/
├── tools/llmfit/
├── config/runtime.json
├── catalog/
├── models/
├── indexes/
├── downloads/
├── state/
└── logs/
```

Do not introduce `%LOCALAPPDATA%\ProductName` or another competing application root. Existing user-selected matter folders remain external and must never be moved into this tree.

## llmfit integration baseline

The first reviewed baseline is llmfit `v1.1.14`. The upstream project documents non-interactive recommendations through:

```text
llmfit recommend --json --limit <N>
```

The Windows x64 release artifact observed for this baseline is:

```text
llmfit-v1.1.14-x86_64-pc-windows-msvc.zip
SHA-256: ae186bf0acbc91faae49df983f41f735c0624020cb5cc639031e604a503c1a7a
```

This value is research input, not yet a production component manifest. Before shipping, release engineering must copy the artifact to a product-controlled distribution location, verify its signature and licence, and sign the LexEdge component manifest.

The adapter must support the actual `v1.1.14` response shape, including top-level `models` and `system` objects. Relevant model fields include `name`, `ollama_name`, `best_quant`, `fit_level`, `memory_required_gb`, `estimated_tps`, `run_mode`, `runtime`, `effective_context_length`, `disk_size_gb`, and `score_components`.

Do not call llmfit TUI, server, download, dashboard, sharing, or benchmark features. Do not pass user-controlled shell strings.

## Recommendation boundary

llmfit is one input, not the decision-maker. Selection remains the intersection of:

```text
explicit catalogue alias match
  + hardware fit
  + available disk headroom
  + approved legal benchmark
  + current entitlement, when applicable
  + enabled/not-retired catalogue state
```

Rules:

- Normalize case and harmless punctuation only.
- Never fuzzy-match parameter sizes or quantizations.
- Never expose an llmfit model that is absent from the signed LexEdge catalogue.
- Never let a plan force a model that fails a hardware or disk hard limit.
- Prefer a conservative smaller profile when analysis is incomplete.
- Always validate the installed model with real local inference.
- Show reasons for inclusion, exclusion, recommendation, and warnings.

## Existing Ollama policy

An already running Ollama instance is not assumed to be owned by LexEdge.

1. Probe the port and Ollama API.
2. Inspect the managed-runtime marker and configured path.
3. If compatible but not managed, offer to use it or install an isolated managed runtime.
4. Default to the isolated runtime.
5. Never overwrite, stop, upgrade, or uninstall an unrelated instance.

The managed process must bind to loopback, use a LexEdge-controlled model directory, and disable Ollama cloud behavior. If port `11434` is already owned, choose and persist another free loopback port.

## Electron integration

The Electron main process—not renderer JavaScript—owns:

- runtime configuration validation;
- managed process start, health, restart, and stop;
- localhost HTTP requests;
- model enumeration and selection;
- streamed chat and embedding requests;
- request timeout and cancellation;
- narrow, validated IPC messages;
- diagnostics with prompt/document redaction.

The renderer receives display-safe status only. Existing provider configuration remains the source of truth for which provider a profile uses.

## Security gates before activation

- Signed component and catalogue manifests.
- SHA-256 verification before extraction or execution.
- Authenticode verification for Windows executables.
- Pinned versions; never request `latest` during installation.
- Loopback address validation before starting Ollama.
- Post-start socket enumeration confirming no non-loopback listener.
- Atomic runtime configuration writes.
- Least-privilege directory ACLs.
- No activation credential, prompt, document text, username, or full personal path in logs.
- Synthetic text only in installer validation.
- Explicit user approval before changing an existing provider selection.

## Delivery slices

### Slice 1 — contracts and deterministic recommendation

- Define normalized hardware, llmfit result, catalogue, entitlement, recommendation, and runtime-config contracts.
- Add JSON schemas and captured llmfit fixtures.
- Implement exact alias matching, hard filters, deterministic scoring, and conservative fallback.
- Unit-test the documented Windows hardware matrix boundaries.

### Slice 2 — verified analyser execution

- Add a signed component manifest format.
- Download and verify the pinned llmfit package.
- Execute directly with a hidden window, timeout, bounded output, cancellation, and process-tree termination.
- Parse only supported versions through versioned adapters.
- Cross-check critical RAM/VRAM facts against installer detection.

### Slice 3 — installer experience

- Add privacy/notice, analysis, recommendation, location, download, validation, and performance-warning screens.
- Extend typed installer events and resume state.
- Keep Private AI optional and preserve the existing fast install path.

### Slice 4 — managed Ollama lifecycle

- Download and verify a pinned standalone Ollama runtime.
- Resolve an isolated loopback port and model directory.
- Install generation and embedding models with resumable progress.
- Add health, inference, embedding, execution-mode, and listener checks.

### Slice 5 — desktop lifecycle

- Validate and load `runtime.json` in Electron main.
- Supervise the managed runtime.
- Register the endpoint through existing provider configuration.
- Add model change, repair, diagnostics, and managed uninstall choices.

### Slice 6 — release readiness

- Signing, SBOM, dependency scanning, licence notices, proxy/certificate tests, rollback, clean-machine validation, and staged rollout.

## Definition of done for Phase 1

Phase 1 is complete only when a Windows x64 user can opt into Private AI, receive a deterministic compatible-model recommendation, install a verified managed runtime and two models, pass loopback/inference/embedding checks, launch the existing Electron application, and use the selected local provider without command-line work or regression to existing installation and provider paths.

## Open production inputs

The following cannot be invented in source code and must be supplied before a production installer is released:

- product-controlled component/catalogue URLs;
- catalogue signing public key and key-rotation policy;
- signed entitlement endpoint and token-storage contract;
- approved model profiles, immutable model identifiers, and licences;
- legal benchmark version, scores, thresholds, and approval owner;
- pinned Ollama artifact, hash, licence notice, and rollback version;
- generation/embedding benchmark thresholds by hardware class;
- Windows publisher certificate and signing pipeline.

Development must use synthetic fixtures until these inputs are approved.
