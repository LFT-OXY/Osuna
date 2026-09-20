# Directory Structure

Everything is under `packages/app/src/`, imported through the `@/` alias (`@/stores/session-store`). Workspace packages come in by subpath (`@osuna/protocol/agent-lifecycle`, `@osuna/client/internal/daemon-client`).

## Two kinds of directories

**Feature modules** own one product capability end to end: model, hooks, store, and the components only they use. `composer/`, `workspace-labels/`, `file-explorer/`, `schedules/`, `timeline/`, `subagents/`, `agent-stream/`, `voice/`, `push-notifications/`, `workspace-recovery/`, `add-project-flow/`, `command-center/`. The reference shape is `workspace-labels/`:

```
workspace-labels/
  index.ts              # the public surface: hooks, model factories, re-exported types
  internal/             # replica, merge, picker model, workflow model — not importable from outside
    host-replica.ts
    merge.ts
    picker-model.ts
    workflow-model.ts
```

`index.ts` here is a real module with a store and hooks, not a re-export barrel. `composer/index.tsx` is the same idea for the composer. Screens and panels integrate a feature from its entry; they do not reach into `internal/` or drop feature internals into `components/`, `hooks/`, or `screens/`.

A feature whose entry is rendered by a jsdom test may carry a second public file, `view.tsx`, for the runtime-wired wrapper (`session-history/view.tsx`). The entry then holds the surface and pure exports only. The reason is the unit runner, not layering: `utils/copy-to-clipboard` (expo-clipboard), `hosts/host-chooser`, and `components/import-session-sheet` ship code Vite cannot parse in the `unit` project, and one such import anywhere under `index.tsx` fails the whole test file at load. Shells import the view from `@/session-history/view`; nothing else changes.

**Shared layers** hold code used by several features:

