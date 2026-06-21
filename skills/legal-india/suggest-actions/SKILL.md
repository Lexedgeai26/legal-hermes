---
name: suggest-actions
description: Turn document understanding (classification + validated entities) into an ordered list of concrete next actions the user can accept — run a workflow, set a deadline task, heed an identifier warning, or triage manually.
---

# Suggest Actions

**Layer:** Decision · **Rule-based** (not an LLM skill) · **Model tier:** n/a
**Wired in:** `legal_platform/suggestions.py` (`build_suggestions`,
`analyze_intake_item`). Surfaced by `POST /api/intake/analyze` and the
`document/{id}/analyze` endpoint; rendered in the Intelligent Intake panel.

## Purpose

After a document is understood, propose what to do — *without* auto-running a
workflow. The user picks. This is deliberately deterministic (no LLM) so the
proposed actions are predictable and auditable.

## Inputs

The understanding outputs: the active jurisdiction pack, `classification`,
`entities` (validated), and the matched `template_key`.

## Output

An ordered list of actions, each:
```json
{ "type": "run_workflow|create_task|warning|info|manual_triage",
  "label": "<button text>", "description": "<one line>",
  "priority": "high|medium|low", "params": { ... } }
```

## Rules (the "prompt", as logic)

```
1. If matter_type is "unknown" OR confidence < 60 OR no template matched:
   → emit a high-priority "manual_triage" action ("Choose how to handle this
     document"). Do NOT propose running a workflow.
   Else:
   → emit a high-priority "run_workflow" action ("Draft a reply — <matter label>")
     carrying the matched template_key.

2. For identifiers that FAILED validation:
   → emit a high-priority "warning" listing each (type, value, reason).

3. For identifiers that PASSED validation:
   → emit a low-priority "info" confirming them.

4. If a reply/compliance due date was extracted:
   → emit a medium-priority "create_task" to set the deadline.

5. For tax/litigation domains:
   → emit a low-priority "info" showing the appeal path from the jurisdiction
     pack (e.g. AO → CIT(A) → ITAT → High Court → Supreme Court).

Order by priority (high → low).
```

## Why rule-based

The classification and extraction were already done by LLM skills (and
deterministically validated). Action *selection* maps a known state to known
options — making it an LLM call would add nondeterminism and cost for no benefit,
and would weaken auditability. Keep it as code.

## Extending

Add a new action type by extending `build_suggestions`; if a future action needs
judgment (e.g. "recommend settlement vs contest"), that judgment belongs in a
separate LLM skill whose *output* this rule layer turns into an action.
