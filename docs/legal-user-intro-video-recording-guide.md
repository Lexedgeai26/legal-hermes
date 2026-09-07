# Introductory Video Recording Guide for Legal Users

This document is a recording-ready guide for a first-time-user video about the current LexEdge Legal Hermes desktop agent. It covers the standard macOS and Windows installers, provider setup, legal-practice onboarding, everyday chat, legal skills, optional integrations, and Matter Workspaces.

> **Scope:** Record the current main-agent experience. Do not show or describe the unfinished Unified Online Installer, automatic hardware analysis, or managed Private AI model download flow.

## Video goal

By the end of the video, a legal professional with no technical background should understand how to:

1. request the free installer from the LexEdge website;
2. use the download link received by email;
3. install and launch the desktop application on macOS or Windows;
4. connect OpenAI, OpenRouter, or an existing local Ollama installation;
5. create a legal-practice profile and select legal skills;
6. start a normal chat;
7. create a Matter Workspace, connect its document folder, attach documents, and continue matter-specific conversations; and
8. use representative legal skills and optional n8n-connected workflows with lawyer review.

Recommended finished length: **12–15 minutes**. A shorter 7–9 minute version can omit the advanced profile fields and prompts 7–10.

## Mandatory notices for the video

Show these points on screen and state them in the narration:

- LexEdge prepares drafts, summaries, research packs, checklists, calculations, and operational records for lawyer review. It does not replace professional judgment.
- Verify facts, authorities, citations, limitation periods, court rules, calculations, recipients, and external actions.
- The desktop backend and Matter Workspace index run locally, but content sent to a cloud model or connected service is handled under that provider's terms.
- Use firm-approved providers and connectors for confidential or privileged material.
- n8n is optional. The agent and Matter Workspaces work without it.

Suggested opening caption:

> Legal AI Agent by LexEdge — lawyer-controlled drafting, research, document work, Matter Workspaces, and optional automation. Human review is always required.

## Prepare the recording environment

Use a clean test installation and synthetic information. Never record with a real client matter or production credential.

Prepare:

- a demo full name, email address, phone number, firm name, country, and city for the website form;
- access to the demo mailbox that receives the download email;
- the current macOS and Windows installers;
- a test OpenAI or OpenRouter key with a low usage limit, or a local Ollama model already installed and running;
- a synthetic practice profile, such as **Asha Rao**, **Rao Legal Chambers**, civil litigation, India, High Court;
- a local folder named `MAT-2026-001-Demo` containing only fictional documents;
- sample files such as `Client_Instructions.pdf`, `Agreement_v1.docx`, `Agreement_v2.docx`, `Order_2026-08-15.pdf`, and `Correspondence.pdf`; and
- a configured test n8n workflow only if the optional automation segment will be recorded.

Before recording:

1. Turn off desktop notifications and hide unrelated browser tabs.
2. Use a recording resolution of at least 1920 × 1080.
3. Increase browser and application zoom so labels are readable.
4. Keep the pointer movement slow and deliberate.
5. Confirm that no real client names, email messages, file paths, API keys, tokens, or account balances are visible.
6. Record the Windows and macOS installation sequences separately, then use the relevant branch in each published video.
7. Test every demonstration prompt once before the final recording.

## Provider setup: what the presenter must know

| Option | What the user needs | What to explain |
| --- | --- | --- |
| OpenAI | An OpenAI API key and available API billing/credits | The key is for the OpenAI API, not merely a ChatGPT website subscription. Model usage may be charged by OpenAI. |
| OpenRouter | An OpenRouter API key and available balance or eligible free model | One key can provide access to models from several AI providers. OpenRouter's model availability, pricing, and data policies apply. |
| Local Ollama | Ollama installed separately, at least one model downloaded and running, and a local endpoint | Local Ollama normally needs **no API key**. In LexEdge, use the local/custom endpoint, normally `http://127.0.0.1:11434`. Keep it bound to the local machine unless a firm administrator has secured a private network deployment. |

Never display a real key. The safest recording method is to stop capture, paste the key into the masked field, reconnect, and resume after the test succeeds. If the video must show the action, use a temporary key and revoke it immediately after recording.

## Storyboard and narration

### Scene 1 — Introduce the product (0:00–0:35)

**Show**

