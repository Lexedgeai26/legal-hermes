---
name: draft-reply
description: Draft a professional reply/response to a legal notice (GST/income-tax/labour/IP/litigation), personalized from the practice profile, in the jurisdiction's citation style, as clean semantic HTML ready for the editor and PDF/Word export.
---

# Draft Reply

**Layer:** Action · **Step ref:** `draft_reply` · **Model tier:** `strong`
**Wired in:** `legal_platform/llm_steps.py` (`llm_draft_reply`) with deterministic
fallback `legal_platform/workflow_handlers.py` (`draft_reply`).

## Purpose

Produce a filing-ready first draft of the reply, using the matter, extracted
entities, and the **practice profile** (so the advocate block is filled, not left
as a placeholder). Output is semantic HTML that flows straight into the existing
draft editor and HTML/PDF/DOCX export.

## Inputs (from run context)

```json
{
  "classification": { "matter_type": "<key>" },
  "entities": { "entities": [ ... ] },
  "practice_profile": { "lawyer_name", "designation", "firm_name",
                        "jurisdictions", "citation_style", "drafting_style", "language" },
  "documents": [{ "extracted_text": "<the notice>" }]
}
```

## Output (strict JSON)

```json
{ "draft_title": "<string>", "body": "<semantic HTML>" }
```
The handler adds `citation_style`, `content_format: "html"`, `needs_approval: true`.
Persisted as an `artifacts` row; promotable to an editable/exportable document via
`POST /api/artifacts/{id}/editable`.

## System prompt

```
You are a {jurisdiction_name} legal drafting assistant. Draft a professional reply
to the '{matter_type}' notice below.

- Citation style: {citation_style}. Tone: {drafting_style}. Language: {language}.
- Sign the draft for: {lawyer_name}, {designation}, {firm_name}.
- Use the practice profile for the advocate block; do NOT leave the advocate
  name/designation as placeholders.
- Leave ONLY genuinely unknown facts (e.g. notice number, dates not in the source,
  client address) as [bracketed] blanks.
- Address every allegation/demand in the notice. Where the source supports it,
  cite the exact statutory section.
- Return the body as clean semantic HTML: <h1> for the cause title, <h2> for
  section headings, <p> for paragraphs, <ol>/<li> for numbered submissions.
  No markdown, no <html>/<body> wrapper.

Respond with ONLY this JSON:
{"draft_title": "<string>", "body": "<HTML string>"}
```

User message = practice profile JSON + the notice text + the extracted entities.

## Guardrails

- Never invent facts not in the source; unknowns stay as bracketed blanks.
- Citation style and language come from the practice profile (fallback: the
  jurisdiction pack default).
- This is a FIRST DRAFT and must pass the lawyer approval gate before any external
  use — `needs_approval: true` is non-negotiable.
- Deterministic fallback: a labelled `[DRAFT]` skeleton under the correct
  jurisdiction so the workflow still produces an artifact.
