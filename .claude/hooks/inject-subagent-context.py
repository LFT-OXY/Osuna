#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Multi-Platform Sub-Agent Context Injection Hook

Injects task-specific context when sub-agents (implement-agent, review) are spawned.

Core Design Philosophy:
- Hook is responsible for injecting all context, subagent works autonomously with complete info
- Each agent has a dedicated jsonl file defining its context
- No resume needed, no segmentation, behavior controlled by code not prompt

Trigger: PreToolUse (before Task tool call)

Context Source: ATW active task resolver points to task directory
- implement.jsonl - Implement agent dedicated context
- check.jsonl     - Check agent dedicated context
- prd.md          - Requirements document
- codex-review-output.txt - Code Review results
"""
from __future__ import annotations

# IMPORTANT: Suppress all warnings FIRST
import warnings
warnings.filterwarnings("ignore")

import json
import os
import sys
from pathlib import Path
from typing import Any

# Hook hosts send UTF-8 JSON regardless of the process locale.
_stdin_reconfigure = getattr(sys.stdin, "reconfigure", None)
if callable(_stdin_reconfigure):
    try:
        _stdin_reconfigure(encoding="utf-8", errors="replace")
    except (OSError, ValueError):
        pass

# IMPORTANT: Force stdout to use UTF-8 on Windows
# This fixes UnicodeEncodeError when outputting non-ASCII characters
if sys.platform.startswith("win"):
    import io as _io
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
    elif hasattr(sys.stdout, "detach"):
        sys.stdout = _io.TextIOWrapper(sys.stdout.detach(), encoding="utf-8", errors="replace")  # type: ignore[union-attr]


# =============================================================================
# Path Constants (change here to rename directories)
# =============================================================================

DIR_WORKFLOW = ".atw"
DIR_SPEC = "spec"
FILE_TASK_JSON = "task.json"

# Implementation tickets. Ticket state lives in the ticket file itself, so the
# hook reads it directly rather than shelling out to tickets.py.
DIR_TICKETS = "issues"
TICKET_DOING = "**Impl:** doing"
TICKET_READY = "**Impl:** ready"
TICKET_BLOCKED_PREFIX = "**Blocked by:**"

# Contract literals, not prose — these two strings are what tells "said there
# is no current ticket" apart from "silently skipped the section", and what
# the host shows as the blocking reason. Reword only via PLAN.md.
NO_CURRENT_TICKET = "No ticket in progress"
MULTI_DOING_HEADLINE = "Multiple tickets marked doing"

# =============================================================================
# Subagent Constants (change here to rename subagent types)
# =============================================================================

AGENT_IMPLEMENT = "atw-implement-agent"
AGENT_REVIEW = "atw-review"

# Agents that require a task directory
AGENTS_REQUIRE_TASK = (AGENT_IMPLEMENT, AGENT_REVIEW)
# All supported agents. Platform sub-agent **type** names only — always
# prefixed. The unprefixed channel names (`review` / `implement-agent`, loaded
# by filename from `.atw/agents/<name>.md`) are a separate namespace on
# purpose; letting them in here would make "unifying" the two look harmless.
#
# `atw-research` was retired as a sub-agent. Its context path used to stay in
# place behind this whitelist — two call sites that could never be reached,
# because every caller filters on AGENTS_ALL first. Having callers is not the
# same as being reachable, and the caller count is what made it look live for a
# whole milestone. The path is gone now; the JS port in
# templates/opencode/plugins/ lost the same one.
AGENTS_ALL = (AGENT_IMPLEMENT, AGENT_REVIEW)


def find_repo_root(start_path: str) -> str | None:
    """
    Find git repo root from start_path upwards

    Returns:
        Repo root path, or None if not found
    """
    current = Path(start_path).resolve()
    while current != current.parent:
        if (current / ".git").exists():
            return str(current)
        current = current.parent
    return None


def _detect_platform(input_data: dict) -> str | None:
    if _hook_event_name(input_data) == "SubagentStart":
        return "codex"
    if isinstance(input_data.get("cursor_version"), str):
        return "cursor"
    # CLAUDE_PROJECT_DIR is a compatibility alias that several hosts set
    # alongside their own variable — CodeBuddy, ZCode and Trae all do. It must
    # therefore be checked LAST, or every one of them is detected as claude and
    # the context key becomes `claude_<their-session-id>`. That key does not
    # match the session file `task.py start` wrote under the host's real name,
    # so the sub-agent starts with no task context while the pointer exists on
    # disk. Same fix as inject-workflow-state.py and session-start.py; this
    # third copy was missed when those two were corrected.
    env_map = {
        "ZCODE_PROJECT_DIR": "zcode",
        "CURSOR_PROJECT_DIR": "cursor",
        "CODEBUDDY_PROJECT_DIR": "codebuddy",
        "FACTORY_PROJECT_DIR": "droid",
        "GEMINI_PROJECT_DIR": "gemini",
        "QODER_PROJECT_DIR": "qoder",
        "KIRO_PROJECT_DIR": "kiro",
        "COPILOT_PROJECT_DIR": "copilot",
        "TRAE_PROJECT_DIR": "trae",
        # Last: the shared alias, only meaningful once no vendor key matched.
        "CLAUDE_PROJECT_DIR": "claude",
    }
    for env_name, platform in env_map.items():
        if os.environ.get(env_name):
            return platform
    script_parts = set(Path(sys.argv[0]).parts)
    if ".claude" in script_parts:
        return "claude"
    if ".cursor" in script_parts:
        return "cursor"
    if ".gemini" in script_parts:
        return "gemini"
    if ".qoder" in script_parts:
        return "qoder"
    if ".codebuddy" in script_parts:
        return "codebuddy"
    if ".factory" in script_parts:
        return "droid"
    if ".kiro" in script_parts:
        return "kiro"
    if ".zcode" in script_parts:
        return "zcode"
    return None


def get_current_task(
    repo_root: str,
    input_data: dict,
    *,
    platform: str | None = None,
    allow_single_session_fallback: bool = True,
    allow_environment_context: bool = True,
    require_existing: bool = False,
) -> str | None:
    """Resolve current task directory through the unified active task resolver."""
    scripts_dir = Path(repo_root) / DIR_WORKFLOW / "scripts"
    if str(scripts_dir) not in sys.path:
        sys.path.insert(0, str(scripts_dir))
    try:
        from common.active_task import resolve_active_task  # type: ignore[import-not-found]
    except Exception:
        return None

    active = resolve_active_task(
        Path(repo_root),
        input_data,
        platform=platform or _detect_platform(input_data),
        allow_single_session_fallback=allow_single_session_fallback,
        allow_environment_context=allow_environment_context,
    )
    if require_existing and active.stale:
        return None
    return active.task_path


# =============================================================================
# Context Injection Limits
#
# Notice text and behavior mirrored byte-for-byte in the Pi TS extension
# (templates/pi/extensions/atw/index.ts.txt). Changing wording here
# requires changing it there too.
# =============================================================================

DEFAULT_MAX_FILE_BYTES = 32768
DEFAULT_MAX_ARTIFACT_BYTES = 65536
DEFAULT_MAX_TOTAL_BYTES = 131072

DEFAULT_LIMITS: dict[str, int] = {
    "max_file_bytes": DEFAULT_MAX_FILE_BYTES,
    "max_artifact_bytes": DEFAULT_MAX_ARTIFACT_BYTES,
    "max_total_bytes": DEFAULT_MAX_TOTAL_BYTES,
}


def _get_limits(repo_root: str) -> dict[str, int]:
    """Load context-injection byte limits from config.yaml, with safe fallback."""
    scripts_dir = Path(repo_root) / DIR_WORKFLOW / "scripts"
    if str(scripts_dir) not in sys.path:
        sys.path.insert(0, str(scripts_dir))
    try:
        from common.config import get_context_injection_limits  # type: ignore[import-not-found]

        return get_context_injection_limits(Path(repo_root))
    except Exception:
        return dict(DEFAULT_LIMITS)


def truncate_utf8(data: bytes, cap: int) -> bytes:
    """Truncate ``data`` to at most ``cap`` bytes without splitting a UTF-8
    multi-byte sequence.

    ``cap <= 0`` means "no limit" — returns ``data`` unchanged.
    """
    if cap <= 0 or len(data) <= cap:
        return data

    truncated = data[:cap]
    i = len(truncated)
    # Back off over continuation bytes (10xxxxxx) to find the lead byte.
    while i > 0 and (truncated[i - 1] & 0xC0) == 0x80:
        i -= 1
    if i == 0:
        return b""

    lead = truncated[i - 1]
    if lead & 0x80:
        if (lead & 0xE0) == 0xC0:
            seq_len = 2
        elif (lead & 0xF0) == 0xE0:
            seq_len = 3
        elif (lead & 0xF8) == 0xF0:
            seq_len = 4
        else:
            seq_len = 1
        # Drop the lead byte too if its full sequence didn't fit.
        if (i - 1) + seq_len > len(truncated):
            i -= 1

    return truncated[:i]


class _Budget:
    """Tracks the running total of bytes emitted into the sub-agent context."""

    def __init__(self, max_total_bytes: int) -> None:
        self.max_total_bytes = max_total_bytes
        self.used = 0

    def has_room(self, size: int) -> bool:
        if self.max_total_bytes <= 0:
            return True
        return self.used + size <= self.max_total_bytes

    def add(self, size: int) -> None:
        self.used += size


def _real_path_contained(base_real: str, target_real: str) -> bool:
    """Whether an already-realpath'd target sits under an already-realpath'd base.

    ValueError on Windows when the two sit on different drives; that is
    outside the base by definition, so it fails closed.
    """
    try:
        return os.path.commonpath([base_real, target_real]) == base_real
    except ValueError:
        return False


def _read_file_bytes(base_path: str, file_path: str) -> bytes | None:
    """Read raw file bytes, return None if file doesn't exist."""
    full_path = os.path.join(base_path, file_path)
    try:
        root_real = os.path.realpath(base_path)
        # `.atw` may itself be a symlink into a store outside the repo
        #; its real location is a second legitimate containment base.
        workflow_real = os.path.realpath(os.path.join(base_path, ".atw"))
        full_real = os.path.realpath(full_path)
        if not _real_path_contained(root_real, full_real) and not (
            _real_path_contained(workflow_real, full_real)
        ):
            return None
    except OSError:
        return None
    if os.path.exists(full_path) and os.path.isfile(full_path):
        try:
            with open(full_path, "rb") as f:
                return f.read()
        except Exception:
            return None
    return None


