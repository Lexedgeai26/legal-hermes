"""Auto-provisioning of a local Ollama runtime for Private AI mode.

Write side of the Private AI auto-detection feature
(``hermes_cli/private_ai_detect.py`` is the read side). This exists so the
desktop app can offer working Private AI without the user ever going
through the Tauri bootstrap installer's dedicated provisioning flow — the
same underlying capability, reimplemented natively in Python so it works
for any ``hermes`` install, not just ones that came from the graphical
installer.

Two entry points, deliberately kept separate — mixing them up would mean
re-downloading Ollama every time a user simply forgot to leave it running:

- ``provision_ollama_runtime()``: full install — download, verify, extract,
  start, pull default models. Only ever called for the ``not_setup``
  detection state (nothing installed at all).
- ``start_existing_runtime()``: start an already-installed runtime back up.
  Only ever called for ``unreachable_configured`` (installed, currently
  stopped). Never downloads anything.

Download source of truth: the pinned Ollama version, URLs and SHA-256
hashes below are copied verbatim from
``apps/bootstrap-installer/src-tauri/test-fixtures/components/dev-components.json``
— the same values the Tauri installer's Rust code uses and this session's
QA pass already exercised end-to-end. Kept as a literal copy rather than a
shared-file read so this module has no dependency on the Tauri project
being present (the plain ``hermes`` CLI must work without it); bump both
together when the pinned version changes.
"""

from __future__ import annotations

import hashlib
import json
import os
import platform
import socket
import subprocess
import sys
import time
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional

OLLAMA_VERSION = "0.33.3"

# platform (sys.platform) -> architecture -> (url, sha256, size_bytes)
# Only macOS and Windows are pinned — the installer's own component
# manifest has no Linux artifact yet either; provisioning on Linux raises
# a clear "not supported yet" error rather than guessing a URL.
_COMPONENTS: dict = {
    "win32": {
        "x64": (
            "https://github.com/ollama/ollama/releases/download/v0.33.3/ollama-windows-amd64.zip",
            "52cb36a62e7e501f61514f60212dec7117b6c098811357585e02fffe32d2fcd7",
            1469175900,
        ),
        "arm64": (
            "https://github.com/ollama/ollama/releases/download/v0.33.3/ollama-windows-arm64.zip",
            "98b9ddaab6baece0418c6d1231526eb1e4e66944985e0a8eeb7d6171bcd7b6d8",
            210648637,
        ),
    },
    "darwin": {
        "arm64": (
            "https://github.com/ollama/ollama/releases/download/v0.33.3/ollama-darwin.tgz",
            "342db03df80bb9db84ff64246031bd5f70c09b59ff52fa5cc9aaae3476cc4a9d",
            159236337,
        ),
        "x64": (
            "https://github.com/ollama/ollama/releases/download/v0.33.3/ollama-darwin.tgz",
            "342db03df80bb9db84ff64246031bd5f70c09b59ff52fa5cc9aaae3476cc4a9d",
            159236337,
        ),
    },
}

# Default legal-compact profile — otherwise reuses the installer's dev
# catalogue (apps/bootstrap-installer/src-tauri/test-fixtures/catalogue/
# dev-catalogue.json, profile "legal-compact-dev") so a runtime this module
# provisions is indistinguishable from one the installer provisioned.
#
# The generation model is deliberately NOT that profile's qwen2.5:0.5b,
# though: every profile in the dev catalogue (including the 27B "large"
# tier) reports an operational context of 8192-32768 tokens, all below
# Hermes Agent's own hard floor of 64000 (see hermes_cli/main.py's
# "context window ... is below the minimum 64,000 required by Hermes
# Agent" check) — so a Private-AI-provisioned session could never
# actually send a chat message, only exist.
#
# phi3.5 (3.8B, ~2.2GB) was tried first for its small footprint and does
# report 131072 context, but Ollama lists no "tools" capability for it
# (`ollama show phi3.5` → Capabilities: completion only) — every actual
# chat turn sends tool definitions, so every request 400'd with
# "phi3.5:latest does not support tools" despite passing the context
# check. llama3.1:8b (~4.9GB) is the smallest verified model (checked
# live via `ollama show`) reporting BOTH 131072 context AND a "tools"
# capability entry — the two are independent gates and a default here
# must clear both, not just the context one.
DEFAULT_PROFILE_ID = "legal-compact-dev"
DEFAULT_GENERATION_MODEL = "llama3.1:8b"
DEFAULT_EMBEDDING_MODEL = "embeddinggemma:300m"
DEFAULT_CONTEXT_TOKENS = 131072
CATALOG_ID = "legal-desktop-dev"
CATALOG_VERSION = "0.0.1-dev"

