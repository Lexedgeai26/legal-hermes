# Installing and Building Hermes - Legal Agent by LexEdge AI

Hermes - Legal Agent by LexEdge AI is an open-source legal-focused assistant built on the MIT-licensed Hermes Agent runtime by Nous Research.

This guide covers:

- using Hermes - Legal Agent from the CLI
- running the desktop app in development
- building desktop packages for macOS and Windows
- importing legal skills
- public-release safety notes

## Requirements

Recommended development environment:

- Git
- Node.js 22 LTS
- Python 3.11
- `uv`
- macOS, Linux, WSL2, or Windows 10/11

Install `uv` if needed:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Install JavaScript dependencies from the repo root:

```bash
npm install
```

Create Python environment from the repo root:

```bash
uv venv .venv --python 3.11
source .venv/bin/activate
uv pip install -e ".[all,dev]"
```

On Windows PowerShell:

```powershell
uv venv .venv --python 3.11
.\.venv\Scripts\Activate.ps1
uv pip install -e ".[all,dev]"
```

## Run the CLI

Start Hermes - Legal Agent from the repo root:

```bash
source .venv/bin/activate
python cli.py
```

Useful CLI commands inside the assistant:

```text
/model              choose provider and model
/tools              configure tools
/skills             browse and enable skills
/new                start a new session
/reset              reset current session
/help               show command help
```

Useful shell commands:

```bash
python cli.py --help
python cli.py --version
python -m hermes_cli.main doctor
python -m hermes_cli.main setup
python -m hermes_cli.main gateway setup
python -m hermes_cli.main gateway start
```

## Configure model providers

Hermes - Legal Agent is model-provider agnostic. Configure one or more providers through setup or environment variables.

Examples:

```bash
cp .env.example .env
```

Then edit `.env` and add your provider keys. Do not commit `.env`.

Common provider variables include:

```text
OPENAI_API_KEY
ANTHROPIC_API_KEY
OPENROUTER_API_KEY
GEMINI_API_KEY
```

You can also use the in-app or CLI setup flow.

## Run the desktop app in development

From the repo root:

```bash
cd apps/desktop
npm run dev
```

This starts:

- Vite renderer on `127.0.0.1:5174`
- Electron desktop shell
- local Hermes - Legal Agent backend from the current repo

If another desktop instance is already running, close it first to avoid backend or profile conflicts.

## Build the desktop app

From the desktop package:

```bash
cd apps/desktop
npm run build
```

This builds the renderer and stages desktop resources.

## Build macOS desktop packages

Run on macOS:

```bash
cd apps/desktop
npm run dist:mac
```

Build only a DMG:

```bash
npm run dist:mac:dmg
```

Build only a ZIP:

```bash
npm run dist:mac:zip
```

Outputs are written to:

```text
apps/desktop/release/
```

For public distribution, use Apple code signing and notarization.

## Build Windows desktop packages

### Internal Windows ZIP from macOS or Windows

```bash
cd apps/desktop
npm run dist:win:zip
```

This creates a Windows x64 ZIP under:

```text
apps/desktop/release/
```

The ZIP is useful for internal testing. It is not the recommended end-user installer format.

### Professional Windows installer

Use a Windows 10/11 x64 machine or Windows CI runner.

```powershell
git clone <repo-url>
cd hermes-agent
npm install
cd apps\desktop
npm run dist:win:nsis
```

Optional MSI:

```powershell
npm run dist:win:msi
```

Outputs are written to:

```text
apps\desktop\release\
```

Recommended production path:

- build NSIS `.exe` on Windows
- code-sign the installer
- test on a clean Windows VM
- confirm first launch shows setup progress and dependency retry messages

macOS can cross-build a Windows ZIP, but NSIS/MSI packaging is more reliable on Windows because it depends on Windows packaging tooling.

## Import legal skills

Hermes - Legal Agent supports bundled legal skills and imported Claude Code legal plugin suites.

Desktop flow:

1. Open the desktop app.
2. Open **Skills**.
3. Click **Import Claude for Legal**.
4. Click **Preview**.
5. Click **Import**.
6. Enable the imported skills or groups.
7. Start a new chat session.

Example source:

```text
https://github.com/anthropics/claude-for-legal
```

CLI-style import:

```bash
python -m hermes_cli.main skills import https://github.com/anthropics/claude-for-legal --dry-run
python -m hermes_cli.main skills import https://github.com/anthropics/claude-for-legal
```

Imported legal plugins are organized into existing Hermes legal skill groups where possible.

## Use Hermes - Legal Agent for legal work

Example prompts:

```text
Review this services agreement and flag liability, renewal, termination, data, indemnity, and assignment risks.
```

```text
Summarize this pleading and build a chronology of material events.
```

```text
Draft a reply to this legal notice for lawyer review. Do not send it.
```

```text
Extract parties, obligations, dates, deadlines, and missing facts from this document.
```

Hermes - Legal Agent outputs are drafts and should be reviewed by a qualified lawyer before use.

## Public release checklist

Before publishing a public repository or release:

1. Ensure `.env`, logs, databases, private documents, client files, and local runtime state are not tracked.
2. Run a secret scanner such as `gitleaks` or `trufflehog`.
3. Rewrite Git history if sensitive files were ever committed.
4. Rotate any credential that may have appeared in commits, logs, screenshots, issues, or chat transcripts.
5. Preserve upstream Hermes Agent attribution and MIT license text.

If sensitive files were committed, deleting them in the latest commit is not enough. Rewrite history first.

## License and attribution

Hermes - Legal Agent by LexEdge AI is MIT licensed.

Hermes - Legal Agent by LexEdge AI is developed from the original MIT-licensed Hermes Agent project:

- Upstream: https://github.com/NousResearch/hermes-agent
- Original project: Nous Research
- LexEdge customization: Chirag Kansara, https://www.lexedge.ai/
