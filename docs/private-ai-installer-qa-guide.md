# Private AI Installer — Developer and Manual QA Guide

Branch `feature/unified-online-installer` at `6c9a9a9ea2`, 2026-09-08. Companion to the [gap analysis and developer handoff](unified-online-installer-gap-analysis-and-developer-handoff.md).

## 1. What this guide covers

Features under test, by commit:

- `0a9b88d8` — LexEdge branding of the installer (identifiers, publisher, binary, Windows workflow)
- `6c9a9a9e` — LexEdge app icon and installer artwork
- `1ec3704c` — Four install-script defects fixed (wrong remote, failure reported as success, missing bootstrap marker on macOS/Linux, hardcoded Hermes.app)
- `d41d4cce` — Electron second-instance crash on a destroyed window
- `a2ca6e31` — Private AI consent and hardware-analysis screens; runtime, catalogue, client and validation layers
- `fefcdbae` — Private AI provisioning: signed manifest, verified resumable download, safe extraction, nine-stage resumable state machine, provisioning screen
- `fc6dddb0` — Managed runtime output drained (deadlock fix); both models warmed before validation

Not in scope for this build — file nothing against these:

- The desktop app does not yet read runtime.json or supervise the managed runtime (handoff item 8). Private AI is validated by the installer only; chatting through it in the desktop is not testable yet.
- No repair or uninstall UI. Cleanup is manual (see ISO-03).
- Windows and Linux: the component manifest carries Windows x64/arm64 entries but no Windows run has been performed; there is no Linux artifact pinned.
- Production catalogue, production signing keys, entitlements, telemetry consent and signed release packaging are not built. A release build refuses to provision by design (see PV-09).
- The llmfit executable is not yet wired into the analysis screen, so every analysis currently shows the conservative-fallback notice. That is expected in this build.

## 2. Test environment

| Item | Requirement |
| --- | --- |
| Hardware / OS | macOS 14+ on Apple Silicon (verified on an M5, 32 GB). Intel macOS uses the same universal archive but is unverified. |
| Toolchain (developer tests) | Rust stable 1.77+, Node 22, npm. From the repo root: `npm ci`. |
| Network | github.com (raw + releases) and registry.ollama.ai reachable. No proxy needed on a home network; on a corporate proxy the runtime honours HTTP(S)_PROXY for registry downloads while loopback stays direct. |
| Disk | About 2 GB free for the development models, runtime and download cache. |
| Build type | Debug builds only: `npm run tauri:build:debug`. The development catalogue and component manifest are compiled into debug builds; a release build refuses to provision until release engineering pins real keys. |
| Optional | An existing Ollama on port 11434 — needed for the port step-around and isolation cases. Note its version and model list before starting. |

### Flags and environment variables

| Knob | Effect |
| --- | --- |
| `--reinstall` / `--repair` | Force the setup UI even when an install exists. Without it, a macOS launch with an existing install relaunches the desktop app and exits — that is the launcher fast path, not a bug. |
| `--update` | Update mode (driven by the desktop hand-off). |
| `HERMES_HOME` | Redirects everything — install root, logs, private-ai tree — to a sandbox. Use it to test without touching your real profile. |
| `HERMES_SETUP_DEV_REPO_ROOT` | Use the checkout's `scripts/install.sh` instead of downloading it from GitHub. Developer convenience only; never for a release build. |
| `HERMES_BUILD_PIN_BRANCH` / `HERMES_BUILD_PIN_COMMIT` | Build-time pin baked into the binary. Pin to a branch that exists on `origin` or the install script download 404s. |
| `HERMES_BOOTSTRAP_LOG=debug` | Verbose installer log, including the managed runtime's own output. |
| `LEXEDGE_E2E_HOME` | Points the live end-to-end test at a previous run's home to exercise resume. |

### Where things are

| Path | What |
| --- | --- |
| `$HERMES_HOME/logs/bootstrap-installer.log` | Installer log. First thing to attach to any defect. |
| `$HERMES_HOME/private-ai/runtime/` | Managed Ollama runtime (never the one on PATH). |
| `$HERMES_HOME/private-ai/models/` | Managed model store, isolated from `~/.ollama`. |
| `$HERMES_HOME/private-ai/config/runtime.json` | The configuration the desktop will load. |
| `$HERMES_HOME/private-ai/provision-state.json` | Resume journal (installer-resume-state.v1). |
| `$HERMES_HOME/private-ai/.lexedge-managed.json` | Ownership marker — repair and uninstall only touch what carries it. |
| `$HERMES_HOME/private-ai/downloads/` | Verified archives, `.part` partials and `.download.json` resume state. |
| `$HERMES_HOME/hermes-agent/.hermes-bootstrap-complete` | Base-install marker (schemaVersion 1, pinnedCommit, pinnedBranch, completedAt). |

