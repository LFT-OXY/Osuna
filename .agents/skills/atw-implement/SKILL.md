---
name: atw-implement
description: "根据一份规格说明书或一组工单，照着把功能做出来，实现并完成一项工作。用户说「按规格做出来」「开始实现这组工单」时使用。"
disable-model-invocation: true
---

**Skill notes.** Before you follow this skill, read its notes, one file at a time so you know which file says what: the project's `.atw/skill-notes/atw-implement.md` and the personal `~/.atw/skill-notes/atw-implement.md`; a missing file means that layer has no notes. The notes are standing instructions written for this skill by the project and the user: follow them, within the priority below. When both exist and disagree, the project's notes win. Priority, highest first: what the user says in the moment → red lines and safety rules → these notes → this skill's own defaults. Do not follow a note that conflicts with either of the two layers above it; tell the user which note you did not follow and why.

Implement the work described by the user in the spec or tickets.

If the user passes a ticket reference, fetch it from the issue tracker and state its title before starting. If the reference is ambiguous, ask. If the tracker already marks a different ticket as in progress, stop and say so — don't switch tickets on your own.

Then, before touching any code, read the ticket's `**Status:**` line. `ready-for-human` means the slicer decided a person should do this ticket. Stop there: say the ticket is marked for a human, quote the reason the ticket gives, and ask the user to pick one of two things — they do it themselves, or they explicitly authorize you to do it in their place.

- Nothing short of an explicit yes counts. A question back, a vague answer or silence is not authorization: ask once more, or end the run.
- They do it themselves: tell them to run `python3 .atw/scripts/tickets.py done NN` when finished and commit that ticket-state change, so the tree is clean for the next run. This run ends there and changes no file.
- They authorize you: continue with the chain below. The commit you make at the end of it carries one extra line — `ready-for-human ticket implemented by AI with the user's authorization` — followed by the gist of what the user said, so the record shows who decided.

A task without tickets, or a run with no ticket reference, has no `Status:` line and this step does not apply.

Then check whether the task has `decision-log.md`. If it does, keep the log as "Decision log" below says; its start row goes in just before the first row this run logs, not now.

Call the Skill tool with "atw-tdd" where possible, at pre-agreed seams.

Run typechecking regularly, single test files regularly, and the full test suite once at the end.

If the work changes what a user sees, build that part by calling the Skill tool with "atw-ui" — logic stays test-first, the UI is verified on real screens. Capture screenshots into the task directory's `screenshots/` for each UI acceptance criterion (screen, state, viewport in the file name), and look at them before calling the work done.

Once done, call the Skill tool with "atw-code-review" to review the work. When screenshots were captured, pass their paths so the review runs its Visual axis.

Work the findings before committing. Fix what the review raised, then re-run the tests it touched. Then re-check **only the findings that were fixed**, once. Do not start a second full review, and do not loop: anything still open after that one re-check goes to the user.

**If the review surfaces a hard problem, stop** — the spec is wrong or self-contradictory, the fix needs a decision nobody has made, or it reaches outside this ticket's slice. Don't paper over it and don't silently widen the scope to absorb it. Say what the finding is and what it blocks, and get the decision from the user before writing more code. If the answer changes what the work is supposed to do, that change lands in the spec via the step below, not only in the code.

Then call the Skill tool with "atw-update-spec" to fold what actually got built back into the spec. The next review's Spec axis compares code against the spec, so a spec that lags behind the code makes that axis meaningless.

When the task has a decision log, do the log self-check (see "Decision log") before committing.

The `- [ ]` checkboxes in the tickets and in `prd.md` are not yours: they are ticked during the acceptance check (workflow.md 3.1), one at a time against the evidence. `tickets.py done` flips `**Impl:**` and nothing else; leave the boxes as they are.

Commit your work to the current branch.

## Decision log

A task's decision log is `decision-log.md` in its directory. Only you, the main session, write it — no sub-agent does. Every row goes through the script, never written by hand:

```bash
python3 .atw/scripts/decision_log.py start --lang <zh|en>
python3 .atw/scripts/decision_log.py add --phase "<ticket and step>" --decision "<what>" --why "<why>" --evidence "<pointer>" --result "<result>" [--mark needs-you|unsure]
python3 .atw/scripts/decision_log.py supersede --time <time of the wrong row> --phase … --decision … --why … --evidence … --result …
```

- **When the log is kept.** Every `/atw-implement-all` and `/atw-implement-spec` run; once the task has a `decision-log.md`, all later work on it is logged too — `/atw-implement`, fix tickets, the acceptance check, the archive; and from the moment the user explicitly asks for a decision log, in any stage — with no task, say the log has to live in a task and ask whether to create one. Planning — questions, the map, the spec, slicing — is never logged: those decisions are the user's, already written into `prd.md` and the tickets.
- **Start row.** Before touching code, check whether the task has `decision-log.md`. If it does not, this run writes no log — unless the user asks for one. If it does, the start row goes in just before the first row this run logs, not when the run begins: it is the first row of every run, the log's first run included, and the first `add` (or other writing command) writes it by itself when this conversation has none yet — or run `start` then; `--lang` follows the user's language and only takes effect when the log does not exist yet. Either way the script prints the last rows and whether another conversation wrote in between — read them before writing on. When another conversation has written since, the next `add`, `wait`, `supersede`, `ack` or `resolve` writes a fresh start row first by itself, prints the same and stops without writing its own row — read them, then run the same command again.
- **Key points only**, one row each; `--phase` names the ticket and step in the user's language ("03 review"), never a task stage such as `implement`:
  - a fork in the road and the approach chosen;
  - each question you put to the user, with the answer;
  - the close row: the review verdict per axis and the result after the fix round. It rides in the run's commit, so it points at the ticket and the changed files rather than that commit's SHA.
  - **The acceptance check** — the verdict row: how many acceptance criteria are met and how many are blocked; then each acknowledgement, override and handled item on the waiting-on-you list from the user, one row each.
  - **The archive** — one row.
