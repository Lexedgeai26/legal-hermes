# LexEdge AI Lawyer Onboarding Wizard Implementation

This document defines the production implementation plan for a first-run setup wizard that makes LexEdge AI usable by an Indian lawyer without technical configuration.

The wizard must not expose Hermes internals such as gateway, MCP, SOUL, provider routing, env vars, cron engines, OAuth callbacks, ports, or bridge processes as the primary experience. Those details can exist under Advanced settings, but the first-run path must use plain lawyer-facing language.

## Product Goal

When an Indian lawyer installs LexEdge AI, the app should guide them through the minimum setup required to make the assistant work:

- Create a practice workspace.
- Configure assistant instructions from the selected legal workflow skill.
- Connect at least one AI model.
- Verify the model can respond.
- Set safe legal defaults.
- Offer optional Gmail, WhatsApp, and document workflow setup.
- Finish with a working first legal task.

The user should never land in the main app with a blank assistant that cannot respond.

## Setup Principle

Separate setup into two categories:

### Mandatory

The app must block completion until these are done:

1. Practice workspace selected or created.
2. AI model configured.
3. Model connection tested successfully.
4. Legal safety defaults accepted.

### Optional

The app must allow skipping these:

1. Gmail connection.
2. WhatsApp connection.
3. Chamber or firm details.
4. Practice-area fine tuning.
5. Document templates.
6. Calendar/deadline reminders.
7. Advanced model routing.
8. Advanced tools, MCPs, and automation.

Optional steps should show `Skip for now`, and skipped items should appear later in a setup checklist.

## Target Users

- Solo advocates.
- Litigation lawyers.
- Small law firms.
- GST/tax practitioners.
- In-house legal teams.
- Legal consultants.
- Clerks or juniors setting up the app for a senior lawyer.

The wizard copy should assume the user understands legal work but not AI infrastructure.

## Naming Rules

Use lawyer-facing names in the wizard:

| Technical Term | Wizard Term |
| --- | --- |
| Profile | Practice workspace |
| SOUL.md | Assistant instructions |
| Skill | Legal workflow |
| Provider | AI service |
| API key | Access key |
| Gateway | Background service |
| Cron | Reminder / scheduled work |
| MCP | Advanced connection |
| Environment variable | Saved key |

Only show technical names in Advanced sections.

## First-Run Entry Conditions

Show the wizard when any of these are true:

- No completed onboarding marker exists.
- No usable model/API key is configured.
- The active profile has no practice role.
- The active profile has missing or empty `SOUL.md`.
- The backend detects model test failure during startup.

Store completion state in a durable onboarding file, for example:

```yaml
onboarding:
  completed: true
  completed_at: "2026-06-21T10:00:00+05:30"
  version: 1
  mandatory:
    practice_workspace: true
    ai_model: true
    model_test: true
    legal_safety: true
  optional:
    gmail: skipped
    whatsapp: skipped
    firm_details: skipped
```

The wizard should resume from the last incomplete mandatory step.

## Wizard Structure

Use a left-side step rail and one focused question per page.

Recommended layout:

- Left rail: setup progress.
- Main panel: current step.
- Bottom bar: Back, Skip for now, Continue.
- Right side or inline note: concise help text.

Do not use large marketing hero screens after the first welcome screen. This is a setup workflow, not a landing page.

## Step 1: Welcome

Purpose: set expectations and explain what will be configured.

User-facing copy:

```text
Set up LexEdge AI for your legal practice

This takes about 5 minutes. We will create your practice workspace, connect an AI model, and apply safe legal defaults.

LexEdge prepares drafts and analysis for lawyer review. It does not file, serve, send, or take legal action without approval.
```

Actions:

- `Start setup`
- `Restore existing setup` if config is detected.

No skip button on this step.

## Step 2: Practice Workspace

Mandatory.

Question:

```text
What kind of legal work should this workspace support?
```

Options:

- Individual Advocate
- Litigation Lawyer
- Law Firm
- In-house Counsel
- Legal Consultant

Each option should show:

- Plain description.
- Example tasks.
- Installed legal workflows.

Implementation:

- Create profile/practice workspace.
- Apply `practice_role`.
- Install role-specific skill.
- Generate `SOUL.md` from the selected role skill file.
- Save `profile.yaml` metadata.

Important: `SOUL.md` must be derived from the selected skill file. The skill file is the source of truth.

Default recommendation: `Litigation Lawyer`, unless the user chooses otherwise.

## Step 3: Workspace Name

Mandatory but can auto-fill.

Question:

```text
Name this practice workspace
```

Examples:

- `chamber`
- `gst-practice`
- `litigation`
- `firm-intake`

