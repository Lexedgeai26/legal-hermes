"""Claude → Hermes skill/agent/command conversion core (single source of truth).

Converts a Claude Code plugin (``skills/``, ``commands/``, ``agents/``,
``.claude-plugin/plugin.json``, ``.mcp.json``) or a single-skill directory into
first-class Hermes skills, applying the format map + path + prose Claude-ism
rewrites from docs/claude-skill-import.md. Pure conversion — no installs and no
security scanning; hermes_cli/claude_import.py layers those on.
"""


from __future__ import annotations

import json
import re
import shutil
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Tuple

HOST_NAME = "LexEdge AI"

# ── tool translation: Claude tool -> Hermes toolset ──────────────────────────
TOOLSET_MAP = {
    "Read": "file", "Write": "file", "Edit": "file", "MultiEdit": "file",
    "Glob": "file", "Grep": "file", "LS": "file", "NotebookEdit": "file",
    "Bash": "terminal",
    "WebSearch": "web", "WebFetch": "web",
    "Task": "delegation", "TodoWrite": "todo",
}


@dataclass
class ConvertedSkill:
    name: str
    slug: str
    category: str
    description: str
    content: str               # full SKILL.md (frontmatter + body)
    source_dir: Optional[Path] = None   # for copying references/scripts/...
    resource_dir: Optional[Path] = None  # plugin root for ~/.hermes/skill-data/<plugin>
    support: List[str] = field(default_factory=list)
    files: List[dict] = field(default_factory=list)  # [{path, encoding, content}]
    requires_mcp: List[str] = field(default_factory=list)
    unknown_tools: List[str] = field(default_factory=list)
    rewrites: Dict[str, int] = field(default_factory=dict)
    kind: str = "skill"        # skill | command | agent


# ── bundled support files (scripts/references/templates/assets) ──────────────
_FILE_DIRS = ("scripts", "references", "templates", "assets")
_FILE_MAX = 512 * 1024          # 512 KB per file
_FILES_TOTAL_MAX = 4 * 1024 * 1024  # 4 MB per skill


def _gather_files(skill_dir: Path) -> List[dict]:
    """Read a skill's bundled support files as [{path, encoding, content}],
    relative to the skill dir, so they can travel with the SKILL.md. UTF-8 text
    inline; binary base64-encoded. Size-capped; vcs/cache dirs skipped."""
    import base64
    out: List[dict] = []
    total = 0
    for sub in _FILE_DIRS:
        base = skill_dir / sub
        if not base.is_dir():
            continue
        for p in sorted(base.rglob("*")):
            if not p.is_file() or any(part in {".git", "__pycache__", "node_modules"} for part in p.parts):
                continue
            try:
                raw = p.read_bytes()
            except OSError:
                continue
            if len(raw) > _FILE_MAX:
                continue
            try:
                content, enc = raw.decode("utf-8"), "utf-8"
            except UnicodeDecodeError:
                content, enc = base64.b64encode(raw).decode("ascii"), "base64"
            total += len(content)
            if total > _FILES_TOTAL_MAX:
                return out
            out.append({"path": str(p.relative_to(skill_dir)), "encoding": enc, "content": content})
    return out


# ── frontmatter ──────────────────────────────────────────────────────────────
def _parse_frontmatter(text: str) -> Tuple[dict, str]:
    if not text.startswith("---"):
        return {}, text
    end = text.find("\n---", 3)
    if end == -1:
        return {}, text
    fm_raw = text[3:end].strip()
    body = text[end + 4:].lstrip("\n")
    try:
        import yaml
        fm = yaml.safe_load(fm_raw) or {}
    except Exception:
        fm = {}
    if not isinstance(fm, dict):
        fm = {}
    return fm, body


