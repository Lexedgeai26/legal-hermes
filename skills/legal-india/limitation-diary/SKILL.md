---
name: limitation-diary
description: Scan the advocate's matter database for upcoming statutory deadlines — Section 138 dispatch and complaint windows, appeal limitation, GST reply due dates, and hearing dates — and produce a prioritised alert. Designed to run on a schedule via cron with a pre-run gate, and stays silent when nothing is due. It alerts only; it never files, serves, or acts.
version: 1.0.0
metadata:
  hermes:
    tags: [legal, india, deadlines, limitation, monitoring, advocate]
    category: legal-india
---

# Limitation diary

## When to Use

Run on a schedule (via a cron job, see the kit README) to surface statutory deadlines before they lapse, or on demand when the advocate asks "what's due this week". This is the highest-value piece for an Indian practice — a missed Section 138 window or appeal-limitation date is irreversible.

## Procedure

1. **Read the surfaced deadlines.** When run from cron, a pre-run gate script (`check_limitation.py`) has already queried the matter database and only woken this skill if something falls inside the alert window; the count and rows arrive as context. When run on demand, query the matter database directly for deadlines within the requested horizon.

2. **Prioritise and format.** For each deadline produce: the matter reference, the client, the deadline type (138 dispatch / 138 complaint / appeal limitation / GST reply due / hearing), the calendar date, the days remaining, and the single action required. Sort by days remaining, soonest first. Put anything inside 3 days at the top, flagged urgent.

3. **Stay quiet when clear.** If nothing is due inside the alert window, respond with only `[SILENT]` so the scheduled run delivers no message (the run is still logged for audit).

## Pitfalls

- This is an **alert, never an action**. It does not file, serve, send, or dispatch anything on the advocate's behalf.
- Deadlines come from the **matter database** (the source of truth), not the model's memory — never infer a date.
- Do not editorialise or summarise away a deadline; list every one inside the window.
- Days-remaining is computed from today's date against the stored deadline; show both.

## Verification

- Every deadline inside the alert window appears in the output, soonest first.
- Each row shows matter, type, date, and days remaining.
- When nothing is due, the response is exactly `[SILENT]`.
