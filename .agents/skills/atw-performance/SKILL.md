---
name: atw-performance
description: "性能优化：让本来就慢的东西变快——页面加载、接口响应、构建、批处理的速度（performance、benchmark、profiling、latency、p50、p95）。用户说「太慢了，想快一点」「优化一下性能」「达不到速度目标」时用，一眼看出慢在哪、只是小改动时也先用它，再读代码、测速和改：先量现在多慢，报任何数字前过 7 个自检问题，按「不做、别重复做、少做、晚点做、趁用户不注意时做、并行做、做得更便宜」的顺序试，一次只改一处、同样的方法再量，没明显变快就撤回，每轮记进决定日志。用户要求持续改进（跑几轮、一直优化到达标）时，建任务、问需求或提任何条件之前先读它，照它提出指标、达到多少算成的目标值、最多轮数三样各给建议值，三样都经用户同意才开始第一轮，「收益太小就停」不算目标。原来正常、改了什么之后才变慢的用 atw-diagnosing-bugs。"
---

# ATW Performance

**Skill notes.** Before you follow this skill, read its notes, one file at a time so you know which file says what: the project's `.atw/skill-notes/atw-performance.md` and the personal `~/.atw/skill-notes/atw-performance.md`; a missing file means that layer has no notes. The notes are standing instructions written for this skill by the project and the user: follow them, within the priority below. When both exist and disagree, the project's notes win. Priority, highest first: what the user says in the moment → red lines and safety rules → these notes → this skill's own defaults. Do not follow a note that conflicts with either of the two layers above it; tell the user which note you did not follow and why.

For making something faster that is already slow, or that misses a speed target. Two ways to use it:

- **One-off fix** (the default): one slow thing, fixed and proven — see "One-off fix".
- **Sustained improvement**, only when the user asks for it: iterate on one metric toward an agreed target — see "Sustained improvement".

For sustained improvement, read this whole skill before you create a task, ask about the requirements, or propose any condition for the run: the ATW flow's brainstorm or spec asks this skill's three agreements, it does not replace them.

Every number either way is vetted with the "Benchmark checklist" before you report it or act on it, and every change is kept or reverted by "Keep or revert".

It used to be fine and got slower after a change: that is a regression, and it goes to the `atw-diagnosing-bugs` skill. When you cannot tell which, measure how slow it is now, then ask the user since when it has been slow.

## Where the work happens

