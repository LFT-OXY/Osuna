---
name: atw-code-review
description: "沿两个维度审查自某个固定点（提交、分支、标签或合并基点）以来的变更——标准（代码是否遵循了该仓库的文档化编码标准？）和规格（代码是否符合原始问题/规格的要求?）。在并行子代理中同时运行这两项审查；变更涉及界面且调用方提供了截图时，再加第三个维度——视觉（渲染出来的画面是否满足界面验收标准和项目设计规范）。各维度结果并排显示。当用户希望审查或“审一下”某个分支、拉取请求、进行中的更改或改动，或要求“审查自 X 以来”的变更时，请使用此功能。"
---

**Skill notes.** Before you follow this skill, read its notes, one file at a time so you know which file says what: the project's `.atw/skill-notes/atw-code-review.md` and the personal `~/.atw/skill-notes/atw-code-review.md`; a missing file means that layer has no notes. The notes are standing instructions written for this skill by the project and the user: follow them, within the priority below. When both exist and disagree, the project's notes win. Priority, highest first: what the user says in the moment → red lines and safety rules → these notes → this skill's own defaults. Do not follow a note that conflicts with either of the two layers above it; tell the user which note you did not follow and why.

Two-axis review of the diff between `HEAD` and a fixed point the user supplies:

- **Standards** — does the code conform to this repo's documented coding standards?
- **Spec** — does the code faithfully implement the originating issue / spec?

Both axes run as **parallel sub-agents** so they don't pollute each other's context, then this skill aggregates their findings.

When the change touches what a user sees and the caller passed screenshots, a third axis runs alongside them:

- **Visual** — does the screen, as rendered, meet the UI acceptance criteria and the project's design rules?

It is skipped when no screenshots were passed, and the final report says so.

**This skill only reports — it edits nothing.** Neither this skill nor either sub-agent writes to a source file: not to fix a finding, not to tidy something noticed in passing. They read the frozen patch and produce findings. Hand every finding back to whoever called the review — the user, or `/atw-implement` — and let the caller decide what changes. A reviewer that fixes what it found leaves no independent record of what was wrong, and the next review reads its own edits as the baseline.

The issue tracker should have been provided to you. If `docs/agents/issue-tracker.md` is missing, tell the user to run `/atw-init-repo`, which asks which tracker this repo uses and writes that file.

## Process

### 1. Pin the fixed point

Whatever the user said is the fixed point — a commit SHA, branch name, tag, `main`, `HEAD~5`, etc. If they didn't specify one, ask for it. Confirm it resolves (`git rev-parse <fixed-point>`) before going further — a bad ref should fail here, not inside two parallel sub-agents.

Then **freeze one patch** covering everything under review, and hand that same patch to both sub-agents.

