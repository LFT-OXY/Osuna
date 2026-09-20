# State Management

Four kinds of state, four homes. Pick by what the state is, not by what is convenient.

| State                                                                                              | Home                                                          | Reference                                                                                       |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Daemon data that arrives over the socket (agents, workspaces, projects, timelines)                 | The session store and the replica-backed owners in `runtime/` | `stores/session-store.ts`, `runtime/directory-sync/`, `runtime/replica-cache/`                  |
| Fetched values with a request/response shape (config, provider snapshots, PR status, file preview) | React Query via `data/query.ts`                               | [Hooks and Data](./hooks-and-data.md)                                                           |
| UI state shared across surfaces (layout, panels, drafts, shortcuts, sidebar)                       | A Zustand store in `stores/`                                  | `stores/workspace-layout-store.ts`, `stores/keyboard-shortcuts-store.ts`, `stores/draft-store/` |
| Stable values provided once (client, toast API, voice, callouts)                                   | React context in `contexts/`                                  | `contexts/session-context.tsx`, `contexts/toast-api-context.tsx`                                |

Component-local `useState` is for state nobody else reads. Two or more interacting `useState`s become a reducer with a discriminated union.

## Zustand stores

`stores/keyboard-shortcuts-store.ts` is the small reference: a typed `interface … State` with fields and actions, `create<State>()`, module-scope helpers for timers. `stores/session-store.ts` is the hot store: `create` with `subscribeWithSelector`, `fast-deep-equal` for structural comparisons, and pure update functions imported from `types/stream.ts` and `composer/submission/model.ts`.

Rules:

- **Select narrowly.** `useSessionStore((s) => s.agents[id]?.status)`, not the whole agent. Derived arrays and objects go through `useShallow` or a deep-equal selector; `stores/session-store-hooks/selectors.ts` holds the shared ones.
- **Selectors on the session store must be O(1) when their inputs have not changed.** Equality stops renders, not selector calls. A `filter` inside a selector on a hot store runs on every update.
- **Actions live in the store or a colocated `actions.ts`** (`stores/workspace-layout-actions.ts`, `composer/actions.ts`); components call them, they do not compute the next state.
- **A preference one feature owns lives in that feature's `internal/`, not in `stores/`.** `stores/` cannot import a feature's `internal/` (Directory Structure anti-patterns), and the feature's surface needs the store, so `stores/x-store.ts` importing `@/session-history/internal/model` for its scope type is a cycle waiting to happen. `session-history/internal/scope-store.ts` is the shape: `persist` + `createValidatedPersistStorage` + `migrate`, schema built from the feature's own literal tuple (`z.enum(SESSION_HISTORY_SCOPES)`) so the scope list exists once. `stores/` is for state several surfaces share.
- **Deliberately volatile feature state that nothing renders from is a module-level `Map` in that feature's `internal/`, exposed as `lookup…`/`remember…`/`forget…` functions plus a `reset…ForTests()`; a Zustand store there is speculative when no component subscribes.** `session-history/internal/resume-terminals.ts` maps `serverId:workspaceId` → session key → terminal id so a second click focuses the terminal instead of resuming the session twice; it is not persisted because the daemon reaps terminals and a persisted map would need cleanup on every reap. Callers read it at action time (`lookupResumeTerminal` inside the mutation), not through a selector: nothing renders from it. Before trusting an entry, confirm the terminal still exists with `client.listTerminals(cwd, undefined, { workspaceId })` and `forget` it if not.
- **Persisted stores key by the convention in `docs/data-model.md`:** directory-backed state by `(serverId, cwd)`, workspace-owned state by `workspaceId` with `cwd` only as a fallback. The `workspaceId` is opaque; never parse it. `stores/draft-keys.ts` is the reference for building keys.
- **Tests are pure store tests in Node**: `stores/workspace-layout-store.test.ts`, `stores/session-store.test.ts`. Reset the store in `beforeEach`; seed with `test/seed-session.ts` when hosts are needed.

## The session store and the replica

