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

## Composer content outside the text

A Skill chip (`composer/skill-chips.ts`) is prompt content that is not in the Composer text. Three rules keep it sendable:

- `MessageInput` only sees text and attachments, so the Composer passes `hasExternalContent || hasSkillChips`. Both empty-content guards read it: `sendMessageImpl` in `composer/input/input.tsx` and `queueComposerInput` in `composer/input/state.ts`. A chip-only message that one of them drops sends from Enter and silently does nothing from Mod+Enter.
- Serialize before submit: `resolveSkillChipSubmission({ chips, text })` returns the `/a /b body` message plus `recognizesClientCommands`. With chips, `/clear` in the body is ordinary text, both at submit and when picked from the Command menu (`canExecuteClientSlashCommand` is false).
- Chips live in the draft record (`input.skills`), so they share the draft key and its workspace isolation. The Composer takes them as `skillChips` / `onChangeSkillChips` props from `useAgentInputDraft`, like `attachments`. Never keep them in Composer state: one Composer instance is reused across agents.
- `submitAgentInput` (`composer/submit.ts`) owns the chip side of a send: it receives the body and `skillChips`, serializes the outgoing message, clears chips with the text, and on failure restores the body without the prefix plus the chips via `setSkillChips`. Restoring the serialized text instead would send the prefix twice. Queued messages and edit-resend stay plain serialized text.
- A chip-only draft is content: `hasDraftContent` in `stores/draft-store/state.ts` is the one predicate for "active vs abandoned", used by both `editDraftRecordText` and the hook's `saveDraft`.

## Contexts

Context is for values that rarely change: the daemon client for the active session, the toast API, the voice controller, the sidebar callout registry. Lint rejects constructed context values (`react/jsx-no-constructed-context-values`), so memoize what you provide. State that changes per keystroke or per stream event is a store, not a context.

A stateful machine that several surfaces read (the desktop app updater, read by the sidebar callout and Settings → About) is created once by a provider in the root layout, never by the hook each surface calls. The provider owns the instance (`useState(() => create…())`) and every scheduled side effect: startup check, intervals, re-run on a setting change. The hook only reads the context and subscribes with `useSyncExternalStore`. Wrong: `useMemo(() => createDesktopAppUpdater(...))` plus a mount `useEffect` inside `useDesktopAppUpdater`. Every caller gets its own state and fires its own startup check. Correct: `desktop/updates/desktop-app-updater-provider.tsx`, mounted in `RuntimeProviders` in `app/_layout.tsx`. The scheduling function receives an injected `IntervalTimer`, so tests drive it with `test-utils/fake-interval-timer.ts` instead of `vi.useFakeTimers()` (`docs/testing.md`, clock via a port).

When the Electron main process owns a state that every window shows (the app update phase), the renderer machine mirrors it instead of keeping its own copy. The main process broadcasts a snapshot with a monotonically increasing `revision` on `paseo:event:*` to every window and also returns it from commands; the renderer keeps the highest revision it has seen, because a push and a command reply can arrive in either order. Renderer-only facts sit beside the mirror and never overwrite it: a command in flight (`pendingAction`, so the card moves before the push lands), a failed manual check, a per-window "hidden for this run" flag. Status is derived from the mirror plus those facts in one function (`deriveStatus` in `desktop/updates/desktop-app-updater.ts`). Wrong: set `status = "downloaded"` in the renderer when the download command resolves; a second window never learns it. The IPC contract is in `type-safety.md` ("Scenario: desktop app update").

## Forms

Forms are a non-React model with an explicit lifecycle (`construct`, `hydrate`, `resolve`, `destroy`) rendered by a thin component. `schedules/schedule-form-model.ts` + `use-schedule-form-model.ts` + `components/schedules/schedule-form-sheet.tsx` is the golden example. `docs/forms.md` lists the anti-patterns rejected on sight: `useEffect` choreography, one mounted instance serving create and edit, `useMemo`-keyed model construction on live-data identity, `isLoading`/`isEmpty` boolean bags where a load-state union belongs.

### An async request owned by a form model

When a form model starts a request of its own (the API endpoint form's `fetchModels` and `testConnection`), the model owns an `AbortController` per request and passes its `signal` to the dependency. `cancelFetch()` and `close()` abort it, and a result only lands if its controller is still the current one, so a late answer after cancel or refetch is dropped. The dependency returns a result union (`ok | failed | cancelled`) instead of throwing; `save` does the same (`saved | failed | cancelled`), where `cancelled` means the user declined the confirmation, so the form stays open with no error; the hook that implements it turns the signal into the daemon's cancel RPC. Clear a result that no longer describes the inputs: editing the Base URL or key aborts a pending connection test and resets it to idle. See `api-endpoints/internal/form-model.ts` and `use-api-endpoints.ts`.

Status that comes with a list (the API endpoint `health` and `cliBaseUrl`) is derived by one pure selector next to the load state, not in the component: `selectApiEndpointHealthView` sorts the actionable issue first, picks the Alert variant (warning only when every issue is advisory), and returns the active endpoint only when re-apply makes sense. The section renders a single `<Alert>` for all issues (`docs/design.md`: one Alert per region). Re-apply confirms like a switch and calls `set_active` with the active id. See `api-endpoints/internal/section-state.ts`.

Every action that rewrites the CLI config confirms first: switch, re-apply, and saving or deleting the endpoint in use (`isActiveApiEndpoint`). The hook refetches the list before it shows the dialog (`loadLatestState` in `use-api-endpoints.ts`) and decides from that list, not from the rendered state: a list loaded minutes ago can miss an endpoint another client just enabled, and the save would rewrite the file without asking. `selectApiEndpointImpact({ provider, runningSessionCount })` returns the impact lines as keys (session count, Claude "switch right away" vs "may be affected" for everything else, then the terminal line), appended after the action sentence.

### A remembered model against an authoritative list

`ProviderSnapshotEntry.isModelListAuthoritative` (an API endpoint is active) means the list is every model the CLI accepts; any other id will be rejected. Off that flag the app keeps unknown ids on purpose (a new model may not be in the catalogue yet — `resolve-agent-form.test.ts` "keeps the explicit model when a refreshed catalogue no longer lists it"). The rules, all in `provider-selection/resolve-agent-form.ts` and its callers:

- **Resolve against a copy, never rewrite memory.** `resolveFormStateFromProviderModels` takes `authoritativeModelProviders` (from `buildAuthoritativeModelProviders(entries)`) and, for those providers, swaps an unlisted remembered or initial model for the list default in a copy before `resolveFormState`. Preferences stay untouched, so switching back to Official restores the old choice.
- **An open draft moves too.** `receiveInputs` runs `moveOffUnlistedModel` after resolution, because `completeResolution` returns early once completed.
- **Submitting never writes a fallback.** `persistProviderPreferences` skips `model` when the list is authoritative (it cannot tell fallback from memory); `selectProviderAndModel` does not write the list default when nothing was remembered. The schedule form writes only at submit and knows `userModified.model`, so it exposes `shouldRememberSelectedModel` instead. Editing a saved schedule never swaps its model.
- User actions (pick a model, apply a profile) still record what the form resolved, as in Official.

Known gap: a model picked in endpoint mode is remembered and reaches the Official CLI after switching back; fixing it needs memory keyed per mode (see the task PRD's known limitation).

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
