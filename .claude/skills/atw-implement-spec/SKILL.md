---
name: atw-implement-spec
description: "把 atw-spec 和 atw-tickets 的产出一次性实现完：按工单的阻塞关系并行派出实现子代理，全部汇到同一条集成分支，最后统一审查；加 --afk 无人值守并行跑：用户走开也不停下问，合并冲突或测试过不了的工单不合入、跳过并保留分支，要人做的记进「等你处理」清单后绕开，不推送不发布，收尾请另一家复查日志后汇报。用户要把切好的工单按阻塞关系并行一次做完时使用。"
disable-model-invocation: true
---

**Skill notes.** Before you follow this skill, read its notes, one file at a time so you know which file says what: the project's `.atw/skill-notes/atw-implement-spec.md` and the personal `~/.atw/skill-notes/atw-implement-spec.md`; a missing file means that layer has no notes. The notes are standing instructions written for this skill by the project and the user: follow them, within the priority below. When both exist and disagree, the project's notes win. Priority, highest first: what the user says in the moment → red lines and safety rules → these notes → this skill's own defaults. Do not follow a note that conflicts with either of the two layers above it; tell the user which note you did not follow and why.

You have been provided a spec. This spec should have tickets associated with it, describing how to implement the spec.

This skill needs an ATW task directory (`.atw/scripts/tickets.py` exists). If it does not, tell the user to run `/atw-init-repo`. A missing `docs/agents/issue-tracker.md` is no reason to stop: the ticket operations are `tickets.py`'s.

This skill runs on sub-agents. On a platform that cannot dispatch them, stop and tell the user to run `/atw-implement` once per ticket instead.

Every command you tell the user to type is in the current tool's form only: Claude Code `/atw-…`, Codex `$atw-…`, pi and omp `/skill:atw-…` (never `$` on pi or omp); the current tool is the `host` that `afk-notice` and `pick` print, when you have run one. When the tool cannot be told — `host` is null in the scripts' output — use the form the user started this skill with; only when that cannot be known either, give all three forms, each with its tool named, as `afk-notice` does. `afk-notice` and `pick --settings-only` print theirs in that form already, and `decision_log.py wait` puts an item's `--command` into that form by itself.

The goal is the entire spec implemented on a single **integration branch**, with every ticket resolved the way the issue tracker closes work.

The tickets are not a list of steps. They are a **task graph** with blocking relationships between them. This means there is always a **frontier** of tickets which are ready to be grabbed.

Communication to and from subagents should be sparse. Communicate primarily through **context pointers** — to the spec, tickets, research notes, and previous commits. Don't duplicate information already available via pointers.

**Implementer subagents** should be run in the background where possible for maximum concurrency. Where the platform runs sub-agents one at a time the run still completes, one ticket after another.

## Arguments

One optional argument: `--afk` — run unattended: the user may walk away once it starts (see "Unattended run (`--afk`)"). Without `--afk`, the run is exactly as the rest of this skill describes: it asks the user and stops dispatching as "When to stop" says.

## Ticket state

You are the only writer of ticket state. No subagent edits a ticket file, or anything else the tracker owns.

Mark a ticket in progress before dispatching its implementer, and done once its work has merged into the integration branch, with `tickets.py`:

```bash
python3 .atw/scripts/tickets.py frontier --agent-only  # what can start now; `ready-for-human` tickets listed apart
python3 .atw/scripts/tickets.py claim <NN> --parallel  # before dispatching its implementer
python3 .atw/scripts/tickets.py done <NN>              # after its merge lands
```

`--parallel` is what lets several tickets be in progress at once; a plain `claim` refuses the second one. Leave these ticket-state edits uncommitted while implementers are running — a new commit on the integration branch between an implementer's last merge and its landing costs it another merge — and commit them once, at close-out.

`--agent-only` is how human tickets stay out of the run: a ticket whose `**Status:**` is `ready-for-human` leaves the workable list and is listed apart, and nothing in that apart list is ever dispatched. A ticket at `doing` and everything blocked by it are out of the frontier, so while implementers are still running an output that opens with `(frontier 里只剩 ready-for-human 的票)` is temporary: let them land and recompute the frontier once they have landed. When the workable list is empty, the apart list is not, and no implementer is still running, stop dispatching and report: name those tickets, and say that the user finishes them themselves (`claim` and `done` take a human ticket like any other) and then runs `/atw-implement-spec` again. The switch only reads the label, so read each ticket before dispatching it: plainly human work the ticket forgot to label — an external account, a manual test pass, a design decision — stops the run the same way rather than being dispatched. With `--afk`, neither stops the run: see "When the run gets stuck".

## Decision log

Every run of this skill keeps the task's decision log, `decision-log.md` in the task directory. Only you, the main session, write it — no sub-agent does: each implementer reports its own judgement calls, and you log the ones worth logging. Every row goes through the script, never written by hand:

```bash
python3 .atw/scripts/decision_log.py start --lang <zh|en>
python3 .atw/scripts/decision_log.py add --phase "<ticket and step>" --decision "<what>" --why "<why>" --evidence "<pointer>" --result "<result>" [--mark needs-you|unsure]
python3 .atw/scripts/decision_log.py supersede --time <time of the wrong row> --phase … --decision … --why … --evidence … --result …
```

