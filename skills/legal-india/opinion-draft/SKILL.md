---
name: opinion-draft
description: Draft Indian legal opinions and advisory memos in IRAC form using only provided authorities, explicit assumptions, caveats, and an advocate-owned advisory conclusion.
version: 1.0.0
metadata:
  hermes:
    tags: [legal, india, opinion, advisory, irac]
    category: legal-india
---

# Opinion / Advisory Memo

## When to Use

Use this when an advocate, counsel, consultant, or in-house team asks for a legal opinion, advisory memo, issue note, or IRAC analysis for a specific Indian law question.

Use only after facts and authorities are provided or retrieved. Pair with `legal-research` and `citation-check`.

## Procedure

1. Confirm the precise legal question, domain, matter type, party perspective, forum, and intended use of the opinion.
2. Separate confirmed facts from assumptions. Mark every unverified fact as `[CONFIRM: ...]`.
3. Use the IRAC structure: issue, rule, application, conclusion.
4. State the rule using only provided or retrieved authorities. Do not cite from memory.
5. Apply the rule to the confirmed facts. Where facts are thin, state the assumption and the effect of the uncertainty.
6. Include caveats, contrary authority if provided, and gaps in the source set.
7. Phrase the conclusion as an advisory view for advocate adoption, not as direct legal advice to the client.
8. Run citation-check before the opinion is treated as ready for review.

## Pitfalls

- Do not provide a final legal conclusion as if the model owns it; the advocate owns the conclusion.
- Do not cite authorities that were not supplied or retrieved.
- Do not hide assumptions in the analysis.
- If authority is thin or missing, lower confidence and say what research is still required.

## Verification

- The opinion uses IRAC.
- Every authority traces to a provided or retrieved source.
- Assumptions and caveats are explicit.
- The conclusion is marked as advisory and ready only for advocate review.