`SessionStore` is the in-memory truth for connected hosts. `runtime/replica-cache` is typed storage under it and never observes or mutates the store; `runtime/directory-sync` owns cache selection and network reconciliation and publishes accepted rows into the store. Late cache reads cannot overwrite state advanced by live data. Do not add a code path that writes replica rows from a component or reads the cache to render directly; go through the owner (`docs/architecture.md` §`packages/app`).

Timeline updates go through the reducers in `timeline/session-stream-reducers.ts` (compaction, gap detection, sequence dedupe). `docs/timeline-sync.md` explains why live streams are for immediacy and `fetch_agent_timeline_request` is authoritative.

## Contexts

Context is for values that rarely change: the daemon client for the active session, the toast API, the voice controller, the sidebar callout registry. Lint rejects constructed context values (`react/jsx-no-constructed-context-values`), so memoize what you provide. State that changes per keystroke or per stream event is a store, not a context.

## Forms

Forms are a non-React model with an explicit lifecycle (`construct`, `hydrate`, `resolve`, `destroy`) rendered by a thin component. `schedules/schedule-form-model.ts` + `use-schedule-form-model.ts` + `components/schedules/schedule-form-sheet.tsx` is the golden example. `docs/forms.md` lists the anti-patterns rejected on sight: `useEffect` choreography, one mounted instance serving create and edit, `useMemo`-keyed model construction on live-data identity, `isLoading`/`isEmpty` boolean bags where a load-state union belongs.

## Workspace tab kinds

A new `WorkspaceTabTarget` kind is one logical change spread over fixed touchpoints; miss one and the tab persists wrong, shows the wrong label, or cannot be toggled. The Explorer-only singleton `session_history` (`session-history/`, `panels/session-history-panel.tsx`) is the worked example; `pull_request` is the two-host one.

| Touchpoint    | File                                                                                                                                                                                                                 | What to add                                                                                                                         |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Type          | `workspace-tabs/model.ts`                                                                                                                                                                                            | The union member                                                                                                                    |
| Identity      | `workspace-tabs/identity.ts`                                                                                                                                                                                         | `normalizeSimpleWorkspaceTabTarget` case, the equality branch, `buildDeterministicWorkspaceTabId` (singletons return `target.kind`) |
| Hosts         | `panels/panel-manifest.ts`                                                                                                                                                                                           | `supportedHosts` (`["explorer"]` keeps it out of main panes and out of "Move to main")                                              |
| Persistence   | `stores/workspace-layout-storage.ts`                                                                                                                                                                                 | The `strictObject` schema entry; without it the saved layout drops the tab on reload                                                |
| Panel         | `panels/<kind>-panel.tsx` + `panels/register-panels.ts`                                                                                                                                                              | `definePanel(kind, { component, presentation })`; the launcher and tab rail read `presentation`                                     |
| Launcher      | `workspace-tabs/launcher/index.tsx`, `launcher/internal/catalog.ts`                                                                                                                                                  | `BUILT_IN_SELECTIONS`, both launch orders, a `builtIns` item; `toggleTarget` set makes the Explorer tab-rail context menu toggle it |
| Labels        | `screens/workspace/workspace-screen.tsx` (two label objects, two fallback functions), `workspace-desktop-tabs-row.tsx`, `workspace-tab-menu.ts` close test id                                                        | The fallback label and test id                                                                                                      |
| Explorer view | `workspace-tabs/explorer-sidebar.ts` `VIEW_TARGETS`, `stores/explorer-tab-memory.ts`, `stores/panel-store/state.ts` `ExplorerTabSchema`, `hooks/keyboard-shift-policy.ts`, `components/compact-explorer-sidebar.tsx` | Only when the kind is also a compact Explorer segment                                                                               |
| Copy          | `i18n/resources/*.ts` (nine files)                                                                                                                                                                                   | `panels.<kind>.label/subtitle/tooltip` and `workspace.tabs.explorerSidebar.<view>`                                                  |
| Tests         | `panels/panel-manifest.test.ts`, `workspace-tabs/identity.test.ts`, `workspace-tabs/explorer-sidebar.test.ts`, `launcher/internal/catalog.test.ts`                                                                   | Host support, identity, view open, launch order                                                                                     |