# ── rewrites ─────────────────────────────────────────────────────────────────
def _rewrite_body(body: str, plugin: str) -> Tuple[str, Dict[str, int]]:
    counts: Dict[str, int] = {}

    def sub(pattern: str, repl: str, label: str, flags: int = 0) -> None:
        nonlocal body
        body, n = re.subn(pattern, repl, body, flags=flags)
        if n:
            counts[label] = counts.get(label, 0) + n

    # ── path rewrites (Claude plugin layout -> Hermes skill-data) ──
    sub(rf"~/\.claude/plugins/config/[\w-]+/{re.escape(plugin)}/",
        f"~/.hermes/skill-data/{plugin}/", "data-path")
    sub(rf"~/\.claude/plugins/cache/[\w-]+/{re.escape(plugin)}/",
        f"~/.hermes/skill-data/{plugin}/", "cache-path")
    sub(r"~/\.claude/plugins/(config|cache)/[\w-]+/",
        "~/.hermes/skill-data/", "data-path-parent")
    sub(r"\$\{CLAUDE_PLUGIN_ROOT\}", f"~/.hermes/skill-data/{plugin}", "plugin-root-var")
    sub(r"\$CLAUDE_PLUGIN_ROOT", f"~/.hermes/skill-data/{plugin}", "plugin-root-var")
    # Preserve /plugin:skill slash references. Imported names are namespaced as
    # plugin:skill so large plugin packs can keep duplicate short names.

    # ── prose Claude-isms -> host product (longest match first) ──
    sub(r"\bClaude\s+Cowork\b", HOST_NAME, "claudeism-coworking")
    sub(r"\bClaude\s+Code\b", HOST_NAME, "claudeism-code")
    sub(r"\bCowork\b", HOST_NAME, "claudeism-cowork")
    # standalone "Claude" (the assistant) — leave code identifiers/paths alone by
    # only matching the capitalised word in prose, not in `code` or URLs.
    sub(r"(?<![/\w.])Claude\b(?!\s*[_-])", HOST_NAME, "claudeism-claude")
    # QUICKSTART references (dangling Claude-Code docs)
    sub(r"\s*[—-]?\s*see\s+QUICKSTART\.md", "", "claudeism-quickstart-ref", re.IGNORECASE)
    sub(r"\bQUICKSTART\.md\b", "the setup guide", "claudeism-quickstart")
    # install-scope model -> workspace model
    sub(r"\breinstall user-scoped\b", "switch workspaces", "claudeism-scope")
    sub(r"\binstall user-scoped instead\b", "select a different workspace folder", "claudeism-scope")
    sub(r"\buser-scoped\b", "scoped to this workspace", "claudeism-scope")
    sub(r"\bproject-scoped\b", "scoped to this workspace", "claudeism-scope")
    # /mcp slash + "add the X MCP to your config"
    sub(r"`/mcp`", "the MCP settings", "claudeism-mcp")
    sub(r"\badd the (.+?) MCP to your config\b",
        r"enable the \1 MCP in your settings", "claudeism-mcp", re.IGNORECASE)

    return body, counts


def _translate_tools(tools) -> Tuple[List[str], List[str], List[str]]:
    toolsets, mcp, unknown = set(), [], []
    for t in tools or []:
        t = str(t).strip()
        if not t:
            continue
        if t in TOOLSET_MAP:
            toolsets.add(TOOLSET_MAP[t])
        elif t.startswith("mcp__"):
            parts = t.split("__")
            server = parts[1] if len(parts) > 1 else "*"
            if server == "*":
                unknown.append(t)  # ambiguous wildcard server
            elif server not in mcp:
                mcp.append(server)
        else:
            unknown.append(t)
    return sorted(toolsets), mcp, unknown


