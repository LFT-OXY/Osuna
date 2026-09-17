# Testing

`docs/testing.md` is the bar: two categories, no mocks by default, determinism, every fallible action covered for success and failure. This is the app-specific mechanics.

## Three runners, three suffixes

| Suffix                  | Runner                                     | Environment                                                                                                 | Use for                                                                                                                                                               |
| ----------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `*.test.ts(x)`          | Vitest `unit` project (`vitest.config.ts`) | Node, `pool: "forks"`, `vitest.setup.ts` shims `expo`, `__DEV__`, and a few native-only modules             | Pure modules: reducers, view models, stores, form models, selectors, key builders                                                                                     |
| `*.browser.test.ts(x)`  | Vitest `browser` project                   | Headless Chromium through Playwright, real DOM, real `WebSocket` (`runtime/websocket-test-global-setup.ts`) | Things that need a browser: `components/adaptive-text-input.web.browser.test.tsx`, `runtime/websocket-transport.browser.test.ts`, `lib/overlay-root.browser.test.tsx` |
| `e2e/browser/*.spec.ts` | Playwright (`npm run test:e2e`)            | Real Metro, real isolated daemon per worker, real browser                                                   | RPC-backed UI and every fallible user action: `agent-message-submission.spec.ts`, `add-project-flow.spec.ts`, `agent-message-rewind.spec.ts`                          |

`*.real.spec.ts` under `e2e/browser/` hits a real provider and runs only through `npm run test:e2e:real`. Shared Playwright harness code lives in `e2e/support/`; specs never go there. Specs that only exercise the daemon import `daemonTest` so they skip the browser context.

## Unit tests are ports-and-adapters tests

There are over 600 `*.test.ts` files and the good ones look like `hooks/use-archive-agent.test.ts`: seed the session store with `test/seed-session.ts`, build a full `Agent` with a `makeAgent(overrides)` helper, call the exported pure functions, assert the resulting store and query-cache state with `toEqual`. No renderer, no JSDOM, no `@testing-library`.

45 test files still use `vi.mock`. They predate the current rule and are not a license. A new test that wants `vi.mock`, `vi.hoisted`, `vi.spyOn` of the module's own exports, or a monkey-patched global is telling you the production module lacks a port: add the injected interface, write a typed fake next to the adapter, test against the fake. The stubs in `vitest.setup.ts` are for modules with no meaningful Node behavior (`react-native-unistyles`, `react-native-svg`, `expo-linking`, `@xterm/addon-ligatures`), not for app code.

## When a spec prescribes a rendered component seam

Some PRDs name "component + fake `DaemonClient`" as the test seam (`components/import-session-sheet.test.tsx`, `session-history/index.test.tsx`). Those run in the `unit` project under `@vitest-environment jsdom` with `@testing-library/react`, which is the tolerated exception above, not the default. Three facts about the runners decide whether such a test can exist at all:

- **JSX is the classic runtime under Vitest.** A component rendered in jsdom, and every shared component it renders (`components/ui/alert.tsx`), needs `import React from "react"` or it throws `React is not defined`. Metro uses the automatic runtime, so nothing else catches this.
- **i18n has no instance until something imports it.** `useTranslation()` logs `NO_I18NEXT_INSTANCE` and returns keys. Import `{ i18n } from "@/i18n/i18next"` in the test and assert through `i18n.t(...)`, which also satisfies the no-unassigned-import lint rule.
- **The `browser` project cannot load the layout store.** `stores/workspace-layout-store.ts` reaches `@react-native-async-storage/async-storage` → `expo-modules-core` → `TurboModuleRegistry`, which react-native-web does not export; `vitest.setup.ts` shims that only for the `unit` project. A component that opens tabs stays a jsdom test with the async-storage `vi.mock` copied from `workspace-tabs/explorer-sidebar.test.ts`, or its tab-opening moves behind an injected callback so the surface itself has no store import.

Keep the surface's props the seam: `client: Pick<DaemonClient, ...> | null`, `isConnected`, and callbacks for what the shell decides (`onTerminalCreated`). The fake client is a plain object of `vi.fn` implementations typed from `DaemonClient`; nothing else is mocked except `@/components/provider-icons`, whose SVG icons have no Node behavior.

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
