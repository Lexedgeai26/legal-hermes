"""skill_importer — standalone Claude → Hermes skill importer.

Independent, dependency-light package holding the ONE conversion core shared by:

  * ``hermes skills import`` (hermes_cli/claude_import.py)
  * the desktop app's Skills page (``POST /api/skills/import-claude``,
    hermes_cli/web_server.py)

It can also run on its own: ``python -m skill_importer <path|git-url> --out DIR``.
"""

from .converter import (  # noqa: F401
    HOST_NAME,
    TOOLSET_MAP,
    ConvertedSkill,
    convert_source,
)

__all__ = ["HOST_NAME", "TOOLSET_MAP", "ConvertedSkill", "convert_source"]
__version__ = "1.0.0"