| Directory                  | Owns                                                                                                                                                                                                                                                                                                             |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/`                     | Expo Router routes only: `_layout.tsx`, `index.tsx`, `h/[serverId]/…`, `settings/`, `new.tsx`, `pair-scan.tsx`. Route files are thin; they render a screen. `docs/expo-router.md` governs ownership.                                                                                                             |
| `screens/`                 | Screen components and their pure state modules: `settings-screen.tsx`, `projects-screen.tsx`, `workspace/`, `agent/`, `new-workspace-*.ts`                                                                                                                                                                       |
| `components/`              | Shared components. `components/ui/` is the primitive set (`button.tsx`, `alert.tsx`, `loading-spinner.tsx`, `status-badge.tsx`, `combobox.tsx`, `dropdown-menu.tsx`, `context-menu.tsx`, `form-field.tsx`, `menu/`); `components/headers/`, `components/desktop/`, `components/markdown/` are grouped by surface |
| `hooks/`                   | Shared hooks and their pure view-model modules (`sidebar-workspaces-view-model.ts` next to `use-…`)                                                                                                                                                                                                              |
| `stores/`                  | Zustand stores: `session-store.ts` + `session-store-hooks/`, `workspace-layout-store.ts`, `draft-store/`, `panel-store/`, `navigation-active-workspace-store/`                                                                                                                                                   |
| `contexts/`                | React contexts for stable values: `session-context.tsx`, `toast-context.tsx`, `voice-context.tsx`, `sidebar-callout-context.tsx`                                                                                                                                                                                 |
| `data/`                    | React Query wiring: `query-client.ts`, `query.ts`, provider snapshot and daemon config queries                                                                                                                                                                                                                   |
| `runtime/`                 | Host runtime: `host-runtime.ts`, `directory-sync/`, `replica-cache/`, `websocket-factory.ts` (+ `.web.ts`), `host-features.ts`                                                                                                                                                                                   |
| `styles/`                  | Theme and Unistyles setup: `theme.ts`, `unistyles.ts`, `markdown-styles.ts`, `syntax-token-styles.ts`                                                                                                                                                                                                            |
| `constants/`               | `platform.ts` (the four gates), `layout.ts` (breakpoints and fixed heights), `theme.ts`                                                                                                                                                                                                                          |
| `i18n/`                    | i18next setup and `resources/<locale>.ts`; all user-visible copy has a key here                                                                                                                                                                                                                                  |
| `utils/`, `lib/`, `types/` | Pure helpers (`utils/confirm-dialog.ts`), `lib/overlay-root.ts`, shared types (`types/stream.ts`)                                                                                                                                                                                                                |
| `desktop/`                 | Electron-only surfaces (updates, browser pane), with `.electron.tsx` variants                                                                                                                                                                                                                                    |
| `test/`                    | Test seeds: `seed-session.ts`, `window-local-storage.ts`                                                                                                                                                                                                                                                         |

## Platform variants are files, not branches

Metro resolves by extension, so a module with different implementations per platform is split into files and imported by its base name:

```
runtime/websocket-factory.ts          # native
runtime/websocket-factory.web.ts      # browser + Electron
styles/unistyles-inline-style.ts / .native.ts / .web.ts
hooks/image-attachment-picker.ts / .native.ts
desktop/browser/pane/index.tsx / .web.tsx / .electron.tsx
```

`.electron.*` wins over `.web.*` when `OSUNA_WEB_PLATFORM=electron`. Reserve inline `if (isWeb)` for a line or a few props (`CLAUDE.md` "Platform gating").

## Local native modules live outside `src/`

`packages/app/modules/<name>/` holds the app's own Expo modules (`osuna-word-stream`,
`osuna-native-trace`, `osuna-hardware-keyboard`, `osuna-diff-prototype`). Expo autolinking
finds them because `nativeModulesDir` defaults to `<appRoot>/modules`; nothing in
`app.config.js` lists them. A module's **`package.json` `name`** — not its directory name —
becomes the Gradle project name, and the **podspec filename** — not `s.name` — becomes the
pod and Swift module name.

Nothing in that chain is typed, so one identity is spelled in seven places that cannot
import each other:

| Site                                            | Must agree with                                              |
| ----------------------------------------------- | ------------------------------------------------------------ |
| directory name                                  | `package.json` `name`                                         |
| `expo-module.config.json` `android.modules`     | the Kotlin FQCN — source path, `package` decl, and class name |
| `build.gradle` `namespace` / `group`            | the Kotlin package prefix                                     |
| `expo-module.config.json` `ios`/`apple.modules` | a `class` declared in `ios/*.swift`                           |
| podspec filename                                | `s.name`                                                      |
| `CMakeLists.txt` `project()` / `add_library()`  | `System.loadLibrary(…)` in Kotlin                             |
| `cpp/jni.cpp` `#define METHOD(name) Java_…`     | the Kotlin package + class, underscore-separated              |
| `Name("…")` in Kotlin **and** Swift             | the literal `requireNativeModule` / `requireOptionalNativeModule` / `requireNativeViewManager` passes |

`packages/app/src/native/local-native-modules.test.ts` asserts every row, data-driven over
`modules/*`, so a new module is covered without touching the test. It is the native
counterpart to `packages/desktop/src/daemon/desktop-packaging.test.ts` (see
[Product Identity Literals](../../guides/cross-layer-thinking-guide.md#product-identity-literals)).

The row that needs the cross-platform assertion is the last one: change `Name(…)` on only
one platform and the other platform's declaration still satisfies the TypeScript lookup, so
the module breaks on one OS and nothing else notices. The test compares the Kotlin and Swift
name sets whenever a module ships both.

## Tests sit next to code

`thing.ts` + `thing.test.ts`; DOM-needing tests are `thing.browser.test.tsx`. Playwright specs live in `packages/app/e2e/browser/`, shared harness in `packages/app/e2e/support/` (no specs there). See [Testing](./testing.md).

## Where a new thing goes

| You are adding                                          | Put it in                                                                                                                                                                 |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A new capability with its own state                     | A new feature module directory with an `index.ts` surface and `internal/`; not five files across `components/`, `hooks/`, `stores/`                                       |
| A route                                                 | `app/…` under the layout that directly owns it, then re-read `docs/expo-router.md` and its checklist                                                                      |
| A reusable control                                      | `components/ui/` only if two surfaces need it now; otherwise inside the feature                                                                                           |
| A persisted per-viewer preference several surfaces read | A Zustand store in `stores/` with AsyncStorage persistence, keyed per `docs/data-model.md` "Keying convention"                                                            |
| A persisted preference one feature owns                 | The same store shape inside that feature's `internal/` (`session-history/internal/scope-store.ts`); `stores/` cannot import a feature's `internal/`, see State Management |
| A fetched daemon value                                  | A query hook in `data/` or the feature, built on `data/query.ts`                                                                                                          |
| User-visible copy                                       | A key in `i18n/resources/en.ts` plus the other locales                                                                                                                    |

## Anti-patterns

- Composer internals dropped into `components/` or `screens/workspace/` (`docs/architecture.md` calls this out explicitly).
- A `utils/` file that only one feature uses.
- A `.web.tsx` that is a copy of the base file with one line changed; gate the line instead.
- Importing from another feature's `internal/`.