- **When the log is kept.** Every `/atw-implement-all` and `/atw-implement-spec` run; once the task has a `decision-log.md`, all later work on it is logged too — `/atw-implement`, fix tickets, the acceptance check, the archive; and from the moment the user explicitly asks for a decision log, in any stage — with no task, say the log has to live in a task and ask whether to create one. Planning — questions, the map, the spec, slicing — is never logged: those decisions are the user's, already written into `prd.md` and the tickets.
- **Start row.** Before step 1, check whether the task has `decision-log.md`, then run `start`. It is the first row of every run, the log's first run included; `--lang` follows the user's language and only takes effect when the log does not exist yet. `start` prints the last rows and whether another conversation wrote in between — read them before writing on. When another conversation has written since, the next `add`, `wait`, `supersede`, `ack` or `resolve` writes a fresh start row first by itself, prints the same and stops without writing its own row — read them, then run the same command again.
- **Key points only**, one row each; `--phase` names the ticket and step in the user's language ("03 merge", "run start"; in a Chinese log 「03 审查」「开跑」 — the script reminds you when a Chinese log gets a phase all in English), never a task stage such as `implement`:
  - **Run start** — the plan for this run: the integration branch and whether this run opened it or picked up an existing one, the order the frontier opens up, and any `ready-for-human` tickets set aside. With `--afk`, it also says who will do the log review at the end, or why it will be skipped.
  - **Each ticket** — each judgement call in the implementer's report worth recording; every point where its report says the work departed from the brief, one row each, the same as a judgement call; each hand-back of part-done work on the timebox (see "Part-done work on the timebox"); each question you put to the user, with the answer. With `--afk`, also each way you handled something unattended — a recommended reading taken, a retry and its cause, a changed approach, a skip, an item, a red-line step left undone.
  - **Each merge** — the merge into the integration branch, and a merge conflict or a failing test suite when one happens.
  - **The review** — the verdict per axis and the result after the fix round. With `--afk`, also each merge undone for a red line, and the items written for the findings still open.
  - **End of the run** — the final state: how many tickets landed, where and why the run stopped, the task stage it leaves. With `--afk`, the log review's row comes before it (see "End of the run" under "Unattended run").
  - **The acceptance check** — the verdict row: how many acceptance criteria are met and how many are blocked; then each acknowledgement, override and handled item on the waiting-on-you list from the user, one row each.
  - **The archive** — one row.
- **Not logged:** claiming, routine commands, every test run, reading files.
- **Evidence is a pointer** — a commit SHA, `file:line`, a report path, a ticket number — never a paragraph.
- **Append only.** A wrong row is never edited or deleted: `supersede` it, which appends a row naming the old row's time.
- **Marks.** `--mark needs-you` (待你确认) when you made a choice the user could judge themselves — the reading of an ambiguous ticket, a changed approach within the requirement's intent; `--mark unsure` (拿不准) for a technical judgement you are not sure of, including the ones an implementer listed as unsure.
- **Log self-check** (日志自查) — every time the run hands the work back to the user: every ticket landed, or the run stopped. A question you ask and continue after does not count. Before the end-of-run row:
  1. `python3 .atw/scripts/decision_log.py run` prints this run's part of the log — every row this conversation wrote, from its first `start` row — with the session id and the start and end times. It also prints the transcript command for step 2, filled in, and how many lines its output has right now — or why it cannot count them. Under the rows it lists each row's evidence split into pointers, for step 3.
  2. Read this conversation from that start time on, with each command and the start and end of its result: `atw mem extract --context <session id> --tools --after <start time>`.
  3. Go row by row: each row stands for a real decision or action, and its evidence opens and shows what the row says. Open each row's evidence — the commit, the file at that line, the report, the ticket; a pointer you did not open has not been checked. Go down the evidence pointers `run` lists and open each one; a row you add during the self-check has pointers too. Only what you open yourself during the self-check counts: evidence you saw when the run started or during a review is opened again, and evidence that shows up in the transcript as you read it — a diff or a command's output from back then — has not been opened either: open that place yourself. **A conclusion that rests only on a sub-agent's report — a test count, a review verdict — is checked once on the spot; when you cannot, you must supersede its row to say the conclusion is `来自报告` (`per the report`): listing it under `没打开：` does not count.** Writing 「已当场复核」 (checked on the spot) under `没打开：` or anywhere else does not stand in for that superseding row: a conclusion you did check on the spot names the command that checked it in the `自查时打开：` list. A fork, a change of course or an abandoned approach that shaped this run's work but has no row is a missed row, and so is a point where an implementer's report says the work departed from the brief but has no row of its own — `add` it; a wrong row gets a `supersede` row. Check only the rows this run wrote: rows from earlier runs are left as they are.
  4. Log one row whose decision is `日志自查：补了 N 行、顶替 M 行` (an English log: `log self-check: added N rows, superseded M rows`) and whose result says what was actually read: the commands you ran, how many of the transcript's lines you read out of how many — `读了聊天记录 X/N 行` (an English log: `read X/N transcript lines`); N is the line count of your own read command's output — the count `run` prints is only a reference from when it ran — and X counts only what reached you when a tool cut a result short or left out its middle — then `自查时打开：` (`opened during the check:`) with the commands you ran to open evidence during the self-check, or the list of what they opened, and `没打开：` (`not opened:`) with every pointer — on `run`'s list or in a row you added — that you did not open, or `无` (`none`). Never write blanket words such as 「逐行」 or 「全部对照」 (line by line, checked everything): the counts and the two lists say what was checked, and a blanket word claims what nobody can check. When a self-check row has such words, or lacks `自查时打开：` or `没打开：`, `decision_log.py` reminds you on standard error and logs the row anyway. It also names on standard error each pointer of this run's rows that is in neither list, and logs the row anyway; it can tell only commits, files and waiting-on-you items apart, so the other pointers are yours to place. When `没打开：` lists a sub-agent's report or says a conclusion was checked on the spot, it reminds you that only a superseding row saying `来自报告` counts, and logs the row anyway.
