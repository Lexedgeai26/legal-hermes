# Build, Release, and Installed App Runbook

This runbook covers local development builds, installed app updates, packaging, and verification.

## Local Development

Install dependencies once from the repo root:

```bash
npm install
```

Run the desktop app:

```bash
npm --workspace apps/desktop run dev
```

Use an isolated profile for testing:

```bash
HERMES_HOME=/tmp/lexedge-dev npm --workspace apps/desktop run dev
```

## Build

```bash
npm --workspace apps/desktop run build
```

Recommended checks:

```bash
npm --workspace apps/desktop run typecheck
npm --workspace apps/desktop run lint
npm --workspace apps/desktop run test:ui
```

Python checks depend on the changed area. For backend syntax checks:

```bash
python -m py_compile hermes_cli/web_server.py hermes_cli/matters.py
```

## Package Installers

From `apps/desktop`:

```bash
npm run pack
npm run dist:mac
npm run dist:win
npm run dist:linux
```

Use platform-specific signing credentials for production installers.

## Update an Installed macOS App During Development

Use this when the installed app must reflect local frontend changes immediately.

```bash
npm --workspace apps/desktop run build

APP_RES="~/Applications/LexEdge AI.app/Contents/Resources"
STAMP="$(date +%Y%m%d%H%M%S)"
TMP="$(mktemp -d)"
cp "$APP_RES/app.asar" "$APP_RES/app.asar.before-$STAMP"
npx asar extract "$APP_RES/app.asar" "$TMP/app"
rm -rf "$TMP/app/apps/desktop/dist" "$TMP/app/dist"
mkdir -p "$TMP/app/apps/desktop"
cp -R apps/desktop/dist "$TMP/app/apps/desktop/dist"
cp -R apps/desktop/dist "$TMP/app/dist"
npx asar pack "$TMP/app" "$APP_RES/app.asar"
rm -rf "$TMP"
osascript -e 'tell application "LexEdge AI" to quit' || true
sleep 2
open -a "~/Applications/LexEdge AI.app"
```

## Update Installed Backend Runtime During Development

If backend Python code changes and the installed app uses `~/.hermes/hermes-agent`, copy changed files into the installed runtime and restart.

Example:

```bash
cp hermes_cli/matters.py ~/.hermes/hermes-agent/hermes_cli/matters.py
python -m py_compile ~/.hermes/hermes-agent/hermes_cli/matters.py
osascript -e 'tell application "LexEdge AI" to quit' || true
sleep 2
open -a "~/Applications/LexEdge AI.app"
```

Prefer full installer/update flows for production. Direct copying is for local development only.

## Logs

Desktop logs:

```bash
tail -f ~/.hermes/logs/desktop.log
```

Profile logs may be under:

```bash
~/.hermes/profiles/<profile-name>/logs/
```

## Recovery

Force clean first-launch setup:

```bash
rm "$HOME/.hermes/hermes-agent/.hermes-bootstrap-complete"
```

Rebuild runtime virtualenv:

```bash
rm -rf "$HOME/.hermes/hermes-agent/venv"
```

Reset a throwaway test profile:

```bash
rm -rf /tmp/lexedge-dev
```

## Git Workflow

```bash
git status --short
git add <changed-files>
git commit -m "Short imperative summary"
git push
```

Before pushing:

- Build if frontend changed.
- Run py_compile or targeted tests if backend changed.
- Keep generated caches and local app backups out of commits.