## 3. Developer test suite

Run these before any manual pass. All commands are relative to the repo root unless noted.

### Rust unit suite

```bash
cd apps/bootstrap-installer/src-tauri && cargo test
```

- **Expected:** `test result: ok. 129 passed; 0 failed; 1 ignored`
- **Duration:** ~2 min first compile, seconds after
- **Covers:** Everything below the UI: runtime lifecycle, port selection, ownership marker, atomic config; signed catalogue and component manifest (signature, key rotation, expiry, kill switch, https-only); download resume decisions and hash/size verification; archive policy (traversal, absolute paths, escaping and dangling links, size caps, cleanup); all ten validation checks; provisioning journal and plan; the real `/api/tags` payload; the pipe-drain deadlock; product-name resolution; the golden `install.sh --manifest` fixture.

### Live end-to-end provisioning

```bash
cargo test provisions_private_ai_end_to_end -- --ignored --nocapture --test-threads=1
```

- **Expected:** Nine `[stage] … Succeeded` lines, `[complete] passed=true`, `[metrics] …`, ten `[check] … Passed`, `test result: ok. 1 passed`
- **Duration:** 3–4 min cold on a fast line (~1.2 GB); the `[e2e] HERMES_HOME kept for inspection:` path is printed
- **Covers:** The whole pipeline against the real network in a throwaway home: signed resolve → verified download → safe extract → loopback runtime on a free port → verified pulls → runtime.json → validation. Kills its runtime on exit. Delete the printed home when done.

### Live resume

```bash
LEXEDGE_E2E_HOME=<home printed above> cargo test provisions_private_ai_end_to_end -- --ignored --nocapture --test-threads=1
```

- **Expected:** `install-runtime … Skipped Runtime 0.33.3 is already installed`, `install-generation-model … Skipped … already installed and verified`, then `[complete] passed=true`
- **Duration:** 20–60 s
- **Covers:** Idempotency: every stage whose postcondition already holds is skipped, the runtime restarts, validation re-runs.

### Frontend

```bash
cd apps/bootstrap-installer && npm run typecheck && npm run build
```

- **Expected:** `tsc` exits 0; `✓ built in …`; `dist/assets/lexedge-app-icon-….png` listed
- **Duration:** seconds
- **Covers:** Store, screens and the bundled badge asset.

### Install-script contract

```bash
bash scripts/install.sh --manifest -IncludeDesktop | python3 -m json.tool
```

- **Expected:** `protocol_version: 1`, 11 stages, `repository` titled `Download LexEdge Hermes Agent`
- **Duration:** seconds
- **Covers:** The stage list the installer drives. The same output is frozen as `test-fixtures/install-manifest.v1.json` and checked by `powershell::tests::real_install_script_manifest_parses`.

### Desktop main process

```bash
node --check apps/desktop/electron/main.cjs
```

- **Expected:** no output, exit 0
- **Duration:** instant
- **Covers:** Syntax gate for the second-instance fix.

### Debug bundle

```bash
cd apps/bootstrap-installer && HERMES_BUILD_PIN_BRANCH=main npm run tauri:build:debug
```

- **Expected:** `src-tauri/target/debug/bundle/macos/LexEdge Hermes Agent Setup.app`; `PlistBuddy -c 'Print :CFBundleIdentifier'` → `ai.lexedge.hermes.unified.setup`
- **Duration:** 2–4 min
- **Covers:** The artifact every manual case below runs. Pin to `main` (or any branch that exists on origin).

## 4. Manual test cases

Each case names its preconditions, exact steps, the exact strings to expect, and the evidence to attach. Tick cases in order within a group; later groups assume earlier ones.


### A · Branding


#### BR-01 — Bundle identity

**Preconditions.** Debug bundle built.

**Steps.**

1. Run `/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "<app>/Contents/Info.plist"` and the same for `:CFBundleName`, `:CFBundleExecutable`, `:NSHumanReadableCopyright`, `:CFBundleIconFile`.

**Expected.**

- `ai.lexedge.hermes.unified.setup`
- `LexEdge Hermes Agent Setup`
- `LexEdge-Hermes-Agent-Setup`
- `Copyright © 2026 LexEdge AI Labs Private Limited`
- `icon.icns` — and the Finder/Dock icon is the LexEdge badge, not the Hermes mark.

**Evidence to attach.** Terminal output; a screenshot of the .app in Finder.


#### BR-02 — Welcome screen branding

**Preconditions.** Launch with `--reinstall`.

**Steps.**

1. Observe the window title bar, hero, button and footer.

**Expected.**