def _truncate_notice(path: str, cap: int) -> str:
    return f"\n[ATW: truncated at {cap} bytes — read {path} for the full content]"


def _is_binary_content(data: bytes) -> bool:
    """Return True when raw bytes should not be decoded into model context."""
    if b"\x00" in data:
        return True
    try:
        data.decode("utf-8", errors="strict")
    except UnicodeDecodeError:
        return True
    return False


def _binary_notice(path: str, size: int, reason: str) -> str:
    return (
        f"[ATW: not inlined (binary file) — "
        f"{path} ({size} bytes): {reason}]"
    )


def _index_notice(path: str, size: int, reason: str) -> str:
    return (
        f"[ATW: not inlined (total context limit reached) — "
        f"{path} ({size} bytes): {reason}]"
    )


def _budgeted_block(
    budget: _Budget,
    header: str,
    plain_path: str,
    content: str,
    reason: str,
    size_for_index: int,
) -> str:
    """Return an inlined ``=== header ===`` block, or degrade to an index
    notice once the total context budget is exhausted."""
    block = f"=== {header} ===\n{content}"
    block_bytes = len(block.encode("utf-8"))
    if not budget.has_room(block_bytes):
        notice = _index_notice(plain_path, size_for_index, reason)
        budget.add(len(notice.encode("utf-8")))
        return notice
    budget.add(block_bytes)
    return block


