# Private AI installer contracts

These schemas define persisted and cross-process data for the additive Private AI installer flow. The Rust backend remains authoritative for privileged actions and validates critical security invariants in code as well as at the schema boundary.

## Version policy

- `schemaVersion` is required for every persisted contract.
- Additive optional fields may remain within a schema version.
- Removing, renaming, retyping, or changing the meaning of a field requires a new schema version and an explicit migration.
- Unknown schema versions fail safely before process start, download activation, or configuration replacement.
- Only the newest supported version is written.
- Golden fixtures under `test-fixtures/` are compatibility inputs and must never contain credentials, personal hardware identifiers, or legal documents.

## Runtime configuration Version 1

`runtime-config.v1.schema.json` is the canonical nested format. It separates `ollama`, `models`, `catalog`, and `privacy` data. The earlier flat development-only draft was never written by a released installer and is not an accepted activation format. If a flat draft is encountered during development, preserve model files, archive the invalid configuration without logging its full path, and regenerate the canonical file only after runtime ownership and model validation succeed.

The installer writes `runtime.json` to a sibling temporary file, flushes it, and atomically renames it. Electron validates the same contract again before starting or contacting the managed runtime.

Relative managed paths resolve below the active profile-aware `HERMES_HOME`. A path must not escape that root. Absolute paths are allowed only for a user-selected model location recorded through the installer and revalidated by Electron.

## Installer event additions

Extend the existing `bootstrap` event protocol instead of creating a second state owner. New events must be discriminated, versioned, display-safe, and free of credentials or raw document/prompt data.

Planned event payloads:

- `privateAiOffer`: availability and current choice.
- `privateAiStage`: stable stage ID, state, duration, safe error code, and retryability.
- `hardwareSummary`: non-identifying hardware class and analysis confidence.
- `recommendations`: compatible display models, exclusions, reasons, and warnings.
- `downloadProgress`: download ID, component label, verified/received/total bytes, and resumable state.
- `validationProgress`: check ID, state, safe measurement, and warning.
- `privateAiComplete`: selected profile and validated local-provider availability.

The renderer may request a choice, cancellation, retry, or skip through narrow Tauri commands. It may not provide an executable path, arbitrary URL, shell arguments, catalogue content, signature decision, or eligibility result.

## Schema inventory

- `hardware.v1.schema.json`: normalized local hardware and existing-runtime inventory.
- `llmfit-normalized.v1.schema.json`: versioned adapter output consumed by recommendation logic.
- `legal-model-catalog.v1.schema.json`: legally approved model profiles.
- `entitlement.v1.schema.json`: signed plan/profile authorization response.
- `component-manifest.v1.schema.json`: signed downloadable component inventory.
- `download-state.v1.schema.json`: non-sensitive resumable download metadata.
- `installer-resume-state.v1.schema.json`: idempotent Private AI stage checkpoint.
- `runtime-config.v1.schema.json`: canonical installer-to-Electron managed runtime contract.

Catalogue, entitlement, and component-manifest payloads are transported inside `signed-envelope.v1.schema.json`. The Ed25519 signature covers the exact base64-decoded payload bytes, so verification never depends on JSON key ordering or reserialization.
