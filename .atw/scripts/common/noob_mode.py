"""Noob mode — a per-developer switch for plain-language replies.

A non-technical user turns it on once (the `atw-noob-mode` skill runs
`noob_mode.py on`). From then on the hooks that already speak to the AI at
session start and on every turn append a short reminder, so the mode holds
across long conversations, compaction and new sessions instead of fading the
way a skill loaded once does.

The switch is a `noob_mode=on` line in `.atw/.developer`. That file is
gitignored and personal by design, so one developer's choice never reaches a
teammate, and no new ignore rule is needed in existing projects.

The reminder text itself lives in workflow.md, in a
`[workflow-state:noob_mode]` block next to the per-status breadcrumbs — the
JS/TS hook ports already parse those blocks, so every platform reads one copy.
"""

from __future__ import annotations

import re
from pathlib import Path

from .git import main_worktree_root
from .paths import DIR_WORKFLOW, FILE_DEVELOPER

FIELD = "noob_mode"
BREADCRUMB_TAG = "noob_mode"

# Used when workflow.md has no noob_mode block (a custom workflow template, or
# a workflow.md older than this feature): the mode still has to take effect.
FALLBACK_REMINDER = (
    "Noob mode is ON — this user is not an engineer. Hold to the "
    "`/atw-noob-mode` rules in every reply: plain words in the user's "
    "language, and every term, command or path explained where it appears."
)

_FIELD_RE = re.compile(rf"^{FIELD}=(.*)$", re.MULTILINE)
_TAG_RE = re.compile(
    rf"\[workflow-state:{BREADCRUMB_TAG}\]\s*\n(.*?)\n\s*\[/workflow-state:{BREADCRUMB_TAG}\]",
    re.DOTALL,
)


def _developer_file(repo_root: Path) -> Path | None:
    """The identity file this checkout uses, following get_developer():
    its own, else the main checkout's when this is a linked worktree."""
    local = repo_root / DIR_WORKFLOW / FILE_DEVELOPER
    if local.is_file():
        return local
    main_root = main_worktree_root(repo_root)
    if main_root is None:
        return None
    inherited = main_root / DIR_WORKFLOW / FILE_DEVELOPER
    return inherited if inherited.is_file() else None


def is_noob_mode_on(repo_root: Path) -> bool:
    dev_file = _developer_file(repo_root)
    if dev_file is None:
        return False
    try:
        match = _FIELD_RE.search(dev_file.read_text(encoding="utf-8"))
    except OSError:
        return False
    return match is not None and match.group(1).strip() == "on"


def set_noob_mode(repo_root: Path, on: bool) -> bool:
    """Switch noob mode for this developer.

    Returns False when there is no identity file to record it in (run
    init_developer.py first); the file's other lines are left as they are.
    """
    dev_file = _developer_file(repo_root)
    if dev_file is None:
        return False
    lines = [
        line
        for line in dev_file.read_text(encoding="utf-8").splitlines()
        if not line.startswith(f"{FIELD}=")
    ]
    if on:
        lines.append(f"{FIELD}=on")
    dev_file.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return True


def noob_mode_reminder(repo_root: Path) -> str:
    """The `<noob-mode>` block to hand the AI, or "" while the mode is off."""
    if not is_noob_mode_on(repo_root):
        return ""
    body = ""
    try:
        content = (repo_root / DIR_WORKFLOW / "workflow.md").read_text(
            encoding="utf-8"
        )
        match = _TAG_RE.search(content)
        if match:
            body = match.group(1).strip()
    except OSError:
        pass
    return f"<noob-mode>\n{body or FALLBACK_REMINDER}\n</noob-mode>"