Rules:

- Default to a safe generated name based on role.
- Show validation in plain English.
- Do not mention filesystem paths unless Advanced is expanded.

If the name exists, offer:

- Use existing workspace.
- Create another name.

## Step 4: Assistant Instructions Preview

Mandatory review, optional editing.

Purpose: show what the assistant will be optimized for.

Label:

```text
Assistant instructions
```

Copy:

```text
These instructions are created from the legal workflow selected for this workspace. You can edit them now or later from Practice Workspace settings.
```

Implementation:

- Call backend template endpoint for selected role.
- Show generated content in an editable text area.
- Save final content to `SOUL.md`.

Required behavior:

- If user edits, keep their edited text.
- If user changes role, ask whether to replace edited instructions with the new role template.
- If user cloned an existing workspace, show both:
  - Existing cloned instructions.
  - Suggested role instructions.

Recommended default: use role-generated instructions.

## Step 5: AI Model Setup

Mandatory.

Replace provider jargon with:

```text
Choose your AI service
```

Options:

1. Gemini
   - Recommended for easy Indian setup.
   - Good for drafting, summarising, PDF/document work.
2. OpenAI
   - Good general drafting and reasoning.
3. Anthropic
   - Good long document review and careful reasoning.
4. Existing/custom model
   - For advanced users or firm IT teams.

Each card should show:

- Recommended use.
- Setup difficulty.
- Cost note.
- Data note.
- `Connect` button.

Mandatory requirement:

- At least one AI service must be connected and pass a test.

## Step 6: AI Access Key Guide

Mandatory if the selected AI service is not already configured.

Use non-technical copy:

```text
LexEdge needs an access key from your AI service so it can prepare drafts and answer questions.

The key is saved on this computer. You can remove it anytime.
```

Provider-specific guide pages must include:

- `Open account page`
- `Create key`
- `Copy key`
- `Paste key`
- `Test connection`

### Gemini Guide

Recommended copy:

```text
Gemini setup

1. Open Google AI Studio.
2. Sign in with your Google account.
3. Click Create API key.
4. Copy the key.
5. Paste it here and click Test.
```

Buttons:

- `Open Google AI Studio`
- `I already have a key`
- `Test key`

Validation:

- Empty key blocked.
- Invalid key shows plain error:

```text
This key did not work. Please check that it was copied fully and try again.
```

### OpenAI Guide

Copy:

```text
OpenAI setup

1. Open OpenAI platform.
2. Sign in.
3. Create a new API key.
4. Copy the key once.
5. Paste it here and click Test.
```

### Anthropic Guide

Copy:

```text
Anthropic setup

1. Open Anthropic Console.
2. Sign in.
3. Create an API key.
4. Copy the key.
5. Paste it here and click Test.
```

### Existing Key

Allow users to paste keys without leaving the app.

Advanced users may choose:

- Custom base URL.
- Model name.
- Organization/project ID.

Hide these by default.

## Step 7: Model Test

Mandatory.

The wizard must run a real test prompt:

```text
Reply in one sentence: LexEdge AI is ready for Indian legal drafting.
```

Success criteria:

- Provider call succeeds.
- Response is non-empty.
- Model selected in config.
- Active profile can use it.

Failure should not show raw stack traces.

Recommended failure messages:

```text
The AI service did not respond.
```

Show likely fixes:

- Check key was copied fully.
- Check billing/credits.
- Try another AI service.
- Use a different model.

Do not allow finishing onboarding until one model test passes.

## Step 8: Legal Safety Defaults

Mandatory.

Use confirmation rather than complex settings.

Copy:

```text
Legal safety defaults

LexEdge will prepare drafts and analysis for review. These defaults protect client work and prevent accidental sending or filing.
```

Default all options ON:

- Draft only.
- Ask before sending any email or WhatsApp message.
- Never file, serve, upload, or submit to a portal.
- Mark assumptions and missing facts.
- Keep client-facing messages concise.
- Do not invent case law or citations.
- Keep confidential strategy out of client drafts unless approved.

Button:

```text
Accept safe defaults
```

Do not allow finishing without accepting safe defaults.

Advanced link:

```text
Review detailed safety settings
```

## Step 9: Lawyer/Firm Details

Optional.

Question:

```text
Add details for drafts and letterheads
```

Fields:

- Lawyer name.
- Designation.
- Chamber/firm name.
- City.
- State.
- Bar enrollment number.
- Default court/forum.
- Default language.

These should feed:

- Draft headers.
- Client updates.
- Notices.
- Pleadings.
- Export templates.

Skip allowed.

## Step 10: Practice Area Fine Tuning