- Title bar: `LexEdge Hermes Agent Setup`.
- LexEdge badge above the wordmark `LEXEDGE HERMES AGENT`.
- Button: `Install LexEdge Hermes Agent`.
- Footer: `Published by LexEdge AI Labs Private Limited. Built on Hermes, an open project by Nous Research.`
- No `Nous Research` anywhere as publisher or product owner.

**Evidence to attach.** Screenshot.


#### BR-03 — Install-script banner

**Preconditions.** Repo checkout.

**Steps.**

1. Run `bash scripts/install.sh --help | head -3`.
2. Run `bash scripts/install.sh -Stage prerequisites -NonInteractive -Json -Branch main` and read the box drawn at the top.

**Expected.**

- Help header: `LexEdge Hermes Agent Installer`.
- Box title `⚕ LexEdge Hermes Agent Installer`, subtitle `Private legal AI by LexEdge AI Labs Private Limited.`, box edges aligned.
- Below the box: `Built on Hermes, an open source project by Nous Research.`

**Evidence to attach.** Terminal output.


#### BR-04 — Windows workflow artifact names

**Preconditions.** Repo checkout.

**Steps.**

1. Open `.github/workflows/build-windows-installer.yml`.

**Expected.**

- Job name `LexEdge-Hermes-Agent-Setup.exe`; artifacts `LexEdge-Hermes-Agent-Setup-installer` and `LexEdge-Hermes-Agent-Setup-exe`; raw exe path ends `release/LexEdge-Hermes-Agent-Setup.exe`.
- No remaining `Hermes-Setup` string in `.github/`.

**Evidence to attach.** `grep -rn Hermes-Setup .github/` returns nothing.


#### BR-05 — Success screen branding

**Preconditions.** Complete BI-01.

**Steps.**

1. Observe the final screen.

**Expected.**

- Heading `LexEdge Hermes Agent is ready`; button `Launch LexEdge Hermes Agent`.

**Evidence to attach.** Screenshot.


### B · Consent and hardware analysis


#### PA-01 — Consent screen content

**Preconditions.** Welcome screen shown.

**Steps.**

1. Click `Install LexEdge Hermes Agent`.

**Expected.**

- Screen `Set up Private AI` with three points: `Runs on this computer`, `Documents stay on this machine`, `Only approved models`.
- Primary `Use Private AI`; secondary `Continue with a cloud provider` is a real button, not a link.
- Footnote says Private AI can be turned on or off later in Settings.
- Nothing has been downloaded or installed yet (no `$HERMES_HOME/private-ai` directory).

**Evidence to attach.** Screenshot; `ls $HERMES_HOME`.


#### PA-02 — Declining is a first-class path

**Preconditions.** PA-01.

**Steps.**

1. Click `Continue with a cloud provider`.

**Expected.**

- The base install starts immediately (progress screen). No Private AI screens follow. Completes to the success screen exactly as BI-01.

**Evidence to attach.** Screenshot of progress; log shows `bootstrap starting` and no `private-ai stage` lines.


#### PA-03 — Hardware analysis summary

**Preconditions.** PA-01.

**Steps.**

1. Click `Use Private AI`.

**Expected.**

- Brief `Checking what this computer can run…`, then screen `What this computer can run`.
- Subline shows CPU model, `<n> GB memory`, GPU (on Apple Silicon: `Apple Silicon (shared memory)`) and `<n> GB free`.
- Notice `Detailed hardware analysis was unavailable, so these recommendations use conservative limits.` — expected in this build (llmfit not wired).
- No username, home path, serial or device id appears anywhere on the screen.

**Evidence to attach.** Screenshot.


#### PA-04 — Recommendation and alternatives

**Preconditions.** PA-03 on a machine with ≥ 8 GB RAM.

**Steps.**

1. Read the model list.

**Expected.**

- `Legal Standard (development)` carries the `Recommended` chip and is pre-selected; `Legal Compact (development)` is listed as an alternative.
- Each card shows download size, memory, speed (or `Speed unknown`), context (`8k context`) and at least one reason such as `Conservative RAM rule passed (… recommended; … detected)`.
- Selecting a card changes the footer total: `Downloads <name> plus the embedding model — about <n> GB. You have <n> GB free.`

**Evidence to attach.** Screenshot with Compact selected and with Standard selected.


#### PA-05 — Exclusions carry reasons

**Preconditions.** PA-03 on a machine with < 48 GB RAM.

**Steps.**

1. Expand `1 model won't run on this computer`.

**Expected.**

- `Legal Large (development)` listed with reasons including `Requires at least 48.0 GB RAM; detected <n> GB` and `Requires at least 24.0 GB GPU memory; detected 0.0 GB`.