- **When the transcript cannot be read**, check the rows against their evidence only, and put `没有对照聊天记录：<原因>` (`not checked against the transcript: <reason>`) in the self-check row's result. That is the case when `run` shows the session id as `查不到` or prints `聊天记录读不了` or `聊天记录数不出行数` — give the reason it prints — when the platform is not one of the four where `atw mem`'s `--tools` reading has been verified — Claude Code, Codex, pi, omp — and when `atw mem extract --context` fails. Only when it exits 2 saying `no session matches ATW context id` does no session match the id; the usual cause is an id set by hand through `ATW_CONTEXT_ID`, as headless runs do: it is kept as given, without the platform prefix `atw mem` matches on — give that as the reason. Any other failure — a usage error from an `atw` too old to know `--context`, a timeout — give its error as the reason. Never read another conversation in its place. Without a session id, `run` takes only the last part of the log, and only when its `start` row has no id either — that part is what a conversation without an id wrote; when the last `start` row carries an id, `run` exits 2 rather than hand over another conversation's rows. This run's rows cannot then be told apart: log the self-check row saying so, with `自查时打开：无；没打开：全部` (`opened during the check: none; not opened: all`), and check nothing.
- **Commit.** The log is a tracker file like the ticket-state edits: it stays uncommitted while implementers run and rides in the close-out commit of step 8.

## Standing orders

Standing orders (长期指令) are what the user has said holds for the rest of the task, not just the ticket at hand — "leave `src/legacy/` alone from now on", "commit messages in English". They live in `standing-orders.md` in the task directory: numbered, one line per order, append only. Only you, the main session, write it, and only through the script — no sub-agent does, and nobody edits it by hand:

```bash
python3 .atw/scripts/decision_log.py standing --order "<the order, one line>" --why "<what the user said, or the words you caught yourself repeating>" --phase "<ticket and step>" --evidence "<pointer>" [--lang <zh|en>]
```

The same command logs the order's decision-log row. When the task has no `decision-log.md` yet, it opens the log first the way `start` does: give `--lang` then, in the user's language.

- **When to append.** The user states something that holds from now on; or you notice you are repeating the user's own words — telling a second implementer what the user told you for the first. Append first, then act on it.
- **Every dispatch carries the whole file.** Read `standing-orders.md` afresh and paste it, verbatim and whole, into the brief's Standing rules field after the fixed text, under a line `长期指令：` (`Standing orders:` in an English brief) — on the first dispatch for a ticket, a fix round, a retry, a resume, and a relay to a fresh implementer after one hands back part-done work. An order appended mid-run goes out with the next dispatch. When the file does not exist or lists no order, write `长期指令：无` (`Standing orders: none` in an English brief) instead.
- **Commit.** `standing-orders.md` rides in the same commits as the decision log.
- **The archive commit.** When `standing-orders.md` has an order on commit messages, the archive commit follows it too: archive with `task.py archive --no-commit` and commit the move yourself as the order says (`.atw/workflow.md` 3.2).

## Unattended run (`--afk`)

With `--afk` the user has walked away. You never stop to wait for an answer: whatever would stop dispatching or ask the user is handled by the rules below, and whatever needs the user goes into the waiting-on-you list (等你处理, `waiting-on-you.md` in the task directory) — then you go around it and carry on. Everything else in this skill holds unchanged.

### Before the first ticket

- **The checks are the same.** Anything this skill stops on before the first dispatch — a platform that cannot dispatch sub-agents, no ATW task directory (`.atw/scripts/tickets.py` missing) — still stops the run on the spot, as without `--afk`.
- **Branch.** The integration branch of step 3 is the run's own branch, as without `--afk`: no other branch is opened. Nothing is committed on the task's base branch — step 3 commits the spec and tickets to the integration branch.
- **Start notice.** Have the script write it, from the repository root:

  ```bash
  python3 .atw/scripts/cross_model_review.py afk-notice --skill atw-implement-spec --branch <branch> [--new-branch] --task <task-dir>
  ```

  Run it after step 3 has opened or picked up the integration branch, and before the first dispatch of step 4: `--branch` is that integration branch, `--new-branch` only when this run opened it rather than picking up an existing one; add `--model-line`: on Claude Code and omp, copy the one line of your system prompt that names your model, word for word — on Claude Code it starts "You are powered by the model", on omp it is `- Model: <provider>/<id>`; on pi and Codex leave it out. On Claude Code also add `--lang zh` or `--lang en` — the user's language, `en` for any other. The start row comes before step 1, so it is already in place: the log review at the end reads this run's chat from the start row on, so a notice shown before that row is not in its material.
  It picks the log-review reviewers exactly as `pick --settings-only` does at the end of the run, and prints that pick's JSON plus `notice`: one paragraph in Chinese (`zh`) and English (`en`) that already gives every item of the notice — the branch; who will do the log review at the end, each reviewer's family recognised by name and the settings reviewers that sit out and why, or why it will be skipped, how to fix that now (interrupt, fix, start this command again — or, when `--model-line` was left out, run `afk-notice` again with it) and how to make it up afterwards; what will be sent and to whom; whether the host asks the user to approve each command, as far as it can be found out, that an approval asked for mid-run halts the run there, and that the host's settings are never changed for the user; the five red lines; where the waiting-on-you list is; and that the user may interrupt the run at any time. Every command in it is in the current tool's form only.

  Post the one in the user's language word for word — for any other language, translate `en` sentence by sentence, leaving nothing out — as a message of its own before the first ticket: visible text, not in your thinking. Do not reword it, do not compress it into a sentence of your own, and do not drop any sentence. You may add words before or after it — for example the permission mode your system prompt names, where the paragraph says it cannot be found out — then start without waiting for an answer. Exit code `2` means the call was wrong (its error is on stderr): fix it and run it again.

  On Claude Code, Claude Code shows it itself: with `--lang`, ATW's hook shows that paragraph to the user word for word as soon as the command ends, without passing through you, and a system reminder tells you so. Then do not post it again and do not reword it — you may still add words after it, as above; for a language other than Chinese or English, still post your sentence-by-sentence translation of `en` — and start without waiting for an answer. When the reminder says the paragraph was too long to show, or no reminder comes, post it yourself as above.