def _materialize_file(
    base_path: str,
    file_path: str,
    reason: str,
    limits: dict[str, int],
    budget: _Budget,
) -> str | None:
    """Read a JSONL-referenced file, apply the per-file cap, then budget it."""
    data = _read_file_bytes(base_path, file_path)
    if data is None:
        return None

    size = len(data)
    if _is_binary_content(data):
        notice = _binary_notice(file_path, size, reason)
        budget.add(len(notice.encode("utf-8")))
        return notice

    cap = limits["max_file_bytes"]
    truncated_bytes = truncate_utf8(data, cap)
    content = truncated_bytes.decode("utf-8", errors="replace")
    if len(truncated_bytes) < size:
        content += _truncate_notice(file_path, cap)

    return _budgeted_block(budget, file_path, file_path, content, reason, size)


def _materialize_directory(
    base_path: str,
    dir_path: str,
    reason: str,
    limits: dict[str, int],
    budget: _Budget,
    max_files: int = 20,
) -> list[str]:
    """Read all .md files in a directory, applying the same per-file and
    total caps as a single-file JSONL entry."""
    full_path = os.path.join(base_path, dir_path)
    if not os.path.exists(full_path) or not os.path.isdir(full_path):
        return []

    blocks: list[str] = []
    try:
        md_files = sorted(
            f
            for f in os.listdir(full_path)
            if f.endswith(".md") and os.path.isfile(os.path.join(full_path, f))
        )
        for filename in md_files[:max_files]:
            relative_path = os.path.join(dir_path, filename)
            block = _materialize_file(base_path, relative_path, reason, limits, budget)
            if block:
                blocks.append(block)
    except Exception:
        pass

    return blocks


