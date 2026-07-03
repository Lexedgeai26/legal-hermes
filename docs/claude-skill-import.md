# Importing Claude Skills into LexEdge — Full Guide

LexEdge can import **any Claude Code skill, command, subagent, or plugin** and
turn it into a first-class LexEdge skill. This guide covers the whole feature:
what it does, how to use it from the desktop app, the CLI, and as a standalone
tool, what happens during conversion, the security checks, and troubleshooting.

There is a huge ecosystem of Claude Code skills on GitHub (any repo with a
`SKILL.md` or a `.claude-plugin/` layout). With this importer you can bring any
of them into LexEdge in under a minute.

---

## 1. What can be imported

A "source" is either a **local folder** or a **git URL** (`https://…`,
`git@…`, or anything ending in `.git`). The importer understands three layouts:

| Source layout | What it is | What LexEdge does with it |
|---|---|---|
| `skills/<name>/SKILL.md` (+ optional `scripts/`, `references/`, `templates/`, `assets/`) | A Claude plugin's skills | Each becomes a LexEdge skill, with its support files copied alongside |
| `commands/<name>.md` | Claude slash commands | Each becomes a LexEdge skill tagged `command` |
| `agents/<name>.md` | Claude subagents | Each becomes a LexEdge skill tagged `agent`, with a provenance note and the original model recorded |
| `SKILL.md` at the repo/folder root | A single standalone skill | Imported as one skill |

If the source has a `.claude-plugin/plugin.json`, its `name` is used as the
plugin name and default category; otherwise the folder name is used.

---

## 2. Using it from the desktop app (recommended)

1. Open **Skills** in the sidebar.
2. Click **Import Claude skills** (top right of the skills list).
3. Paste the git link or folder path, e.g.
   `https://github.com/anthropics/skills.git` or `/Users/you/my-skill`.
   Optionally set a **Category** (otherwise the plugin name is used).
4. Click **Preview**. Nothing is written yet — you'll see exactly what the
   source contains: how many skills/commands/agents, their names, and any
   external services (MCP servers) they would need.
5. Click **Import**. Each item is converted, **security-scanned**, and
   installed. The dialog tells you in plain language what was added and what
   was kept out (and why).
6. Imported items land in `optional-skills/` by default. Turn them on from the
   Skills page before using them in chat, or use the CLI with `--into skills`
   when you want them active immediately.

You can press **Cancel** at any point before Import — previews never change
anything.

## 3. Using it from the CLI

```bash
# Preview only — convert + report, write nothing
hermes skills import https://github.com/someone/plugin.git --dry-run

# Import (default target: ~/.hermes/optional-skills/)
hermes skills import https://github.com/someone/plugin.git

# Import a local folder into the active skills pool instead
hermes skills import ~/Downloads/my-skill --into skills

# Choose the category shown on the Skills page
hermes skills import ./plugin --category legal-research

# Machine-readable output (used by the desktop app; also handy for scripts)
hermes skills import ./plugin --dry-run --json

# Override a security-audit block (only if you trust the source!)
hermes skills import ./plugin --force
```

| Flag | Meaning |
|---|---|
| `--dry-run` | Convert and report only; nothing is written |
| `--into skills\|optional-skills` | Install target (default `optional-skills`) |
| `--category <name>` | Category for the imported skills (default: plugin name) |
| `--force` | Install even if the security audit flags high-risk patterns |
| `--json` | Print only the JSON report (exit code 1 + `{"error": …}` on failure) |

Skills imported into `optional-skills/` are opt-in; activate them like any
other optional skill (`hermes skills install <name>`) or use `--into skills`
to make them active straight away.

## 4. Using the converter standalone (no LexEdge needed)

The conversion engine is an independent package at [`skill_importer/`](../skill_importer/)
with no LexEdge dependencies — useful for testing a source or converting in CI:

```bash
python -m skill_importer <path|git-url>                  # preview to stdout
python -m skill_importer <path|git-url> --out ./skills   # write converted skills
python -m skill_importer <path|git-url> --json           # JSON report
```

Note: the standalone module does **not** run the security scan or install into
LexEdge — it is pure conversion. Use `hermes skills import` for the governed
path.

---

## 5. What conversion actually does

The importer doesn't just copy files — it translates Claude conventions to
LexEdge ones and reports every rewrite it makes:

**Frontmatter.** Claude's `SKILL.md` frontmatter is re-emitted in LexEdge's
format: `name`, `description`, `version`, `platforms`, and a
`metadata.hermes` block with `category`, `tags` (derived from the name +
plugin, plus `imported`), and `source` provenance
(`claude-plugin:<name>` / `claude-command:<name>` / `claude-agent:<name>`).

**Tools → toolsets.** Claude's `allowed-tools` / `tools` lists are mapped to
LexEdge toolsets and recorded as `requires_toolsets`:

