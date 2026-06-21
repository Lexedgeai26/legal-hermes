---
name: compliance-check
description: Check Indian legal, tax, company-law, GST, labour, and filing matters against a supplied compliance checklist, marking each item met, gap, or not applicable with cure actions.
version: 1.0.0
metadata:
  hermes:
    tags: [legal, india, compliance, gst, mca, labour, tax]
    category: legal-india
---

# Compliance Check

## When to Use

Use this when an advocate, CA, company secretary, in-house team, or consultant needs to check a matter, entity, document, or filing against a known statutory or domain checklist.

Typical uses include GST returns and notices, MCA/ROC filings, income-tax filings, labour registers and returns, contract compliance, and matter-specific filing checklists.

## Procedure

1. Confirm the domain, matter type, entity or party facts, and the checklist to apply.
2. Treat the supplied checklist or domain pack as the universe of requirements. Do not add requirements from memory.
3. For each requirement, mark status as met, gap, or not applicable.
4. For each status, record the basis: the fact, filing, document, register, authority, or absence of evidence supporting the status.
5. For each gap, specify the concrete cure action: return to file, form to submit, register to maintain, payment to make, document to execute, or clarification to obtain.
6. Use a deterministic limitation or due-date source where dates matter. If no trusted source is available, mark the due date for confirmation rather than calculating from memory.
7. Return an advocate-facing checklist table with requirement, authority, due date, status, basis, action, and owner where known.

## Pitfalls

- Never invent checklist requirements. Ask for the checklist or use a connected domain pack.
- Do not declare compliant unless there are zero gaps and the supplied facts support every item.
- Missing evidence is a gap or confirmation item, not a pass.
- Do not file, upload, submit, or send anything from this skill.

## Verification

- Each checklist item has one status and an evidence basis.
- Every gap has a specific cure action.
- Due dates are sourced or marked for confirmation.
- The output is a review/checklist only; no filing or dispatch occurred.
