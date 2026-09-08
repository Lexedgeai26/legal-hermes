# Private AI Installer — Developer Build and Test Guide

Branch `feature/unified-online-installer` at `f14395c485`, 2026-09-08. From a fresh clone to a running installer and a green test run. Companion to the [QA guide](private-ai-installer-qa-guide.md) (what to test) and the [gap analysis](unified-online-installer-gap-analysis-and-developer-handoff.md) (what remains). For the desktop app itself see [INSTALL.md](../INSTALL.md) and [desktop installer builds](developer/desktop-installer-builds.md).

## 1. What you are building

The installer is a Tauri 2 app: a Rust core (`apps/bootstrap-installer/src-tauri`) and a React 19 / Vite UI (`apps/bootstrap-installer/src`). It does two jobs in sequence: drive the base install (`scripts/install.sh` on macOS/Linux, `scripts/install.ps1` on Windows, stage by stage over a JSON contract), then — if the user opts in — provision Private AI: download and verify a pinned Ollama runtime, install it under `$HERMES_HOME/private-ai`, start it loopback-only, pull and verify two models, write `runtime.json`, and validate real inference before declaring success.

| File | Role | Tests |
| --- | --- | --- |
| `src-tauri/src/lib.rs` | Tauri entry: mode/flags, launcher fast path, `AppState`, the command table. | `tests::*` |
| `src-tauri/src/bootstrap.rs` | Drives `install.sh` / `install.ps1` stage by stage; resolves the built desktop app by its real product name. | `bootstrap::` |
| `src-tauri/src/install_script.rs` | Where the install script comes from: dev checkout → bundled → GitHub raw at the build pin. | — |
| `src-tauri/src/hardware.rs` | Non-identifying hardware inventory; detects an existing Ollama on 11434. | `hardware::` |
| `src-tauri/src/private_ai.rs` | Recommendation engine: llmfit ∩ signed catalogue ∩ entitlement, hard filters, explainable scores; `RuntimeConfig` and its validator. | `private_ai::` |
| `src-tauri/src/private_ai_flow.rs` | The one command behind the analysis screen. The renderer never supplies hardware or catalogue. | `private_ai_flow::` |
| `src-tauri/src/signed_envelope.rs` | Ed25519 verification of exact payload bytes. | `signed_envelope::` |
| `src-tauri/src/catalogue.rs` | Signed legal-model catalogue: trusted keys (rotation by key id), expiry, emergency disablement; the debug-only development catalogue. | `catalogue::` |
| `src-tauri/src/component_manifest.rs` | Signed component manifest: where the runtime comes from, https-only, exact platform/architecture. | `component_manifest::` |
| `src-tauri/src/download.rs` | Resumable download with Range, size + SHA-256 verification, https-only redirects. | `download::` |
| `src-tauri/src/extract.rs` | Safe archive extraction: no traversal, no symlinks created, caps, cleanup on failure. | `extract::` |
| `src-tauri/src/runtime.rs` | Managed Ollama lifecycle: paths, ownership marker, port step-around, loopback env, spawn with drained pipes, atomic `runtime.json`. | `runtime::` |
| `src-tauri/src/ollama_api.rs` | Loopback-only client: pull with progress, digest/size verification, immutable-tag policy, the `RuntimeProbe` used by validation. | `ollama_api::` |
| `src-tauri/src/validation.rs` | The ten-check gate with a real socket test; slow model warns, never substitutes. | `validation::` |
| `src-tauri/src/provision.rs` | Nine idempotent stages, resume journal, cancellation, events. `EventSink` keeps it testable without Tauri. | `provision::` + the ignored live e2e |
| `src-tauri/src/llmfit.rs` | Bounded execution of a hash-verified llmfit binary (not yet wired to the UI). | `llmfit::` (unix only) |
| `src/store.ts` | nanostores state, Tauri event subscriptions (`bootstrap`, `private-ai`), all actions. | `npm run typecheck` |
| `src/routes/*.tsx` | welcome → privacy → analysis → progress → provision → success / failure. | — |
| `src-tauri/schemas/*.json` | Contracts for every persisted object. Keep each in lockstep with its Rust struct. | fixture tests |
| `src-tauri/test-fixtures/` | Development catalogue and component manifest (compiled in via `include_str!`), llmfit capture, golden install manifest. | — |

## 2. Prerequisites

### macOS (the verified platform)

