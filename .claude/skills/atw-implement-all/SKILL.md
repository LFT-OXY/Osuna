---
name: atw-implement-all
description: "把切好工单的规格一次串行做完：主会话当指挥者，按前沿逐张派出实现子代理，每张票在主会话里审查、处理发现、回写 spec、关单、提交状态；可选 --max N 干净停，停下后再跑同一条命令从断点续上。"
disable-model-invocation: true
---

You have been provided a spec sliced into tickets on an ATW task. This skill is the third way through stop ③: the user runs it once, and you — the main session — become the **orchestrator**. You work the ticket frontier one ticket at a time, dispatching one **implementer sub-agent** per ticket, and you run every ticket's review, findings, spec write-back, close-out and state commit yourself, in this session. It is the per-ticket `/atw-implement` chain with the "press start" removed — not the parallel `/atw-implement-spec` run: no worktrees, no integration branch, no merger, and a review per ticket instead of one at the end.

Only the user starts this skill. You never invoke it yourself.

This skill needs an ATW task directory (`.atw/scripts/tickets.py` exists). If it does not, tell the user to run `/atw-init-repo`.

## Before the first ticket

Check in this order, and stop with the named pointer when a check fails:

- The current task (`python3 .atw/scripts/task.py current`) is in the `implement` stage.
- The task has an `issues/` directory with tickets. A task with no tickets has only `/atw-implement`; tell the user to run that instead.
- When no ticket is at `**Impl:** doing`, the working tree is clean (`git status --porcelain` prints nothing). An uncommitted change belongs to nobody once implementers start committing; ask the user to commit or discard it first. With one ticket at `doing`, uncommitted changes are that ticket's breakpoint and are left for the resumed implementer (see "Resuming").
- The platform can dispatch sub-agents. On one that cannot, tell the user to run `/atw-implement` once per ticket.
- Either `tickets.py frontier` is non-empty, or exactly one ticket is at `**Impl:** doing` (see "Resuming"). Two or more at `doing` while the task's `meta.ticket_mode` is not `parallel` is a contradiction: stop and let the user sort it out; do not guess. Two or more at `doing` with `ticket_mode` set to `parallel` belong to a `/atw-implement-spec` run: stop and tell the user to finish or resume that run instead.

## Arguments

The only argument is an optional `--max N`: close N tickets in this run, then stop cleanly and report. Nothing else is accepted — not a ticket number, not `--only`, not `--skip`. If the user passes any of those, say so and stop; the ticket to work next is always chosen by the rule below.

## Your role

You are the only writer of ticket state. No sub-agent edits a ticket file, `check.jsonl`, `task.json`, or anything else the tracker owns.

You write no code, you do not edit ticket content, and you do not do the implementation in the implementer's place. The whole of your job is: pick, claim, dispatch, relay questions, review, triage, write back, close, commit state, report.

The `- [ ]` checkboxes in the tickets and in `prd.md` are not yours either, and not the implementer's: they are ticked during the acceptance check (workflow.md 3.1), one at a time against the evidence. `tickets.py done` flips `**Impl:**` and nothing else; leave the boxes as they are.

Communication to and from the implementer is sparse. Communicate through **context pointers** — to the spec, the one ticket, the research notes — and never paste their contents into the prompt.

## The loop

For each ticket:

1. **Pick.** Run `python3 .atw/scripts/tickets.py frontier`. Take the lowest-numbered ticket whose `**Status:**` line is not `ready-for-human`. If the frontier holds only `ready-for-human` tickets, stop (see "When the run halts"). Read the ticket file before dispatching: if it is plainly human work the ticket forgot to label — an external account, a manual test pass, a design decision — stop the same way rather than dispatching it.

2. **Claim.** `python3 .atw/scripts/tickets.py claim <NN>` — the plain serial claim, never `--parallel`. This writes the current-ticket line into `check.jsonl` and records `implementation_base_sha` on the task; the review step depends on both.

3. **Dispatch** one general-purpose implementer sub-agent in the foreground, with the brief below. Not the `atw-implement-agent` role, which may not commit.

4. **Handle the report.**
   - It asks a question: ask the user, with your recommendation, then send the answer back to the same sub-agent and let it continue. On a platform that cannot continue a sub-agent, dispatch a fresh implementer with the answer added to the pointers.
   - It reports the ticket cannot be finished as written: the whole run stops (see "When the run halts").
   - It reports done with a commit: go on.