**Evidence to attach.** Screenshot.


#### PA-06 — Existing Ollama is detected and left alone

**Preconditions.** Your own Ollama running on 11434.

**Steps.**

1. Open PA-03.

**Expected.**

- Notice: `An existing Ollama installation is already running on port 11434 (version <x>). LexEdge will install its own separate runtime on another port and will not change or remove yours.`

**Evidence to attach.** Screenshot; `curl 127.0.0.1:11434/api/version` before and after the whole run is unchanged.


#### PA-07 — Skipping from the analysis screen

**Preconditions.** PA-03.

**Steps.**

1. Click `Skip Private AI`.

**Expected.**

- Base install runs and completes as PA-02. No provisioning screen.

**Evidence to attach.** Log has no `private-ai stage` lines.


### C · Base install


#### BI-01 — Clean base install through the UI

**Preconditions.** Sandbox: `HERMES_HOME=$(mktemp -d)`; GitHub `main` reachable; launch the .app binary directly with `--reinstall` from a shell that exports `HERMES_HOME`.

**Steps.**

1. Welcome → `Install LexEdge Hermes Agent` → `Continue with a cloud provider`.
2. Watch the progress screen to completion.
3. Click `Launch LexEdge Hermes Agent`.

**Expected.**

- Progress lists 11 stages; all end `succeeded` except `Configure API keys and settings` and `Configure gateway service` which are `skipped` (non-interactive).
- `$HERMES_HOME/hermes-agent/.hermes-bootstrap-complete` exists with `schemaVersion: 1`, a 40-character `pinnedCommit`, `pinnedBranch: main`.
- `$HERMES_HOME/hermes-agent/apps/desktop/release/mac-arm64/LexEdge AI.app` exists.
- `$HERMES_HOME/hermes-agent/venv/bin/hermes --version` prints `Hermes Agent v…`.
- The desktop app launches and the installer exits.

**Evidence to attach.** Log file; marker contents; `ls` of the release dir.


#### BI-02 — Launcher fast path

**Preconditions.** BI-01 complete.

**Steps.**

1. Launch the installer again WITHOUT `--reinstall` (same `HERMES_HOME`).

**Expected.**

- No installer window. The desktop app comes to the front. Log: `hermes already installed — relaunched desktop; exiting installer`.

**Evidence to attach.** Log line.


#### BI-03 — Repair path is reachable

**Preconditions.** BI-01 complete.

**Steps.**

1. Launch with `--reinstall`.

**Expected.**

- The welcome screen appears despite the existing install.

**Evidence to attach.** Screenshot.


#### BI-04 — Script comes from GitHub, not the checkout

**Preconditions.** No `HERMES_SETUP_DEV_REPO_ROOT` in the environment.

**Steps.**

1. Run BI-01 and read the log.

**Expected.**

- `[bootstrap] downloading install.sh for main from GitHub` (no `dev mode — using local install.sh`).
- The downloaded script contains the fixes: stage `repository` is titled `Download LexEdge Hermes Agent` on the progress screen.

**Evidence to attach.** Log lines.


#### BI-05 — Base install failure is honest

**Preconditions.** Rebuild the bundle with `HERMES_BUILD_PIN_BRANCH=no-such-branch`.

**Steps.**

1. Launch with `--reinstall`, choose the cloud provider.

**Expected.**

- Failure screen `Install didn't finish` with `Failed to download install.sh: HTTP 404 Not Found from https://raw.githubusercontent.com/…/no-such-branch/scripts/install.sh`.
- `Retry install` and `Open log folder` work; the log path shown exists.

**Evidence to attach.** Screenshot. Rebuild with `main` afterwards.


#### BI-06 — Existing config survives

**Preconditions.** A real profile with `.env`, `config.yaml`, `auth.json` (back them up first).

**Steps.**

1. Run BI-01 against the real `~/.hermes`.

**Expected.**

- The three files are byte-identical afterwards (`cmp`).

**Evidence to attach.** `cmp` output.


### D · Private AI provisioning


#### PV-01 — Happy path

**Preconditions.** BI-01 sandbox; internet; ≥ 2 GB free.

**Steps.**

1. Welcome → Install → `Use Private AI` → select `Legal Compact (development)` (fastest) → `Install and download`.
2. Wait through the base install, then the provisioning screen.
3. Click `Continue`, then `Launch LexEdge Hermes Agent`.

**Expected.**