- Open [lexedge.ai/agent](https://lexedge.ai/agent/).
- Briefly point to legal skills, Matter Workspaces, privacy choices, and optional n8n automation.

**Say**

> LexEdge Legal Hermes is a desktop legal AI assistant for drafting, research, document work, and matter organisation. The agent remains under the lawyer's control: review every fact, authority, deadline, draft, and external action. In this video, we will request the installer, complete setup, create a practice profile, and work inside a fictional matter.

### Scene 2 — Request the download (0:35–1:20)

**Show**

1. Open [lexedge.ai/download-hermes](https://lexedge.ai/download-hermes/).
2. Complete the form with demo details:
   - full name;
   - email;
   - phone number;
   - firm or chambers name, if applicable;
   - country; and
   - city.
3. Select **Continue to download**.
4. Open the demo mailbox and locate the LexEdge download email.
5. Point out the appropriate Windows or macOS download link.

**Say**

> Enter your details so LexEdge can send the download link and setup guidance. Use an email address you can access. Open the email and choose the installer for your computer. The core software has no LexEdge licence fee, but a cloud model, hosting, storage, or another connected service may charge separately. Download only from the official LexEdge page or an official release linked from the LexEdge GitHub repository.

**Editing note:** Blur the email address and phone number if they are not dedicated demo details. Do not show mailbox messages unrelated to LexEdge.

### Scene 3A — Install on macOS (1:20–2:15)

Use this segment in the macOS version.

**Show**

1. Open the downloaded DMG or ZIP.
2. If it is a DMG, drag **LexEdge AI** into **Applications**. If it is a ZIP, extract it and move the app into **Applications**.
3. Launch **LexEdge AI** from Applications.
4. Confirm the expected signed publisher if macOS displays a security prompt.
5. Keep the first-launch setup window open.

**Say**

> On macOS, move LexEdge AI into Applications and launch it from there. Confirm that macOS shows the expected publisher. Do not bypass a warning for an unexpected or unsigned download; verify the file with LexEdge support first.

### Scene 3B — Install on Windows (1:20–2:15)

Use this segment in the Windows version.

**Show**

1. Run the downloaded Windows x64 installer.
2. Confirm the expected publisher.
3. Complete the installation.
4. Launch **LexEdge AI** from the Start Menu or desktop shortcut.
5. Keep the first-launch setup window open.

**Say**

> On Windows 10 or 11, run the installer and confirm the expected publisher. LexEdge runs natively, so WSL is not required. Keep the setup window open while the local agent runtime is prepared.

### Scene 4 — Explain first-launch installation (2:15–2:55)

**Show**

- The first-launch progress screen.
- Progress through prerequisites, source installation, Python, Node dependencies, configuration, and local gateway startup.
- Speed up long sections in the edit rather than cutting directly from zero to completion.

**Say**

> The first launch prepares the local agent runtime. It may install user-scoped Python, Git, Node.js packages, and browser helpers. The Node dependency stage is often the longest and may take several minutes on a fresh computer or restricted network. This is normally a one-time process; later launches reuse the installed runtime.

**Success checkpoint:** The legal onboarding wizard appears without an installation error.

### Scene 5 — Choose the practice workspace (2:55–3:30)

**Show**

1. Choose the closest practice role: individual advocate, litigation lawyer, law firm, in-house counsel, or legal consultant.
2. Give the workspace a simple lowercase name if requested, for example `rao-litigation`.
3. Continue.

**Say**

> Start by choosing the practice role closest to your work. LexEdge uses this choice to prepare sensible legal defaults and keep the profile's matters, skills, settings, and conversations together.

### Scene 6 — Connect an AI provider (3:30–4:45)

Record one primary path and show the other options briefly.

#### OpenAI path

1. Select **OpenAI**.
2. Paste the API key while the capture is paused or the field is securely masked.
3. Connect and let LexEdge test the model.

Narration:

> Choose OpenAI if your firm has approved the OpenAI API. Paste an API key from the OpenAI developer platform. API usage and data handling follow the OpenAI account and plan selected by your firm.

#### OpenRouter path

1. Select **OpenRouter**.
2. Paste the OpenRouter API key securely.
3. Connect and let LexEdge select or test a supported model.

Narration:

> Choose OpenRouter if you want one provider account that can route to models from several AI labs. Costs, retention settings, and model availability depend on your OpenRouter configuration.

#### Existing local Ollama path

1. Confirm separately that Ollama is installed and a model is running.
2. Choose **Local / custom endpoint** from provider setup or model settings.
3. Enter `http://127.0.0.1:11434` unless the approved local configuration uses another address.
4. Leave the optional key blank for an ordinary local Ollama installation.
5. Connect and confirm that LexEdge discovers a model.

Narration:

> For a local model, install Ollama and download a suitable model before this step. A normal local Ollama connection does not require an API key. LexEdge connects to the local endpoint and discovers the running model. Local inference offers the strongest data-locality option, but the computer must have enough memory and the selected model must be capable of the task.

**Success checkpoint:** The provider test succeeds and the selected model is displayed.

### Scene 7 — Complete the legal-practice profile (4:45–6:00)

**Show**

1. Enter the lawyer or firm name.
2. Enter the lawyer's full name and practice email.
3. Add the primary country, state or province, court type, legal system, and time zone.
4. Explain that **Essentials** applies recommended defaults.
5. Briefly open **Advanced** to show optional fields such as:
   - title and professional roles;
   - bar registration and experience;
   - additional jurisdictions and courts;
   - practice areas, client types, and work types;
   - languages and citation styles;
   - preferred document types; and
   - drafting, writing, and risk preferences.
6. Select the relevant legal skill groups and optional capability groups.
7. Review the terms and professional-use notice, then finish onboarding.

**Say**

> The practice profile gives the agent useful defaults about who you are, where you practise, and the type of legal work you handle. Complete only the information you want stored in this local profile. Essentials is enough to get started; Advanced settings allow more precise jurisdictions, practice areas, document preferences, and drafting style. Select the skill groups relevant to your work, then review the professional-use terms before continuing.

**Success checkpoint:** The main chat workspace opens and the provider setup does not appear a second time.

### Scene 8 — First safe chat (6:00–6:35)

**Show**

1. Start a new chat.
2. Paste the following prompt:

```text
Introduce yourself as my legal work assistant. Based on my practice profile, list five tasks you can help me prepare. Do not send, file, sign, or communicate anything externally.
```

3. Point out the streamed response and any visible tool or skill activity.

**Say**

> You can now work in plain language. Start with a low-risk request and state important boundaries directly. The agent may choose a suitable legal skill or tool, but the lawyer remains responsible for reviewing the output.

### Scene 9 — Create a Matter Workspace (6:35–8:15)

**Show**

1. Open **Matters** in the sidebar.
2. Select **Create matter**.
3. Enter a fictional matter and client name.
4. Choose the matter type and the lawyer's role.
5. Add the court or authority, status, and internal notes where relevant.
6. Choose the local `MAT-2026-001-Demo` folder.
7. Create the matter and show the indexed-document list.
8. Explain that **Re-index** refreshes the list after documents change.
9. Select **Open in chat**.
10. Use the attachment control or drag and drop to attach one fictional document to the matter chat.
11. Ask a short question about the attached document and show that the response remains in the matter conversation.

**Say**

> A Matter Workspace connects a case or client matter to an existing folder on this computer. LexEdge stores matter metadata and a lightweight file index; the source documents remain in the folder you selected. Opening the matter in chat starts a conversation with the matter's structured context, which keeps questions and outputs anchored to this case. You can also attach or drag a document into the matter chat for the current request. Add documents to the matter folder and re-index when they should remain part of the workspace's indexed file list. Removing the Matter Workspace record does not delete the source folder.

**Success checkpoint:** The new chat clearly identifies the selected matter and its indexed files.

### Scene 10 — Demonstrate legal work (8:15–13:30)

Use the ten prompts in the next section. For a concise video, show prompts 1–6 in full and use a quick montage for 7–10.

### Scene 11 — Close with privacy and review (13:30–14:30)

**Show**

- Provider settings.
- The active Matter Workspace.
- Any approval prompt before an external action.
- Links to documentation and support.

**Say**

> LexEdge's desktop backend and Matter Workspace index run locally. If you choose OpenAI, OpenRouter, email, storage, OCR, research, n8n connectors, or another external service, selected data is sent to that provider under its terms. Use only firm-approved services and least-privilege credentials. Keep every filing, communication, deadline, payment, and legal conclusion under human review. For setup help, use the official LexEdge documentation and GitHub repository.

Suggested final caption:

> Download: lexedge.ai/download-hermes<br>
> Guide: github.com/Lexedgeai26/legal-hermes<br>
> Always verify legal work before use.

## Ten copy-and-paste demonstration prompts

Use only fictional documents and facts. Before each prompt, say which feature is being demonstrated and what the lawyer must verify.

### 1. Matter document overview

**Feature:** Matter Workspace context, document summarisation, and missing-information detection.

```text
Review the documents indexed in this demo matter. Give me a one-page matter overview with the parties, relief sought, important dates, current procedural position, and the next five questions for the client. Separate document-supported facts from assumptions or missing information. Cite the source filename for each material fact.
```

### 2. Intake triage and entity extraction

**Feature:** Intake triage, parties, identifiers, dates, and conflict-check preparation.

```text
From Client_Instructions.pdf, extract the client, adverse parties, related entities, addresses, case or contract identifiers, dates, amounts, and requested outcome. Return a structured intake table and a separate list of names that should be checked for conflicts. Do not decide that the conflict is cleared.
```

### 3. Evidence-based chronology

**Feature:** Chronology building across matter documents.

```text
Build a chronology for this matter in date order. For every event, include the date, event, people involved, source document and page if available, legal significance, and confidence. Put undated or contradictory events in a separate section and do not invent missing dates.
```

### 4. Legal research pack

**Feature:** Jurisdiction-aware legal research and source control.

```text
Prepare a research plan for the legal issue described in this matter for the jurisdiction in my practice profile. Then produce a research pack with the issue, governing provisions, leading authorities, contrary authorities, and unresolved questions. Give links or precise citations for every authority, state the date the research was checked, and clearly flag anything you could not verify.
```

### 5. Citation verification

**Feature:** Citation checking and hallucination control.

```text
Check every legal citation in the draft note in this matter. For each citation, report whether the authority exists, whether the quoted proposition is supported, the court and date, and whether later treatment needs checking. Do not silently correct the draft and do not present an unverified citation as valid.
```

### 6. First draft for lawyer review

**Feature:** Legal drafting using matter facts and controlled assumptions.

```text
Using only verified facts from this matter, prepare a first draft reply to the opposing party's notice. Use a professional and measured tone. Insert [LAWYER TO CONFIRM] wherever an instruction, fact, date, authority, remedy, or strategic choice is missing. Do not send the draft or represent it as final advice.
```

### 7. Contract redline and risk review

**Feature:** Version comparison, clause analysis, and risk table.

```text
Compare Agreement_v1.docx with Agreement_v2.docx clause by clause. Produce a table showing the changed text, commercial effect, legal risk, suggested fallback language, and who should approve the change. Distinguish additions, deletions, and drafting-only changes. Do not assume either version was executed.
```

### 8. Limitation and deadline review

**Feature:** Limitation analysis and diary preparation with mandatory verification.

```text
Identify every possible limitation, hearing, response, renewal, or compliance date mentioned in this matter. Show the source document, triggering event, candidate rule, inputs used, calculation steps, uncertainties, and a proposed reminder schedule. Mark every result as requiring independent lawyer verification before it is entered in a calendar.
```

### 9. Hearing preparation and document output

**Feature:** Hearing brief, document organisation, and artifact/document generation.

```text
Prepare a hearing brief for advocate review using the indexed matter documents. Include the case snapshot, relief, procedural history, chronology, disputed facts, evidence map, authorities to verify, likely questions, missing documents, and a final pre-hearing checklist. Create it as an editable document, but do not file, email, or share it.
```

### 10. Optional n8n-connected workflow

**Feature:** MCP/n8n integration, structured workflow execution, and approval gates.

Use this only when a sanitized test n8n environment is already connected.

```text
Using the approved n8n workflow for this demo matter, prepare a draft matter-status update and a proposed follow-up task list from the latest documents. Show the workflow inputs, proposed recipients, evidence used, and every external action before execution. Do not send email, create calendar events, or update a production register without my explicit approval.
```

If n8n is not connected, replace the execution with this prompt:

```text
Explain which optional n8n workflow could automate this matter-status update, what systems it would access, what data would leave this computer, and which lawyer approvals should be required. Do not execute anything.
```

## Feature coverage map

Use this as the presenter's checklist when the brief requires a tour of the full agent rather than only the ten prompt demonstrations.

| Feature | Where it appears in the main video | Recording guidance |
| --- | --- | --- |
| Streaming chat | Scene 8 and all prompts | Show the answer arriving and explain that tool or skill activity may appear during a task. |
| Legal-practice profile | Scenes 5 and 7 | Show practice role, jurisdiction, practice-area preferences, and separate profile/workspace context. |
| Legal skills | Scene 7 and prompts 2–9 | Show the skill-group selector; explain that the agent chooses relevant enabled skills from ordinary language. |
| File and image attachments | Scene 9 | Attach a synthetic PDF by picker or drag and drop. Never use a client document. |
| File browser and previews | Scene 9 | Open an indexed demo document or preview when available. |
| Matter Workspaces | Scene 9 and prompts 1–10 | Show matter metadata, connected folder, index, re-index, and matter-specific chat. |
| Document and office-file tools | Prompts 1, 7, and 9 | Use PDF/DOCX examples; briefly mention spreadsheet, presentation, text, and image support. Scans may need OCR. |
| Artifacts and editable outputs | Prompt 9 | Open the generated hearing brief or artifact and show that it is a draft for review. |
| Profiles | Scenes 5 and 7 | Explain that separate profiles can keep settings, skills, sessions, and practice context apart. Do not claim profiles replace ethical walls or access controls. |
| Scheduled tasks and reminders | Prompt 8 | Show only in a test profile. Confirm every date independently before creating a reminder. |
| Voice features | Optional montage | Show only if microphone access and the selected build support it; do not record confidential dictation. |
| Messaging integrations | Optional montage | Demonstrate draft-only behavior in a test account. Never send to a real recipient during the video. |
| MCP-connected tools | Prompt 10 | Explain that MCP lets the agent discover approved tools; availability depends on administrator configuration. |
| n8n workflow automation | Prompt 10 | Label it optional and show the workflow inputs, proposed effects, and lawyer approval boundary. |

If an optional feature is not configured in the release being recorded, omit its click-through and say that it is available only after administrator setup. Do not simulate a successful connector or external action.

## What to point out during the feature demonstrations

- The user speaks in normal legal-work language; no special command syntax is required.
- Skills provide repeatable legal instructions and guardrails. Tools and integrations provide access to files or approved services.
- A Matter Workspace keeps a matter's metadata, indexed file context, and chat entry point together.
- File indexing is bounded and does not prove that the record is complete. Scanned material may require OCR.
- Outputs should distinguish source-supported facts, assumptions, missing material, and items requiring confirmation.
- External side effects must remain visible and approval-controlled.
- n8n adds optional multi-step automation; it is not required for chat, skills, documents, or Matter Workspaces.

## Editing guidance

- Add a chapter title at each major stage: Download, Install, Connect a Model, Practice Profile, Matter Workspace, Legal Skills, Automation, and Review.
- Show passwords and API keys only as masked fields. Remove clipboard notifications that may reveal a token.
- Use callouts for **Lawyer review required**, **Synthetic demo data**, and **Optional integration**.
- Speed up dependency installation to 4×–8× while keeping the stage name visible.
- Avoid jump cuts that make a successful connection look automatic. Show the success indicator after each important test.
- Add subtitles and manually check legal names, product names, and URLs.
- Use **OpenRouter** and **Ollama** in captions, not “Open Router” or “Olama.”

## Final quality-assurance checklist

### Installation and onboarding

- [ ] The video starts from the official LexEdge website.
- [ ] The form-to-email download journey is visible.
- [ ] The published version shows the correct macOS or Windows path.
- [ ] The expected publisher warning is explained without teaching users to bypass security.
- [ ] The one-time first-launch process is described accurately.
- [ ] No Unified Online Installer or managed Private AI flow is shown.
- [ ] OpenAI and OpenRouter are described as API-key services.
- [ ] Local Ollama is described as a separately installed local endpoint that normally has no API key.
- [ ] Provider/model connection visibly succeeds.
- [ ] Practice, jurisdiction, and legal skills onboarding is shown.

### Matters and features

- [ ] The Matter Workspace uses synthetic data only.
- [ ] The video shows matter creation, local folder selection, indexing, **Open in chat**, and a document attachment.
- [ ] At least six representative prompts are demonstrated.
- [ ] Research, drafting, deadlines, citations, and document outputs are described as drafts requiring verification.
- [ ] The n8n segment is labelled optional and uses a test environment.
- [ ] No external email, calendar event, filing, payment, or register update occurs without visible approval.

### Privacy and publication

- [ ] No client data, personal mailbox content, local username, production URL, credential, or token is visible.
- [ ] Any temporary recording credentials have been revoked.
- [ ] Cloud-provider data handling is not described as local or completely private.
- [ ] The professional-use notice appears in the opening or closing frame.
- [ ] Captions, links, audio levels, and screen readability have been checked on desktop and mobile.

## Official links for the video description

- Product overview: [https://lexedge.ai/agent/](https://lexedge.ai/agent/)
- Desktop download: [https://lexedge.ai/download-hermes/](https://lexedge.ai/download-hermes/)
- Source and documentation: [https://github.com/Lexedgeai26/legal-hermes](https://github.com/Lexedgeai26/legal-hermes)
- Matter Workspace guide: [matter-workspaces.md](matter-workspaces.md)
- Desktop installation guide: [desktop-installation.md](desktop-installation.md)
- Optional n8n guide: [n8n-guide.md](n8n-guide.md)