| Item | Notes |
| --- | --- |
| Xcode Command Line Tools | `xcode-select --install`. Tauri links against system frameworks. |
| Rust | `rustup` stable. Minimum 1.77 (`rust-version` in Cargo.toml); verified with 1.93. |
| Node.js 22 + npm | Verified with v22.23 / npm 12. The installer UI is Vite + React 19. |
| Python 3 | Any modern Python for the test helpers. The base install provisions its own 3.11 through `uv`; you do not need to. |
| git | The base install clones the repository on the target machine. |
| Disk | Roughly 10 GB free: the Rust `target/` directory grows to several GB, plus ~2 GB for development models. |
| Network | github.com (raw and releases) and registry.ollama.ai. |

### Windows

| Item | Notes |
| --- | --- |
| Rust (MSVC toolchain) + Visual Studio Build Tools | Tauri on Windows needs the MSVC linker. |
| Node.js 22, git, PowerShell 5.1+ | `install.ps1` drives the base install. |
| WebView2 runtime | Present on Windows 10 20H2+ / 11; the bundle embeds a bootstrapper for older machines. |
| Status | The component manifest carries x64 and arm64 entries for Ollama 0.33.3, `install.ps1` writes the bootstrap marker, and the Windows workflow builds `LexEdge-Hermes-Agent-Setup.exe` — but no Windows run of the Private AI path has been performed yet. Expect to be the first. |

## 3. First-time setup

### 1. Clone

```bash
git clone https://github.com/Lexedgeai26/legal-hermes.git hermes-agent
cd hermes-agent
git checkout feature/unified-online-installer
```

The installer downloads `scripts/install.sh` from this repository at the branch baked into the binary, so the branch you build from must exist on `origin`.

### 2. Install JavaScript dependencies

```bash
npm ci
```

The root package is an npm workspace (`apps/*`, `ui-tui`, `web`), so this installs the installer's dependencies too. Takes a few minutes the first time.

### 3. Prove the Rust side

```bash
cd apps/bootstrap-installer/src-tauri
cargo test
```

Expected: `test result: ok. 129 passed; 0 failed; 1 ignored`. The first compile pulls Tauri and takes 3–5 minutes; later runs take seconds.

### 4. Prove the UI

```bash
cd apps/bootstrap-installer
npm run typecheck && npm run build
```

Expected: `tsc` exits 0 and Vite prints `✓ built in …` with `dist/assets/lexedge-app-icon-….png` in the list.

## 4. Build modes

### Live development

```bash
cd apps/bootstrap-installer
npm run tauri:dev
```

Starts Vite on `127.0.0.1:5175` and a debug Rust binary that loads it. React edits hot-reload; Rust edits need a restart. The window runs the real Tauri commands, so hardware analysis and provisioning work here. Launch args cannot be passed this way, so an existing install on macOS may trigger the launcher fast path — set `HERMES_HOME` to an empty sandbox in the shell first.

### Debug bundle (what QA runs)

```bash
cd apps/bootstrap-installer
HERMES_BUILD_PIN_BRANCH=main npm run tauri:build:debug
```

Produces `src-tauri/target/debug/bundle/macos/LexEdge Hermes Agent Setup.app`. This is the only build that can provision Private AI: the development catalogue, component manifest and signing key exist only under `debug_assertions`. 2–4 minutes.

### Release bundle

```bash
cd apps/bootstrap-installer
npm run tauri:build
```

Optimised, LTO, stripped. Refuses to provision by design — `No signed catalogue or component manifest has been provisioned for this build` — until release engineering pins production keys in `catalogue::trusted_keys()` and supplies signed inputs. Use it to test the base install and packaging, not Private AI.

### Build-time pins

| Variable | Effect |
| --- | --- |
| `HERMES_BUILD_PIN_BRANCH` | Branch name baked into the binary; the installer downloads `scripts/install.sh` from it and clones it. Defaults to the checkout's current branch — which 404s if that branch is not on `origin`. Pin to `main` for local work unless your branch is pushed. |
| `HERMES_BUILD_PIN_COMMIT` | Optional immutable pin (SHA, tag or branch resolved to a SHA). Required for reproducible release builds. |

## 5. Running the installer

Launch the binary inside the bundle directly so flags and environment reach it (`open -a` passes neither):

