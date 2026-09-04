# Using LexEdge Legal Hermes with n8n

n8n is an optional workflow-automation layer. LexEdge works without it. Connect n8n when a firm wants repeatable multi-step operations—such as intake, document routing, deadline records, or draft notifications—behind the agent's conversational interface.

- LexEdge agent overview: [lexedge.ai/agent](https://lexedge.ai/agent/)
- LexEdge n8n capability catalog: [lexedge.ai/n8n-capabilities](https://lexedge.ai/n8n-capabilities/)
- Sanitized workflow starter ZIP: [hermes-n8n-workflow-starter.zip](https://lexedge.ai/wp-content/uploads/2026/08/hermes-n8n-workflow-starter.zip)
- Official n8n hosting documentation: [docs.n8n.io/hosting](https://docs.n8n.io/hosting/)

## The two n8n integrations

LexEdge supports two related but distinct MCP connections.

### Legal workflow gateway

The legal workflow package uses n8n's MCP Trigger and workflow-tool nodes to expose selected workflows as MCP tools. Hermes connects to the authenticated n8n MCP endpoint, discovers those tools, and can select one from a lawyer's plain-language request.

This is the connection used for requests such as:

```text
Run a conflict check for this prospective matter and return the basis for every possible match. Do not clear the conflict automatically.
```

### n8n administration bridge

The repository also contains [`optional-mcps/n8n/manifest.yaml`](../optional-mcps/n8n/manifest.yaml), which installs a local stdio bridge to the n8n API. This bridge helps Hermes inspect the n8n instance itself.

The default enabled tools are read-mostly:

- health;
- list, find, and inspect workflows;
- list and inspect executions;
- report recent failures;
- export workflow definitions.

Activation, deactivation, container logs, and other mutating capabilities are not part of the default selection. Enable them only for an administrator profile with an appropriate approval policy.

## Recommended architecture

```text
Lawyer
  ↓ plain-language request
LexEdge Legal Hermes
  ↓ authenticated MCP request
Self-hosted n8n
  ↓ least-privilege connectors and approval gates
Firm systems / approved external services
  ↓ structured result
Lawyer review and decision
```

Run both LexEdge and n8n on firm-controlled infrastructure when practical. Bind internal services to private interfaces, use TLS for network connections, require authentication, and do not expose an MCP endpoint directly to the public internet.

## Prerequisites

- A working LexEdge Legal Hermes installation.
- A reachable n8n instance. Self-hosted n8n is recommended for controlled pilots.
- An n8n owner/admin who can import workflows and create credentials.
- Firm-approved accounts for only the connectors required by the selected workflow.
- A test workspace with non-client or synthetic data.
- A documented reviewer and approval rule for every external side effect.

n8n Community Edition can be self-hosted, but it remains subject to n8n's licence. Hosting, administration, model APIs, email/storage systems, OCR, research sources, and data providers may have separate costs.

## Step 1: install and secure n8n

Follow the [official n8n hosting guide](https://docs.n8n.io/hosting/). For a production or firm pilot:

1. Use a supported database and persistent storage.
2. Put n8n behind TLS and authenticated access.
3. Restrict inbound access by network and identity.
4. Configure encrypted backups and retention.
5. Set a stable encryption key and protect it separately from backups.
6. Review execution-data retention so client content is not kept longer than required.
7. Apply updates through a tested change process.

`http://127.0.0.1:5678` is suitable only when n8n and LexEdge run for the same user on the same machine. Do not substitute `localhost` when LexEdge and n8n are in different containers or hosts without configuring the correct private address.

## Step 2: download and import the workflow package

1. Download the [sanitized starter ZIP](https://lexedge.ai/wp-content/uploads/2026/08/hermes-n8n-workflow-starter.zip).
2. Extract it into a temporary review folder.
3. Inspect every JSON definition before import. Workflow files are executable configuration.
4. In n8n, open **Workflows**, choose **Import from File**, and import only the workflows needed for the pilot.
5. Import the legal business workflows before the MCP gateway workflows that reference them.
6. Keep workflows inactive until credentials, resource IDs, recipients, and approval paths have been reviewed.

Never publish an n8n export taken from a live instance without sanitising it. Exports can contain credential record IDs, email addresses, folder and spreadsheet IDs, webhook paths, database details, test data, and hardcoded authorization headers even when the underlying OAuth secret is stored separately.

## Step 3: replace every placeholder and credential

Open each node and replace the example configuration with firm-controlled values:

- Gmail, Google Drive, Sheets, Docs, and Calendar credentials;
- model-provider credentials;
- OCR, judgment, legislation, and case-data APIs;
- Postgres credentials and required tables;
- Slack or other notification channels;
- folder, spreadsheet, calendar, and database identifiers;
- lawyer, compliance, finance, and partner recipients;
- webhook and MCP bearer authentication;
- jurisdiction, limitation, escalation, and review rules.

Use a separate n8n credential per service and environment. Grant the smallest scopes possible. Do not put raw API keys in ordinary Set or Code nodes; use n8n credentials or protected environment variables.

## Step 4: expose approved workflows through MCP

The starter package includes gateway workflows that group the legal tools. Configure the n8n MCP Trigger with bearer authentication and activate only the gateway needed for the pilot. Copy the production MCP URL from n8n rather than reusing an editor/test URL.

Add that endpoint to `~/.hermes/config.yaml` on macOS/Linux, or `%LOCALAPPDATA%\hermes\config.yaml` on Windows:

```yaml
mcp_servers:
  lexedge_n8n_legal:
    url: "https://n8n.example.internal/mcp/<gateway-path>"
    headers:
      Authorization: "Bearer ${N8N_LEGAL_MCP_TOKEN}"
```

Store the token in the Hermes `.env` file rather than directly in YAML:

```text
N8N_LEGAL_MCP_TOKEN=replace-with-a-long-random-token
```

The exact endpoint path depends on the imported n8n MCP Trigger and deployment. Verify it in n8n after activation. Restart LexEdge or start a new session so Hermes reloads MCP tools.

## Step 5: optionally install the administration bridge

From a terminal with Hermes installed:

```bash
hermes mcp install n8n
```

The installer asks for:

```text
N8N_BASE_URL
N8N_API_KEY
```

Generate an API key in n8n under **Settings → API** and follow the [official API authentication guidance](https://docs.n8n.io/api/authentication/). Use a dedicated administrative profile and limit the selected tools to what that profile needs. Start a new Hermes session after installation.

This administration bridge does not replace the legal MCP gateway. The bridge inspects/manages n8n; the gateway exposes legal workflows for execution.

## Step 6: test before activation

For every workflow, test:

1. normal input;
2. missing required fields;
3. an unreadable or unsupported document;
4. an unavailable connector;
5. duplicate or repeated execution;
6. low-confidence classification;
7. incorrect recipient or destination protection;
8. reviewer rejection;
9. audit record and retention behaviour;
10. safe retry without duplicate emails, calendar events, or register entries.

Start with manual or on-demand execution. Enable email triggers, schedules, and webhooks only after the same workflow passes a controlled review.

## Workflow catalog

The current public capability catalog describes 16 implemented workflows plus one pilot.

| Area | Workflow | What it does | Required review |
| --- | --- | --- | --- |
| Intake | Client Intake | Creates a matter identifier, folder, register row, and draft welcome communication. | Confirm identity, conflict status, scope, and recipient. |
| Intake | Conflict Check | Compares prospective/adverse parties with the configured registry and preserves possible-match reasoning. | A qualified reviewer must clear or reject the matter. |
| Intake | Client Email Processing | Classifies approved inbox messages, matches matters, flags urgency, and queues unmatched mail. | Review routing, urgency, and any outgoing response. |
| Documents | Legal Document Router | Extracts and classifies inbound files and routes them to configured analysis paths. | Confirm document type, confidence, and destination. |
| Research | Legal Research | Searches configured judgment, legislation, and past-matter sources and prepares a report. | Validate every authority, proposition, and current status. |
| Tax | GST Notice Analysis | OCRs and classifies notices, extracts apparent demands/dates, and drafts a response outline. | Verify notice text, provision, service date, amount, and deadline. |
| Contracts | Contract Triage | Assigns a contract class, priority, risk lane, and handling route. | Apply the firm's current playbook. |
| Contracts | Redline Comparison | Compares versions and reports deviations against configured clause positions. | Confirm source versions and legal significance. |
| Contracts | Obligation Register | Extracts obligations, owners, triggers, dates, and renewals into a register. | Verify the executed agreement and every obligation. |
| Drafting | Document Drafting | Combines approved templates and matter facts into a reviewable draft. | Lawyer approval before use or circulation. |
| Drafting | Legal Notice Draft | Extracts notice facts and prepares a controlled first draft. | Confirm instructions, facts, law, tone, and recipient. |
| Litigation | Hearing Preparation | Organises matter documents and authorities into a timeline, checklist, and hearing brief. | Counsel verifies record completeness and current authorities. |
| Litigation | Case Status & Cause List Monitor | Checks configured case-data providers and alerts on detected changes. | Confirm against the official court source; do not scrape restricted systems. |
| Deadlines | Limitation & Deadline Calculator | Applies versioned firm rules and court holidays to create reviewable deadline records and reminders. | Counsel independently verifies every deadline. No model should perform date arithmetic. |
| Diligence | Due Diligence Sweep | Reviews a configured data room, applies red-flag rules, and records unreadable/skipped material. | Confirm scope, exceptions, and materiality. |
| Finance | Invoice Automation | Extracts invoice data, checks duplicates/totals, updates a register, and flags exceptions. | Finance approval before posting or payment. |
| Finance (pilot) | Time Capture & Billing Narrative | Groups calendar, sent-mail, and document activity by matter and drafts billing narratives. | Draft-only queue; lawyer confirms matter, duration, description, and billability. |

## Safe operating rules for legal teams

- Keep conflict decisions, legal conclusions, limitation dates, filings, payments, and client communications under human control.
- Add an approval node before email, sharing, calendar writes, accounting updates, or changes to an official register.
- Do not let a language model invent dates, durations, authorities, or source-system identifiers.
- Prefer deterministic code and versioned tables for deadline arithmetic and policy rules.
- Return structured evidence showing inputs, source references, skipped material, confidence, and reviewer status.
- Separate development, test, and production n8n projects and credentials.
- Use synthetic data during development.
- Record who approved a change without logging unnecessary privileged content.

## Troubleshooting

### Hermes cannot see the legal tools

- Confirm the n8n MCP gateway workflow is active.
- Use the production MCP URL, not the test webhook URL.
- Confirm bearer authentication matches the Hermes environment variable.
- Check TLS trust and network routing from the LexEdge host.
- Start a new LexEdge session after changing MCP configuration.
- Review `~/.hermes/logs/desktop.log` or the Windows equivalent.

### The administration bridge cannot connect

- Confirm `N8N_BASE_URL` is reachable from the LexEdge host.
- Confirm the API key is current and belongs to the intended n8n environment.
- Check reverse-proxy path rewriting and TLS certificates.
- Re-run `hermes mcp configure n8n` to inspect the selected tool set.

### A workflow imports but does not run

- Open nodes showing credential or parameter warnings.
- Replace all example document, folder, sheet, calendar, and database IDs.
- Import referenced sub-workflows before the gateway.
- Confirm required community or LangChain nodes exist in the installed n8n version.
- Run once with synthetic data from the editor and inspect the execution trace.

## Independence and licensing

LexEdge AI is not affiliated with, endorsed by, sponsored by, or partnered with n8n or Nous Research. n8n, Nous Research, Hermes Agent, and related names and marks belong to their respective owners. Review the licences and terms of every component and connected service before production use.
