---
name: atw-implement-spec
description: "把 atw-spec 和 atw-tickets 的产出一次性实现完：按工单的阻塞关系并行派出实现子代理，全部汇到同一条集成分支，最后统一审查。"
disable-model-invocation: true
---

You have been provided a spec. This spec should have tickets associated with it, describing how to implement the spec.

The issue tracker should have been provided to you. If not, tell the user to run `/atw-init-repo`.

This skill runs on sub-agents. On a platform that cannot dispatch them, stop and tell the user to run `/atw-implement` once per ticket instead.

The goal is the entire spec implemented on a single **integration branch**, with every ticket resolved the way the issue tracker closes work.

The tickets are not a list of steps. They are a **task graph** with blocking relationships between them. This means there is always a **frontier** of tickets which are ready to be grabbed.

Communication to and from subagents should be sparse. Communicate primarily through **context pointers** — to the spec, tickets, research notes, and previous commits. Don't duplicate information already available via pointers.

**Implementer subagents** should be run in the background where possible for maximum concurrency. Where the platform runs sub-agents one at a time the run still completes, one ticket after another.

## Ticket state

You are the only writer of ticket state. No subagent edits a ticket file, or anything else the tracker owns.

Mark a ticket in progress before dispatching its implementer, and done once its work has merged into the integration branch, using the tracker doc's ticket operations. On an ATW task directory (`.atw/scripts/tickets.py` exists):

```bash
python3 .atw/scripts/tickets.py frontier               # what can start now
python3 .atw/scripts/tickets.py claim <NN> --parallel  # before dispatching its implementer
python3 .atw/scripts/tickets.py done <NN>              # after its merge lands
```

`--parallel` is what lets several tickets be in progress at once; a plain `claim` refuses the second one. Leave these ticket-state edits uncommitted while implementers are running — a new commit on the integration branch between an implementer's last merge and its landing costs it another merge — and commit them once, at close-out.

## Steps

1. Read the spec and tickets to understand the task graph.

2. (optional) Use an **exploration subagent** to conduct any exploration required by the tickets — relevant codebase files or external documentation. It saves its markdown notes where the tracker doc puts research notes, or in a directory outside the repo when the tracker doc names no such place. This lets **implementer subagents** focus on implementation rather than exploration.

3. Create the integration branch, named after the task. Commit the spec, the tickets, and any exploration notes saved in the repo to it first: a worktree holds only what git tracks, so an uncommitted ticket is invisible to its implementer. On an ATW task directory, record the branch with `python3 .atw/scripts/task.py set-branch <task-dir> <branch>`. If the issue tracker closes work through PRs, or the user asks for one, open a draft PR after the first merge in step 5 (a branch with no commits ahead of main can't open one), marked as closing the spec and tickets.

4. Use **implementer subagents** to implement each frontier ticket, each in its own worktree on its own branch. Dispatch a general-purpose sub-agent with the brief below — not the `atw-implement-agent` role, which may not commit. Each implementer subagent:
   - confirms its worktree is based on the integration branch before starting, and resets onto it if not;
   - calls the Skill tool with "atw-tdd" to build the ticket;
   - builds any part that changes what a user sees by calling the Skill tool with "atw-ui", and captures a screenshot into the task directory's `screenshots/` for each UI acceptance criterion (screen, state, viewport in the file name);
   - commits to its own branch, and merges the integration branch tip into that branch before reporting done.

5. Once an **implementer subagent** completes, merge its work to the integration branch with a **merger subagent**, then mark the ticket done.

6. If this changes the **frontier** of available tickets, kick off more **implementer subagents** to work on the new tickets. This allows for maximum concurrency.

7. Once all tickets are complete, call the Skill tool with "atw-code-review" on the integration branch, with the commit the branch started from as the fixed point and any captured screenshots passed for its Visual axis. Relay the review reports to the user as written. Fix all issues raised by the code review in a single **implementer subagent**. Then re-check **only the findings that were fixed**, once. Do not start a second full review, and do not loop: anything still open after that one re-check goes to the user.

8. Call the Skill tool with "atw-update-spec" to fold what actually got built back into the spec, then commit — the ticket-state edits ride in this commit.

9. If a draft PR exists, mark it ready for review. Otherwise, resolve each ticket the way the issue tracker closes work, and report the integration branch.

10. Clean up all **implementer subagent** worktrees.

## Implementer brief

Every dispatch prompt starts with `Active task: <task path>` when the repo runs the ATW task system, then states the role, then gives pointers — nothing more:

- "You are an implementer subagent dispatched by `/atw-implement-spec`. Do the work yourself; do not dispatch sub-agents, and do not run a code review — the orchestrator reviews the integration branch once, at the end."
- the integration branch name, and the worktree and branch to work in;
- pointers to the spec, its one ticket, the exploration notes, and the coding-standards files the review will hold the work to;
- the rules from step 4;
- "Do not edit any ticket file or tracker state. Stay inside this ticket's slice; if the ticket cannot be finished as written, stop and report why instead of widening it."

## When to stop

Stop dispatching and report to the user — letting implementers already running finish, and keeping everything already merged — when:

- an implementer reports its ticket cannot be finished as written, or the spec is wrong or self-contradictory;
- a merge conflict cannot be resolved by the intent of both sides;
- the test suite cannot be made to pass on the integration branch.

Say what happened, which tickets are done, in progress, and untouched, and what decision is needed. Do not paper over it and do not rewrite a ticket to make it fit.