Opening a tab from inside an Explorer panel: `usePaneContext().openTab` places into the Explorer pane on desktop (`focusPaneBeforeOpen: true`), so a terminal or agent opened from there would dock in the sidebar. Use `useWorkspaceLayoutStore.getState().openTab({ placement: FOCUSED_PANE_PLACEMENT })` then `focusTab` instead (`session-history/internal/open-terminal-tab.ts`). The store's `focusPane` refuses the Explorer pane id, so the focused pane is always a main pane and the same call serves the compact overlay.

### Making a tab an Explorer default

Explorer defaults are one list: `DEFAULT_EXPLORER_SIDEBAR_TARGETS` in `stores/workspace-layout-actions.ts` (Files, Changes, Session history). Every path that births an Explorer pane (`createWorkspaceLayoutWithExplorerSidebar`, `restoreEmptyPanesInNode`, the v1 migration's `createExplorerSidebarNode`) goes through `createDefaultExplorerSidebarPane`, which pins focus on Changes; `createPaneNode` focuses the last tab by default, so appending a default without that pin changes the opening view.

A default added after layouts were already being saved needs a backfill, and a backfill needs a marker or a closed tab comes back on every launch:

| Piece                | Where                                                                                                                                           | Contract                                                                                                                            |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Marker               | `explorerSidebarSeededTabKindsByWorkspace: Record<workspaceKey, kind[]>` in `workspace-layout-storage.ts`, optional                             | Kinds already offered to that workspace. Missing field or key = none offered.                                                       |
| Which kinds backfill | `EXPLORER_SIDEBAR_SEEDED_TAB_KINDS` (actions)                                                                                                   | Only kinds that post-date persisted layouts. Files and Changes are not in it: pre-marker users who closed them would get them back. |
| Backfill             | `seedExplorerSidebarTabs({ layout, explorerSidebarPaneId, kinds })`, called from the store's `merge` after `ensurePersistedExplorerSidebarPane` | Inserts after the last earlier default still open, keeps focus, no-ops when the kind is open anywhere.                              |
| Writing the marker   | `partialize` writes the full list for every key in `layoutByWorkspace`                                                                          | Invariant: a layout in memory was born with or backfilled to the current defaults, so the marker never needs its own state.         |

Cases:

- Good: v2 payload, explorer pane `[changes_tree, files, file]`, no marker → `[changes_tree, files, session_history, file]`, focus unchanged; next save writes `["session_history"]`.
- Base: new workspace never persisted → default layout already has the tab; the first save writes the marker.
- Bad handled: marker present, tab absent → left absent (user closed it). v1 payload → migration rebuilds the Explorer pane from the defaults, so the backfill is a no-op; `migrateVersionOneWorkspaceLayout` treats every default kind as Explorer furniture via `isDefaultExplorerSidebarTabKind`, never as a user tab to move into a side pane.

Tests live in `stores/workspace-layout-store.test.ts` ("backfills Session history once…", "leaves Session history closed…", "keeps Session history closed across reloads…"): assert the pane's tab kinds and focus after `persist.rehydrate()`, and the persisted marker after the next save. Every assertion of the seed list in that file changes when the list does; `contentTabs` filters the defaults out.

Wrong: bump `WORKSPACE_LAYOUT_PERSIST_VERSION` and add the tab in `migrate`. Correct: optional marker field plus `merge` backfill. The schema is `strictObject`, and a version bump re-runs the v1 migration path for every user while still lacking the "user closed it" signal.

## Anti-patterns

- A component that subscribes to the entire session store or the entire agent object.
- Effect cascades: `useEffect` setting state that triggers another `useEffect`.
- `useRef` holding something that affects render.
- A store keyed by `cwd` for workspace-owned state (two workspaces can share one `cwd`).
- Copying daemon data into component state "to edit it"; use the form model.