- Do performance work inside an ATW task (`python3 .atw/scripts/task.py current`). With no current task, ask the user whether to create one before you start; create it the way `.atw/workflow.md` says.
- Every attempt, kept or reverted, gets one row in the task's decision log, written by the main conversation: the hypothesis, the change, the before and after numbers, the verdict (kept or reverted), and where the raw data is. A reverted attempt leaves no trace in git, so the row is how a dead idea stays dead; read the log before each attempt.

  ```bash
  python3 .atw/scripts/decision_log.py add --phase "<性能第 N 轮 | perf round N>" --decision "<the change>" --why "<the hypothesis>" --evidence "<where the raw data is>" --result "<before → after, runs, range; verdict: kept | reverted>"
  ```

  When the task has no `decision-log.md` yet, this skill opens it: run `python3 .atw/scripts/decision_log.py start --lang <zh|en>` (the user's language) first, then `add`.
- Save the raw measurements as files in the task directory (for example `perf/round-03.txt`), and point to them from the row; the row carries the summary, not the raw runs.
- A sub-agent returns only the numbers and where its raw data is; it writes no log row.
- When you are an implementer sub-agent, make the change yourself and dispatch no sub-agent; put each attempt and its numbers in your report so the main conversation logs it.

## Benchmark checklist

Use this when you produce a performance number: a change's before and after, a regression claim, a hillclimb harness, or a library or config choice. Answer each question with evidence from a run, not a guess about the code.

For a quick ballpark the user asked for, one run is enough. Still check questions 4 and 7, and say that it is one run. Skip the rest unless that run looks wrong. A choice between options is never a ballpark.

### Before you run anything

- Write down the claim you expect to make, in the words you would ship ("export is 30% faster at p50 on the 60k-row dataset"). The questions test that sentence.
- Read the measurement script. Note what it times, counts, and ignores.
- Check the load average with `uptime` (Linux and macOS) and the core count with `nproc` on Linux or `sysctl -n hw.ncpu` on macOS. If the machine is busy, find out what is running. If you cannot stop it, interleave the sides so both see the same noise, and say so in the report.

### The questions

1. **Why not double?** Name the limiter. Profile in a run you do not report, because profilers and tracers slow the work down. Use CPU per process (`top` on both; `pidstat` on Linux, `ps -o pid,%cpu,command -p <pid>` on macOS), a runtime profiler (`node --cpu-prof`, `py-spy`; `perf` on Linux, `sample <pid>` on macOS), I/O wait, and syscall counts (`strace -c` on Linux; on macOS `sudo dtruss -c`, which System Integrity Protection blocks for most system binaries), then map the hot spot to source. Watch the load generator too: if it saturates first, you measured the load generator. If a change did not move the number, the limiter explains why, so find it before you call the change useless.
2. **Was it tuned?** Run every side the way production runs it: release builds, production flags and env, batching and transaction settings, connection pools, caches as warm or cold as production sees them, and the same versions and data. If one side runs on defaults, you compared configurations, not implementations. A limiter that is a setting (a commit per row, a debug build, a missing index) means that side is untuned. Tune it and measure again before you pick a winner. If you cannot tune it, do not pick a winner from that run. When the user is choosing what to adopt, narrowing the claim to the code as it ships today does not fix this, because they adopt the option, not today's settings.
3. **Did it break limits?** Do the arithmetic. Compare bytes per second with disk and network bandwidth, operations per second times cost per operation with your cores, and the time saved with the time the changed piece took. Removing a piece that takes 10% of the run can make the run at most about 11% faster. A result past a limit measured something other than the work, such as a cache, a no-op, or a bug.
4. **Did it error?** Count failures and non-success responses, and check that outputs are correct, not just present. Rejections are often fast, and timeouts and retries are slow. If the script does not count errors, add the count.
5. **Does it reproduce?** Run each side at least 5 times, alternating (A, B, A, B, and so on) so warmup, lazy initialization, caches, and drift favor neither. Report the median and range. A gap smaller than the run-to-run variation is no measurable difference. When the call is close, use a rank-sum test or the harness's own statistics.
6. **Does it matter?** Next to any micro result, measure the end-to-end path a user waits on, with realistic data sizes and concurrency, and report the micro result as a share of the whole. A helper that takes 1% of a request can make the request at most 1% faster, however fast the helper gets.
7. **Did it even happen?** Confirm the work ran inside the timed region: the request reached the server, the rows were written, the bytes were read, and the code used the result. Lazy code (generators nobody iterates, promises nobody awaits, results the JIT can discard) and timeouts produce numbers for work that never happened.

### Report

- Lead with the verdict: faster, slower, no measurable difference, or inconclusive.
- Give the number with its unit, the run count, the range, and the limiter. For example, "p50 41 ms → 33 ms, median of 7 runs per side, range 32 to 35 ms after, bound by JSON parsing on one core."
- Call the verdict inconclusive when you claim a difference but cannot name the limiter, when a side ran untuned, or when you could not check questions 4 and 7. Name the gap.
- Keep a commit message to one primary number. Put the runs, range, and limiter evidence in the raw data file the log row points to.

Vet the one-off fix's baseline before you plan from it, and every number after that. Vet the sustained improvement's harness before it is frozen; the frozen harness then prints error and work counts, so each keep-or-revert checks questions 4 and 7 for free.

## Keep or revert

Decide every attempt strictly, against the baseline measured the same way:

- A change whose speedup is not past the run-to-run variation is reverted — including a simplification that came along with it. Neutral code costs maintenance and bought nothing.
- Slower: revert.
- Faster, but a test went red: revert. An optimization that wins by dropping work the product needed is a regression.
- Past the variation and the tests green: keep, and commit it with the before and after numbers in the message.

Undo only the edits this round made, and leave every other change in the tree alone — the user's, another task's, or an earlier kept round's. Reverse your own edits (by hand, or `git apply -R` of a patch of only your edits); never `git checkout --`, `git restore`, `git stash` or `git reset` on files or a tree that held changes before the round began.

## One-off fix

This is the default. You own the measurement story: plan, review, verify the numbers. Tie every fix to a measurement; don't read source instead of measuring.

1. Capture a baseline measurement of the slow path. Vet the baseline, and each later number, with the "Benchmark checklist".
2. Ground hypotheses in the measurement and the code. Don't claim a perf ceiling without running it first.
   Try the performance mantras in order, cheapest first:
   1. Don't do it. Stop work whose result nothing uses rather than cheapening it.
   2. Do it, but don't do it again.
   3. Do it less.
   4. Do it later.
   5. Do it when they're not looking.
   6. Do it concurrently.
   7. Do it cheaper.

   When an earlier mantra meets the target, stop.
3. Plan the fix from the measurement. Fix one thing per attempt, then measure again the same way as the baseline — same command, same conditions, same data — and verify each attempt before trying the next. Several changes measured together give one number you cannot attribute.
4. Parse and compare the artifacts (JSON to sqlite, diff). "Inconclusive" or wrong-surface is not a pass. Flag it. Keep or revert by "Keep or revert", and log the row either way.
5. **Guard what you kept.** Once you stop trying attempts and at least one was kept, add one guard so the thing does not slow back down. Guard the metric the user actually feels, not every available number: the same LCP, INP, p95 latency, wall time or other number that justified the fix. One guard for the whole fix, on its final number, not one per kept attempt. When it can be a test in the project, write it as one: a budget the project's own test command checks, repeated and compared by median so normal run-to-run variation does not make it flaky. A guard that needs an external monitoring service (field or real-user monitoring, alerting): only recommend it in your reply. Do not set up the service, an account or an alert for the user. When neither fits, say so in your reply, and why. Budget examples and how to enforce a budget in CI are in `references/performance-optimization.md`, "Step 5: Guard Against Regression". When a guard fires later, the thing got slower after a change: that is a regression, and it goes to the `atw-diagnosing-bugs` skill.
6. Cite the measurement in the commit message. Commit the guard with the fix it guards: write it before you commit the last kept attempt and put both in that commit, so the guard fails on the baseline, passes with the fix, and reverts with it. When that attempt is already committed because a later one was reverted, commit the guard on its own right after, naming the fix's commit.

To know what to measure first, and the usual bottlenecks and their fixes, see the attached files below.

**Reply:** baseline number, post-fix number, delta, raw data path, the decision-log rows written, and the guard you added, the monitoring you recommend, or why neither fits.

## Sustained improvement

Only when the user asks for it — "keep going until it's under 200 ms", "跑几轮看看能提升多少", "一直优化到达标". Otherwise do a one-off fix. You own the metric and the experiment's integrity.

Core discipline: one change, one measurement, keep or revert. Never stack untested changes, and never claim a win from code inspection.

1. Ground the workload and architecture before choosing the metric. Read the source along the target path, name the realistic workload dimensions that can move the result (data size, history, state, concurrency), and select a case that reproduces the user's complaint. If no case reproduces it, fix the repro instead of hillclimbing.
2. **Hard stop before round 1: agree three things.** Propose all three to the user together, each with a suggested value, before round 1 and before any other condition you propose for the run:
   - **the metric** to improve, and the direction that counts as better (for example, the median wall time of the full run);
   - **the target**: a value of that metric that counts as success (for example, "under 0.5 s" or "at least 80% faster than the baseline"). A stop rule such as "stop when a round gains less than 5%" is not a target; offer it, if at all, next to the target, never instead of it;
   - **the most rounds** to try.

   Numbers the user already gave win over yours. Start round 1 only once the user has agreed to all three; while any one is missing or not agreed, ask for it and start nothing. When the ATW flow runs a brainstorm or spec first, ask them there, as this skill says. Stop as soon as any one holds: the target is met, the agreed rounds are used up, or no idea left is worth trying. Then report. Don't relax the target to meet it, and don't add rounds without asking.
3. Build the measurement harness, prove its sensitivity, then freeze it. Run contrasting realistic workloads and confirm the target case reproduces the symptom while easier cases separate as expected. If the harness cannot distinguish them, revise the workload or metric. Vet the harness with the "Benchmark checklist" before you freeze it, and make it print its error count and a count of the work done. Once frozen, one repeatable command emits the metric, sampled enough to clear the noise (median of N, not a single run). Once frozen, do not change the harness, the workload or the metric for the rest of the run; if it turns out wrong, stop and tell the user. Record the baseline metric and a green run of the regression gate (the tests that must keep passing) before any change.
4. Ground each hypothesis in the architecture model from step 1, so it names a specific mechanism ("defer X off the boot path because it blocks first paint"), not "try memoizing something". For a perf metric, order hypotheses by the performance mantras in "One-off fix" step 2. Borrow only their order, not that step's stop rule.
5. Loop, one hypothesis per round:
   - Make the change with a tight scope: in the main conversation, yourself or through the implementer as usual; as an implementer, yourself (see "Where the work happens"). When several independent hypotheses are live, their changes may be prepared in parallel, each in its own worktree.
   - Formal before-and-after runs go one at a time, with no other heavy work on the machine — no build, test suite, other benchmark or parallel attempt running alongside.
   - Measure before and after with the frozen harness, and run the regression gate.
   - Keep or revert by "Keep or revert". A tweak that "might help" is not kept.
   - One commit per accepted fix, staging only the files you changed (`git add <files>`, never `-A`). Log the row either way, kept or reverted.
   Each round ends in a check before the next begins.
6. Push past the first plateau. On a stall, several rejects in a row, pivot category, combine near-misses, re-read the source, or try something more radical before concluding the hill is climbed. Correctness and simplicity outrank the number.
7. Within the agreed rounds, don't quit while cheap untried hypotheses remain. If you are stuck, surface it instead of spinning.
8. Leave the accepted commits on the current branch in the order they landed; review and acceptance follow the task's ATW flow. Do not open a pull request, push or merge.

**Reply:** the metric and target, baseline to final with the percent delta, rounds run (kept vs reverted), each accepted fix on one line, the decision-log path and raw data folder, and the best idea you would try next if pushed further.

## Attached files

Open them when you need them, not up front:

- `references/performance-optimization.md` — the measure, identify, fix, verify, guard workflow; "Where to Start Measuring" (what to measure first for a slow page, a sluggish interaction or a slow backend); the frontend and backend bottleneck tables; the anti-pattern catalogue; the keep-or-revert table; budgets and regression guards.
- `references/optimization-patterns.md` — a worked fix for each anti-pattern.
- `references/performance-checklist.md` — frontend and backend checklists, TTFB diagnosis, caching strategies, measurement commands, common anti-patterns.
