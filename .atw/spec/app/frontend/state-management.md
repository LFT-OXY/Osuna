# State Management

Four kinds of state, four homes. Pick by what the state is, not by what is convenient.

| State | Home | Reference |
|-------|------|-----------|
| Daemon data that arrives over the socket (agents, workspaces, projects, timelines) | The session store and the replica-backed owners in `runtime/` | `stores/session-store.ts`, `runtime/directory-sync/`, `runtime/replica-cache/` |
| Fetched values with a request/response shape (config, provider snapshots, PR status, file preview) | React Query via `data/query.ts` | [Hooks and Data](./hooks-and-data.md) |
| UI state shared across surfaces (layout, panels, drafts, shortcuts, sidebar) | A Zustand store in `stores/` | `stores/workspace-layout-store.ts`, `stores/keyboard-shortcuts-store.ts`, `stores/draft-store/` |
| Stable values provided once (client, toast API, voice, callouts) | React context in `contexts/` | `contexts/session-context.tsx`, `contexts/toast-api-context.tsx` |

Component-local `useState` is for state nobody else reads. Two or more interacting `useState`s become a reducer with a discriminated union.

## Zustand stores

`stores/keyboard-shortcuts-store.ts` is the small reference: a typed `interface … State` with fields and actions, `create<State>()`, module-scope helpers for timers. `stores/session-store.ts` is the hot store: `create` with `subscribeWithSelector`, `fast-deep-equal` for structural comparisons, and pure update functions imported from `types/stream.ts` and `composer/submission/model.ts`.

Rules:

- **Select narrowly.** `useSessionStore((s) => s.agents[id]?.status)`, not the whole agent. Derived arrays and objects go through `useShallow` or a deep-equal selector; `stores/session-store-hooks/selectors.ts` holds the shared ones.
- **Selectors on the session store must be O(1) when their inputs have not changed.** Equality stops renders, not selector calls. A `filter` inside a selector on a hot store runs on every update.
- **Actions live in the store or a colocated `actions.ts`** (`stores/workspace-layout-actions.ts`, `composer/actions.ts`); components call them, they do not compute the next state.
- **Persisted stores key by the convention in `docs/data-model.md`:** directory-backed state by `(serverId, cwd)`, workspace-owned state by `workspaceId` with `cwd` only as a fallback. The `workspaceId` is opaque; never parse it. `stores/draft-keys.ts` is the reference for building keys.
- **Tests are pure store tests in Node**: `stores/workspace-layout-store.test.ts`, `stores/session-store.test.ts`. Reset the store in `beforeEach`; seed with `test/seed-session.ts` when hosts are needed.

## The session store and the replica

`SessionStore` is the in-memory truth for connected hosts. `runtime/replica-cache` is typed storage under it and never observes or mutates the store; `runtime/directory-sync` owns cache selection and network reconciliation and publishes accepted rows into the store. Late cache reads cannot overwrite state advanced by live data. Do not add a code path that writes replica rows from a component or reads the cache to render directly; go through the owner (`docs/architecture.md` §`packages/app`).

Timeline updates go through the reducers in `timeline/session-stream-reducers.ts` (compaction, gap detection, sequence dedupe). `docs/timeline-sync.md` explains why live streams are for immediacy and `fetch_agent_timeline_request` is authoritative.

## Contexts

Context is for values that rarely change: the daemon client for the active session, the toast API, the voice controller, the sidebar callout registry. Lint rejects constructed context values (`react/jsx-no-constructed-context-values`), so memoize what you provide. State that changes per keystroke or per stream event is a store, not a context.

## Forms

Forms are a non-React model with an explicit lifecycle (`construct`, `hydrate`, `resolve`, `destroy`) rendered by a thin component. `schedules/schedule-form-model.ts` + `use-schedule-form-model.ts` + `components/schedules/schedule-form-sheet.tsx` is the golden example. `docs/forms.md` lists the anti-patterns rejected on sight: `useEffect` choreography, one mounted instance serving create and edit, `useMemo`-keyed model construction on live-data identity, `isLoading`/`isEmpty` boolean bags where a load-state union belongs.

## Anti-patterns

- A component that subscribes to the entire session store or the entire agent object.
- Effect cascades: `useEffect` setting state that triggers another `useEffect`.
- `useRef` holding something that affects render.
- A store keyed by `cwd` for workspace-owned state (two workspaces can share one `cwd`).
- Copying daemon data into component state "to edit it"; use the form model.
