# Directory Structure

All daemon code is under `packages/server/src/`. ESM with `.js` import suffixes on relative paths (`./bootstrap.js`), TypeScript strict, `@osuna/*` workspace packages imported by subpath (`@osuna/protocol/error-utils`).

## Top level

| Directory                    | Owns                                                                                                                                                                              |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/`                    | The daemon: bootstrap, WebSocket server, session, agent manager, providers, stores, schedules, plugins, hub, speech                                                               |
| `server/session/<domain>/`   | Session RPC handlers split by domain: `checkout/`, `files/`, `provider/`, `schedule/`, `voice/`, `workspace-git-observer/`, `owned-subscriptions/`, …                             |
| `server/agent/`              | Agent lifecycle (`agent-manager.ts`), persistence (`agent-storage.ts`), tool catalog (`tools/`), MCP adapter, `providers/`                                                        |
| `server/test-utils/`         | Daemon E2E harness: `osuna-daemon.ts`, `daemon-client.ts`, `fake-agent-client.ts`, `session-stubs.ts`, `temp-github-repo.ts`                                                      |
| `services/`                  | Git forge adapters: `forge-service.ts` is the port; `github-service.ts`, `gitlab-service.ts`, `gitea-service.ts` are adapters; `forge-registry.ts` / `forge-resolver.ts` pick one |
| `terminal/`                  | PTY sessions, output coalescing, shell integration, activity tracking (`docs/terminal-performance.md`, `docs/terminal-activity.md`)                                               |
| `utils/`                     | Process and Git primitives: `spawn.ts`, `run-git-command.ts`, `git-process-scheduler.ts`, `tree-kill.ts`, `path.ts`, `worktree.ts`                                                |
| `tasks/`                     | Task documents and execution graph for orchestration                                                                                                                              |
| `executable-resolution/`     | Locating provider binaries, with a Windows variant                                                                                                                                |
| `test-utils/` (package root) | `vitest-setup.ts` (loads `.env.test`, sets `OSUNA_SUPERVISED=0`), `test-logger.ts`, `platform.ts`                                                                                 |

`docs/architecture.md` has the key-modules table with one line per module. Keep that table current when you add a module.

## Shape of a domain

A domain is a directory with one public surface and colocated tests. `server/session/checkout/` is the reference:

```
server/session/checkout/
  checkout-session.ts          # the handler module the session delegates to
  checkout-session.test.ts
  git-metadata-generator.ts
  git-metadata-generator.test.ts
```

Rules that the tree enforces by example:

- **Path is part of the name.** `server/pagination/cursor.ts`, not `server/pagination-cursor-utils.ts`. Deepen the path before adding a suffix.
- **No `index.ts` barrels that only re-export.** The few `index.ts` files that exist (`server/session/owned-subscriptions/index.ts`, `server/orchestration-skills/index.ts`, `server/plugins/settings/index.ts`) carry real code. Import from the source file.
- **Tests sit next to the file:** `pid-lock.ts` + `pid-lock.test.ts`. Variant suffixes route them: `.posix.test.ts`, `.e2e.test.ts`, `.real.e2e.test.ts`, `.local.e2e.test.ts` (see [Testing](./testing.md)).
- **Daemon E2E specs live in `server/daemon-e2e/`**, named after the behavior they prove (`daemon-restart-resume.e2e.test.ts`, `permissions-codex.e2e.test.ts`), never after execution order.
- **Session-level tests are split by concern with a dotted name:** `session.workspaces.test.ts`, `session.wait-for-finish.test.ts`, `session.lifecycle-boundary.test.ts`. Follow that when `session.ts` grows a new concern.

## Where a new thing goes

| You are adding                                          | Put it in                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A session RPC                                           | Schema in `packages/protocol/src/`, then a handler in `server/session/<domain>/` wired from the `switch (msg.type)` in `server/session.ts`. See [RPC and Protocol](./rpc-and-protocol.md).                                                                                                                                                            |
| A persisted record                                      | A store class next to its consumer (`server/agent/agent-storage.ts`, `server/workspace-registry.ts`, `server/daemon-config-store.ts`) with its Zod schema. See [Persistence](./persistence.md).                                                                                                                                                       |
| A forge integration                                     | `services/<forge>-service.ts` + `services/<forge>-facts.ts`, registered in `forge-registry.ts`. `docs/forge-providers.md` has the checklist.                                                                                                                                                                                                          |
| An agent provider                                       | `server/agent/providers/`. `docs/providers.md` is the end-to-end guide.                                                                                                                                                                                                                                                                               |
| A process spawn                                         | Go through `utils/spawn.ts`; Git goes through `utils/run-git-command.ts` so it is scheduled and traced.                                                                                                                                                                                                                                               |
| A usage source (a CLI whose logs feed the usage report) | A pure parser `server/usage/<cli>-parser.ts`, its state variant in `USAGE_PARSER_STATE_SCHEMA`, an adapter entry in `server/usage/sources.ts`, and redacted log fragments under `server/usage/fixtures/<cli>/`. Line splitting, JSON parsing, turn counting and settlement are already in `server/usage/parse.ts` — write only the per-line handling. |
| A file under `$OSUNA_HOME`                              | Document it in `docs/data-model.md` directory layout.                                                                                                                                                                                                                                                                                                 |

If placement is unclear, say so in the PR or ask. Do not drop a file at `server/` root because it was the nearest directory.

## Anti-patterns seen in review

- `*-utils.ts`, `*-helpers.ts`, `*-manager.ts` for new files. `checkout-git-utils.ts` and `terminal-manager.ts` exist; they are not a license.
- A new module that wraps an existing coordinator instead of editing it (`docs/coding-standards.md` "Refactoring is a bolt-on test").
- Importing another package's `dist/` or deep internals. Use the package's exported subpaths.
