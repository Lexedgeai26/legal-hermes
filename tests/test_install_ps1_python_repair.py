"""Regression: self-heal a corrupted uv-managed Python install.

Field-report shape: a Windows machine had the "python" bootstrap stage
permanently failing with the terse "Python 3.11 not available", on every
retry, forever. The underlying uv error looks like::

    uv python install error: error: Failed to inspect Python interpreter
    from managed installations at
    C:\\Users\\Admin\\AppData\\Roaming\\uv\\python\\cpython-3.11-windows-x86_64-none\\python.exe

uv's managed Python cache had a corrupt/partial entry (most likely left by an
earlier install attempt that was killed mid-write -- antivirus quarantine, a
cancelled/crashed installer run, a hard process kill). Once that happens,
EVERY `uv python find`/`install`/`list` call fails with this exact error
regardless of which version is requested, because uv enumerates its whole
managed-toolchain directory as part of each of those operations. Re-running
the installer re-runs the same broken check against the same broken cache
forever.

The fix detects the signature and deletes just the one broken interpreter's
directory so uv can reinstall cleanly, both proactively (before Test-Python
does anything) and as a fallback inside its own install-retry loop. These
tests lock that contract at the source level (the script only runs on
Windows, so there's no runner to execute it on Linux CI -- see the sibling
`test_install_ps1_native_stderr_eap.py` for the same pattern).
"""

from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
INSTALL_PS1 = REPO_ROOT / "scripts" / "install.ps1"

_CORRUPTION_SIGNATURE = "Failed to inspect Python interpreter from managed installations"


def _install_ps1() -> str:
    return INSTALL_PS1.read_text(encoding="utf-8")


def _function_body(source: str, name: str) -> str:
    """Return the text of a PowerShell ``function <name> { ... }`` block."""
    start = source.index(f"function {name}")
    brace = source.index("{", start)
    depth = 0
    for i in range(brace, len(source)):
        if source[i] == "{":
            depth += 1
        elif source[i] == "}":
            depth -= 1
            if depth == 0:
                return source[brace : i + 1]
    raise AssertionError(f"unterminated function body for {name}")


def test_repair_helpers_are_defined() -> None:
    text = _install_ps1()
    assert "function Remove-BrokenManagedPythonFromErrorText" in text, (
        "expected a helper that detects + removes a corrupted managed Python "
        "install from uv's error text"
    )
    assert "function Repair-BrokenManagedPython" in text, (
        "expected a proactive repair check that runs before Test-Python "
        "attempts anything"
    )


def test_repair_helper_matches_the_real_uv_error_signature() -> None:
    body = _function_body(_install_ps1(), "Remove-BrokenManagedPythonFromErrorText")
    assert _CORRUPTION_SIGNATURE in body, (
        "the detector must match uv's actual error text, not a paraphrase of it "
        "-- otherwise it silently never fires against the real error"
    )
    assert "Remove-Item" in body and "-Recurse" in body and "-Force" in body, (
        "must actually delete the broken directory, not just detect it"
    )


def test_repair_helper_strips_backticks_from_the_captured_path() -> None:
    """uv wraps the path in backticks in its real error text.

    The raw \\S+ capture includes a leading backtick (backtick isn't
    whitespace), which makes Test-Path return $false on an otherwise
    correctly-detected corruption -- silently defeating the whole repair.
    Confirmed against a real captured error string:
        "...managed installations at `C:\\...\\python.exe`"
    """
    body = _function_body(_install_ps1(), "Remove-BrokenManagedPythonFromErrorText")
    assert ".Trim(" in body and "`" in body, (
        "must strip backticks (uv's actual quoting) from the captured path "
        "before treating it as a filesystem path"
    )


def test_repair_helper_only_deletes_the_broken_directory_not_the_whole_cache() -> None:
    """Must scope the delete to the one broken entry's own directory.

    Nuking uv's entire managed-Python cache would also throw away other,
    perfectly good installed versions and force pointless re-downloads.
    """
    body = _function_body(_install_ps1(), "Remove-BrokenManagedPythonFromErrorText")
    assert "Split-Path" in body and "$Matches.exe" in body, (
        "must derive the directory to remove from the specific broken exe path "
        "captured out of uv's error text, not a hardcoded/broad cache root"
    )


def test_repair_check_is_offline_by_default() -> None:
    """The proactive probe must not add a network round-trip to every run."""
    body = _function_body(_install_ps1(), "Repair-BrokenManagedPython")
    assert "--only-installed" in body, (
        "Repair-BrokenManagedPython's `uv python list` probe must pass "
        "--only-installed so a healthy machine doesn't pay a network cost "
        "on every single install run just to check for corruption"
    )


def test_test_python_repairs_before_doing_anything_else() -> None:
    """Test-Python must run the proactive repair check before its own logic.

    Otherwise the corrupted entry poisons the very first `uv python find`
    call this function makes, before repair ever gets a chance to run.
    """
    body = _function_body(_install_ps1(), "Test-Python")
    repair_at = body.find("Repair-BrokenManagedPython")
    find_at = body.find("python find $PythonVersion")
    assert repair_at != -1, "Test-Python must call Repair-BrokenManagedPython"
    assert find_at != -1, "expected the initial `uv python find` probe"
    assert repair_at < find_at, (
        "Repair-BrokenManagedPython must run BEFORE the first `uv python find` "
        "call, so a pre-existing corrupted entry doesn't poison it"
    )


def test_test_python_also_self_heals_if_corruption_surfaces_during_install() -> None:
    """Belt-and-suspenders: also repair if the proactive probe missed it.

    uv's `install` subcommand enumerating managed installs is a separate code
    path from `list`; catching the same signature here too means a corruption
    that only manifests during install doesn't dead-end the whole stage.
    """
    body = _function_body(_install_ps1(), "Test-Python")
    assert body.count("Remove-BrokenManagedPythonFromErrorText") >= 2, (
        "expected Remove-BrokenManagedPythonFromErrorText to be consulted "
        "again around the `uv python install` call/catch (defense in depth "
        "beyond the upfront Repair-BrokenManagedPython probe)"
    )
