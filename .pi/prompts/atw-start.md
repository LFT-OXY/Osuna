# Start Session

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

**No active task** → classify first. For simple conversation / small task, ask only whether this turn should create an ATW task. For complex work, ask whether you may create an ATW task and enter `discover` — that ask is **stop ①**, and task creation is step **1.0**. If the user says no, skip ATW for this session.

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
