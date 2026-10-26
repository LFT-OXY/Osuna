# Issue tracker: ATW task directory + GitHub

This repo tracks work in the ATW task system. Work is split across two places, and which one you use depends on **who raised the item**:

| What | Where | Who triages it |
|---|---|---|
| Issues and PRs other people raised | GitHub Issues (`gh` CLI) | `atw-triage` runs here |
| The spec and implementation tickets for the task you are working on now | The current ATW task directory | Nobody — these are agent-ready by construction |

The task directory is the **authority**. Its contents are synced one-way out to GitHub as a mirror; never edit the mirror and expect it to come back.

## Resolving the current task directory

Every path below is relative to the active task. Resolve it first:

```bash
TASK=$(python3 .atw/scripts/task.py current)
```

Bare `current` prints the repo-relative task directory. It **exits non-zero when there is no active task** — when that happens, stop and ask the user to create or start one. Do not fall back to `.scratch/`.

## Conventions

- **Spec**: `$TASK/prd.md`. Write the whole file; the skeleton `task.py create` wrote is meant to be overwritten. ATW treats the file as opaque text and parses nothing inside it.
- **Implementation tickets**: one file per ticket at `$TASK/issues/<NN>-<slug>.md`, numbered from `01` in dependency order.
- **Research notes**: `$TASK/research/<topic>.md`, one file per topic.
- **Triage state**: not used on tickets in the task directory — see the `Status:` note below.
- Comments and conversation history live on the mirrored GitHub issue, not in the file.

## Ticket file fields

On top of the standard ticket template, tickets here carry two extra lines:

```markdown
# 01 — Ticket title

**What to build:** the end-to-end behaviour this ticket makes work.

**Blocked by:** None
**Status:** ready-for-agent
**Impl:** ready
**Issue:**
```

| Field | Vocabulary | Who writes it |
|---|---|---|
| `Status:` | triage roles (see `triage-labels.md`) | The slicer, when it writes the ticket. Default `ready-for-agent`: these tickets are ones you sliced yourself, so they never go through triage. Set `ready-for-human` on a ticket a person must do — it needs an external account, a manual test pass, or a design or legal decision. Neither `/atw-implement-spec` nor `/atw-implement-all` dispatches such a ticket: both list it apart and stop when only those are left; `/atw-implement` confirms with the user before touching code — they do it themselves, or explicitly authorize the AI. `tickets.py frontier --agent-only` reads this field and lists `ready-for-human` tickets apart from the workable ones; a ticket without the line counts as `ready-for-agent`. `claim`, `done` and `summary` do not read it, so a human ticket the user finished is closed like any other. Two `tickets.py` commands also write it: `skip` sets `ready-for-human` on a ticket an unattended run gives up on, and `handback` sets it back to `ready-for-agent` once the user has decided. |
| `Impl:` | `ready` / `doing` / `done` | `tickets.py`. This is the field the workflow actually routes on, and the only field the parser requires. |
| `Issue:` | `#58`, or empty | Filled in by `github_sync.py sync-tickets`; it is also the only ticket ↔ remote-issue mapping, so there is no separate mapping table. |

`Status:` and `Impl:` are deliberately separate. `Status:` answers "is this ticket clear enough, and who should pick it up"; `Impl:` answers "how far along is it". Folding implementation progress into `Status:` puts three unrelated vocabularies in one slot.

## When a skill says "publish to the issue tracker"

| Artifact | Destination | Then |
|---|---|---|
| A spec | `$TASK/prd.md` | `TASK_JSON_PATH=$TASK/task.json python3 .atw/scripts/github_sync.py sync-spec` |
| Implementation tickets | `$TASK/issues/<NN>-<slug>.md` | `TASK_JSON_PATH=$TASK/task.json python3 .atw/scripts/github_sync.py sync-tickets` |

ATW fires lifecycle hooks only on task create / start / finish / archive — **there is no event for "a file was written"**, so the sync step above is something you run, not something that happens for you. It exits non-zero when it can't sync, because you asked for it explicitly; the `create` / `archive` hook path warns and exits 0 instead, so a sync failure never blocks creating or archiving a task.

Do not apply a triage label when publishing here; these artifacts don't enter the triage queue.

## When a skill says "fetch the relevant ticket"