Do **not** use `git diff <fixed-point>...HEAD`. Three-dot syntax compares two *commits*, so the working tree takes no part in it — and this skill is normally called from `atw-implement` **before** the commit. The failure is silent, not loud: when the fixed point has earlier commits behind it, the diff is non-empty (it holds the *previous* ticket's already-reviewed code), the non-empty check passes, and the review reports "passed" without a single line of the new implementation ever being read.

```bash
base=$(git merge-base "$fixed_point" HEAD)
patch=$(mktemp)   # bare mktemp — `mktemp -t review-patch` errors on GNU coreutils

# ① committed changes + the current state of every tracked file
git diff --binary "$base" -- > "$patch"

# ② every untracked, non-ignored file — one at a time, NUL-safe
git ls-files --others --exclude-standard -z |
  while IFS= read -r -d '' f; do
    git diff --no-index --binary -- /dev/null "$f" >> "$patch" || true
  done
```

- `git ls-files --others` lists **files**, so no directory expansion is needed. (`git status --porcelain` reports a new directory as a single `?? newdir/` entry — that is why it isn't used here.)
- `git diff --no-index` **exits 1 when it finds a difference**. That is the normal result, not a failure — hence the `|| true`.
- Nothing writes to the index, so review stays read-only and never contends for `index.lock`.
- Cap the size of any single untracked file you inline. `--binary` base64-encodes content, so one image or build artifact can swamp the patch and both sub-agents' context. Over the cap, record the path and skip the body, and leave a line in the patch saying so. Screenshots in the task's `screenshots/` are evidence for the Visual axis, not code: always record their paths and skip their bodies.

Check that `$patch` is non-empty — this replaces the old "diff is non-empty" check. Also note the commit list via `git log <fixed-point>..HEAD --oneline`. If the patch is large, check its total size before spawning: both sub-agents receive it, so the token cost is doubled.

#### Run the floor guard

The moment the patch is frozen, run the floor guard on it — before step 2, before any sub-agent is spawned. It reads only the frozen patch and runs no git of its own, so the guard and the sub-agents look at the same change.

```bash
floor=$(mktemp); floor_err=$(mktemp)
task_dir=$(python3 .atw/scripts/task.py current 2>/dev/null)
if [ -n "$task_dir" ] && [ -f "$task_dir/waiting-on-you.md" ] && [ -f "$task_dir/decision-log.md" ]; then
  python3 .atw/scripts/floor_guard.py "$patch" --waiting-on-you "$task_dir/waiting-on-you.md" --decision-log "$task_dir/decision-log.md" > "$floor" 2> "$floor_err"
else
  python3 .atw/scripts/floor_guard.py "$patch" > "$floor" 2> "$floor_err"
fi
floor_exit=$?
```

When the current task's directory holds both `waiting-on-you.md` and `decision-log.md`, the guard gets them too and passes a placeholder that an item in that list names under the three conditions in step 3. A passed placeholder is still printed, with `放行：等你处理第 N 条` (passed: waiting-on-you item N) at the end of its line. The guard reads the two files when it runs, which is why it runs here, before anything else in the review: an item written after the review began cannot pass. Without both files the guard runs exactly as before.

- `0` — clean, or every line it printed is a placeholder it passed against a waiting-on-you item.
- `1` — at least one finding that was not passed. One line per finding: rule name, `file:line`, the marker or a short snippet. Seven rules: `skip-marker`, `suppress-comment`, `test-file-deleted`, `assertion-removed`, `ignore-entry`, `placeholder`, and `guard-opt-out` — a file whose head declares `floor-guard: opt-out — <reason>` is reported as that one line (file, reason) instead of line by line; a declaration without a reason does not count. The declaration is read from the file in the working tree when it is there (a hunk that never shows the file head still counts), so run the guard from the repo root. Conditional skips (`.skipIf(`, `pytest.mark.skipif`, a `pytest.skip(` under an `if`) are not reported; an assertion that was only edited around (its expression is still in the file) is not reported as removed.
- `2` — the guard did not run (file missing, not a patch, a waiting-on-you list or decision log it cannot read, the script itself failed). Its error is in `$floor_err`, kept apart from the findings in `$floor` so nothing but findings ever lands in the report verbatim. **`2` is never `0`**: a guard that did not run is a hard violation in the report (step 5), not a clean result.

Keep `$floor` and `$floor_exit`. The output goes into the Standards sub-agent prompt (step 4) and, verbatim, into the final report (step 5).

### 2. Identify the spec source

Look for the originating spec, in this order:

1. A path the user passed as an argument.
2. Wherever `docs/agents/issue-tracker.md` says specs live — its "When a skill says publish to the issue tracker" section names the location for this repo. Some trackers scope it to the current unit of work rather than a fixed directory; follow whatever resolution step it gives.
3. Issue references in the commit messages (`#123`, `Closes #45`, GitLab `!67`, etc.) — fetch via the workflow in `docs/agents/issue-tracker.md`.
4. A spec file under `docs/`, `specs/`, or `.scratch/` matching the branch name or feature.
5. If nothing is found, ask the user where the spec is. If they say there isn't one, the **Spec** sub-agent will skip and report "no spec available".

### 3. Identify the standards sources

Search the repo for every file that documents how code should be written. When `CODING_STANDARDS.md` or `CONTRIBUTING.md` exists, it must be on the list.

On top of whatever the repo documents, the Standards axis always carries the **smell baseline** below — a fixed set of Fowler code smells (_Refactoring_, ch.3) that applies even when a repo documents nothing. Two rules bind it:

- **The repo overrides.** A documented repo standard always wins; where it endorses something the baseline would flag, suppress the smell.
- **Always a judgement call.** Each smell is a labelled heuristic ("possible Feature Envy"), never a hard violation — and, like any standard here, skip anything tooling already enforces.

Each smell reads *what it is* → *how to fix*; match it against the diff:

- **Mysterious Name** — a function, variable, or type whose name doesn't reveal what it does or holds. → rename it; if no honest name comes, the design's murky.
- **Duplicated Code** — the same logic shape appears in more than one hunk or file in the change. → extract the shared shape, call it from both.
- **Feature Envy** — a method that reaches into another object's data more than its own. → move the method onto the data it envies.
- **Data Clumps** — the same few fields or params keep travelling together (a type wanting to be born). → bundle them into one type, pass that.
- **Primitive Obsession** — a primitive or string standing in for a domain concept that deserves its own type. → give the concept its own small type.
- **Repeated Switches** — the same `switch`/`if`-cascade on the same type recurs across the change. → replace with polymorphism, or one map both sites share.
- **Shotgun Surgery** — one logical change forces scattered edits across many files in the diff. → gather what changes together into one module.
- **Divergent Change** — one file or module is edited for several unrelated reasons. → split so each module changes for one reason.
- **Speculative Generality** — abstraction, parameters, or hooks added for needs the spec doesn't have. → delete it; inline back until a real need shows.
- **Message Chains** — long `a.b().c().d()` navigation the caller shouldn't depend on. → hide the walk behind one method on the first object.
- **Middle Man** — a class or function that mostly just delegates onward. → cut it, call the real target direct.
- **Refused Bequest** — a subclass or implementer that ignores or overrides most of what it inherits. → drop the inheritance, use composition.

#### Floor-guard checks

After the smell baseline, the Standards axis always carries three **floor-guard checks**. Unlike the smells, these are **hard violations, not judgement calls**: each either happened in the diff or it didn't, and no "possible" label applies. The floor guard script (step 1) catches the mechanical part — markers, deleted tests, removed assertions, ignore entries, placeholders; these three cover what needs reading:

- **Thresholds** — a numeric bar in configuration (coverage requirement, budget, severity level) moved: was it lowered or raised? Lowering is the violation; raising is not.
- **Placeholders** — a stub, `not implemented`, empty catch or TODO left in the change: did the ticket, the PRD, or a waiting-on-you item passed under the three conditions say in advance that this placeholder would be there? If not, it is a violation.
- **Exceptions** — a skip, suppression or ignore entry: is it written on the offending line itself, with a reason? An exception somewhere else, or without a reason, is a violation.

**Every finding the floor guard reports goes into the report, unless the ticket or the PRD said in advance that it is allowed.** "Said in advance" means a line in the ticket or the PRD that names the placeholder or exception — or, for a placeholder only, an item in the task's waiting-on-you list (`waiting-on-you.md`) that passes all three conditions below. So the sources of "said in advance" are the ticket, the PRD, or a waiting-on-you item passed under the three conditions. Nothing else exempts a finding — not a commit message, not a code comment, not the author's word, not a decision-log row on its own.

A placeholder left because an unattended run lacked an external account, a key or a payment passes against a waiting-on-you item only when all three hold:

1. The item's category is external account · key · payment (外部账号·密钥·付费).
2. The item is still open (not checked off), names this placeholder's `file:line`, says what is missing and how to hook it up once filled in, the decision log has the item's row and that row has not been superseded, and the item was written before this review began.
3. The report still lists it, marked `放行：等你处理第 N 条` (passed: waiting-on-you item N).

The guard checks the first two itself when step 1 hands it the two files, and marks the line; take its mark as the verdict and do not pass a placeholder by reading the list yourself. Every other placeholder is as before: if the ticket or the PRD did not say it in advance, it is a hard violation.

#### Security and speed checks

Two more checklists join the Standards axis only when the change calls for them. They are not a new axis: the Standards sub-agent runs them, and a change that calls for neither carries neither. Read the patch and decide:

- **Security check** — when the change touches what atw-security's description lists: external input, login and permissions, stored data or personal information, file upload, external services, or calling AI models. Load atw-security's completion self-check — the "Verification" list in [atw-security](../atw-security/SKILL.md) — and check the change against each item.
- **Speed check** — only when the change clearly affects speed: a hot loop, a query, bundle size, or page load that the change is about or visibly makes heavier — a new query in ordinary feature code does not by itself qualify. Load the seven questions under "Benchmark checklist" → "The questions" in [atw-performance](../atw-performance/SKILL.md), and check that the change carries measurements — before-and-after numbers in the patch (a benchmark, a raw data file, a decision-log row) or in the commit list — and that the numbers answer the seven questions. A change that clearly affects speed and carries no measurements is a hard violation. Measurements that do not answer all seven questions are a judgement call — name the questions left unanswered.

A self-check item is a hard violation only when the code this change adds or modifies shows it failing. An item the patch simply does not contain — rate limiting or security headers that live elsewhere in the system — is not a finding: a missing item is not a vulnerability. An item the changed code touches but the patch cannot settle is a judgement call — say what would settle it.

### 4. Spawn the sub-agents in parallel

The Standards and Spec sub-agents read the **frozen patch from step 1** and run **no git commands of their own** — same input, no chance of one axis seeing a file the other missed, and no re-deriving the untracked list from memory.

**Standards sub-agent prompt** — include:

- The path to the frozen patch, and the commit list. State plainly: this patch is the complete change under review, including uncommitted and untracked files; do not run git.
- The list of standards-source files you found in step 3, **plus the smell baseline from step 3** pasted in full — the sub-agent has no other access to it.
- **The floor guard's output** from step 1 — the contents of `$floor` pasted verbatim with `$floor_exit`, **plus the floor-guard checks from step 3** pasted in full. Tell the sub-agent what to do with it: for each line the guard reported, check whether the ticket or the PRD said in advance that it is allowed — a line the guard marked `放行：等你处理第 N 条` is allowed by waiting-on-you item N: list it as passed with its item number, not as a violation — and report every line that isn't allowed as a hard violation; if the exit code is `2`, report "the floor guard did not run" as a hard violation.
- The security check, the speed check, or both from step 3, pasted in full, when the change calls for them — the section's text plus the "Verification" list or the seven questions it points at, with one line on what in the change triggered each. When neither applies, paste neither.
- The brief: "Report — per file/hunk where relevant — (a) every place the diff violates a documented standard: cite the standard (file + the rule); (b) any baseline smell you spot: name it and quote the hunk; (c) every floor-guard finding not allowed in advance by the ticket, the PRD or a waiting-on-you item the guard passed, and every floor-guard check that fails — say where the ticket or PRD allows the ones you drop, and list each passed line with its waiting-on-you item number; and (d) when the security or speed check is pasted, every item of it the change fails, and for the speed check whether the change carries measurements that answer the seven questions. Distinguish hard violations from judgement calls — documented-standard breaches can be hard, floor-guard findings and checks are always hard, security and speed findings are hard or judgement calls as the pasted section says, but baseline smells are always judgement calls, and a documented repo standard overrides the baseline. Skip anything tooling enforces. Under 400 words."

**Spec sub-agent prompt** — include:

- The path to the frozen patch, and the commit list. Same instruction: the patch is complete; do not run git.
- The path or fetched contents of the spec.
- The brief: "Report: (a) requirements the spec asked for that are missing or partial; (b) behaviour in the diff that wasn't asked for (scope creep); (c) requirements that look implemented but where the implementation looks wrong. Quote the spec line for each finding. Under 400 words."

If the spec is missing, skip the Spec sub-agent and note this in the final report.

**Visual sub-agent prompt** (only when screenshots were passed) — the Visual sub-agent judges what it sees, so it gets **no patch, no code, and no build history**. Include:

- The screenshot paths, each labelled with screen, state and logical viewport.
- The spec's UI and Design section and the ticket's UI acceptance criteria.
- The path to the UI layer's `design-system.md` in `.atw/spec/`, if the project has one.
- The project's accessibility requirements, if it has any (in `design-system.md` or elsewhere in `.atw/spec/`); otherwise the path to atw-ui's [accessibility checklist](../atw-ui/references/accessibility-checklist.md).
- The brief: "Look at every screenshot before judging. Report: (a) UI acceptance criteria not met, citing the screenshot; (b) departures from the project's design rules — colours, type sizes, spacing or components outside them; (c) the one to three biggest visual problems — hierarchy, alignment, crowding, overflow, unreadable text — each with location, observation and a concrete fix; (d) accessibility problems the screenshots show, checked against the project's accessibility requirements or, when it has none, the accessibility checklist — contrast, visible focus, colour as the only signal, target size — leaving out what a screenshot cannot show. Distinguish observable defects from taste. Do not open source files. If you cannot view images, say so and stop. Under 400 words."

This sub-agent needs a model that can view images. If none is available, skip it and say in the final report that the Visual axis did not run.

Issue every sub-agent call together, in the foreground, and aggregate the reports they return.

### 5. Aggregate

Present the reports under `## Standards` and `## Spec` headings — plus `## Visual` when that axis ran — verbatim or lightly cleaned. Do **not** merge or rerank findings — the axes are deliberately separate (see _Why two axes_).

Under `## Standards`, add a `### Floor guard` sub-section: the guard's output from step 1 verbatim, its exit code, and the sub-agent's verdict on each line — where the ticket or PRD allows it, passed: waiting-on-you item N (for a line the guard marked `放行：等你处理第 N 条`), or a hard violation. Passed lines stay in the sub-section and do not count as violations in the Standards tally. When the exit code was `2`, the sub-section says **"the floor guard did not run"**, carries the error from `$floor_err`, and counts as a hard violation in the Standards tally — a guard that did not run is not a clean guard. Say on one line which of the security and speed checks the Standards axis carried and what triggered each, or that it carried neither.

End with a one-line summary: total findings per axis, and the worst issue _within each axis_ (if any). Don't pick a single winner across axes — that's the reranking the separation exists to prevent.

When the user asked for this review themselves, inside an ATW task, and the change is a high-risk change or the task's decision log has rows marked unsure (拿不准), close the report with one sentence suggesting a cross-model review — one sentence even when both hold. Say nothing when `/atw-implement`, `/atw-implement-all` or `/atw-implement-spec` runs this review as a step of its flow, and nothing for a small change with no task. High-risk means you read the whole change and it really changes behaviour in at least one of three areas — security (login and authentication, permission checks, keys and encryption, handling content from outside, network endpoints open to others), data (database schemas, data migrations, deleting or bulk-rewriting user data, data formats saved to disk or sent out), or irreversible or wide blast radius (releases, deployment and upgrades, public interfaces and command-line arguments others depend on, billing and payment); a typo, comments or tests alone do not count, and concurrency and retries are not on the list. Unsure rows are technical judgements made without being sure; when the task has a `decision-log.md`, list them with `python3 .atw/scripts/decision_log.py unsure` — rows already superseded are left out — acknowledged ones still count. The sentence, for a high-risk change, names the files and the area each falls in; for unsure rows, names each row by its time and decision; says what it costs — one run's money or quota, the code is sent to another company's model, and it takes up to about 30 minutes; and gives the input for the user's current tool only, the one line below that names that tool:

- Claude Code: `/atw-cross-model-review`
- Codex: `$atw-cross-model-review`
- pi: `/skill:atw-cross-model-review`
- omp: `/skill:atw-cross-model-review`

The user runs it; you never start it. When the change is not high-risk and there are no unsure rows, say nothing about cross-model review at all — not that it is not needed, not that the change is low-risk. Once per task: say nothing when the task directory already holds a report under `cross-model-review/`, or when it was already suggested in this conversation.

## Why two axes

A change can pass one axis and fail the other:

- Code that follows every standard but implements the wrong thing → **Standards pass, Spec fail.**
- Code that does exactly what the issue asked but breaks the project's conventions → **Spec pass, Standards fail.**

Reporting them separately stops one axis from masking the other.

The Visual axis exists for the same reason: code can match the spec and every standard and still render as an unreadable, overflowing screen. Neither code-reading axis can see that.

## Rationalizations specific to this skill

Same shape as the general table in `.atw/workflow.md`; these are the excuses that only show up while reviewing.

| Rationalization | Reality |
|---|---|
| The patch is too big to read in full, sample it | Say it is too big to read in full; sampling is not reviewing |
| This is a judgement call, no need to report it | Judgement calls get reported too — labelled as judgement calls |
| The author says it has been tested | Do not accept conclusions; look only at artefacts |
| Nobody wrote this standard down | The smell baseline applies even when the repo documents nothing |
