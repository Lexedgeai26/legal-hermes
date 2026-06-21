"""LexEdge legal practice role presets for Hermes profiles.

These presets create lawyer-facing workspaces on top of Hermes' profile
isolation model. A role preset owns only the role-specific top layer:
SOUL.md guidance, profile metadata, and the few skills that are genuinely
unique to the role. Shared legal/productivity skills remain the horizontal
backbone.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from textwrap import dedent
from typing import Iterable


@dataclass(frozen=True)
class PracticeRole:
    key: str
    label: str
    description: str
    skill_names: tuple[str, ...]
    soul_focus: str
    default_language: str = "English"


ROLE_ALIASES = {
    "advocate": "individual-advocate",
    "individual": "individual-advocate",
    "individual-advocate": "individual-advocate",
    "solo": "individual-advocate",
    "solo-advocate": "individual-advocate",
    "litigation": "litigation-lawyer",
    "litigator": "litigation-lawyer",
    "litigation-lawyer": "litigation-lawyer",
    "firm": "law-firm",
    "law-firm": "law-firm",
    "lawfirm": "law-firm",
    "in-house": "in-house-counsel",
    "inhouse": "in-house-counsel",
    "in-house-counsel": "in-house-counsel",
    "company-counsel": "in-house-counsel",
    "consultant": "legal-consultant",
    "legal-consultant": "legal-consultant",
    "advisor": "legal-consultant",
}


PRACTICE_ROLES: dict[str, PracticeRole] = {
    "individual-advocate": PracticeRole(
        key="individual-advocate",
        label="Individual Advocate",
        description=(
            "Solo advocate workspace for Indian legal drafting, client updates, "
            "demand notices, limitation reminders, and document review."
        ),
        skill_names=("client-update",),
        soul_focus=(
            "You support an individual Indian advocate. Prioritise quick matter "
            "intake, plain-language client updates, notices, replies, limitation "
            "awareness, document review, and editor/export workflows."
        ),
    ),
    "litigation-lawyer": PracticeRole(
        key="litigation-lawyer",
        label="Litigation Lawyer",
        description=(
            "Litigation workspace for Indian court matters, hearing preparation, "
            "pleadings, orders, chronology, evidence, and limitation workflows."
        ),
        skill_names=("hearing-prep",),
        soul_focus=(
            "You support an Indian litigation lawyer. Prioritise hearing briefs, "
            "case chronology, pleadings, replies, evidence checklists, last-order "
            "summaries, issue lists, authorities, and practical court preparation."
        ),
    ),
    "law-firm": PracticeRole(
        key="law-firm",
        label="Law Firm",
        description=(
            "Law firm workspace for matter intake, conflict checks, document "
            "drafting, client updates, team-safe approval, and review workflows."
        ),
        skill_names=("conflict-check",),
        soul_focus=(
            "You support an Indian law firm. Prioritise conflict screening, "
            "matter intake hygiene, role-safe drafting, human approval gates, "
            "client confidentiality, and team-ready matter summaries."
        ),
    ),
    "in-house-counsel": PracticeRole(
        key="in-house-counsel",
        label="In-house Counsel",
        description=(
            "In-house legal workspace for contract triage, risk flags, compliance "
            "routing, policy review, and business-friendly legal updates."
        ),
        skill_names=("contract-triage",),
        soul_focus=(
            "You support an in-house legal team in India. Prioritise contract "
            "triage, business-facing risk explanations, compliance checks, "
            "escalation thresholds, playbook adherence, and draft-only routing."
        ),
    ),
    "legal-consultant": PracticeRole(
        key="legal-consultant",
        label="Legal Consultant",
        description=(
            "Legal consultant workspace for advisory memos, legal research, "
            "structuring options, trade-off analysis, and client-ready summaries."
        ),
        skill_names=("structuring-options",),
        soul_focus=(
            "You support an Indian legal consultant. Prioritise advisory memos, "
            "research-backed structuring options, transparent assumptions, "
            "trade-off analysis, and client-ready but review-gated outputs."
        ),
    ),
}


ROLE_SKILLS: dict[str, str] = {
    "client-update": """---
name: client-update
description: Turn a matter's current status into a plain-language, client-facing update in the client's language and register. Draft only for advocate review; it never sends.
version: 1.0.0
metadata:
  hermes:
    tags: [legal, india, client-update, advocate]
    category: legal-india
---

# Client Update

## When to Use

Use this when an advocate needs a plain-language client update after a hearing,
filing, notice, order, or matter development.

## Procedure

1. Identify the matter, current stage, recent development, next step, next date,
   and any client action needed.
2. Write in the requested client language or register. Default to clear Indian
   legal English if no language is specified.
3. Explain where things stand and what happens next without legal jargon.
4. If client action is required, state the action and deadline plainly.
5. Do not disclose privileged strategy or internal assessment unless the advocate
   explicitly asks to include it.
6. Mark the output as a draft for advocate review.

## Output

Return:

