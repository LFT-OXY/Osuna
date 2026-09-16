# Testing

`docs/testing.md` sets the bar for the whole repo: two test categories and nothing in between, real dependencies over mocks, determinism, flaky means broken. This guide is the daemon-specific mechanics.

## The two categories in this package

| Category | Suffix | Looks like | Runs with |
|----------|--------|-----------|-----------|
| Unit with ports and adapters | `*.test.ts`, `*.posix.test.ts` | Real filesystem in a `mkdtemp` dir, real Git via `execFileSync`, in-memory fakes for the ports the module declares (`ForgeService`, `AgentStorage`, `WorkspaceGitService`) | `npx vitest run <file> --bail=1` |
| Daemon end-to-end | `*.e2e.test.ts` in `server/daemon-e2e/` | A real daemon on `127.0.0.1:0` in a temp `PASEO_HOME`, driven through `DaemonClient` over a real WebSocket | `npx vitest run <file> --maxWorkers=1 --bail=1` |
| E2E against a real provider | `*.real.e2e.test.ts` | Same harness plus Claude/Codex/OpenCode/Pi credentials from `packages/server/.env.test` | `npm run test:integration:real` |
| E2E needing a local-only resource | `*.local.e2e.test.ts` | Same harness plus something only this machine has | `npm run test:integration:local` |

`server/workspace-archive-service.test.ts` is a good unit reference: a temp repo, a typed `ForgeService` stub built as a plain object, a silent logger, assertions on the resulting files and `ArchiveResult`. `server/daemon-e2e/daemon-restart-resume.e2e.test.ts` and `persistence.e2e.test.ts` are E2E references.

## Fakes and helpers

Everything reusable lives in `server/test-utils/`:

| Helper | Use for |
|--------|---------|
| `paseo-daemon.ts` → `createTestPaseoDaemon()` | Boot a daemon in a temp home; `daemon.port`, `daemon.close()` cleans up |
| `daemon-client.ts` → `DaemonClient` | Typed client: `connect`, `fetchAgents({ subscribe: {} })`, RPC helpers, `close` |
| `daemon-test-context.ts` | Combined daemon + client context for E2E suites |
| `fake-agent-client.ts` | Deterministic agent provider adapter; the default for unit suites that need an agent |
| `session-stubs.ts`, `class-mocks.ts`, `workspace-git-service-stub.ts` | Typed stubs for session collaborators |
| `temp-github-repo.ts` | A throwaway Git repo with a fake remote |
| `message-collector.ts` | Collect outbound session messages for assertions |
| `versioned-daemon.ts`, `outdated-daemon-process.ts` | Compatibility tests across daemon versions |

`docs/ad-hoc-daemon-testing.md` has the full harness walkthrough and seven gotchas. Two that bite most often: `appVersion` on `DaemonClient` gates which providers are visible, and `fetchAgents` must run before most other operations.

## Rules

- **No `vi.mock` of the module under test, no `vi.spyOn` on own exports.** If you need one, the module is missing a port. Add the injectable interface, write a fake next to the real adapter, test against that. The existing `vi.spyOn(logger, "warn")` pattern is for asserting on logging, not for stubbing behavior.
- **Provider calls in default suites go through `fake-agent-client.ts`.** Live provider tests are `*.real.e2e.test.ts` even when guarded by env vars.
- **No auth checks, env gates, or conditional skips in tests.** Providers own their auth; if it fails, the test fails.
- **Global env shims go in `src/test-utils/vitest-setup.ts`** (loads `.env.test`, sets `PASEO_SUPERVISED=0`, disables Git/SSH prompts), not in individual files.
- **Cleanup is explicit.** Push temp paths into an array and `rmSync` them in `afterEach`, or use the harness's `close()`. Leaked processes from ACP providers are a known failure mode; kill trees with `utils/tree-kill.ts`.
- **Assert full shapes.** `expect(result).toEqual({ ok: false, error: { code: "PROVIDER_TIMEOUT", waitedMs: 30000 } })`, not `toBeTruthy`.
- **Name files after behavior**: `open-project-missing-directory.e2e.test.ts`, never `test-3.ts` or `setup-first.ts`.

## Running

```bash
npx vitest run packages/server/src/server/pid-lock.test.ts --bail=1
npx vitest run packages/server/src/server/daemon-e2e/persistence.e2e.test.ts --maxWorkers=1 --bail=1
npx vitest run <file> --bail=1 > /tmp/test-output.txt 2>&1   # broad or noisy runs
```

Never `npm run test` for the workspace; it freezes the machine. Never re-run a suite another agent already reported green. Full-suite confidence comes from CI, which routes suites by `.github/ci-paths.yml`.
