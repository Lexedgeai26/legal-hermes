"""Cancelling Private AI provisioning.

Setup downloads several gigabytes. Before this there was no way to stop it:
QA reported Cancel doing nothing on both 8 GB and 16 GB machines, and the only
escape was quitting the application mid-install.

A cancel is the user's decision, not a failure, so it raises ProvisionCancelled
and is reported as cancelled rather than as an error.
"""
from __future__ import annotations

import pytest

from hermes_cli import private_ai_provision as pap
from hermes_cli.private_ai_provision import (
    ProvisionCancelled,
    ProvisionError,
    _check_cancelled,
    _never_cancelled,
)


def test_cancellation_is_an_error_subclass_but_distinguishable() -> None:
    """Callers that only catch ProvisionError still clean up, while callers
    that care can tell a user's decision from a fault."""
    assert issubclass(ProvisionCancelled, ProvisionError)
    with pytest.raises(ProvisionCancelled):
        _check_cancelled(lambda: True)


def test_no_cancel_requested_is_a_no_op() -> None:
    _check_cancelled(_never_cancelled)  # must not raise


def test_model_pull_stops_when_cancelled(monkeypatch: pytest.MonkeyPatch) -> None:
    """The pull loop is the second-longest stage, so it must check too."""
    calls: list[str] = []

    def fake_progress(stage: str, detail: str, percent):
        calls.append(stage)

    with pytest.raises(ProvisionCancelled):
        pap.pull_default_models("http://127.0.0.1:1", fake_progress, lambda: True)

    # Cancelled before any network call was attempted.
    assert calls == []


def test_download_aborts_and_leaves_no_partial_file(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    """A cancelled download must not leave a .part file behind to be mistaken
    for a resumable state."""
    import httpx

    class _Resp:
        status_code = 200

        def iter_bytes(self, chunk_size=0):
            yield b"x" * 1024
            yield b"x" * 1024

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    class _Client:
        def __init__(self, *a, **k):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def stream(self, *a, **k):
            return _Resp()

    monkeypatch.setattr(httpx, "Client", _Client)

    with pytest.raises(ProvisionCancelled):
        pap._download_verified(
            "https://example.test/runtime.tgz",
            "0" * 64,
            2048,
            tmp_path,
            lambda *a: None,
            lambda: True,
        )

    assert list(tmp_path.glob("*.part")) == [], "a cancelled download left a partial file"


def test_download_completes_when_not_cancelled(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    """The cancel check must not break the ordinary path."""
    import hashlib

    import httpx

    payload = b"hello runtime"
    digest = hashlib.sha256(payload).hexdigest()

    class _Resp:
        status_code = 200

        def iter_bytes(self, chunk_size=0):
            yield payload

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    class _Client:
        def __init__(self, *a, **k):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def stream(self, *a, **k):
            return _Resp()

    monkeypatch.setattr(httpx, "Client", _Client)

    out = pap._download_verified(
        "https://example.test/runtime.tgz", digest, len(payload), tmp_path, lambda *a: None
    )
    assert out.read_bytes() == payload
    assert list(tmp_path.glob("*.part")) == []
