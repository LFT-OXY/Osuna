---
name: atw-implement
description: "根据一份规格说明书或一组工单，完成一项工作。"
disable-model-invocation: true
---

Implement the work described by the user in the spec or tickets.

If the user passes a ticket reference, fetch it from the issue tracker and state its title before starting. If the reference is ambiguous, ask. If the tracker already marks a different ticket as in progress, stop and say so — don't switch tickets on your own.

Call the Skill tool with "atw-tdd" where possible, at pre-agreed seams.

Run typechecking regularly, single test files regularly, and the full test suite once at the end.

If the work changes what a user sees, build that part by calling the Skill tool with "atw-ui" — logic stays test-first, the UI is verified on real screens. Capture screenshots into the task directory's `screenshots/` for each UI acceptance criterion (screen, state, viewport in the file name), and look at them before calling the work done.

Once done, call the Skill tool with "atw-code-review" to review the work. When screenshots were captured, pass their paths so the review runs its Visual axis.

Work the findings before committing. Fix what the review raised, then re-run the tests it touched.

**If the review surfaces a hard problem, stop** — the spec is wrong or self-contradictory, the fix needs a decision nobody has made, or it reaches outside this ticket's slice. Don't paper over it and don't silently widen the scope to absorb it. Say what the finding is and what it blocks, and get the decision from the user before writing more code. If the answer changes what the work is supposed to do, that change lands in the spec via the step below, not only in the code.

Then call the Skill tool with "atw-update-spec" to fold what actually got built back into the spec. The next review's Spec axis compares code against the spec, so a spec that lags behind the code makes that axis meaningless.

Commit your work to the current branch.
