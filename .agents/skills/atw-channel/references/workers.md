# Workers And Agent Cards

Use workers when a peer agent should execute independently and report back
through the channel event log. A worker is a registered child process (claude,
codex, pi or omp) attached to a channel; the supervisor forwards inbox messages to it
and translates its output back into channel events.

## Spawn

```bash
atw channel create impl-task --by dispatcher --cwd /path/to/repo
atw channel spawn impl-task --provider codex --as codex-impl --timeout 30m

echo "Implement the schema for table X per .atw/.../prd.md" \
  | atw channel send impl-task --as dispatcher --to codex-impl --stdin

atw channel wait impl-task --as dispatcher --from codex-impl --kind done --timeout 30m
```

`spawn` forks a `channel __supervisor` worker that emits `spawned`, streams
`progress`, and should end with `done`, `error`, or `killed`. Workers stay
inbox-idle until a `send --to <worker>` (or a broadcast when
`--inbox-policy broadcastAndExplicit` is set) wakes them.

Key `spawn` flags:

- `--agent <name>` — load `.atw/agents/<name>.md` (provider/model/as/system prompt defaults).
- `--provider <claude|codex|pi|omp>` — overrides the agent card; validated against the adapter registry.
- `--as <name>` — channel worker handle; defaults to the agent name.
- `--cwd <path>` — worker working directory (also the jail root for `--file`/`--jsonl`).
- `--model <id>` — model override.
- `--resume <id>` — resume an existing claude session / codex thread / pi or omp session (pi: `--session-id`, omp: `--resume`; both ids are read with `get_state` and kept in `<worker>.session-id`).
- `--timeout <duration>` — auto-kill after `30s` / `2m` / `1h`.
- `--warn-before <duration>` — supervisor_warning lead time (default `5m`; `0ms` disables).
- `--file <path>` (repeatable, glob-supported) — inject file content into the system prompt.
- `--jsonl <path>` (repeatable) — ATW jsonl manifest (`{file, reason}` per line).
- `--by <agent>` — author of the `spawned` event (defaults to `$ATW_CHANNEL_AS` or `main`).
- `--inbox-policy <explicitOnly|broadcastAndExplicit>` — default `explicitOnly`.
- `--idle-timeout <duration>` — OOM guard idle TTL (default `5m`; `0` disables).
- `--max-live-workers <n>` — spawn-time live-worker budget (default `6`; `0` disables).
- Reviewer mode: `--read-only`, `--clean`, `--no-session`, `--effort <level>`, `--standard-speed` (see below; `run` takes them too).

The success event `spawned` records `pid`, `provider`, `agent`, the injected
`files`, and the resolved `manifests` so later spectators can audit context.

## Reviewer Mode

Five switches on both `spawn` and `run`. With none of them the worker launches
exactly as before (claude with full permissions; codex in `workspace-write`, or
whatever `--sandbox` says; pi with its default tools, writable; omp with `--approval-mode yolo` and no UI, so a
tool that would need approval fails instead of waiting). A cross-model reviewer turns on `--read-only`,
`--clean`, `--no-session` and `--standard-speed` together.