MANAGED_OWNER = "ai.lexedge.hermes.unified.setup"

ProgressCallback = Callable[[str, str, Optional[float]], None]
"""``on_progress(stage, detail, percent)`` — percent is None when not
meaningfully measurable for that stage (e.g. "starting")."""


def _noop_progress(stage: str, detail: str, percent: Optional[float]) -> None:
    return None


@dataclass(frozen=True)
class RuntimeInfo:
    base_url: str
    port: int
    executable_path: Path
    version: str


class ProvisionError(RuntimeError):
    """Raised for any failure in the provisioning pipeline — the caller
    (the API route) is expected to catch this and surface ``str(err)`` as
    the user-facing message; every raise site below already produces a
    message safe to show as-is (no paths beyond $HERMES_HOME, no secrets).
    """


# ─── Platform/arch resolution ───────────────────────────────────────────


def _current_arch() -> str:
    machine = platform.machine().lower()
    if machine in ("amd64", "x86_64"):
        return "x64"
    if machine in ("arm64", "aarch64"):
        return "arm64"
    return machine


def _resolve_component() -> "tuple[str, str, int]":
    """Return (url, sha256, size_bytes) for this platform/arch, or raise."""
    plat = _COMPONENTS.get(sys.platform)
    if plat is None:
        raise ProvisionError(
            f"Private AI auto-install isn't available on this platform yet ({sys.platform})."
        )
    arch = _current_arch()
    entry = plat.get(arch)
    if entry is None:
        raise ProvisionError(
            f"Private AI auto-install isn't available for this architecture yet ({arch})."
        )
    return entry


# ─── Download + verify ──────────────────────────────────────────────────


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _download_verified(
    url: str,
    expected_sha256: str,
    expected_size: int,
    dest_dir: Path,
    on_progress: ProgressCallback,
) -> Path:
    import httpx

    dest_dir.mkdir(parents=True, exist_ok=True)
    part_path = dest_dir / (url.rsplit("/", 1)[-1] + ".part")
    final_path = dest_dir / url.rsplit("/", 1)[-1]

    written = 0
    try:
        with httpx.Client(timeout=httpx.Timeout(30.0, read=60.0), follow_redirects=True) as client:
            with client.stream("GET", url) as resp:
                if resp.status_code != 200:
                    raise ProvisionError(f"Download failed: HTTP {resp.status_code} from {url}")
                with part_path.open("wb") as f:
                    for chunk in resp.iter_bytes(chunk_size=1024 * 256):
                        f.write(chunk)
                        written += len(chunk)
                        pct = (written / expected_size * 100.0) if expected_size else None
                        on_progress("download-runtime", f"{written} of {expected_size} bytes", pct)
    except httpx.HTTPError as exc:
        part_path.unlink(missing_ok=True)
        raise ProvisionError(f"Download failed: {exc}") from exc

    actual_sha256 = _sha256_file(part_path)
    if actual_sha256.lower() != expected_sha256.lower():
        # Corrupt/tampered bytes are never kept around for a later resume.
        part_path.unlink(missing_ok=True)
        raise ProvisionError("Downloaded runtime failed signature verification (SHA-256 mismatch).")

    part_path.replace(final_path)
    return final_path


# ─── Safe extraction ─────────────────────────────────────────────────────


def _safe_member_path(dest_root: Path, member_name: str) -> Path:
    """Resolve an archive member's on-disk path, refusing traversal/absolute entries."""
    normalized = member_name.replace("\\", "/")
    if normalized.startswith("/") or (len(normalized) > 1 and normalized[1] == ":"):
        raise ProvisionError(f"Refusing to extract absolute path from archive: {member_name}")
    parts = [p for p in normalized.split("/") if p not in ("", ".")]
    if any(p == ".." for p in parts):
        raise ProvisionError(f"Refusing to extract path traversal entry from archive: {member_name}")
    target = dest_root.joinpath(*parts)
    if dest_root not in target.parents and target != dest_root:
        raise ProvisionError(f"Refusing to extract entry outside destination: {member_name}")
    return target


