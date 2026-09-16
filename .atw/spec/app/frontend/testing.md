# Testing

`docs/testing.md` is the bar: two categories, no mocks by default, determinism, every fallible action covered for success and failure. This is the app-specific mechanics.

## Three runners, three suffixes

| Suffix | Runner | Environment | Use for |
|--------|--------|-------------|---------|
| `*.test.ts(x)` | Vitest `unit` project (`vitest.config.ts`) | Node, `pool: "forks"`, `vitest.setup.ts` shims `expo`, `__DEV__`, and a few native-only modules | Pure modules: reducers, view models, stores, form models, selectors, key builders |
| `*.browser.test.ts(x)` | Vitest `browser` project | Headless Chromium through Playwright, real DOM, real `WebSocket` (`runtime/websocket-test-global-setup.ts`) | Things that need a browser: `components/adaptive-text-input.web.browser.test.tsx`, `runtime/websocket-transport.browser.test.ts`, `lib/overlay-root.browser.test.tsx` |
| `e2e/browser/*.spec.ts` | Playwright (`npm run test:e2e`) | Real Metro, real isolated daemon per worker, real browser | RPC-backed UI and every fallible user action: `agent-message-submission.spec.ts`, `add-project-flow.spec.ts`, `agent-message-rewind.spec.ts` |

`*.real.spec.ts` under `e2e/browser/` hits a real provider and runs only through `npm run test:e2e:real`. Shared Playwright harness code lives in `e2e/support/`; specs never go there. Specs that only exercise the daemon import `daemonTest` so they skip the browser context.

## Unit tests are ports-and-adapters tests

There are over 600 `*.test.ts` files and the good ones look like `hooks/use-archive-agent.test.ts`: seed the session store with `test/seed-session.ts`, build a full `Agent` with a `makeAgent(overrides)` helper, call the exported pure functions, assert the resulting store and query-cache state with `toEqual`. No renderer, no JSDOM, no `@testing-library`.

45 test files still use `vi.mock`. They predate the current rule and are not a license. A new test that wants `vi.mock`, `vi.hoisted`, `vi.spyOn` of the module's own exports, or a monkey-patched global is telling you the production module lacks a port: add the injected interface, write a typed fake next to the adapter, test against the fake. The stubs in `vitest.setup.ts` are for modules with no meaningful Node behavior (`react-native-unistyles`, `react-native-svg`, `expo-linking`, `@xterm/addon-ligatures`), not for app code.

## Fallible user actions

Every action that can fail needs behavioral coverage for success and for failure, and the failure test asserts what the user can see and do afterwards, not a state field. RPC-backed UI uses a Playwright spec with the real daemon. Distinct timeout and disconnect cases get their own tests when the recovery differs.

## Fixtures and isolation

- Playwright gives every worker its own daemon and `PASEO_HOME`; specs in one file share it. Helpers that create projects or workspaces own them until cleanup, and a fixture fails any test that leaks a project record. Deleting the temp directory is not cleanup.
- Tests about daemon-global state (empty history, restart) start a dedicated host explicitly.
- Retained-panel geometry is tested through a real retained surface across hide and reveal (`docs/coding-standards.md` "Retained panel measurements").
- Filenames describe product behavior (`add-changed-file-to-chat.spec.ts`), never order or isolation mechanics.

## Running

```bash
npx vitest run packages/app/src/stores/session-store.test.ts --bail=1
npm run test:browser --workspace=@getpaseo/app                  # all *.browser.test; small set
cd packages/app && npx playwright test --project=browser e2e/browser/agent-message-submission.spec.ts
```

Never run the whole Playwright suite locally; it is CI's job. Never `npm run test` for the workspace. Metro readiness for Playwright means `/status` returns `packager-status:running` and the bundle has been fetched; the global setup handles it.
