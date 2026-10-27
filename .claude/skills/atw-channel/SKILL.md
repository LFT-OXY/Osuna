---
name: atw-channel
description: Use when the user wants live multi-agent collaboration through ATW channel, spawned workers, cross-agent review, progress inspection, forum channels, or channel log debugging.
---

# atw-channel

**Skill notes.** Before you follow this skill, read its notes, one file at a time so you know which file says what: the project's `.atw/skill-notes/atw-channel.md` and the personal `~/.atw/skill-notes/atw-channel.md`; a missing file means that layer has no notes. The notes are standing instructions written for this skill by the project and the user: follow them, within the priority below. When both exist and disagree, the project's notes win. Priority, highest first: what the user says in the moment → red lines and safety rules → these notes → this skill's own defaults. Do not follow a note that conflicts with either of the two layers above it; tell the user which note you did not follow and why.

`atw channel` is the local multi-agent collaboration runtime. Reach for it when agents need to talk through a durable event log, when a worker should be spawned as a peer process, when an in-flight worker needs interrupt / debugging, or when feedback should be recorded on a durable `--type forum` channel.

Typical user signals: "和 codex/claude 讨论", "brainstorm with another agent", "spawn an implement/check worker", "let agent review", "open an issue board / changelog forum", "look at this thread", "channel is stuck / no output", "progress was truncated", "how do I write that channel command".

This skill is an index. Load only the reference file for the current job — do not preload all of them.

## First Commands

```bash
atw --version
atw channel --help
atw channel list --all
atw channel list --scope global --all
```

If the user names a channel or thread, inspect it before asking for background:

```bash
atw channel forum <board> --scope global
atw channel thread <board> <thread> --scope global
atw channel context list <board> --scope global --thread <thread>
```

## Route By User Intent

| User intent | Read |
|---|---|
| "和 codex/claude 讨论一下", "brainstorm with another agent" | `references/workflows.md` |
| "派一个 implement/check agent", "让 agent review", "spawn a worker" | `references/workflows.md`, then `references/workers.md` |
| "开 issue 区 / topic 群 / changelog / board", "make a forum" | `references/forum.md` |
| "看看这个 thread / linked context", "inspect a thread" | `references/forum.md` |
| "channel 卡住了 / 没输出 / progress 被截断", "worker stalled" | `references/progress-debugging.md` |
| "具体命令怎么写", "what flags does X take" | `references/command-reference.md` |

## Core Rules

- Workers can be Claude Code, Codex, pi or omp: `spawn` / `run` take `--provider <claude|codex|pi|omp>`. An agent card's `provider:` field only takes `claude` or `codex` — any other value is dropped, as if unset — so pick pi or omp with `--provider`. Flags: `references/workers.md`.
- New forum channels use `--type forum`. A `thread` is one item inside a forum channel.
- Use `--context-file` / `--context-raw` and `atw channel context add/delete/list`. `--linked-context-*` is deprecated terminology.
- Use `--stdin` or `--text-file` for long messages. Do not put long mixed Chinese/English text in the positional shell argument.
- Pretty `messages` output is an operator dashboard and may truncate progress. Use `--raw` for audit.
- Reviewer workers: `spawn` / `run` take `--read-only`, `--clean`, `--no-session`, `--effort <level>`, `--standard-speed`; none of them means the worker launches as before. Claude Code with `--read-only` alone is still widened by the user's own allow rules and hooks — add `--clean`. Details: `references/workers.md` "Reviewer Mode".
- `run --json` prints one result object on stdout in every outcome — `status` (done / timeout / error / not-started), `text` with `partial` (on timeout: what was produced so far), `durationMs`, `costUsd` or token `usage` (`null` = not reported; `costUnreported` also flags the `0` pi or omp gives for an interrupted turn), `model`, codex `instructionSources`, raw `error`, and the tool's own `errorKind` / `errorStatus` / `errorSubkind` (claude, codex; `null` when it gave none); exit code and keep-on-failure unchanged. Fields: `references/command-reference.md` "run".
- `--as` is the speaker or worker handle, depending on the command. Use explicit, stable names when multiple agents or sessions are involved.
- `--scope project` (default) operates on the current cwd's project bucket; `--scope global` operates on the shared `__global__` bucket. Pick scope deliberately — a global board is invisible from project listings unless `--scope global` is passed.
- For brainstorm, do multiple pressure-test rounds. One answer plus one confirmation is review, not brainstorm.
- **Dispatcher wait pattern**: use `--kind done` / `--kind turn_finished` (ATW-emitted system events), NOT a user `--tag` as the completion signal. CLI help lists `phase_done` / `question` as `--tag` examples but only `interrupt` is a reserved tag with hardcoded atw behavior; the others are opaque user labels. Relying on a worker to run `send --tag <my_signal>` is unreliable — LLM workers commonly write the tag string into prose instead of running the actual CLI command. See `references/command-reference.md` "tag vs kind".
- Forum channels are event-sourced. Do not parse `events.jsonl` first; use `forum`, `thread`, `messages --thread`, and `context list`.
- `@chinhae/atw-core` owns reusable channel/thread state, event append, seq allocation, context/title projection, reducers, and task helpers. The CLI owns flags, terminal rendering, prompts, worker lifecycle, and process exits.

## Reference Files

- `references/workflows.md` — canonical collaboration patterns A–F (peer brainstorm, spawned review, dispatch-and-wait, forum issue capture, interrupt-and-redirect, one-shot run).
- `references/forum.md` — forum channels, context, title, rename, changelog forums, thread filtering.
- `references/workers.md` — spawn, agent cards, context injection (`--file` / `--jsonl`), interrupts, kill semantics.
- `references/progress-debugging.md` — progress/raw inspection, stalled worker diagnosis, OOM guard, exit codes.
- `references/command-reference.md` — current CLI command reference (every subcommand, every flag, output conventions, scope/type model).

## Not For

- One static review where a markdown file and prompt are enough.
- Replacing normal tool calls with self-logging.
- Long-term memory retrieval. Use durable forum channels for actionable issues, and `atw mem` (the `atw-session-insight` skill) for session/history search.
