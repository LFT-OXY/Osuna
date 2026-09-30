# Quality Guidelines

`docs/coding-standards.md` is the rulebook. Reviewers apply all of it. This file lists the daemon-specific checks and the commands that prove them.

## Daemon-specific rules

- **The density sweep in [the app checklist](../../app/frontend/quality-guidelines.md#checks-reviewers-run) applies here too.** Review applies `docs/coding-standards.md` §Density to daemon code and tests the same way.
- **Validate at the boundary, then trust the type.** Boundaries here are the WebSocket (zod-aot generated validation), `$PASEO_HOME` files (Zod in the store), process output (`utils/run-git-command.ts`, `utils/tool-call-parsers.ts`), and plugin/MCP inputs. Past those, no `?.`, no `??`, no re-checking.
- **Spawn through `utils/spawn.ts`; run Git through `utils/run-git-command.ts`.** Git is scheduled by `utils/git-process-scheduler.ts` under the limits in daemon config (`docs/data-model.md` "Git process limits") and traced by `utils/git-command-trace.ts`. A raw `child_process.spawn("git", …)` bypasses all of that.
- **Path handling goes through `utils/path.ts`** (`createRealpathAwarePathMatcher`, normalization) and `server/path-utils.ts`. Workspace ids are opaque; never derive a path from one.
- **Kill process trees**, not processes: `utils/tree-kill.ts`.
- **Long-lived watchers have owners and teardown invariants.** Read `docs/file-observation.md` before adding a recursive watcher; `server/watcher-liveness-canary.ts` exists because teardown bugs were real.
- **Terminal and agent stream paths are performance-sensitive.** `docs/terminal-performance.md` and `docs/agent-stream-performance.md` name the coalescing and backpressure invariants; do not add per-chunk work there without reading them.
- **Executable lookup uses `executable-resolution/`**, including the Windows variant. Do not shell out to `which` from a feature.
- **Provider directories follow the upstream CLI's own rules.** Resolve a provider's config and session directories from the variables that CLI itself reads — `providers/omp/provider-config.ts` mirrors OMP's `pi-utils/dirs.ts` — and read them from `{ ...process.env, ...runtimeSettings.env }` so a launched agent and a directory scan agree on the path. Never invent a Paseo-only variable: `OMP_AGENT_DIR` and `OMP_SESSION_DIR` existed nowhere upstream, so a user who configured OMP correctly still got an empty session list.
- **A runtime provider param must not default to a literal that shadows its own fallbacks.** `sessionDir: params.sessionDir ?? "~/.omp/agent/sessions"` left every later branch — project `settings.json`, the upstream-derived directory — permanently unreachable, and the dead branches still typechecked and still had tests. Leave the param `undefined` when unset and let the resolution chain run.
- **A provider adapter maps a native message once, for both live and history replay.** Visibility and display-text rules live in one exported function that the live handler and the history mapper both call — `shouldDisplayPiCustomMessage` and `restorePiSkillCommand` in `providers/pi/history-mapper.ts`, `shouldDisplayOmpCustomMessage` in `providers/omp/custom-message.ts`. Honor what the upstream message declares (`display: false`), never the content's tags (`<workflow-state>`, `customType: "atw-runtime-context"`). Pi's adapter mapped every custom message to `assistant_message` on both paths, so an extension's hidden runtime context flooded every turn. Hiding a row must leave the turn lifecycle untouched. Test both seams: `pi/agent.test.ts` and `pi/history-mapper.test.ts`. `docs/providers.md` has the Pi/OMP contract.
- **A model's `thinkingOptions` list only the levels the upstream provider accepts for that model, and the session reports the level the provider actually applied.** Derive options from the upstream per-model metadata with the upstream's own rule (Pi: `thinkingLevelMap` via `getSupportedThinkingLevels`, mirrored in `providers/pi/agent.ts`; OMP: `model.thinking.efforts`). An exact list matters because `AgentManager.setAgentThinkingOption` overwrites `runtimeInfo.thinkingOptionId` with the *requested* value after the session returns, so a level the provider silently clamps shows the wrong value in the app. When the provider changes the level on its own, as Pi's `set_model` does by resetting to its settings default, re-apply the user's level, read back the applied one, and emit `thinking_option_changed` if it differs from what was reported. `setAgentModel` drains session events, so this event survives. Claude's `reconcileThinkingOptionForModel` follows the same pattern. Tests: `pi/agent.test.ts` ("reports the clamped thinking level when switching…", "exposes only the thinking levels each model's thinkingLevelMap supports").
- **Never type a control byte into source; write the escape.** A `\0` separator entered as a raw byte makes the file binary to Git: the diff renders as `GIT binary patch`, so the whole file lands unreviewed, and blame and merge degrade. Write `"\u0000"`. `rg -l $'\x00' -- '*.ts'` finds any that slipped in.
- **`session.ts`'s dispatch chain, `bootstrap.ts`'s `createPaseoDaemon`, and the `AgentManager` constructor all sit at the `eslint(complexity)` ceiling of 20.** One more `??` link in the chain, or one more `?.`/`??` inside `createPaseoDaemon`, fails lint. Put a new RPC in an existing domain dispatcher, and push option defaulting into the service's own constructor or a module-level factory rather than into the bootstrap expression.
- **`bootstrap.ts` must not contain a provider id, not even in a comment.** `terminal/agent-hooks/claude/claude.test.ts` lowercases the whole file and fails on any key of `AGENT_HOOK_PROVIDERS` (`claude`, `codex`, `opencode`). Wire services with provider-generic callbacks, e.g. `providerRuntimeSettings: (provider) => providerSnapshotManager.getRuntimeSettings(provider)`, and let the service name the provider it needs. Local runs of only the changed test files miss this; it surfaces in CI `server-tests`.
- **A new optional `AgentClient` or `AgentSession` method must be forwarded by hand in `agent/provider-registry.ts`.** `wrapClientProvider` and `wrapSessionProvider` copy methods one by one, and every profile that extends a built-in (`zai` extends `claude`) or overrides models goes through them. A missing line typechecks and silently drops the capability for those users only. `provider-registry-wrap.test.ts` enforces this for session methods at the type level; client methods have no such check, so add a case to `provider-registry.test.ts` (see "wrapped claude profile keeps no-process command discovery"). `mcp-parity.e2e.test.ts` builds its own wrapper and needs the same line.
- **Listing commands never starts a provider process.** `AgentSession.listCommands` answers only from a process that is already running and returns `null` otherwise, including before that process has reported a list (an empty placeholder would overwrite the cached one); `AgentClient.discoverCommands` scans directories and returns built-ins without running git or any other process. Never call a lazy "ensure the process" helper (Claude's `ensureQuery`, Codex's reconnect) from either. A session publishes each full list its process reports as a `commands_changed` stream event; `AgentManager.dispatchSessionEvent` records it in the catalog (test: `agent-manager.test.ts` "a session's command report fills the catalog…"). Contract: `docs/providers.md`; rule: `docs/adr/0003-command-list-never-spawns.md`.
- **Bash scripts start with `#!/usr/bin/env bash`.**
- **`function` declarations, `interface` over `type`, no barrels, no `any`, no `as` to silence errors, no `@ts-ignore`.** The TypeScript config is strict and `typecheck` runs `tsgo` on `tsconfig.server.typecheck.json`.
- **Object parameters** for 3+ args, any boolean, or any optional argument. `createPaseoDaemon(config, logger)` and store constructors already follow this.

## Forbidden

- `console.log` / `console.error` outside entrypoints.
- `process.exit` from a feature module.
- A new flat RPC name, or a `.request` without `.response`.
- Untagged back-compat. Every shim carries `// COMPAT(name): added in vX, remove after <date>`.
- Restarting the daemon on port 6767 without permission.
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
