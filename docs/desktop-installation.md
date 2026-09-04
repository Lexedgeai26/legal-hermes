# Install LexEdge AI on macOS or Windows

This guide is for lawyers and legal teams installing the desktop application. Developers and release engineers should use [INSTALL.md](../INSTALL.md) instead.

## Before you begin

- Download only from [lexedge.ai/download-hermes](https://lexedge.ai/download-hermes/) or an official release linked from [Lexedgeai26/legal-hermes](https://github.com/Lexedgeai26/legal-hermes).
- Use a user account that can install normal desktop applications.
- Keep a stable internet connection available during the first launch.
- Have a supported model-provider account or a local model endpoint ready. Provider charges are separate from LexEdge.
- If a corporate proxy, VPN, antivirus product, or TLS inspection service controls downloads, ask the firm's administrator to allow the installation sources shown in the setup log.

The desktop application installs the agent runtime for the current user. Administrator access should not normally be required for the runtime itself.

## macOS installation

1. Download the macOS DMG or ZIP from the [official download page](https://lexedge.ai/download-hermes/).
2. If using a DMG, open it and drag **LexEdge AI** into **Applications**. If using a ZIP, extract it first and move the application into **Applications**.
3. Open **LexEdge AI** from Applications.
4. Confirm that macOS identifies the expected signed publisher. If the publisher is missing or unexpected, stop and verify the download rather than bypassing the warning.
5. Keep the setup window open until all stages complete.

On first launch, LexEdge may prepare Git, Python, a virtual environment, Python packages, Node.js packages, browser helpers, configuration, and the local gateway. The packaged app includes a source archive so the installer does not depend on an unpublished developer commit.

The default runtime and user-data location is:

```text
~/.hermes
```

Useful logs:

```text
~/.hermes/logs/desktop.log
~/.hermes/logs/bootstrap-*.log
```

## Windows installation

LexEdge runs natively on Windows 10/11; WSL is not required.

1. Download the Windows x64 installer from the [official download page](https://lexedge.ai/download-hermes/).
2. Run `LexEdge-AI-<version>-win-x64.exe`.
3. Confirm the expected publisher in Windows. If SmartScreen reports an unknown or unexpected publisher, stop and verify the file with LexEdge support rather than ignoring the warning.
4. Complete the normal installer and launch **LexEdge AI** from the Start Menu or desktop shortcut.
5. Keep the first-launch setup window open. Large Node.js dependencies can take several minutes on a fresh or restricted machine.

The default Windows runtime and user-data location is:

```text
%LOCALAPPDATA%\hermes
```

Useful logs:

```text
%LOCALAPPDATA%\hermes\logs\desktop.log
%LOCALAPPDATA%\hermes\logs\bootstrap-*.log
```

The Windows bootstrap can install user-scoped Python, portable Git, portable Node.js, Python packages, Node modules, and browser helpers. It does not require a separate system-wide development environment.

## First-launch setup

The installer reports ten broad stages:

1. prerequisites;
2. repository/source installation;
3. Python virtual environment;
4. Python dependencies;
5. Node.js dependencies and browser helper preparation;
6. command path setup;
7. configuration;
8. agent setup;
9. local gateway;
10. completion.

Temporary pauses are normal while package managers download or verify files. The Node dependency stage is commonly the longest. The setup runner uses automatic retries and allows this stage substantially more time than the smaller stages.

After runtime setup, the legal onboarding wizard asks for:

- practice role and workspace name;
- professional and jurisdiction preferences;
- model provider and model connection;
- legal skill groups;
- optional capabilities.

Completing legal onboarding also completes provider onboarding; the app should not ask for the same provider again.

## Your first legal task

Start with a low-risk, reviewable task:

```text
Summarise this document, identify the parties and dates, and list every fact that requires confirmation. Do not send or file anything.
```

For ongoing work, create a [Matter Workspace](matter-workspaces.md) and attach the local matter folder before opening it in chat.

## Privacy choices during setup

LexEdge's backend runs locally by default, but the chosen connectors define where data goes:

- A local model plus local files provides the strongest data-locality posture.
- A cloud model receives the content included in model requests.
- Gmail, Drive, OCR, research, calendar, Slack, and other connectors receive the data sent to their APIs.
- n8n can be self-hosted, but its external connectors still cross the firm's privacy boundary.

Use firm-approved providers and never paste a production credential into a screenshot, issue, chat transcript, or shared document.

## Repair a failed installation

Use the buttons on the failure screen in this order:

1. **Retry** for a temporary connection or package-manager failure.
2. **Repair install** to rerun the installer while retaining user configuration.
3. **Open logs** and copy the failure lines if the same stage fails again.
4. **Use local backend** only when a developer or administrator has prepared and approved one.

When reporting a problem, include the operating-system version, LexEdge version, failed stage name, and redacted log excerpt. Do not attach `.env`, `auth.json`, databases, client documents, or unredacted tokens.

Open an issue at [github.com/Lexedgeai26/legal-hermes/issues](https://github.com/Lexedgeai26/legal-hermes/issues) for non-sensitive bugs. Use [GitHub Security Advisories](https://github.com/Lexedgeai26/legal-hermes/security/advisories/new) for security-sensitive reports.

## Reset for a clean test

Resetting removes local sessions, profiles, models, credentials, Matter Workspace metadata, and installed runtime files. Back up anything needed first.

Close LexEdge AI before removing data.

macOS:

```bash
mv "$HOME/.hermes" "$HOME/Downloads/hermes-backup"
mv "$HOME/Library/Application Support/LexEdge AI" "$HOME/Downloads/LexEdge-AI-app-data-backup"
```

Windows PowerShell:

```powershell
Move-Item "$env:LOCALAPPDATA\hermes" "$env:USERPROFILE\Downloads\hermes-backup"
Move-Item "$env:APPDATA\LexEdge AI" "$env:USERPROFILE\Downloads\LexEdge-AI-app-data-backup" -ErrorAction SilentlyContinue
```

Use unique backup folder names if those destinations already exist. Relaunch the application to exercise the first-install flow.

## Updates and removal

Use the in-app update flow when an official update is available. Before a major update, back up important local matter folders and the Hermes data directory.

The app's uninstall settings distinguish between removing only the desktop interface, removing the interface and runtime while preserving user data, and a full removal. Read the confirmation carefully before choosing full removal.
