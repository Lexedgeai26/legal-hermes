# Install LexEdge AI on macOS or Windows

This guide is for lawyers and legal teams installing the desktop application. Developers and release engineers should use [INSTALL.md](../INSTALL.md) instead.

## Before you begin

- Download only from [lexedge.ai/download-hermes](https://lexedge.ai/download-hermes/) or an official release linked from [Lexedgeai26/legal-hermes](https://github.com/Lexedgeai26/legal-hermes).
- Use a user account that can install normal desktop applications.
- Keep a stable internet connection available during the first launch.
- Check the machine has at least **8 GB of RAM and 10 GB of free disk** for a
  normal install. To run [Private AI](#what-private-ai-needs-to-run-well) — a
  legal model on the computer itself — **16 GB of RAM is the practical minimum**
  and 32 GB is comfortable. A machine below that still runs LexEdge fully using
  a cloud provider.
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


The macOS installers are signed with a Developer ID certificate and notarized by
Apple, so they open normally — no right-click-Open step and no security warning.
Apple Silicon and Intel builds are published separately and are not
interchangeable; check which Mac you have (Apple menu → About This Mac) and take
the matching download.

Once Hermes is installed, opening the setup app again **launches LexEdge AI
instead of showing setup**. That is intentional, so the installed icon works as
a normal launcher. To run setup again — to repair an install or change the
Private AI choice — use the repair instructions below.

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

## Choosing Private AI or a cloud provider

Early in setup LexEdge asks where the language model should run. Both answers
produce a complete, working install; neither is a downgrade.

| | Private AI | Cloud provider |
| --- | --- | --- |
| Where the model runs | This computer | The provider's servers |
| Matter documents | Never leave the machine | Sent to the provider with each request |
| Works offline | Yes | No |
| Requirements | Enough memory and disk | Internet connection and an API key |
| Setup time | Several gigabytes to download | Minutes |

The choice can be changed later in Settings. Choosing a cloud provider does not
limit anything else in the application.

### What Private AI needs to run well

Running a legal model locally is demanding. These are the thresholds that matter
in practice, not just the ones that let it install:

| | Minimum | Recommended |
| --- | --- | --- |
| Memory (RAM) | 16 GB | 32 GB or more |
| Free disk | 12 GB | 20 GB or more |
| Processor | 4-core, 2018 or later | 8-core, Apple Silicon or recent Intel/AMD |
| Graphics | not required | a dedicated GPU, or Apple Silicon, makes replies markedly faster |

**8 GB of RAM is not enough.** After the operating system takes its share there
is not enough left for a model of usable quality, and setup will not offer one.

**Meeting the memory requirement does not guarantee good speed.** Setup checks
memory and disk, because those decide whether a model can run at all. It does
not currently measure processor speed, so an older machine with plenty of RAM
can pass the check and still answer slowly — long pauses before a reply,
especially on long documents. If that describes the experience, a cloud provider
will be considerably faster on the same machine.

**On a machine that falls short, choose a cloud provider.** Every legal feature
works the same way; only the place the model runs changes. That is a better
outcome than a local model too slow to use.

### The hardware check

Choosing Private AI runs a short check of this computer before anything is
downloaded. It reads the processor, total memory, graphics memory, and free disk
space, then shows:

- the models this machine can run, each with the reasons it fits and the
  download size;
- the models it cannot run, each with the specific reason — typically not enough
  memory or not enough free disk.

Nothing is hidden. If a model is excluded, the reason is stated so the decision
is reviewable rather than mysterious.

A model is only offered if it comes from the **signed LexEdge catalogue** of
legally reviewed models *and* meets two separate technical requirements: a
context window large enough for real legal documents, and support for the tool
calls that every chat turn uses. Both are checked independently, because a model
can satisfy one and fail the other.

The recommended model is pre-selected. It is a recommendation, not a
restriction — any listed model can be chosen instead, and the total download
size updates with the selection.

### If no model fits this computer

On a machine that cannot run any approved model, the cloud provider route gives
a full install with no loss of legal features. Private AI is an addition to the
product, not a prerequisite for it.

### If Ollama is already installed

Setup detects an existing Ollama installation and reports which of its models
meet the requirements. LexEdge installs **its own runtime on a separate port**
and will not modify, reconfigure, or remove an existing installation. A runtime
on a different machine is deliberately not used, because sending matter
documents to another host would defeat the purpose of choosing Private AI.

### What gets installed

Private AI provisions a local model runtime and two models — one for generating
text and one for search indexing. Each download is verified against a published
checksum before it is used. All of it is managed by the installer; there is no
separate product to install and no terminal commands to run.

## Your first legal task

Start with a low-risk, reviewable task:

```text
Summarise this document, identify the parties and dates, and list every fact that requires confirmation. Do not send or file anything.
```

For ongoing work, create a [Matter Workspace](matter-workspaces.md) and attach the local matter folder before opening it in chat.

## Privacy choices during setup

LexEdge's backend runs locally by default, but the chosen connectors define where data goes:

- **Private AI** plus local files provides the strongest data-locality posture:
  prompts and matter documents are processed on this machine and are not sent to
  LexEdge or to a model provider.
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
