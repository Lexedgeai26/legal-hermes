# AI, Agents, Skills, and Providers

This guide explains how LexEdge uses Hermes AI capabilities and how developers can add more.

## Core Concepts

| Concept | Meaning |
| --- | --- |
| Provider | AI service such as Gemini, OpenAI-compatible endpoints, Anthropic, local models, or other Hermes-supported providers. |
| Model | Specific model used for chat or tool work. |
| Agent | Runtime process that receives instructions, uses tools, calls models, and produces responses. |
| Skill | Markdown instruction package that teaches the agent a domain workflow. |
| Toolset | Group of executable tools exposed to the agent. |
| MCP server | External tool server using Model Context Protocol. |
| SOUL.md | Profile-level persona and operating instructions. |
| Profile | Isolated workspace with its own config, sessions, skills, memory, and SOUL.md. |

## Providers and Models

Key files:

- Provider/model API client: `apps/desktop/src/hermes.ts`
- Provider UI: `apps/desktop/src/app/settings/providers-settings.tsx`
- Model UI: `apps/desktop/src/app/settings/model-settings.tsx`
- Backend endpoints: `/api/model/*`, `/api/providers/*`
- Provider inventory: `hermes_cli/inventory.py`
- Model switch logic: `hermes_cli/model_switch.py`
- Provider modules: `providers/`

How to add or improve a provider:

1. Confirm Hermes runtime supports the provider or add provider support in backend/provider modules.
2. Add provider discovery/inventory metadata if needed.
3. Add validation logic so users can test credentials.
4. Add a friendly settings UI.
5. Add recommended default model logic if this provider should appear in onboarding.
6. Hide advanced base URL and custom headers unless needed.

Provider UI principles:

- Put common providers at the top.
- Support all Hermes providers, but do not make rare providers prominent.
- Explain API keys in non-technical language.
- Never show complete saved keys.
- Provide a "Test connection" action.

## Agents

Hermes supports agent sessions, tool calls, subagents, and background work. LexEdge should expose these as lawyer-facing workflows, not raw agent internals.

Useful agent features for Indian lawyers:

- Drafting pleadings, notices, replies, opinions, and client updates.
- Reviewing PDFs, Word documents, agreements, notices, and orders.
- Building chronologies.
- Extracting parties, dates, deadlines, amounts, sections, and authorities.
- Preparing hearing briefs.
- Checking limitation windows.
- Running scheduled reminders.
- Using local folders as matter workspaces.

When adding new agent behavior:

- Prefer a skill first if behavior is mostly instructions.
- Prefer a backend service if behavior needs state, indexing, exports, or permissions.
- Prefer a tool/MCP if behavior needs external system access.
- Keep user approval for high-impact actions.

## Skills

Skill folders contain `SKILL.md` files. Current important locations:

- Core legal skills: `skills/legal-india/*/SKILL.md`
- Productivity skills: `skills/productivity/*/SKILL.md`
- Optional skills: `optional-skills/*`
- Profile role skills generated from `hermes_cli/legal_practice_profiles.py`

Common legal skill examples:

- `classify-matter`
- `extract-entities`
- `summarize-document`
- `document-draft`
- `draft-reply`
- `review-draft`
- `redline-review`
- `risk-analysis`
- `legal-research`
- `limitation-calc`
- `gst-notice-reply`
- `demand-notice-india`
- `limitation-diary`

How to add a new skill:

1. Create `skills/<category>/<skill-name>/SKILL.md`.
2. Include YAML front matter:

```md
---
name: my-skill-name
description: One sentence that clearly says when this skill should be used.
version: 1.0.0
metadata:
  hermes:
    tags: [legal, india]
    category: legal-india
---
```

3. Write procedure, inputs, outputs, and guardrails.
4. Keep legal disclaimers short but clear.
5. Add examples only if they improve agent behavior.
6. Test from the Skills UI and chat.

Skill writing rules:

- Make the trigger description specific.
- Use deterministic steps.
- State what not to do.
- Require `[CONFIRM: ...]` markers for missing facts.
- Require "Draft for advocate review" for legal documents.
- Avoid promising court outcomes.

## SOUL.md and Practice Profiles

SOUL.md is the profile-level instruction layer. It should describe the assistant persona, role, guardrails, and default working style.

Practice roles are defined in:

- `hermes_cli/legal_practice_profiles.py`

Each role can add:

- Label and description.
- Role-specific skills.
- SOUL focus.

Add roles when the workflow is meaningfully different:

- Individual advocate.
- Litigation lawyer.
- Law firm.
- In-house counsel.
- Legal consultant.
- Future: Tax practice, arbitration practice, corporate secretarial practice, IP practice.

Do not create a role for every small preference. Use settings or matter metadata instead.

## Toolsets and MCP

Toolsets and MCP servers add actual capabilities beyond prompting.

Relevant paths:

- Toolset config UI: `apps/desktop/src/app/settings/toolset-config-panel.tsx`
- Toolset APIs: `/api/tools/toolsets/*`
- MCP UI and APIs: `apps/desktop/src/app/settings/mcp-settings.tsx`, `/api/mcp/*`
- Tool definitions: `tools/`, `toolsets.py`

Use a tool or MCP when LexEdge must:

- Read or write an external system.
- Search a database.
- Perform OCR.
- Convert documents.
- Query case-law or statute sources.
- Access DMS, CRM, billing, e-court, GST, or MCA systems.

Enterprise rule:

- Any tool that sends, files, deletes, modifies official records, or contacts clients must have explicit approval, audit logging, and role permission checks.

## Adding More AI Features

Use this decision tree:

1. Is it only better instructions? Add or update a skill.
2. Does it require persistent app state? Add backend service and API.
3. Does it require new UI workflow? Add screen/panel and typed API client.
4. Does it call external systems? Add toolset/MCP with credentials and permissions.
5. Does it run on a schedule? Add cron job type and delivery target handling.
6. Is it firm-wide? Add policy, audit, permissions, and admin settings.

Example future AI features:

- Matter chronology builder.
- Indian legal citation checker.
- Draft comparison/redline reviewer.
- Filing checklist generator.
- Cause-list monitor.
- GST notice reply assistant.
- Contract risk playbook for in-house teams.
- Firm knowledge-base search.
- Case-law memo builder.