- A number like `01` or a filename → read `$TASK/issues/<NN>-*.md`.
- A `#NN` GitHub reference → `gh issue view <NN>`. If it mirrors a local ticket, prefer the local file — that's the authority.
- No reference given → `python3 .atw/scripts/tickets.py frontier` and take the ticket currently at `Impl: doing`, or the first frontier ticket if none is claimed.

## Ticket operations

```bash
python3 .atw/scripts/tickets.py list        # all tickets + Impl state
python3 .atw/scripts/tickets.py frontier    # Impl: ready with all blockers done
python3 .atw/scripts/tickets.py frontier --agent-only  # the same, minus Status: ready-for-human tickets, listed apart
python3 .atw/scripts/tickets.py claim <NN>  # → Impl: doing
python3 .atw/scripts/tickets.py done <NN>   # → Impl: done
python3 .atw/scripts/tickets.py claim <NN> --parallel  # → Impl: doing, alongside others (`/atw-implement-spec` only)
python3 .atw/scripts/tickets.py revert <NN>  # revert commits since the claim; task directory kept as it was
python3 .atw/scripts/tickets.py revert <NN> --with-uncommitted  # serial only: first record uncommitted changes outside the task directory as commits, then revert them too
python3 .atw/scripts/tickets.py revert <NN> --merge <sha>  # parallel batch: revert that merge (first parent)
python3 .atw/scripts/tickets.py skip <NN> --reason <why> --log-time <time>  # → Impl: ready, Status: ready-for-human, reason under ## Comments
python3 .atw/scripts/tickets.py handback <NN> --decision <text>  # → Status: ready-for-agent, decision under ## Comments
```

`claim` refuses tickets that aren't on the frontier, and the parser rejects blocker references that don't exist or form a cycle. `claim` also records `implementation_base_sha` and writes the ticket's path into `$TASK/check.jsonl`, which is what review sub-agents read to know which ticket is live; `done` withdraws that line.

**Tickets run one at a time by default.** `claim` hard-rejects a second ticket while another is at `Impl: doing`, but that check is read-then-write — it is serial execution, not an atomic exclusive claim. Don't run two implementers against one task directory by hand.

**The one parallel path is `/atw-implement-spec`.** Its orchestrator claims with `--parallel`, which lets several tickets sit at `Impl: doing`, records `implementation_base_sha` once for the whole run, and writes no current-ticket line into `$TASK/check.jsonl` — there is no single live ticket. Only the orchestrator writes ticket state; each implementer works in its own worktree.

`/atw-implement-all` is not a second parallel path: its orchestrator claims with plain `claim <NN>`, one ticket at `Impl: doing` at a time, so the current-ticket line and `implementation_base_sha` are recorded per ticket exactly as on the per-ticket path. It too is the only writer of ticket state; its implementers work in place on the current branch.

## Wayfinding operations

Used by `atw-map`. A map is a **discover-phase** artifact and lives in the task directory alongside everything else.

- **Map**: `$TASK/map.md` — the Notes / Decisions-so-far / Fog body.
- **Child ticket**: `$TASK/map-issues/NN-<slug>.md`, numbered from `01`, with the question in the body. A `Type:` line records the ticket type (`research`/`prototype`/`interview`/`task`); a `Status:` line records `claimed`/`resolved`.
- **Blocking**: a `Blocked by: NN, NN` line near the top. A ticket is unblocked when every file it lists is `resolved`.
- **Frontier**: scan `$TASK/map-issues/` for files that are open, unblocked, and unclaimed; first by number wins.
- **Claim**: set `Status: claimed` and save before any work.
- **Resolve**: append the answer under an `## Answer` heading, set `Status: resolved`, then append a context pointer to Decisions-so-far in `map.md`.

Decision tickets live in `map-issues/`, **not** `issues/`. They are questions whose resolution is a decision; `issues/` holds slices of a build to execute. They use different state vocabularies (`claimed`/`resolved` vs `Impl:`), and `tickets.py` only reads `issues/`. Mixing them makes the frontier calculation wrong in both directions.

Map child tickets are not synced to GitHub — they are working notes for one effort's discover phase, and they resolve fast.

## What is *not* tracked here

These stay at the repo root, unchanged:

```text
docs/adr/          architecture decisions          atw-domain-modeling
GLOSSARY.md        domain glossary                 atw-domain-modeling
.out-of-scope/     rejected-concept records        atw-triage
.atw/spec/         layered coding standards        ATW's own spec flow
```

They outlive any single task, so they don't belong in a directory that gets archived.