| Switch | Meaning | claude | codex | pi | omp |
|---|---|---|---|---|---|
| `--read-only` | may read, may not write or run commands | `--permission-mode dontAsk --tools Read,Grep,Glob` (no Bash) instead of the bypass pair | thread `sandbox: "read-only"` | `--tools read,grep,find,ls` | `--tools read,grep,glob --approval-mode always-ask`; overlay `tools.xdev: false` |
| `--clean` | ignore the user's and project's settings, hooks, MCP, plugins, skills, project instruction files | `--safe-mode --restricted --strict-mcp-config`; file reads limited to `--cwd` | thread config: project untrusted + `project_doc_max_bytes: 0`, hooks / plugins / apps off, every MCP server from `config/read` disabled, skills off, `notify: []` | `--no-extensions --no-mcp --no-skills --no-prompt-templates --no-themes --no-context-files --no-approve` | `--no-extensions --no-skills --no-rules --no-lsp --no-title`; overlay `disabledProviders` switches off context files (`AGENTS.md`, `CLAUDE.md`), MCP and other tools' plugins |
| `--no-session` | leave no session record; the worker cannot be resumed | `--no-session-persistence` | thread `ephemeral: true` | `--no-session` | `--no-session` |
| `--effort <level>` | thinking effort, in the tool's own levels | `--effort`; `low` `medium` `high` `xhigh` `max` `ultracode` | `model_reasoning_effort`; `none` `minimal` `low` `medium` `high` `xhigh` `max` `ultra` `persistent` | `--thinking`; `off` `minimal` `low` `medium` `high` `xhigh` `max`, and only the ones the model has | `--thinking`; same levels as pi, only the ones the model has; never `auto` |
| `--standard-speed` | do not use the fast tier the user set for this tool | `--settings '{"fastMode":false}'` | `service_tier: "default"` | nothing to pass (pi has no fast-tier setting) | overlay `tier.openai` / `tier.anthropic` / `tier.google: none`, `providers.fireworksTier: standard` |

omp reads the "overlay" from a settings file the supervisor writes for each
launch (`<worker>.config-overlay.yml`, passed as `--config`); no switch, no file.
As a reviewer (`--read-only` with `--clean`) omp must not reach for another
model: `--model` is passed together with `--smol`, `--slow` and `--plan`, and the
overlay pins every chat role (`default` `smol` `slow` `plan` `vision` `commit`
`tiny` `memory` `task` `advisor`, plus `judge`) to that model whatever the
user's own roles say, and turns off `retry.modelFallback`, TTSR and compaction.
An ordinary omp helper gets `--model` only when one was given (otherwise omp's
own default). Messages that start with `/` are sent with a leading space, or omp
would run them as its built-in commands.

Refused before anything launches (no silent downgrade):

- an effort level the tool does not have — Claude Code and pi would only warn and use their default, Codex would send it unchanged;
- omp `--effort auto` — omp would ask its judge model to pick a level for every request;
- a pi or omp level the chosen model lacks (both would silently use the nearest one): the handshake asks the tool `get_available_thinking_levels` and stops before any message is sent;
- claude `--clean` without `--read-only` — restricted mode refuses the full-permission mode;
- codex `--read-only` with `--sandbox workspace-write` / `danger-full-access`;
- pi or omp `--resume` with `--no-session` — an unsaved session cannot be resumed;
- omp `--read-only` with `--clean` but no `--model` — the helper roles cannot be pinned.

Known limits:

- claude `--read-only` alone still loads the user's own allow rules and hooks from their settings files, which can widen what the worker may do (for example read outside the cwd). Add `--clean` to drop them.
- pi and omp `--read-only` alone keep MCP and extension tools (`--tools` does not filter them). Add `--clean` to drop them.
- codex `--clean` cannot switch off the user-level `~/.codex/AGENTS.md`. The thread's `instructionSources` (the instruction files it actually loaded) are recorded as a `progress` event with `detail.kind: "instruction_sources"`.

## Agent Cards

`--agent <name>` resolves to `.atw/agents/<name>.md`. The card name must
match `[A-Za-z0-9._-]+`. The default ATW install ships two cards:

- `.atw/agents/review.md` — code-quality reviewer.
- `.atw/agents/implement-agent.md` — coding worker for implementation runs.

```yaml
---
name: review
description: Code quality check expert.
provider: claude
---
```

Frontmatter fields populate `spawn` defaults (provider, model, `as`); the
markdown body becomes the worker's system-prompt role. Cards do **not**
auto-attach task files — context must be injected explicitly per spawn (see
below).

Always inspect project cards before spawning a named agent:

```bash
ls .atw/agents
sed -n '1,100p' .atw/agents/review.md
```

## Context Injection

Two flags inject content into the worker's system prompt under a
`# CONTEXT FILES` block, assembled by `context-loader`:

- `--file <path>` — repeatable, glob-supported (`*`, `**`). Each match is
  read and concatenated.
- `--jsonl <path>` — repeatable ATW manifest where every line is
  `{"file":"<path>","reason":"<why>"}`. The reason is preserved as a header
  comment above each file's content.

Limits enforced by the loader:

- 1 MB hard cap per file (oversize → error).
- 200 KB per-file warning to stderr.
- 500 KB total assembled-context warning to stderr.
- Path-traversal jail: all resolved paths must stay under `--cwd`.

Example spawning a review agent against a task directory:

```bash
TASK=.atw/tasks/05-13-example
atw channel spawn cr-example --agent review --provider codex --as review-cx \
  --file "$TASK/prd.md" \
  --jsonl "$TASK/check.jsonl" \
  --cwd "$PWD" --timeout 30m
```

The `spawned` event records both the literal `files` array and any `manifests`
expanded from `--jsonl`, so the audit trail captures whatever the worker was
actually shown.

## Names And Routing

`--as` has two meanings:

- `send` / `wait` / `interrupt`: speaker identity (author of the resulting event).
- `spawn`: the worker handle that other agents address with `--to`.

Use explicit names when multiple workers or providers participate in one
channel:

```bash
atw channel spawn cr-feature --agent review --as review-claude
atw channel spawn cr-feature --agent review --provider codex --as review-cx

atw channel wait cr-feature --as main \
  --from review-claude,review-cx --kind done --all --timeout 15m
```

`--all` requires `--from` and blocks until every listed worker has produced a
matching event; timeout exits with code **124** and prints
`timeout: still waiting on ...` to stderr.

## Soft Interrupt — `interrupt`

`channel interrupt` is the cooperative redirect: it appends an `interrupt`
event (reason `"user"`) and, where the adapter supports it, issues a
provider-level turn interrupt with a replacement instruction. Use it when the
worker should drop its current turn and act on new input immediately, without
losing its session.

```bash
echo "Stop refactoring the parser — switch to fixing the failing test in src/foo.ts" \
  | atw channel interrupt impl-task --as dispatcher --to codex-impl --stdin
```

Flags:

- `--as <agent>` **(required)** — caller identity.
- `--to <agent>` **(required)** — target worker.
- `--scope <project|global>` — channel scope.
- `--stdin` / `--text-file <path>` / `[text]` — replacement instruction body.

The appended event has `kind: "interrupt"` — downstream `wait` / `messages`
filters can subscribe with `--kind interrupt` to react to redirections (e.g.
to log the rerouting, or to gate other workers behind a coordinator's
correction).

For low-priority hints that should wait for the worker's next turn, send a
plain tagged message instead:

```bash
echo "Check this when you reach the next turn." \
  | atw channel send impl-task --as dispatcher --to codex-impl \
      --stdin --tag question
```

## Hard Interrupt — `kill` + `--resume`

Use `kill` when the worker must stop **now** (e.g. runaway loop, bad
instructions already in flight, or `interrupt` is not honored by the
adapter). The supervisor escalates SIGTERM → 8 s grace → SIGKILL; the CLI
writes a `killed` event when SIGKILL is needed so the event log stays
truthful.

```bash
atw channel kill impl-task --as codex-impl
atw channel spawn impl-task --as codex-impl --provider codex \
  --resume "$(cat ~/.atw/channels/<bucket>/impl-task/worker.session-id)"

echo "STOP — new instructions: ..." \
  | atw channel send impl-task --as dispatcher --to codex-impl --stdin
```

`kill` flags:

- `--as <agent>` **(required)** — names the worker (positional `<name>` is the channel).
- `--scope <project|global>`.
- `--force` — SIGKILL immediately (also kills the inner worker pid).

Side effects: cleans `pid`, `worker-pid`, `config`, `spawnlock` sidecar
files; keeps `log`, `session-id`, `thread-id` for forensics and resume.

