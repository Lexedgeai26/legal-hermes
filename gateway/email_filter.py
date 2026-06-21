"""Profile-aware email relevance filtering.

The filter is intentionally header-first.  It decides whether an inbound email
is safe to fetch from sender, subject, and bulk-mail headers before the email
body or attachments are downloaded into the agent runtime.
"""

from __future__ import annotations

import logging
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from hermes_constants import get_hermes_home

logger = logging.getLogger(__name__)


DEFAULT_FILTER_CONFIG_PATHS = (
    get_hermes_home() / "email_filter_config.yaml",
    Path.home() / "Downloads" / "email_filter_config.yaml",
    Path(__file__).with_name("email_filter_config.yaml"),
)


@dataclass(frozen=True)
class EmailFilterDecision:
    action: str
    reason: str
    route_to: str = ""
    matched_domain: str = ""
    matched_terms: tuple[str, ...] = field(default_factory=tuple)

    @property
    def should_fetch(self) -> bool:
        return self.action == "fetch"


def _load_yaml(path: Path) -> dict[str, Any]:
    try:
        import yaml
    except Exception as exc:  # pragma: no cover - dependency exists in app env
        logger.warning("[EmailFilter] PyYAML unavailable: %s", exc)
        return {}
    try:
        with path.open("r", encoding="utf-8") as handle:
            data = yaml.safe_load(handle) or {}
        return data if isinstance(data, dict) else {}
    except FileNotFoundError:
        return {}
    except Exception as exc:
        logger.warning("[EmailFilter] Could not read %s: %s", path, exc)
        return {}


def _filter_config_path() -> Path | None:
    override = os.getenv("EMAIL_FILTER_CONFIG_FILE", "").strip()
    candidates = [Path(override).expanduser()] if override else list(DEFAULT_FILTER_CONFIG_PATHS)
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None


def load_email_filter_config() -> dict[str, Any]:
    path = _filter_config_path()
    if not path:
        return {}
    return _load_yaml(path)


def _current_profile_role() -> str:
    explicit = os.getenv("EMAIL_FILTER_ROLE", "").strip()
    if explicit:
        return _normalize_role(explicit)
    home = get_hermes_home()
    try:
        if home.parent.name == "profiles":
            return _normalize_role(home.name)
    except Exception:
        pass
    return "individual_advocate"


def _normalize_role(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", value.strip().lower()).strip("_")


def _as_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, tuple):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str) and value.strip():
        return [value.strip()]
    return []


def _contains_any(haystack: str, needles: list[str]) -> tuple[bool, str]:
    hay = haystack.lower()
    for needle in needles:
        if needle.lower() in hay:
            return True, needle
    return False, ""


def _sender_domain(sender_addr: str) -> str:
    if "@" not in sender_addr:
        return sender_addr.lower()
    return sender_addr.rsplit("@", 1)[1].lower()


def _domain_matches(sender_addr: str, domains: list[str]) -> tuple[bool, str]:
    sender = sender_addr.lower()
    domain = _sender_domain(sender_addr)
    for item in domains:
        candidate = item.lower().lstrip("@")
        if sender.endswith(candidate) or domain == candidate or domain.endswith("." + candidate):
            return True, item
    return False, ""


def _active_domains(config: dict[str, Any], role: str) -> list[str]:
    roles = config.get("roles") if isinstance(config.get("roles"), dict) else {}
    role_cfg = roles.get(role)
    if not isinstance(role_cfg, dict):
        role_cfg = roles.get(role.replace("-", "_"))
    if not isinstance(role_cfg, dict):
        role_cfg = roles.get("individual_advocate", {})
    domains = config.get("domains") if isinstance(config.get("domains"), dict) else {}
    active = _as_list(role_cfg.get("active_domains") if isinstance(role_cfg, dict) else [])
    if any(item.lower() == "all" for item in active):
        return list(domains.keys())
    return [item for item in active if item in domains]


def evaluate_email_headers(
    *,
    sender_addr: str,
    subject: str,
    headers: dict[str, str],
    profile_role: str | None = None,
    config: dict[str, Any] | None = None,
) -> EmailFilterDecision:
    allowed_raw = os.getenv("EMAIL_ALLOWED_USERS", "").strip()
    if allowed_raw:
        allowed = {addr.strip().lower() for addr in allowed_raw.split(",") if addr.strip()}
        if sender_addr.lower() in allowed:
            return EmailFilterDecision("fetch", "allowed sender")

    cfg = config if config is not None else load_email_filter_config()
    if not cfg:
        return EmailFilterDecision("hold", "no email filter configured")

    role = _normalize_role(profile_role or _current_profile_role())
    text = f"{sender_addr}\n{subject}"
    del text

    never = cfg.get("never_discard") if isinstance(cfg.get("never_discard"), dict) else {}
    found, term = _domain_matches(sender_addr, _as_list(cfg.get("custom_sender_allow")))
    if found:
        return EmailFilterDecision("fetch", "custom allowed sender", matched_terms=(term,))
    match, term = _domain_matches(sender_addr, _as_list(never.get("sender_domains")))
    if match:
        return EmailFilterDecision("fetch", "never-discard sender domain", matched_terms=(term,))
    for pattern in _as_list(never.get("subject_regex")):
        try:
            if re.search(pattern, subject, flags=re.IGNORECASE):
                return EmailFilterDecision("fetch", "never-discard subject pattern", matched_terms=(pattern,))
        except re.error:
            logger.debug("[EmailFilter] Invalid subject regex ignored: %s", pattern)

    domains = cfg.get("domains") if isinstance(cfg.get("domains"), dict) else {}
    for domain_name in _active_domains(cfg, role):
        domain_cfg = domains.get(domain_name)
        if not isinstance(domain_cfg, dict):
            continue
        matched_terms: list[str] = []
        found, term = _contains_any(subject, _as_list(domain_cfg.get("subject_keywords")))
        if found:
            matched_terms.append(term)
        found_sender, sender_term = _contains_any(sender_addr, _as_list(domain_cfg.get("sender_contains")))
        if found_sender:
            matched_terms.append(sender_term)
        if matched_terms:
            return EmailFilterDecision(
                "fetch",
                f"matched {domain_name} profile filter",
                route_to=str(domain_cfg.get("route_to") or ""),
                matched_domain=domain_name,
                matched_terms=tuple(matched_terms),
            )

    roles = cfg.get("roles") if isinstance(cfg.get("roles"), dict) else {}
    role_cfg = roles.get(role, {})
    if isinstance(role_cfg, dict):
        found, term = _contains_any(subject, _as_list(role_cfg.get("extra_subject_keywords")))
        if found:
            return EmailFilterDecision("fetch", "matched role keyword", matched_terms=(term,))

    exclude = cfg.get("exclude") if isinstance(cfg.get("exclude"), dict) else {}
    excluded = False
    matched_exclude = ""
    found, term = _contains_any(subject, _as_list(exclude.get("subject_contains")))
    if found:
        excluded, matched_exclude = True, term
    found, term = _contains_any(sender_addr, _as_list(exclude.get("sender_contains")))
    if found:
        excluded, matched_exclude = True, term
    if exclude.get("has_list_unsubscribe_header") and headers.get("List-Unsubscribe"):
        excluded, matched_exclude = True, "List-Unsubscribe"

    if excluded:
        return EmailFilterDecision("discard", "excluded bulk/noisy email", matched_terms=(matched_exclude,))
    return EmailFilterDecision("hold", "ambiguous email held for review")