Optional.

Question:

```text
Which areas should LexEdge prioritize?
```

Options:

- Civil litigation.
- Criminal litigation.
- GST and tax.
- Section 138 NI Act.
- IBC.
- SARFAESI.
- Arbitration.
- Contracts.
- Employment.
- Family law.
- Property.
- Consumer disputes.
- General documentation.

Effects:

- Enable/prioritize relevant skills.
- Adjust suggested prompts.
- Adjust sample tasks.
- Adjust templates/checklists.

Skip allowed.

## Step 11: Gmail Setup

Optional.

Copy:

```text
Connect Gmail to draft email replies and organise legal correspondence.

LexEdge will not send emails automatically. It prepares drafts for your approval.
```

Actions:

- `Connect Gmail`
- `Skip for now`

Required UI states:

- Not connected.
- Connecting.
- Connected.
- Failed.
- Disconnect.
- Reconnect.

Plain scope summary:

```text
LexEdge can read selected emails and prepare draft replies. Sending remains approval-only.
```

If skipped, show later in checklist:

```text
Gmail not connected. Connect later to draft replies from email.
```

## Step 12: WhatsApp Setup

Optional.

Copy:

```text
Connect WhatsApp to send instructions, documents, and quick questions from your phone.

For most lawyers, use your existing WhatsApp phone and scan the QR code once.
```

Options:

1. Existing WhatsApp phone.
2. WhatsApp Business Cloud API.

Default: Existing WhatsApp phone.

Existing phone flow:

- Start local bridge.
- Show QR code.
- Refresh QR.
- Show connected phone number if available.
- Show last message received.
- Show disconnect/reconnect.

If QR fails:

```text
The QR code expired. Click Refresh QR and scan again.
```

If login takes time:

```text
Keep WhatsApp open on your phone until the connection finishes.
```

Skip allowed.

## Step 13: First Legal Task

Mandatory final action, but no external service required.

Purpose: make sure the user sees value immediately.

Offer sample starts:

- Review a PDF or legal document.
- Draft a client update.
- Prepare hearing brief.
- Summarise a notice/order.
- Ask a legal research question.

If no document is uploaded, use a built-in sample prompt:

```text
Create a checklist for preparing a reply to an Indian legal notice.
```

Completion:

- Open main chat.
- Pre-fill selected first task.
- Show setup checklist in sidebar with skipped optional steps.

## Required Backend Capabilities

### Onboarding Status API

Add:

```http
GET /api/onboarding/status
POST /api/onboarding/start
POST /api/onboarding/step
POST /api/onboarding/complete
```

Status response:

```json
{
  "required_complete": false,
  "current_step": "ai-model",
  "mandatory": {
    "practice_workspace": true,
    "ai_model": false,
    "model_test": false,
    "legal_safety": false
  },
  "optional": {
    "gmail": "skipped",
    "whatsapp": "not_started",
    "firm_details": "not_started"
  }
}
```

### Practice Workspace API

Existing profile APIs should support:

- Create practice workspace.
- Clone existing workspace.
- Apply practice role.
- Generate SOUL from skill file.
- Return SOUL template for role.

Required endpoint:

```http
GET /api/profiles/practice-roles/{role}/soul-template
```

### Model Setup API

Add or standardize:

```http
GET /api/onboarding/model-options
POST /api/onboarding/model-key
POST /api/onboarding/model-test
```

`model-test` should run against the selected profile, not only the default profile.

### Safety Defaults API

Add:

```http
GET /api/onboarding/legal-safety
POST /api/onboarding/legal-safety
```

Persist in profile config.

### Optional Channel APIs

Use existing Gmail/WhatsApp APIs, but expose wizard-friendly wrappers if current endpoints require technical payloads.

Required wizard behavior:

- Can poll status.
- Can reconnect.
- Can disconnect.
- Can skip.
- Can resume later.

## Required Frontend Components

Create:

```text
apps/desktop/src/app/onboarding/
  onboarding-wizard.tsx
  onboarding-store.ts
  steps/
    welcome-step.tsx
    practice-workspace-step.tsx
    workspace-name-step.tsx
    assistant-instructions-step.tsx
    ai-service-step.tsx
    access-key-step.tsx
    model-test-step.tsx
    legal-safety-step.tsx
    firm-details-step.tsx
    practice-areas-step.tsx
    gmail-step.tsx
    whatsapp-step.tsx
    first-task-step.tsx
```

Use existing UI primitives:

- Dialog/sheet only for secondary help.
- Cards for selectable options.
- Step rail for progress.
- ActionStatus for save/test states.
- Toasts only for secondary status; primary errors stay inline.