When `interrupt` will not converge, kill + `--resume` is the guaranteed
redirection path.

## Worker OOM Guard

The OOM guard prevents orphaned/idle workers from accumulating and exhausting
host resources. It runs at every `spawn` and enforces two policies per
project bucket:

- **Idle TTL** — sweep workers whose last activity is older than the
  configured threshold (default `5m`; `0` disables).
- **Live-worker budget** — refuse the new spawn if more than N workers are
  already alive in the same project bucket (default `6`; `0` disables).

Precedence (highest first):

1. CLI flags: `--idle-timeout`, `--max-live-workers` on `spawn`.
2. Environment variables: `ATW_CHANNEL_WORKER_IDLE_TIMEOUT`,
   `ATW_CHANNEL_MAX_LIVE_WORKERS`.
3. `.atw/config.yaml` under `channel.worker_guard`.
4. Built-in defaults (`5m`, `6`).

Cleanup notices are written to stderr at spawn time so operators can see which
idle workers were swept and why a new spawn was rejected. The guard does not
touch ephemeral / `channel run` workers any differently — they are subject to
the same idle TTL and budget.

To audit current state, list workers via `channel list` (the `WORKERS`
column) and inspect per-channel `pid` / `worker-pid` sidecar files under
`~/.atw/channels/<bucket>/<channel>/`.

## Worker Inbox APIs

The inbox is the channel surface workers wake on. Routing is controlled by
two knobs:

- **Inbox policy** (`spawn --inbox-policy`):
  - `explicitOnly` (default) — worker only wakes on `send --to <worker>` or
    `interrupt --to <worker>`.
  - `broadcastAndExplicit` — also wakes on broadcasts (`send` with no `--to`).
- **Delivery mode** (`send --delivery-mode`):
  - `appendOnly` — append the event regardless of worker state.
  - `requireKnownWorker` — fail if no worker named in `--to` was ever spawned.
  - `requireRunningWorker` — fail if the named worker is not currently alive.

Stricter delivery modes prevent silent message loss when callers expect a
running peer.

Inbox-relevant subcommands:

- `send <channel> [text]` — append a `message` event.
  - `--as <agent>` **(required)** — author.
  - `--to <agents>` — CSV; one → string, many → array; broadcast if omitted.
  - `--stdin` / `--text-file <path>` / `[text]` — body source.
  - `--delivery-mode <appendOnly|requireKnownWorker|requireRunningWorker>`.
- `interrupt <channel> [text]` — soft-interrupt redirect (see above).
- `wait <channel>` — block until matching events arrive.
  - `--as <agent>` **(required)** — `self` for filter context.
  - `--from <agents>` — CSV authors.
  - `--kind <kind[,kind...]>` — CSV (OR semantics); supports `interrupt`,
    `done`, `progress`, etc.
  - `--to <target>` — defaults to own agent (broadcast + explicit-to-me).
  - `--include-progress` — also wake on progress events.
  - `--all` — require every `--from` agent to match (timeout → exit **124**).
  - `--timeout <duration>` — `30s` / `2m` / `1h` / `1000ms`.
- `messages <channel>` — view / filter / follow the event stream.
  - `--follow` to tail, `--kind` / `--from` / `--to` to filter, `--raw` for
    JSON-per-line, `--no-progress` to hide progress noise.

A typical dispatcher loop:

```bash
# 1. Wake the worker.
echo "Run the failing test and report." \
  | atw channel send impl-task --as dispatcher --to codex-impl --stdin \
      --delivery-mode requireRunningWorker

# 2. Block until it finishes.
atw channel wait impl-task --as dispatcher \
  --from codex-impl --kind done,error --timeout 30m

# 3. Read the final answer.
atw channel messages impl-task --from codex-impl --last 1 --raw
```

All event-emitting subcommands (`send`, `interrupt`, `post`, `context add` /
`delete`, `title set` / `clear`, `thread rename`) print the appended event as
a single JSON line on stdout, making the inbox layer easy to script against.
