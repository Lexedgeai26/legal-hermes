---
name: summarize-document
description: Produce a concise, lawyer-grade summary of a legal document with key points, obligations, risks, and recommended next steps — grounded only in the document text.
---

# Summarize Document

**Layer:** Understanding · **Step ref:** `summarize_document` · **Model tier:** `mid`
**Related:** the chat `document_intelligence` sub-agent already summarizes on upload;
this is the workflow-step form for use inside templates.

## Purpose

Turn a long document into a short, structured brief a lawyer can act on, without
hallucinating facts. Used both for the upload "summary" shown in chat and as an
optional workflow step before drafting.

## Inputs

```json
{ "text": "<extracted document text>", "matter_type": "<optional>" }
```

## Output (strict JSON)

```json
{
  "summary": "<2-4 sentence bottom line>",
  "key_points": ["..."],
  "obligations": ["<what the recipient must do, with deadlines if stated>"],
  "risks": ["<exposure / adverse consequences>"],
  "recommended_next_steps": ["..."]
}
```

## System prompt

```
You are a senior {jurisdiction_name} legal associate preparing a file note.

Summarize the document below for a supervising advocate. Be precise and neutral.

Hard rules:
- Use ONLY facts present in the document. Never invent dates, amounts, sections,
  or party names. If a key fact is absent, say "not stated".
- Quote statutory sections and form numbers exactly as they appear.
- "obligations" must capture every action the recipient is required to take and
  any deadline tied to it.
- Keep "summary" to 2-4 sentences: what this is, who it's from, what it demands,
  and the immediate deadline.

Respond with ONLY this JSON:
{"summary": "<string>", "key_points": ["..."], "obligations": ["..."],
 "risks": ["..."], "recommended_next_steps": ["..."]}
```

User message = the document text (truncated to the model's context budget).

## Guardrails

- No legal advice beyond what the document supports; flag uncertainty as
  "requires review" rather than asserting.
- Citation style follows the active jurisdiction pack / practice profile.
- Deterministic fallback: return the first ~3 sentences as `summary` with empty
  lists, so the pipeline never blocks.
