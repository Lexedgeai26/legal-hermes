# LexEdge AI Desktop

[![Download](https://img.shields.io/badge/Download-macOS%20%7C%20Windows-087EA4)](https://lexedge.ai/download-hermes/)
[![Source](https://img.shields.io/badge/Source-Lexedgeai26%2Flegal--hermes-181717?logo=github)](https://github.com/Lexedgeai26/legal-hermes)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](../../LICENSE)

LexEdge AI Desktop is the native interface for [LexEdge Legal Hermes](../../README.md). It combines the Hermes agent runtime with legal onboarding, profiles, Matter Workspaces, legal skills, documents, previews, voice, messaging, scheduled work, and optional n8n/MCP automation.

## Install

Download the macOS or Windows installer from [lexedge.ai/download-hermes](https://lexedge.ai/download-hermes/), then follow the [desktop installation guide](../../docs/desktop-installation.md).

On first launch, the app installs a user-scoped local runtime and shows live progress. It may prepare Python, Git, Node.js, packages, and browser helpers. Keep the app open until all setup stages complete.

Default runtime locations:

```text
macOS/Linux: ~/.hermes
Windows:     %LOCALAPPDATA%\hermes
```

The legal onboarding wizard then configures the practice profile, provider/model, and legal skills. A completed legal onboarding also completes provider onboarding so users are not asked for the same provider twice.

## Desktop capabilities

| Capability | Description |
| --- | --- |
| Agent chat | Streaming responses, tool activity, structured results, and reusable sessions. |
| Matter Workspaces | Connect an existing local legal folder, index supported documents, and open bounded matter context in chat. |
| Skills | Enable legal and general-purpose skill groups for repeatable work. |
| Documents and artifacts | Browse files, preview results, and prepare reviewable outputs. |
| Profiles | Separate practices, teams, clients, skills, settings, sessions, and memory. |
| Models | Connect supported cloud APIs, compatible endpoints, or local models. |
| Automation | Use cron for scheduled work and MCP for approved external tools, including optional n8n workflows. |
| Messaging | Configure supported channels without exposing raw infrastructure during normal legal work. |
| Recovery | Retry or repair first-launch setup and inspect redacted local logs. |

See the [Matter Workspace guide](../../docs/matter-workspaces.md) and [n8n integration guide](../../docs/n8n-guide.md).

## Development

Install workspace dependencies from the repository root:

```bash
git clone https://github.com/Lexedgeai26/legal-hermes.git
cd legal-hermes
npm install
cd apps/desktop
npm run dev
```

The development command starts the Vite renderer and Electron shell, then boots the Python backend from the current source checkout.

Point development at a specific checkout or isolated data directory:

```bash
HERMES_DESKTOP_HERMES_ROOT=/path/to/legal-hermes npm run dev
HERMES_HOME=/tmp/lexedge-desktop-test npm run dev
npm run dev:fake-boot
```

Do not run development builds against production client data.

## Build packages

```bash
npm run build          # renderer and staged resources
npm run pack           # unpacked current-platform app
npm run dist:mac       # macOS DMG + ZIP
npm run dist:win:nsis  # Windows NSIS installer
npm run dist:win:msi   # optional Windows MSI
npm run dist:linux     # AppImage + deb + rpm
```

Build Windows installers on Windows CI or a controlled Windows builder for the most reliable signing and installer validation. Public macOS releases should be signed and notarized; public Windows releases should be signed and tested on a clean Windows VM.

The packaged app includes platform bootstrap scripts and a sanitized source archive:

```text
resources/bootstrap/install.sh     # macOS/Linux
resources/bootstrap/install.ps1    # Windows
resources/bootstrap/hermes-agent-source.zip
```

This lets first launch install the exact packaged source without relying on a private or unpublished commit URL.

See [Desktop Installer Builds](../../docs/developer/desktop-installer-builds.md) for release engineering.

## Verification

From `apps/desktop`:

```bash
npm run typecheck
npm run test:ui
npm run test:desktop:platforms
npm run build
```

Run the full lint suite as part of repository cleanup; it may currently report pre-existing style issues outside a focused change. Do not describe a release as verified unless the required release checks and clean-machine installation test have passed.

## Troubleshooting

Logs:

```text
macOS/Linux: ~/.hermes/logs/desktop.log
               ~/.hermes/logs/bootstrap-*.log

Windows:     %LOCALAPPDATA%\hermes\logs\desktop.log
             %LOCALAPPDATA%\hermes\logs\bootstrap-*.log
```

Use **Retry** for a temporary download failure and **Repair install** when the runtime is incomplete. Repair should retain chats and configuration. A clean reset removes local credentials, sessions, profiles, and runtime state; follow the backup-first instructions in the [desktop installation guide](../../docs/desktop-installation.md#reset-for-a-clean-test).

Open public bugs at [GitHub Issues](https://github.com/Lexedgeai26/legal-hermes/issues). Never attach `.env`, `auth.json`, databases, client files, or unredacted logs.

## Licence and attribution

MIT—see [LICENSE](../../LICENSE).

LexEdge AI is an independent legal-industry customisation of the MIT-licensed [Nous Research Hermes Agent](https://github.com/NousResearch/hermes-agent). LexEdge AI is not affiliated with, endorsed by, sponsored by, or partnered with Nous Research, Hermes Agent, or n8n. Their names, marks, and logos belong to their respective owners.
