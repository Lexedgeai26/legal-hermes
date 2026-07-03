# Desktop Installer Builds for macOS and Windows

This guide covers local creation of LexEdge AI desktop installers for public or tester distribution.

LexEdge AI is built on Hermes Agent, but public LexEdge installers must not bootstrap from an unpublished local commit or from private developer state. The Windows installer is especially sensitive because first launch installs the Python runtime into the user's local Hermes home.

## What Gets Packaged

Electron packages only the desktop app files declared in `apps/desktop/package.json`:

- `dist/**`
- `assets/**`
- `electron/**`
- `public/**`
- `package.json`
- selected `extraResources`

The installer must not package developer local state such as:

- `~/.hermes/.env`
- `~/.hermes/state.db`
- `~/.hermes/lexedge_practice.db`
- `~/.hermes/kanban.db`
- app support folders from an installed local app

The package config has explicit exclusions for `.env`, sqlite/db files, source maps, credential/secret-named files, and Electron test files. Keep those exclusions in place.

## Windows Bootstrap Model

The Windows desktop app is a thin installer. On first launch it resolves or creates:

```text
%LOCALAPPDATA%\hermes\hermes-agent
```

For public builds, the app packages:

```text
resources/bootstrap/install.ps1
resources/bootstrap/hermes-agent-source.zip
```

The bootstrap runner prefers the packaged `install.ps1` and passes `-SourceArchive <path>` to install from `hermes-agent-source.zip`. This avoids a first-launch failure where Windows tries to download:

```text
https://raw.githubusercontent.com/NousResearch/hermes-agent/<local-commit>/scripts/install.ps1
```

That URL fails when the local commit is not present in the public upstream repo. Do not remove the bundled source archive path unless the build is changed to use a reachable public LexEdge repository and ref.

## Prerequisites

From the repository root:

```bash
npm install
```

Recommended checks:

```bash
npm --workspace apps/desktop run typecheck
npm --workspace apps/desktop run build
```

For public releases, build from a clean committed tree. Local dirty builds are useful for internal testing, but `install-stamp.json` will show `"dirty": true`.

## Build macOS Installer

From `apps/desktop`:

```bash
rm -rf release-public-mac
env \
  -u GOOGLE_API_KEY \
  -u GEMINI_API_KEY \
  -u OPENAI_API_KEY \
  -u ANTHROPIC_API_KEY \
  -u OPENROUTER_API_KEY \
  -u HERMES_HOME \
  -u HERMES_DASHBOARD_SESSION_TOKEN \
  CSC_IDENTITY_AUTO_DISCOVERY=false \
  npm run builder -- --mac dmg zip --arm64 \
    -c.directories.output=release-public-mac \
    -c.mac.identity=null
```

Expected outputs:

```text
apps/desktop/release-public-mac/LexEdge-AI-<version>-mac-arm64.dmg
apps/desktop/release-public-mac/LexEdge-AI-<version>-mac-arm64.zip
```

The command above creates unsigned, non-notarized artifacts. Public macOS distribution should use an Apple Developer ID certificate and notarization credentials.

## Build Windows Installer

From `apps/desktop`:

```bash
rm -rf release-public-win-nsis
env \
  -u GOOGLE_API_KEY \
  -u GEMINI_API_KEY \
  -u OPENAI_API_KEY \
  -u ANTHROPIC_API_KEY \
  -u OPENROUTER_API_KEY \
  -u HERMES_HOME \
  -u HERMES_DASHBOARD_SESSION_TOKEN \
  CSC_IDENTITY_AUTO_DISCOVERY=false \
  node ../../node_modules/electron-builder/cli.js --win nsis --x64 \
    -c.directories.output=release-public-win-nsis
```

Expected output:

```text
apps/desktop/release-public-win-nsis/LexEdge-AI-<version>-win-x64.exe
```

Use `node ../../node_modules/electron-builder/cli.js` for Windows cross-builds on macOS. The project wrapper injects the local Electron runtime and can accidentally point a Windows build at the macOS Electron distribution.

MSI builds may fail on macOS if Wine/WiX is not fully available. NSIS `.exe` is the currently verified Windows installer path from macOS.

## Verify Packaged Bootstrap Resources

After a Windows build:

```bash
find release-public-win-nsis/win-unpacked/resources/bootstrap -maxdepth 1 -type f -print -exec ls -lh {} \;
```

Expected files:

```text
install.ps1
hermes-agent-source.zip
```

Check that the source archive does not contain local data:

```bash
unzip -l release-public-win-nsis/win-unpacked/resources/bootstrap/hermes-agent-source.zip \
  | rg "\\.env$|\\.db$|\\.sqlite|release-public|node_modules|\\.git/|apps/desktop/build|apps/desktop/dist"
```

`.env.example` and `.envrc` are source/template files and are expected. Real `.env` files and sqlite/db files are not expected.

## Secret and Local-State Audit

Run this from `apps/desktop` after building:

```bash
find release-public-mac release-public-win-nsis -type f \
  \( -name '.env*' -o -name '*.db' -o -name '*.sqlite' -o -name '*.sqlite3' -o -name '*credential*' -o -name '*secret*' \) \
  -print 2>/dev/null
```

The command should print nothing.

Check exact local key leakage without printing key values:

```bash
node - <<'NODE'
const fs = require('fs')
const path = require('path')

const roots = ['release-public-mac', 'release-public-win-nsis']
const envPath = path.join(process.env.HOME, '.hermes', '.env')
const keys = []

if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(GEMINI_API_KEY|GOOGLE_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|OPENROUTER_API_KEY)\s*=\s*(.+?)\s*$/)
    if (!m) continue
    const value = m[2].replace(/^['"]|['"]$/g, '').trim()
    if (value.length >= 16) keys.push({ name: m[1], value })
  }
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) walk(p, out)
    else if (ent.isFile()) out.push(p)
  }
  return out
}

const files = roots.flatMap(root => walk(root))
const hits = []
for (const key of keys) {
  const needle = Buffer.from(key.value)
  for (const file of files) {
    const st = fs.statSync(file)
    if (st.size > 350 * 1024 * 1024) continue
    if (fs.readFileSync(file).indexOf(needle) !== -1) {
      hits.push({ key: key.name, file })
    }
  }
}

console.log(JSON.stringify({ localKeysChecked: keys.map(k => k.name), exactHits: hits }, null, 2))
NODE
```

`exactHits` must be empty.

## Copy Artifacts to Downloads

Example:

```bash
DEST="$HOME/Downloads/LexEdge-AI-public-installers-$(date +%Y-%m-%d)"
mkdir -p "$DEST"

cp -p \
  release-public-mac/LexEdge-AI-*-mac-arm64.dmg \
  release-public-mac/LexEdge-AI-*-mac-arm64.zip \
  release-public-win-nsis/LexEdge-AI-*-win-x64.exe \
  "$DEST/"

shasum -a 256 "$DEST"/* > "$DEST/SHA256SUMS.txt"
```

## Clean Windows Tester Machine

For a clean first-run test on Windows, uninstall the app and remove:

```text
%LOCALAPPDATA%\hermes
```

If testing on a machine that already failed bootstrap, removing that directory clears partial runtime state.

## Release Notes

- Unsigned macOS builds will trigger Gatekeeper warnings.
- Unsigned Windows builds may trigger SmartScreen warnings.
- Windows icon/metadata stamping from macOS may warn if Wine is unavailable; that does not change the payload, but signed public releases should stamp and sign on a properly configured build host.
- The bundled source archive is intentionally larger than the old thin installer. It avoids first-run dependency on an unpublished commit or private repository.
