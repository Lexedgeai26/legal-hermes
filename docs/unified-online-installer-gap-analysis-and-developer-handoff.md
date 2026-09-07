# Unified Online Installer: Gap Analysis and Developer Handoff

Status: implementation handoff

Target outcome: 100% production-ready unified installer

Repository: `https://github.com/Lexedgeai26/legal-hermes`

Working branch: `feature/unified-online-installer`

Baseline commit: `0d30f277fb`

Related documents:

- `docs/unified-online-installer-implementation-plan.md`
- `Unified-Online-Installer-PRD-and-Technical-Specification(1).md`

## 1. Purpose

This document tells an implementation team exactly what remains to complete the unified Private AI installer. It is both a gap analysis and an execution plan. It defines architecture boundaries, work packages, acceptance criteria, test cases, release gates, and the external decisions that must be supplied by LexEdge.

The original PRD is a requirements source, not permission to replace working architecture. When it conflicts with an existing tested feature, the existing feature wins unless a separately approved migration plan proves backward compatibility.

## 2. Non-negotiable compatibility rule

Extend the existing Tauri bootstrap installer in `apps/bootstrap-installer`. Do not create the separate .NET/WiX bootstrapper proposed by the original PRD. An enterprise MSI may later wrap or invoke the established installer, but must not duplicate installation orchestration or state ownership.

The completed implementation must preserve:

- Existing macOS and Windows installation paths.
- `scripts/install.ps1` and `scripts/install.sh` stage contracts.
- Install, update, retry, cancellation, repair, logs, and desktop handoff.
- Hermes profiles and profile-aware `HERMES_HOME` handling.
- Existing sessions, skills, n8n support, Matter Workspaces, indexes, and user documents.
- Existing cloud, OAuth, API-key, and custom provider onboarding.
- The user's ability to choose a provider later.
- Existing Ollama installations not explicitly marked as LexEdge-managed.
- Electron context isolation, sandboxing, and narrow preload APIs.
- A usable base installation when Private AI is skipped, unavailable, or fails.

Private AI is additive. It must never silently replace an existing provider, silently fall back to cloud inference, or make the base installer fail after the base application has installed successfully.

## 3. Current verified status

### 3.1 Completed

The branch currently includes:

- A compatibility-first implementation plan.
- Rust contracts for normalized hardware input, llmfit output, legal model catalogue, entitlement profile IDs, recommendation output, and managed runtime configuration.
- Exact normalized alias matching between llmfit and catalogue models.
- Hard filtering for catalogue state, legal approval, entitlement, RAM, VRAM, backend, disk headroom, and incompatible llmfit results.
- Deterministic weighted recommendation scoring.
- Conservative behavior when llmfit is unavailable.
- Loopback-only runtime configuration validation.
- JSON Schema files for the legal catalogue and runtime configuration.
- A synthetic fixture matching the observed llmfit `v1.1.14` output shape.
- Tauri commands for recommendation and runtime configuration validation.
- Eleven passing focused Rust tests.
- A successful TypeScript typecheck for the installer.
- A successful Apple Silicon `.app` build and launch.

Primary files:

- `apps/bootstrap-installer/src-tauri/src/private_ai.rs`
- `apps/bootstrap-installer/src-tauri/schemas/legal-model-catalog.v1.schema.json`
- `apps/bootstrap-installer/src-tauri/schemas/runtime-config.v1.schema.json`
- `apps/bootstrap-installer/src-tauri/test-fixtures/llmfit/v1.1.14/recommend.json`

### 3.2 Completion estimate

The unified Private AI feature is approximately 15–20% complete. The recommendation foundation is testable, but the new experience is not yet connected to installer screens, a real llmfit executable, Ollama, model downloads, or Electron inference.

### 3.3 Not complete

- Native hardware inventory.
- Verified llmfit acquisition and execution.
- Signed component, catalogue, and entitlement verification.
- Installer Private AI screens.
- Resume state for Private AI stages.
- Verified and resumable downloads.
- Managed Ollama ownership and lifecycle.
- Generation and embedding model installation.
- Runtime health, inference, embedding, performance, and listener validation.
- Atomic final runtime configuration writer.
- Electron runtime supervision and controlled IPC.
- Repair and uninstall extensions for managed AI components.
- Production signing, licences, SBOM, security scanning, proxy testing, and staged rollout.
- Enterprise MSI, machine-wide service, offline package, or fleet policy.

### 3.4 Known baseline issue

The focused Private AI tests pass. The complete installer Rust suite currently exposes an unchanged macOS-only test defect in `update::tests::lock_probe_paths_include_desktop_app_payload`: the assertion checks lowercase `resources/app.asar`, while the generated macOS path uses `Resources/app.asar`. Fix this test portability issue before making the full-suite gate mandatory. Do not weaken the underlying lock-probe behavior.

The local `.app` bundle builds. DMG decoration failed locally during Finder/AppleScript automation. Treat DMG generation and signing as a separate packaging gap; do not interpret the successful local `.app` launch as a distributable signed release.

## 4. Required end state

A non-technical user must be able to:

1. Start the existing LexEdge installer without administrator rights in per-user mode.
2. Read and accept the Private AI privacy notice or skip Private AI.
3. Have hardware analyzed locally without transmitting identifying hardware data.
4. Receive an explainable recommendation limited to compatible, entitled, legally approved models.
5. Choose another soft-compatible model, but never a hard-incompatible model.
6. See exact download size and storage location before confirmation.
7. Install a verified, isolated, loopback-only Ollama runtime.
8. Install one generation model and one embedding model with resumable progress.
9. Pass health, streaming, structured-output, embedding, listener, and performance checks.
10. Launch the existing Electron app with the local provider available.
11. Keep existing provider selections unless they explicitly approve a change.
12. Repair or uninstall managed AI components without affecting unrelated Ollama data or legal documents.

