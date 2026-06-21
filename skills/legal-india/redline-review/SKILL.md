---
name: redline-review
description: Review Indian legal and commercial documents clause by clause against a supplied playbook, flag deviations and missing protections, and propose specific redlines from the acting party's perspective.
version: 1.0.0
metadata:
  hermes:
    tags: [legal, india, contracts, redline, review]
    category: legal-india
---

# Playbook Redline Review

## When to Use

Use this for contract, corporate, employment, vendor, lease, policy, settlement, or other document review where the user has a document and a playbook or standard position.

This skill is strongest for in-house, corporate, transactional, and commercial review. Pair with `risk-analysis` to score exposure.

## Procedure

1. Confirm the document type, domain, matter type, party we act for, and review perspective.
2. Confirm the playbook or standard positions to test against. If no playbook is supplied, ask for one or mark the review as preliminary.
3. Review each playbook position against the document.
4. For each issue, quote the relevant clause. If protection is absent, mark the clause as `MISSING`.
5. Mark status as ok, deviation, or missing.
6. Assign severity from the acting party's perspective.
7. Provide a specific redline, carve-out, insertion, deletion, or fallback position.
8. Summarise blockers that should prevent signing or filing as drafted.

## Pitfalls

- Do not give generic commentary detached from the document text.
- Do not invent a playbook position. Use supplied standards or clearly mark assumptions.
- Do not say "no issues" unless each playbook position was checked.
- Do not execute or approve signature; this is a review draft.

## Verification

- Every finding quotes the source clause or says `MISSING`.
- Every deviation has a suggested redline or fallback.
- Blockers are clearly separated from lower-risk comments.
- The review perspective is named.