def _slugify(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", str(name).lower()).strip("-")
    return s or "skill"


def _namespace_name(plugin: str, name: str) -> str:
    name = str(name)
    return name if name.startswith(f"{plugin}:") else f"{plugin}:{name}"


def _tags_from(name: str, plugin: str) -> List[str]:
    base = [w for w in re.split(r"[-_]", name) if len(w) > 2][:4]
    return base + [plugin, "imported"]


def _emit_skill_md(*, name: str, description: str, version: str, hermes: dict, body: str) -> str:
    lines = ["---", f"name: {name}",
             f"description: {json.dumps(description, ensure_ascii=False)}",
             f"version: {version}",
             "platforms: [linux, macos, windows]", "metadata:", "  hermes:",
             f"    category: {hermes['category']}",
             f"    tags: [{', '.join(hermes['tags'])}]",
             f"    source: {hermes['source']}"]
    if hermes.get("argument_hint"):
        lines.append(f"    argument_hint: {json.dumps(hermes['argument_hint'], ensure_ascii=False)}")
    if hermes.get("claude_model"):
        lines.append(f"    claude_model: {hermes['claude_model']}")
    if hermes.get("requires_toolsets"):
        lines.append(f"    requires_toolsets: [{', '.join(hermes['requires_toolsets'])}]")
    if hermes.get("requires_mcp"):
        lines.append(f"    requires_mcp: [{', '.join(hermes['requires_mcp'])}]")
    lines.append("---")
    return "\n".join(lines) + "\n\n" + body


# ── converters ───────────────────────────────────────────────────────────────
def _convert_skill_dir(skill_dir: Path, plugin: str, category: str, plugin_root: Optional[Path] = None) -> ConvertedSkill:
    fm, body = _parse_frontmatter((skill_dir / "SKILL.md").read_text(encoding="utf-8"))
    raw_name = str(fm.get("name") or skill_dir.name)
    name = _namespace_name(plugin, raw_name)
    new_body, counts = _rewrite_body(body, plugin)
    hermes = {"category": category, "tags": _tags_from(name, plugin),
              "source": f"claude-plugin:{plugin}", "argument_hint": fm.get("argument-hint")}
    toolsets, mcp, unknown = _translate_tools(fm.get("allowed-tools") or fm.get("tools"))
    if toolsets:
        hermes["requires_toolsets"] = toolsets
    if mcp:
        hermes["requires_mcp"] = mcp
    content = _emit_skill_md(name=name, description=str(fm.get("description", "")).strip(),
                             version="1.0.0", hermes=hermes, body=new_body)
    support = [s for s in ("references", "scripts", "templates", "assets") if (skill_dir / s).is_dir()]
    return ConvertedSkill(name=name, slug=_slugify(name), category=category,
                          description=str(fm.get("description", "")).strip(), content=content,
                          source_dir=skill_dir, resource_dir=plugin_root, support=support, files=_gather_files(skill_dir),
                          requires_mcp=mcp, unknown_tools=unknown, rewrites=counts, kind="skill")


def _convert_command_md(cmd_md: Path, plugin: str, category: str, plugin_root: Optional[Path] = None) -> ConvertedSkill:
    fm, body = _parse_frontmatter(cmd_md.read_text(encoding="utf-8"))
    raw_name = str(fm.get("name") or cmd_md.stem)
    name = _namespace_name(plugin, raw_name)
    new_body, counts = _rewrite_body(body, plugin)
    hermes = {"category": category, "tags": _tags_from(name, plugin) + ["command"],
              "source": f"claude-command:{plugin}", "argument_hint": fm.get("argument-hint")}
    content = _emit_skill_md(name=name, description=str(fm.get("description", "")).strip(),
                             version="1.0.0", hermes=hermes, body=new_body)
    return ConvertedSkill(name=name, slug=_slugify(name), category=category,
                          description=str(fm.get("description", "")).strip(), content=content,
                          resource_dir=plugin_root, rewrites=counts, kind="command")


def _convert_agent_md(agent_md: Path, plugin: str, plugin_root: Optional[Path] = None) -> ConvertedSkill:
    fm, body = _parse_frontmatter(agent_md.read_text(encoding="utf-8"))
    raw_name = str(fm.get("name") or agent_md.stem)
    name = _namespace_name(plugin, f"agent:{raw_name}")
    toolsets, mcp, unknown = _translate_tools(fm.get("tools") or fm.get("allowed-tools"))
    new_body, counts = _rewrite_body(body, plugin)
    note = (f"> **Imported from a Claude subagent** (`{plugin}/agents/{agent_md.name}`). "
            f"Original model: `{fm.get('model', '?')}`. Runs as a {HOST_NAME} skill.\n\n")
    category = f"{plugin}-agents"
    hermes = {"category": category, "tags": _tags_from(name, plugin) + ["agent"],
              "source": f"claude-agent:{plugin}", "claude_model": fm.get("model"),
              "requires_toolsets": toolsets, "requires_mcp": mcp}
    content = _emit_skill_md(name=name,
                             description=str(fm.get("description", "")).strip().replace("\n", " "),
                             version="1.0.0", hermes=hermes, body=note + new_body)
    return ConvertedSkill(name=name, slug=_slugify(name), category=category,
                          description=str(fm.get("description", "")).strip().replace("\n", " "),
                          content=content, resource_dir=plugin_root, requires_mcp=mcp, unknown_tools=unknown,
                          rewrites=counts, kind="agent")


# ── classify + acquire ───────────────────────────────────────────────────────
def _is_git_url(src: str) -> bool:
    return src.startswith(("http://", "https://", "git@", "ssh://")) or src.endswith(".git")


def _acquire(src: str) -> Tuple[Path, Optional[Path]]:
    """Return (source_dir, tmp_to_cleanup_or_None)."""
    if _is_git_url(src):
        tmp = Path(tempfile.mkdtemp(prefix="hermes-claude-import-"))
        try:
            from hermes_cli.profile_distribution import _git_clone  # reuse
            _git_clone(src, tmp)
        except Exception:
            import subprocess
            subprocess.run(["git", "clone", "--depth", "1", src, str(tmp)], check=True)
        return tmp, tmp
    p = Path(src).expanduser().resolve()
    if not p.is_dir():
        raise ValueError(f"Source is not a directory or git URL: {src}")
    return p, None


def _discover(root: Path) -> Tuple[str, List[Path], List[Path], List[Path], dict]:
    """Return (plugin_name, skill_dirs, command_mds, agent_mds, plugin_json)."""
    plugin_json = {}
    pj = root / ".claude-plugin" / "plugin.json"
    if pj.is_file():
        try:
            plugin_json = json.loads(pj.read_text(encoding="utf-8"))
        except Exception:
            plugin_json = {}
    plugin = str(plugin_json.get("name") or root.name)

    skill_dirs, command_mds, agent_mds = [], [], []
    if (root / "skills").is_dir():
        skill_dirs = [d for d in sorted((root / "skills").glob("*/")) if (d / "SKILL.md").is_file()]
    if (root / "commands").is_dir():
        command_mds = sorted((root / "commands").glob("*.md"))
    if (root / "agents").is_dir():
        agent_mds = sorted((root / "agents").glob("*.md"))
    # Single-skill source (SKILL.md at root, no skills/ subdir).
    if not skill_dirs and not command_mds and not agent_mds and (root / "SKILL.md").is_file():
        skill_dirs = [root]
    return plugin, skill_dirs, command_mds, agent_mds, plugin_json


def convert_source(src: str, *, category: Optional[str] = None) -> Tuple[List[ConvertedSkill], dict]:
    """Convert a Claude source into ConvertedSkill objects + a report (no writes)."""
    root, cleanup = _acquire(src)
    try:
        plugin, skill_dirs, command_mds, agent_mds, pjson = _discover(root)
        cat = category or plugin
        converted: List[ConvertedSkill] = []
        for d in skill_dirs:
            converted.append(_convert_skill_dir(d, plugin, cat, root))
        for c in command_mds:
            converted.append(_convert_command_md(c, plugin, cat, root))
        for a in agent_mds:
            converted.append(_convert_agent_md(a, plugin, root))

        mcp_needed = sorted({m for c in converted for m in c.requires_mcp})
        unknown = sorted({t for c in converted for t in c.unknown_tools})
        report = {
            "plugin": plugin,
            "category": cat,
            "counts": {"skills": len(skill_dirs), "commands": len(command_mds),
                       "agents": len(agent_mds), "total": len(converted)},
            "rewrites_total": _sum_rewrites(converted),
            "mcp_servers_needed": mcp_needed,
            "unmapped_tools": unknown,
            "items": [{"name": c.name, "slug": c.slug, "kind": c.kind,
                       "category": c.category, "support": c.support,
                       "rewrites": c.rewrites, "requires_mcp": c.requires_mcp} for c in converted],
            "warnings": _warnings(converted, mcp_needed, unknown),
        }
        return converted, report
    finally:
        if cleanup:
            shutil.rmtree(cleanup, ignore_errors=True)


def _sum_rewrites(converted: List[ConvertedSkill]) -> Dict[str, int]:
    out: Dict[str, int] = {}
    for c in converted:
        for k, v in c.rewrites.items():
            out[k] = out.get(k, 0) + v
    return out


def _warnings(converted, mcp_needed, unknown) -> List[str]:
    w = []
    if mcp_needed:
        w.append(f"{len(mcp_needed)} MCP server(s) need granting + credentials: {', '.join(mcp_needed)}")
    if unknown:
        w.append(f"unmapped/ambiguous tools (left as-is, review): {', '.join(unknown)}")
    return w