```bash
cd apps/bootstrap-installer
APP="src-tauri/target/debug/bundle/macos/LexEdge Hermes Agent Setup.app/Contents/MacOS/LexEdge-Hermes-Agent-Setup"
HERMES_HOME=$(mktemp -d) HERMES_BOOTSTRAP_LOG=debug "$APP" --reinstall
```

| Knob | Effect |
| --- | --- |
| `--reinstall` / `--repair` | Show the setup UI even when an install exists. Without one of these, a macOS launch with an existing install relaunches the desktop and exits (`hermes already installed — relaunched desktop`). |
| `HERMES_HOME=<dir>` | Sandbox everything: install root, logs, `private-ai/`. Recommended for every developer run. |
| `HERMES_SETUP_DEV_REPO_ROOT=<checkout>` | Use the checkout's `scripts/install.sh` instead of downloading. Lets you test script changes before pushing. The repository stage still clones from GitHub. |
| `HERMES_BOOTSTRAP_LOG=debug` | Verbose log including the managed runtime's own output, at `$HERMES_HOME/logs/bootstrap-installer.log`. |

To iterate on the install scripts without pushing, add `HERMES_SETUP_DEV_REPO_ROOT=$PWD/../..` (the checkout root). To watch the log: `tail -f $HERMES_HOME/logs/bootstrap-installer.log`.

## 6. Testing

Run from `apps/bootstrap-installer/src-tauri` unless the command says otherwise.

| What | Command | Expect |
| --- | --- | --- |
| Whole unit suite | `cargo test` | 129 pass, 1 ignored |
| One module | `cargo test runtime::` | e.g. 15 runtime tests; substitute any module name from the map |
| One test, with output | `cargo test occupied_port_is_stepped_around -- --nocapture` | prints `eprintln!` output |
| Live end-to-end (network, ~1.2 GB, 3–4 min) | `cargo test provisions_private_ai_end_to_end -- --ignored --nocapture --test-threads=1` | nine `[stage] … Succeeded`, `[complete] passed=true`, ten `[check] … Passed`; prints the throwaway `HERMES_HOME` it used |
| Live resume (20–60 s) | `LEXEDGE_E2E_HOME=<that home> cargo test provisions_private_ai_end_to_end -- --ignored --nocapture --test-threads=1` | runtime install and verified pulls `Skipped` |
| Install-script stages, one at a time | `HERMES_HOME=$(mktemp -d) bash scripts/install.sh -Stage prerequisites -NonInteractive -Json -Branch main` | final line `{"ok":true,"stage":"prerequisites","skipped":false}`; stages: prerequisites, repository, venv, python-deps, node-deps, path, config, setup, gateway, desktop (add `-IncludeDesktop`), complete |
| Install-script stage list | `bash scripts/install.sh --manifest -IncludeDesktop | python3 -m json.tool` | 11 stages; frozen as `test-fixtures/install-manifest.v1.json` |
| Desktop app (only if you change it) | `cd apps/desktop && npm run pack` | `release/mac-arm64/LexEdge AI.app`; signing takes a long time per file — see INSTALL.md |

The manual cases live in the [QA guide](private-ai-installer-qa-guide.md).

## 7. Common changes

### Add or change a development model

Edit `src-tauri/test-fixtures/catalogue/dev-catalogue.json`. Every tag must be immutable (never `:latest`). Get the registry digest and size, then rebuild — the fixture is compiled in with `include_str!`:

```bash
NAME=qwen2.5; TAG=0.5b
M=$(curl -s -H 'Accept: application/vnd.docker.distribution.manifest.v2+json' https://registry.ollama.ai/v2/library/$NAME/manifests/$TAG)
printf '%s' "$M" | shasum -a 256 | cut -d' ' -f1          # expectedDigest
printf '%s' "$M" | python3 -c "import sys,json; print(sum(l['size'] for l in json.load(sys.stdin)['layers']))"   # expectedSizeBytes
```

The digest is the SHA-256 of the manifest body, which is what Ollama reports in `/api/tags`; the live run confirmed the two match.

### Bump the pinned Ollama runtime

Edit `src-tauri/test-fixtures/components/dev-components.json`. Take hashes from the release's own checksum file and sizes from the GitHub API, never from a local download:

```bash
V=v0.33.3
curl -sL https://github.com/ollama/ollama/releases/download/$V/sha256sum.txt | grep -E 'darwin.tgz|windows-(amd64|arm64).zip'
curl -s https://api.github.com/repos/ollama/ollama/releases/tags/$V | python3 -c "import sys,json
for a in json.load(sys.stdin)['assets']: print(a['size'], a['name'])"
```