| Claude tool | LexEdge toolset |
|---|---|
| `Read`, `Write`, `Edit`, `MultiEdit`, `Glob`, `Grep`, `LS`, `NotebookEdit` | `file` |
| `Bash` | `terminal` |
| `WebSearch`, `WebFetch` | `web` |
| `Task` | `delegation` |
| `TodoWrite` | `todo` |
| `mcp__<server>__<tool>` | recorded in `requires_mcp: [<server>]` |

Tools that can't be mapped are left as-is and listed under
`unmapped_tools` in the report so you can review them.

**Path & prose rewrites.** Inside the skill body:
- `${CLAUDE_PLUGIN_ROOT}` and `~/.claude/plugins/...` paths →
  `~/.hermes/skill-data/<plugin>/`
- Cross-skill references `/plugin:cmd` are preserved. Imported skill names are
  namespaced as `plugin:skill` so large legal packs can include duplicate short
  names such as `customize` or `matter-workspace` without collisions.
- "Claude Code" / "Claude" in prose → **LexEdge AI** (code identifiers, URLs,
  and paths are left alone)
- Claude-specific instructions (QUICKSTART.md references, user-/project-scoped
  install language, `/mcp` mentions) → LexEdge equivalents

Every rewrite is counted per skill in the report (`rewrites`), so nothing
happens silently.

**Bundled files.** `scripts/`, `references/`, `templates/`, and `assets/`
travel with each skill (up to 512 KB per file / 4 MB per skill; VCS and cache
directories are skipped).

**Agents.** A converted subagent gets a note at the top of its body recording
where it came from and which model it originally targeted. It lands in its own
`<plugin>-agents` category and is named `plugin:agent:name` so it cannot collide
with a normal skill of the same name.

## 6. Security: every import is scanned

Before an imported skill sticks, it is scanned by LexEdge's skills guard
(`tools/skills_guard`) as a **community** source:

- **Clean** — installed normally.
- **Flagged** — installed, findings noted in the result.
- **Blocked** (critical/high findings) — the skill is **removed** and reported
  as blocked. Use `--force` (CLI) only when you trust the source; the desktop
  app intentionally keeps blocked skills out and explains why.

MCP servers a skill needs (`requires_mcp`) are surfaced in the preview and the
result — they are *not* installed or granted automatically; set them up in
Settings if you want the skill's full functionality.

## 7. What to expect in the report

Both `--json` and the desktop dialog surface the same report:

```json
{
  "plugin": "demo-plugin",
  "category": "demo-plugin",
  "counts": {"skills": 1, "commands": 1, "agents": 1, "total": 3},
  "rewrites_total": {"claudeism-code": 1, "plugin-root-var": 1},
  "mcp_servers_needed": ["slack"],
  "unmapped_tools": [],
  "items": [{"name": "hello-world", "slug": "hello-world", "kind": "skill", "...": "..."}],
  "warnings": ["1 MCP server(s) need granting + credentials: slack"],
  "dry_run": false,
  "installed": [{"name": "hello-world", "installed": true, "path": "...", "audit": {"status": "clean"}}],
  "next_step": "Installed into optional-skills/. Activate them from the Skills page or run `hermes skills install <name>` before using them in chat."
}
```

## 8. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| "Source is not a directory or git URL" | The path doesn't exist or the URL isn't recognised — check for typos; git URLs must start with `http(s)://`, `git@`, `ssh://` or end in `.git` |
| Import hangs then times out | Git clone can't reach the host (network/VPN) or the repo is huge — try cloning manually and importing the local folder |
| "0 items" converted | The source has no `skills/`, `commands/`, `agents/`, or root `SKILL.md` — it isn't a Claude skill layout |
| Skill blocked by security audit | The scan found critical/high-risk patterns (e.g. credential access, destructive commands). Review the source; import with `--force` only if you trust it |
| Imported skill doesn't appear in chat | It went to `optional-skills/` — activate it, or re-import with `--into skills`; then reload skills (restart the session) |
| Skill mentions a service that doesn't work | Check `mcp_servers_needed` in the report and connect that MCP server in Settings |

## 9. Where things live (for developers)

| Piece | Location |
|---|---|
| Conversion core (pure, standalone) | [`skill_importer/converter.py`](../skill_importer/converter.py) — see the package [README](../skill_importer/README.md) |
| CLI routing (install + security scan) | [`hermes_cli/claude_import.py`](../hermes_cli/claude_import.py) |
| CLI command wiring | `hermes_cli/subcommands/skills.py` (parser) + `hermes_cli/main.py` (`_cmd_skills_import`) |
| Desktop API endpoint | `POST /api/skills/import-claude` in [`hermes_cli/web_server.py`](../hermes_cli/web_server.py) (runs the CLI with `--json` in a profile-aware subprocess) |
| Desktop UI | `apps/desktop/src/app/skills/import-claude-dialog.tsx` (+ `importClaudeSkills` in `apps/desktop/src/hermes.ts`) |
| Tests | [`tests/test_skill_importer.py`](../tests/test_skill_importer.py) |

Conversion rules live only in `skill_importer/converter.py` — change them
there, and the CLI, desktop endpoint, and standalone module all pick them up.
