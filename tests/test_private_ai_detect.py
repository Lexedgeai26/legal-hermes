"""Tests for hermes_cli.private_ai_detect — the Private AI (local Ollama)
auto-detection that feeds the model picker.

Covers the specific guarantee this feature was built around: the Private
AI provider row must never be silently absent from the picker, even when
nothing is installed — and "never installed" (``not_setup``) must stay a
genuinely distinct state from "installed but stopped"
(``unreachable_configured``), since only the latter is safe to just
restart rather than re-provisioning from scratch.
"""

from __future__ import annotations

import pytest

from hermes_cli import private_ai_detect as pad


@pytest.fixture(autouse=True)
def _clear_detection_cache():
    # The module keeps a short-TTL in-memory cache; reset it around every
    # test so tests don't leak state into each other via real wall-clock
    # timing.
    pad._cache = None
    yield
    pad._cache = None


def _result(status: str, base_url=None, models=()):
    return pad.DetectionResult(status=status, base_url=base_url, models=tuple(models))


# ─── build_placeholder_row: the "always present" guarantee ────────────────


def test_placeholder_row_never_none_and_has_no_base_url_for_not_setup():
    row = pad.build_placeholder_row(_result("not_setup"))
    assert row is not None
    assert row["status"] == "not_setup"
    assert row["base_url"] is None
    assert row["slug"] == "private-ai-local"
    assert row["authenticated"] is False
    assert row["warning"]


def test_placeholder_row_distinguishes_unreachable_configured_from_not_setup():
    not_setup_row = pad.build_placeholder_row(_result("not_setup"))
    stopped_row = pad.build_placeholder_row(_result("unreachable_configured"))

    assert not_setup_row["status"] != stopped_row["status"]
    assert not_setup_row["warning"] != stopped_row["warning"]
    # Neither state carries a usable endpoint — that's what makes both of
    # them ineligible for the normal custom-provider config pipeline.
    assert not_setup_row["base_url"] is None
    assert stopped_row["base_url"] is None


# ─── build_config_entry: only the reachable states get a real endpoint ────


def test_config_entry_is_none_for_not_setup_and_unreachable_configured():
    assert pad.build_config_entry(_result("not_setup")) is None
    assert pad.build_config_entry(_result("unreachable_configured")) is None


def test_config_entry_present_for_reachable_states():
    connected = pad.build_config_entry(_result("connected", base_url="http://127.0.0.1:11434", models=["qwen2.5:0.5b"]))
    assert connected is not None
    assert connected["base_url"] == "http://127.0.0.1:11434/v1"
    assert connected["discover_models"] is True
    assert "api_key" not in connected
    assert "key_env" not in connected

    no_models = pad.build_config_entry(_result("reachable_no_models", base_url="http://127.0.0.1:11434"))
    assert no_models is not None
    assert no_models["base_url"] == "http://127.0.0.1:11434/v1"


# ─── detect_local_ollama: not_setup vs unreachable_configured ─────────────


def test_not_setup_when_no_runtime_json_and_nothing_answers(monkeypatch):
    monkeypatch.setattr(pad, "get_private_ai_runtime_json", lambda: None)
    monkeypatch.setattr(pad, "_probe_version", lambda base_url: None)

    result = pad.detect_local_ollama(refresh=True)
    assert result.status == "not_setup"
    assert result.base_url is None


def test_unreachable_configured_when_runtime_json_exists_but_nothing_answers(monkeypatch):
    monkeypatch.setattr(
        pad,
        "get_private_ai_runtime_json",
        lambda: {"schemaVersion": 1, "managed": True, "ollama": {"baseUrl": "http://127.0.0.1:11434"}},
    )
    monkeypatch.setattr(pad, "_probe_version", lambda base_url: None)

    result = pad.detect_local_ollama(refresh=True)
    assert result.status == "unreachable_configured"
    assert result.base_url is None


def test_connected_when_reachable_with_models(monkeypatch):
    monkeypatch.setattr(pad, "get_private_ai_runtime_json", lambda: None)
    monkeypatch.setattr(pad, "_probe_version", lambda base_url: {"version": "0.33.3"})
    monkeypatch.setattr(pad, "_list_models", lambda base_url: ["qwen2.5:0.5b", "embeddinggemma:300m"])

    result = pad.detect_local_ollama(refresh=True)
    assert result.status == "connected"
    assert result.base_url == pad._DEFAULT_BASE_URL
    assert result.models == ("qwen2.5:0.5b", "embeddinggemma:300m")


def test_reachable_no_models_when_answers_with_empty_model_list(monkeypatch):
    monkeypatch.setattr(pad, "get_private_ai_runtime_json", lambda: None)
    monkeypatch.setattr(pad, "_probe_version", lambda base_url: {"version": "0.33.3"})
    monkeypatch.setattr(pad, "_list_models", lambda base_url: [])

    result = pad.detect_local_ollama(refresh=True)
    assert result.status == "reachable_no_models"


def test_cache_returns_stale_result_until_refresh(monkeypatch):
    calls = {"n": 0}

    def _probe(base_url):
        calls["n"] += 1
        return None

    monkeypatch.setattr(pad, "get_private_ai_runtime_json", lambda: None)
    monkeypatch.setattr(pad, "_probe_version", _probe)

    pad.detect_local_ollama()
    pad.detect_local_ollama()  # within TTL — should reuse the cached result
    assert calls["n"] == 1

    pad.detect_local_ollama(refresh=True)  # explicit bypass
    assert calls["n"] == 2