Then run the live end-to-end test. The manifest is `https://` only and the download layer re-verifies size and hash before anything is trusted.

### Regenerate the icons

The master is `branding/lexedge-app-icon-1024.png` (the supplied badge centred on a 1024 square at 88%). Everything in `src-tauri/icons/` derives from it:

```bash
cd apps/bootstrap-installer
npx tauri icon branding/lexedge-app-icon-1024.png
rm -rf src-tauri/icons/ios src-tauri/icons/android
```

The welcome screen uses the 256 px copy at `src/assets/lexedge-app-icon.png`.

### Add a provisioning stage

Append to `STAGES` in `provision.rs` (order matters — it is the journal vocabulary), implement it with `Stage::begin` / `done` / `skipped`, and make it check its own postcondition first so a resumed run skips it. Mirror any new event field in `src/store.ts`. Add a unit test for the pure part and run the live e2e once.

### Change a persisted object

Update the JSON Schema in `src-tauri/schemas/` and the Rust struct together, bump `schemaVersion` on a breaking change, and keep the golden fixture in `test-fixtures/` current. Unknown versions must fail with a clear, non-sensitive error.

### Understand the signing keys

`catalogue::DEV_SIGNING_SEED` / `DEV_KEY_ID` exist only under `debug_assertions`; debug builds sign the development catalogue and manifest at runtime and verify them through the same code path production will use. `trusted_keys()` is where release engineering pins production public keys, keyed by id so rotation is additive.

## 8. Troubleshooting

- **`Failed to download install.sh: HTTP 404` on the failure screen** — The branch baked into the binary is not on `origin`. Rebuild with `HERMES_BUILD_PIN_BRANCH=main`, or push your branch.
- **`No signed catalogue or component manifest has been provisioned for this build`** — You are running a release build. Use `npm run tauri:build:debug`.
- **A new file compiles but `git status` never shows it** — The root `.gitignore` deliberately ignores `*client*`, `*Client*`, `*matter*`, `*contract*`, `*NDA*` and document types to keep client material out of the repository. Check with `git check-ignore -v <file>` and rename the file (this is why the Ollama client is `ollama_api.rs`). Do not weaken the rule.
- **The installer opens the desktop app instead of the setup UI** — Launcher fast path. Add `--reinstall`, or use an empty `HERMES_HOME`.
- **First `Start the runtime` takes 10–25 s; the first embedding takes seconds** — Ollama's own first-launch cost on macOS (code-signature validation, llama-server GPU discovery). Second start is sub-second. Not the extractor — a system `tar` copy behaves identically.
- **`Ollama … on 127.0.0.1:11435`** — Something — usually your own Ollama — holds 11434. That is the design: it is never evicted.
- **Clicking the installer from an automation tool does nothing** — The Tauri webview does not accept synthetic background clicks on macOS. Drive it by hand, or test the Rust side through the `EventSink` as the live e2e does.
- **`cargo test` says `no method named json`** — `reqwest` needs its `json` feature; it is enabled in Cargo.toml — check you did not drop it.
- **Shell one-liners from Linux fail on macOS** — No `timeout` command; BSD `sed` has no `\|` alternation. Use `python3` for parsing.
- **`Cargo.lock` shows as modified** — It is tracked on purpose (reproducible builds of a shipped binary). Commit it with your dependency change.
- **`Object has been destroyed` dialog from the desktop app** — Fixed in `d41d4cce`; if you see it, you are running an older build of `LexEdge AI.app`.

## 9. Git workflow

- Branch from `main`; the installer is developed on `feature/unified-online-installer`.
- Conventional commit prefixes: `feat(installer):`, `fix(install):` for the scripts, `fix(desktop):`, `chore(installer):`, `docs(installer):`. Say what broke and why the fix is right, not just what changed.
- Never put a token on a command line or in a file. Register it with `gh auth login --with-token` or export it in your own shell and let git's credential mechanism read it, as `push-lexedge-to-github.sh` does. Pushes that touch `.github/workflows/` need a token with the `workflow` scope.
- The installer pulls scripts from **GitHub** (`Lexedgeai26/legal-hermes`). Work pushed only to GitLab does not reach a customer's installer.