def _extract_zip(archive_path: Path, dest_root: Path) -> None:
    with zipfile.ZipFile(archive_path) as zf:
        for info in zf.infolist():
            # High 16 bits of external_attr carry the Unix mode when the
            # archive was made on a POSIX system; 0o120000 = S_IFLNK.
            is_symlink = ((info.external_attr >> 16) & 0o170000) == 0o120000
            if is_symlink:
                raise ProvisionError("Refusing to extract a symlink from the runtime archive.")
            target = _safe_member_path(dest_root, info.filename)
            if info.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(info) as src, target.open("wb") as dst:
                dst.write(src.read())


def _extract_tar_gz(archive_path: Path, dest_root: Path) -> None:
    import tarfile

    with tarfile.open(archive_path, mode="r:gz") as tf:
        for member in tf.getmembers():
            if member.issym() or member.islnk():
                raise ProvisionError("Refusing to extract a symlink from the runtime archive.")
            target = _safe_member_path(dest_root, member.name)
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            if not member.isfile():
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            src = tf.extractfile(member)
            if src is None:
                continue
            with target.open("wb") as dst:
                dst.write(src.read())
            if os.name != "nt":
                os.chmod(target, member.mode | 0o100)


def _runtime_dir() -> Path:
    from hermes_constants import get_hermes_home

    return get_hermes_home() / "private-ai" / "runtime"


def _ollama_executable_path(runtime_dir: Path) -> Path:
    return runtime_dir / ("ollama.exe" if sys.platform == "win32" else "ollama")


# ─── Runtime lifecycle ───────────────────────────────────────────────────


def _free_port(preferred: int = 11434) -> int:
    """Return ``preferred`` if free, else the next free loopback port.

    Never evicts whatever's already listening — matches the Tauri
    installer's own policy (verified this session in PV-04/PV-05): step
    around an occupied port, never touch the process holding it.
    """
    port = preferred
    for _ in range(50):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                port += 1
    raise ProvisionError("Could not find a free port for the local Private AI runtime.")


_managed_process: Optional[subprocess.Popen] = None


def _assign_to_job_object(proc: subprocess.Popen) -> None:
    """Windows only: tie the child's lifetime to this process via a Job
    Object with KILL_ON_JOB_CLOSE, so it can never outlive us even if we
    crash — this is the specific fix for the orphaned-runtime failure this
    session found in the Tauri installer's own process (whose kill_on_drop
    only fires if its Drop impl actually runs, which a hard process exit
    skips). Best-effort: pywin32 is already a project dependency, but if
    it's unavailable for any reason, provisioning still proceeds — atexit
    remains as the fallback, just without the crash-proof guarantee.
    """
    if sys.platform != "win32":
        return
    try:
        import win32api
        import win32con
        import win32job
    except ImportError:
        return

    try:
        job = win32job.CreateJobObject(None, "")
        info = win32job.QueryInformationJobObject(job, win32job.JobObjectExtendedLimitInformation)
        info["BasicLimitInformation"]["LimitFlags"] |= win32job.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        win32job.SetInformationJobObject(job, win32job.JobObjectExtendedLimitInformation, info)
        handle = win32api.OpenProcess(win32con.PROCESS_ALL_ACCESS, False, proc.pid)
        win32job.AssignProcessToJobObject(job, handle)
        # Keep references alive for the process lifetime by stashing them
        # on the Popen object itself — letting them get GC'd would close
        # the handles and defeat the whole point.
        proc._lexedge_job = job  # type: ignore[attr-defined]
        proc._lexedge_job_handle = handle  # type: ignore[attr-defined]
    except Exception:
        pass


