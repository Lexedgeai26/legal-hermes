# LexEdge Legal Hermes

[![GitHub](https://img.shields.io/badge/GitHub-Lexedgeai26%2Flegal--hermes-181717?logo=github)](https://github.com/Lexedgeai26/legal-hermes)
[![Download](https://img.shields.io/badge/Download-macOS%20%7C%20Windows-087EA4)](https://lexedge.ai/download-hermes/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

LexEdge Legal Hermes is a free, open-source, legal-focused personal AI agent for advocates, litigators, law firms, in-house teams, consultants, clinics, and law students. It combines the Hermes Agent runtime with lawyer onboarding, legal skills, local Matter Workspaces, document tools, profiles, scheduled work, messaging, and optional n8n automation.

- Product overview: [lexedge.ai/agent](https://lexedge.ai/agent/)
- Source code and issues: [github.com/Lexedgeai26/legal-hermes](https://github.com/Lexedgeai26/legal-hermes)
- Desktop download: [lexedge.ai/download-hermes](https://lexedge.ai/download-hermes/)
- n8n capability library: [lexedge.ai/n8n-capabilities](https://lexedge.ai/n8n-capabilities/)

> **Professional-use notice:** LexEdge prepares drafts, summaries, research packs, checklists, calculations, and operational records for human review. It is not a lawyer and does not replace independent professional judgment. Verify facts, authorities, citations, limitation periods, court rules, calculations, recipients, and every external action before use.

## What is included

### Legal-first onboarding

The desktop setup asks about the user's practice rather than exposing infrastructure terminology. It supports individual advocates, litigation lawyers, law firms, in-house counsel, legal consultants, clinics, and law students. Each profile can have its own model, skills, sessions, memory, configuration, and operating instructions.

### Full personal-agent workspace

- Streaming chat with tool activity and structured results.
- Multiple model providers, including cloud APIs, compatible endpoints, and local models.
- Private AI: a local legal model installed and managed by the setup app itself, with no separate download or terminal step.
- File browser, side-by-side previews, voice features, artifacts, and export workflows.
- Profiles for separating teams, clients, roles, or practice areas.
- Scheduled tasks and reminders through cron.
- Optional messaging integrations and MCP-connected tools.
- Local desktop backend bound to the user's machine by default.

### Private AI: a legal model that runs on the computer

Private AI runs a legal language model **on the lawyer's own machine**. Matter
documents and prompts are not sent to LexEdge or to any model provider, and the
agent keeps working without an internet connection.

It is set up by the same installer as everything else. There is **no separate
Ollama install, no terminal, and no configuration file** — the runtime and the
models are provisioned for the user, verified by checksum before use, and kept
separate from any Ollama the user may already run.

**The installer measures the computer before it recommends anything.** Setup
inspects CPU, memory, graphics memory, and free disk space, then shows only the
models this machine can actually run, with the reasons each one fits. Models
that will not run are listed separately with the specific reason — not enough
memory, not enough disk — rather than being silently hidden. The download size
is stated before anything is downloaded.

Only models from a **signed LexEdge catalogue** are offered — a fixed, tested
set that LexEdge controls, rather than whatever a machine happens to have
installed. A model is checked for two independent requirements before
it is proposed: a context window large enough for real legal documents, and
support for the tool calls every chat turn depends on.

**Private AI needs a capable machine.** 16 GB of RAM is the practical minimum
and 32 GB is comfortable; 8 GB is not enough and setup will not offer a model
for it. Memory and disk are checked automatically. Processor speed is not yet
measured, so an older machine with sufficient RAM can pass the check and still
answer slowly — a cloud provider will be faster there. Full figures are in the
[installation guide](docs/desktop-installation.md).

**Private AI is optional, and declining costs nothing.** Setup offers a clear
choice between Private AI and a cloud provider, explains what each means
including its trade-offs, and treats the cloud route as a first-class outcome
rather than a fallback. On a machine that cannot run a local model, the cloud
route gives a complete, working install. The choice can be changed later in
Settings.

If an Ollama installation is already present, setup detects it, reports which of
its models meet the requirements, and installs its own runtime on a separate
port without modifying or removing the existing one.

### Matter Workspaces

Matter Workspaces connect a client matter to an existing local folder. LexEdge stores lightweight profile-local metadata and an index; source documents remain in the folder selected by the lawyer.

Supported matter types include general, GST/indirect tax, civil litigation, criminal litigation, contracts, corporate/MCA, income tax, labour/employment, intellectual property, and arbitration. Users can record the client, court or authority, acting role, status, and internal notes.

The current index supports common legal-office formats including PDF, DOC/DOCX, XLS/XLSX, PPT/PPTX, RTF, text, Markdown, CSV, and common image files. A lawyer can re-index a matter, inspect its documents, open generated drafts, or start a new chat with the matter context preloaded. Removing a Matter Workspace does **not** delete its source folder.

See [Matter Workspaces guide](docs/matter-workspaces.md).

### Legal skills

The current source tree includes 25 bundled skills, including 20 India-focused legal skills, plus a catalog of 100 optional skills. The lawyer onboarding screen groups skills by practice need.

India legal skills currently cover:

- intake triage, matter classification, and entity extraction;
- document summarisation, chronology building, and action suggestions;
- legal research and citation checking;
- drafting, reply drafting, opinion drafting, and draft review;
- redline and risk review;
- limitation calculation and diary support;
- compliance review, GST notice work, and Indian demand notices.

Additional legal groups cover litigation, commercial, corporate, employment, intellectual property, privacy, product, regulatory, AI governance, legal clinics, law students, and legal-workflow building. Skills provide repeatable instructions and guardrails; tools and MCP servers provide system access.

### n8n and MCP automation

n8n is optional. LexEdge works as a legal agent without it. When connected, n8n provides a visual, self-hostable orchestration layer for repeatable multi-step work, while Hermes discovers approved workflows as tools through Model Context Protocol (MCP).

The current library documents 16 implemented workflows and one pilot workflow across:

- client intake, conflict checks, and email triage;
- document routing, legal research, and GST notice analysis;
- contract triage, redline comparison, obligation tracking, drafting, and legal notices;
- hearing preparation, case-status monitoring, and limitation/deadline calculation;
- due diligence, invoice processing, and draft time-capture narratives.

LexEdge also includes an optional n8n administration MCP bridge. Its default tool set is read-mostly: health, workflow discovery, workflow inspection, execution inspection, recent failures, and export. Activation and deactivation tools must be enabled deliberately.

See [Using LexEdge with n8n](docs/n8n-guide.md) before importing or activating workflows.

## Install the desktop app

The simplest path for a lawyer or law-firm user is the desktop installer:

1. Open the [LexEdge download page](https://lexedge.ai/download-hermes/).
2. Choose the build for the computer — macOS (Apple Silicon or Intel) or Windows.
3. Install and launch LexEdge Hermes Agent Setup.
4. Choose **Private AI** or a **cloud provider** when asked. Choosing Private AI
   runs a short hardware check and then recommends the models this computer can
   run; nothing is downloaded until the choice is confirmed.
5. Keep the setup window open while the runtime is prepared.
6. Complete the legal-practice, provider/model, and skills onboarding.

One installer covers everything. There is no separate download for the local AI
runtime, no terminal step, and no configuration file to edit.

The first launch may install Python, Git, Node.js, Python packages, Node modules, and browser helpers. This one-time process can take several minutes, especially on a fresh computer or corporate network. Later launches reuse the installed runtime.

Choosing Private AI adds a model download of several gigabytes; the exact size
is shown before it starts. Choosing a cloud provider skips that entirely and
finishes in minutes.

The macOS installers are signed with a Developer ID certificate and notarized by
Apple, so they open normally without security warnings. On macOS the installed
app doubles as a launcher: once Hermes is installed, opening it starts the app
rather than showing setup again.

Detailed instructions:

- [Desktop installation for macOS and Windows](docs/desktop-installation.md)
- [Source installation and developer builds](INSTALL.md)

## Install from source

```bash
git clone https://github.com/Lexedgeai26/legal-hermes.git
cd legal-hermes
npm install
uv sync --extra all
uv run hermes
```

On Windows, native PowerShell is supported: run `scripts/install.ps1` (via
`iex (irm https://hermes-agent.nousresearch.com/install.ps1)` or a local
checkout) to provision Python, Git, and dependencies without WSL.

For the desktop development build:

```bash
cd apps/desktop
npm run dev
```

See [INSTALL.md](INSTALL.md) for platform requirements, packaging, and verification.

## Privacy, security, and cost

The software is MIT licensed and has no LexEdge licence fee. Running it can still involve costs for hardware, hosting, model APIs, email/storage services, OCR, legal databases, or professional support. n8n Community Edition has its own licence terms; review them before commercial redistribution or embedding.

With Private AI selected, matter documents and prompts are processed on the
lawyer's own machine and are not sent to LexEdge or to a model provider. Other
connectors are unaffected by that choice and still send whatever they are given.

LexEdge and n8n can run on infrastructure controlled by the user or firm. That does not make every configuration automatically private. Data sent to a cloud model, Gmail, Google Drive, OCR provider, research service, or another connector is processed under that provider's terms. Use least-privilege credentials, encrypted storage, authenticated gateways, restricted logs, backups, and approval gates for external actions.

Never commit `.env` files, API keys, OAuth tokens, client documents, matter exports, databases, or runtime logs. Report vulnerabilities using the process in [SECURITY.md](SECURITY.md).

## Documentation

| Guide | Audience |
| --- | --- |
| [Desktop installation](docs/desktop-installation.md) | macOS and Windows users |
| [Introductory video recording guide](docs/legal-user-intro-video-recording-guide.md) | presenters, trainers, and legal-user onboarding teams |
| [Matter Workspaces](docs/matter-workspaces.md) | lawyers and legal teams |
| [n8n integration](docs/n8n-guide.md) | firms using workflow automation |
| [Installation and builds](INSTALL.md) | developers and release engineers |
| [Lawyer onboarding](docs/lexedge-lawyer-onboarding-wizard.md) | product and implementation teams |
| [Security and privacy](docs/help-docs/Comprehensive%20Security%20and%20Privacy%20Guide%20for%20LexEdge%20Personal%20AI%20Assistant.md) | administrators and reviewers |
| [Developer handbook](docs/developer/README.md) | contributors |

## Contributing and support

- Open a bug or feature request in [GitHub Issues](https://github.com/Lexedgeai26/legal-hermes/issues).
- Review [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a pull request.
- Use [GitHub Security Advisories](https://github.com/Lexedgeai26/legal-hermes/security/advisories/new) for private vulnerability reports.

## Licence, upstream credit, and independence

This project is released under the [MIT License](LICENSE).

LexEdge Legal Hermes is an independent legal-industry customisation of the MIT-licensed [Nous Research Hermes Agent](https://github.com/NousResearch/hermes-agent). LexEdge AI is not affiliated with, endorsed by, sponsored by, or partnered with Nous Research, Hermes Agent, or n8n. Their names, marks, and logos belong to their respective owners. LexEdge's contribution is the legal customisation, packaging, onboarding, workflow library, and out-of-the-box legal user experience.