## UX Requirements

### Mandatory Step Behavior

Mandatory incomplete step:

- `Continue` disabled until valid.
- Inline reason shown.
- No `Skip for now`.

Optional incomplete step:

- `Continue` enabled only if configured.
- `Skip for now` available.
- Skipped item recorded.

### Error Handling

Never show raw errors as first-line UX.

Bad:

```text
ModuleNotFoundError: No module named ...
```

Good:

```text
LexEdge could not start the background service. Click Repair install.
```

For API keys:

```text
This key did not work. Check that it was copied fully, then try again.
```

For WhatsApp:

```text
WhatsApp did not finish linking. Refresh the QR code and scan again.
```

For Gmail:

```text
Google sign-in did not complete. Please try Connect Gmail again.
```

### Copy Tone

Use:

- “draft”
- “review”
- “client update”
- “notice”
- “hearing”
- “matter”
- “approval”

Avoid:

- “provider”
- “gateway”
- “daemon”
- “env var”
- “MCP”
- “callback”
- “token” unless under Advanced.

## Persistence Model

Store onboarding status per installation, with profile-specific completion records.

Recommended files:

```text
~/.hermes/onboarding.yaml
~/.hermes/profiles/<profile>/profile.yaml
~/.hermes/profiles/<profile>/SOUL.md
~/.hermes/profiles/<profile>/config.yaml
```

`profile.yaml` should include:

```yaml
practice_role: litigation-lawyer
practice_role_label: Litigation Lawyer
onboarding:
  created_by_wizard: true
  completed_at: "..."
  skipped:
    gmail: true
    whatsapp: true
```

## Re-entry After Skipping Optional Steps

The main app should show a small setup checklist until optional setup is complete or dismissed.

Checklist examples:

- Connect Gmail.
- Connect WhatsApp.
- Add chamber details.
- Choose practice areas.
- Import templates.

This checklist should not block normal app use after mandatory setup is done.

## Security Requirements

- Store access keys in the existing profile-scoped secrets mechanism.
- Never log full keys.
- Redact keys in UI after save.
- Offer remove/reconnect for every connected service.
- Keep keys profile-scoped unless user explicitly chooses shared setup.
- Do not auto-send emails or WhatsApp messages after connecting.

## Analytics / Diagnostics

Track local, privacy-safe events:

- Wizard started.
- Step completed.
- Optional step skipped.
- Model test failed reason category.
- Wizard completed.

Do not track:

- API keys.
- Email addresses unless explicitly needed for local status.
- Phone numbers in analytics.
- Document contents.
- Legal questions.

## Implementation Phases

### Phase 1: Mandatory Working Setup

Deliver:

- Wizard shell.
- Practice workspace creation.
- Role-based SOUL from skill.
- AI service/key setup.
- Model test.
- Legal safety confirmation.
- First task screen.

Exit criterion:

New install cannot finish onboarding unless the assistant can answer.

### Phase 2: Optional Channels

Deliver:

- Gmail OAuth wizard step.
- WhatsApp QR wizard step.
- Skip/resume states.
- Connection status cards.

Exit criterion:

Lawyer can connect Gmail/WhatsApp without external technical configuration.

### Phase 3: Practice Personalisation

Deliver:

- Lawyer/chamber details.
- Practice areas.
- Default document language.
- Draft/export preferences.

Exit criterion:

Drafts use lawyer details and selected legal context.

### Phase 4: Firm Setup

Deliver:

- Multi-user law firm workspace.
- Role permissions.
- Shared templates.
- Approval routing.
- Admin settings.

Exit criterion:

Small law firm can onboard team members without editing config files.

## Acceptance Criteria

For a fresh install:

1. User sees setup wizard before main app.
2. User must create or select a practice workspace.
3. User must configure and test at least one AI model.
4. User must accept legal safety defaults.
5. User may skip Gmail, WhatsApp, firm details, and practice-area fine tuning.
6. Created workspace has role metadata.
7. Created workspace has `SOUL.md` generated from selected role skill.
8. Main chat can send a test message and receive a response.
9. Skipped optional steps appear in a non-blocking checklist.
10. No setup step requires reading technical documentation.

## Suggested First Implementation

Build the first version with these screens only:

1. Welcome.
2. Practice workspace.
3. Workspace name.
4. Assistant instructions.
5. Choose AI service.
6. Paste/test access key.
7. Accept legal safety defaults.
8. First task.

Defer Gmail, WhatsApp, firm details, and practice areas to optional checklist cards shown after onboarding.

This gives the safest MVP: every lawyer who completes setup has a working assistant, while optional integrations can be configured later without blocking use.
