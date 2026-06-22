"""Local-first matter workspace metadata.

Matter files stay in the lawyer-selected folder.  This module stores only
profile-local metadata and a lightweight file index under HERMES_HOME/matters.
"""

from __future__ import annotations

import json
import os
import re
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from hermes_constants import get_hermes_home, secure_parent_dir
from utils import atomic_replace

ALLOWED_EXTENSIONS = {
    ".csv",
    ".doc",
    ".docx",
    ".jpeg",
    ".jpg",
    ".md",
    ".pdf",
    ".png",
    ".ppt",
    ".pptx",
    ".rtf",
    ".txt",
    ".xls",
    ".xlsx",
}

SKIP_DIR_NAMES = {
    ".git",
    ".hg",
    ".svn",
    ".venv",
    "__pycache__",
    "Library",
    "Applications",
    "node_modules",
}

MAX_INDEX_FILES = 500
MAX_INDEX_DEPTH = 4


@dataclass
class MatterFile:
    path: str
    name: str
    extension: str
    size: int
    modified_at: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "path": self.path,
            "name": self.name,
            "extension": self.extension,
            "size": self.size,
            "modified_at": self.modified_at,
        }


@dataclass
class MatterRecord:
    id: str
    name: str
    folder_path: str
    client_name: str = ""
    matter_type: str = "general"
    court_or_authority: str = ""
    role: str = ""
    status: str = "active"
    notes: str = ""
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    indexed_at: float | None = None
    file_count: int = 0
    skipped_count: int = 0
    files: list[MatterFile] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "folder_path": self.folder_path,
            "client_name": self.client_name,
            "matter_type": self.matter_type,
            "court_or_authority": self.court_or_authority,
            "role": self.role,
            "status": self.status,
            "notes": self.notes,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "indexed_at": self.indexed_at,
            "file_count": self.file_count,
            "skipped_count": self.skipped_count,
            "files": [item.to_dict() for item in self.files],
        }


def matters_dir() -> Path:
    return get_hermes_home() / "matters"


def matters_path() -> Path:
    return matters_dir() / "matters.json"


def _slug(value: str) -> str:
    text = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return text[:48] or "matter"


def _record_from_dict(raw: dict[str, Any]) -> MatterRecord:
    files = []
    for item in raw.get("files") or []:
        if isinstance(item, dict):
            files.append(
                MatterFile(
                    path=str(item.get("path") or ""),
                    name=str(item.get("name") or ""),
                    extension=str(item.get("extension") or ""),
                    size=int(item.get("size") or 0),
                    modified_at=float(item.get("modified_at") or 0),
                )
            )
    return MatterRecord(
        id=str(raw.get("id") or ""),
        name=str(raw.get("name") or ""),
        folder_path=str(raw.get("folder_path") or ""),
        client_name=str(raw.get("client_name") or ""),
        matter_type=str(raw.get("matter_type") or "general"),
        court_or_authority=str(raw.get("court_or_authority") or ""),
        role=str(raw.get("role") or ""),
        status=str(raw.get("status") or "active"),
        notes=str(raw.get("notes") or ""),
        created_at=float(raw.get("created_at") or time.time()),
        updated_at=float(raw.get("updated_at") or time.time()),
        indexed_at=float(raw["indexed_at"]) if raw.get("indexed_at") is not None else None,
        file_count=int(raw.get("file_count") or len(files)),
        skipped_count=int(raw.get("skipped_count") or 0),
        files=files,
    )


def load_matters() -> list[MatterRecord]:
    path = matters_path()
    if not path.exists():
        return []
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []
    items = raw.get("matters") if isinstance(raw, dict) else raw
    if not isinstance(items, list):
        return []
    return [_record_from_dict(item) for item in items if isinstance(item, dict)]


def save_matters(matters: list[MatterRecord]) -> None:
    path = matters_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    secure_parent_dir(path)
    payload = {
        "version": 1,
        "updated_at": time.time(),
        "matters": [item.to_dict() for item in matters],
    }
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    atomic_replace(tmp, path)