- **Not logged:** claiming, routine commands, every test run, reading files.
- **Evidence is a pointer** — a commit SHA, `file:line`, a report path, a ticket number — never a paragraph.
- **Append only.** A wrong row is never edited or deleted: `supersede` it, which appends a row naming the old row's time.
- **Marks.** `--mark needs-you` (待你确认) when you made a choice the user could judge themselves — the reading of an ambiguous ticket, a changed approach within the requirement's intent; `--mark unsure` (拿不准) for a technical judgement you are not sure of.
- **Log self-check** (日志自查) — when you close the ticket and hand it back, once the task has a log. A question you ask and continue after does not count. After the close row, before the commit:
  1. `python3 .atw/scripts/decision_log.py run` prints this run's part of the log — every row this conversation wrote, from its first `start` row — with the session id and the start and end times. It also prints the transcript command for step 2, filled in, and how many lines its output has right now — or why it cannot count them. Under the rows it lists each row's evidence split into pointers, for step 3.
  2. Read this conversation from that start time on, with each command and the start and end of its result: `atw mem extract --context <session id> --tools --after <start time>`.
  3. Go row by row: each row stands for a real decision or action, and its evidence opens and shows what the row says. Open each row's evidence — the commit, the file at that line, the report, the ticket; a pointer you did not open has not been checked. Go down the evidence pointers `run` lists and open each one; a row you add during the self-check has pointers too. Only what you open yourself during the self-check counts: evidence you saw when the run started or during a review is opened again, and evidence that shows up in the transcript as you read it — a diff or a command's output from back then — has not been opened either: open that place yourself. **A conclusion that rests only on a sub-agent's report — a test count, a review verdict — is checked once on the spot; when you cannot, you must supersede its row to say the conclusion is `来自报告` (`per the report`): listing it under `没打开：` does not count.** Writing 「已当场复核」 (checked on the spot) under `没打开：` or anywhere else does not stand in for that superseding row: a conclusion you did check on the spot names the command that checked it in the `自查时打开：` list. A fork, a change of course or an abandoned approach that shaped this run's work but has no row is a missed row, and so is a point where an implementer's report says the work departed from the brief but has no row of its own — `add` it; a wrong row gets a `supersede` row. Check only the rows this run wrote: rows from earlier runs are left as they are.
  4. Log one row whose decision is `日志自查：补了 N 行、顶替 M 行` (an English log: `log self-check: added N rows, superseded M rows`) and whose result says what was actually read: the commands you ran, how many of the transcript's lines you read out of how many — `读了聊天记录 X/N 行` (an English log: `read X/N transcript lines`); N is the line count of your own read command's output — the count `run` prints is only a reference from when it ran — and X counts only what reached you when a tool cut a result short or left out its middle — then `自查时打开：` (`opened during the check:`) with the commands you ran to open evidence during the self-check, or the list of what they opened, and `没打开：` (`not opened:`) with every pointer — on `run`'s list or in a row you added — that you did not open, or `无` (`none`). Never write blanket words such as 「逐行」 or 「全部对照」 (line by line, checked everything): the counts and the two lists say what was checked, and a blanket word claims what nobody can check. When a self-check row has such words, or lacks `自查时打开：` or `没打开：`, `decision_log.py` reminds you on standard error and logs the row anyway. It also names on standard error each pointer of this run's rows that is in neither list, and logs the row anyway; it can tell only commits, files and waiting-on-you items apart, so the other pointers are yours to place. When `没打开：` lists a sub-agent's report or says a conclusion was checked on the spot, it reminds you that only a superseding row saying `来自报告` counts, and logs the row anyway.
- **When the transcript cannot be read**, check the rows against their evidence only, and put `没有对照聊天记录：<原因>` (`not checked against the transcript: <reason>`) in the self-check row's result. That is the case when `run` shows the session id as `查不到` or prints `聊天记录读不了` or `聊天记录数不出行数` — give the reason it prints — when the platform is not one of the four where `atw mem`'s `--tools` reading has been verified — Claude Code, Codex, pi, omp — and when `atw mem extract --context` fails. Only when it exits 2 saying `no session matches ATW context id` does no session match the id; the usual cause is an id set by hand through `ATW_CONTEXT_ID`, as headless runs do: it is kept as given, without the platform prefix `atw mem` matches on — give that as the reason. Any other failure — a usage error from an `atw` too old to know `--context`, a timeout — give its error as the reason. Never read another conversation in its place. Without a session id, `run` takes only the last part of the log, and only when its `start` row has no id either — that part is what a conversation without an id wrote; when the last `start` row carries an id, `run` exits 2 rather than hand over another conversation's rows. This run's rows cannot then be told apart: log the self-check row saying so, with `自查时打开：无；没打开：全部` (`opened during the check: none; not opened: all`), and check nothing.
- **Commit.** The log rides in the run's commit.
