"""Standalone CLI: convert a Claude plugin/skill without any Hermes install.

    python -m skill_importer <path|git-url> [--category CAT] [--out DIR] [--json]

Without --out this is a pure preview (nothing written). With --out, each
converted skill is written as <out>/<category>/<slug>/SKILL.md plus its
support dirs — no security scan and no grant routing; use ``hermes skills
import`` for the governed paths.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

from .converter import convert_source


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        prog="skill_importer",
        description="Convert a Claude Code plugin/skill into Hermes skills.",
    )
    ap.add_argument("source", help="Local directory or git URL of the Claude plugin/skill")
    ap.add_argument("--category", default="", help="Override the category (default: plugin name)")
    ap.add_argument("--out", default="", help="Directory to write converted skills into (omit to preview)")
    ap.add_argument("--json", action="store_true", help="Print the machine-readable report only")
    args = ap.parse_args(argv)

    try:
        converted, report = convert_source(args.source, category=(args.category or None))
    except Exception as exc:
        if args.json:
            print(json.dumps({"error": str(exc)}))
        else:
            print(f"Import failed: {exc}", file=sys.stderr)
        return 1

    written = []
    if args.out:
        root = Path(args.out).expanduser().resolve()
        for c in converted:
            dest = root / c.category / c.slug
            dest.mkdir(parents=True, exist_ok=True)
            (dest / "SKILL.md").write_text(c.content, encoding="utf-8")
            if c.source_dir:
                for sub in c.support:
                    s = c.source_dir / sub
                    if s.is_dir():
                        shutil.copytree(s, dest / sub, dirs_exist_ok=True)
            written.append(str(dest))
        report["written"] = written

    if args.json:
        print(json.dumps(report, indent=2, default=str))
        return 0

    counts = report["counts"]
    print(f"{report['plugin']}: {counts['skills']} skills, {counts['commands']} commands, "
          f"{counts['agents']} agents ({counts['total']} total)")
    for item in report["items"]:
        print(f"  - [{item['kind']}] {item['name']} -> {item['category']}/{item['slug']}")
    for w in report["warnings"]:
        print(f"  ! {w}")
    if written:
        print(f"Written to {args.out}")
    else:
        print("Preview only — pass --out DIR to write, or use `hermes skills import`.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
