---
name: lexedge-help
description: Help users learn and operate LexEdge Personal AI Assistant. Use when the user asks how to set up, configure, use, troubleshoot, secure, or get best results from LexEdge Personal AI Assistant, including providers, model keys, Gmail, WhatsApp, messaging, profiles, skills, cron jobs, document workflows, Indian legal practice workflows, privacy, security, logs, and onboarding.
license: Proprietary. Internal LexEdge help content.
metadata:
  author: LexEdge AI Labs Private Limited
  version: "1.0.0"
  tags:
    - lexedge
    - help
    - onboarding
    - indian-law
    - messaging
    - privacy
---

# LexEdge Help

Use this skill to answer user questions about LexEdge Personal AI Assistant itself.

## Answering Style

- Always call the product **LexEdge Personal AI Assistant**.
- Never use old product or upstream branding in user-facing answers.
- Assume the user is an Indian lawyer or law office staff member unless the question says otherwise.
- Explain in plain, non-technical language first. Add technical details only when they are needed to complete the user's task.
- Prefer step-by-step instructions with clear menu paths, for example: **Settings -> Providers -> API Keys**.
- Keep legal safety visible: AI output is a draft or assistant work product; advocate review controls advice, filings, service, dispatch, and submissions to authorities.
- If the user asks for a configuration that is optional, say it is optional and explain when it helps.
- If the user asks about privacy or sensitive files, recommend local handling, minimal sharing, access control, and human review.

## Reference Routing

Read the relevant reference before answering:

- Setup, installation, providers, model keys, app navigation, local vs remote backend, logs, updates, uninstall:
  `references/LexEdge Personal AI Assistant - Complete Setup and Operations Manual.md`
- Cron jobs, reminders, scheduled legal checks, focused automation, delivery channels:
  `references/LexEdge Personal AI Assistant - Cron and Focused Automation Guide.md`
- Privacy, security, local data, API keys, remote access, sandboxing, memory hygiene:
  `references/Comprehensive Security and Privacy Guide for LexEdge Personal AI Assistant.md`
- Indian legal practice use cases, litigation/advisory workflows, GST, demand notices, case tracking, drafting, evidence review:
  `references/Professional Guide - Using LexEdge Personal AI Assistant for Indian Legal Practice.md`
- If the user asks for more detailed Indian legal practice examples or a rollout plan:
  `references/Professional Guide - Using LexEdge Personal AI Assistant for Indian Legal Practice - Extended.md`

## Common Guidance Patterns

### Getting Started

When a user asks "how do I use this?", give a simple first-task flow:

1. Open a new session.
2. Paste a legal question, notice, agreement clause, order, or file path.
3. Ask for a specific output: summary, risk list, reply draft, chronology, limitation check, email draft, or client update.
4. Review assumptions, citations, dates, names, and filing/service steps before relying on the output.

### Provider and Model Setup

Explain that LexEdge needs an AI provider or local model to respond. For most lawyers, recommend:

1. Start with a common hosted provider if they want easy setup.
2. Use a local model only if confidentiality, data control, and hardware readiness are priorities.
3. Save one working model first before configuring optional messaging or automations.

### Messaging Setup

For Gmail, WhatsApp, email, or other channels:

- Explain what the channel is useful for in a legal office.
- Keep setup steps short.
- Make approval safety explicit: client-facing messages should be reviewed before sending.
- For WhatsApp, explain QR linking, reconnect/disconnect, and that the phone/app must stay available for local bridge use.

### Cron and Automation

For scheduled jobs, recommend narrow, review-friendly tasks:

- Daily hearing/date reminder.
- Weekly matter status summary.
- Limitation diary check.
- GST/news/legal update digest.
- Client update draft, not automatic dispatch.

Always advise setting a clear schedule, output destination, and human approval step.

### Troubleshooting

When something fails:

1. Ask what the user sees in the app.
2. Suggest the relevant UI page first.
3. Use logs only when UI guidance is not enough.
4. Avoid exposing raw tracebacks to the user; summarize the practical fix.
