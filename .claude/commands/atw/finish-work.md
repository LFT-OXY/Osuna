# Finish Work

**Skill notes.** Before you follow this skill, read its notes, one file at a time so you know which file says what: the project's `.atw/skill-notes/atw-finish-work.md` and the personal `~/.atw/skill-notes/atw-finish-work.md`; a missing file means that layer has no notes. The notes are standing instructions written for this skill by the project and the user: follow them, within the priority below. When both exist and disagree, the project's notes win. Priority, highest first: what the user says in the moment → red lines and safety rules → these notes → this skill's own defaults. Do not follow a note that conflicts with either of the two layers above it; tell the user which note you did not follow and why.

Wrap up the current session: archive the active task (and any other completed-but-unarchived tasks the user wants to clean up) and record the session journal. Code commits are NOT done here — the `implement` stage commits as it goes, one ticket at a time, before the task ever reaches this command.

## Step 1: Survey current state

```bash
python3 ./.atw/scripts/get_context.py --mode record
```

This prints:

- **My active tasks** — review whether any besides the current one are actually done (code merged, AC met) and should be archived this round.
- **Git status** — quick visual on what's dirty.
- **Recent commits** — you'll need their hashes in Step 4 for `--commit`.

If `--mode record` surfaces other completed tasks not tied to the current session, surface them to the user with a one-shot confirmation: "These N tasks look done — archive them too in this round? [y/N]". Default is no; the current active task is always archived in Step 3 regardless.

## Step 2: Sanity check — classify dirty paths

Run:

```bash
git status --porcelain
```

Filter out paths under `.atw/workspace/` and `.atw/tasks/` — those are managed by `add_session.py` and `task.py archive` auto-commits and will appear dirty as part of this skill's own work.

For each remaining dirty path, decide whether it belongs to **the current task** or to **other parallel work** (e.g., another terminal window editing the same repo). Heuristics:

- Paths referenced in the current task's `prd.md` / `implement.jsonl` / `check.jsonl` → current task
- Paths in code areas matching the task's stated scope, or that you remember editing this session → current task
- Paths in unrelated areas you have no recollection of touching this session → other parallel work

Then route:

- **Any remaining path looks like current-task work** — bail out. There is no wrap-up commit step: committing belongs to the `implement` stage, inside the per-ticket chain. Which exit applies depends on whether tickets are left:
  > "Working tree has uncommitted code changes from this task: `<list>`."
  >
  > - `tickets.py frontier` still returns a ticket → "Run `task.py set-status <task> implement` and finish that ticket — its chain commits as it goes."
  > - No tickets left (or the task never had any) → "These are loose end-of-task changes. Commit them yourself, then re-run `/atw:finish-work`."

  Do NOT run `git commit` here and do NOT drive the commit for the user. Loose uncommitted changes at wrap-up are an error state, not a workflow stage — the right handling is to stop and say so, not to invent a step for them.
- **All remaining paths look unrelated** (other parallel-window work) — report them once and continue to Step 3:
  > "FYI, dirty files outside this task's scope — leaving them for the other window: `<list>`."
- **Genuinely unsure** — ask the user once: "Are `<list>` this task's work I forgot to commit, or another window's? (commit / ignore)" — then route per their answer.

## Step 3: Archive task(s)

```bash
python3 ./.atw/scripts/task.py archive <task-name>
```

At minimum: the current active task (if any). Plus any extra tasks the user confirmed in Step 1. Each archive produces a `chore(task): archive ...` commit via the script's auto-commit — unless the task's `standing-orders.md` has an order on commit messages: then pass `--no-commit` and commit the move yourself as the order says (`.atw/workflow.md` 3.2).

If there is no active task and the user did not confirm any cleanup archives, skip this step.

Right after a `task.py archive` that moved a task under `archive/`, add one sentence that the user can look back over this conversation for what to improve (复盘), with the input for their current tool only — the one line below that names that tool:

- Claude Code: `/atw-reflect`
- Codex: `$atw-reflect`
- pi: `/skill:atw-reflect`
- omp: `/skill:atw-reflect`

You never start it yourself. Once per task: an archive moves a task only once, so this comes once per task; several tasks archived in this step share one sentence. Say it once in the reply that reports the archive, in the part about the archive, not again where the reply wraps up.

## Step 4: Record session journal

```bash
python3 ./.atw/scripts/add_session.py \
  --title "Session Title" \
  --commit "hash1,hash2" \
  --summary "Brief summary"
```

Use the work-commit hashes produced by the `implement` stage (visible in Step 1's `Recent commits` list, or via `git log --oneline`) for `--commit`. Do not include the archive commit hashes from Step 3. This produces a `chore: record journal` commit.

Final git log order: `<work commits from the implement chain>` → `chore(task): archive ...` (one or more) → `chore: record journal`.
