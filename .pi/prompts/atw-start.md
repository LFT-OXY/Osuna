# Start Session

**Skill notes.** Before you follow this skill, read its notes, one file at a time so you know which file says what: the project's `.atw/skill-notes/atw-start.md` and the personal `~/.atw/skill-notes/atw-start.md`; a missing file means that layer has no notes. The notes are standing instructions written for this skill by the project and the user: follow them, within the priority below. When both exist and disagree, the project's notes win. Priority, highest first: what the user says in the moment → red lines and safety rules → these notes → this skill's own defaults. Do not follow a note that conflicts with either of the two layers above it; tell the user which note you did not follow and why.

Initialize an ATW-managed development session. This platform has no session-start hook, so manually load the equivalent compact context by following these steps.

---

## Step 1: Current state
Identity, git status, current task, active tasks, journal location.

```bash
python3 ./.atw/scripts/get_context.py
```

If this output includes a line beginning `ATW update available:`, copy the full line verbatim when summarizing session context. Do not shorten operational command hints.

## Step 2: Workflow overview
Compact Phase Index, request triage rules, planning artifact contract, and the step-detail command.

```bash
python3 ./.atw/scripts/get_context.py --mode phase
```

Full guide in `.atw/workflow.md` (read on demand).

## Step 3: Guideline indexes
Discover packages + spec layers, then read each relevant index file.

```bash
python3 ./.atw/scripts/get_context.py --mode packages
cat .atw/spec/guides/index.md
cat .atw/spec/<package>/<layer>/index.md   # for each relevant layer
```

Index files list the specific guideline docs to read when you actually start coding.

## Step 4: Decide next action
Step 1 gave you the active task's `status`. The stage *is* the route — each of the six stages maps to one step in the Phase Index you loaded in Step 2:

- `status=discover` → **1.1**
- `status=specify` → **1.2**, then **1.3** on sub-agent-dispatch platforms
- `status=slice` → **1.4**
- `status=implement` → **2.1**
- `status=accept` → **3.1**
- `status=completed` on a task still under `.atw/tasks/` → **3.2**. The archive was interrupted partway; re-run `task.py archive <task>` to finish it.

Load the step detail before acting on it:

```bash
python3 ./.atw/scripts/get_context.py --mode phase --step <X.X> --platform pi
```

`/atw-continue` carries the same six stages with their artifact checks and stop points — use it when you need more than the step number.

**No active task, and the request is about a task that already exists** — the user names it, or asks to continue or accept and only one open task fits (Step 1 lists them) → make it this session's task first; do not ask whether to create a new one. Use `task.py resume <task>` at any stage, `implement` and `accept` included: it only bookmarks the task for this session and changes no file. `task.py start` is only for step 1.5, where a task leaves `slice` (or `specify`, when the work was not sliced) for `implement`; do not run it to pick up a task. Then follow its stage as above: `implement` → **2.1**, `accept` → **3.1**. Several open tasks fit and nothing tells which: ask which one.

**Any other request** → classify first. For simple conversation / small task, ask whether this turn should create an ATW task. In that ask, say what each answer means: without a task there is no requirements document (`prd.md`) and no formal acceptance (each requirement checked with evidence, the user signs off); a task adds writing the requirements, the user confirming the spec, implementing against it, and that acceptance before archiving. For complex work, ask whether you may create an ATW task and enter `discover` — that ask is **stop ①**, and task creation is step **1.0**. If the user says no, skip ATW for this session.

---

## Skill routing (quick reference)

| User intent | Skill |
|---|---|
| New feature / unclear requirements | `atw-askme` |
| About to write code | `atw-before-dev` |
| Done coding / quality check | `atw-code-review` |
| Stuck / fixed same bug multiple times | `atw-diagnosing-bugs` |
| Learned something worth capturing | `atw-update-spec` |

Full rules + anti-rationalization table in `.atw/workflow.md`.
