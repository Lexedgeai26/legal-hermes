# Feature Extension Guide

This guide explains how to extend each major LexEdge feature safely.

## Standard Extension Pattern

Use this pattern for most product features:

1. Define the user workflow in plain lawyer-facing language.
2. Add or update backend domain logic in `hermes_cli/`.
3. Add REST endpoints in `hermes_cli/web_server.py`.
4. Add TypeScript types in `apps/desktop/src/types/hermes.ts`.
5. Add API functions in `apps/desktop/src/hermes.ts`.
6. Add UI in `apps/desktop/src/app/<feature>`.
7. Add tests close to the changed code.
8. Update docs.

Do not put persistence logic directly in React components.

## Matters

Current purpose:

- Let a lawyer create a named workspace for a client/matter.
- Store matter metadata in `HERMES_HOME/matters/matters.json`.
- Index supported files from a user-selected folder.
- Keep matter files in the original folder; LexEdge stores metadata only.

Key files:

- Backend: `hermes_cli/matters.py`
- API: `/api/matters/*` in `hermes_cli/web_server.py`
- Types: `MatterRecord`, `MatterFile` in `apps/desktop/src/types/hermes.ts`
- UI: `apps/desktop/src/app/matters/index.tsx`
- Chat prompt: `apps/desktop/src/lib/matter-prompt.ts`

How to extend:

- Add new metadata fields to `MatterRecord` in Python and TypeScript.
- Update create/update forms in the Matters UI.
- Keep indexing bounded with max file count and max depth.
- Add a migration strategy if changing stored JSON shape.
- Use generated document filters to show lawyer-facing outputs first.

Future enhancements:

- Matter tags and stages.
- Limitation dates and hearing dates.
- Party/contact directory.
- Folder watch service to auto-refresh generated documents.
- Matter notes and chronology.
- Team permissions for firm profiles.
- Matter-level audit trail.

## Artifacts and Generated Documents

Current purpose:

- Show useful files, links, and images from chats and matters.
- Hide technical artifacts such as Python scripts, XML internals, caches, and skills.
- Let lawyers open or download generated documents without reading raw file paths.

Key files:

- UI: `apps/desktop/src/app/artifacts/index.tsx`
- Markdown cards: `apps/desktop/src/components/assistant-ui/markdown-text.tsx`
- Export API: `/api/draft-artifacts/export`
- Export backend: `hermes_cli/draft_artifacts.py`

How to extend:

- Add new supported output extensions in both frontend detection and matter indexing.
- Prefer document cards with actions over raw path text.
- Add preview support by file type:
  - `.md` and `.html`: render in preview pane.
  - `.pdf`: open native preview or external app.
  - `.docx`: open external editor or convert to HTML/PDF for preview.
- Add metadata such as matter, created time, authoring session, and draft status.

Future enhancements:

- Dedicated "Generated Documents" tab.
- Preview drawer with export buttons.
- Export as Word, PDF, HTML, and plain text.
- Document version history.
- Advocate review status: Draft, Reviewed, Final, Filed.

## Messaging

Current purpose:

- Configure lawyer-friendly communication channels.
- Support common channels first: WhatsApp, Gmail/email.
- Keep less common channels available but not prominent.
- Use approval-only behavior for legal replies unless explicitly changed.

Key files:

- UI: `apps/desktop/src/app/messaging/index.tsx`
- API client: messaging functions in `apps/desktop/src/hermes.ts`
- Backend APIs: `/api/messaging/*` in `hermes_cli/web_server.py`
- Gmail OAuth: `hermes_cli/gmail_oauth.py`

How to extend:

- Add a platform declaration in backend platform listing.
- Add a typed config shape in TypeScript.
- Add a simple setup card in UI.
- Keep advanced credentials behind an "Advanced" or "More" section.
- Provide test and disconnect actions.
- Log technical failures; show user-safe explanations in UI and channel replies.

Future enhancements:

- Per-profile email filters.
- Matter-based routing from email/WhatsApp to active matters.
- Client allow-lists and blocked contacts.
- Draft approval queue.
- Message templates for client updates.
- Firm-level shared inbox with role-based access.

## Profiles and Practice Roles

Current purpose:

- Give each practice/workspace separate config, skills, SOUL.md, memory, sessions, and cron jobs.
- Provide practice role presets for individual advocate, litigation lawyer, law firm, in-house counsel, and legal consultant.

Key files:

- Profile engine: `hermes_cli/profiles.py`
- Practice presets: `hermes_cli/legal_practice_profiles.py`
- API: `/api/profiles/*`
- UI: `apps/desktop/src/app/profiles`
- Onboarding wizard: `apps/desktop/src/app/onboarding/lawyer-onboarding-wizard.tsx`

How to extend:

- Add a new practice role to `PRACTICE_ROLES`.
- Add role-specific skills to `ROLE_SKILLS`.
- Make sure the SOUL focus is lawyer-facing and review-gated.
- Add UI copy to the onboarding wizard.
- Add tests for role template creation if adding complex behavior.

Future enhancements:

- Firm admin profile templates.
- Department profiles.
- Junior/senior role permissions.
- Matter type based skill bundles.
- Import/export practice profile packages.

## Onboarding

Current purpose:

- Make first-run setup understandable for non-technical Indian lawyers.
- Force mandatory setup needed for a working AI chat.
- Let optional channels, templates, and advanced settings be skipped.

Key files:

- UI: `apps/desktop/src/app/onboarding/lawyer-onboarding-wizard.tsx`
- Store: `apps/desktop/src/store/onboarding.ts`
- API: `/api/onboarding/*`
- Provider settings: `apps/desktop/src/app/settings/providers-settings.tsx`

How to extend:

- Keep steps short and task-oriented.
- Do not expose raw config names unless necessary.
- Each mandatory step must explain why it is required.
- Optional steps must have Skip.
- Add recovery states for failed auth or provider validation.

Future enhancements:

- Firm onboarding path.
- Import existing matters from a folder.
- Guided WhatsApp QR setup.
- Gmail filter selection by practice profile.
- Model recommendation based on budget and document size.

## Cron and Automation

Current purpose:

- Run scheduled jobs such as limitation reminders or daily legal updates.
- Desktop backend starts a cron ticker when running inside desktop.

Key files:

- UI: `apps/desktop/src/app/cron`
- Backend APIs: `/api/cron/*`
- Scheduler modules: `cron/`
- Existing doc: `docs/chronos-managed-cron-contract.md`

How to extend:

- Keep legal automation review-gated.
- Use clear next-run and last-run status.
- Route outputs to a selected home channel or matter.
- Avoid destructive or filing actions without explicit human confirmation.

Future enhancements:

- Matter deadline calendar.
- Hearing date reminders.
- Daily cause-list checks.
- GST/Income Tax update monitors.
- Firm admin dashboard for scheduled jobs.

## Settings and Providers

Current purpose:

- Configure models, providers, credentials, tools, memory, gateway, and app settings.

Key files:

- UI: `apps/desktop/src/app/settings`
- API client: provider/model functions in `apps/desktop/src/hermes.ts`
- Backend: `/api/model/*`, `/api/providers/*`, `/api/config`, `/api/env`
- Provider inventory: `hermes_cli/inventory.py`, `hermes_cli/model_switch.py`, `providers/`

How to extend:

- Prefer provider-agnostic UI where possible.
- Keep common providers visible first.
- Put custom providers and advanced base URLs behind advanced UI.
- Never display full API keys after saving.

Future enhancements:

- Firm-managed provider policy.
- Cost caps by profile.
- Model routing rules by task.
- Admin-managed credential pools.