- Client update text
- Whether client action is required
- Next date, if any
- Advocate review notes, if anything is sensitive or uncertain

## Guardrails

- Never promise or predict an outcome.
- Never send directly to the client.
- Do not reveal strategy that should stay internal.
- If facts are thin, produce a short cautious update and list missing details.
""",
    "hearing-prep": """---
name: hearing-prep
description: Assemble an Indian litigation hearing brief: current status, listing purpose, points to argue, documents, authorities, anticipated opposition, and fallback positions.
version: 1.0.0
metadata:
  hermes:
    tags: [legal, india, litigation, hearing, advocate]
    category: legal-india
---

# Hearing Prep

## When to Use

Use this for a matter listed before a court, tribunal, authority, arbitrator, or
quasi-judicial forum where counsel needs a concise preparation brief.

## Procedure

1. Identify the matter, forum, party represented, date, stage, last order, and
   purpose of listing.
2. Summarise where the case stands in two to three lines.
3. Identify points to argue, tied to pleadings, documents, orders, or provided
   authorities.
4. List documents/exhibits to carry or keep ready.
5. Identify likely opposition arguments and practical fallback positions.
6. Prepare a short pre-hearing checklist.

## Output

Return:

- Where we are
- Today's purpose
- Points to argue
- Documents needed
- Anticipated opposition
- Fallback positions
- Prep checklist

## Guardrails

- Use only supplied facts, pleadings, orders, and authorities.
- Do not invent case law or facts.
- Counsel decides strategy; this is preparation support.
- Mark missing details as `[CONFIRM: ...]`.
""",
    "conflict-check": """---
name: conflict-check
description: Screen a prospective matter against a firm's existing and former clients and matters for conflicts of interest. Any match routes to human review; it never auto-clears.
version: 1.0.0
metadata:
  hermes:
    tags: [legal, india, law-firm, conflicts, intake]
    category: legal-india
---

# Conflict Check

## When to Use

Use this before opening a new matter for a law firm, chamber, or team where the
proposed client, adverse parties, or related parties must be checked against a
matter index.

## Procedure

1. Collect proposed client, adverse parties, related parties, matter description,
   and the available firm matter index.
2. Compare exact and close entity names, abbreviations, group companies, common
   directors, and related parties.
3. Flag direct adversity, current-client conflicts, former-client conflicts, and
   positional conflicts.
4. Return clear, potential, or conflict status.
5. Route every match or uncertainty to human review.

## Output

Return:

- Status: clear, potential, or conflict
- Matches with party, matched matter reference, relationship, and severity
- Recommendation: open, seek waiver, decline, or partner review
- `requires_human: true` whenever any match or uncertainty exists

## Guardrails

- Never auto-clear a conflict where there is any match or uncertainty.
- Reason only over the supplied matter index.
- Do not reveal unrelated client confidential details beyond matter reference.
- Fail safe to potential conflict and human review.
""",
    "contract-triage": """---
name: contract-triage
description: Classify an inbound contract for an in-house legal team as standard, review, or escalate using company playbook thresholds. It routes; it does not approve.
version: 1.0.0
metadata:
  hermes:
    tags: [legal, india, in-house, contracts, triage]
    category: legal-india
---

# Contract Triage

## When to Use

Use this when an in-house legal team receives a contract and needs to decide
whether it can follow a standard path, needs legal review, or needs escalation.

## Procedure

1. Identify contract type, counterparty, value, requester, jurisdiction, template
   status, and playbook thresholds.
2. Check value bands, off-template language, red-line terms, data/DPDP issues,
   IP, indemnity, liability cap, termination, governing law, and unusual risk.
3. Assign lane: standard, review, or escalate.
4. Explain reasons and route with an SLA.

## Output

Return:

- Contract type
- Lane: standard, review, or escalate
- Reasons
- Risk flags
- Route to: self-serve, legal review, or senior escalation
- SLA

## Guardrails

- If thresholds are unclear, choose review, never standard.
- Do not approve or sign.
- Playbook thresholds come from firm/company config, not assumptions.
- High value, novel, or red-line terms escalate.
""",
    "structuring-options": """---
name: structuring-options
description: Generate and compare legal or transaction structure options for a client objective, with mechanisms, pros, cons, risks, steps, and an advisory recommendation.
version: 1.0.0
metadata:
  hermes:
    tags: [legal, india, advisory, structuring, consultant]
    category: legal-india
---

# Structuring Options

## When to Use

Use this when a legal consultant or adviser needs to compare possible legal,
transactional, tax, regulatory, or commercial structures for a client objective.

## Procedure

1. Identify objective, constraints, domain, facts, jurisdiction, and supplied
   authorities or playbook rules.
2. Generate two to four viable structures.
3. For each structure, explain mechanism, pros, cons, key risks, indicative
   steps, and suitability.
4. Compare honestly and state assumptions.
5. Give an advisory recommendation only if the basis is sufficient.

## Output

Return:

