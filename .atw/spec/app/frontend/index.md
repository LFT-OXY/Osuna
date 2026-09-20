# @getpaseo/app — Client Guidelines

The app is one Expo / React Native codebase under `packages/app/src/` that runs on iOS, Android, browser web, and Electron desktop. It connects to one or more daemons over the `@getpaseo/client` WebSocket client, keeps a durable replica of directory and timeline data, and renders everything with a Unistyles theme. Cross-platform is the default; platform gates are the exception.

Read these repo docs before the guides. The guides distill them and add the app's concrete shapes.

| Doc | Why |
|-----|-----|
| `docs/coding-standards.md` | House style, including the React section and retained-panel rules |
| `docs/testing.md` | Two test categories; ports and adapters; Playwright for RPC-backed UI |
| `docs/design.md` | Tokens, hierarchy, buttons, the forbidden list, canonical surfaces by pattern |
| `docs/unistyles.md` | `useUnistyles()` is banned; the alternatives in order |
| `docs/hover.md` | The one hover pattern and the three ways it breaks |
| `docs/forms.md` | Non-React form model; the schedule form is the golden example |
| `docs/expo-router.md` | Route ownership, startup restore, native blank-screen gotchas |
| `docs/floating-panels.md`, `docs/menus.md`, `docs/mobile-panels.md` | Anchored popovers, the menu engine, compact panel ownership |
| `docs/architecture.md` §`packages/app`, `docs/data-model.md` "Client-side stores" | Replica cache, directory sync, keying convention |
| `CLAUDE.md` "Platform gating" | The four gates and the decision matrix |

## Guides

| Guide | Covers |
|-------|--------|
| [Directory Structure](./directory-structure.md) | Feature modules, routes, platform file extensions, where a new thing goes |
| [Component Guidelines](./component-guidelines.md) | Primitives to reuse, design forbidden list, hover, platform gates, i18n |
| [State Management](./state-management.md) | Zustand stores, selectors, session store, contexts, forms |
| [Hooks and Data](./hooks-and-data.md) | React Query through `data/query.ts`, effects, replica-backed reads |
| [Styling](./styling.md) | Unistyles `StyleSheet.create((theme) => …)`, tokens, the banned hook |
| [Type Safety](./type-safety.md) | Protocol types, discriminated unions, narrowing, gates |
| [Testing](./testing.md) | Unit in Node, `*.browser.test`, Playwright in `e2e/browser/` |
| [Quality Guidelines](./quality-guidelines.md) | App-specific checks, forbidden patterns, verification commands |

## Commands

```bash
npm run typecheck
npm run lint
npm run format                                              # before committing
npx vitest run packages/app/src/<file>.test.ts --bail=1
npm run test:browser --workspace=@getpaseo/app              # only *.browser.test files
npx playwright test --project=browser e2e/browser/<spec>    # from packages/app, targeted only
npm run build:client                                        # when protocol/client types look stale
```

Never run the full Playwright suite locally. `npm run dev:app` starts Expo against the dev daemon.