5. **Review.** Call the Skill tool with "atw-code-review", with the task's `implementation_base_sha` (`task.json` → `meta`) as the fixed point; when the implementer captured screenshots, pass their paths so the review runs its Visual axis. Relay every review report to the user as written — Standards and Spec, plus Visual when the ticket changed UI — even when the verdict is "nothing found". No report reaching you is not a passing review: re-run it.

6. **Triage** the findings by the table in workflow.md: spec-axis findings and standards-axis hard violations get fixed; judgement calls ship and are reported. Send the findings to fix back to the same implementer for one fix round that ends in a commit. Then re-check **only the findings that were fixed**, once. Do not start a second full review, and do not loop. Anything still open after that one re-check goes to the user — ship it, fix again, or change the spec — before you write the spec back.

7. **Write back and close.** Call the Skill tool with "atw-update-spec", then `python3 .atw/scripts/tickets.py done <NN>`, then commit the spec and ticket-state changes together. Every ticket leaves two kinds of commit on the branch: the implementer's code commit(s) and your state commit.

8. **Next.** If `--max N` was given and N tickets have been closed in this run, stop and report. Otherwise go back to step 1. When the frontier is empty and `tickets.py summary` shows every ticket `done`: `python3 .atw/scripts/task.py set-status <task-dir> accept`, then commit the `task.json` change as the run's last state commit, so the run ends on a clean tree. Then report; the task stage in the report is `accept`.

## Implementer brief

Every dispatch prompt starts with `Active task: <task path from task.py current>`, then states the role, then gives pointers and rules — nothing more:

- "You are an implementer sub-agent dispatched by `/atw-implement-all`. Stop ③ is already satisfied. Do the work yourself: do not dispatch sub-agents, and do not run a code review — the orchestrator reviews this ticket when you report."
- pointers to `prd.md`, this one ticket, `research/`, and the coding-standards files the review will hold the work to (the `check.jsonl` entries);
- work in place on the current branch — no worktree, no new branch;
- call the Skill tool with "atw-tdd" to build the ticket; build any part that changes what a user sees by calling the Skill tool with "atw-ui", and capture a screenshot into the task directory's `screenshots/` for each UI acceptance criterion (screen, state, viewport in the file name);
- run typechecking and single test files regularly, and the full suite once at the end;
- commit to the current branch yourself; do not hand a diff back;
- do not edit any ticket file or tracker state;
- make routine judgement calls yourself; stop and ask only when the ambiguity would change the result;
- if the ticket cannot be finished as written — the spec is wrong or self-contradictory, the fix needs a decision nobody has made, or it reaches outside this ticket's slice — stop and report why; do not widen the scope;
- report in under 200 words: what changed, test results, commit SHAs, screenshot paths if any, open questions.

A fix-round dispatch is the same brief plus the findings to fix, and ends in a commit the same way.

## Resuming

Stopping is always safe: every halt leaves the spec written back and the ticket state committed for every closed ticket, and the user resumes by running the same command again.

When the run starts with exactly one ticket at `**Impl:** doing`, that ticket is the breakpoint. Do not claim it again. Dispatch an implementer with the brief above plus the instruction to finish the ticket from the current git state and commit — untouched, it is implemented from scratch; changed but uncommitted, the work is finished and committed; already committed, there is nothing to do — then continue from step 4: the resumed implementer's report is handled like any other, and the review follows. The review's fixed point is the `implementation_base_sha` recorded at claim time, whichever way the earlier run broke off.

## When the run halts

The run comes back to the user in four situations, plus the `--max` count:

1. An implementer hits an ambiguity that would change the result → ask, with a recommendation, and continue after the answer.
2. A finding is still open after the one re-check → ask before writing the spec back, and continue after the answer.
3. An implementer reports its ticket cannot be finished as written → the run stops. Do not paper over it, do not rewrite the ticket to fit, do not widen the scope.
4. The frontier holds only `ready-for-human` tickets, or the next ticket is plainly human work → the run stops. Name the tickets that need the user, and say that the run continues once they are done with `/atw-implement`. Say also what the next run does: it starts from whatever state `/atw-implement` left — one ticket at `doing` (the per-ticket path may already have claimed the next frontier ticket) is resumed, not re-claimed (see "Resuming"); nothing at `doing` means the run claims from the frontier. Both ways in, the ticket is closed the same way: review, write-back, `done`, state commit.
5. `--max N` is reached → the run stops.

Every time the run halts — for a question in situations 1 and 2 as much as for a stop — and when it finishes, report one table with a row per ticket: number and title; state (`done`, `doing`, untouched); commit SHAs; review verdict per axis; what the user was asked. End with the task stage after the halt and the command that picks the run back up.
