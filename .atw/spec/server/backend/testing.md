# Testing

`docs/testing.md` sets the bar for the whole repo: two test categories and nothing in between, real dependencies over mocks, determinism, flaky means broken. This guide is the daemon-specific mechanics.

## The two categories in this package

| Category                          | Suffix                                  | Looks like                                                                                                                                                                 | Runs with                                       |
| --------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Unit with ports and adapters      | `*.test.ts`, `*.posix.test.ts`          | Real filesystem in a `mkdtemp` dir, real Git via `execFileSync`, in-memory fakes for the ports the module declares (`ForgeService`, `AgentStorage`, `WorkspaceGitService`) | `npx vitest run <file> --bail=1`                |
| Daemon end-to-end                 | `*.e2e.test.ts` in `server/daemon-e2e/` | A real daemon on `127.0.0.1:0` in a temp `OSUNA_HOME`, driven through `DaemonClient` over a real WebSocket                                                                 | `npx vitest run <file> --maxWorkers=1 --bail=1` |
| E2E against a real provider       | `*.real.e2e.test.ts`                    | Same harness plus Claude/Codex/OpenCode/Pi credentials from `packages/server/.env.test`                                                                                    | `npm run test:integration:real`                 |
| E2E needing a local-only resource | `*.local.e2e.test.ts`                   | Same harness plus something only this machine has                                                                                                                          | `npm run test:integration:local`                |

`server/workspace-archive-service.test.ts` is a good unit reference: a temp repo, a typed `ForgeService` stub built as a plain object, a silent logger, assertions on the resulting files and `ArchiveResult`. `server/daemon-e2e/daemon-restart-resume.e2e.test.ts` and `persistence.e2e.test.ts` are E2E references.

## Fakes and helpers

Everything reusable lives in `server/test-utils/`:

| Helper                                                                | Use for                                                                              |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `paseo-daemon.ts` → `createTestPaseoDaemon()`                         | Boot a daemon in a temp home; `daemon.port`, `daemon.close()` cleans up              |
| `daemon-client.ts` → `DaemonClient`                                   | Typed client: `connect`, `fetchAgents({ subscribe: {} })`, RPC helpers, `close`      |
| `daemon-test-context.ts`                                              | Combined daemon + client context for E2E suites                                      |
| `fake-agent-client.ts`                                                | Deterministic agent provider adapter; the default for unit suites that need an agent |
| `session-stubs.ts`, `class-mocks.ts`, `workspace-git-service-stub.ts` | Typed stubs for session collaborators                                                |
| `temp-github-repo.ts`                                                 | A throwaway Git repo with a fake remote                                              |
| `message-collector.ts`                                                | Collect outbound session messages for assertions                                     |
| `versioned-daemon.ts`, `outdated-daemon-process.ts`                   | Compatibility tests across daemon versions                                           |

`docs/ad-hoc-daemon-testing.md` has the full harness walkthrough and seven gotchas. Two that bite most often: `appVersion` on `DaemonClient` gates which providers are visible, and `fetchAgents` must run before most other operations.

## Rules

- **No `vi.mock` of the module under test, no `vi.spyOn` on own exports.** If you need one, the module is missing a port. Add the injectable interface, write a fake next to the real adapter, test against that. The existing `vi.spyOn(logger, "warn")` pattern is for asserting on logging, not for stubbing behavior.
- **Provider calls in default suites go through `fake-agent-client.ts`.** Live provider tests are `*.real.e2e.test.ts` even when guarded by env vars.
- **No auth checks, env gates, or conditional skips in tests.** Providers own their auth; if it fails, the test fails.
- **Global env shims go in `src/test-utils/vitest-setup.ts`** (loads `.env.test`, sets `OSUNA_SUPERVISED=0`, disables Git/SSH prompts), not in individual files.
- **Cleanup is explicit.** Push temp paths into an array and `rmSync` them in `afterEach`, or use the harness's `close()`. Leaked processes from ACP providers are a known failure mode; kill trees with `utils/tree-kill.ts`.
- **Observe a transient phase from the service's own callback, not from a poll.** A state that exists only while a background round runs — `backfill.state === "running"` — cannot be caught reliably by a loop racing that round. `usage/service.agent.test.ts` reads the agent's usage from inside `onBackfillProgress`, which only fires from within the round, so the assertion is deterministic instead of timing-dependent.
- **Assert full shapes.** `expect(result).toEqual({ ok: false, error: { code: "PROVIDER_TIMEOUT", waitedMs: 30000 } })`, not `toBeTruthy`.
- **A default branch needs a test that runs it, not one that asserts its text.** `buildAgentHookShellCommand` emits `"${OSUNA_HOOK_CLI:-osuna}" hooks …`. The suite string-matched that line and separately ran it through `/bin/sh` with `OSUNA_HOOK_CLI` *set* and `OSUNA_TERMINAL_ID` unset, so the command short-circuited and the fallback name never executed — any name passed. `agent-hooks/claude/claude.test.ts` now puts an executable `osuna` in a temp dir, runs the command with `PATH` pointing there, `OSUNA_TERMINAL_ID` set and `OSUNA_HOOK_CLI` unset, and asserts the argv the stub recorded. The wrong name makes it exit 127.
- **Configure the values that have no default.** `daemon.relay.endpoint` and `app.baseUrl` resolve to `null` when unset ([Persistence](./persistence.md)), so a fixture that expects a pairing link must set both — through `editPersistedConfig`, the daemon worker's env, or the `generateLocalPairingOffer` arguments. Four suites asserted on a link without configuring them and went red the moment the upstream defaults were dropped.
- **A legacy-client fixture has to deny every legacy capability.** The daemon short-circuits all implicit delivery on `delivery.isModern(source)`, which comes from `capabilities[CLIENT_CAPS.ownedSubscriptions] === true` (`updateClientCapabilities` in `packages/server/src/server/session.ts`), and a client's `capabilities` are merged over `DEFAULT_CLIENT_CAPABILITIES` where that flag is `true`. A fixture that denies only `explicit_event_subscriptions` is still a modern client and receives no broadcasts, so an assertion that it does can never pass. `owned-subscriptions.e2e.test.ts` declares the pair to copy: `{ owned_subscriptions: false, explicit_event_subscriptions: false }`.
- **Name files after behavior**: `open-project-missing-directory.e2e.test.ts`, never `test-3.ts` or `setup-first.ts`.