- Provisioning screen `Setting up Private AI`, subline `<n> of 9 steps · you can close the lid; this resumes where it left off`.
- Nine steps in order: `Check the approved runtime and models`, `Download the Private AI runtime` (with `<n> of 152 MB`), `Install the runtime`, `Start the runtime`, `Download the legal model`, `Download the document-search model`, `Verify the models`, `Save the configuration`, `Test local AI`.
- Stage details: `Runtime 0.33.3 · qwen2.5:0.5b · embeddinggemma:300m`; `Installed 57 files`; `Ollama 0.33.3 on 127.0.0.1:<port>`; `… · first document-search load took <n>s`; `10 checks passed`.
- Heading `Private AI is ready`; panel `Local AI is working` with the model, `Running on gpu` (Apple Silicon), `~<n> words/sec`, `First reply in <n>s`, `10 of 10 checks passed`.
- `runtime.json` written with `bindLocalhostOnly: true`, `cloudDisabled: true`, `managedProcess: true`, the exact model tags, `catalog.id: legal-desktop-dev`, both `installedAt` and `validatedAt` set.
- Cold run 3–5 min on a fast line; first runtime start may take 10–25 s (see Known behaviours).

**Evidence to attach.** Screenshots of each state; `runtime.json`; `provision-state.json` (`status: completed`, 9 `completedStages`); log.


#### PV-02 — Cancel and resume

**Preconditions.** PV-01 in progress at `Download the legal model`.

**Steps.**

1. Click `Cancel`.
2. Inspect the managed tree.
3. Click `Resume`.

**Expected.**

- Heading `Private AI setup stopped`; error `Private AI setup was cancelled`; buttons `Resume` and `Skip for now`.
- Journal `status: cancelled` with the completed stages listed.
- On resume: `Download the Private AI runtime` completes instantly (`Verified 152 MB`), `Install the runtime` is skipped, the model pull continues and the run completes.

**Evidence to attach.** Screenshots; journal before and after.


#### PV-03 — Survives being killed

**Preconditions.** PV-01 in progress at a model download.

**Steps.**

1. Force-quit the installer (Activity Monitor or `pkill -f LexEdge-Hermes-Agent-Setup`).
2. Confirm nothing is listening on the managed port.
3. Relaunch with `--reinstall`, choose `Use Private AI`, select the SAME profile, `Install and download`.

**Expected.**

- The managed runtime died with the installer (kill_on_drop) — `curl 127.0.0.1:<port>/api/version` fails.
- Base install re-runs quickly (idempotent).
- Provisioning shows `Skipped` for the runtime install and any model already verified, then completes. Journal keeps the original `sessionId`.

**Evidence to attach.** Journal `sessionId` before and after; screenshots.


#### PV-04 — Port 11434 occupied

**Preconditions.** Your own Ollama on 11434.

**Steps.**

1. Run PV-01.

**Expected.**

- `Start the runtime` detail: `Ollama 0.33.3 on 127.0.0.1:11435` (or the next free port).
- Your Ollama still answers on 11434 with its original version; its model list is unchanged (ISO-01).

**Evidence to attach.** Stage detail; `curl` outputs.


#### PV-05 — Port 11434 free

**Preconditions.** No Ollama running (stop yours: it is never stopped by the installer).

**Steps.**

1. Run PV-01.

**Expected.**

- `Ollama 0.33.3 on 127.0.0.1:11434`; `runtime.json` `baseUrl: http://127.0.0.1:11434`.

**Evidence to attach.** Stage detail.


#### PV-06 — Skip for now keeps the base install

**Preconditions.** Any provisioning failure or a cancel.

**Steps.**

1. Click `Skip for now`.

**Expected.**

- Success screen; `Launch LexEdge Hermes Agent` works; `hermes --version` works.
- `$HERMES_HOME/private-ai` is left in place for a later resume; nothing else changed.

**Evidence to attach.** Screenshot; `hermes --version`.


#### PV-07 — Re-run is idempotent

**Preconditions.** PV-01 complete.

**Steps.**

1. Launch with `--reinstall`, same profile, `Install and download` again.

**Expected.**

- `Install the runtime`, `Download the legal model`, `Download the document-search model` all `Skipped` with `already installed and verified`; validation re-runs and passes; total under a minute after the base install.

**Evidence to attach.** Screenshot.


#### PV-08 — Switching profile

**Preconditions.** PV-01 complete with Compact.

**Steps.**

1. Run again selecting `Legal Standard (development)`.

**Expected.**

- A new journal session (different `sessionId`); runtime install skipped; `qwen2.5:1.5b` pulled (~1 GB); embedding skipped; `runtime.json` now names `qwen2.5:1.5b` and `profileId: legal-standard-dev`; both generation models present in the managed store.

**Evidence to attach.** Journal; `runtime.json`; `ls $HERMES_HOME/private-ai/models/manifests/registry.ollama.ai/library/qwen2.5`.


#### PV-09 — Release build refuses to provision

**Preconditions.** Build with `npm run tauri:build` (release).