def read_jsonl_entries(base_path: str, jsonl_path: str) -> list[dict]:
    """
    Parse all file/directory entries referenced in a jsonl context file.

    Schema:
        {"file": "path/to/file.md", "reason": "..."}
        {"file": "path/to/dir/", "type": "directory", "reason": "..."}
        {"_example": "..."}          # legacy placeholder — skipped (no `file` field)

    Rows without a ``file`` field (e.g. the placeholder line older ATW
    versions wrote at ``task.py create`` time) are skipped silently. If the
    resulting entry list is empty, a stderr warning is emitted so the operator
    can debug missing context.

    Returns:
        [{"file": path, "type": "file" | "directory", "reason": reason}, ...]
    """
    full_path = os.path.join(base_path, jsonl_path)
    if not os.path.exists(full_path):
        print(
            f"[inject-subagent-context] WARN: {jsonl_path} not found — "
            f"sub-agent will receive only task artifacts",
            file=sys.stderr,
        )
        return []

    entries: list[dict] = []
    saw_real_entry = False
    try:
        with open(full_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    item = json.loads(line)
                    file_path = item.get("file") or item.get("path")

                    if not file_path:
                        # Seed / comment row — skip silently
                        continue

                    saw_real_entry = True
                    entries.append(
                        {
                            "file": file_path,
                            "type": item.get("type", "file"),
                            "reason": item.get("reason") or "-",
                        }
                    )
                except json.JSONDecodeError:
                    continue
    except Exception:
        pass

    if not saw_real_entry:
        print(
            f"[inject-subagent-context] WARN: {jsonl_path} has no curated "
            f"entries (only seed / empty) — sub-agent will receive only "
            f"task artifacts. See workflow.md planning artifact guidance.",
            file=sys.stderr,
        )

    return entries


def _materialize_jsonl_entries(
    base_path: str, jsonl_path: str, limits: dict[str, int], budget: _Budget
) -> list[str]:
    """Materialize every entry in a jsonl context file into context blocks,
    applying per-file and total budget caps."""
    blocks: list[str] = []
    for entry in read_jsonl_entries(base_path, jsonl_path):
        if entry["type"] == "directory":
            blocks.extend(
                _materialize_directory(
                    base_path, entry["file"], entry["reason"], limits, budget
                )
            )
        else:
            block = _materialize_file(
                base_path, entry["file"], entry["reason"], limits, budget
            )
            if block:
                blocks.append(block)
    return blocks


def get_agent_context(
    repo_root: str,
    task_dir: str,
    agent_type: str,
    limits: dict[str, int],
    budget: _Budget,
) -> str:
    """
    Get context from {agent_type}.jsonl for the specified agent.
    Only reads implement.jsonl or check.jsonl (the two JSONL files the task system creates).
    """
    agent_jsonl = f"{task_dir}/{agent_type}.jsonl"
    blocks = _materialize_jsonl_entries(repo_root, agent_jsonl, limits, budget)
    if not blocks:
        # Zero curated context reaches the model silently otherwise — the
        # stderr WARN above never enters any session. Put the fact in
        # the prompt itself so the sub-agent compensates instead of assuming
        # the spec context was complete.
        return (
            f"[ATW] {agent_jsonl} has no curated entries, so no spec/research "
            "context was injected. Before working, read the guidelines relevant "
            "to the code you will touch under .atw/spec/, and treat the task "
            "artifacts below as the only prepared context."
        )
    return "\n\n".join(blocks)


def _materialize_artifact(
    base_path: str,
    file_path: str,
    header_label: str,
    reason: str,
    limits: dict[str, int],
    budget: _Budget,
) -> str | None:
    """Read a task artifact (`prd.md`), apply the per-artifact cap, then
    budget it."""
    data = _read_file_bytes(base_path, file_path)
    if data is None:
        return None

    size = len(data)
    cap = limits["max_artifact_bytes"]
    truncated_bytes = truncate_utf8(data, cap)
    content = truncated_bytes.decode("utf-8", errors="replace")
    if len(truncated_bytes) < size:
        content += _truncate_notice(file_path, cap)

    return _budgeted_block(budget, header_label, file_path, content, reason, size)


class MultipleTicketsDoing(Exception):
    """More than one ticket claims ``**Impl:** doing``.

    Picking the first one would silently inject the wrong ticket, so the hook
    refuses to choose. The two callers surface this differently because the
    host treats exit codes differently per event — see main() and
    _handle_codex_subagent_start().
    """

    def __init__(self, tickets: list[str]) -> None:
        self.tickets = tickets
        listed = "\n".join(f"  - {t}" for t in tickets)
        super().__init__(
            f"{MULTI_DOING_HEADLINE} — the hook cannot pick a current ticket:\n"
            f"{listed}\n"
            f"Set all but one back to `{TICKET_READY}`, then retry."
        )


def _blocked_by_clear(text: str) -> bool:
    """Whether a ticket's ``**Blocked by:**`` field is cleared (or absent)."""
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith(TICKET_BLOCKED_PREFIX):
            return stripped[len(TICKET_BLOCKED_PREFIX):].strip().lower() in ("", "none")
    return True


def _ticket_title(text: str, fallback: str) -> str:
    for line in text.splitlines():
        if line.startswith("#"):
            return line.lstrip("#").strip()
    return fallback


def scan_tickets(repo_root: str, task_dir: str) -> tuple[list[str], list[tuple[str, str]]]:
    """Split ``<task_dir>/issues/*.md`` into (doing paths, frontier summaries).

    Frontier = the remaining ``ready`` tickets whose blockers are cleared.
    """
    issues_dir = Path(repo_root) / task_dir / DIR_TICKETS
    doing: list[str] = []
    frontier: list[tuple[str, str]] = []
    if not issues_dir.is_dir():
        return doing, frontier
    for ticket in sorted(issues_dir.glob("*.md")):
        rel = f"{task_dir}/{DIR_TICKETS}/{ticket.name}"
        try:
            text = ticket.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        if TICKET_DOING in text:
            doing.append(rel)
        elif TICKET_READY in text and _blocked_by_clear(text):
            frontier.append((rel, _ticket_title(text, ticket.name)))
    return doing, frontier


def ticket_conflict_notice(repo_root: str, task_dir: str) -> str:
    """One-line warning for agents that do not consume the ticket axis.

    The implement agent neither reads nor writes ``**Impl:**`` — the only writer
    is ``tickets.py set_impl``, driven by the main session. A contradiction it
    cannot deepen is not worth blocking a spawn over, and the misjudgement is
    asymmetric: one false multi-doing reading would stall implementation for a
    reason unrelated to implementation. So it starts, and it is told. Count
    only; no ticket content crosses this path while the state is broken.
    """
    doing, _ = scan_tickets(repo_root, task_dir)
    if len(doing) < 2:
        return ""
    return (
        f"=== Ticket State ===\n"
        f"{MULTI_DOING_HEADLINE}: {len(doing)} tickets are marked "
        f"`{TICKET_DOING}`. The ticket state contradicts itself, so no ticket "
        f"content is injected this turn. Resolve it before relying on any "
        f"ticket-derived state."
    )


def get_ticket_context(
    repo_root: str,
    task_dir: str,
    limits: dict[str, int],
    budget: _Budget,
) -> str:
    """Current ticket in full + frontier summary, injected every round.

    Raises MultipleTicketsDoing when the ticket state contradicts itself.
    """
    doing, frontier = scan_tickets(repo_root, task_dir)
    if len(doing) > 1:
        raise MultipleTicketsDoing(doing)

    if doing:
        current = _materialize_artifact(
            repo_root,
            doing[0],
            f"{doing[0]} (Current Ticket)",
            "Current ticket",
            limits,
            budget,
        ) or f"=== {doing[0]} (Current Ticket) ===\n[ATW: ticket unreadable]"
    else:
        # Not budgeted on purpose: saying so is the whole point of this branch,
        # and a byte cap must never be what makes it disappear.
        current = f"=== Current Ticket ===\n{NO_CURRENT_TICKET}"

    listed = "\n".join(f"- {rel} — {title}" for rel, title in frontier) or "(none)"
    summary = _budgeted_block(
        budget,
        "Frontier (ready tickets)",
        f"{task_dir}/{DIR_TICKETS}/",
        listed,
        "Ready tickets with blockers cleared",
        len(listed.encode("utf-8")),
    )
    return f"{current}\n\n{summary}"


def get_implement_context(repo_root: str, task_dir: str) -> str:
    """
    Complete context for Implement Agent

    Read order:
    1. All files in implement.jsonl (spec/research manifests)
    2. prd.md (requirements)

    `design.md` and `implement.md` are gone (D32/C23): the spec skills produce
    the design and tickets replaced the execution plan, so nothing writes them
    any more. Materializing them anyway is not harmless tolerance — it is the
    reason the retirement never actually landed: as long as a reader still
    reaches for them, "cut" is only a claim about the writer.

    The ticket sections live on the review path only: the current ticket is what
    the Spec axis reviews against, and it is `check.jsonl` that carries its path.
    A self-contradicting ticket state still gets announced here — see
    `ticket_conflict_notice`.
    """
    limits = _get_limits(repo_root)
    budget = _Budget(limits["max_total_bytes"])
    context_parts = []

    # 0. Broken ticket state is stated up front, never silently skipped
    notice = ticket_conflict_notice(repo_root, task_dir)
    if notice:
        context_parts.append(notice)

    # 1. Read implement.jsonl
    base_context = get_agent_context(repo_root, task_dir, "implement", limits, budget)
    if base_context:
        context_parts.append(base_context)

    # 2. Requirements document
    prd_block = _materialize_artifact(
        repo_root,
        f"{task_dir}/prd.md",
        f"{task_dir}/prd.md (Requirements)",
        "Requirements document",
        limits,
        budget,
    )
    if prd_block:
        context_parts.append(prd_block)

    return "\n\n".join(context_parts)


def get_check_context(repo_root: str, task_dir: str) -> str:
    """
    Context for the review agent: check.jsonl + task artifacts + current ticket.

    Name kept as ``check`` to match ``check.jsonl`` (C6: the jsonl is named
    after the role, not after the sub-agent type).
    """
    limits = _get_limits(repo_root)
    budget = _Budget(limits["max_total_bytes"])
    context_parts = []

    base_context = get_agent_context(repo_root, task_dir, "check", limits, budget)
    if base_context:
        context_parts.append(base_context)

    prd_block = _materialize_artifact(
        repo_root,
        f"{task_dir}/prd.md",
        f"{task_dir}/prd.md (Requirements)",
        "Requirements document",
        limits,
        budget,
    )
    if prd_block:
        context_parts.append(prd_block)

    context_parts.append(get_ticket_context(repo_root, task_dir, limits, budget))

    # `design.md` / `implement.md` are not read here either — same reason as in
    # get_implement_context: both axes reach the model prompt through this file,
    # so leaving one of them reaching for a retired artifact would keep D32 from
    # landing on that half.
    return "\n\n".join(context_parts)


def build_implement_prompt(original_prompt: str, context: str) -> str:
    """Build complete prompt for Implement"""
    return f"""<!-- atw-hook-injected -->
# Implement Agent Task

You are the Implement Agent in the Multi-Agent Pipeline.

## Your Context

All the information you need has been prepared for you:

{context}

---

## Your Task

{original_prompt}

---

## Workflow

1. **Understand specs** - All dev specs are injected above, understand them
    2. **Understand task artifacts** - Read requirements, technical design if present, and execution plan if present
    3. **Implement feature** - Implement following specs and task artifacts
4. **Self-check** - Ensure code quality against check specs

## Important Constraints

- Do NOT execute git commit, only code modifications
- Follow all dev specs injected above
- Report list of modified/created files when done"""


def build_check_prompt(original_prompt: str, context: str) -> str:
    """Build complete prompt for Check"""
    return f"""<!-- atw-hook-injected -->
# Check Agent Task

You are the Check Agent in the Multi-Agent Pipeline (code and cross-layer checker).

## Your Context

All check specs and dev specs you need:

{context}

---

## Your Task

{original_prompt}

---

## Workflow

1. **Get changes** - Run `git diff --name-only` and `git diff` to get code changes
2. **Check against specs** - Check item by item against specs above
3. **Self-fix** - Fix issues directly, don't just report
4. **Run verification** - Run project's lint and typecheck commands

## Important Constraints

- Fix issues yourself, don't just report
- Must execute complete checklist in check specs
- Pay special attention to impact radius analysis (L1-L5)"""


def _string_value(value: Any) -> str:
    if isinstance(value, str):
        stripped = value.strip()
        return stripped
    return ""


def _hook_event_name(input_data: dict) -> str:
    """Return a hook event name from the documented snake/camel-case fields."""
    return _string_value(
        input_data.get("hook_event_name") or input_data.get("hookEventName")
    )


def _codex_subagent_type(input_data: dict) -> str:
    """Return an ATW Codex agent type only for a native start event."""
    if _hook_event_name(input_data) != "SubagentStart":
        return ""
    agent_type = _string_value(
        input_data.get("agent_type") or input_data.get("agentType")
    )
    return agent_type if agent_type in AGENTS_ALL else ""


def build_codex_subagent_context(
    subagent_type: str,
    task_dir: str,
    context: str,
) -> str:
    """Build developer context for a native, already-dispatched Codex role."""
    role = subagent_type.removeprefix("atw-")
    return f"""<!-- atw-hook-injected -->
# ATW Native {role.title()} Subagent

You are the dispatched `{subagent_type}` role for this task. Perform that role
directly; do not follow main-session dispatch or wait instructions, and do not
spawn another ATW subagent.

Active task: {task_dir}

## Curated Context

{context}"""


def _handle_codex_subagent_start(input_data: dict) -> None:
    """Emit Codex developer context for a recognised native ATW subagent.

    The event supplies the parent session id. Disabling the generic
    single-session fallback is essential here: native starts must never borrow
    a task from another Codex window when that parent id is absent or stale.
    """
    subagent_type = _codex_subagent_type(input_data)
    parent_session_id = _string_value(input_data.get("session_id"))
    if not subagent_type or not parent_session_id:
        return

    # Payload cwd first, then our own — some hosts (CodeBuddy IDE 4.10.4)
    # report "/" for every hook event. See inject-workflow-state.py.
    repo_root = None
    for candidate in (_string_value(input_data.get("cwd")), os.getcwd()):
        if not candidate:
            continue
        repo_root = find_repo_root(candidate)
        if repo_root:
            break
    if not repo_root:
        return

    task_dir = get_current_task(
        repo_root,
        {"session_id": parent_session_id},
        platform="codex",
        allow_single_session_fallback=False,
        allow_environment_context=False,
        require_existing=True,
    )
    if not task_dir:
        return

    if subagent_type in AGENTS_REQUIRE_TASK:
        task_dir_full = Path(repo_root) / task_dir
        if not task_dir_full.is_dir():
            return

    try:
        if subagent_type == AGENT_IMPLEMENT:
            context = get_implement_context(repo_root, task_dir)
        elif subagent_type == AGENT_REVIEW:
            context = get_check_context(repo_root, task_dir)
        else:
            # `_codex_subagent_type` already filtered on AGENTS_ALL, so no other
            # value can arrive here. Return rather than invent a context.
            return
    except MultipleTicketsDoing as conflict:
        # This event has no blocking channel. A non-zero exit here renders only
        # as a `<hook> hook error` line in the child's own transcript: Claude
        # never sees it and the child starts anyway — worse than silence,
        # because it looks like a normal start. additionalContext is the only
        # channel that reaches the agent, so state the conflict there, ship no
        # ticket content, and exit 0.
        context = str(conflict)

    if not context:
        return

    output = {
        "hookSpecificOutput": {
            "hookEventName": "SubagentStart",
            "additionalContext": build_codex_subagent_context(
                subagent_type, task_dir, context
            ),
        }
    }
    print(json.dumps(output, ensure_ascii=False))


def _extract_subagent_name(value: Any) -> str:
    """Extract a sub-agent name from common platform encodings.

    Cursor's native Task args encode custom sub-agents as a protobuf oneof,
    which can appear in hook JSON as either ``{"custom": {"name": "..."}}``
    or ``{"type": {"case": "custom", "value": {"name": "..."}}}``.
    """
    direct = _string_value(value)
    if direct:
        return direct

    if not isinstance(value, dict):
        return ""

    for key in ("name", "subagent_type_name", "subagentTypeName"):
        direct = _string_value(value.get(key))
        if direct:
            return direct

    custom = value.get("custom")
    if isinstance(custom, dict):
        custom_name = _string_value(custom.get("name"))
        if custom_name:
            return custom_name

    oneof = value.get("type")
    if isinstance(oneof, dict):
        case_name = _string_value(oneof.get("case"))
        if case_name == "custom":
            nested_value = oneof.get("value")
            if isinstance(nested_value, dict):
                custom_name = _string_value(nested_value.get("name"))
                if custom_name:
                    return custom_name
        if case_name:
            return case_name

    case_name = _string_value(value.get("case"))
    if case_name == "custom":
        nested_value = value.get("value")
        if isinstance(nested_value, dict):
            custom_name = _string_value(nested_value.get("name"))
            if custom_name:
                return custom_name
    if case_name:
        return case_name

    for agent_name in AGENTS_ALL:
        if agent_name in value:
            return agent_name

    return ""


def _extract_subagent_type(tool_input: dict) -> str:
    for key in (
        "subagent_type",
        "subagentType",
        "subagent_type_name",
        "subagentTypeName",
        "subagent_name",
        "subagentName",
        "agent_type",
        "agentType",
        "name",
    ):
        agent_name = _extract_subagent_name(tool_input.get(key))
        if agent_name:
            return agent_name
    return ""


def _parse_hook_input(input_data: dict) -> tuple[str, str, dict]:
    """Parse hook input across different platform formats.

    Returns (subagent_type, original_prompt, tool_input).
    Handles:
    - Claude Code / Qoder / Droid: tool_name=Task|Agent, tool_input.subagent_type
    - CodeBuddy: tool_name=task (IDE) or Task (CLI), tool_input.subagent_name
    - Cursor: tool_name=Task|Subagent, tool_input.subagent_type
    - Copilot CLI: toolName=task (camelCase key, lowercase value)
    - ZCode: toolName=Agent, toolInput/tool_input.subagent_type
    - Gemini CLI: tool_name IS the agent name (BeforeTool matcher already filtered)
    - Kiro: agentSpawn hook, agent_name field at top level
    """
    tool_input = input_data.get("tool_input", {})
    if not isinstance(tool_input, dict):
        tool_input = input_data.get("toolInput", {})
    if not isinstance(tool_input, dict):
        tool_input = {}

    # Standard format: Task/Agent tool with subagent_type
    tool_name = input_data.get("tool_name", "") or input_data.get("toolName", "")
    if tool_name.lower() in ("task", "agent", "subagent"):
        return (
            _extract_subagent_type(tool_input),
            tool_input.get("prompt", ""),
            tool_input,
        )

    # Kiro: agentSpawn hook passes agent_name at top level
    agent_name = input_data.get("agent_name", "")
    if agent_name:
        return agent_name, tool_input.get("prompt", input_data.get("prompt", "")), tool_input

    # Gemini CLI: BeforeTool where tool_name IS the agent name
    # (matcher already ensured it's one of our agents)
    if tool_name in AGENTS_ALL:
        return tool_name, tool_input.get("prompt", ""), tool_input

    # Copilot CLI: toolName field (camelCase), value might be the agent name
    tool_name_camel = input_data.get("toolName", "")
    if tool_name_camel in AGENTS_ALL:
        return tool_name_camel, input_data.get("toolArgs", ""), tool_input

    return "", "", tool_input


def main():
    if os.environ.get("ATW_HOOKS") == "0" or os.environ.get("ATW_DISABLE_HOOKS") == "1":
        sys.exit(0)

    try:
        input_data = json.load(sys.stdin)
    except json.JSONDecodeError:
        sys.exit(0)
    if not isinstance(input_data, dict):
        sys.exit(0)

    if _hook_event_name(input_data) == "SubagentStart":
        try:
            _handle_codex_subagent_start(input_data)
        except Exception:
            # A native context hook must never prevent Codex from spawning the
            # requested child when its runtime state is unavailable or stale.
            pass
        sys.exit(0)

    subagent_type, original_prompt, tool_input = _parse_hook_input(input_data)
    cwd = input_data.get("cwd", os.getcwd())

    # Only handle subagent types we care about
    if subagent_type not in AGENTS_ALL:
        sys.exit(0)

    # Find repo root
    repo_root = find_repo_root(cwd)
    if not repo_root:
        sys.exit(0)

    # Get current task directory. May be None here — the AGENTS_REQUIRE_TASK
    # check below is what refuses to continue without one.
    task_dir = get_current_task(
        repo_root,
        input_data,
        allow_single_session_fallback=True,
    )

    # implement/check need task directory
    if subagent_type in AGENTS_REQUIRE_TASK:
        if not task_dir:
            sys.exit(0)
        # Contain the pointer before reading anything through it. `task.py` now
        # refuses to store a ref that leaves the repo, but a session file
        # written before that fix can still hold one, and `atw update`
        # does not rewrite session files — so a poisoned pointer outlives the
        # upgrade that closed the writer. This is the last hop before the
        # task's prd.md reaches the model prompt, so it checks again.
        try:
            root_real = os.path.realpath(repo_root)
            # `.atw` may itself be a symlink into a store outside the
            # repo; its real location is a second legitimate base.
            workflow_real = os.path.realpath(os.path.join(repo_root, ".atw"))
            task_dir_full = os.path.realpath(os.path.join(repo_root, task_dir))
            if not _real_path_contained(root_real, task_dir_full) and not (
                _real_path_contained(workflow_real, task_dir_full)
            ):
                sys.exit(0)
        except OSError:
            sys.exit(0)
        if not os.path.exists(task_dir_full):
            sys.exit(0)

    # Get context and build prompt based on subagent type
    try:
        if subagent_type == AGENT_IMPLEMENT:
            assert task_dir is not None  # validated above
            context = get_implement_context(repo_root, task_dir)
            new_prompt = build_implement_prompt(original_prompt, context)
        elif subagent_type == AGENT_REVIEW:
            assert task_dir is not None  # validated above
            context = get_check_context(repo_root, task_dir)
            new_prompt = build_check_prompt(original_prompt, context)
        else:
            sys.exit(0)
    except MultipleTicketsDoing as conflict:
        # Exit code 2 is the only code that makes the host block the Task call,
        # and on this event stderr *is* the blocking reason shown to the user.
        # 1 or any other non-zero is a non-blocking error: the message is shown
        # but execution continues, so the sub-agent starts with no injection.
        print(str(conflict), file=sys.stderr)
        sys.exit(2)

    if not context:
        sys.exit(0)

    # Return updated input. Most platforms ignore unrecognized fields, so we
    # include multiple formats. ZCode is stricter; live probing confirmed the
    # nested Claude-compatible shape below reaches the sub-agent prompt.
    updated = {**tool_input, "prompt": new_prompt}
    if _detect_platform(input_data) == "zcode":
        output = {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "allow",
                "updatedInput": updated,
            }
        }
    else:
        output = {
            # Claude Code / Qoder / CodeBuddy / Droid format
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "allow",
                "updatedInput": updated,
            },
            # Cursor format
            "permission": "allow",
            "updated_input": updated,
            # Gemini format
            "updatedInput": updated,
        }

    print(json.dumps(output, ensure_ascii=False))
    sys.exit(0)


if __name__ == "__main__":
    main()