### When the run gets stuck

This table replaces every place in this skill that says to ask the user or to stop dispatching — "When to stop" included — except where the table itself says dispatching stops. Log each way you handle something here (see "Decision log").

| Situation | What you do |
|---|---|
| The ticket is ambiguous, or the implementer meets an ambiguity that would change the result | Take the most recommended reading and go on; log it with `--mark needs-you` |
| The ticket cannot be done as written — tests that will not pass included — or two timebox hand-backs in a row made no real progress | Retry with another approach, at most twice (see "Retries"). Still failing: change the approach within the requirement's intent, go on, and log it with `--mark needs-you`. Skip the ticket only when it cannot be done at all |
| Human work: a design or product choice | Go on with the recommended default; an item, `design-choice`, with the options and the one taken |
| Human work: a manual test | Do every check that can be automated, merge and mark the ticket done as usual; the manual part becomes an item, `manual-test`; later tickets go on |
| Human work: an external account, a key, a payment | Never open an account or pay for the user. Build the rest and leave each placeholder plainly marked; one item per placeholder, `account-key-paid` (see "Placeholders"); merge and mark the ticket done as usual — the floor guard in step 7's review passes the placeholder against its item; later tickets go on where they can |
| Human work: a legal decision | Never decide it for the user. Skip the ticket (see "Skipping a ticket"), its item `legal` rather than `skipped-ticket`; tickets that depend on it do not start |
| A brief field you cannot fill for a ticket — one of the nine, or one of a collapsed brief's items | Do not dispatch it; skip the ticket (see "Skipping a ticket"), its item saying which field is missing and why; the other tickets go on |
| The ticket itself asks to push, merge or publish | That step becomes an item, `your-step`; do the rest |
| A merge conflict that cannot be resolved by the intent of both sides, or a test suite that fails on the merge result | Nothing of that ticket lands — the integration branch stays where it was; skip the ticket (see "Skipping a ticket"); the other tickets go on |
| A finding still open after step 7's one re-check crosses a red line — anything on the floor guard's list | Undo the merge of the ticket that brought it in, and the merges of every landed ticket that depends on it, then skip them (see "Undoing a merge") |
| The test suite fails on the integration branch after step 7's fix round, not tied to any one ticket's merge | Go on to step 8; an item, `unresolved-review`, naming the failing tests and the fix round's commits, with three options — fix it once more / undo the fix round / change the spec — default "left as it is": the integration branch stays where the fix round left it, with the suite failing; nothing is undone and no test is touched to make it pass. The report says so and gives the item; report it as it is |
| Any other finding still open after step 7's one re-check | Go on to step 8; an item, `unresolved-review`, with the review report as relayed this time — the parts of every axis that bear on the still-open findings, verbatim — in `--ask`, and three options — accept it as is / fix it once more / change the spec — default "accept it as is" |
| Every remaining ticket is blocked — nothing workable and no implementer still running | Only now does dispatching stop: what landed still goes through steps 7 to 10, then "End of the run" |

- `ready-for-human` tickets are still never dispatched; they are listed in the report. Plainly human work a ticket forgot to label no longer stops the run: it is handled by the table's human-work rows.
- An implementer that asks a question anyway gets your answer — the most recommended reading — sent back to it, and the reading is logged with `--mark needs-you`. An implementer that reports the spec wrong or self-contradictory goes by the first row the same way.

#### Merging

Unattended, the merger lands a ticket only when its merge resolves by the intent of both sides and the test suite passes on the merge result, run before the integration branch moves; otherwise it lands nothing, leaves the integration branch where it was, and reports why — the table's merge row. The merger merges with `git merge --no-ff`, so every ticket leaves one merge commit on the integration branch — the commit `tickets.py revert <NN> --merge <sha>` needs to undo it (see "Undoing a merge"); a fast-forward would leave none. The merger's prompt carries the five red lines too. Log the merge, or the conflict or failing suite and the skip.

#### Writing an item

Every item goes through `decision_log.py wait`, which writes the item's decision-log row in the same command — never edit `waiting-on-you.md` by hand:

```bash
python3 .atw/scripts/decision_log.py wait --title "<one line>" --ask "<what the user has to do>" --why "<why it is stuck on the user>" \
  --options "<the options>" --default "<what you did meanwhile>" --category <category> \
  [--if-ignored "…"] [--prereq "…"] [--irreversible "…"] [--placeholder <file:line>]… [--command "<input for when the user is back>"]… [--ticket <NN>]… \
  --phase "<ticket and step>" --evidence "<pointer>"
```

Write it in plain words, with or without noob mode; commands and file paths stay verbatim. Give `--if-ignored` (what happens if nobody handles it), `--prereq` (what has to come first) and `--irreversible` (which step cannot be undone) whenever you know them — left out, they read 「不知道」. The row it writes carries no mark: the item is already on the list. It prints the item number and the time of its row.