No command-line work may be required for the standard user path.

## 5. Architecture and ownership

| Concern | Owner | Notes |
| --- | --- | --- |
| Base application installation | Existing scripts and Tauri bootstrap | Preserve current protocol |
| Private AI wizard and progress | Tauri React renderer | Presentation and user choices only |
| Installer orchestration | Tauri Rust backend | Downloads, verification, child processes, state |
| Hardware inventory | Tauri Rust backend | Installer remains authoritative for OS, disk, port, ownership |
| Model-fit estimation | Pinned llmfit adapter | Input to decision, never final authority |
| Model eligibility | Signed LexEdge catalogue and entitlement | Fail closed on invalid signatures |
| Recommendation | Pure Rust engine | Deterministic and explainable |
| Managed Ollama during installation | Tauri Rust backend | Isolated runtime and model directory |
| Runtime after installation | Electron main process | Supervision, health, IPC, requests |
| Provider selection | Existing provider configuration | Private AI registers as an option; no silent replacement |
| Prompts and legal documents | Existing application flows | Never enter installer logs or validation payloads |
| Runtime configuration | Canonical versioned `runtime.json` | Installer writes atomically; Electron validates again |

### 5.1 Storage

All managed data must remain below the canonical profile-aware Hermes home:

```text
Windows: %LOCALAPPDATA%\hermes
macOS/Linux: ~/.hermes

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

Never hardcode `~/.hermes` in code. Use the repository's profile-aware path mechanisms. User-selected Matter Workspace directories remain external and must never be moved or removed.

### 5.2 Required state flow

```text
EXISTING_BASE_INSTALL
  -> PRIVATE_AI_OFFER
  -> DETECT_HARDWARE
  -> VERIFY_AND_RUN_LLMFIT
  -> FETCH_AND_VERIFY_CATALOGUE
  -> RESOLVE_ENTITLEMENT_IF_REQUIRED
  -> RECOMMEND_MODEL
  -> USER_CONFIRMATION
  -> RESOLVE_EXISTING_OLLAMA
  -> DOWNLOAD_AND_VERIFY_RUNTIME
  -> INSTALL_MANAGED_RUNTIME
  -> DOWNLOAD_GENERATION_MODEL
  -> DOWNLOAD_EMBEDDING_MODEL
  -> WRITE_RUNTIME_CONFIG
  -> HEALTH_AND_LOOPBACK_CHECK
  -> INFERENCE_AND_EMBEDDING_CHECK
  -> PERFORMANCE_CHECK
  -> EXISTING_DESKTOP_HANDOFF
