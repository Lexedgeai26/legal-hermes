---
name: gst-notice-reply
description: Draft a reply to an Indian GST notice — ASMT-10 (scrutiny), DRC-01A (pre-SCN intimation), DRC-01 (show-cause notice), or a Section 73/74/74A demand. Classifies the notice, extracts the demand heads and the controlling limitation window, pulls supporting authorities from a connected trusted GST MCP source, and drafts a serve-ready reply with a filing checklist. Draft only — it never files on the portal.
version: 1.0.0
metadata:
  hermes:
    tags: [legal, india, gst, tax, advocate, ca]
    category: legal-india
---

# GST notice reply

## When to Use

When the advocate or CA needs to reply to a GST notice and wants a drafted, authority-backed response plus the limitation/filing dates. Getting the limitation regime or a citation wrong is the failure mode this skill exists to prevent.

## Procedure

1. **Classify and extract.** Identify the form (ASMT-10 / DRC-01A / DRC-01 / DRC-07) and pull: the tax periods, each demand head with amount, the allegations, and the sections invoked. Determine the **limitation regime**:
   - Section 73 (non-fraud) and Section 74 (fraud/suppression) govern periods up to FY 2023-24, with different SCN and order time limits.
   - Section 74A (merged regime introduced by the Finance Act 2024) governs from FY 2024-25.
   Pull the **controlling limitation window from the firm's limitation rules / trusted GST MCP source** — do not compute or guess these dates in the model. Surface the window for the advocate to verify; do not treat it as final. If no trusted GST MCP source is connected, stop before citing authorities and mark the reply as a non-citation draft.

2. **Retrieve authorities.** Use the connected trusted GST MCP source to fetch relevant judgments and circulars for the issues raised. For each, record the holding and the exact citation. **Cite only what the tool returns** — never invent a citation.

3. **Analyse grounds.** Rank the strongest grounds of defence, each tied to a retrieved authority and a one-line risk note. Flag any departmental mis-citation or limitation defect.

4. **Draft the reply** addressing each demand head in turn, in formal tax-practice style: recite the notice, answer each allegation with facts and the supporting authority, raise limitation/jurisdiction objections where they exist, and state the relief sought.

5. **Cite-check.** Every authority in the draft must exist in the retrieved set and must actually support the point. Reject and redraft otherwise.

6. **Output** — the draft reply as a file for review, plus a checklist: the limitation date, the reply due date, the portal forms to file (e.g. reply to ASMT-10 / DRC-06), and any annexures to attach.

## Pitfalls

- **Never file on the GST portal.** You produce a draft and a checklist; the advocate/CA files. Do not call any portal-automation, send, or upload tool from this skill.
- **Hallucinated citations are fatal** — cite only authorities returned by the trusted GST MCP source.
- **Confirm the regime per FY** — s.73 vs s.74 vs s.74A; the wrong track gives the wrong limitation date.
- Limitation comes from the deterministic source (trusted GST MCP source / firm rules), not the model's memory.
- Mark every unverified fact `[CONFIRM: …]`.

## Verification

- The limitation regime (73/74/74A) is identified and the window is surfaced for confirmation.
- Every cited authority traces to a trusted GST MCP result.
- Each demand head in the notice is answered.
- The reply is a file the advocate can review; nothing was filed or uploaded.
