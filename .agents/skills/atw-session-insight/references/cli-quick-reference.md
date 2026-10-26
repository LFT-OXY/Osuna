# `atw mem` CLI Reference

Full flag reference for the five subcommands. Pin this as the authoritative source — `atw mem help` prints the same content at runtime, so anything here that drifts is a bug.

## Subcommands

| Command                | Purpose                                                                                                                |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `list`                 | List sessions. Default subcommand when none is given.                                                                  |
| `search <keyword>`     | Find sessions whose contents match a keyword.                                                                          |
| `context <session-id>` | Drill into one session: top-N hit turns + surrounding context. Pair with `--grep` for keyword anchoring.               |
| `extract <session-id>` | Dump cleaned dialogue. Combine with `--phase` / `--grep` to slice, or `--tools` / `--after` for the tools reading.     |
| `extract --context <id>` | Same, finding the session by its ATW context id instead of a session id.                                           |
| `projects`             | List active project `cwd` values with session counts. Use this to discover which `--cwd` to pass to other subcommands. |

## Flags (apply where meaningful)

| Flag                                          | Subcommands       | Meaning                                                                                                                                                    |
| --------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--platform claude\|codex\|omp\|opencode\|pi\|all` | all          | Default `all`. OpenCode sessions are read, but `--phase` does not apply to them — see "Caveats" below.                                                      |
| `--since YYYY-MM-DD`                          | list / search     | Inclusive lower date bound.                                                                                                                                |
| `--until YYYY-MM-DD`                          | list / search     | Inclusive upper date bound.                                                                                                                                |
| `--global`                                    | list / search     | Include sessions from every project on this machine. Default is the current project `cwd`.                                                                 |
| `--cwd <path>`                                | list / search     | Force a specific project cwd instead of inferring from where you are.                                                                                      |
| `--limit N`                                   | list / search     | Cap output rows. Default `50`.                                                                                                                             |
| `--grep KW`                                   | extract / context | Filter turns by keyword. Multi-token AND when whitespace-separated.                                                                                        |
| `--phase brainstorm\|implement\|all`          | extract           | Slice session by ATW task boundaries. `brainstorm` = `[task.py create, task.py start)`. `implement` = turns outside brainstorm windows. Default `all`. |
| `--tools`                                     | extract           | Tools reading: in recorded order, the dialogue plus each tool call (name + command, or a `key: value` argument summary) and its result, and on Claude Code each message a hook had it show the user (`## Hook message`). Thinking is never shown. Claude Code, Codex, Pi, omp only. Cannot be combined with `--phase` / `--grep`. |
| `--result-lines N`                            | extract --tools   | Lines kept at the start and at the end of a long call input or result; the cut is written as `[... K lines omitted ...]`. Default `20`.                   |
| `--after <ISO time>`                          | extract           | Only what was recorded at or after this time (e.g. `2026-10-18T15:30:12+08:00`). Without `--tools` it gives the dialogue only. Claude Code, Codex, Pi, omp only. |
| `--context <id>`                              | extract           | Find the session by ATW context id — copy it from the evidence cell of the decision-log `start` row (`claude_<session-id>`, `omp_transcript_<hash>`, `session_<id>`, …). Exact match only; no match, or more than one, is an error — nothing is guessed. |
| `--turns N`                                   | context           | Number of hit turns to return. Default `3`.                                                                                                                |
| `--around N`                                  | context           | Surrounding turns to include per hit. Default `1`.                                                                                                         |
| `--max-chars N`                               | context           | Total character budget. Default `6000` (~1500 tokens).                                                                                                     |
| `--include-children`                          | search / context  | Merge OpenCode sub-agent sessions into their parent session.                                                                                               |
| `--json`                                      | all               | Emit machine-parseable JSON instead of human-readable output.                                                                                              |

## Common one-liners

```bash
# What past sessions discussed "deadlock" anywhere on this machine?
atw mem search "deadlock" --global --limit 20

# Inside a specific session, surface the top 5 turns that mention "lock contention"
# plus 2 turns of surrounding context.
atw mem context 5842592d --grep "lock contention" --turns 5 --around 2

# Recover the brainstorm window for a session — useful when continuing a task
# the user started a week ago.
atw mem extract 5842592d --phase brainstorm

# Re-read a run's commands and results: take the context id from the evidence
# cell of the run's decision-log `start` row and the time from its time cell.
atw mem extract --context claude_<session-id> --tools --after 2026-10-18T15:30:12+08:00

# List every project this machine has ATW sessions for, with counts.
atw mem projects
```

## Output shapes

- **Default human output** (no `--json`): wrapped to a terminal, with session ids highlighted and turn markers visible. Suitable to read inline but messy to paste into a markdown file.
- **`--json`**: stable schema, safe to parse and process. When piping `mem` output into a follow-up step (e.g. summarizing for a Lessons section), prefer `--json`.

## Caveats

- **OpenCode does not support `--phase` slicing.** `list`, `search`, and `context` all read OpenCode sessions from its SQLite session store, but the adapter has no native phase-boundary detection. A `--phase brainstorm` or `--phase implement` request against OpenCode returns the *full* dialogue plus an `opencode-phase-unsupported` warning, so report those results as "full session" rather than as brainstorm or implement turns.
- **`--phase` slicing depends on `task.py create` / `task.py start` invocations appearing in the recorded bash calls of the session.** Sessions where the user ran `task.py` from a different terminal — outside the recorded AI loop — will not have phase boundaries. `--phase all` is the safe fallback.
- **`mem` indexes platform JSONL files directly.** If the user has cleared their Claude / Codex / Pi session storage, `mem` cannot recover what is no longer on disk.
- **`mem` is read-only.** No remote sync, no edits to platform JSONL. Any write you do based on `mem` findings is your own follow-up call into the editing tools available to you.

## When you need more than this reference

Run `atw mem help` in the user's shell. The runtime help is authoritative and will be ahead of this reference during fast-moving beta releases.
