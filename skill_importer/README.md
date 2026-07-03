# skill_importer

Standalone Claude → Hermes skill importer: converts any Claude Code plugin or
skill (local directory or git URL) into first-class Hermes skills. This package
is the **single source of truth** for the conversion rules.

## What it converts

| Claude source | Becomes |
|---|---|
| `skills/*/SKILL.md` (+ `scripts/`, `references/`, `templates/`, `assets/`) | Hermes skill with bundled support files |
| `commands/*.md` | Hermes skill tagged `command` |
| `agents/*.md` | Hermes skill tagged `agent` (with provenance note) |
| `allowed-tools` / `tools` frontmatter | `requires_toolsets` / `requires_mcp` via the toolset map |
| Claude-isms (paths, `${CLAUDE_PLUGIN_ROOT}`, "Claude Code" prose, `/plugin:cmd` refs) | LexEdge equivalents (counted in the report) |

Conversion is **pure** — no installing or security scanning here. Consumers
layer that on:

- **`hermes skills import <src>`** — CLI ([hermes_cli/claude_import.py](../hermes_cli/claude_import.py)):
  installs to `~/.hermes/optional-skills/` (or `skills/` with `--into skills`)
  after a local security scan via tools/skills_guard; a blocked verdict
  requires `--force`.
- **Desktop app** — Skills page → *Import Claude skills* → `POST /api/skills/import-claude`
  ([hermes_cli/web_server.py](../hermes_cli/web_server.py)), which runs the CLI path.

## Standalone use

```bash
python -m skill_importer <path|git-url>                 # preview
python -m skill_importer <path|git-url> --out ./skills  # write conversions
python -m skill_importer <path|git-url> --json          # machine-readable report
```
