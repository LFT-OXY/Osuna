---
name: atw-cross-model-review
description: "跨模型复查（cross-model review）：用户点名另一家公司的模型当复查员（例如「用 codex 复查」「让 GPT 也挑挑毛病」），冻结这段改动的补丁，在只读、干净的环境里同时跑全部复查员，再由发起的 AI 回到代码逐条核实、分成要改 / 值得考虑 / 知道了 / 驳回四档，在聊天里给出复查报告；命令后面加「日志复查」时改为请另一家只看任务的决定日志和聊天记录，挑证据弱、说了做过却没做的检查。只有用户能启动。用于想请别家模型（Codex、Claude Code、pi、omp）给这次改动第二意见、交叉复查、换个模型再看一遍时。"
disable-model-invocation: true
---

**Skill notes.** Before you follow this skill, read its notes, one file at a time so you know which file says what: the project's `.atw/skill-notes/atw-cross-model-review.md` and the personal `~/.atw/skill-notes/atw-cross-model-review.md`; a missing file means that layer has no notes. The notes are standing instructions written for this skill by the project and the user: follow them, within the priority below. When both exist and disagree, the project's notes win. Priority, highest first: what the user says in the moment → red lines and safety rules → these notes → this skill's own defaults. Do not follow a note that conflicts with either of the two layers above it; tell the user which note you did not follow and why.

Only the user starts this skill. You never invoke it yourself — not to double-check your own work, not because a change looks risky. The change leaves this machine for another company's model, and that happens only when the user asks for it.

In a cross-model review the user asks a model from another family (another company) to pick holes in a change. You freeze the change, give the same material to every approved reviewer — the ones the user named, or the one picked for them that they nodded to — wait for their answers, verify each finding against the code, sort it into four tiers, and report in chat. The review itself changes no code.

## Starting it

- Claude Code: `/atw-cross-model-review`
- Codex: `$atw-cross-model-review`
- pi and omp: `/skill:atw-cross-model-review`

Every command you give the user to type — a recheck, a log review, `/atw-implement` — is in the current tool's form only, from the list above: the tool is the `host` that `host` and `pick` print (`claude`, `codex`, `pi`, `omp`), so on pi and omp it is `/skill:`, never `$`. When the tool cannot be told — `host` is null in the scripts' output — use the form the user started this skill with; only when that cannot be known either, give all three forms, each with its tool named, as `afk-notice` does.

