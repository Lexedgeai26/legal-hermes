#!/usr/bin/env python3
"""Compute the controlling statutory windows for an Indian demand notice.

Deterministic date math — the skill calls this instead of letting the model
guess, because a wrong Section 138 window voids the notice. Days are statutory;
the advocate confirms against current amendments and the actual receipt dates.

Usage:
    python compute_timeline.py <notice_type> <trigger_date YYYY-MM-DD>

notice_type: nia_138 | ibc_s8 | sarfaesi_13_2 | cpc_s80 | arb_s21 | general_demand
"""
import json
import sys
from datetime import date, timedelta


def compute(notice_type: str, trigger_date: str) -> dict:
    try:
        t = date.fromisoformat(trigger_date)
    except ValueError:
        return {"status": "ERROR", "message": f"trigger_date '{trigger_date}' is not YYYY-MM-DD"}

    today = date.today()
    out = {"status": "ok", "notice_type": notice_type, "trigger_date": trigger_date, "windows": {}}

    if notice_type == "nia_138":
        dispatch_by = t + timedelta(days=30)  # notice within 30 days of dishonour intimation
        out["windows"] = {
            "dispatch_notice_by": dispatch_by.isoformat(),
            "drawer_pays_within": "15 days from RECEIPT of notice (set after service)",
            "file_complaint_within": "1 month after the 15-day period lapses",
        }
        if today > dispatch_by:
            out["status"] = "WINDOW_LAPSED"
            out["message"] = "30-day dispatch window has PASSED — a 138 notice now is void. Flag to advocate."

    elif notice_type == "ibc_s8":
        out["windows"] = {"debtor_responds_within": "10 days from delivery of the demand notice"}
    elif notice_type == "sarfaesi_13_2":
        out["windows"] = {"borrower_discharges_within": "60 days from service"}
    elif notice_type == "cpc_s80":
        out["windows"] = {"institute_suit_after": "2 calendar months from service (confirm month math)"}
    elif notice_type == "arb_s21":
        out["windows"] = {
            "arbitration_commences_on": "date of receipt of this notice",
            "note": "confirm the underlying claim is within limitation",
        }
    elif notice_type == "general_demand":
        out["windows"] = {"compliance_period": "as set by advocate (no statutory bar)"}
    else:
        return {"status": "ERROR", "message": f"unknown notice_type '{notice_type}'"}

    return out


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(json.dumps({"status": "ERROR", "message": "usage: compute_timeline.py <notice_type> <YYYY-MM-DD>"}))
        sys.exit(1)
    print(json.dumps(compute(sys.argv[1], sys.argv[2]), indent=2))
