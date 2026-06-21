---
name: limitation-calc
description: Identify Indian legal limitation and statutory deadline windows, select the controlling rule, and use deterministic date sources rather than model arithmetic.
version: 1.0.0
metadata:
  hermes:
    tags: [legal, india, limitation, deadlines, dates]
    category: legal-india
---

# Limitation & Deadline Computation

## When to Use

Use this when a matter may involve statutory limitation, appeal periods, reply deadlines, hearing windows, NI Act timelines, GST demand windows, income-tax notice or appeal limits, civil limitation, criminal cognizance limits, or filing/service deadlines.

## Procedure

1. Confirm the domain, matter type, trigger event, trigger date, service/receipt date, forum, and applicable statute or rule source.
2. Select the candidate limitation rule from the domain pack, supplied statute, firm rules, or trusted deterministic source.
3. Do not perform date arithmetic from model memory. Use a deterministic tool/source where available, or mark the calculation for advocate confirmation.
4. Identify all relevant windows: notice deadline, reply deadline, appeal deadline, condonable delay, filing deadline, order deadline, or hearing-related deadline.
5. Surface the earliest critical date first.
6. If any window appears lapsed, mark it prominently and block any filing/service recommendation pending advocate review.
7. Always include a verification note requiring confirmation against current amendments, actual service/receipt dates, exclusions, holidays, and forum practice.

## Pitfalls

- Never guess statutory dates from memory.
- Do not treat a document date as the service date unless the facts confirm it.
- Do not ignore condonation, exclusion, or holiday rules; mark them for confirmation when not deterministically available.
- Lapsed limitation must be escalated, not buried.

## Verification

- Trigger event and trigger date are stated.
- Rule applied and source are stated.
- Earliest critical date is surfaced or marked as requiring deterministic computation.
- Any lapsed window is flagged for advocate review before action.
