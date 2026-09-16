# Quality Guidelines

`docs/coding-standards.md` is the rulebook and `docs/design.md` is the visual rulebook. This file is the app-specific checklist and the commands that prove it.

## Checks reviewers run

- **Cross-platform by default.** Any `isWeb`, `isNative`, `getIsElectron()`, or `Platform.OS` has a specific reason in the diff. Layout decisions use `useIsCompactFormFactor()`, never `Platform.OS`. Large platform branches are separate `.web.ts` / `.native.ts` / `.electron.tsx` files.
- **No `useUnistyles()` added.** See [Styling](./styling.md).
- **Hover follows `docs/hover.md`**, and hover-revealed controls are visible on native and compact.
- **Design forbidden list** (`docs/design.md` §14): `<Pressable>` buttons, raw `Modal`, direct `ActivityIndicator`, bespoke pills, hex colors, off-scale spacing, `fontWeight.medium` on body text, destructive actions without `confirmDialog`, "checkout" in UI strings.
- **Route changes** re-read `docs/expo-router.md` and its checklist: routes are registered in the layout that owns them, workspace returns go through `navigateToWorkspace()` from `stores/navigation-active-workspace-store/index.ts`, and root stays on `/h/[serverId]` for remembered restore.
- **Every fallible action has pending, success, and failure UI**, and tests for success and failure.
- **All copy is in `i18n/resources/`**, in every locale.
- **Selectors are narrow and O(1) on the session store**; rows do not subscribe individually.
- **Performance-sensitive paths** (`agent-stream/`, `word-stream/`, `terminal/`, timeline rendering) follow `docs/agent-stream-performance.md` and `docs/terminal-performance.md`. The `profile:*` scripts in `packages/app/package.json` exist to prove a change did not regress.
- **Feature gating** is one check of `server_info.features.*` in the host-features boundary, then run or tell the user to update. No fallback branches.
- **Protocol edits** keep `packages/protocol` backward-compatible and tagged `COMPAT(...)`; rebuild with `npm run build:client` before diagnosing type errors.

## Forbidden

- `onPointerEnter` on a `Pressable`, or `onHoverIn` on the hover envelope `View`.
- DOM APIs outside an `isWeb` block; casting RN refs to `HTMLElement`.
- `Alert.alert` for feedback (a no-op on web).
- `console.log` left behind; `debugger`.
- A component defined inside a component.
- Array index as `key` on reorderable or filterable lists.
- `vi.mock` / JSDOM / `@testing-library` in new tests.
- `npm run test` for the workspace; the full Playwright suite locally.
- Composer internals outside `composer/`.

## Verification after every change

```bash
npm run typecheck
npm run lint
npx vitest run <the file you changed> --bail=1
npm run format          # before committing
```

Lint is oxlint (`.oxlintrc.json`) with `correctness`, `suspicious`, and `perf` as errors plus the React rules that matter here: `react/no-array-index-key`, `react/jsx-no-constructed-context-values`, `react/jsx-no-useless-fragment`. Fix the code, do not disable the rule. For UI changes, `docs/qa.md` asks for a recording or before/after screenshots and the platforms you tested; `npm run dev:app` starts Expo against the dev daemon.
