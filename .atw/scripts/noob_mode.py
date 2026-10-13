#!/usr/bin/env python3
"""
Switch noob mode (plain-language replies) for the current developer.

Usage:
    python3 noob_mode.py on        Turn it on, whatever the project default
    python3 noob_mode.py off       Turn it off, whatever the project default
    python3 noob_mode.py status    Show whether it is on, and whether that is
                                   this developer's setting or the project default

The switch is personal — see common/noob_mode.py.
"""

from __future__ import annotations

import sys

from common.config import get_project_mode
from common.noob_mode import is_noob_mode_on, noob_mode_choice, set_noob_mode
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
    if action == "status":
        # stdout stays the one-line answer; where it comes from goes to stderr.
        if noob_mode_choice(repo_root) is None:
            source = (
                f"project default (mode: {get_project_mode(repo_root)}), "
                "no personal setting"
            )
        else:
            source = "your own setting"
        print(f"Source: {source}", file=sys.stderr)


if __name__ == "__main__":
    main()