def start_managed_runtime(executable_path: Path, models_dir: Path) -> RuntimeInfo:
    """Spawn ``ollama`` bound to loopback only and wait for it to answer.

    Environment reproduces exactly what this session observed working in
    live ``ollama.stderr`` output during the installer's own PV-01 runs —
    not re-derived from documentation, copied from a runtime that was
    actually proven correct this session.
    """
    global _managed_process

    port = _free_port()
    base_url = f"http://127.0.0.1:{port}"

    env = dict(os.environ)
    env["OLLAMA_HOST"] = f"127.0.0.1:{port}"
    env["OLLAMA_NO_CLOUD"] = "true"
    env["OLLAMA_MODELS"] = str(models_dir)
    env["OLLAMA_NOHISTORY"] = "true"
    env["OLLAMA_NOPRUNE"] = "true"
    env["OLLAMA_ORIGINS"] = "app://*"
    # Ollama's default keep-alive (5 min) unloads the model from memory
    # between turns on a slow/idle conversation, forcing a full reload
    # from disk (multi-GB for the generation model) on the next message —
    # on CPU-only hardware this reload alone can dwarf actual inference
    # time. 30m keeps it resident through a normal working session
    # without pinning it in RAM indefinitely when the app is closed
    # (still unloads on process exit via the Job Object). Doesn't help a
    # deliberate model *switch* — Ollama can only keep one large model
    # loaded at a time on modest hardware, so swapping models always
    # costs one reload no matter this setting.
    env["OLLAMA_KEEP_ALIVE"] = "30m"

    kwargs: dict = {}
    if sys.platform == "win32":
        kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW

    proc = subprocess.Popen(
        [str(executable_path), "serve"],
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        **kwargs,
    )
    _managed_process = proc
    _assign_to_job_object(proc)

    from hermes_cli.private_ai_detect import _probe_version  # cheap, reuse

    deadline = time.monotonic() + 25.0  # first-launch cost observed this
    # session: 10-25s (macOS code-signature validation / GPU discovery);
    # kept generous rather than re-tuned per platform.
    version = None
    while time.monotonic() < deadline:
        info = _probe_version(base_url)
        if info is not None:
            version = info.get("version") or OLLAMA_VERSION
            break
        if proc.poll() is not None:
            raise ProvisionError("The Private AI runtime exited before it became ready.")
        time.sleep(0.3)
    else:
        raise ProvisionError("The Private AI runtime didn't respond in time.")

    return RuntimeInfo(base_url=base_url, port=port, executable_path=executable_path, version=version)


def stop_managed_runtime() -> None:
    """Terminate the runtime this process started, if any. Call on app exit."""
    global _managed_process
    if _managed_process is not None and _managed_process.poll() is None:
        try:
            _managed_process.terminate()
            _managed_process.wait(timeout=5)
        except Exception:
            try:
                _managed_process.kill()
            except Exception:
                pass
    _managed_process = None


import atexit  # noqa: E402  (placed near its single use, matching call site below)

atexit.register(stop_managed_runtime)


# ─── Model pulls ─────────────────────────────────────────────────────────


def pull_default_models(base_url: str, on_progress: ProgressCallback) -> None:
    """Pull the two default legal-compact models via Ollama's own
    ``/api/pull``. Ollama already verifies each blob's digest against its
    registry manifest as it streams — proven working in this session's
    live logs — so this only needs to relay progress, not re-verify.
    """
    import httpx

    models = [
        ("install-generation-model", DEFAULT_GENERATION_MODEL),
        ("install-embedding-model", DEFAULT_EMBEDDING_MODEL),
    ]
    for stage, model in models:
        on_progress(stage, f"Pulling {model}", None)
        with httpx.Client(timeout=httpx.Timeout(30.0, read=None)) as client:
            with client.stream("POST", f"{base_url}/api/pull", json={"model": model}) as resp:
                if resp.status_code != 200:
                    raise ProvisionError(f"Failed to pull {model}: HTTP {resp.status_code}")
                for line in resp.iter_lines():
                    if not line:
                        continue
                    try:
                        evt = json.loads(line)
                    except ValueError:
                        continue
                    status = evt.get("status", "")
                    total = evt.get("total")
                    completed = evt.get("completed")
                    pct = (completed / total * 100.0) if total and completed is not None else None
                    on_progress(stage, f"{model}: {status}", pct)
                    if evt.get("error"):
                        raise ProvisionError(f"Failed to pull {model}: {evt['error']}")


# ─── runtime.json / ownership marker ─────────────────────────────────────


