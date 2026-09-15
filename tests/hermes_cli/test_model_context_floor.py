"""Tests for GET /api/model/context-floor.

Exists so the desktop app's sticky composer model pick (COMPOSER_MODEL_KEY
in apps/desktop/src/store/session.ts — deliberately never re-seeded from the
profile default once set) can be checked against Hermes Agent's context
floor at launch, instead of the user finding out only when a chat turn
raises "context window ... is below the minimum 64,000 required by Hermes
Agent" (agent/agent_init.py). See private_ai.rs's MINIMUM_CONTEXT_TOKENS for
the installer-side counterpart that motivated this — a Private AI install
provisioned under the old dev catalogue (qwen2.5:0.5b at 8192 tokens) leaves
that model sticky in localStorage forever across an upgrade unless something
proactively catches it.
"""

from __future__ import annotations

import pytest

pytest.importorskip("starlette.testclient")
from starlette.testclient import TestClient

from hermes_cli import web_server


@pytest.fixture
def client():
    previous_auth_required = getattr(web_server.app.state, "auth_required", None)
    web_server.app.state.auth_required = False
    test_client = TestClient(web_server.app)
    test_client.headers[web_server._SESSION_HEADER_NAME] = web_server._SESSION_TOKEN
    try:
        yield test_client
    finally:
        if previous_auth_required is None:
            try:
                delattr(web_server.app.state, "auth_required")
            except AttributeError:
                pass
        else:
            web_server.app.state.auth_required = previous_auth_required


def test_missing_params_are_rejected(client):
    response = client.get("/api/model/context-floor", params={"provider": "private-ai-local"})
    assert response.status_code == 422  # FastAPI: model is a required query param

    response = client.get("/api/model/context-floor", params={"model": "llama3.1:8b"})
    assert response.status_code == 422


def test_below_floor_model_is_flagged(monkeypatch):
    monkeypatch.setattr(
        "agent.model_metadata.get_model_context_length",
        lambda **_kwargs: 8192,
    )
    previous_auth_required = getattr(web_server.app.state, "auth_required", None)
    web_server.app.state.auth_required = False
    test_client = TestClient(web_server.app)
    test_client.headers[web_server._SESSION_HEADER_NAME] = web_server._SESSION_TOKEN
    try:
        response = test_client.get(
            "/api/model/context-floor",
            params={"provider": "private-ai-local", "model": "qwen2.5:0.5b"},
        )
    finally:
        if previous_auth_required is None:
            try:
                delattr(web_server.app.state, "auth_required")
            except AttributeError:
                pass
        else:
            web_server.app.state.auth_required = previous_auth_required

    assert response.status_code == 200
    body = response.json()
    assert body["context_length"] == 8192
    assert body["minimum_required"] == 64_000
    assert body["below_floor"] is True


def test_above_floor_model_is_not_flagged(monkeypatch, client):
    monkeypatch.setattr(
        "agent.model_metadata.get_model_context_length",
        lambda **_kwargs: 131_072,
    )

    response = client.get(
        "/api/model/context-floor",
        params={"provider": "private-ai-local", "model": "llama3.1:8b"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["context_length"] == 131_072
    assert body["below_floor"] is False


def test_probe_failure_never_reads_as_below_floor(monkeypatch, client):
    # A transient failure (runtime briefly down, model renamed) is NOT the
    # same claim as "below floor" — that would force a reseed the user
    # didn't ask for based on nothing but a probe hiccup.
    def _boom(**_kwargs):
        raise RuntimeError("runtime unreachable")

    monkeypatch.setattr("agent.model_metadata.get_model_context_length", _boom)

    response = client.get(
        "/api/model/context-floor",
        params={"provider": "private-ai-local", "model": "llama3.1:8b"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["below_floor"] is False
    assert body["context_length"] == 0


def test_private_ai_local_resolves_base_url_from_runtime_detection(monkeypatch, client):
    # The frontend has no reliable way to know the managed runtime's port
    # (dynamic per machine), so private-ai-local must resolve it server-side
    # rather than trust a caller-supplied value — there isn't one to trust
    # here, since the endpoint doesn't even accept a base_url param.
    captured = {}

    class _Result:
        base_url = "http://127.0.0.1:59999"

    monkeypatch.setattr(
        "hermes_cli.private_ai_detect.detect_local_ollama",
        lambda **_kwargs: _Result(),
    )

    def _fake_context_length(**kwargs):
        captured.update(kwargs)
        return 131_072

    monkeypatch.setattr("agent.model_metadata.get_model_context_length", _fake_context_length)

    response = client.get(
        "/api/model/context-floor",
        params={"provider": "private-ai-local", "model": "llama3.1:8b"},
    )

    assert response.status_code == 200
    assert captured["base_url"] == "http://127.0.0.1:59999"


def test_non_private_ai_provider_skips_base_url_resolution(monkeypatch, client):
    detect_calls = []
    monkeypatch.setattr(
        "hermes_cli.private_ai_detect.detect_local_ollama",
        lambda **_kwargs: detect_calls.append(1) or None,
    )
    monkeypatch.setattr(
        "agent.model_metadata.get_model_context_length",
        lambda **_kwargs: 200_000,
    )

    response = client.get(
        "/api/model/context-floor",
        params={"provider": "anthropic", "model": "claude-opus-5"},
    )

    assert response.status_code == 200
    assert detect_calls == []
