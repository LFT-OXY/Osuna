# `usage` in code is upstream's Plan usage; Osuna's Usage code is `usage-stats`

Upstream v0.11 renamed `packages/app/src/provider-usage/` to `packages/app/src/usage/`, rewrote it, and added `packages/server/src/server/session/usage/usage-session.ts` with a `UsageSession` class. All of it is subscription limits, which the glossary calls **Plan usage**. Osuna already had its **Usage** code (tokens and estimated cost) at the same app path and a session handler with the same file and class name. We moved Osuna's side: the app module is `packages/app/src/usage-stats/`, and the handler is `UsageStatsSession` in `packages/server/src/server/session/usage-stats/usage-stats-session.ts`. Upstream's paths and names stay as upstream wrote them, so later upstream changes to plan usage merge without a path collision. The UI keeps the wording of the [glossary](../glossary.md): **Usage** is tokens and cost, **Plan usage** is subscription limits.

Only the two colliding places moved. `packages/app/src/components/usage/`, `packages/server/src/server/usage/`, `packages/protocol/src/usage/`, the `usage.report.get` family of messages, `features.usage`, and the `/usage` route keep their names: upstream has nothing at those paths, and the message names are published protocol.

## Considered Options

- Keep only Osuna's plan usage UI and drop upstream's rewrite. Rejected: the rewrite carries the new logins, OpenCode Go, the unavailable reasons, the modal, the sidebar summary, and the per-account card. Every later upstream change there would have to be ported by hand.
- Take upstream's naming everywhere, UI included. Rejected: Osuna's Usage page has no upstream counterpart, and the app would show two entries labelled "Usage" that mean different things.
- Let both sides share `packages/app/src/usage/`. Rejected: `format.ts` and `format.test.ts` exist on both sides with unrelated content, so every upstream merge would conflict there, and one directory would hold two concepts.

## Consequences

- A path or symbol named `usage` under `packages/app/src/usage/` or `session/usage/` is Plan usage. Don't rename it to match the glossary.
- New Osuna Usage code goes in `usage-stats`, never in upstream's `usage` directories.
- `usage.report.get.*` (Osuna, tokens and cost) and `usage.list_reports.*` (upstream, plan usage) share the `usage.` prefix on the wire and mean different things. Both are published and stay.