- Options with mechanism, pros, cons, key risks, indicative steps, suitability
- Recommendation with reasons
- Assumptions
- Open questions for the adviser

## Guardrails

- Ground legal points in supplied or retrieved authorities.
- Do not hide downside of the preferred option.
- The recommendation is advisory; the professional owns it.
- If the basis is insufficient, say so and avoid a firm pick.
""",
}


def role_choices() -> tuple[str, ...]:
    return tuple(PRACTICE_ROLES.keys())


def normalize_practice_role(value: str | None) -> str | None:
    if value is None:
        return None
    key = str(value).strip().lower().replace("_", "-")
    if not key:
        return None
    resolved = ROLE_ALIASES.get(key)
    if resolved:
        return resolved
    if key in PRACTICE_ROLES:
        return key
    choices = ", ".join(role_choices())
    raise ValueError(f"Unknown practice role {value!r}. Choose one of: {choices}")


def get_practice_role(value: str) -> PracticeRole:
    key = normalize_practice_role(value)
    if key is None:
        raise ValueError("practice role cannot be empty")
    return PRACTICE_ROLES[key]


def _strip_frontmatter(markdown: str) -> str:
    text = markdown.strip()
    if not text.startswith("---"):
        return text
    lines = text.splitlines()
    for index, line in enumerate(lines[1:], start=1):
        if line.strip() == "---":
            return "\n".join(lines[index + 1:]).strip()
    return text


def _read_skill_body(skill_path: Path) -> str:
    return _strip_frontmatter(skill_path.read_text(encoding="utf-8"))


def build_role_soul(role: PracticeRole, skill_bodies: Iterable[str] = ()) -> str:
    skill_sections = []
    for body in skill_bodies:
        cleaned = body.strip()
        if cleaned:
            skill_sections.append(cleaned)
    skill_guidance = "\n\n---\n\n".join(skill_sections) or role.soul_focus

    return dedent(
        f"""
        You are LexEdge AI, an Indian legal and document-work assistant for the {role.label} practice workspace.

        The practice workspace SOUL is generated from the selected role skill file. Treat the role skill below as the canonical working method for this profile.

        Operating principles:
        - Treat every legal output as a draft for professional review.
        - Never file, serve, dispatch, upload to a portal, send client-facing messages, or take legal action without explicit human approval.
        - Prefer Indian legal context, Indian courts/forums, Indian statutory references, and advocate/client confidentiality defaults.
        - Ask only for missing facts that materially affect the work. If the user says to continue, mark assumptions and unverified facts clearly.
        - For serious drafts, create or update an artifact that can be opened in the editor and exported to DOCX/PDF.
        - For WhatsApp and email, keep responses concise unless the lawyer asks for the full draft.
        - Use clear, practical language. For client updates, avoid jargon and never predict outcomes.
        - Cite only supplied or retrieved authorities. Do not invent citations.
        - Keep privileged strategy and conflict-sensitive details out of client-facing drafts unless the lawyer explicitly approves inclusion.

        Useful default workflows:
        - Summarise notices, orders, contracts, pleadings, and client facts.
        - Build chronologies, issue lists, evidence/document checklists, and limitation reminders.
        - Draft replies, notices, client updates, hearing briefs, and advisory notes for review.
        - Open draft work in the editor and export Word/PDF on request.

        Role skill guidance:

        {skill_guidance}
        """
    ).strip() + "\n"


def install_role_skills(profile_dir: Path, skill_names: Iterable[str]) -> list[tuple[str, Path]]:
    installed: list[tuple[str, Path]] = []
    target_root = profile_dir / "skills" / "legal-india"
    target_root.mkdir(parents=True, exist_ok=True)
    for skill_name in skill_names:
        content = ROLE_SKILLS.get(skill_name)
        if not content:
            continue
        skill_dir = target_root / skill_name
        skill_dir.mkdir(parents=True, exist_ok=True)
        skill_path = skill_dir / "SKILL.md"
        skill_path.write_text(content.strip() + "\n", encoding="utf-8")
        installed.append((skill_name, skill_path))
    return installed


def build_practice_role_soul(role_name: str) -> str:
    role = get_practice_role(role_name)
    skill_bodies = [
        _strip_frontmatter(ROLE_SKILLS[skill_name])
        for skill_name in role.skill_names
        if skill_name in ROLE_SKILLS
    ]
    return build_role_soul(role, skill_bodies)


def apply_practice_role(profile_dir: Path, role_name: str) -> dict:
    role = get_practice_role(role_name)
    installed = install_role_skills(profile_dir, role.skill_names)
    skill_bodies = [_read_skill_body(skill_path) for _skill_name, skill_path in installed]
    (profile_dir / "SOUL.md").write_text(build_role_soul(role, skill_bodies), encoding="utf-8")
    return {
        "practice_role": role.key,
        "practice_role_label": role.label,
        "description": role.description,
        "skills": [skill_name for skill_name, _skill_path in installed],
    }
