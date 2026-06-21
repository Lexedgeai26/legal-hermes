# LexEdge WhatsApp Legal Messaging Guide

This guide defines how WhatsApp should work for LexEdge Personal AI Assistant in a lawyer-friendly, low-configuration setup.

The product goal is simple: an Indian lawyer should be able to connect WhatsApp by scanning one QR code, test it with a normal message, and use it for intake, reminders, rough drafts, and client updates without learning technical gateway concepts.

## Positioning

WhatsApp is a communication and intake channel. It is not the primary drafting editor.

Use WhatsApp for:

- Quick legal questions from phone.
- Matter intake notes.
- Document summaries.
- Deadline extraction.
- Draft client updates.
- Draft reply points.
- Checklists.
- Follow-up reminders.
- Approval loops.

Use the desktop app for:

- Long legal drafts.
- Final formatting.
- Word export.
- PDF export.
- Template-based drafting.
- Final review before filing, service, signature, or client delivery.

## Safety Defaults

LexEdge should keep these defaults on for legal work:

- Draft only.
- Human review required.
- No automatic filing.
- No automatic service.
- No automatic sending of client-facing messages.
- Mark legal outputs as draft or review-only.
- Ask before using any output externally.
- Keep confidential information subject to the configured AI provider and firm policy.

Suggested output footer:

```text
Draft for advocate review. Verify facts, law, limitation, citations, and forum rules before use.
```

## Simple Setup Flow

### Step 1: Open Messaging

The lawyer opens the LexEdge desktop app and goes to Messaging > WhatsApp.

The page should show two choices:

- Existing WhatsApp phone: recommended for individual advocates and small offices.
- WhatsApp Business Cloud API: advanced firm setup.

Default selection: Existing WhatsApp phone.

### Step 2: Scan QR Code

The app displays a QR code.

User instructions:

1. Open WhatsApp on the phone.
2. Go to Linked Devices.
3. Tap Link a device.
4. Scan the QR code.
5. Keep WhatsApp open until LexEdge shows connected.

If linking takes time, the UI should say:

```text
WhatsApp may take a minute to finish linking. Keep WhatsApp open on your phone and keep this app open.
```

### Step 3: Refresh QR

If the QR expires or WhatsApp says it cannot connect, the page should provide Refresh QR.

Refresh QR should:

- Cancel the old pending pairing attempt.
- Start a fresh pairing attempt.
- Show a new QR code.
- Keep the user on the same page.

### Step 4: Connected State

After successful linking, the page should show:

```text
WhatsApp is linked.
Send "hi" to LexEdge from WhatsApp to test the connection.
```

Buttons:

- Reconnect.
- Disconnect.
- Restart messaging, if required.

### Step 5: Home Channel

When LexEdge receives the first WhatsApp message, it may ask the user to set that chat as the home channel.

User-facing wording:

```text
Set this WhatsApp chat as your LexEdge AI home channel?

This lets LexEdge send reminders, limitation alerts, draft completion updates, and scheduled legal work summaries here.

Reply /sethome to enable it, or ignore this message to skip.
```

## First Test

After connection, the lawyer should test with:

```text
hi
```

Then:

```text
Summarise this notice and list urgent deadlines.
```

Then attach or forward a document only if the firm is comfortable sharing that information with the configured AI provider.

The expected response should:

- Confirm what LexEdge understood.
- Identify legal category when possible.
- List deadlines or missing details.
- Avoid pretending to file, serve, or send anything.
- Mark legal output as draft or review-only.

## Lawyer Prompt Examples

### Matter Intake

```text
Create a matter note from this WhatsApp conversation. Include parties, facts, documents received, missing documents, deadlines, and next action.
```

### Notice Summary

```text
Summarise this notice in 10 points. Extract section, forum, demand amount, reply due date, limitation risk, and recommended next action.
```

### GST Notice

```text
From this GST notice, identify notice type, demand heads, tax period, reply deadline, documents required, and possible limitation objections.
```

### Client Update

```text
Draft a simple client update: hearing adjourned, next date 12 July, documents still pending, and we will share the draft reply after review.
```

### Checklist

```text
Make a checklist for filing reply to this application. Separate documents, facts to verify, legal points, and drafting tasks.
```

### Legal Review

```text
Review this agreement under Indian law. List risk points, missing clauses, negotiation points, and questions for the client.
```

### Voice Note Cleanup

```text
Turn this voice note into a structured legal matter note with facts, issues, parties, documents, deadlines, and next steps.
```

## What Not To Do In WhatsApp

Avoid these expectations in the first stable release:

- Do not expect WhatsApp to be a full editor.
- Do not expect WhatsApp to export final Word or PDF files.
- Do not rely on WhatsApp for complex formatting.
- Do not send final pleadings or notices from WhatsApp without desktop review.
- Do not use AI output directly for filing, service, signing, or advice without advocate review.

## Recommended UI Copy

### Short Description

```text
Connect WhatsApp for quick legal intake, summaries, reminders, and draft replies with human approval.
```

### Connected State

```text
WhatsApp is linked. You can send short legal instructions, matter notes, and documents from your phone.
```

### Safety Note

```text
WhatsApp is for quick work and review loops. Use the desktop editor for final drafts, Word export, and PDF export.
```

### Privacy Note

```text
Only send confidential material if your firm has approved the configured AI provider and privacy settings.
```

## Support Checklist

If WhatsApp does not connect:

1. Refresh QR.
2. Keep WhatsApp open on the phone while linking.
3. Check internet on both phone and computer.
4. Disconnect and reconnect.
5. Restart messaging.
6. Restart LexEdge.

If WhatsApp connects but does not reply:

1. Confirm messaging gateway is running.
2. Confirm WhatsApp platform is enabled.
3. Send `hi`.
4. Reply `/sethome` if prompted.
5. Check that the selected AI provider is configured and working.

If replies are too broad or not legal enough:

1. Set the correct practice profile.
2. Update Legal Assistant settings.
3. Use more specific prompts.
4. Move final drafting to desktop editor.

## Product Decision

For stability, LexEdge should not promise mobile commands such as `/open`, `/export word`, or `/export pdf` until there is a reliable cross-channel draft store.

For now:

- WhatsApp returns reviewable text drafts.
- Desktop app handles editor and export.
- Documentation should clearly explain the boundary.
