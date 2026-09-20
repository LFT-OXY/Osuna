# Quality Guidelines

`docs/coding-standards.md` is the rulebook. Reviewers apply all of it. This file lists the daemon-specific checks and the commands that prove them.

## Daemon-specific rules

- **Validate at the boundary, then trust the type.** Boundaries here are the WebSocket (zod-aot generated validation), `$OSUNA_HOME` files (Zod in the store), process output (`utils/run-git-command.ts`, `utils/tool-call-parsers.ts`), and plugin/MCP inputs. Past those, no `?.`, no `??`, no re-checking.
- **Spawn through `utils/spawn.ts`; run Git through `utils/run-git-command.ts`.** Git is scheduled by `utils/git-process-scheduler.ts` under the limits in daemon config (`docs/data-model.md` "Git process limits") and traced by `utils/git-command-trace.ts`. A raw `child_process.spawn("git", …)` bypasses all of that.
- **Path handling goes through `utils/path.ts`** (`createRealpathAwarePathMatcher`, normalization) and `server/path-utils.ts`. Workspace ids are opaque; never derive a path from one.
- **Kill process trees**, not processes: `utils/tree-kill.ts`.
- **Long-lived watchers have owners and teardown invariants.** Read `docs/file-observation.md` before adding a recursive watcher; `server/watcher-liveness-canary.ts` exists because teardown bugs were real.
- **Terminal and agent stream paths are performance-sensitive.** `docs/terminal-performance.md` and `docs/agent-stream-performance.md` name the coalescing and backpressure invariants; do not add per-chunk work there without reading them.
- **Executable lookup uses `executable-resolution/`**, including the Windows variant. Do not shell out to `which` from a feature.
- **Provider directories follow the upstream CLI's own rules.** Resolve a provider's config and session directories from the variables that CLI itself reads — `providers/omp/provider-config.ts` mirrors OMP's `pi-utils/dirs.ts` — and read them from `{ ...process.env, ...runtimeSettings.env }` so a launched agent and a directory scan agree on the path. Never invent an Osuna-only variable: `OMP_AGENT_DIR` and `OMP_SESSION_DIR` existed nowhere upstream, so a user who configured OMP correctly still got an empty session list.
- **A runtime provider param must not default to a literal that shadows its own fallbacks.** `sessionDir: params.sessionDir ?? "~/.omp/agent/sessions"` left every later branch — project `settings.json`, the upstream-derived directory — permanently unreachable, and the dead branches still typechecked and still had tests. Leave the param `undefined` when unset and let the resolution chain run.
- **Never type a control byte into source; write the escape.** A `\0` separator entered as a raw byte makes the file binary to Git: the diff renders as `GIT binary patch`, so the whole file lands unreviewed, and blame and merge degrade. Write `"\u0000"`. `rg -l $'\x00' -- '*.ts'` finds any that slipped in.
- **`session.ts`'s dispatch chain and `bootstrap.ts`'s `createOsunaDaemon` both sit at the `eslint(complexity)` ceiling of 20.** One more `??` link in the chain, or one more `?.`/`??` inside `createOsunaDaemon`, fails lint. Put a new RPC in an existing domain dispatcher, and push option defaulting into the service's own constructor or a module-level factory rather than into the bootstrap expression.
- **Bash scripts start with `#!/usr/bin/env bash`.**
- **`function` declarations, `interface` over `type`, no barrels, no `any`, no `as` to silence errors, no `@ts-ignore`.** The TypeScript config is strict and `typecheck` runs `tsgo` on `tsconfig.server.typecheck.json`.
- **Object parameters** for 3+ args, any boolean, or any optional argument. `createOsunaDaemon(config, logger)` and store constructors already follow this.

## Forbidden

- `console.log` / `console.error` outside entrypoints.
- `process.exit` from a feature module.
- A new flat RPC name, or a `.request` without `.response`.
- Untagged back-compat. Every shim carries `// COMPAT(name): added in vX, remove after <date>`.
- Restarting a running daemon without permission (Osuna 6777/6778, upstream Paseo 6767/6768).
- `npm run test` for the whole workspace.
- Adding auth checks or env gates to tests.
- Hand-written types that duplicate a Zod schema or a protocol type.
- `-utils` / `-helpers` / `-manager` suffixes on new files.

## Verification after every change

```bash
npm run typecheck
npm run lint
npx vitest run <the file you changed> --bail=1
npm run format          # before committing
```

If `typecheck` fails in a package that depends on another workspace, rebuild first (`npm run build:server`) instead of patching declarations. Lint is oxlint with `correctness`, `suspicious`, and `perf` categories as errors plus `no-shadow`, `preserve-caught-error`, `promise/always-return` (`.oxlintrc.json`); fix the code, do not disable the rule.

## Before opening a PR

`docs/qa.md` sets the evidence bar: the commands you ran and their output, a regression test that fails on the broken version for any bug fix, and the platforms you could not test. `CONTRIBUTING.md` explains why PRs without this are closed.