**Steps.**

1. Run PV-01 with the release bundle.

**Expected.**

- `Check the approved runtime and models` fails: `No signed catalogue or component manifest has been provisioned for this build`. Base install is unaffected. This is the intended fail-closed behaviour until production keys are pinned.

**Evidence to attach.** Screenshot.


### E · Supply-chain and security


#### SEC-01 — Tampered runtime hash

**Preconditions.** Debug build. These edit a development fixture, rebuild the bundle, run PV-01, then restore the fixture (`git checkout -- <file>`) and rebuild.

**Steps.**

1. In `src-tauri/test-fixtures/components/dev-components.json` change one character of the macOS `sha256`. Rebuild, run.

**Expected.**

- `Download the Private AI runtime` reaches 100 % then fails: `Component SHA-256 verification failed`.
- `downloads/` contains no `.part` or `.download.json` for it (corrupt bytes are never kept for resume) and no final archive.

**Evidence to attach.** Screenshot; `ls downloads/`.


#### SEC-02 — Plain-http artifact

**Preconditions.** Debug build. These edit a development fixture, rebuild the bundle, run PV-01, then restore the fixture (`git checkout -- <file>`) and rebuild.

**Steps.**

1. Change the macOS component `url` to `http://…`. Rebuild, run.

**Expected.**

- `Check the approved runtime and models` fails: `Component ollama must be fetched over https`. No network request is made.

**Evidence to attach.** Screenshot.


#### SEC-03 — Mutable model tag

**Preconditions.** Debug build. These edit a development fixture, rebuild the bundle, run PV-01, then restore the fixture (`git checkout -- <file>`) and rebuild.

**Steps.**

1. In `dev-catalogue.json` set the Compact profile's `ollamaModel` to `qwen2.5:latest`. Rebuild, run with Compact.

**Expected.**

- `Check the approved runtime and models` fails: `Model tag qwen2.5:latest is mutable; pin an exact version or digest`.

**Evidence to attach.** Screenshot.


#### SEC-04 — Wrong model digest

**Preconditions.** Debug build. These edit a development fixture, rebuild the bundle, run PV-01, then restore the fixture (`git checkout -- <file>`) and rebuild.

**Steps.**

1. Change one character of the Compact profile's `expectedDigest`. Rebuild, run.

**Expected.**

- The model downloads, then `Download the legal model` fails: `qwen2.5:0.5b does not match the approved digest`. Provisioning does not proceed to configuration.

**Evidence to attach.** Screenshot; `runtime.json` absent or unchanged.


#### SEC-05 — Expired catalogue

**Preconditions.** Debug build. These edit a development fixture, rebuild the bundle, run PV-01, then restore the fixture (`git checkout -- <file>`) and rebuild.

**Steps.**

1. Set `notAfter` in `dev-catalogue.json` to `2020-01-01T00:00:00Z`. Rebuild, run.

**Expected.**

- The analysis screen itself fails with `The model catalogue has expired` and offers `Try again` / `Continue with a cloud provider`.

**Evidence to attach.** Screenshot.


#### SEC-06 — Foreign runtime directory is never replaced

**Preconditions.** Sandbox.

**Steps.**

1. Before provisioning: `mkdir -p $HERMES_HOME/private-ai/runtime && touch $HERMES_HOME/private-ai/runtime/someone-elses-file` (no ownership marker). Run PV-01.

**Expected.**

- `Install the runtime` fails: `A runtime directory exists that LexEdge did not install; refusing to replace it`. The file is still there.

**Evidence to attach.** Screenshot; `ls`.


#### SEC-07 — Loopback-only is proven by a socket test

**Preconditions.** PV-01 complete on a machine with a LAN address.

**Steps.**

