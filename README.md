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
- Multiple model providers, including cloud APIs, compatible endpoints, and local models such as Ollama.
- File browser, side-by-side previews, voice features, artifacts, and export workflows.
- Profiles for separating teams, clients, roles, or practice areas.
- Scheduled tasks and reminders through cron.
- Optional messaging integrations and MCP-connected tools.
- Local desktop backend bound to the user's machine by default.

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
2. Choose macOS or Windows.
3. Install and launch LexEdge AI.
4. Keep the setup window open while the local runtime is prepared.
5. Complete the legal-practice, provider/model, and skills onboarding.

The first launch may install Python, Git, Node.js, Python packages, Node modules, and browser helpers. This one-time process can take several minutes, especially on a fresh computer or corporate network. Later launches reuse the installed runtime.

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

For the desktop development build:

```bash
cd apps/desktop
npm run dev
```

See [INSTALL.md](INSTALL.md) for platform requirements, packaging, and verification.

## Privacy, security, and cost

The software is MIT licensed and has no LexEdge licence fee. Running it can still involve costs for hardware, hosting, model APIs, email/storage services, OCR, legal databases, or professional support. n8n Community Edition has its own licence terms; review them before commercial redistribution or embedding.

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