## Real-PTY protocol replies

Anything the daemon writes back to the PTY in reply to a terminal query (DA1, DSR, `CSI ?996n`, OSC 10/11/12) is tested at the PTY seam in `terminal/terminal.posix.test.ts`, never by spying on `ptyProcess.write`:

1. Write a small Node script to a temp dir (`writeDsrHelper`, `writeOsc11Helper`). It puts stdin in raw mode, writes the query to stdout, and prints one marker line (`DSR_OK:...`, `OSC11_OK:...`) when the reply arrives on stdin, or `*_TIMEOUT` after 2.5s.
2. Launch it as the foreground program via `session.send({ type: "input", data: \`${process.execPath} ${helperPath} <mode>\r\` })`.
3. `waitForState(session, hasXxxOkLine)` and assert the exact marker text, with ESC rendered as `ESC` so the expected bytes are readable (`"OSC11_OK:ESC]11;rgb:ffff/ffff/ffffESC\\"`).

Silence is asserted the same way: wait for the helper's `*_TIMEOUT` line and assert no `*_OK` line exists. That costs 2.5s per case, so keep silent cases to one per query kind. Add a mode to an existing helper (argv) before adding a new helper script.

For something the daemon writes on its own initiative (the `CSI ?997n` theme notification after a `view_attributes` push), the helper enables the mode, prints a `*_READY` marker, then waits. The test must `waitForState(session, hasSchemeReadyLine)` before `session.send(...)`: the headless parser handles the `DECSET 2031` asynchronously, and a push that lands before the parser reaches it is silently not a subscriber yet. The READY line is written after the DECSET in the same stream, so its visibility proves the mode was parsed.

Through `createWorkerTerminalManager` the same helper needs two changes. `session.getState()` in the parent is a cached snapshot that does not refresh with output; poll `manager.captureTerminal(session.id)` instead. And the helper must not `process.exit()` after printing: the worker drops the terminal record on exit and `captureTerminal` then reads nothing. Keep it alive with `setInterval(() => {}, 1000)` and let `afterEach` kill it.

## Test files are outside the type checker and the linter

`packages/server/tsconfig.server.json` excludes `src/**/*.test.ts(x)`, `src/**/*.spec.ts(x)`,
`src/server/daemon-e2e/**` and `src/server/**/*.e2e.ts(x)`, and the typecheck script inherits
that exclude list through `tsconfig.server.typecheck.json`. oxlint's `no-undef` is off, as it
normally is for TypeScript projects that let the compiler own that check. The two together
leave a hole: **an undefined identifier inside a server test file is reported by neither
`npm run typecheck` nor `npm run lint`.** Verified by adding `const __probe = notDefinedAnywhere;`
to a test file — both gates stayed green.

What follows from it:

- Never treat green typecheck + lint as evidence that server test files compile. Only running
  them proves that. A refactor that renames a symbol used in tests looks finished and is not.
- A mechanical rename is the common way to hit this. A parameter renamed in the signature but
  not in the body, or the reverse, becomes an undefined identifier or — worse — object property
  shorthand that binds to a *different* value in scope and makes the test assert something
  nobody intended, still silently.
- After touching anything server tests reference, run the affected test files, not just the gates.

## Running

```bash
npx vitest run packages/server/src/server/pid-lock.test.ts --bail=1
npx vitest run packages/server/src/server/daemon-e2e/persistence.e2e.test.ts --maxWorkers=1 --bail=1
npx vitest run <file> --bail=1 > /tmp/test-output.txt 2>&1   # broad or noisy runs
```

Never `npm run test` for the workspace; it freezes the machine. Never re-run a suite another agent already reported green. Full-suite confidence comes from CI, which routes suites by `.github/ci-paths.yml`.
