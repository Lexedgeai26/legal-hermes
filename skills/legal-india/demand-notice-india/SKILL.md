---
name: demand-notice-india
description: Draft an Indian legal or statutory demand notice — Section 138 NI Act (cheque dishonour), IBC Section 8 operational-creditor demand, SARFAESI 13(2), Section 80 CPC government notice, Section 21 arbitration invocation, or a general advocate's recovery/breach demand. Computes the controlling statutory time windows, decides whether to mark the notice "without prejudice", and produces a serve-ready draft plus a service checklist. Draft only — it never serves.
version: 1.0.0
metadata:
  hermes:
    tags: [legal, india, demand-notice, litigation, advocate]
    category: legal-india
---

# Indian legal demand notice

## When to Use

When the advocate needs to issue a demand or statutory pre-litigation notice and wants a serve-ready draft. Several of these notices are statutory pre-conditions with strict, non-extendable clocks — a Section 138 notice sent on the 31st day is void and kills the complaint. Treat the timeline as the controlling constraint.

## Procedure

1. **Identify the notice type** — it fixes the clock, the mandatory contents, and whether the notice is on-record or "without prejudice":
   - `nia_138` — cheque dishonour, Section 138 NI Act. Statutory. On-record.
   - `ibc_s8` — operational-creditor demand, Section 8 IBC (Form 3/4). Statutory. On-record.
   - `sarfaesi_13_2` — secured-creditor demand, Section 13(2) SARFAESI. Statutory. On-record.
   - `cpc_s80` — mandatory notice to government, Section 80 CPC. Statutory. On-record.
   - `arb_s21` — invocation of arbitration, Section 21 Arbitration Act. On-record.
   - `general_demand` — advocate's recovery/breach demand, no governing statute. May be "without prejudice" if it is a settlement overture.
   If the facts fit more than one (a dishonoured cheque that is also an operational debt), surface both and let the advocate choose.

2. **Intake** — gather, and mark anything missing as `[CONFIRM: …]`: full party names and the **confirmed service address** of the opposite party; the obligation (contract/invoice/cheque/loan) with document references; the **triggering event and its date** (for `nia_138`, the date the payee received the bank's cheque-return memo — this starts the 30-day clock); amounts (principal, interest with basis, costs); the relief and compliance period; client authority to issue; and mode of service (recommend registered post AD + email for statutory notices).

3. **Compute the statutory timeline** — run the helper, never calculate these dates yourself:
   `python ${HERMES_SKILL_DIR}/scripts/compute_timeline.py <notice_type> <trigger_date_YYYY-MM-DD>`
   Put the result in a **timeline box at the very top** of the output, in plain calendar dates. If the script reports `WINDOW_LAPSED`, **stop and flag it loudly** — a stale statutory notice is worse than none.

4. **Decide "without prejudice"** — apply Section 23, Indian Evidence Act (carried into the Bharatiya Sakshya Adhiniyam, 2023) *selectively*. Statutory notices are **never** "without prejudice" — they are meant to go on record. Only a `general_demand` that is a genuine settlement overture carries "Without Prejudice" in the heading. When in doubt, leave it on-record and say why.

5. **Draft** using Indian advocate's-notice conventions: letterhead, date, mode of dispatch; "To" block with the confirmed address; "Under instructions from and on behalf of my client …"; numbered recitals each tied to a document; the governing section stated plainly; the demand; the compliance period and the exact consequence of non-compliance; advocate's signature block. For `nia_138`, expressly identify the cheque (number, date, amount, drawee bank), recite presentation and dishonour with the bank's reason, and demand the cheque amount within 15 days — these are mandatory for validity.

6. **Output** — produce three things: the timeline box (dispatch-by, comply-by, file-by dates); the draft notice as a file for the advocate to review and sign; and a short service checklist (confirmed address, recommended mode, proof to retain, and the diary date to file proceedings if uncomplied).

## Pitfalls

- **Never send or serve.** You produce a draft and a checklist. The advocate dispatches manually. Do not call any send/email/messaging tool from this skill.
- Statutory windows are **case-fatal** — if the trigger date is missing or the dispatch window has passed, flag it before drafting, not after.
- Statutory notices are **not** "without prejudice" — marking a 138 or IBC notice that way defeats its purpose.
- A wrong service address defeats the deemed-service presumption — flag an unconfirmed address.
- Statutory periods change by amendment — state that the advocate must confirm current windows.
- Never assert a fact the advocate has not supplied; mark every gap `[CONFIRM: …]`.

## Verification

- The timeline box is present with real calendar dates, and any `WINDOW_LAPSED` is surfaced at the top.
- Every unverified fact carries a `[CONFIRM: …]` marker.
- For `nia_138`, the cheque is identified and the 15-day demand is express.
- The draft is a file the advocate can sign; nothing was dispatched.