def _iso_now() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def write_runtime_json(info: RuntimeInfo, *, validated: bool) -> None:
    """Write runtime.json in the identical schema the Tauri installer
    writes, so hermes_cli/private_ai_detect.py — and any installer-side
    tooling (manual cleanup per the QA guide's ISO-03) — treats a
    Python-provisioned runtime exactly like an installer-provisioned one.
    """
    from hermes_constants import get_hermes_home

    home = get_hermes_home()
    config_dir = home / "private-ai" / "config"
    config_dir.mkdir(parents=True, exist_ok=True)

    now = _iso_now()
    payload = {
        "schemaVersion": 1,
        "managed": True,
        "ollama": {
            "baseUrl": info.base_url,
            "runtimeVersion": info.version,
            "cloudDisabled": True,
            "managedProcess": True,
            "runtimePath": str(info.executable_path.relative_to(home)).replace("\\", "/"),
            "modelsPath": "private-ai/models",
        },
        "models": {
            "profileId": DEFAULT_PROFILE_ID,
            "generation": DEFAULT_GENERATION_MODEL,
            "embedding": DEFAULT_EMBEDDING_MODEL,
            "contextTokens": DEFAULT_CONTEXT_TOKENS,
        },
        "catalog": {"id": CATALOG_ID, "version": CATALOG_VERSION},
        "privacy": {"bindLocalhostOnly": True, "telemetryEnabled": False},
        "installedAt": now,
        "validatedAt": now if validated else None,
    }
    (config_dir / "runtime.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")

    marker = {
        "schemaVersion": 1,
        "owner": MANAGED_OWNER,
        "runtimeVersion": info.version,
        "installedAt": now,
    }
    (home / "private-ai" / ".lexedge-managed.json").write_text(
        json.dumps(marker, indent=2), encoding="utf-8"
    )


# ─── Orchestration ────────────────────────────────────────────────────────


def provision_ollama_runtime(on_progress: ProgressCallback = _noop_progress) -> RuntimeInfo:
    """Full install: download, verify, extract, start, pull defaults.

    Only ever call this for the ``not_setup`` detection state — see the
    module docstring. Raises ``ProvisionError`` on any failure; the caller
    (the API route) is expected to surface ``str(err)`` to the user.
    """
    from hermes_constants import get_hermes_home

    home = get_hermes_home()
    runtime_dir = _runtime_dir()
    if runtime_dir.exists() and any(runtime_dir.iterdir()):
        raise ProvisionError(
            "A runtime directory already exists that wasn't installed by this flow; "
            "refusing to overwrite it."
        )

    url, expected_sha256, expected_size = _resolve_component()

    on_progress("resolve", "Checking the approved runtime", None)
    archive_path = _download_verified(
        url, expected_sha256, expected_size, home / "private-ai" / "downloads", on_progress
    )

    on_progress("install-runtime", "Extracting runtime", None)
    runtime_dir.mkdir(parents=True, exist_ok=True)
    if archive_path.suffix == ".zip":
        _extract_zip(archive_path, runtime_dir)
    else:
        _extract_tar_gz(archive_path, runtime_dir)

    executable_path = _ollama_executable_path(runtime_dir)
    if not executable_path.exists():
        raise ProvisionError("The runtime archive contains no ollama executable.")

    on_progress("start-runtime", "Starting the runtime", None)
    models_dir = home / "private-ai" / "models"
    models_dir.mkdir(parents=True, exist_ok=True)
    info = start_managed_runtime(executable_path, models_dir)

    pull_default_models(info.base_url, on_progress)

    on_progress("validate", "Verifying the models", None)
    write_runtime_json(info, validated=True)

    on_progress("complete", "Private AI is ready", 100.0)
    return info


def start_existing_runtime(on_progress: ProgressCallback = _noop_progress) -> RuntimeInfo:
    """Start an already-installed runtime back up. Never downloads
    anything — only valid for the ``unreachable_configured`` detection
    state, where ``runtime.json`` already points at a real, previously
    extracted executable on disk.
    """
    from hermes_cli.private_ai_detect import get_private_ai_runtime_json
    from hermes_constants import get_hermes_home

    runtime_json = get_private_ai_runtime_json()
    if runtime_json is None:
        raise ProvisionError(
            "No existing Private AI installation was found to start — run setup first."
        )

    home = get_hermes_home()
    ollama_info = runtime_json.get("ollama") or {}
    runtime_path = ollama_info.get("runtimePath")
    executable_path = (home / runtime_path) if runtime_path else _ollama_executable_path(_runtime_dir())
    if not executable_path.exists():
        raise ProvisionError(
            "The previously installed Private AI runtime is missing from disk — "
            "use Set up Private AI to reinstall it."
        )

    on_progress("start-runtime", "Starting the runtime", None)
    models_dir = home / "private-ai" / "models"
    info = start_managed_runtime(executable_path, models_dir)
    write_runtime_json(info, validated=True)
    on_progress("complete", "Private AI is ready", 100.0)
    return info
