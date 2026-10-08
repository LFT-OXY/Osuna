#!/usr/bin/env python3
"""
Switch noob mode (plain-language replies) for the current developer.

Usage:
    python3 noob_mode.py on        Turn it on
    python3 noob_mode.py off       Turn it off
    python3 noob_mode.py status    Show whether it is on

The switch is personal — see common/noob_mode.py.
"""

from __future__ import annotations

import sys

from common.noob_mode import is_noob_mode_on, set_noob_mode
from common.paths import DIR_SCRIPTS, DIR_WORKFLOW, FILE_DEVELOPER, get_repo_root


def main() -> None:
    """CLI entry point."""
    action = sys.argv[1] if len(sys.argv) > 1 else "status"
    if action not in ("on", "off", "status"):
        print(f"Usage: {sys.argv[0]} on|off|status", file=sys.stderr)
        sys.exit(1)

    repo_root = get_repo_root()
    if action != "status" and not set_noob_mode(repo_root, action == "on"):
        print(
            f"Error: no {DIR_WORKFLOW}/{FILE_DEVELOPER} to record noob mode in. "
            f"Run: python3 ./{DIR_WORKFLOW}/{DIR_SCRIPTS}/init_developer.py <name>",
            file=sys.stderr,
        )
        sys.exit(1)

    print(f"Noob mode: {'on' if is_noob_mode_on(repo_root) else 'off'}")


if __name__ == "__main__":
    main()
