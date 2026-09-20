# Continue Current Task

Resume work on the current task — pick up at the right phase/step in `.atw/workflow.md`.

---

## Step 1: Load Current Context

```bash
python3 ./.atw/scripts/get_context.py
```

Confirms: current task, git state, recent commits.

## Step 2: Load the Phase Index

```bash
python3 ./.atw/scripts/get_context.py --mode phase
```

Shows the Phase Index (Plan / Execute / Finish) with routing + skill mapping.

## Step 3: Decide Where You Are

`get_context.py` shows the active task's `status` field. The stage *is* the route — each of the six stages maps to one place in the workflow, so read `status` first and only look at artifacts where a row below asks you to. This command replaces the user needing to remember the ATW flow; it does not itself approve implementation.

- `status=discover` → **1.1**. Work the open questions: `/atw-askme` (or `/atw-askme-with-docs` when the answer lives in project docs), `/atw-map` when the route is unclear, `/atw-prototype` for a design question, `/atw-research` for external unknowns. Advance with `task.py set-status <task> specify` once nothing you raised this session is still unanswered — that one is not a stop.
- `status=specify` + no `prd.md` → **1.2** (`/atw-spec` turns the discover findings into `prd.md`)
- `status=specify` + `prd.md` exists → **1.3**. Sub-agent-dispatch platforms curate `check.jsonl` (empty, or only a legacy `_example` placeholder row, counts as uncurated); inline platforms skip. Then **stop ②** — the user confirms `prd.md` before anything advances. After that: `task.py set-status <task> slice` if the work needs tickets, otherwise straight to **1.5**.
- `status=slice` → **1.4** (`/atw-tickets`). Every ticket needs `**Impl:** ready` and a `**Blocked by:**` line. When they are written, run `task.py start <task>` (**1.5**).
- `status=implement` → **2.1**. `tickets.py frontier` → `tickets.py claim NN` (never two at `doing`) → **stop ③**: the user runs `/atw-implement`; you may not invoke it or inline the work → relay both review reports verbatim → `tickets.py done NN`. Frontier empty → `task.py set-status <task> accept`.
- `status=accept` → **3.1**. Read-only: file anything you notice instead of fixing it. Walk the `prd.md` acceptance criteria with evidence, confirm `tickets.py summary` is all `done` and `git status --porcelain` is clean, then **stop ④** and wait for the user to accept. Once accepted, `task.py archive <task>` (**3.2**).
- `status=completed` on a task still under `.atw/tasks/` → **3.2, unfinished**. `task.py archive` writes `completed` first, then re-parents children, then moves the directory — and it does not roll back, so a task sitting here with this status means the archive was interrupted partway. Re-run `task.py archive <task>` to finish it: every step before the move is idempotent, so the re-run redoes them and completes the move.

Phase rules (full detail in `.atw/workflow.md`):

1. Run steps **in order** within a phase — `[required]` steps must not be skipped
2. `[once]` steps are already done if the required output exists. `prd.md` is the one required Phase 1 artifact.
3. Stages roll back: if implement exposes a spec defect, `task.py set-status <task> specify`, fix `prd.md`, then come back

## Step 4: Load the Specific Step

Once you know which step to resume at:

```bash
python3 ./.atw/scripts/get_context.py --mode phase --step <X.X> --platform pi
```

Follow the loaded instructions. After each `[required]` step completes, move to the next.

---

## Reference

Full workflow and detailed phase steps live in `.atw/workflow.md`. This command is only an entry point — the canonical guidance is there.
