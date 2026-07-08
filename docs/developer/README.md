# Developer Handbook

This handbook explains how to use this codebase as the base for future Hermes - Legal Agent by LexEdge AI enhancements, including Indian legal workflows, enterprise features, messaging, matters, AI providers, agents, and skills.

## What This App Is

Hermes - Legal Agent by LexEdge AI is a lawyer-focused desktop application built on Hermes Agent. The current product direction is:

- Local-first personal AI assistant for Indian legal work.
- Draft-only legal outputs with human review before filing, sending, or submission.
- Practice workspaces and matter folders so lawyers can work inside a clear file boundary.
- Lawyer-friendly messaging integrations such as Gmail and WhatsApp.
- Extensible skills and agents for document review, drafting, legal research, limitation checks, GST notices, and productivity tasks.

## Codebase Map

| Area | Main path | Purpose |
| --- | --- | --- |
| Desktop app | `apps/desktop` | Electron shell and React UI. |
| Desktop routes | `apps/desktop/src/app` | Chat, matters, artifacts, messaging, skills, settings, onboarding. |
| Desktop API client | `apps/desktop/src/hermes.ts` | Typed wrapper around backend REST APIs. |
| Backend API | `hermes_cli/web_server.py` | FastAPI dashboard backend used by the desktop app. |
| Agent runtime | `agent/`, `run_agent.py`, `cli.py` | Hermes agent execution, tools, sessions, and model calls. |
| Profiles | `hermes_cli/profiles.py`, `hermes_cli/legal_practice_profiles.py` | Isolated workspaces, SOUL prompts, role presets. |
| Skills | `skills/`, `optional-skills/` | Built-in and optional skill packs. |
| Matters | `hermes_cli/matters.py`, `apps/desktop/src/app/matters` | Lawyer matter workspaces and file indexing. |
| Messaging | `hermes_cli/web_server.py`, `apps/desktop/src/app/messaging` | Gmail, WhatsApp, and platform settings UI. |
| Draft artifacts | `hermes_cli/draft_artifacts.py`, `apps/desktop/src/app/artifacts` | Markdown export and generated document listing. |
| Tests | `tests/`, `apps/desktop/src/**/*.test.*` | Python and desktop unit tests. |

## Local Development

From the repository root:

```bash
npm install
npm --workspace apps/desktop run dev
```

Useful variants:

```bash
HERMES_HOME=/tmp/lexedge-dev npm --workspace apps/desktop run dev
HERMES_DESKTOP_HERMES_ROOT=<repo-root> npm --workspace apps/desktop run dev
npm --workspace apps/desktop run dev:fake-boot
```

Build and verify:

```bash
npm --workspace apps/desktop run build
npm --workspace apps/desktop run typecheck
npm --workspace apps/desktop run lint
npm --workspace apps/desktop run test:ui
```

## Key Rules for Future Development

- Keep lawyer-facing UI non-technical. Hide raw paths, runtime logs, Python files, and system artifacts unless the user explicitly opens developer/debug views.
- Treat all legal output as draft. UI copy should recommend advocate or human review before filing, sending, or relying on output.
- Preserve Hermes attribution in About, docs, and license files.
- Prefer profile-scoped state. Do not mix a lawyer's personal, firm, and client workspaces unless the user explicitly chooses to.
- Prefer local files and explicit matter folders over broad filesystem access.
- Use backend REST endpoints for persisted data. Do not make the React UI write arbitrary config files directly.
- Add new capabilities through a narrow backend API, typed frontend client function, UI screen/component, and tests.

## Recommended Feature Workflow

1. Write or update a short design note under `docs/developer/` or `docs/design/`.
2. Add backend data model or service code.
3. Add REST endpoint in `hermes_cli/web_server.py`.
4. Add TypeScript types in `apps/desktop/src/types/hermes.ts`.
5. Add API wrapper in `apps/desktop/src/hermes.ts`.
6. Add or update UI in `apps/desktop/src/app`.
7. Add focused tests.
8. Build the desktop app and test the installed app if the user needs it immediately.

## Related Docs

- [Architecture Overview](architecture.md)
- [Feature Extension Guide](feature-extension-guide.md)
- [UI Development Guide](ui-development.md)
- [AI, Agents, Skills, and Providers](ai-agents-skills-providers.md)
- [Data, Security, and Enterprise Readiness](data-security-enterprise.md)
- [Build, Release, and Installed App Runbook](build-release-runbook.md)
- [Desktop Installer Builds for macOS and Windows](desktop-installer-builds.md)
- [Roadmap for Future Enterprise Features](enterprise-roadmap.md)
