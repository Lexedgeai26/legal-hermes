"""Tests for the standalone skill_importer package (Claude → Hermes converter)."""

import json
import subprocess
import sys
from pathlib import Path

import pytest

from skill_importer import ConvertedSkill, convert_source


@pytest.fixture
def claude_plugin(tmp_path: Path) -> Path:
    """A minimal Claude Code plugin: one skill (with a script), one command,
    one agent."""
    root = tmp_path / "demo-plugin"
    (root / ".claude-plugin").mkdir(parents=True)
    (root / ".claude-plugin" / "plugin.json").write_text(
        json.dumps({"name": "demo-plugin", "version": "0.1.0"}))

    skill = root / "skills" / "hello-world"
    (skill / "scripts").mkdir(parents=True)
    (skill / "SKILL.md").write_text(
        "---\n"
        "name: hello-world\n"
        "description: Say hello\n"
        "allowed-tools: [Read, Bash, WebSearch, mcp__slack__send]\n"
        "---\n"
        "Use Claude Code to greet. Data in ${CLAUDE_PLUGIN_ROOT}/data.\n"
        "Run /demo-plugin:hello to start.\n")
    (skill / "scripts" / "hi.sh").write_text("echo hi\n")
    (root / "CLAUDE.md").write_text("# Plugin practice profile\n")
    (root / "references").mkdir()
    (root / "references" / "guide.md").write_text("Use this reference.\n")

    (root / "commands").mkdir()
    (root / "commands" / "greet.md").write_text(
        "---\ndescription: Greet command\n---\nGreet the user.\n")

    (root / "agents").mkdir()
    (root / "agents" / "helper.md").write_text(
        "---\nname: helper\ndescription: A helper\nmodel: sonnet\n"
        "tools: [Read, Grep]\n---\nHelp with tasks.\n")
    return root


def test_convert_plugin(claude_plugin: Path):
    converted, report = convert_source(str(claude_plugin))

    assert report["plugin"] == "demo-plugin"
    assert report["counts"] == {"skills": 1, "commands": 1, "agents": 1, "total": 3}
    assert report["mcp_servers_needed"] == ["slack"]
    assert all(isinstance(c, ConvertedSkill) for c in converted)

    skill = next(c for c in converted if c.kind == "skill")
    assert skill.name == "demo-plugin:hello-world"
    assert skill.slug == "demo-plugin-hello-world"
    # Claude tools translated to Hermes toolsets in emitted frontmatter.
    assert "requires_toolsets: [file, terminal, web]" in skill.content
    assert "requires_mcp: [slack]" in skill.content
    # Claude-isms rewritten in the body.
    assert "Claude Code" not in skill.content
    assert "${CLAUDE_PLUGIN_ROOT}" not in skill.content
    assert "~/.hermes/skill-data/demo-plugin" in skill.content
    assert "/demo-plugin:hello" in skill.content
    # Bundled script travels with the skill.
    assert skill.resource_dir == claude_plugin
    assert skill.files == [{"path": "scripts/hi.sh", "encoding": "utf-8", "content": "echo hi\n"}]

    command = next(c for c in converted if c.kind == "command")
    assert command.name == "demo-plugin:greet"
    assert command.slug == "demo-plugin-greet"
    assert "command" in command.content  # tagged as command

    agent = next(c for c in converted if c.kind == "agent")
    assert agent.name == "demo-plugin:agent:helper"
    assert agent.category == "demo-plugin-agents"
    assert "Imported from a Claude subagent" in agent.content


def test_convert_single_skill_dir(tmp_path: Path):
    (tmp_path / "SKILL.md").write_text(
        "---\nname: solo\ndescription: A single skill\n---\nBody.\n")
    converted, report = convert_source(str(tmp_path), category="custom")
    assert report["counts"]["total"] == 1
    assert converted[0].category == "custom"


def test_convert_rejects_bad_source(tmp_path: Path):
    with pytest.raises(ValueError):
        convert_source(str(tmp_path / "does-not-exist"))


def test_standalone_cli_writes_out(claude_plugin: Path, tmp_path: Path):
    out = tmp_path / "out"
    proc = subprocess.run(
        [sys.executable, "-m", "skill_importer", str(claude_plugin),
         "--out", str(out), "--json"],
        capture_output=True, text=True, cwd=str(Path(__file__).resolve().parents[1]))
    assert proc.returncode == 0, proc.stderr
    report = json.loads(proc.stdout)
    assert report["counts"]["total"] == 3
    dest = out / "demo-plugin" / "demo-plugin-hello-world"
    assert (dest / "SKILL.md").is_file()
    assert (dest / "scripts" / "hi.sh").is_file()


def test_hermes_cli_reexports_shared_core():
    from hermes_cli import claude_import
    from skill_importer import converter
    assert claude_import.convert_source is converter.convert_source
    assert claude_import.ConvertedSkill is converter.ConvertedSkill


def test_hermes_import_stages_plugin_root_resources(claude_plugin: Path, tmp_path: Path):
    from hermes_cli.claude_import import _copy_plugin_resources

    dest = tmp_path / "skill-data" / "demo-plugin"
    copied = _copy_plugin_resources(claude_plugin, dest)

    assert "CLAUDE.md" in copied
    assert "references/" in copied
    assert (dest / "CLAUDE.md").read_text() == "# Plugin practice profile\n"
    assert (dest / "references" / "guide.md").read_text() == "Use this reference.\n"
