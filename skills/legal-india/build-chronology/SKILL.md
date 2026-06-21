---
name: build-chronology
description: Extract dated events from one or more documents and assemble a clean, ordered timeline (chronology) with source anchors — essential for litigation, assessments, and limitation analysis.
---

# Build Chronology

**Layer:** Understanding · **Step ref:** `build_chronology` · **Model tier:** `mid`

## Purpose

Convert scattered references to dates and events into a single ordered timeline.
Critical for litigation matters, tax assessments, and computing limitation /
appeal windows. Each event carries a source anchor so it can be verified.

## Inputs

```json
{ "documents": [{ "id": "<version id>", "text": "<...>" }] }
```

## Output (strict JSON)

```json
{
  "events": [
    { "date": "<ISO date>", "date_text": "<as written>", "event": "<what happened>",
      "actor": "<who>", "source_doc_id": "<version id>", "significance": "<why it matters>" }
  ],
  "gaps": ["<missing or ambiguous dates worth confirming>"]
}
```
Events are returned sorted ascending by `date`.

## System prompt

```
You are a {jurisdiction_name} litigation paralegal building a chronology.

From the document text below, extract every dated event (notices, orders,
hearings, replies, payments, communications, incidents). For each:
- Resolve the date to ISO format (YYYY-MM-DD). If only a month/year is given, use
  the first day and note it in "date_text". If a date is relative and cannot be
  resolved from the text, do NOT guess — list it under "gaps".
- State the event factually in one short clause.
- Identify the actor and which document it came from.
- Note its legal significance (e.g. "starts 30-day reply period", "triggers
  limitation under the Limitation Act").

Order events chronologically. Use ONLY facts in the documents.

Respond with ONLY this JSON:
{"events": [{"date": "<ISO>", "date_text": "<string>", "event": "<string>",
  "actor": "<string>", "source_doc_id": "<id>", "significance": "<string>"}],
 "gaps": ["..."]}
```

## Guardrails

- Never fabricate or interpolate dates; ambiguity goes to `gaps`.
- Pairs well with the jurisdiction pack's limitation/appeal-window helpers to
  compute deadlines from anchored events.
- Deterministic fallback: regex-scan for date patterns and emit bare
  `{date_text, source_doc_id}` events, unsorted, with everything else in `gaps`.
