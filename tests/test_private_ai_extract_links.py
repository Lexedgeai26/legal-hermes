"""Extraction of the Private AI runtime archive.

The macOS Ollama tarball ships dylib version chains
(libggml.dylib -> libggml.0.dylib -> libggml.0.22.0.dylib). Refusing every
symlink outright made Private AI impossible to install on macOS: setup stopped
with "Refusing to extract a symlink from the runtime archive."

Links are now materialised as plain copies of the regular file they name inside
the archive, so nothing outside the destination can ever be reached and no link
primitive is created — the protections that matter are kept while a legitimate
archive installs.
"""
from __future__ import annotations

import io
import os
import tarfile
import zipfile
from pathlib import Path

import pytest

from hermes_cli.private_ai_provision import (
    ProvisionError,
    _extract_tar_gz,
    _extract_zip,
    _resolve_link,
)


def _tar(path: Path, entries) -> None:
    with tarfile.open(path, "w:gz") as tf:
        for name, kind, payload in entries:
            info = tarfile.TarInfo(name)
            if kind == "file":
                data = payload.encode()
                info.size = len(data)
                info.mode = 0o644
                tf.addfile(info, io.BytesIO(data))
            elif kind == "sym":
                info.type = tarfile.SYMTYPE
                info.linkname = payload
                tf.addfile(info)
            elif kind == "dir":
                info.type = tarfile.DIRTYPE
                info.mode = 0o755
                tf.addfile(info)


def test_dylib_chain_is_materialised(tmp_path: Path) -> None:
    """The exact shape that blocked macOS installs."""
    archive = tmp_path / "runtime.tgz"
    _tar(archive, [
        ("lib/libggml.0.22.0.dylib", "file", "REAL"),
        ("lib/libggml.0.dylib", "sym", "libggml.0.22.0.dylib"),
        ("lib/libggml.dylib", "sym", "libggml.0.dylib"),
        ("ollama", "file", "BINARY"),
    ])
    dest = tmp_path / "out"
    _extract_tar_gz(archive, dest)

    # Every link resolves to the real file's contents, as a plain copy.
    for name in ("libggml.0.22.0.dylib", "libggml.0.dylib", "libggml.dylib"):
        f = dest / "lib" / name
        assert f.is_file(), f"{name} missing"
        assert not f.is_symlink(), f"{name} should be a copy, not a link"
        assert f.read_text() == "REAL"
    assert (dest / "ollama").read_text() == "BINARY"


def test_link_escaping_the_archive_is_refused(tmp_path: Path) -> None:
    archive = tmp_path / "evil.tgz"
    _tar(archive, [("bin/x", "sym", "../../../../etc/passwd")])
    with pytest.raises(ProvisionError, match="outside"):
        _extract_tar_gz(archive, tmp_path / "out")


def test_absolute_link_target_is_refused(tmp_path: Path) -> None:
    archive = tmp_path / "evil.tgz"
    _tar(archive, [("bin/x", "sym", "/etc/passwd")])
    with pytest.raises(ProvisionError, match="absolute link target"):
        _extract_tar_gz(archive, tmp_path / "out")


def test_link_to_a_file_not_in_the_archive_is_refused(tmp_path: Path) -> None:
    """A link naming something we never extracted must not resolve to the host."""
    archive = tmp_path / "evil.tgz"
    _tar(archive, [("bin/x", "sym", "definitely-not-here.so")])
    with pytest.raises(ProvisionError, match="did not provide"):
        _extract_tar_gz(archive, tmp_path / "out")


def test_link_cycle_does_not_hang(tmp_path: Path) -> None:
    archive = tmp_path / "loop.tgz"
    _tar(archive, [("a", "sym", "b"), ("b", "sym", "a")])
    with pytest.raises(ProvisionError, match="deeply chained"):
        _extract_tar_gz(archive, tmp_path / "out")


def test_path_traversal_member_is_still_refused(tmp_path: Path) -> None:
    """The pre-existing protection must survive the link change."""
    archive = tmp_path / "evil.tgz"
    _tar(archive, [("../escape.txt", "file", "nope")])
    with pytest.raises(ProvisionError, match="traversal"):
        _extract_tar_gz(archive, tmp_path / "out")


def test_zip_symlink_is_materialised(tmp_path: Path) -> None:
    archive = tmp_path / "runtime.zip"
    with zipfile.ZipFile(archive, "w") as zf:
        zf.writestr("lib/real.dll", "REAL")
        info = zipfile.ZipInfo("lib/link.dll")
        info.external_attr = (0o120777 << 16)  # S_IFLNK
        zf.writestr(info, "real.dll")
    dest = tmp_path / "out"
    _extract_zip(archive, dest)
    assert (dest / "lib" / "link.dll").read_text() == "REAL"
    assert not (dest / "lib" / "link.dll").is_symlink()


@pytest.mark.parametrize(
    ("link", "target", "expected"),
    [
        ("lib/a.dylib", "b.dylib", "lib/b.dylib"),
        ("lib/x/a.dylib", "../b.dylib", "lib/b.dylib"),
        ("a", "./b", "b"),
    ],
)
def test_resolve_link_paths(link: str, target: str, expected: str) -> None:
    assert _resolve_link(link, target) == expected