**Placeholders.** For a missing external account, key or payment, write one item per placeholder before step 7's review starts — the floor guard passes only an item written before the review began: `--category account-key-paid`, `--placeholder <file:line>`, `--ask` saying what to fill in, and `--command` with what hooks it up once filled in (the command that starts or checks it). An item without `--command`, one checked off, or one whose row has been superseded passes nothing, and the review then calls the placeholder a hard violation. The implementer's Goal says the account, key or payment is missing, that every placeholder gets a plain marker, and that its report names each placeholder's `file:line`, what is missing and how to hook it up.

#### Retries

- Nothing of a failed try has landed, so there is nothing to undo. The failed try's branch and commits stay; its worktree is cleaned up with the others at step 10. Log the retry and its cause.
- At most two retries per ticket. Each is a fresh implementer — never the one that failed — in a new worktree on a new branch from the integration branch tip, with the same brief, whose Goal adds the cause of the last failure and the approach this try changes.
- A relay after a timebox hand-back with real progress is not a retry and does not use one up (see "Part-done work on the timebox").

#### Skipping a ticket

A skipped ticket has nothing on the integration branch to undo: it never landed.

1. `python3 .atw/scripts/decision_log.py wait … --category skipped-ticket --ticket <NN>` (`legal` for a legal decision) — note the row time it prints. The user's way forward is to tell you their decision in the chat; you then hand the ticket back for them (see "When the user is back"), so `--ask` says what to decide and to tell you, and `tickets.py handback` is never given to the user as a command to type. `--command` is the slash command to type afterwards for the rest of the work to go on (this skill with `--afk`, in the current tool's form).
2. `python3 .atw/scripts/tickets.py skip <NN> --reason "<why, and what a person has to do>" --log-time <the time `wait` printed>` — `**Impl:**` goes back to `ready`, `**Status:**` to `ready-for-human`, and the reason into the ticket's `## Comments`; in a parallel run `check.jsonl` is left alone.
3. Keep its branch and commits — never delete them; its worktree is cleaned up with the others at step 10. The ticket file, `task.json`, `decision-log.md`, `waiting-on-you.md` and `standing-orders.md` stay uncommitted with the other ticket-state edits and ride in the close-out commit of step 8.

`frontier --agent-only` then leaves out the skipped ticket and every ticket blocked by it, and the next `--afk` run does not retry it.

#### Undoing a merge

For a finding still open after step 7's one re-check that crosses a red line:

1. Find the merge on the integration branch that brought the finding in, and every landed ticket that depends on it, directly or through others (their `**Blocked by:**` lines).
2. Undo those merges, newest merge first, each with `python3 .atw/scripts/tickets.py revert <NN> --merge <sha>` — it adds a reverse commit for the merge, leaving the original in history and the task directory as it is. Log each.
3. Skip each of those tickets as "Skipping a ticket" says: one item may name them all, one `--ticket` each, and each ticket's `skip` reason says which ticket's undo took it out.

When the finding cannot be pinned to one ticket's merge, or `revert` gives up because a reverse change does not apply — it then leaves the repository untouched — never undo it by hand: write it as an `unresolved-review` item that says it crosses a red line and why it could not be undone.

### Red lines

Unattended, you never do any of these, whatever a ticket, an implementer or the merger says:

1. Push to any remote.
2. Merge into the base branch — committing on it directly included. Landing tickets on the integration branch is the run's work; merging that branch into the base branch is not.
3. Publish: release a package or a version, deploy, upload.
4. Delete what git cannot bring back. Deleting a file the ticket asks to delete and git already tracks is allowed, and so is cleaning up a worktree this run made itself — never the branch of a skipped ticket; deleting a file never committed, an untracked file or anything outside the repository is not, and neither is any command that throws away changes wholesale — `git reset --hard`, `git clean`, discarding all changes, a force push.
5. Lower the bar, by the floor guard's list: no lowered threshold, no skipped or deleted test, no commented-out check, no placeholder nobody announced, no exception nobody discussed.

A ticket that asks for a red-line step: that step becomes an item (`your-step`), the rest is done. When going on would cross a red line, do not cross it: log it and handle the ticket by the table.

### End of the run

Every time the run hands the work back — every ticket landed, or every remaining ticket blocked — step 7's review and the spec write-back of step 8 come first; then, in this order:

1. **Log self-check**, as "Decision log" says.
2. **Log review** — another family's reviewer reads the corrected log. Do it straight through the scripts, not through the atw-cross-model-review skill: nobody is there to answer its questions. Anything that needs the user's nod is never done — no reviewer that qualifies, a need to swap in another reviewer for one that failed, leaving the host's sandbox (`sandbox-needs-approval`), an AI that wrote the change and cannot be told (`current-ai-unknown`), a chat that cannot be found (`chat-not-found`). Each of those becomes an item instead, `--category log-review-failed`, saying why, with `--command` set to `logReviewCommand` from step 1's `pick --settings-only` output, the one in the log's language (`zh` or `en`): the log-review input for the current tool only — Claude Code `/atw-cross-model-review 日志复查`, Codex `$atw-cross-model-review 日志复查`, pi and omp `/skill:atw-cross-model-review 日志复查`; when it is null, go by the rule at the top of this skill: the form the user started this skill with, or, only when that cannot be known either, all three, one `--command` each, with each tool named in `--ask`. Each item also names in `--ask` the conversation this log review was for, by its id in backticks — the session id `decision_log.py run` printed in the log self-check, the same id `prepare-log` prints as `session` — or, when it printed none, says the id cannot be found, so that the review made up later reads that conversation's run, not the most recent one.
   1. Run `python3 .atw/scripts/cross_model_review.py pick --settings-only`, with `--model-line` as at the run start: on Claude Code and omp, copy the one line of your system prompt that names your model, word for word — on Claude Code it starts "You are powered by the model", on omp it is `- Model: <provider>/<id>`. Exit code `2` means the call was wrong (its error is on stderr): fix it and run it again. It uses only the reviewers in this computer's settings: no automatic pick, no swap, no setup wizard; one of the author's family sits out, one whose family cannot be told runs anyway — say so in the report. When `unavailable` is not null, send nothing: write the item and go on to step 3.
   2. Build the material from this run only — no `--whole`:

      ```bash
      python3 .atw/scripts/cross_model_review.py prepare-log \
        --questions <the atw-cross-model-review skill's directory>/references/log-review-questions.md \
        --reviewer "<tool> model=<model> effort=<effort>" \
        --pick '<the JSON object pick printed, verbatim>' \
        --session \
        --task <task directory>
      ```

      `--session` with no value names this conversation — the same id `decision_log.py run` printed in the log self-check — so the material is this run's even when another conversation wrote to the log after it; never leave it out to fall back on the most recent run. One `--reviewer` per reviewer `pick` settled on, ` effort=` only when it has one. On Claude Code add `--lang zh` or `--lang en`, the user's language. A `stop` (`chat-not-found` with each run's reason, `no-run` — this conversation has no run in the log, or its id cannot be found — or `no-log`) means nothing was sent: write the item and go on to step 3.
   3. Post its `notice` word for word — the one in the user's language, whole, as a message of its own: do not reword it, do not compress it into a sentence of your own and do not drop any sentence (its 30 minutes, for one, are for all of a reviewer's tries together); on Claude Code, when a system reminder says ATW's hook has shown it, do not post it again and do not reword it — then run every reviewer at once with `python3 .atw/scripts/cross_model_review.py run <id>`, waiting as the atw-cross-model-review skill's "Waiting the full time" says. The script retries by cause on its own, and a reviewer that still could not run is not replaced. Every reviewer that still could not run after the script's retries goes into the list — one item may name them all, each with its `failureReason` — with the log-review input above as `--command` and the conversation named as above; the reviewers that did run are verified and reported as usual. When none ran, go on to step 3.
   4. Verify and sort the findings into the four tiers by that skill's `four-tiers.md`, going back to the log, the chat and the evidence the rows point at; report by its `report-format.md`, every retry included, and save the report with `python3 .atw/scripts/cross_model_review.py report --file .atw/.runtime/log-review-report.md --task <task directory> --log-review` — it goes to the task's `log-review/` folder, redacted.
   5. Log one row: the reviewers as the decision, how many findings fell in each tier as the result, the saved report as the evidence. A review not done needs no row of its own: its item's row says why.
3. **End-of-run row and commit.** Log the end-of-run row, then commit: `decision-log.md`, `waiting-on-you.md`, `standing-orders.md` and `log-review/` ride in the close-out commit of step 8 with the ticket-state edits. Then steps 9 and 10 as amended for `--afk` — no draft PR, and the worktrees cleaned up keeping the branch of every skipped ticket.
4. **Report** in chat, in plain words, in four blocks in this order; commands and file paths stay verbatim. Take them from `python3 .atw/scripts/decision_log.py pending --report`: it prints the draft — these four blocks in this order, worded in the log's language, with what the task directory holds, one line per ticket in the last — and marks what you fill in. With noob mode on it also carries one plain-words line under each of the first three headings, the third with one more for unsure (拿不准): keep them as they are, do not drop them. Head the blocks in the log's language: an English log the headings below, a Chinese log the ones in brackets.
   1. **Waiting on you** (等你处理) — every item not checked off: its title, what the user has to do, what you did meanwhile, and what to type once back — and for each command whether it is typed in the chat with you or run in a terminal, as the draft marks it; every mismatch the draft lists between the decision log and the list, counted as not handled; then the `ready-for-human` tickets not done yet.
   2. **What the log review found** (日志复查挑出的问题) — Must fix and Worth considering first, and where the report is saved; when it was not done, why and how to make it up.
   3. **Waiting for your confirmation** (待你确认的条目) — the rows marked needs-you (待你确认) not yet acknowledged or superseded: time, decision, why.
   4. **Each ticket** (每张工单的状态) — number and title; done, skipped (waiting-on-you item N) with its branch kept, merge undone, or untouched; commit SHAs; the review verdict per axis.

   Then say which integration branch the changes are on, that nothing was pushed and nothing was merged into the base branch, and what to do next: which items to answer first, here in the chat, and only then whether to type the command for the rest to go on — nothing has to keep running. Not saved to a file: everything in it lives in the task directory, so when the user asks for the report again, rebuild it from there with the same command.

### When the user is back

The user answers items, confirms choices or overrules them after the report — in this conversation or a later one. Keep logging as "Decision log" says, and handle each answer this way:

- **Acknowledging.** The user says item N goes as you did it, or that it is handled: `python3 .atw/scripts/decision_log.py resolve --item <N> --reply "<their answer>" --phase "<step>" --evidence "<pointer>"` checks it off, writes the reply and logs the row in one command. When the user did the work themselves — filled in a key, ran the manual test — check the real thing first, automatically where you can (is the placeholder gone, does the test pass), put what you found in `--result`, and only then check it off. A needs-you row the user confirms: `python3 .atw/scripts/decision_log.py ack --time <time> [--time <time> …]` with the usual row fields — `pending` counts only an acknowledgement that names the row's time.
- **Handing back to the AI.** The user decides a ticket that waits on a person: `python3 .atw/scripts/tickets.py handback <NN> --decision "<the user's decision>"` writes the decision into the ticket's `## Comments` and sets `**Status:**` back to `ready-for-agent`; resolve its item the same way. The next run picks it up.
- **Overruling something built.** A change to the code becomes a new ticket, written the way the project's tracker doc says (`docs/agents/issue-tracker.md`), citing the item or the log row. When the task is already at `accept`, move it back first: `python3 .atw/scripts/task.py set-status <task-dir> implement`. Its ticket, `task.json` and the log ride in the one state commit below; then the user runs `/atw-implement` or `/atw-implement-all` (on Codex `$atw-implement` or `$atw-implement-all`, on pi and omp `/skill:atw-implement` or `/skill:atw-implement-all`; give only the current tool's form). Never change the code in the chat.
- **Overruling the requirement.** When what the user overrules is the requirement itself, change `prd.md` first: draft the change, show it to the user, and write it only once they agree; then see whether it needs tickets.
- **An overrule only appends.** Log a superseding row — `python3 .atw/scripts/decision_log.py supersede --time <time>` with the usual row fields — and the original row stays as it is.
- **A correction that repeats.** When the user says it goes this way from now on (以后都这样), or a choice of the same kind is overruled a second time — the superseding rows in the log show it — call the Skill tool with "atw-update-spec" to write it into the project's spec (it fixes the mistake at the highest level that works — architecture, types, a check, a test — and writes docs last; at this read-only step a code fix becomes a new ticket, as **Overruling something built** says), then tell the user where it was written. A correction meant for this once goes only into the ticket.

Once the answers are handled, commit everything they changed in the task directory — such as ticket files, `prd.md`, `waiting-on-you.md`, `standing-orders.md`, `decision-log.md` and `task.json` — as one state commit before handing the work back: stage only files under the task directory, never other changes in the tree — so the next run starts on a clean tree.

At acceptance, `.atw/workflow.md` 3.1 opens the report with what the run left — the items not checked off, the needs-you rows, the log review's open Must fix findings and the unsure rows — and accepting acknowledges the needs-you rows still open.

## Steps

1. Read the spec and tickets to understand the task graph.

2. (optional) Use an **exploration subagent** to conduct any exploration required by the tickets — relevant codebase files or external documentation. It saves its markdown notes where the tracker doc puts research notes, or in a directory outside the repo when the tracker doc names no such place. This lets **implementer subagents** focus on implementation rather than exploration.