Followed by `设置` or `setup`, it opens the [setup wizard](#setup-wizard) instead of a review. Followed by `复核` or `recheck`, it is a [recheck](#recheck) of the last review. Followed by `日志复查` or `log-review`, it is a [log review](#log-review): the reviewers read the task's decision log and the chat, not the code. Whatever else follows the command is this round's request — normally the reviewers to use ("用 codex 复查", "review it with pi on openai/gpt-6.1-sol"), and sometimes the scope (a start point, or only some folders or files). The user may also say either in plain words in the same conversation. Talk to the user in their language.

This skill has been verified only on Claude Code, Codex, pi and omp.

## The host's sandbox

The tool you run in may fence in the commands you run: no network, no writing outside the repository. Reviewers started inside that fence cannot reach their models, and the setup wizard cannot write `~/.atw/`. So at the start of every review, and before the wizard writes anything, check it from the repository root:

```bash
python3 .atw/scripts/cross_model_review.py host
```

It prints `host`, `hostCandidates`, `sandboxed`, `canRequest` (`yes`, `unknown`, `no`, or `null` when not sandboxed) and `sandboxes`, one per fence found, each with `by`, `networkDisabled`, `canRequest`, `requestWith` and `source`. It looks at that command itself: Codex's fence sets `CODEX_SANDBOX`; a command Codex runs outside after approval no longer has it but still carries `CODEX_SANDBOX_NETWORK_DISABLED`, so then it counts as outside only on macOS (where approved commands were seen to reach the network) and only when it can write `.git`; anywhere else it still counts as fenced, and you stop as below. Claude Code's own command sandbox sets `SANDBOX_RUNTIME=1` on every command it fences. pi and omp have no fence of their own.

`canRequest` follows the settings actually in effect. On Codex that is the approval setting in its own session record, which includes switches given at start-up (`--approve-for-me`, `--ask-for-approval`, a profile); `source` then names that record. `unknown` means the record could not be read and only the config file says `never` — a start-up switch may have overridden it. `no` means asking is really off: Codex's session record says `never`, or Claude Code's settings turn the retry off (`source` names the file).

- **`sandboxed` is false**: go on.
- **`sandboxed` is true and `canRequest` is `yes` or `unknown`**: ask to run outside the fence — on Codex, run the command with `require_escalated` and a one-sentence reason (the reviewers need the network to reach their models); on Claude Code, run it with `dangerouslyDisableSandbox`. Ask for `host` itself first: when the user approves, run `host` again outside the fence; only when `sandboxed` is false there are you really out. Then run every later script command that writes or starts reviewers — `prepare`, `run`, `report` and the wizard's `save` — outside the fence the same way: Codex's fence never lets a command write `.git` (`prepare` freezes the change as a git snapshot and ref there), its read-only mode writes nothing in the repository, and neither fence lets a command write `~/.atw/`. Tell the user they may choose to always allow it so they are not asked every time, and what that really does. On Codex it is permanent: allowing every command that starts with `python3 .atw/scripts/cross_model_review.py` writes a `prefix_rule` for that prefix into `~/.codex/rules/default.rules`, and from then on these commands run outside the fence without asking, in every session and every project; to undo it, delete that line from the file. On Claude Code, going by its documentation and not yet tried on the prompt for running outside the sandbox: an always-allow choice there would save an allow rule for the command to `.claude/settings.local.json` at the root of this repository, and later sessions anywhere in this repository (not other projects) would run it outside the sandbox without asking; to undo it, remove the rule in `/permissions` or from that file. Tell the user this part comes from the documentation and was not tried, and do not name a button the prompt may not show. To allow it only this once, pick the plain yes instead.
- **`canRequest` is `no`, the request is rejected or declined, or `host` run "outside" still says `sandboxed` true**: you cannot get out. Stop here, before freezing anything — nothing has been frozen or sent yet. `source` names what turns asking off (Codex `approval_policy = "never"`, in its session record or config file; Claude Code `sandbox.allowUnsandboxedCommands: false`, strict sandbox mode). Tell the user what blocked it and the three ways out:
  1. start the tool again without the fence — Codex with `--dangerously-bypass-approvals-and-sandbox` (full access); Claude Code with its sandbox turned off in `/sandbox`;
  2. change the setting that forbids asking — Codex's approval setting (`approval_policy`, or `--ask-for-approval on-request` when starting it); Claude Code's `allowUnsandboxedCommands` (the Overrides tab of `/sandbox`), or `source`;
  3. start the review from another tool instead: Claude Code, pi or omp (from Claude Code: Codex, pi or omp).

  Then wait for the user; never work around the fence another way.

## Who reviews

A reviewer is one tool and one model: the tool is `claude`, `codex`, `pi` or `omp`; the model is that tool's model name; a thinking effort in that tool's own levels is optional. Write each one as `<tool> model=<model>`, with ` effort=<level>` when the user gave one — for example `codex model=gpt-6-astra effort=high`.

- Code goes only to approved reviewers: the reviewers the user named for this round, and an auto-picked one once the user nodded. Never add, swap or drop a reviewer on your own.
- The model is always handed to the tool explicitly, so the tool cannot quietly switch to another one.
- "Another family" is relative to the AI that wrote the change: by default you, the current AI; when the user says another AI (or several) wrote it, those families. Do not guess the author.

The script works out who reviews; you only ask the user and pass on what it says. Run it from the repository root:

```bash
python3 .atw/scripts/cross_model_review.py pick \
  --model-line "<the line of your system prompt that names your model, copied verbatim>" \
  --reviewer "pi" --reviewer "codex model=gpt-6-astra effort=high" \
  --author "<family or model name>"
```

- `--model-line`: on Claude Code and omp, copy the one line of your system prompt that names your model, word for word — on Claude Code it starts "You are powered by the model", on omp it is `- Model: <provider>/<id>`. On pi and Codex leave it out: the script reads `PI_PROVIDER` / `PI_MODEL`, or this Codex session's record file. Never let the model say which model it is from memory; only these fixed sources count.
- `--reviewer`: once per reviewer the user named this round, `<tool>` with `model=` and `effort=` when the user gave them. A tool without a model gets that tool's configured default model, checked against the tool's own list (and, for omp, the thinking level written after its `:`).
- `--author`: only when the user said who wrote the change — once per family (`OpenAI`, `Anthropic`, `Google`, …) or model name they gave.

Who reviews, first match wins: the reviewers named this round, then the reviewers in this computer's settings, then one picked automatically.

It prints one JSON object: `host`, `hostCandidates`, `current` (`model`, `families`, `source`), `author`, `avoid` (the families to stay away from), `needsUser`, `mode` (`named`, `settings`, `auto` or `setup`), `settings` (the settings `file` and its `warnings`, when it was read), `reviewers` (each with `tool`, `model`, `effort`, `families`, `sameFamily`, `unrecognised`, `needsNod`, `readsWholeDisk`, `recordActualModel`) and `skipped` (`tool` and `reason`; for a settings reviewer also `model`, and `from` is `"settings"`). Exit code `2` means the call was wrong, for example an author it cannot place, a `--model-line` it cannot read on Claude Code or omp (the model id alone, for one: copy that whole line and run it again), or the settings file is broken (the error names the file and what is wrong: tell the user, and offer the setup wizard or a fix by hand); its error is on stderr.

- When `needsUser` is `current-ai-unknown`, nobody said who wrote the change and the script cannot tell which family to stay away from — it could not find out which model you are, it finds your model but cannot tell its family (`current.families` is empty), or the host markers point at more than one tool (`hostCandidates` lists them, for example Claude Code started from a Codex terminal): stop and ask the user which model wrote the change, then run `pick` again with their answer as `--author`. Do not go on with a guess.
- Families come from the model's name alone, through the script's word table; a forwarding service's name does not count. So every family is recognised by name, not verified — say "recognised by name" wherever you name a reviewer's family.
- **Named** (`mode` is `named`): every named reviewer runs as named. When one has `sameFamily` true, or `unrecognised` true (its family cannot be told), still run it, but say so before the run in the paragraph of step 2. A named tool in `skipped` cannot run (its `reason`); tell the user why and ask what to do — never swap in another reviewer yourself.
- **Not set up** (`mode` is `setup`): nobody was named and this computer has no reviewers set. Go to the [setup wizard](#setup-wizard) before anything else; it is this round's confirmation.
- **From the settings** (`mode` is `settings`): every reviewer the user set as default runs, all at once on the same material. A settings reviewer of the author's family is in `skipped` with `same-family`: it sits this round out — say which and why. One whose family cannot be told (`unrecognised` true) runs anyway — say so. One in `skipped` for another reason cannot run (its `reason`); like a named one, tell the user why and ask what to do, never swap in another reviewer yourself. Pass on every line of `settings.warnings` (keys the file has that this ATW does not know, ignored). These reviewers are already approved: no nod.
- **Auto-picked** (no reviewer named and no settings, or `mode` is `auto`): when every settings reviewer was of the author's family, the script falls back to picking one automatically (the settings reviewers are listed in `skipped`); say that first. the script went through the tools in the order Codex → Claude Code → pi → omp and took the first that qualifies — installed, logged in, its configured default model available, its family recognised, and not of a family in `avoid`. It picks exactly one, and never one picked by trying it out first: nothing is sent to any model while picking. Ask the user to nod before anything is sent — name the tool, the model and its family — even when its family is one the user approved before: where the code really goes depends on the channel behind the tool, not only on the family. When it has `readsWholeDisk` true, say in the same question that it can technically read any file on this computer that you can read (`readsWholeDisk` is false only for Claude Code reviewers, which are locked to the repository). A reviewer the user does not nod to gets nothing. With `reviewers` empty, no tool qualified: tell the user there will be no cross-model review this time and why, tool by tool from `skipped` — `not-installed`, `not-logged-in`, `no-default-model`, `default-model-unavailable`, `quota-exhausted` (an omp subscription at its limit), `probe-failed` (the check itself broke — the tool may still work), `probe-timed-out` (the check did not answer in time), `unrecognised-family`, `same-family` — and stop.
- When a reviewer could not run, `pick` with `--failed` says who may take its place — see [When a reviewer could not run](#when-a-reviewer-could-not-run).
- `recordActualModel` true means a Claude Code reviewer on its `default` short name: Claude Code decides the exact model by the account, so after the run take the actual model from that reviewer's `result.model` and report that.

Pass every reviewer the script settled on to step 1 as `<tool> model=<model>`, with ` effort=<effort>` when it has one.

## Setup wizard

The reviewers this computer uses are set once for the whole machine, in `~/.atw/reviewers.yaml` (the environment variable `ATW_REVIEWERS_FILE` moves it elsewhere) — not per project. The wizard runs when `pick` says `mode` is `setup`, and whenever the user asks for it (`设置` / `setup` after the command, or in plain words in the review conversation). The wizard is this round's confirmation: reviewers chosen in it need no further nod.

1. List what this computer has. Run from the repository root, with the same `--model-line` and `--author` as for `pick`:

   ```bash
   python3 .atw/scripts/cross_model_review.py wizard --model-line "<…>" --author "<…>"
   ```

   It prints the same `host` … `needsUser` fields as `pick`, then `tools` — all four tools in the order Codex → Claude Code → pi → omp, each with the `probe` fields (`installed`, `loggedIn`, `defaultModel`, `defaultEffort`, `families`, `reason`) plus `usable`, `sameFamily` and `readsWholeDisk` — and `recommended`, the first tool that would be auto-picked. Nothing is sent to any model. When `needsUser` is `current-ai-unknown`, ask which model wrote the change first and run it again with `--author`.
2. Show the user the usable tools: tool, default model, family (recognised by name), whether it is of the author's family, and which one you recommend (`recommended`); name the unusable ones in one line with their reasons. For each tool except Claude Code, say it can technically read any file on this computer that you can read; Claude Code reviewers are locked to the repository.
3. Ask the user to choose, in one question that always offers all three, on every host — never only whether to make it the default:
   - **Set as default** (one or more): these become the reviewers for every review on this computer. Verify and write them in one go:

     ```bash
     python3 .atw/scripts/cross_model_review.py save --reviewer "codex" --reviewer "pi model=openai/gpt-6.1-sol effort=high"
     ```

     When [the host's sandbox](#the-hosts-sandbox) fences you in, `save` cannot write `~/.atw/`: run `save` outside the sandbox as that section says, or stop there with its three ways out. A tool without `model=` keeps using that tool's own default model. The script checks every reviewer again before writing — installed, logged in, the model in the tool's own list — and prints `saved`, `file` and `reviewers` (each with `checkedModel`, `listChecked`, `usable`, `reason`). When `saved` is false, nothing was written: tell the user which reviewer failed and why, and let them choose again. Exit code `2` also means nothing was written — the file comes from a newer ATW (it is never downgraded), or it cannot be written; pass the error on stderr to the user. Keys and reviewer fields a newer ATW added are kept when the file is rewritten. Once saved, the wizard never shows up again on its own; run `pick` again (without `--reviewer`) to go on with this round.
   - **Just this time**: use the chosen reviewers for this round only and write nothing. Check them first with `check` (same `--reviewer` arguments as `save`, never writes), then run `pick` with them as `--reviewer`. The wizard asks again next time.
   - **Another model**: ask which tool and which model, then check it against that tool's own list:

     ```bash
     python3 .atw/scripts/cross_model_review.py check --reviewer "<tool> model=<model>"
     ```

     When it comes back `model-unavailable` (or another `reason`), say so and ask the user to choose again; do not guess a nearby name. Claude Code has no model list that can be read without calling a model, so `listChecked` is false for it: a logged-in Claude Code takes the model as given — tell the user it was not checked. Then go on as "set as default" or "just this time", as the user wants.

A reviewer is one line under `reviewers:`, the tool first and then optional `model=` and `effort=`:

```yaml
version: 1
reviewers:
  - codex
  - pi model=openai/gpt-6.1-sol effort=high
```

The file is plain text; the user may edit it by hand, and hand edits take effect at the next review. Keys this ATW does not know are ignored with a warning; an unknown tool, a thinking effort the tool does not have, or a missing or newer `version` makes the script stop with an error naming the file.

## 1. Freeze the change and build the material

Run from the repository root:

```bash
python3 .atw/scripts/cross_model_review.py prepare \
  --questions <this skill's directory>/references/questions.md \
  --reviewer "codex model=gpt-6-astra effort=high" \
  --pick '<the JSON object pick printed this round, verbatim>' \
  --task <task directory>
```

The script finds where the change starts; do not work it out yourself. By default it reviews everything since this branch left the main line: the current task's `base_branch` in its `task.json` (passed with `--task`), or with no task the repository's default branch. On the main line itself it reviews only the uncommitted changes (`onBase` is true). When the user gives a start point — a commit, branch or tag — pass it as `--since <ref>`; when they want only some folders or files, pass each as `--path <folder or file>`. Pass only what the user said. On Claude Code, add `--lang` as step 2 says.

Give `--reviewer` once per reviewer. Pass `--pick` the one JSON object the last `pick` of this round printed, copied whole in single quotes (after a reviewer could not run, the `pick` with `--failed`); the script takes from it which reviewers were named, who wrote the change and who in the settings sits this round out, to write the notice of step 2. Pass the questions file from this skill's own directory unchanged ([references/questions.md](references/questions.md)). With no task, or a task without `prd.md`, write a short paragraph of what the change is meant to do — from the user's words and the code — into a file and pass `--intent-file <file>` instead of, or next to, `--task`; when you are unsure what it is meant to do, ask the user first.

The script freezes everything since the merge base with the base — committed changes, uncommitted edits and new untracked files — into one patch under `.atw/.runtime/`. It leaves out `.atw/tasks/` and `.atw/workspace/`, keeps secret-looking new files (`.env*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_rsa*`, `id_ed25519*`, names containing `credentials`) out and only lists them, and records binary and large files by path only. It prints one JSON object: `stop`, `id`, `patch`, `base`, `baseFrom` (`since`, `task` or `default`), `onBase`, `baseCommit` (the start commit), `paths`, `files`, `totalLines` (added plus deleted), `linesByFolder`, `skippedSecretLike`, `pathOnly`, `reviewers`, each with `personalInstructions`, `snapshot`, and `notice` — the paragraph for step 2, as `zh` and `en`. Exit code `2` means nothing was frozen or sent; its error is on stderr — fix the call and run it again.

Two answers freeze nothing and come back with `stop` set. Stop there and ask the user before anything else:

- **`stop` is `no-changes`**: there is nothing to review in this scope. Tell the user the start commit and the paths you looked at; when `skippedSecretLike` is not empty, name those files too — they are changes, left out because their names look like secrets. Then ask the user whether to review from another start point or other paths; do not run.
- **`stop` is `over-limit`**: the patch is over 500 lines (`lineLimit`), counted without the parts left out. Give the user the `totalLines`, the `linesByFolder`, and a grouping by folder — start from `suggestedGroups` (folders in order, each group at most 500 lines) and adjust it where folders belong together; the user may change it. Ask whether to review it whole or in groups. Never split it on your own. Whole: run `prepare` again with the same arguments plus `--whole`. In groups: run it again with one `--group` per group, its folders or files separated by commas — `--group "src/api,src/db"` (a folder takes everything under it unless another group names a deeper folder; `.` means the files at the top level only). Each group is frozen as its own patch from the same start, with the same material, and the output lists them in `groups` — each with `paths`, `id`, `patch`, `files`, `totalLines`, `linesByFolder` and `pathOnly` — instead of a top-level `id`. A file that falls in no group is exit code `2`, naming the file.

`snapshot` is where this review got to: the script saved the whole working tree it saw — with the same parts left out — as a git snapshot kept under an ATW-internal ref (`refs/atw/cross-model-review/`), on no branch, without touching the user's working tree or staging area. A recheck starts from it; it goes into the report.

### What reviewers get

The script builds this material and the prompt; do not add to it, and every reviewer gets exactly the same:

- the frozen patch;
- the task's `prd.md`;
- the ticket bodies under the task's `issues/`, without their `## Comments` sections;
- the task's `decision-log.md` when it has one, as claims to check against the code — whether the code really does what the log says, for the reason it gives, and whether its evidence opens; with no log it is not mentioned;
- with no spec, your paragraph of intent instead;
- where the project's conventions are — the `.atw/spec/` indexes and the root `AGENTS.md` and `CLAUDE.md` — for the reviewer to read as needed.

### What reviewers never get

- your summary or self-assessment of the change;
- any review by a model of the same family as you, including atw-code-review reports;
- the chat history;
- commit messages;
- test results;
- the task's `research/` and `map-issues/` directories, its tracker files (`task.json`, `check.jsonl`), and anything else under `.atw/tasks/` beyond the `prd.md`, ticket bodies and decision log given above — the material tells reviewers so, and they must not use any of it as evidence.

## 2. Tell the user, then start

Apart from the nod an auto-picked reviewer needs and the two stops in step 1, do not wait for a yes — but tell the user first. Never call `run` before the user has seen this notice. The script has written it: `notice` in the `prepare` output, the same paragraph in Chinese (`zh`) and English (`en`). Post the one in the user's language word for word — for any other language, translate `en` sentence by sentence, leaving nothing out — as a message of its own in the chat, after `prepare` and before you start `run`: visible text, not in your thinking, and not held back for the report. It is the user's only chance to stop the run; given only in the report, it comes too late. You may add words before or after it — on a recheck, the round number — but never cut or reword any of it, and do not write your own paragraph instead.

**On Claude Code**, Claude Code shows the paragraph itself: give `prepare` `--lang zh` or `--lang en` — the user's language, `en` for any other — and ATW's hook shows that paragraph to the user word for word as soon as the command ends, without passing through you, then tells you so in a system reminder. Do not post it again and do not reword it; for a language other than Chinese or English, still post your sentence-by-sentence translation of `en`. When the reminder says the paragraph was too long to show, or no reminder comes — the hook is not installed — post it yourself as above.

It already gives every item below that applies, and only those:

- the scope: the base commit, the number of files, and the line count (`totalLines`); when `onBase` is true, that only the uncommitted changes are reviewed; the paths, when the user narrowed it; with groups, each group's folders, number of files and line count; on a recheck, the snapshot it starts from;
- who gets the change: each reviewer's tool, model and family, recognised by name;
- for a named reviewer of the same family as the author, or one whose family cannot be told (named or from the settings): that it runs anyway, and so the review counts for less;
- the settings reviewers skipped this time, and why;
- for each named reviewer other than Claude Code: it can technically read any file on this computer that you can read;
- the secret-looking new files left out, by name (`skippedSecretLike`);
- for each Codex reviewer whose `personalInstructions` is set: it will read the user's personal instructions at that path — Codex has no switch to turn them off;
- that reviewers may read other files in the repository, read-only (task records outside the material excepted);
- that each reviewer gets at most 30 minutes, and that the user can interrupt now to change the scope.

Without `--pick` the script cannot tell who was named, who wrote the change or who was skipped, and leaves those items out. This paragraph is notice, not a question: to change the scope the user interrupts before the run. It also opens the report, whole and word for word (step 5).

Tried on Claude Code 2.1.299 as the host, in three rounds of trials: it still wrote a shorter sentence of its own before `run` instead of the paragraph, and left out items such as the family recognised by name — hence the hook above. Where the hook has not shown it, post the paragraph anyway. When what comes out before `run` is shorter, it must still keep at least the scope, who gets the change, the secret-looking files left out and that a Codex reviewer reads the user's personal instructions (each when it applies), that reviewers may read other files read-only, the 30 minutes, and that the user can interrupt now; everything else the report's "What was run" gives, because it carries the whole paragraph.

## 3. Run every reviewer at once

Only once the notice of step 2 is in the chat:

```bash
python3 .atw/scripts/cross_model_review.py run <id>
```

When the change was split, run this once per group with that group's `id`, one group after another; every group goes to the same reviewers.

One command runs all of them at the same time, each through `atw channel run --json`: read-only, clean environment, no session record, standard speed tier, the explicit model and the effort if given, at most 30 minutes. When [the host's sandbox](#the-hosts-sandbox) fences you in, run it outside the fence as that section says. Wait until it ends — see [Waiting the full time](#waiting-the-full-time). It prints one JSON object: `baseCommit` and `patchHash` (the start commit and a hash of the patch these reviewers read — keep both for a retry), `snapshot` (as from `prepare`, for the report), `durationMs`, and for each reviewer its `tool`, `model`, `effort`, then:

- `result` — the channel's result object: `status` is `done` (finished), `timeout` (no answer within 30 minutes), `error` (it failed after it had begun answering, for example its quota ran out partway) or `not-started` (it never got going); then `text`, `partial` (true when `text` is what it had written before it stopped), `durationMs`, `costUsd`, `costUnreported`, `usage`, `model`, `instructionSources`, `error` (the raw error), `errorKind`, `errorStatus` and `errorSubkind` (the error kind, HTTP status and finer kind the tool itself reported, or `null`);
- `stage` — where it stopped: `null` (finished and read everything, or did not say), `not-started` (never started), `partway` (stopped partway), `unread` (finished, but did not read everything);
- `codeSent` — whether the code had gone to it: `yes`, `no` (only when the tool could not even be launched or failed its handshake, a Codex reviewer that exited before its handshake finished (Codex takes the questions only after it), or `atw channel run` refused its own arguments before starting anything — see `argsRefused` — so the questions never left this machine), or `maybe` (the questions may have reached the model — also for a reviewer that never said anything, since a tool can reject the questions after receiving them; whether it had opened the patch cannot be told);
- `argsRefused` — present, as `true`, only when `atw channel run` refused its own arguments before starting anything; its raw error in `result.error` starts with `error: `, such as `error: unknown option '--read-only'`, most likely because the `atw` on PATH is not the version this project's ATW expects — tell the user so, with the raw error;
- `spent` — whether money or quota was spent: `yes`, `no`, or `unreported` (the tool reported no cost);
- `notRead` — what it said it did not read, from the `## Not read` section that ends its answer, one patch file per line: `text` (its own words), `files` (the patch's files it named), `partFiles` (those it read only part of), `unmatched` (lines that name no file of the patch), `lines` (the changed lines of `files`, or `null` when there are `unmatched` lines), `linesAtMost` (true when some files were only partly unread, so `lines` is an upper bound) and `suggestedGroups` (folder groups, only past 500 lines); `null` when its answer has no such section. A log review's `notRead` is different: see [Log review](#log-review).

When it ends, the patch and the temporary channels are gone, also for reviewers that failed; their raw error is in `result.error` — keep it for the report.

### Waiting the full time

The reviewers run at the same time, each for at most 30 minutes, plus the time they take to start: leave the command at least 40 minutes, and never stop it or move on before it ends. Each host's own limit on a command is shorter by default, so on each:

- **Claude Code**: a command in the foreground gets at most 10 minutes, so run it with `run_in_background` and an explicit `timeout` of `2400000` (40 minutes; the most is `7200000`), and wait for the notice that it ended. Without the `timeout`, an unattended session (`-p`, the Agent SDK, CI) stops a background command after 30 minutes, and a `-p` run given its prompt as text after only 10 minutes.
- **Codex**: the command goes to the background when it does not end at once; keep polling it, each poll waiting at most 5 minutes, until it has ended — about eight polls for a full run. Do not end your turn while it is still running.
- **pi**: its command tool has no time limit by default; run it in the foreground and do not pass a shorter `timeout`.
- **omp**: its command tool stops a command after 300 seconds by default, even after moving it to the background; pass `timeout` `2400` (seconds, at most 3600) or `0` (no limit).

### When a reviewer could not run

A reviewer could not run when its `result.status` is `timeout`, `error` or `not-started` — it failed, its quota ran out, or it gave no answer within 30 minutes. Tell the user on the spot, before you verify anything, one reviewer at a time:

- which reviewer: tool and model;
- where it stopped, from `stage`: never started, or stopped partway;
- its raw error, `result.error`, verbatim — do not paraphrase it;
- whether the code had already been sent to it, from `codeSent` (`maybe`: it may have been — never say "not sent" unless it is `no`);
- whether any money was spent, from `spent` — with `result.costUsd` or `result.usage` when the tool reported them; `unreported` means the tool reported no cost.

Then find out who may take its place: run `pick` again with exactly the arguments of this round, plus `--failed <tool>` once per reviewer that could not run. Its `failed` list has one entry per such reviewer, each with `from` (`named`, `settings` or `auto`), `ask` and `next` (a reviewer like those in `reviewers`, or `null`):

- **`ask` is `nod`** — the reviewer was auto-picked. Recommend `next`, the next one that qualifies (tool, model, family recognised by name), and switch only when the user nods. With `next` null, no other tool qualifies: say so, from `skipped`.
- **`ask` is `retry-switch-skip`** — the user chose this reviewer, on the spot or in the settings. Never swap it on your own. Say why it could not run, and ask in one question: retry it / switch to `next`, the one the auto pick would choose (name its tool, model and family) / skip it. With `next` null, leave the middle choice out and say that no other tool qualifies.

The other reviewers' results of this round are given anyway: verify and report them without waiting for the answer. To retry or switch, run `prepare` again with the same scope arguments and only that reviewer, plus `--expect-base` with the first `run`'s `baseCommit` and `--expect-patch` with its `patchHash`, then `run` it, and add its result to the same report. For one group of a split change, pass that group's folders and files as `--path` instead of `--group`. `sameAsBefore` in the `prepare` output says whether the start commit and the patch are still the first run's. When either is false, this reviewer is reading not the same material as the others — the change moved in between: tell the user before the run, and say so in the report next to this reviewer's findings.

A reviewer that timed out or failed partway may have left a partial answer (`result.partial` true). Verify and sort its findings like any other, mark them 「没跑完」 (not finished), and give them.

When no reviewer finished, the report's first sentence is 「这次没有做成跨模型复查」 (in the user's language when it is not Chinese). Never substitute your own review, or one by a model from the same family, for the missing answers.

### When a reviewer did not read everything

When `stage` is `unread`, the reviewer finished but says it left parts unread. List those parts by file in the report — `notRead.files`, with `notRead.lines` changed lines (with `notRead.linesAtMost` true, "at most": the files in `notRead.partFiles` were read in part) — and mark the verdict 「有部分没看」 (partly unread).

When `notRead.unmatched` is not empty, the reviewer named parts that are not files of the patch, and `notRead.lines` is null: the size is unknown, not 0. Quote those lines word for word, say the size is unknown, and ask the user which files they cover before suggesting a re-read.

Then ask the user whether to have the same reviewer read only those parts: one more run for that reviewer, nobody else, costing money and time again. Never re-read it on your own. When the user says yes, run `prepare` again with one `--path` per file in `notRead.files` and only that reviewer, then `run` it. When the unread parts add up to more than 500 lines, suggest reading them separately in the folder groups of `notRead.suggestedGroups` (adjust where folders belong together); the user decides, as with an over-limit patch.

When `notRead` is null, the reviewer did not say what it left unread: say so in the report, and do not present its review as covering the whole change.

## 4. Verify each finding and sort it into four tiers

Follow [references/four-tiers.md](references/four-tiers.md). In short: go back to the code and check every finding before you sort it; the reviewer's severity is only a hint; dismissing a critical finding, or one about security or correctness, needs the specific code that proves it cannot happen; a spec that is unclear goes to the user to decide.

Never substitute your own review, or one by a model from the same family, for a cross-model review. A reviewer that gave no answer gave no review; say so instead of filling the gap.

Something you noticed yourself while verifying may be said only in the chat after the report, marked as yours — not raised by any reviewer and not part of the cross-model review. Never put it in the report (not in the draft you hand to `report`, not in any tier), and never let it stand in for a reviewer's conclusion.

## 5. Report in chat

Follow [references/report-format.md](references/report-format.md): one-sentence verdict, the paragraph from step 2 (`notice`, whole and word for word) with time and cost, the four tiers in the user's language with who raised each finding, and every reviewer's full answer in its original words. A change reviewed in groups gets one report, with one section per group.

Write the whole report as a draft file under `.atw/.runtime/` — copy each reviewer's `result.text` into it word for word — and hand it to the script before the user sees any of it:

```bash
python3 .atw/scripts/cross_model_review.py report --file .atw/.runtime/cross-model-review-report.md --task <task directory>
```

- The script redacts anything that looks like a secret — `sk-` and `sk-ant-` keys, `ghp_` and `github_pat_` tokens, Slack tokens starting `xox`, `AKIA…` and `AIza…` keys, three-part JWTs, whole `-----BEGIN … PRIVATE KEY-----` blocks (a cut-off one up to where its key lines end), and long values, symbols allowed, assigned to names like `api_key`, `secret`, `token` or `password` — replacing each with a placeholder naming its type, such as 「[已打码：私钥]」. Short values and ordinary code (`token = "abc"`, `password = process.env.DB_PASSWORD`, `api_key = os.environ.API_KEY_V2`, URLs, constant names) are left alone. Once the redacted text is saved (or with no task, ready), it deletes the draft, so the text before redaction is not left on disk.
- With `--task`, it saves the redacted report as one Markdown file per review under the task's `cross-model-review/` folder, named by date and time. With no task there is no `--task`: the report goes to chat only and no file is written. A saved report is never frozen into the next review's patch.
- It prints one JSON object: `text` (the redacted report), `redactedCount`, `redactions` (each with `type`, `line` and `section`, the heading it falls under) and `saved` (the file, or `null`). Exit code `2` means nothing was saved and nothing may be shown yet — for example the task directory does not exist or cannot be written; its error is on stderr. The draft is kept then, unredacted: tell the user the error, fix the cause and run the same command again, or, when it will not be run again, delete the draft.

Show the user `text` exactly as given — the chat and the saved file are the same redacted text; never show the draft or quote a reviewer's raw answer from `run` instead. When `redactedCount` is not 0, tell the user how many places were redacted and where (section and line from `redactions`), and that the saved file has the same placeholders; never repeat what was redacted. When the user picks findings to change, write them to a new draft and add them to the end of the saved report through the script, which redacts them first:

```bash
python3 .atw/scripts/cross_model_review.py report --file .atw/.runtime/cross-model-review-picks.md --append <saved file>
```

It prints the same JSON object, `text` being the redacted part it added and `redactions` counting lines in the saved file; tell the user about redactions the same way. Never edit the saved file by hand. With no task there is no saved file: give the picks in chat.

## After the report

The review changes no code. The user picks what, if anything, to change — any findings, from any tier. You never start the next round yourself — another review happens only when the user asks for one.

When the user picks, add the picked findings to the end of the saved report with `report --append` (step 5), each with its tier and number as the report gives them. Then:

- **With a task**: record the picked findings as new tickets in the task's `issues/`, the way the project's tracker doc says tickets are written (`docs/agents/issue-tracker.md`; next free number, `Blocked by`, `Status: ready-for-agent`, `Impl: ready`, an acceptance checklist). Each ticket names the saved report file and where in it the finding is (tier and number), and carries its evidence as you verified it — location, problem, the code that shows it. Do not change the code yourself. When the task is already at `accept`, move it back first: `python3 .atw/scripts/task.py set-status <task directory> implement`. Then tell the user to run `/atw-implement` or `/atw-implement-all` (on Codex `$atw-implement` or `$atw-implement-all`, on pi and omp `/skill:atw-implement` or `/skill:atw-implement-all`; give only the current tool's form); the fix goes through tests, the two-axis review and a commit as usual.
- **Findings marked "you decide"** (the spec is unclear): first amend `prd.md` — you draft the change, show it, and write it only once the user confirms. Then ask whether a ticket is still needed.
- **With no task**: follow ATW's usual triage and ask whether to create a task for the fixes. When the user says no, treat it as a small change and make the fix directly. There is no saved report: give the picks in chat.

## Recheck

A recheck is the review command followed by `复核` or `recheck` (for example `/atw-cross-model-review 复核`). Only the user starts one: never start a recheck yourself, and from the third round on do not suggest one while Must fix is not empty (below). It checks whether the picked findings were fixed, and looks at nothing but what changed since the last review. A full review again only when the user says so in so many words — then run steps 1–5 from the start, as for a first review.

1. **The last report.** With a task, it is the newest file in the task's `cross-model-review/` folder: take from it the `snapshot`, the reviewers, the round number, and the picked findings appended at its end, word for word. With no task there is no saved report, so a recheck is possible only in the same conversation as the review it follows: take the `snapshot`, the reviewers and the round number from the report you gave in this conversation, and the findings the user picked in this conversation, as you gave them back in chat; in a new conversation say there is nothing to recheck from, and offer a full review instead. With no findings picked, there is nothing to recheck: say so and stop.
2. **Freeze what changed since.** Write the picked findings into a file under `.atw/.runtime/`. Run `pick` with each of last time's reviewers as `--reviewer` — the same tools, models and efforts — and `--model-line` and `--author` as in [Who reviews](#who-reviews); then run `prepare` with the same reviewers, passing that `pick` output as `--pick`:

   ```bash
   python3 .atw/scripts/cross_model_review.py prepare \
     --recheck <snapshot from the last report> \
     --picked-file .atw/.runtime/cross-model-review-picked.md \
     --questions <this skill's directory>/references/recheck-questions.md \
     --reviewer "codex model=gpt-6-astra effort=high" \
     --pick '<the JSON object that pick printed, verbatim>' \
     --task <task directory>
   ```

   With no task there is no `--task`: pass `--intent-file` with the same paragraph of intent as the first review. When the last review was narrowed to some folders or files with `--path`, do not pass them again: the snapshot records them and the recheck keeps to the same scope; pass `--path` only when the user narrows this recheck further.

   It freezes only what differs from the snapshot — with the same parts left out — and gives the reviewers the spec and tickets, the picked findings and that patch, with [references/recheck-questions.md](references/recheck-questions.md) as the questions. Its output is as in step 1, with `baseFrom` `snapshot` and a new `snapshot` for this round. **`stop` is `no-changes-since-snapshot`**: nothing changed since the last review; do not run — tell the user the fixes have not been made yet, or were not saved in the working tree. `no-changes`, `over-limit` and the groups work as in step 1.
3. **Tell, run, verify.** The paragraph of step 2 says this is a recheck and from which snapshot; add the round number next to it. Run as in step 3; every run is a new session — a reviewer never resumes an earlier one. Then verify as in step 4: mark each picked finding 「改好了」 (fixed), 「没改好」 (not fixed) or 「改了一半」 (half fixed), from the code, with the reviewers' marks as hints; sort new problems that only the newly changed code brings into the four tiers. Findings about code outside the new changes are not part of a recheck: leave them out, or note them as Dismissed with that reason.
4. **Report** as in step 5, with the marks before the four tiers and the round number in the verdict. The round count is for the same change: the first review is round 1 and each recheck one more. From the third round on (one review and two rechecks) with Must fix still not empty, do not suggest another recheck: tell the user the approach may be wrong or the spec unclear, and it may be time to rethink rather than fix again.

## Log review

A log review asks a reviewer from another family to pick holes in the task's decision log (`decision-log.md`) against the chat it was written in: decisions whose evidence is weak or missing, checks said to be done that were not, choices that look risky in hindsight, and what is easy to miss. It reads no code: no patch is frozen and there is no 500-line stop. Only the user starts a log review — never start one yourself. It works on any task that has a decision log.

- Claude Code: `/atw-cross-model-review 日志复查`
- Codex: `$atw-cross-model-review 日志复查`
- pi and omp: `/skill:atw-cross-model-review 日志复查`

`log-review` in place of `日志复查` works the same.

1. **The sandbox and who reviews.** Check [the host's sandbox](#the-hosts-sandbox) as for any review. Then pick the reviewers exactly as in [Who reviews](#who-reviews): those the user named this round, else the ones in the settings, else one auto-picked that needs the user's nod — the same `pick` command and the same rules for the author's family and for families that cannot be told. The author is the AI that wrote the log, normally you.
2. **Build the material.** By default the review reads the most recent run: the rows written by the conversation of the log's last start row, and that conversation's chat from its start row on. Pass `--whole` only when the user asks for the whole log; it then reads every row and the chat of every run. With `--session <id>` it reads only the run of that conversation, and a bare `--session` names this conversation: the unattended end of `/atw-implement-all --afk` and `/atw-implement-spec --afk` uses it. A review the user starts keeps the default, except when the user's input names a conversation, or an unchecked `log-review-failed` item in the task's `waiting-on-you.md` names the conversation an unattended run's log review was for: then pass `--session <that id>`, so the make-up review reads that conversation's run, not the most recent one; with several such items naming different conversations, ask the user which. Run from the repository root:

   ```bash
   python3 .atw/scripts/cross_model_review.py prepare-log \
     --questions <this skill's directory>/references/log-review-questions.md \
     --reviewer "codex model=gpt-6-astra effort=high" \
     --pick '<the JSON object pick printed this round, verbatim>' \
     --task <task directory>
   ```

   On Claude Code add `--lang zh` or `--lang en` as in step 2.

   The script finds each run's conversation by the id its start row recorded and reads its chat with `atw mem extract --context <id> --tools --after <start row time>`: what the user and the AI said, each command and the first and last lines of its result (20 at each end), each message a hook had Claude Code show the user — the notices above among them — and no thinking. It reads each chat once, whole, redacts the rows and every item of the chat with the same rules as `report` before cutting the results and writing them under `.atw/.runtime/`, and from the same read keeps a second copy of the chat with 5 lines at each end for a retry when the material is too long. It prints one JSON object: `kind` (`log-review`), `stop`, `scope` (`last-run`, `session` or `whole`), `runs` (each with `session`, `start`, `end` and `rows`), `rows`, `id`, `prompt`, `files`, `resultLines`, `redactedCount`, `redactions`, `reviewers`, `chatProblems` and `notice`. Exit code `2` means nothing was written or sent — for example a decision log it cannot read; its error is on stderr.

   - **`stop` is `no-log`**: the task has no decision log, or none with a start row. Tell the user there is nothing to review.
   - **`stop` is `no-run`**: the conversation `--session` named has no run in the log — `session` gives its id, null when this conversation's id cannot be found — and nothing was written or sent. Tell the user; never read another conversation's run in its place.
   - **`stop` is `chat-not-found`**: the chat of a run could not be found, and nothing was written or sent. `chatProblems` gives each such run and its `reason`: `no-session-id` (its start row recorded no conversation id), `manual-override` (the id carries no platform prefix ATW gives its ids, so it most likely came from a manual `ATW_CONTEXT_ID` override — a raw value by which `atw mem` cannot find any session), `unreadable-id` (the id belongs to a tool ATW knows but whose chats `atw mem` cannot read), `not-found` (no session file carries it, for example moved or deleted), `ambiguous` (several do) or `mem-failed` (with `atw mem`'s own `error`). Tell the user which run and why. A log review needs that chat, so it cannot be done for that run — never pick or use another conversation in its place, and never send the log without its chat. With `--whole`, offer the most recent run alone when its chat was found.
3. **Tell, then run.** Post `notice` word for word, as a message of its own, before you start `run` — as in [step 2](#2-tell-the-user-then-start), the one in the user's language and whole: do not reword it, do not compress it into a sentence of your own and do not drop any sentence (its 30 minutes, for one, are for all of a reviewer's tries together). The shorter paragraph step 2 tolerates on Claude Code does not apply here. On Claude Code, when a system reminder says ATW's hook has shown it, do not post it again and do not reword it. Then run every reviewer at once with `python3 .atw/scripts/cross_model_review.py run <id>`, waiting as in [Waiting the full time](#waiting-the-full-time).

   For a log review, when a reviewer fails the script retries it automatically, by the cause it reads first from the error kind the tool reports (`result.errorKind`) and, when there is none it knows, from the tool's error text; the last cause is each reviewer's `failureReason`:
   - `transient` (the connection dropped, the service erred or was overloaded, a rate limit): run again as is;
   - `too-long` (the material is over the model's limit): run again with the 5-line copy of the chat; when that is too long as well, it stops;
   - `tool-error` (the tool refused its arguments, a version mismatch): not retried, and nobody takes its place;
   - `unknown` (no cause it can tell): run again once;
   - `not-installed`, `not-logged-in`, `quota-exhausted`, `model-unavailable`: not a failed review, and not retried;
   - `timeout` (30 minutes): not retried; its partial answer is used and marked 「没跑完」.

   Each reviewer is retried at most twice, and its 30 minutes are for all its tries together: a retry gets only the time left, and with too little left (under a tenth of it) there is no retry and `retryStoppedBy` is `time-limit`. `retries` counts the retries and `attempts` lists every try with its `material` (`full` or `short`), `status`, `reason`, `error`, `timeout`, `durationMs`, `costUsd`, `costUnreported`, `codeSent` and `spent`; the reviewer's own `codeSent` and `spent` count every try, and `total` adds up every try's `durationMs` and `costUsd`, with `costUnreported` true when any try reported no cost. A reviewer that still could not run is handled as in [When a reviewer could not run](#when-a-reviewer-could-not-run): tell the user, find who may take its place with `pick --failed`, and ask the user — retry it, switch or skip it; never swap on your own. Its way to retry or switch is not the code review's: run `prepare-log` again with the same scope — `--whole` only when the first had it, `--session` with the same id only when the first had it — and only that reviewer, then `run` it, and add its result to the same report. A log review freezes no patch, so there is no `--expect-base` or `--expect-patch`.
4. **Verify and sort** as in [references/four-tiers.md](references/four-tiers.md), going back to the log, the chat and the evidence the rows point at instead of the code. Never substitute your own check of the log, or one by a model of your family.

   What a reviewer left unread is taken as it wrote it: a log has no patch files to match, so its `notRead` has only `text` and `parts`, each line of its `## Not read` section word for word (rows by their time, stretches of the chat by their time). With "None", `parts` is empty and it read everything. When `parts` is not empty, `stage` is `unread`: list `notRead.parts` word for word in the report and mark the verdict 「有部分没看」. This is not the code review's [When a reviewer did not read everything](#when-a-reviewer-did-not-read-everything): never ask the user which files they cover, and never offer a re-read. When `notRead` is null — no `## Not read` section, or the heading with nothing under it — the reviewer did not say what it left unread: say so in the report, and do not present its review as covering the whole log.
5. **Report** as in [references/report-format.md](references/report-format.md), with what it says about a log review; every retry goes into the report — which reviewer, the cause and how each try ended. Save it with:

   ```bash
   python3 .atw/scripts/cross_model_review.py report --file .atw/.runtime/log-review-report.md --task <task directory> --log-review
   ```

   It goes to the task's `log-review/` folder, not `cross-model-review/`: a log review read no code, and a report in `cross-model-review/` would hold back the cross-model review reminder at acceptance. The rest is as in [step 5](#5-report-in-chat): show `text`, tell the user about redactions, never edit the saved file by hand. When the user handles a Must fix finding — picks it to change, or decides it needs no change — add it to the end of the saved report with `report --append` as the report format says, so that `decision_log.py pending` stops listing it. There is no recheck of a log review.

   Then record the log review in the task's decision log, with one row — also when it stopped without a review. Write it only now, after the report is saved or the review stopped: a start row written before `prepare-log` would make this conversation the most recent run. When this conversation has not written to the log yet, `add` writes its start row first by itself — the row `python3 .atw/scripts/decision_log.py start` would write — so run `python3 .atw/scripts/decision_log.py add` with the phase 「日志复查」 (`log review`), the reviewers as the decision, and as the result how many findings fell in each tier, or why no review was done; the evidence is the saved report under `log-review/`, or the stop it ended on.
