"""Tests for web_server._autostart_private_ai_runtime.

The managed Ollama child is already scoped to the backend process (Windows
Job Object + atexit hook in private_ai_provision.start_managed_runtime), but
nothing ever restarted it: it came up only via an explicit "Set up Private
AI"/"Start" click, both of which live in Settings and the onboarding wizard.
So a fully installed Private AI stayed down across reboots and backend
restarts, and the model picker rendered a bare "No models found".

The guarantee under test is the narrowness of the autostart, not just that
it runs: it must fire for ``unreachable_configured`` (runtime.json already
points at an extracted executable the user installed, and the start path
never downloads) and for nothing else — above all never for ``not_setup``,
where "start" would mean a surprise multi-GB provision.
"""

from __future__ import annotations

import pytest

from hermes_cli import private_ai_detect as pad
from hermes_cli import web_server


def _result(status: str, base_url=None):
    return pad.DetectionResult(status=status, base_url=base_url)


@pytest.fixture
def calls(monkeypatch):
    """Record start_existing_runtime invocations without spawning anything."""
    recorded: list[str] = []

    def _fake_start():
        recorded.append("started")
        return pad.DetectionResult(status="connected", base_url="http://127.0.0.1:11434")

    monkeypatch.setattr(
        "hermes_cli.private_ai_provision.start_existing_runtime", _fake_start, raising=False
    )
    return recorded


def _patch_detect(monkeypatch, status: str):
    monkeypatch.setattr(
        "hermes_cli.private_ai_detect.detect_local_ollama",
        lambda **_kwargs: _result(status),
        raising=False,
    )


def test_starts_when_installed_but_stopped(monkeypatch, calls):
    _patch_detect(monkeypatch, "unreachable_configured")

    web_server._autostart_private_ai_runtime()

    assert calls == ["started"]


@pytest.mark.parametrize("status", ["not_setup", "connected", "reachable_no_models"])
def test_never_starts_for_any_other_state(monkeypatch, calls, status):
    # not_setup is the load-bearing case: starting there would mean
    # provisioning, i.e. a multi-GB download nobody asked for.
    _patch_detect(monkeypatch, status)

    web_server._autostart_private_ai_runtime()

    assert calls == []


def test_detection_failure_is_swallowed(monkeypatch, calls):
    def _boom(**_kwargs):
        raise RuntimeError("probe exploded")

    monkeypatch.setattr("hermes_cli.private_ai_detect.detect_local_ollama", _boom, raising=False)

    # A backend that can't probe Ollama must still serve every other route.
    web_server._autostart_private_ai_runtime()

    assert calls == []


def test_start_failure_is_swallowed(monkeypatch):
    _patch_detect(monkeypatch, "unreachable_configured")

    def _boom():
        # e.g. losing the port race against another backend on the same
        # HERMES_HOME — the loser must not take the process down with it.
        raise RuntimeError("bind: address already in use")

    monkeypatch.setattr(
        "hermes_cli.private_ai_provision.start_existing_runtime", _boom, raising=False
    )

    web_server._autostart_private_ai_runtime()