def create_matter(data: dict[str, Any]) -> MatterRecord:
    name = str(data.get("name") or "").strip()
    folder_path = str(data.get("folder_path") or "").strip()
    if not name:
        raise ValueError("Matter name is required")
    if not folder_path:
        raise ValueError("Matter folder is required")
    folder = Path(folder_path).expanduser().resolve()
    if not folder.exists() or not folder.is_dir():
        raise ValueError("Matter folder must be an existing folder")
    now = time.time()
    matter = MatterRecord(
        id=f"{_slug(name)}-{uuid.uuid4().hex[:8]}",
        name=name,
        folder_path=str(folder),
        client_name=str(data.get("client_name") or "").strip(),
        matter_type=str(data.get("matter_type") or "general").strip() or "general",
        court_or_authority=str(data.get("court_or_authority") or "").strip(),
        role=str(data.get("role") or "").strip(),
        notes=str(data.get("notes") or "").strip(),
        created_at=now,
        updated_at=now,
    )
    matters = load_matters()
    matters.insert(0, matter)
    save_matters(matters)
    return matter


def update_matter(matter_id: str, data: dict[str, Any]) -> MatterRecord:
    matters = load_matters()
    for matter in matters:
        if matter.id != matter_id:
            continue
        for key in ("name", "client_name", "matter_type", "court_or_authority", "role", "status", "notes"):
            if key in data:
                setattr(matter, key, str(data.get(key) or "").strip())
        if "folder_path" in data:
            folder = Path(str(data.get("folder_path") or "")).expanduser().resolve()
            if not folder.exists() or not folder.is_dir():
                raise ValueError("Matter folder must be an existing folder")
            matter.folder_path = str(folder)
            matter.files = []
            matter.file_count = 0
            matter.skipped_count = 0
            matter.indexed_at = None
        matter.updated_at = time.time()
        save_matters(matters)
        return matter
    raise KeyError(matter_id)


def delete_matter(matter_id: str) -> None:
    matters = load_matters()
    next_matters = [matter for matter in matters if matter.id != matter_id]
    if len(next_matters) == len(matters):
        raise KeyError(matter_id)
    save_matters(next_matters)


def get_matter(matter_id: str) -> MatterRecord:
    for matter in load_matters():
        if matter.id == matter_id:
            return matter
    raise KeyError(matter_id)


def _scan_files(root: Path) -> tuple[list[MatterFile], int]:
    files: list[MatterFile] = []
    skipped = 0
    root = root.resolve()
    for current, dirs, names in os.walk(root):
        current_path = Path(current)
        depth = len(current_path.relative_to(root).parts)
        dirs[:] = [
            item
            for item in dirs
            if item not in SKIP_DIR_NAMES and not item.startswith(".") and depth < MAX_INDEX_DEPTH
        ]
        for name in names:
            if len(files) >= MAX_INDEX_FILES:
                skipped += 1
                continue
            if name.startswith("."):
                skipped += 1
                continue
            path = current_path / name
            ext = path.suffix.lower()
            if ext not in ALLOWED_EXTENSIONS:
                skipped += 1
                continue
            try:
                stat_result = path.stat()
            except OSError:
                skipped += 1
                continue
            files.append(
                MatterFile(
                    path=str(path),
                    name=name,
                    extension=ext.lstrip("."),
                    size=int(stat_result.st_size),
                    modified_at=float(stat_result.st_mtime),
                )
            )
    files.sort(key=lambda item: (item.extension, item.name.lower()))
    return files, skipped


def index_matter(matter_id: str) -> MatterRecord:
    matters = load_matters()
    for matter in matters:
        if matter.id != matter_id:
            continue
        root = Path(matter.folder_path).expanduser().resolve()
        if not root.exists() or not root.is_dir():
            raise ValueError("Matter folder is no longer available")
        files, skipped = _scan_files(root)
        matter.files = files
        matter.file_count = len(files)
        matter.skipped_count = skipped
        matter.indexed_at = time.time()
        matter.updated_at = matter.indexed_at
        save_matters(matters)
        return matter
    raise KeyError(matter_id)