```

Skipping or failing optional Private AI setup after the base install must transition safely to the existing desktop handoff. Every state must be idempotent and resumable.

## 6. Canonical runtime contract decision

Runtime configuration Version 1 now uses the nested `ollama`, `models`, `catalog`, and `privacy` structure in `runtime-config.v1.schema.json`. It includes runtime version, cloud-disabled status, managed-process ownership, profile ID, pinned generation and embedding identities, context tokens, catalogue identity, and privacy state.

The earlier flat structure was a development-only draft and was never written by a released installer. It is not accepted for runtime activation. If encountered during development, managed model files are preserved and the canonical file is regenerated only after ownership and model validation succeed. This policy avoids shipping two writable Version 1 formats or inventing missing security-critical values.

Relative paths resolve below profile-aware `HERMES_HOME`; user-selected absolute model paths require boundary validation. The installer must write atomically, and Electron must validate again before runtime start. Golden fixture coverage begins at `test-fixtures/runtime-config/v1/canonical.json`.

## 7. Dependency-ordered implementation plan

Each work package below is an issue-sized developer handoff. A package is complete only when its implementation, tests, documentation, and failure behavior are complete.

### WP-00 — Stabilize baseline and contracts

Deliverables:

- Fix the macOS `Resources/app.asar` test portability defect.
- Finalize canonical runtime configuration Version 1.
- Add JSON Schemas for normalized hardware, normalized llmfit result, entitlement, component manifest, download state, and installer resume state.
- Add a `schemaVersion` and documented migration policy to every persisted object.
- Add Rust/TypeScript contract fixtures and reject unknown required fields or unsupported versions as appropriate.
- Document installer event additions before modifying the UI store.

Acceptance criteria:

- All existing installer tests pass on macOS and Windows CI.
- The same golden runtime fixture validates in Rust and TypeScript.
- Unknown major/schema versions fail with a clear non-sensitive error.
- Existing base install/update behavior is unchanged.

### WP-01 — Native hardware detection

Deliverables:

- Normalized OS, architecture, CPU, core count, total/available RAM, GPUs, VRAM, backend, storage, power, and existing-runtime information.
- Windows CIM/WMI and filesystem implementation.
- DXGI or an equally dependable native source for dedicated VRAM.
- Supplementary NVIDIA evidence from `nvidia-smi` without depending on it.
- macOS implementation sufficient for development and regression testing.
- Port ownership and Ollama API/version probe.
- Redacted hardware summary for logs.

Acceptance criteria:

- No serial number, username, device ID, full personal path, prompt, or document content is collected.
- Disk data is measured for the selected runtime and model volumes.
- Detection failure produces a conservative actionable result, not invented values.
- Independent RAM/VRAM facts can be cross-checked against llmfit.

### WP-02 — Signed component manifest and llmfit runner

Deliverables:

- Versioned signed component manifest containing platform, architecture, URL, size, SHA-256, licence, minimum OS, and signature policy.
- Pinned llmfit release distributed from a product-controlled location.
- MIT licence and attribution.
- HTTPS download with bounded retries, timeout, cancellation, and temporary-file handling.
- SHA-256 and manifest-signature verification before extraction or execution.
- Windows Authenticode verification when required by policy.
- Direct process execution—never through a shell—with hidden window, fixed arguments, sanitized environment, 30-second timeout, 10 MB output cap, separate UTF-8 stdout/stderr, and process-tree termination.
- Versioned adapter for llmfit `v1.1.14` and an explicit unsupported-version result.
- Retain the verified executable under `private-ai/tools/llmfit` for an on-demand future hardware recheck.

Allowed invocation:

```text
llmfit recommend --json --limit <bounded integer>
```

Forbidden invocation paths include the TUI, server, dashboard, sharing, benchmark upload, provider discovery, and model download.

Acceptance criteria:

- No user-controlled shell string is constructed.
- Invalid signature or hash stops that component before execution.
- Timeout, crash, invalid JSON, oversized output, missing executable, and unknown version all activate an explicit conservative fallback.
- Logs record version and redacted result category without full raw hardware output.

### WP-03 — Catalogue, entitlement, and recommendation completion

Deliverables:

- Signed catalogue fetch, cache, expiry, ETag, key ID, signature, and key-rotation handling.
- Exact immutable Ollama tags or approved internally pinned aliases; never `latest`.
- Model licence metadata, minimum runtime version, operational context, retirement/replacement, emergency disablement, llmfit aliases, and legal benchmark provenance.
- Signed entitlement resolution when required.
- Activation credential stored with operating-system secure storage, never plaintext config.
- Recommendation engine inputs extended for OS/architecture, Ollama version, driver constraints, plan ceiling, and available RAM policy.
- User override limited to soft-compatible entitled models.
- Persist recommendation evidence and explicit user selection.

Acceptance criteria:

- A model is selectable only if it passes hardware, disk, runtime, entitlement, catalogue, and legal-approval hard gates.
- Invalid/expired/unsigned catalogue or entitlement fails closed.
- Offline cached catalogue behavior is defined and expiry enforced.
- Recommendation order is deterministic for identical inputs.
- Every inclusion, exclusion, warning, and recommendation has a user-readable reason.

### WP-04 — Installer Private AI experience

Deliverables:

- Privacy/notice and skip screen.
- Local system-analysis progress screen.
- Recommendation screen with friendly model name, fit, speed estimate, memory estimate, operational context, download size, execution mode, reason, and warnings.
- Storage-location selection and validation.
- Existing Ollama choice screen when applicable.
- Download/install progress with component-level and aggregate progress.
- Performance-warning and smaller-model choice.
- Completion summary and existing desktop handoff.
- Typed event additions in Rust and `src/store.ts`.
- Resume/cancel/retry behavior for each new stage.
- Keyboard, screen-reader, scalable-text, and high-contrast support.

Acceptance criteria:

- Private AI can be skipped without changing the existing fast path.
- No unsupported model can be forced from renderer state or IPC.
- Closing and reopening resumes from the last safe committed state.
- UI strings do not live in orchestration code.
- Errors are plain-language and offer safe copyable diagnostics without secrets.

### WP-05 — Verified resumable download manager

Deliverables:

- HTTPS-only allowlisted downloads.
- System proxy, manual HTTPS proxy, Windows trust-store certificates, retry with jitter, and bounded timeout.
- HTTP range resume when supported.
- `.partial` artifacts, expected-length checks, SHA-256 verification, atomic promotion, and corrupt-file deletion.
- Free-space calculation including runtime, both models, temporary data, and configured safety headroom.
- Progress throttling so UI updates remain responsive.
- Persistent non-sensitive resume metadata.

Acceptance criteria:

- Interrupted downloads resume without restarting verified ranges.
- Hash mismatch never reaches extraction or execution.
- Cancellation preserves valid resumable data and removes corrupt temporary files.
- Localhost requests never inherit a broad external proxy.

### WP-06 — Managed Ollama installation and ownership

Deliverables:

- Pinned standalone Ollama runtime with licence notice and verified manifest.
- Existing Ollama detection by API, version, port owner, path, and LexEdge ownership marker.
- Explicit choice between a compatible user runtime and isolated managed runtime.
- Isolated default with a LexEdge-controlled runtime directory, model directory, environment, and port.
- `OLLAMA_HOST` restricted to loopback and `OLLAMA_NO_CLOUD=1` for private-only mode.
- Dynamic free loopback port when `11434` is occupied.
- Hidden managed process and bounded exponential restart.
- Atomic managed marker and runtime configuration.
- No modification, stopping, upgrading, or removal of unrelated Ollama.

Acceptance criteria:

- A post-start socket inspection proves there is no non-loopback listener.
- An unrelated process on `11434` remains untouched.
- Managed ownership can be proven before repair, upgrade, or uninstall.
- Runtime installation is per-user and standard privilege by default.

### WP-07 — Generation and embedding model installation

Deliverables:

- Exact generation and embedding model identities from the signed catalogue.
- Resumable model acquisition with displayed total size.
- Exact installed tag/digest and size verification.
- Generation model warm-up using synthetic text.
- Embedding model endpoint and vector-dimension validation.
- Recorded catalogue/model/runtime versions for auditability.
- Model-change flow with revalidation.
- Explicit re-index plan when embedding identity changes; preserve existing indexes until migration succeeds.

Acceptance criteria:

- Installer cannot complete with only one of the two required models.
- Mutable `latest` tags are rejected.
- A failed larger model offers a smaller compatible profile without silently switching.
- No user document is used for warm-up or validation.

### WP-08 — Runtime validation and benchmark

Deliverables:

- Runtime health and policy-version check.
- Deterministic structured extraction returning parseable JSON.
- Short streamed generation test.
- Embedding vector-dimension test.
- Execution-mode detection where supported.
- Startup, model-load, first-token, tokens/second, working-set, GPU memory/utilization, and embedding-latency metrics where available.
- Threshold policy by hardware/profile.
- Redacted validation summary.

Acceptance criteria:

- Health, exact models, structured output, streaming, embedding, and loopback checks are mandatory.
- Performance below threshold is a warning with an offered smaller model, not an undisclosed substitution.
- Failed validation prevents Private AI activation but does not corrupt the successful base application install.

### WP-09 — Electron managed-runtime integration

Deliverables:

- Runtime configuration loader, schema validation, and migration in Electron main.
- Managed process supervisor with ensure-running, health, reconnect, restart, and stop.
- Main-process-only localhost HTTP client with timeouts and cancellation.
- Narrow validated preload/IPC methods for status, model list, profile selection, streaming chat, embedding, repair, and diagnostics.
- Controlled streaming lifecycle and listener cleanup.
- Private AI starting/ready/degraded/error states.
- Provider registration through existing provider configuration.
- Settings UI showing model, runtime, execution mode, privacy state, repair, diagnostics, and model change.
- Explicit confirmation before changing an existing provider selection.
- No silent cloud fallback.

Required service behavior:

```text
ensureRunning
health
listModels
selectProfile
chat with cancellation and streaming
embed
stop
```

Acceptance criteria:

- Renderer code cannot spawn a process or call arbitrary localhost URLs.
- Invalid IPC payloads are rejected.
- Existing cloud/custom providers and “choose later” onboarding remain unchanged.
- Private AI appears as an additional usable provider after successful validation.

### WP-10 — Upgrade, repair, rollback, and uninstall

Deliverables:

- Separate version channels for application, installer, Ollama, catalogue, model weights, and prompt/policy package.
- Staged runtime update with previous version retained until validation succeeds.
- No model replacement during active inference.
- Administrator version freeze policy.
- Repair verification for app/runtime/configuration/port/models/shortcuts and validation.
- Uninstall choices: app only; app plus managed runtime; app/runtime/models; optional indexes/settings.
- Explicit document exclusion from every deletion set.
- Transaction journal and rollback for installation/update failures.

Acceptance criteria:

- A failed runtime update restores the prior working runtime.
- Repair preserves documents, settings, Matters, and indexes unless an explicit compatible migration is required.
- Uninstall never removes unowned Ollama or user legal documents.
- Every deletion choice is previewed and consented to.

### WP-11 — Security, privacy, licences, and diagnostics

Deliverables:

- Trusted manifest/catalogue public key pinning and rotation process.
- Code signing for release artifacts and platform verification.
- Least-privilege directory ACLs.
- OS secure storage for activation credentials.
- Central structured redaction covering tokens, credentials, prompts, document text, usernames, and full personal paths.
- User-controlled support bundle with preview and consent.
- SBOM, dependency and binary vulnerability scans.
- Ollama, llmfit, model, and dependency licence notices.
- Threat model for downloads, local runtime, IPC, configuration, updates, and uninstall.
- Optional analytics separated from entitlement traffic and disabled without consent.

Acceptance criteria:

- Automated secret/content canary tests prove protected data does not enter logs or support bundles.
- Signature, hash, path traversal, symlink, archive bomb, IPC, and listener security tests pass.
- No release artifact is published if signing or security gates fail.

### WP-12 — Production packaging and release

Deliverables:

- Signed/notarized macOS artifact for supported development/release scope.
- Signed Windows x64 bootstrap installer.
- Reliable DMG packaging that does not depend on an interactive Finder session in CI.
- Reproducible pinned builds and provenance.
- Clean-machine install, upgrade, repair, and uninstall validation.
- Canary, staged rollout, rollback artifacts, and release runbook.
- User-facing installation, privacy, repair, and uninstall documentation.

Acceptance criteria:

- Release pipeline starts from a clean checkout and produces verified artifacts.
- No `latest`, branch head, or mutable component reference is used in production.
- Rollback artifacts are published before rollout.

### WP-13 — Enterprise phase

Deliverables:

- MSI wrapper or deployment package invoking the canonical installer behavior.
- Quiet command-line contract with user/machine scope, activation file, profile, model path, proxy, shortcut, and log options.
- Secrets excluded from command-line values.
- Restricted Windows service identity for machine-wide runtime.
- Private mirrors, offline bundle, administrator policy, version freeze, and fleet-safe diagnostics.
- Enterprise proxy and certificate tooling.

Acceptance criteria:

- Silent mode fails instead of guessing an incompatible or ineligible model.
- Machine-wide installation does not weaken loopback, ACL, ownership, or data-isolation requirements.
- Enterprise packaging does not fork or duplicate the Tauri orchestration logic.

## 8. Complete test catalogue

Every test ID must be automated unless marked `MANUAL-LAB`. Each automated test must be linked to its implementation ticket and CI job.

### 8.1 Contracts and recommendation

| ID | Test |
| --- | --- |
| CON-001 | Valid Version 1 catalogue parses in Rust and TypeScript |
| CON-002 | Unknown catalogue schema version is rejected |
| CON-003 | Duplicate profile IDs are rejected |
| CON-004 | Empty or duplicate normalized aliases are rejected |
| CON-005 | Invalid negative, infinite, or NaN numeric values are rejected |
| CON-006 | Runtime configuration accepts only loopback hosts |
| CON-007 | Runtime configuration rejects privileged/invalid ports |
| CON-008 | Golden runtime fixture round-trips without semantic change |
| CON-009 | Supported old runtime configuration migrates once and atomically |
| CON-010 | Unsupported configuration fails without starting a runtime |
| REC-001 | Exact alias matching tolerates case and harmless punctuation |
| REC-002 | Different parameter sizes never fuzzy-match |
| REC-003 | Entitlement is a hard filter |
| REC-004 | Legal benchmark approval is a hard filter |
| REC-005 | Disabled and retired profiles are excluded |
| REC-006 | Minimum RAM, VRAM, backend, OS, architecture, runtime version, and disk are hard filters |
| REC-007 | llmfit incompatible model is excluded |
| REC-008 | Unmapped llmfit result is excluded and diagnostic recorded |
| REC-009 | Identical inputs produce identical ordering and reasons |
| REC-010 | Exactly one eligible model is marked recommended |
| REC-011 | Soft-compatible override is permitted with warning |
| REC-012 | Hard-incompatible override is rejected at backend boundary |
| REC-013 | Missing/failed llmfit applies recommended-RAM conservative rules |
| REC-014 | Conservative result clearly reports unknown speed/mode |
| REC-015 | Observed llmfit disk size larger than catalogue size is honored |
| REC-016 | Available disk includes runtime, both models, temporary space, and headroom |
| REC-017 | Plan ceiling cannot force oversized model |
| REC-018 | Emergency-disabled catalogue profile disappears immediately after valid update |

### 8.2 Hardware and llmfit

| ID | Test |
| --- | --- |
| HW-001 | Windows 10 x64 normalized inventory |
| HW-002 | Windows 11 x64 normalized inventory |
| HW-003 | 8/16/32/64/128 GB RAM boundary fixtures |
| HW-004 | Intel CPU-only machine |
| HW-005 | AMD CPU-only machine |
| HW-006 | NVIDIA 4/6/8/12/16/24 GB VRAM boundaries |
| HW-007 | Supported and unsupported AMD GPU combinations |
| HW-008 | Integrated plus discrete GPU laptop selects correct primary evidence |
| HW-009 | Battery state is recorded without affecting hard compatibility incorrectly |
| HW-010 | Low disk and removable/network volume behavior |
| HW-011 | Paths with spaces and non-ASCII characters |
| HW-012 | Independent RAM/VRAM disagreement triggers conservative warning |
| LFM-001 | Verified supported llmfit returns valid normalized report |
| LFM-002 | Missing executable activates fallback |
| LFM-003 | Non-zero exit activates fallback |
| LFM-004 | Timeout kills entire process tree and activates fallback |
| LFM-005 | Cancellation kills entire process tree |
| LFM-006 | Invalid JSON activates fallback |
| LFM-007 | Output over 10 MB is terminated/rejected |
| LFM-008 | Invalid UTF-8 is handled safely |
| LFM-009 | Unknown llmfit version activates fallback |
| LFM-010 | Captured fixture for every supported llmfit version parses |
| LFM-011 | TUI/server/share/download modes are never invoked |
| LFM-012 | User-controlled path cannot alter process arguments |
| LFM-013 | Hardware analysis performs no unexpected outbound network connection |

### 8.3 Manifests, catalogue, entitlement, and downloads

| ID | Test |
| --- | --- |
| SIG-001 | Valid manifest and catalogue signatures pass |
| SIG-002 | Modified payload fails signature verification |
| SIG-003 | Unknown key ID fails closed |
| SIG-004 | Approved rotated key passes within policy window |
| SIG-005 | Expired catalogue/entitlement follows documented offline policy |
| SIG-006 | SHA-256 mismatch deletes/quarantines artifact and blocks use |
| ENT-001 | Valid entitlement exposes only allowed profiles |
| ENT-002 | Expired/revoked entitlement fails closed |
| ENT-003 | Activation secret is absent from config and logs |
| ENT-004 | Credential-store read/write/delete lifecycle works |
| DL-001 | Clean download succeeds and atomically promotes |
| DL-002 | Interrupted download resumes with HTTP range |
| DL-003 | Server without range support safely restarts download |
| DL-004 | Retry uses bounded attempts and jitter |
| DL-005 | Cancellation retains valid partial and removes corrupt partial |
| DL-006 | Disk becomes full mid-download |
| DL-007 | Source length differs from manifest |
| DL-008 | TLS/certificate failure does not downgrade security |
| DL-009 | System proxy works |
| DL-010 | Manual HTTPS proxy works |
| DL-011 | Windows enterprise trust-store certificate works |
| DL-012 | Localhost inference bypasses external proxy |
| DL-013 | Redirect to non-allowlisted host is rejected |
| DL-014 | Archive path traversal, symlink escape, and decompression bomb are rejected |

### 8.4 Runtime and models

| ID | Test |
| --- | --- |
| RUN-001 | No Ollama present installs isolated managed runtime |
| RUN-002 | Compatible user Ollama offers use-existing and isolated choices |
| RUN-003 | Incompatible user Ollama defaults to isolated managed runtime |
| RUN-004 | Unrelated process owns `11434`; installer selects free loopback port |
| RUN-005 | Managed marker/path/version/port prove ownership |
| RUN-006 | Runtime starts hidden with controlled environment |
| RUN-007 | `OLLAMA_NO_CLOUD=1` is applied in private-only mode |
| RUN-008 | Socket enumeration confirms loopback-only listener |
| RUN-009 | Non-loopback listener fails validation and stops activation |
| RUN-010 | Crash restart uses bounded exponential backoff |
| RUN-011 | Restart exhaustion produces actionable degraded state |
| RUN-012 | Unrelated Ollama is never stopped, upgraded, or removed |
| MOD-001 | Exact generation model tag/digest is installed |
| MOD-002 | Exact embedding model tag/digest is installed |
| MOD-003 | Mutable `latest` tag is rejected |
| MOD-004 | Interrupted model pull resumes |
| MOD-005 | Generation model warm-up uses synthetic data |
| MOD-006 | Structured extraction returns parseable expected JSON |
| MOD-007 | Streaming response emits and completes correctly |
| MOD-008 | Embedding output has expected vector dimension |
| MOD-009 | Model load failure offers smaller compatible profile |
| MOD-010 | User-confirmed model is not silently changed |
| MOD-011 | Embedding model change triggers explicit resumable re-index plan |

### 8.5 UI, accessibility, and resume

| ID | Test |
| --- | --- |
| UI-001 | Private AI skip reaches existing desktop handoff |
| UI-002 | Every screen is keyboard operable |
| UI-003 | Controls have useful accessible names and focus order |
| UI-004 | High contrast and 200% text scale remain usable |
| UI-005 | Recommendation reasons and warnings are understandable |
| UI-006 | Exact download size/location are shown before consent |
| UI-007 | Unsupported model cannot be selected through UI manipulation |
| UI-008 | Cancel, retry, and back navigation preserve valid state |
| UI-009 | Closing during every stage resumes from last committed state |
| UI-010 | Corrupt resume state fails safely and offers repair/restart |
| UI-011 | Copy-error output is redacted |
| UI-012 | Existing install/update/success/failure routes remain unchanged when feature is skipped |
| UI-013 | Existing provider onboarding and choose-later behavior do not reappear incorrectly |
| UI-014 | English strings are externalized for future localization |

### 8.6 Electron and provider integration

| ID | Test |
| --- | --- |
| ELC-001 | Main process validates configuration before runtime start |
| ELC-002 | Renderer cannot spawn runtime or call arbitrary URL |
| ELC-003 | Every IPC method validates payload and authorization/state |
| ELC-004 | ensure-running is deduplicated under concurrent calls |
| ELC-005 | Startup waits for health before enabling Private AI |
| ELC-006 | Streaming cancellation cleans listeners and aborts request |
| ELC-007 | Timeout produces recoverable error |
| ELC-008 | Runtime crash updates UI and bounded restart succeeds |
| ELC-009 | Existing local/custom/cloud providers remain selectable |
| ELC-010 | Existing selected provider is not changed without approval |
| ELC-011 | Private AI never silently falls back to cloud |
| ELC-012 | Model/runtime/execution mode appear accurately in Settings |
| ELC-013 | Repair and diagnostics actions use narrow main-process APIs |
| ELC-014 | Context isolation, sandbox, navigation, and window-open policies remain enforced |

### 8.7 Upgrade, repair, rollback, and uninstall

| ID | Test |
| --- | --- |
| UPD-001 | App-only update leaves runtime and models unchanged |
| UPD-002 | Catalogue-only update recalculates safely |
| UPD-003 | Runtime update stages new version and validates before swap |
| UPD-004 | Failed runtime update restores previous runtime |
| UPD-005 | Active inference prevents model replacement |
| UPD-006 | Administrator version freeze blocks prohibited change |
| UPD-007 | Embedding update preserves old index until new index succeeds |
| REP-001 | Deleted runtime executable is restored |
| REP-002 | Corrupt configuration is repaired or safely regenerated |
| REP-003 | Missing generation/embedding layers are re-pulled |
| REP-004 | Port conflict is detected and resolved |
| REP-005 | Repair preserves profiles, Matters, sessions, documents, settings, and valid indexes |
| UN-001 | Application-only uninstall retains managed runtime/models/data |
| UN-002 | App plus managed runtime removes only owned runtime |
| UN-003 | App/runtime/models option removes only owned model directory |
| UN-004 | Optional indexes/settings removal requires explicit confirmation |
| UN-005 | User documents are never included in deletion plan |
| UN-006 | Unrelated Ollama remains installed and running |
| RB-001 | Base app install failure rolls back newly created files |
| RB-002 | Private AI failure after base install preserves usable base app |
| RB-003 | Power/process termination at each committed stage resumes safely |

### 8.8 Security, privacy, logging, and packaging

| ID | Test |
| --- | --- |
| SEC-001 | Tokens and activation credentials never appear in logs |
| SEC-002 | Synthetic prompt/document canaries never appear in installer logs |
| SEC-003 | Usernames and full personal paths are redacted |
| SEC-004 | Support bundle preview matches final archive contents |
| SEC-005 | Support bundle requires explicit consent |
| SEC-006 | Directory ACLs prevent unintended other-user access |
| SEC-007 | Tampered executable/package/catalogue is blocked |
| SEC-008 | Child-process environment contains only required variables |
| SEC-009 | No hardware sharing, leaderboard, or telemetry without consent |
| SEC-010 | Dependency, binary, secret, and licence scans pass |
| PKG-001 | Clean macOS Apple Silicon app build |
| PKG-002 | Signed/notarized DMG builds non-interactively |
| PKG-003 | Clean Windows 10 x64 install as standard user |
| PKG-004 | Clean Windows 11 x64 install as standard user |
| PKG-005 | Paths with spaces and non-ASCII characters install correctly |
| PKG-006 | Reproducible manifest pins commit and all component versions |
| PKG-007 | Published hashes match downloaded release artifacts |
| PKG-008 | SBOM and required licence notices ship with release |

### 8.9 Manual hardware lab matrix

Run the full install/benchmark/repair/uninstall scenario on:

- Windows 10 22H2 x64 and supported Windows 11 releases.
- Intel and AMD CPU-only devices with 8, 16, 32, 64, and 128 GB RAM.
- NVIDIA GPUs with 4, 6, 8, 12, 16, and 24 GB VRAM.
- Supported and unsupported AMD GPU/driver combinations.
- Integrated-plus-discrete GPU laptops on AC power and battery.
- Low-disk devices and non-default model volumes.
- Corporate proxy, TLS interception, restricted network, and offline scenarios.
- Existing compatible Ollama, incompatible Ollama, and unrelated process on the default port.

Record device class, expected eligible profiles, actual recommendation, runtime mode, validation metrics, outcome, and redacted logs. Do not record serial numbers or user content.

### 8.10 Existing-feature and legal-workflow regression

| ID | Test |
| --- | --- |
| REG-001 | Existing base installer completes when Private AI is skipped |
| REG-002 | Existing install, update, retry, cancel, repair, log, and desktop-handoff behavior remains operational |
| REG-003 | Existing OAuth, API-key, custom, local, and choose-later provider paths remain operational |
| REG-004 | Existing active provider is preserved through installer upgrade |
| REG-005 | Existing Hermes profiles retain isolated `HERMES_HOME` data |
| REG-006 | Existing sessions and conversation history remain readable |
| REG-007 | Existing installed and user-created skills remain available |
| REG-008 | Existing n8n MCP configuration and legal workflows remain available |
| REG-009 | Existing Matter Workspaces open with unchanged files and metadata |
| REG-010 | Existing indexes remain usable when embedding identity is unchanged |
| REG-011 | Existing user documents are never copied into installer storage or diagnostics |
| REG-012 | Existing unowned Ollama installation and models remain unchanged |
| LEG-001 | Legal research answer remains retrieval-grounded and displays source passages |
| LEG-002 | Citation extraction/verification refuses invented citations |
| LEG-003 | Jurisdiction and “law as of” metadata are preserved in the local-provider path |
| LEG-004 | UI distinguishes user documents from model knowledge |
| LEG-005 | Audit record includes model tag, prompt-template version, retrieval sources, and catalogue version |
| LEG-006 | Draft reliance warning appears for locally generated legal drafts |
| LEG-007 | Installer validation uses only synthetic non-confidential material |

### 8.11 Enterprise deployment

| ID | Test |
| --- | --- |
| ENT-E01 | Quiet per-user install completes with an explicitly compatible profile |
| ENT-E02 | Quiet install fails rather than guessing when the requested profile is incompatible |
| ENT-E03 | Activation secret is supplied through a protected file/store, never a command argument |
| ENT-E04 | Machine-wide service runs under the restricted configured identity |
| ENT-E05 | Private mirror and offline bundle signatures/hashes are verified |
| ENT-E06 | Administrator version-freeze and model policy are enforced |
| ENT-E07 | Enterprise proxy and certificate installation succeeds |
| ENT-E08 | Fleet diagnostics contain no prompt, document, credential, username, or device identifier |
| ENT-E09 | MSI/deployment wrapper invokes canonical orchestration rather than duplicating it |

## 9. End-to-end acceptance scenarios

### E2E-01 — Standard fresh Windows installation

Given a clean supported Windows x64 device, the user installs the base app, opts into Private AI, receives a compatible recommendation, confirms storage, installs verified runtime and two models, passes validation, launches Electron, and completes a local prompt without using a terminal.

### E2E-02 — Private AI skipped

The user declines Private AI and completes the existing base installation with provider onboarding unchanged.

### E2E-03 — llmfit failure

llmfit times out or returns invalid JSON. The UI explains that a conservative recommendation is being used, only safe profiles appear, real post-install validation still runs, and the diagnostic contains no identifying data.

### E2E-04 — Existing unrelated Ollama

An unrelated Ollama owns `11434`. The installer detects but does not modify it, defaults to an isolated runtime on another loopback port, and uninstall leaves the unrelated installation intact.

### E2E-05 — Interrupted installation

The process is terminated during runtime and model download stages. Restart resumes verified work from the last committed state and never uses corrupt partial artifacts.

### E2E-06 — Insufficient disk

The selected location lacks required headroom. The user can select another location or smaller model; no download begins until the hard gate passes.

### E2E-07 — Slow or failed benchmark

The selected model installs but is slow or cannot load. The user sees evidence and may approve a smaller compatible model. No automatic undisclosed switch occurs.

### E2E-08 — Existing cloud provider

The application already uses a cloud/custom provider. Installing Private AI adds it as an option and does not change the active provider without explicit approval.

### E2E-09 — Repair

Managed runtime or model files are deleted/corrupted. Repair restores only damaged managed components and preserves profiles, Matters, sessions, documents, settings, and unrelated Ollama.

### E2E-10 — Upgrade rollback

A staged runtime update fails validation. The prior runtime is restored and Electron reconnects without loss of user data.

### E2E-11 — All uninstall choices

Each uninstall choice removes exactly the previewed managed scope. Documents are never selected automatically, and unowned Ollama remains untouched.

### E2E-12 — Tampered supply-chain artifact

A manifest, catalogue, llmfit binary, Ollama runtime, or model package is altered. Verification stops use before extraction/execution/activation and reports a safe actionable error.

## 10. CI and verification commands

Developer minimum before every commit:

```bash
npm run typecheck --workspace apps/bootstrap-installer
cargo test --manifest-path apps/bootstrap-installer/src-tauri/Cargo.toml --lib
git diff --check
```

Desktop changes must also run the desktop typecheck/lint/test commands defined in `apps/desktop/package.json`. Python/Hermes tests must use `scripts/run_tests.sh`, never direct `pytest`.

Release-candidate CI must include:

1. Contract/schema tests.
2. Rust unit and integration tests on macOS and Windows.
3. Installer renderer tests and accessibility audit.
4. Electron unit/integration tests.
5. Download/proxy/failure-injection integration suite.
6. Clean Windows VM end-to-end suite.
7. Upgrade/repair/uninstall suite.
8. Secret/content log canary scan.
9. Dependency, binary, SBOM, licence, and signing verification.
10. Signed artifact smoke installation.

Useful local macOS build:

```bash
npm run tauri:build --workspace apps/bootstrap-installer -- --bundles app
```

Do not use a successful macOS development build as evidence that Windows runtime detection, Authenticode, service behavior, or enterprise deployment works.

### 10.1 Source-PRD phase mapping

| Source PRD phase | Work packages in this handoff | Exit gate |
| --- | --- | --- |
| Phase 1 — Proof of concept | WP-00 through WP-09 using synthetic/dev-signed inputs | One supported Windows x64 machine completes visible installer-to-Electron local inference with generation and embedding checks |
| Phase 2 — Production installer | WP-03 production services plus WP-05, WP-10, WP-11, and WP-12 | Signed release passes the full automated, clean-VM, hardware-lab, security, repair, rollback, and uninstall gates |
| Phase 3 — Enterprise | WP-13 | Quiet/MSI, machine scope, service identity, private mirror/offline, proxy, freeze policy, and fleet diagnostics pass |

Phase 1 is not complete merely because the recommendation library exists. Its exit gate includes the visible installer flow, managed runtime, two models, validation, and Electron use.

## 11. Production inputs LexEdge must supply

Engineering must not invent these values:

- Product-controlled component, catalogue, entitlement, and release URLs.
- Manifest/catalogue signing key, public key, rotation, revocation, and expiry policy.
- Approved model profiles and immutable model identities.
- Commercial licence approval and notices for each offered model.
- Legal benchmark owner, version, datasets, scores, approval threshold, and revalidation policy.
- Pinned Ollama version, artifacts, hashes, licence, and rollback version.
- Pinned llmfit artifact mirrored by LexEdge and approved hash/licence.
- Required embedding model, exact identity, vector dimension, and re-index policy.
- Performance thresholds by hardware class and profile.
- Disk safety-headroom policy.
- Entitlement plans, offline/grace behavior, token storage, and revocation rules.
- Support/diagnostic endpoint and user-consent policy.
- Windows publisher certificate and signing infrastructure.
- macOS signing identity, notarization credentials, and supported release scope.
- Supported OS/architecture matrix and deprecation policy.
- Enterprise service identity, MSI policy, offline/mirror policy, and administrator controls.

Work requiring these inputs may use synthetic fixtures, but cannot be marked production-complete.

## 12. Definition of 100% complete

The project is 100% complete only when all of the following are true:

- WP-00 through WP-12 are complete for the consumer release; WP-13 is complete before claiming enterprise support.
- Every applicable test ID in this document passes in CI or the approved manual hardware lab.
- All twelve end-to-end scenarios pass with retained evidence.
- There are no unresolved Critical or High security findings.
- All binaries, manifests, catalogue data, models, and licences are pinned and approved.
- Windows clean install, upgrade, interrupted resume, repair, rollback, and all uninstall choices pass.
- Private AI works from Electron without command-line steps.
- Existing providers, profiles, sessions, skills, n8n integrations, Matter Workspaces, indexes, and documents show no regression.
- Ollama is demonstrably loopback-only and unrelated installations are untouched.
- Logs and support bundles pass credential, prompt, document-content, username, and path redaction tests.
- Signed release artifacts, SBOM, hashes, notices, rollback artifacts, and runbooks are published.
- Product, engineering, legal/licensing, privacy/security, and release owners sign the release checklist.

“The app builds,” “the recommendation unit tests pass,” or “Ollama responds locally” are milestones, not completion.

## 13. Developer pull-request checklist

Every pull request must state:

- Work-package and test IDs addressed.
- Existing behavior that could be affected and how it was protected.
- Persisted schema/event/API changes and migration behavior.
- Security and privacy impact.
- Failure, cancellation, retry, resume, rollback, and uninstall behavior where applicable.
- Tests added and exact commands run.
- Platform/hardware evidence.
- Screenshots for visible states and errors.
- New dependencies, their pinning, licence, and supply-chain review.
- Remaining gaps that prevent the work package from being complete.

Do not merge a PR that introduces a second installer state owner, hardcodes personal paths, uses mutable component versions, logs protected content, executes user-controlled shell strings, weakens Electron isolation, or bypasses existing provider/profile behavior.

## 14. Recommended execution order

```text
WP-00 contracts
  -> WP-01 hardware
  -> WP-02 manifest + llmfit
  -> WP-03 catalogue + entitlement + recommendation
  -> WP-04 installer UI
  -> WP-05 downloads
  -> WP-06 Ollama ownership/lifecycle
  -> WP-07 models
  -> WP-08 validation/benchmark
  -> WP-09 Electron integration
  -> WP-10 lifecycle operations
  -> WP-11 security/compliance
  -> WP-12 production release
  -> WP-13 enterprise
```

WP-11 security work begins during WP-00 and supplies gates to every package; it is not a final-week audit. Documentation and test automation ship with each work package.

## 15. First developer assignment

Start with WP-00 only:

1. Fix and verify the cross-platform lock-probe test.
2. Propose the canonical nested runtime configuration with a migration from the current flat development schema.
3. Add the missing schemas and shared golden fixtures.
4. Document new installer events and resume-state transitions.
5. Run the complete installer suite on macOS and Windows CI.

Do not begin runtime downloads or Electron supervision until WP-00 is reviewed and the runtime contract is approved. This avoids building the installer and desktop sides against incompatible configuration formats.