1. Read the validation checks (developer: `[check] loopback_only` in the e2e output; manual: the panel's `10 of 10 checks passed`).
2. Independently: `curl -m 2 http://<your LAN IP>:<managed port>/api/version`.

**Expected.**

- Check `loopback_only` passed with `No listener answered on a non-loopback address`.
- The LAN-address curl fails to connect; `curl http://127.0.0.1:<port>/api/version` succeeds while the installer is open.

**Evidence to attach.** Both curl outputs.


#### SEC-08 — Archive traversal and symlink policy

**Preconditions.** Developer only.

**Steps.**

1. `cargo test extract::`.

**Expected.**

- 9 tests pass, including `traversal_entry_aborts_and_cleans_up`, `absolute_entry_is_refused`, `escaping_and_dangling_links_are_refused`, `zip_extracts_and_refuses_traversal`, and `real_layout_extracts_with_dylib_chains_materialised` which asserts no symlink is ever created.

**Evidence to attach.** Test output. (Manual tampering is not possible: the hash check in SEC-01 fires before extraction.)


### F · Desktop app


#### DT-01 — Relaunch never crashes the running app

**Preconditions.** A built `LexEdge AI.app` (from BI-01 or the dev checkout).

**Steps.**

1. Launch the app. Use `File ▸ Close` so the window closes but the app stays in the Dock.
2. Launch a second instance: `"<app>/Contents/MacOS/LexEdge AI"` from a shell, or `open -n`.

**Expected.**

- No `A JavaScript error occurred in the main process` dialog.
- The window reappears; the second process exits (single-instance lock); exactly one `LexEdge AI` process remains.

**Evidence to attach.** Screenshot; `pgrep -f 'LexEdge AI.app/Contents/MacOS' | wc -l` → 1.


### G · Install-script fixes


#### IS-01 — Wrong remote is repointed

**Preconditions.** Sandbox `HERMES_HOME`; run stages directly: `bash scripts/install.sh -Stage <name> -NonInteractive -Json -Branch main`. Run `prerequisites` and `repository` once so a checkout exists.

**Steps.**

1. `git -C $HERMES_HOME/hermes-agent remote set-url origin https://github.com/NousResearch/hermes-agent.git`
2. Run the `repository` stage.

**Expected.**

- Log: `Install directory tracked https://github.com/NousResearch/hermes-agent.git` then `Repointing it to https://github.com/Lexedgeai26/legal-hermes.git`; `{"ok":true,"stage":"repository"…}`.
- `git remote get-url origin` now returns the LexEdge URL.

**Evidence to attach.** Terminal output.


#### IS-02 — Unrelated history is set aside, never deleted

**Preconditions.** Sandbox `HERMES_HOME`; run stages directly: `bash scripts/install.sh -Stage <name> -NonInteractive -Json -Branch main`.

**Steps.**

1. Replace the checkout with an unrelated repo: `rm -rf $HERMES_HOME/hermes-agent && mkdir $HERMES_HOME/hermes-agent && git -C $HERMES_HOME/hermes-agent init -q && git -C $HERMES_HOME/hermes-agent commit -q --allow-empty -m x`
2. Run the `repository` stage.

**Expected.**

- `Existing checkout cannot be fast-forwarded from https://github.com/Lexedgeai26/legal-hermes.git.` / `Moving it aside to $HERMES_HOME/hermes-agent.unrelated-<timestamp> and installing a fresh copy.`
- Stage `ok:true`; the fresh checkout's HEAD equals `origin/main`; the `.unrelated-*` directory still exists.

**Evidence to attach.** Terminal output; `ls $HERMES_HOME`.


#### IS-03 — A failed update is reported as a failure

**Preconditions.** Sandbox `HERMES_HOME`; run stages directly: `bash scripts/install.sh -Stage <name> -NonInteractive -Json -Branch main`. Existing checkout.

**Steps.**

1. Run the `repository` stage with `-Branch does-not-exist`.

**Expected.**

- `Could not fetch does-not-exist from https://github.com/Lexedgeai26/legal-hermes.git`; final frame `{"ok":false,"stage":"repository",…"reason":"exit code 1"}`; non-zero exit. Never `Repository ready`.

**Evidence to attach.** Terminal output and `echo $?`.


#### IS-04 — Bootstrap marker on macOS

**Preconditions.** Sandbox `HERMES_HOME`; run stages directly: `bash scripts/install.sh -Stage <name> -NonInteractive -Json -Branch main`. Stages through `complete`.

**Steps.**

1. Run the `complete` stage; `cat $HERMES_HOME/hermes-agent/.hermes-bootstrap-complete`.

**Expected.**

- Log `Bootstrap marker written`. JSON with `schemaVersion: 1`, `pinnedCommit` (40 hex chars), `pinnedBranch: main`, `completedAt` ISO-8601. No BOM (`head -c3 | xxd` does not start with `efbbbf`).

**Evidence to attach.** File contents.


#### IS-05 — Desktop stage finds the rebranded app

**Preconditions.** Sandbox `HERMES_HOME`; run stages directly: `bash scripts/install.sh -Stage <name> -NonInteractive -Json -Branch main`.

**Steps.**

1. Run the `desktop` stage with `-IncludeDesktop`.

**Expected.**

- `Desktop app built: $HERMES_HOME/hermes-agent/apps/desktop/release/mac-arm64/LexEdge AI.app`; `ok:true`. (Previously: `no app was found`.)

**Evidence to attach.** Terminal output.


### H · Isolation and cleanup


#### ISO-01 — The user's own Ollama is untouched

**Preconditions.** Your Ollama on 11434 with models; note `ls ~/.ollama/models/manifests/registry.ollama.ai/library` and `/api/version` first.

**Steps.**

1. Run PV-01 to completion, then quit the installer.

**Expected.**

- Same version on 11434; identical model list; no `qwen2.5` or `embeddinggemma` appeared in `~/.ollama` unless you had them before.

**Evidence to attach.** Before/after listings.


#### ISO-02 — Managed tree is self-contained and symlink-free

**Preconditions.** PV-01 complete.

**Steps.**

1. `find $HERMES_HOME/private-ai/runtime -type l | wc -l`
2. `cat $HERMES_HOME/private-ai/.lexedge-managed.json`
3. `du -sh $HERMES_HOME/private-ai`

**Expected.**

- `0` symlinks.
- Marker: `owner: ai.lexedge.hermes.unified.setup`, `runtimeVersion: 0.33.3`.
- About 1.6 GB for Compact + embedding.

**Evidence to attach.** Terminal output.


#### ISO-03 — Manual cleanup

**Preconditions.** PV-01 complete; installer quit.

**Steps.**

1. `curl -m 2 http://127.0.0.1:<managed port>/api/version`
2. `rm -rf $HERMES_HOME/private-ai`

**Expected.**

- Nothing is listening once the installer has exited (the runtime is a child of the installer in this build).
- Removing the tree removes runtime, models, config and journal. `~/.ollama` and the base install are unaffected.

**Evidence to attach.** Terminal output.


## 5. Test matrix status

Scenarios from handoff item 12.

| Scenario | Status | Notes |
| --- | --- | --- |
| Apple Silicon macOS — clean install, provisioning, resume, cancel | Verified | M5 / 32 GB, 2026-09-08 (headless e2e + stage runs) |
| Apple Silicon macOS — full GUI pass (screens) | Partially verified | Screens exercised individually; a full click-through of PV-01 is still to be recorded |
| Intel macOS | Not run | Same universal archive; x64 manifest entry present |
| Windows 10 / 11 x64 | Not run | Manifest entries present; llmfit and GPU detection incomplete |
| CPU-only, NVIDIA, AMD | Not run | Needs Windows/Linux hardware |
| Low memory / low disk | Partially | Disk and RAM hard filters are unit-tested; no manual run on a constrained machine |
| Existing Ollama on 11434 | Verified | Stepped around to 11435; user store untouched |
| Port 11434 owned by another process | Verified | Same mechanism (bind test), covered by unit test |
| Offline / interrupted download | Partially | Interrupted pull resumed in the live run; airplane-mode start-to-finish not run |
| Proxy / VPN / TLS inspection | Not run | Requires an enterprise network |
| Upgrade, repair, rollback, uninstall | Blocked | Repair/uninstall UI not built; `runtime.previous-*` set-aside exists, restore path does not |

## 6. Known behaviours that are not defects

- **First runtime start takes 10–25 s; later starts under a second.** macOS validates the freshly written binaries and Ollama's llama-server GPU discovery runs a watchdog on first launch. Measured: 22.6 s first, 171–390 ms after. Not caused by the extractor (a system `tar` copy behaves identically).
- **First document-search (embedding) call after a cold start takes 2–27 s.** Model load cost. The installer now warms it, records the cold figure in the `Verify the models` detail, and validation reports the warm latency (~55–130 ms).
- **`Execution mode unknown` in the report.** Ollama reported nothing in `/api/ps` for the model at that instant. Advisory, never a failure.
- **`Legal Large (development)` is always excluded on machines under 48 GB.** By design; it exists so the exclusion path is exercised.
- **Every analysis shows the conservative-fallback notice.** llmfit is not wired into the UI yet.
- **A launch without `--reinstall` opens the desktop instead of the installer.** Launcher fast path.
- **The managed runtime stops when the installer quits.** Expected until the desktop supervises it (item 8).

## 7. Reporting a defect

Attach, in this order: `bootstrap-installer.log` (set `HERMES_BOOTSTRAP_LOG=debug` and reproduce if it is thin), the screenshot of the failing screen with its exact error text, `provision-state.json`, `runtime.json` if it exists, `ls -la $HERMES_HOME/private-ai` and `downloads/`, and for provisioning failures the output of `curl 127.0.0.1:<managed port>/api/version` and `/api/tags`. Never attach `.env`, `auth.json`, `config.yaml`, prompts or client documents.

Template:

```text
Case: PV-02
Build: debug, HERMES_BUILD_PIN_BRANCH=main, commit 6c9a9a9ea2
Machine: macOS 15.x, Apple M5, 32 GB, existing Ollama 0.33.2 on 11434
Steps taken: …
Expected: …
Actual (exact text): …
Attachments: log, screenshot, journal
```
