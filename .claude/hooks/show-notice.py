#!/usr/bin/env python3
"""ATW start-notice hook (Claude Code PostToolUse, matcher ``Bash``).

Claude Code 2.1.302 as the host rewrote the paragraph that
``cross_model_review.py afk-notice`` / ``prepare`` / ``prepare-log`` print
as ``notice`` instead of posting it word for word, however the skills put it
(task decision-log-afk tickets 20, 23, 28, 26). So the script also writes the
paragraph to ``.atw/.runtime/hook-notice.json``, and this hook, right after
one of those commands ends, hands it to Claude Code as ``systemMessage``:
Claude Code shows that to the user itself, the model never sees it. An
``additionalContext`` line tells the model the paragraph has been shown, so it
does not post it again.

Verified on Claude Code 2.1.302 (``claude -p --output-format stream-json
--verbose``): the message arrives as ``{"type":"system","subtype":
"informational","content":"PostToolUse:Bash says: <text>"}`` (every line of
the text gets that prefix), the session record keeps it as an
``attachment`` of type ``hook_system_message`` with the text unchanged, and the
model, asked to quote any hook message it saw, saw none.

The file is shown once and then removed. Nothing is printed when the command
is not one of the three, when the file was written by another of them, when
it was written in another conversation (its ``session`` is the ATW context key
``resolve_context_key`` gave the script; this hook computes the same key from
its own input — when either side has none, it is shown as before), when there
is no file, outside an ATW project, or with ATW hooks turned off.

Claude Code caps ``systemMessage`` at 10,000 characters and replaces a longer
one with a file path and a 2,000-character preview. A paragraph over
``SHOW_LIMIT`` is therefore not shown at all: ``additionalContext`` tells the
model to post it itself, word for word.

The command names in ``COMMAND_RE`` are the script's ``NOTICE_COMMANDS``:
change one, change the other.
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from typing import Optional

NOTICE_FILE = Path(".atw") / ".runtime" / "hook-notice.json"
# Claude Code 的上限是 10,000 字，留出余量
SHOW_LIMIT = 8000
COMMAND_RE = re.compile(r"cross_model_review\.py['\"]?\s+(afk-notice|prepare-log|prepare)(?![\w-])")
SHOWN = (
    "ATW: Claude Code has just shown the user the `notice` that `cross_model_review.py {command}` printed "
    "({which}), word for word, as a message of its own. Do not post it again and do not reword it; "
    "go on with the next step."
)
TOO_LONG = (
    "ATW: the `notice` that `cross_model_review.py {command}` printed ({which}) is too long for Claude Code "
    "to show whole ({length} characters, over {limit}), so it was not shown. Post it yourself, word for word, "
    "as a message of its own, as the skill says."
)


def find_atw_root(start: Path) -> Optional[Path]:
    cur = start.resolve()
    for d in (cur, *cur.parents):
        if (d / ".atw").is_dir():
            return d
    return None


def _context_key(root: Path, data: dict) -> Optional[str]:
    """ATW's own key for this conversation, the same way the script got it."""
    scripts_dir = root / ".atw" / "scripts"
    if str(scripts_dir) not in sys.path:
        sys.path.insert(0, str(scripts_dir))
    try:
        from common.active_task import resolve_context_key  # type: ignore[import-not-found]
    except ImportError:
        return None
    return resolve_context_key(data, platform="claude")


def main() -> int:
    if os.environ.get("ATW_HOOKS") == "0" or os.environ.get("ATW_DISABLE_HOOKS") == "1":
        return 0
    try:
        # 按字节读、输出全用 ASCII 转义：Windows 上的默认编码碰不到中文
        data = json.loads(sys.stdin.buffer.read().decode("utf-8", errors="replace"))
    except (ValueError, OSError):
        return 0
    if not isinstance(data, dict) or data.get("tool_name") != "Bash":
        return 0
    tool_input = data.get("tool_input")
    command = tool_input.get("command") if isinstance(tool_input, dict) else None
    match = COMMAND_RE.search(command) if isinstance(command, str) else None
    if match is None:
        return 0
    cwd = data.get("cwd")
    root = find_atw_root(Path(cwd) if isinstance(cwd, str) and cwd else Path.cwd())
    if root is None:
        return 0
    path = root / NOTICE_FILE
    try:
        saved = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return 0
    if not isinstance(saved, dict) or saved.get("command") != match.group(1):
        return 0
    text = saved.get("text")
    if not isinstance(text, str) or not text:
        return 0
    written_in = saved.get("session")
    here = _context_key(root, data) if written_in else None
    if written_in and here and written_in != here:
        # 别的对话写的：留给它，不在这里显示
        return 0
    path.unlink(missing_ok=True)
    command_name = match.group(1)
    which = {"zh": "the Chinese paragraph", "en": "the English paragraph"}.get(
        saved.get("lang"), "both the Chinese and the English paragraph"
    )
    if len(text) > SHOW_LIMIT:
        out: dict = {"hookSpecificOutput": {
            "hookEventName": "PostToolUse",
            "additionalContext": TOO_LONG.format(command=command_name, which=which, length=len(text), limit=SHOW_LIMIT),
        }}
    else:
        out = {"systemMessage": text, "hookSpecificOutput": {
            "hookEventName": "PostToolUse",
            "additionalContext": SHOWN.format(command=command_name, which=which),
        }}
    print(json.dumps(out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
