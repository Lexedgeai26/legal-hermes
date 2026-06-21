---
name: classify-matter
description: Classify an incoming legal document into the active jurisdiction's matter taxonomy (e.g. gst_scn, it_142_1, pf_notice) with a confidence score, so the orchestrator can route it to the right workflow.
---

# Classify Matter

**Layer:** Understanding · **Step ref:** `classify_matter` · **Model tier:** `fast`
**Wired in:** `legal_platform/llm_steps.py` (`llm_classify_matter`) with deterministic
fallback `legal_platform/workflow_handlers.py` (`classify_matter`).

## Purpose

Answer one question: *"What is this document?"* Map the extracted text to exactly
one `matter_type` key from the **active jurisdiction pack's** taxonomy, or
`unknown`. Drives auto-routing (`routing.route_intake`) and the workflow's first
step. Low confidence (< 60) routes to human triage instead of guessing.

## Inputs

```json
{ "text": "<extracted document text>" }
```
Plus run context: `jurisdiction.code`, and the taxonomy keys from the pack.

## Output (strict JSON)

```json
{ "matter_type": "<taxonomy key | 'unknown'>", "confidence": 0-100, "rationale": "<short>" }
```

## System prompt

```
You are a legal intake classifier for {jurisdiction_name} law.

Classify the document below into EXACTLY ONE of these matter_type keys:
{matter_type_keys}
…or "unknown" if it matches none with reasonable confidence.

Rules:
- Choose the most specific matching key (e.g. prefer "gst_drc01" over a generic
  "gst_scn" when the document names Form GST DRC-01).
- "confidence" is your calibrated certainty 0-100. Use < 60 only when genuinely
  unsure — a low score sends the document to a human, so do not inflate it.
- Base the decision on form numbers, statutory section references, issuing
  authority, and subject matter — not on the presence of identifiers alone.
- Do NOT invent a key that is not in the list above.

Respond with ONLY this JSON (no prose, no markdown fence):
{"matter_type": "<key>", "confidence": <int 0-100>, "rationale": "<one sentence>"}
```

User message = the document text (truncated to ~8000 chars).

## Fallback (deterministic)

Keyword-match the text against each matter type's `keywords` in the jurisdiction
pack; confidence = `min(95, 50 + 20·hits)`. Returns `unknown`/0 on no match.

## Guardrails

- If the model returns a `matter_type` not in the taxonomy (hallucination), fall
  back to the deterministic classifier.
- The result's `domain` is backfilled from `pack.matter_type(key).domain`.
- This skill never starts a workflow; it only labels. Routing is a separate step.
