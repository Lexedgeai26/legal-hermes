---
name: intake-triage
description: Classify inbound Indian legal matters and documents, identify urgency and limitation sensitivity, and route uncertain matters to human review instead of guessing.
version: 1.0.0
metadata:
  hermes:
    tags: [legal, india, intake, triage, routing]
    category: legal-india
---

# Intake & Triage

## When to Use

Use this when an advocate or legal team receives a new message, uploaded document, matter note, notice, pleading, agreement, or client query and needs a first-pass classification before drafting, research, review, compliance, or limitation work starts.

This skill is for Indian legal practice across criminal, civil, corporate, income-tax, MCA/company-law, GST, labour, IPR, and other legal domains.

## Procedure

1. Read the raw message and any extracted attachment text. Identify the single best-fit domain: criminal, civil, corporate, income_tax, mca, gst, labour, ipr, or other.
2. Identify the specific matter type and document type where possible, using form names, statutory sections, issuing authority, subject matter, relief sought, and deadlines. Do not rely on identifiers alone.
3. Assign urgency as high, medium, or low. If a statutory clock may already be running, mark the matter as limitation-sensitive and set urgency to at least medium.
4. Recommend the next workflow: draft, review, research, diligence, monitor, opinion, or human_review.
5. Route to the most relevant next skill or workflow:
   - GST notices and demands: use `gst-notice-reply` or the GST domain pack before drafting.
   - Demand/recovery notices: use `demand-notice-india`.
   - Deadline or hearing-window matters: use `limitation-diary` or a deterministic limitation source.
   - Authority-heavy questions: use `legal-research` followed by `citation-check`.
   - Draft review: use `review-draft`, `redline-review` if available, or `risk-analysis`.
6. If confidence is below 60 percent, the domain is ambiguous, or the document type cannot be safely determined, route to human review. State what facts are missing instead of guessing.
7. Present the triage result in advocate-facing prose or a compact table. Include: domain, matter type, document type, urgency, limitation sensitivity, recommended workflow, route, confidence, and missing information.

## Pitfalls

- Do not output strict JSON to the user unless they explicitly ask for machine-readable output.
- Do not start drafting, filing, serving, sending, or portal activity from triage alone.
- Do not infer a statutory deadline from memory. If limitation may matter, escalate to a deterministic limitation source or mark it for advocate confirmation.
- Low confidence is not a failure. Human review is the correct route when classification is uncertain.

## Verification

- The result names exactly one primary domain or explicitly routes to human review.
- Limitation-sensitive matters are marked and not allowed to proceed as routine work.
- The recommended workflow is actionable and matches the matter type.
- Missing facts are listed clearly, and no legal conclusion is treated as final.
