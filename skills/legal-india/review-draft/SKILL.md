---
name: review-draft
description: AI quality-control pass over a generated draft before the human approval gate — checks completeness, internal consistency, unfilled placeholders, tone, and whether every notice point was addressed.
---

# Review Draft

**Layer:** Action · **Step ref:** `review_draft` · **Model tier:** `strong`
**Wired in:** `legal_platform/workflow_handlers.py` (`review_draft`, deterministic
today); LLM prompt below ready to promote into `llm_steps.py`.

## Purpose

A second set of eyes on the draft *before* it reaches the lawyer. Catches unfilled
`[placeholders]`, points raised in the notice that the draft failed to answer,
internal contradictions, wrong citation style, and tone issues — so the human
reviews a clean draft, not a rough one.

## Inputs

```json
{ "draft": { "draft_title": "<...>", "body": "<HTML>" },
  "source_notice": "<the original notice text>",
  "citation_style": "<...>" }
```

## Output (strict JSON)

```json
{
  "ok": true,
  "issues": [
    { "type": "placeholder|missing_point|inconsistency|citation|tone",
      "detail": "<what>", "location": "<heading/para>", "fix": "<suggested>" }
  ],
  "unaddressed_points": ["<notice points the draft ignored>"],
  "confidence": 0-100
}
```

## System prompt

```
You are a meticulous {jurisdiction_name} reviewing advocate. Quality-check the
DRAFT below against the ORIGINAL NOTICE before it goes to the supervising lawyer.

Check for:
- Unfilled placeholders ([like this]) that should have been completed from the
  available facts.
- Every allegation/demand in the notice: is it addressed in the draft? List any
  that are not under "unaddressed_points".
- Internal inconsistencies (contradictory dates, amounts, party names).
- Citation style adherence ({citation_style}) and exact section references.
- Professional tone and structure.

Do NOT rewrite the draft. Report issues precisely with the location and a
suggested fix. Set "ok" to false if there are any blocking issues (missing points
or factual inconsistencies). "confidence" is your certainty in this review.

Respond with ONLY this JSON:
{"ok": <bool>, "issues": [{"type": "...", "detail": "...", "location": "...",
  "fix": "..."}], "unaddressed_points": ["..."], "confidence": <int>}
```

## Guardrails

- Reviewer, not rewriter — it flags, the human (or a re-draft loop) fixes.
- If `ok: false`, surface the issues at the approval gate; a rejection feeds the
  comment back into a re-draft.
- Deterministic fallback: confirm the draft has a non-empty body and no obvious
  `[placeholder]` left; `ok` accordingly, `confidence` 85.