3. Create the integration branch, named after the task. Commit the spec, the tickets, and any exploration notes saved in the repo to it first: a worktree holds only what git tracks, so an uncommitted ticket is invisible to its implementer. On an ATW task directory, record the branch with `python3 .atw/scripts/task.py set-branch <task-dir> <branch>`. If the issue tracker closes work through PRs, or the user asks for one, open a draft PR after the first merge in step 5 (a branch with no commits ahead of main can't open one), marked as closing the spec and tickets. With `--afk`, no draft PR is opened: it needs a push (see "Red lines"); when the issue tracker closes work through PRs or the user asked for one, opening it becomes an item, `your-step`. With `--afk`, post the start notice right after this step, before the first dispatch (see "Unattended run (`--afk`)").

4. Use **implementer subagents** to implement each frontier ticket, each in its own worktree on its own branch. Dispatch a general-purpose sub-agent with the brief below — not the `atw-implement-agent` role, which may not commit. Each implementer subagent:
   - confirms its worktree is based on the integration branch before starting, and resets onto it if not;
   - calls the Skill tool with "atw-tdd" to build the ticket;
   - builds any part that changes what a user sees by calling the Skill tool with "atw-ui", and captures a screenshot into the task directory's `screenshots/` for each UI acceptance criterion (screen, state, viewport in the file name);
   - commits to its own branch, and merges the integration branch tip into that branch before reporting done.

5. Once an **implementer subagent** completes, log the judgement calls in its report worth recording and every point where it departed from the brief, merge its work to the integration branch with a **merger subagent**, then mark the ticket done and log the merge. An implementer that reports it stopped on the timebox with part-done work is not merged: log it and relay it, as "Part-done work on the timebox" under "Implementer brief" says. With `--afk`, a merge lands only as "Merging" under "Unattended run" says, always with `--no-ff`.

6. If this changes the **frontier** of available tickets, kick off more **implementer subagents** to work on the new tickets. This allows for maximum concurrency.

7. Once all tickets are complete, call the Skill tool with "atw-code-review" on the integration branch, with the commit the branch started from as the fixed point and any captured screenshots passed for its Visual axis. Relay the review reports to the user as written. Fix all issues raised by the code review in a single **implementer subagent**. Then re-check **only the findings that were fixed**, once. Do not start a second full review, and do not loop: anything still open after that one re-check goes to the user. Log the review's row. With `--afk`, the findings still open go by the table's two rows for open findings instead.

8. Call the Skill tool with "atw-update-spec" to fold what actually got built back into the spec, do the log self-check, log the end-of-run row, then commit — the ticket-state edits and the decision log ride in this commit. With `--afk`, the log review comes between the self-check and the end-of-run row — see "End of the run".

9. If a draft PR exists, mark it ready for review. Otherwise, resolve each ticket the way the issue tracker closes work, and report the integration branch. With `--afk` there is no draft PR; when the issue tracker closes work through PRs or the user asked for one, opening it is the `your-step` item of step 3, and the report is the four blocks of "End of the run".

10. Clean up all **implementer subagent** worktrees. With `--afk`, the branches of skipped tickets are kept; only their worktrees go.

## Implementer brief

The brief has the nine fields defined in `.atw/workflow.md` (Phase 2, **Implementer brief**); a one-command unit gets the collapsed brief defined there instead — one paragraph that still names goal, scope, the verify command, the report shape and the timebox, and carries the standing orders. Fill every one before dispatching — every field, or every item of the collapsed paragraph; a field you cannot fill means the work is not understood yet — stop and tell the user which field is missing and why, do not dispatch. With `--afk`, the table's row for a brief field you cannot fill applies instead. This path's values:

- **Goal** — the one ticket's result, in one sentence.
- **Scope** — the integration branch name, and the worktree and branch this implementer works in; plus the files the ticket names.
- **Context** — pointers to the spec, its one ticket, the exploration notes, the coding-standards files the review will hold the work to, and the commit SHA on the integration branch of every ticket this one is blocked by. Point at whatever lives in the repo; paste only what does not.
- **Acceptance** — a pointer to the ticket's `- [ ]` checklist.
- **Verify** — the exact typecheck, test-file and full-suite commands for this repo, with any flag the machine needs. When the project has a complete verification skill — an app under `.atw/verify/<app>/` that `atw verify sync --dry-run` does not list as `skipped` — and the ticket touches behaviour a user can see or operate, also write, next to the test commands, which feature to drive with it, the steps, what counts as success, and where the evidence goes (`verify-evidence/` in the task directory in the main checkout, by absolute path: the implementer's worktree is removed after its merge, and the evidence with it) — never just "use verify-<app>". Without one, or when the ticket touches no such behaviour, the field holds the test commands alone.
- **Timebox** — "about <N> minutes — a rough cap on runtime; on expiry, return partial findings and stop rather than run on", N estimated from the ticket's size (for a fix round, from the findings to fix). No timer enforces it.
- **Forbidden** — "Do the work yourself; do not dispatch sub-agents, and do not run a code review — the orchestrator reviews the integration branch once, at the end. Do not edit any ticket file or tracker state. Stay inside this ticket's slice; if the ticket cannot be finished as written, stop and report why instead of widening it. Do not merge into the integration branch — the merger does — do not rebase, do not force-push."
- **Report** — under 200 words: what changed, test results, commit SHAs, screenshot paths if any, open questions, the commands actually run, whether you stopped on the timebox with part-done work and, if so, how far you got and what is left, and where the work departed from the brief; then the judgement calls you made yourself that a reviewer would want to know about — each with why and a pointer (`file:line` or commit SHA), the ones you are unsure of listed apart.
- **Standing rules** — the prompt starts with `Active task: <task path>` when the repo runs the ATW task system, then "You are an implementer subagent dispatched by `/atw-implement-spec`."; then the rules from step 4: confirm the worktree is based on the integration branch; call the Skill tool with "atw-tdd" to build the ticket; call the Skill tool with "atw-ui" for any part that changes what a user sees, with a screenshot into the task directory's `screenshots/` per UI acceptance criterion; commit to its own branch and merge the integration branch tip into it before reporting done; then the task's standing orders, as "Standing orders" says.

The fix-round dispatch in step 7 is the same brief with the findings to fix in its Goal field.

**Part-done work on the timebox.** When an implementer reports it stopped on the timebox with part-done work, log one decision-log row for the hand-back — how far it got, and whether it made real progress since the last hand-back (work toward the acceptance checklist that the diff shows; in a fix round, work on the findings being fixed) — then relay the ticket to a fresh implementer, never the one that stopped: the same brief, with the standing orders as "Standing orders" says and its Goal adding the partial result — the report and where the work stands — and every question the implementers before it on this ticket asked, with the answer each got. A hand-back with real progress is not a failed try and does not count toward the retries. A hand-back during a fix round is relayed the same way, and the relay is still that one fix round, not a second. Two hand-backs in a row with no real progress mean the ticket cannot be finished as written: handle it as an implementer's report that it cannot be finished as written — with `--afk`, by the row of "When the run gets stuck" for a ticket that cannot be done as written. A relay works in the stopped implementer's worktree and on its branch. When the stopped implementer leaves a process still running — an import, a build, a long test run — the relay never goes back to the stopped implementer, not even to read that process's output: the fresh implementer starts the process again, or picks up from the results that process has already written.

With `--afk`, three fields change:

- **Standing rules** — add: "do not stop to ask: take the most recommended reading, go on, and name it among the judgement calls in your report".
- **Forbidden** — add the five red lines: "Do not push to any remote; do not merge into the base branch or commit on it; do not publish — no package or version release, no deploy, no upload; do not delete anything git cannot bring back — no file that was never committed, no untracked file, nothing outside the repository, no `git reset --hard`, `git clean`, discarding all changes or force push; do not lower the bar — no lowered threshold, no skipped or deleted test, no commented-out check, no placeholder nobody announced, no exception nobody discussed."
- **Goal** — on a retry, the cause of the last failure and the approach this try changes.

## When to stop

Stop dispatching and report to the user — letting implementers already running finish, and keeping everything already merged — when:

- an implementer reports its ticket cannot be finished as written, or the spec is wrong or self-contradictory;
- a merge conflict cannot be resolved by the intent of both sides;
- the test suite cannot be made to pass on the integration branch;
- `frontier --agent-only` has only `ready-for-human` tickets left with no implementer still running, or the next ticket is plainly human work (see "Ticket state").

Do the log self-check, log the end-of-run row, then say what happened, which tickets are done, in progress, and untouched, and what decision is needed. Do not paper over it and do not rewrite a ticket to make it fit.

With `--afk`, none of these stops dispatching by itself: "When the run gets stuck" handles each — the first by its rows for an ambiguity and a ticket that cannot be done, the second by its merge row, the third by its merge row — or, after step 7's fix round, by its row for a failing suite — the last by its human-work rows — and the run stops dispatching only when every remaining ticket is blocked; what landed still goes through steps 7 to 10, and the report is the four blocks of "End of the run" instead.
