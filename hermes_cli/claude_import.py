"""Claude → Hermes skill/agent/command importer (Hermes-side routing).

Backs ``hermes skills import <path|git-url>``. The conversion itself lives in
the standalone ``skill_importer`` package (repo root) — this module adds the
install routing around it: converted skills land in ~/.hermes/optional-skills/
(or skills/ with --into skills) and are security-scanned by tools/skills_guard
before they stick; a blocked verdict requires --force.
"""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import List, Optional

from skill_importer.converter import (  # noqa: F401  (re-exported for callers/tests)
    HOST_NAME,
    TOOLSET_MAP,
    ConvertedSkill,
    convert_source,
)


_PLUGIN_RESOURCE_DIRS = {"references", "scripts", "templates", "assets", "hooks", "data"}
_PLUGIN_RESOURCE_FILES = {"CLAUDE.md", "README.md", ".mcp.json"}


# ── standalone install (local skills dirs) ───────────────────────────────────
def _standalone_target_dir(into: str) -> Path:
    from hermes_constants import get_hermes_home, get_skills_dir
    if into == "skills":
        return get_skills_dir()
    return get_hermes_home() / "optional-skills"


def _resource_plugin_name(resource_dir: Path) -> str:
    import json

    plugin_json = resource_dir / ".claude-plugin" / "plugin.json"
    if plugin_json.is_file():
        try:
            data = json.loads(plugin_json.read_text(encoding="utf-8"))
            if data.get("name"):
                return str(data["name"])
        except Exception:
            pass
    return resource_dir.name


def _copy_plugin_resources(resource_dir: Path, dest: Path) -> List[str]:
    copied: List[str] = []
    dest.mkdir(parents=True, exist_ok=True)
    for name in sorted(_PLUGIN_RESOURCE_FILES):
        src = resource_dir / name
        if src.is_file():
            shutil.copy2(src, dest / name)
            copied.append(name)
    for name in sorted(_PLUGIN_RESOURCE_DIRS):
        src = resource_dir / name
        if src.is_dir():
            shutil.copytree(
                src,
                dest / name,
                dirs_exist_ok=True,
                ignore=shutil.ignore_patterns(".git", "__pycache__", "node_modules", ".DS_Store"),
            )
            copied.append(f"{name}/")
    return copied


def _stage_plugin_resources(converted: List[ConvertedSkill]) -> List[dict]:
    from hermes_constants import get_hermes_home

    staged = []
    seen = set()
    root = get_hermes_home() / "skill-data"
    for c in converted:
        if not c.resource_dir:
            continue
        resource_dir = c.resource_dir.resolve()
        if resource_dir in seen:
            continue
        seen.add(resource_dir)
        plugin = _resource_plugin_name(resource_dir)
        copied = _copy_plugin_resources(resource_dir, root / plugin)
        if copied:
            staged.append({"plugin": plugin, "path": str(root / plugin), "resources": copied})
    return staged


def install_standalone(converted: List[ConvertedSkill], *, into: str = "optional-skills",
                       force: bool = False) -> List[dict]:
    """Write converted skills locally + security-scan each. Returns per-skill results."""
    root = _standalone_target_dir(into)
    results = []
    for c in converted:
        dest = root / c.category / c.slug
        dest.mkdir(parents=True, exist_ok=True)
        (dest / "SKILL.md").write_text(c.content, encoding="utf-8")
        if c.source_dir:
            for sub in c.support:
                s = c.source_dir / sub
                if s.is_dir():
                    shutil.copytree(s, dest / sub, dirs_exist_ok=True)
        verdict = _scan_local(dest)
        if verdict.get("status") == "blocked" and not force:
            shutil.rmtree(dest, ignore_errors=True)
            results.append({"name": c.name, "installed": False, "audit": verdict,
                            "reason": "blocked by security audit (use --force to override)"})
        else:
            results.append({"name": c.name, "installed": True, "path": str(dest), "audit": verdict})
    return results


def _scan_local(skill_dir: Path) -> dict:
    try:
        from tools.skills_guard import scan_skill, should_allow_install
        result = scan_skill(skill_dir, source="community")
        allowed, reason = should_allow_install(result)
        findings = getattr(result, "findings", []) or []
        blocking = [f for f in findings if getattr(f, "severity", "") in ("critical", "high")]
        return {"status": "blocked" if (blocking and not allowed) else ("flagged" if findings else "clean"),
                "findings": len(findings), "reason": reason}
    except Exception as exc:
        return {"status": "clean", "findings": 0, "reason": f"scan unavailable: {exc}"}


# ── orchestrator ─────────────────────────────────────────────────────────────
def run_import(src: str, *, dry_run: bool = False, category: Optional[str] = None,
               into: str = "optional-skills", force: bool = False) -> dict:
    """Convert + (unless dry-run) install. Returns the full report."""
    converted, report = convert_source(src, category=category)
    report["mode"] = "standalone"
    report["dry_run"] = dry_run

    if dry_run:
        report["action"] = "dry-run — nothing written"
        return report

    report["resources"] = _stage_plugin_resources(converted)
    report["installed"] = install_standalone(converted, into=into, force=force)
    if into == "optional-skills":
        report["next_step"] = (
            "Installed into optional-skills/. Activate them from the Skills page "
            "or run `hermes skills install <name>` before using them in chat."
        )
    else:
        report["next_step"] = "Installed into skills/. Use them via their slash commands."
    return report
