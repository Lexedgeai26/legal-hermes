---
name: extract-entities
description: Extract statutory identifiers (GSTIN, PAN, CIN, TAN), parties, case numbers, and key dates from a legal document, then re-validate every identifier deterministically against the jurisdiction pack.
---

# Extract Entities

**Layer:** Understanding · **Step ref:** `extract_entities` · **Model tier:** `fast`
**Wired in:** `legal_platform/llm_steps.py` (`llm_extract_entities`) with deterministic
fallback `legal_platform/workflow_handlers.py` (`extract_entities`).

## Purpose

Pull the structured facts a workflow needs — identifiers, parties, case/notice
numbers, amounts, and the reply due date. Identifiers proposed by the model are
**always re-validated in code** by the jurisdiction pack's validators; the model
is never the source of truth on validity.

## Inputs

```json
{ "text": "<extracted document text>" }
```

## Output (strict JSON)

```json
{
  "entities": [
    { "entity_type": "gstin|pan|cin|tan|case_no|party|amount|due_date",
      "raw_value": "<as written>" }
  ],
  "due_date": "<ISO date | null>"
}
```
After re-validation each identifier gains `normalized_value`, `valid` (bool|null),
and `reason`. Persisted as `extracted_entities` rows (linked to the document
version).

## System prompt

```
You are a legal information-extraction engine for {jurisdiction_name} law.

From the document below, extract:
- Statutory identifiers: GSTIN, PAN, CIN, TAN (verbatim, do not correct them).
- Parties (applicant/respondent/taxpayer/assessee/employer etc.).
- Case, notice, or reference numbers.
- Monetary demands.
- The reply/compliance due date (resolve relative deadlines like "within 30 days
  of service" to an ISO date only if the service date is stated; otherwise null).

Do NOT judge whether an identifier is valid — emit it exactly as written; the
system validates it separately.

Respond with ONLY this JSON:
{"entities": [{"entity_type": "<type>", "raw_value": "<string>"}], "due_date": "<ISO date or null>"}
```

User message = the document text (truncated to ~8000 chars).

## Re-validation (deterministic, mandatory)

For every entity of type `gstin|pan|cin|tan`, call
`jurisdiction_pack.validate(kind, raw_value)`:
- GSTIN: 15-char format + state code + embedded-PAN + checksum.
- PAN: format + holder-type char.
- CIN / TAN: format + plausibility.

`valid` is set from the validator, never from the model. Invalid identifiers are
surfaced as a warning suggestion to the user.

## Fallback (deterministic)

Regex-scan the text for GSTIN/PAN/CIN patterns and validate each. Confidence 90
if any found, else 40.
