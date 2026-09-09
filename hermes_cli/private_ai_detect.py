"""Auto-detection of a local Private AI (Ollama) runtime for the model picker.

Closes the gap found during the Windows installer QA pass: the installer's
Tauri app can provision a fully local Ollama runtime and writes
``$HERMES_HOME/private-ai/config/runtime.json`` describing it, but nothing
in the desktop app (or the plain ``hermes`` CLI) ever reads that file or
otherwise notices a local Ollama is available. This module is the read side
of that gap — ``hermes_cli/private_ai_provision.py`` is the write side
(auto-installing Ollama when nothing is detected at all).

Detection is intentionally decoupled from *how* the runtime got there: it
recognizes both an installer-provisioned runtime (via ``runtime.json``) and
a plain user-installed Ollama on the default port, and it treats a runtime
this module provisions itself identically, since ``private_ai_provision.py``
writes the same ``runtime.json`` schema. All paths are resolved through
``get_hermes_home()`` — never a hardcoded, dev-machine-specific path — so
this behaves the same on a clean install as it does in a QA sandbox.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from typing import Optional

_DEFAULT_BASE_URL = "http://127.0.0.1:11434"
_VERSION_PROBE_TIMEOUT_SECONDS = 0.3
_MODELS_PROBE_TIMEOUT_SECONDS = 2.0
_CACHE_TTL_SECONDS = 5.0

# Module-level cache: (monotonic_timestamp, DetectionResult). Avoids adding
# probe latency to every picker/settings open when nothing is running —
# mirrors the "1h cache, refresh busts it" convention already documented on
# GET /api/model/options, just with a much shorter TTL since "is Ollama up
# right now" is far more volatile than a provider's model catalog.
_cache: Optional["tuple[float, DetectionResult]"] = None


@dataclass(frozen=True)
class DetectionResult:
    """Outcome of probing for a local Ollama runtime.

    ``status`` is the load-bearing field — the frontend and
    ``inventory.py`` branch on it, not just display text:

    - ``not_setup``: no runtime.json AND nothing answers on the candidate
      port. Nothing has ever been installed. Only this state should offer
      a "Set up Private AI" (full download+install) action.
    - ``unreachable_configured``: runtime.json exists (something was
      already installed to $HERMES_HOME/private-ai/runtime/) but it isn't
      answering right now. Should offer "Start", never re-provisioning.
    - ``reachable_no_models``: answers, but has no models pulled yet.
    - ``connected``: answers with at least one model available.
    """

    status: str
    base_url: Optional[str]
    runtime_version: Optional[str] = None
    models: "tuple[str, ...]" = ()
    managed: bool = False


def get_private_ai_runtime_json() -> Optional[dict]:
    """Read and validate ``$HERMES_HOME/private-ai/config/runtime.json``.

    Returns ``None`` if it doesn't exist, isn't valid JSON, or isn't a
    schema this code understands — callers treat that identically to "no
    runtime has ever been provisioned", which is the safe default.
    """
    from hermes_constants import get_hermes_home

    path = get_hermes_home() / "private-ai" / "config" / "runtime.json"
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError:
        return None
    try:
        data = json.loads(raw)
    except ValueError:
        return None
    if not isinstance(data, dict) or data.get("schemaVersion") != 1:
        return None
    return data


def _probe_version(base_url: str) -> Optional[dict]:
    """GET ``{base_url}/api/version``. ``None`` if unreachable — never raises."""
    import httpx

    try:
        with httpx.Client(timeout=httpx.Timeout(_VERSION_PROBE_TIMEOUT_SECONDS)) as client:
            resp = client.get(f"{base_url.rstrip('/')}/api/version")
        if resp.status_code != 200:
            return None
        data = resp.json()
        return data if isinstance(data, dict) else {}
    except Exception:
        return None


def _list_models(base_url: str) -> "list[str]":
    """GET ``{base_url}/v1/models`` — Ollama's OpenAI-compatible surface.

    Reuses the same endpoint ``hermes_cli/models.py``'s ``fetch_api_models``
    already probes for any bare local/custom provider, so a model pulled via
    ``ollama pull`` shows up here with the exact tag (e.g. ``qwen2.5:0.5b``)
    the rest of the codebase already expects. Best-effort: empty list on
    any failure, never raises.
    """
    import httpx

    try:
        with httpx.Client(timeout=httpx.Timeout(_MODELS_PROBE_TIMEOUT_SECONDS)) as client:
            resp = client.get(f"{base_url.rstrip('/')}/v1/models")
        if resp.status_code != 200:
            return []
        data = resp.json()
        if not isinstance(data, dict):
            return []
        return [
            m["id"]
            for m in data.get("data", []) or []
            if isinstance(m, dict) and m.get("id")
        ]
    except Exception:
        return []


def detect_local_ollama(*, refresh: bool = False) -> DetectionResult:
    """Detect a locally running Ollama runtime, installer-managed or not.

    Cheap and cached (5s TTL, bypassed when ``refresh=True``) so this can
    run unconditionally on every ``/api/model/options`` call without
    noticeable latency even when nothing is running (the version probe
    alone times out in well under a second).
    """
    global _cache
    if not refresh and _cache is not None:
        ts, cached_result = _cache
        if time.monotonic() - ts < _CACHE_TTL_SECONDS:
            return cached_result

    runtime_json = get_private_ai_runtime_json()
    ollama_info = (runtime_json or {}).get("ollama") or {}
    candidate_url = ollama_info.get("baseUrl") or _DEFAULT_BASE_URL

    version_info = _probe_version(candidate_url)
    if version_info is None:
        # Distinguish "never installed" from "installed, currently
        # stopped" purely on whether runtime.json exists — this is the
        # difference between offering a fresh install vs. offering to
        # restart what's already on disk.
        status = "unreachable_configured" if runtime_json else "not_setup"
        result = DetectionResult(status=status, base_url=None)
    else:
        models = _list_models(candidate_url)
        status = "connected" if models else "reachable_no_models"
        result = DetectionResult(
            status=status,
            base_url=candidate_url,
            runtime_version=version_info.get("version"),
            models=tuple(models),
            managed=bool(runtime_json and runtime_json.get("managed")),
        )

    _cache = (time.monotonic(), result)
    return result


_STATUS_WARNINGS = {
    "not_setup": "Private AI is not set up yet.",
    "unreachable_configured": "Private AI was set up but isn't running.",
    "reachable_no_models": "Private AI is running, but no models have been pulled yet.",
}

PROVIDER_SLUG = "private-ai-local"
PROVIDER_NAME = "Private AI (Local)"


def build_config_entry(result: DetectionResult) -> Optional[dict]:
    """Shape a ``cfg["providers"]`` entry for the reachable states only.

    Returns ``None`` when there's no real ``base_url`` to hand the runtime
    resolver (``not_setup``/``unreachable_configured``) — those states
    can never be pushed through ``_normalize_custom_provider_entry``
    (``hermes_cli/config.py``), which hard-requires a valid URL, so the
    caller (``inventory.py``) must not attempt to inject them into config
    at all. Callers append a placeholder row directly instead — see
    ``build_placeholder_row``.
    """
    if not result.base_url:
        return None
    return {
        "name": PROVIDER_NAME,
        "base_url": result.base_url.rstrip("/") + "/v1",
        "discover_models": True,
    }


def build_placeholder_row(result: DetectionResult) -> dict:
    """Build a full picker row for a state with no real provider yet.

    Only meaningful for ``not_setup``/``unreachable_configured`` — always
    returns a row, never ``None``, which is what guarantees the Private AI
    card stays visible in the picker even when nothing is installed. The
    shape matches sibling rows from ``list_authenticated_providers``
    closely enough for the existing picker-hint/reorder/pricing/
    capabilities passes in ``build_models_payload`` to treat it as a
    normal (if empty) row; ``authenticated`` is pre-set here specifically
    so ``_apply_picker_hints`` (which skips any row already carrying that
    key) leaves it alone rather than re-deriving skeleton-row hints meant
    for the built-in provider catalog.
    """
    return {
        "slug": PROVIDER_SLUG,
        "name": PROVIDER_NAME,
        "status": result.status,
        "base_url": None,
        "authenticated": False,
        "is_current": False,
        "is_user_defined": True,
        "models": [],
        "total_models": 0,
        "source": "private-ai",
        "warning": _STATUS_WARNINGS.get(result.status, ""),
    }
