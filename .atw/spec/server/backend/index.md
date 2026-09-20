# @osuna/server — Daemon Guidelines

The daemon is a single Node.js process under `packages/server/src/`. It owns agent lifecycle, the WebSocket session API, file-based persistence in `$OSUNA_HOME`, terminals, and the MCP/tool catalog. There is no HTTP REST API and no database: clients talk over one WebSocket session, and state is JSON on disk.

Read these repo docs before the guides below. The guides distill them and add the daemon-specific shape; they do not replace them.

| Doc | Why |
|-----|-----|
| `docs/coding-standards.md` | The house style. Every rule there applies here. |
| `docs/testing.md` | Two test categories, suffix routing, no mocks by default. |
| `docs/architecture.md` §`packages/server` | Key modules table and the data flow for running an agent. |
| `docs/data-model.md` | Every persisted record, its Zod schema, and the store surface rules. |
| `docs/protocol-compatibility.md` | The protocol stays backward-compatible; features are gated. |
| `docs/rpc-namespacing.md` | Naming for new session RPCs. |

## Guides

| Guide | Covers |
|-------|--------|
| [Directory Structure](./directory-structure.md) | Where code lives, how a domain is shaped, where a new RPC handler goes |
| [RPC and Protocol](./rpc-and-protocol.md) | Session message dispatch, response shape, compatibility and feature gating |
| [Persistence](./persistence.md) | `$OSUNA_HOME` JSON stores, Zod at the boundary, atomic writes, no migrations |
| [Error Handling](./error-handling.md) | Typed error classes, wire error mapping, fail-closed rules |
| [Logging](./logging.md) | pino, child loggers per module, logger injection, test logger |
| [Testing](./testing.md) | Unit with fakes, daemon E2E harness, running a single file |
| [Quality Guidelines](./quality-guidelines.md) | Daemon-specific checks, forbidden patterns, verification commands |

## Commands

```bash
npm run typecheck                                   # always after a change
npm run lint                                        # always after a change
npm run format                                      # before committing (oxfmt)
npx vitest run packages/server/src/<file>.test.ts --bail=1
npm run build:server                                # when cross-package types look stale
```

Never run `npm run test` for the whole workspace. Never restart a running daemon without permission; it may be running the agent that is you. That covers Osuna's installed daemon on 6777 and dev daemon on 6778, and the upstream Paseo daemon on 6767/6768 that this machine still runs.
