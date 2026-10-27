# The four tiers

How the AI that started a cross-model review sorts each finding a reviewer sends back. These rules hold however the review was run and whoever the reviewers were.

The reviewers are aggressive on purpose, and they saw only the material they were given. You can see the whole codebase. Use it: filter, check and decide — do not just pass findings along.

## The tiers

- **Must fix** — it should not be merged into the main line without this fix.
- **Worth considering** — a real problem; whether to fix it is a trade-off.
- **Noted** — right, but nothing needs to change.
- **Dismissed** — wrong, nitpicking, or missing context; always with the reason.

## Check before you sort

Before a finding goes into any tier, go back to the code: read the place it points at, its callers, and whether the input it worries about can actually get there. A finding about something that cannot happen is Dismissed, with the code that shows why. Never sort a finding you have not checked, and never repeat a reviewer's claim as if you had.

Dismiss "I would have done it differently" unless the reviewer shows a concrete problem with the way it is. Dismiss findings that come from missing context — about code the change did not touch, or a pattern the rest of the codebase uses on purpose — and say what the reviewer could not see.

## The reviewer's severity is only a hint

A `critical` finding does not go into Must fix by itself, and a `nit` usually ends in Noted or Dismissed. To dismiss a `critical` finding, or any finding about security or correctness, point to the specific code that proves it cannot happen. Do not dismiss a finding because it is uncomfortable.

## Findings about the spec

A finding that the spec is unclear, contradicts itself or misses a case goes into Worth considering, marked "you decide" (in Chinese: 「要你定」) — how the spec changes is the user's call. Ask this of every finding before it goes into Must fix: does it rest on a case the spec does not settle? When the gap has already made the code clearly depart from what the user meant, it goes into Must fix.

## When Must fix has more than five

Check each one again against "it should not be merged into the main line without this fix". If more than five are still left, list them all as they are and tell the user this change may need a rethink. Never move a finding down a tier to make the list shorter.

## All dismissed

When the reviewers raised any `critical` or `warning` finding and none of them ended in Must fix or Worth considering, say "all dismissed" plainly in the report, so the user can look at your reasons.

## Who raised it

Keep, for every finding, which reviewer raised it. A finding that two or more reviewers raised on their own is the strongest signal there is; mark it.

## Not a substitute

Your own review, or a review by any model from the same family as the author, is not a cross-model review and never stands in for one.
