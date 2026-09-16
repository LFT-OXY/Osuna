# Hooks and Data

## React Query through `data/query.ts`

`data/query-client.ts` sets `staleTime: Infinity` and disables refetch on mount, reconnect, and focus. Data does not go stale by time; the daemon pushes changes. So do not call `useQuery` from `@tanstack/react-query` directly in features. Use the wrappers in `data/query.ts`, which encode the two shapes the app has:

| Wrapper | For | What it forces you to declare |
|---------|-----|-------------------------------|
| `useReplicaQuery` | A value the daemon pushes over the socket | `pushEvent`: the outbound message that invalidates it |
| `useFetchQuery` / `useFetchQueries` | A request/response value | `dataShape: "list" \| "value"` and either `staleTimeMs` or `immutableWhen(data)` |
| `fetchQueryOptions` | Prefetch or imperative reads with the same contract | same as above |

References: `hooks/use-agent-commands-query.ts`, `data/providers-snapshot.ts`, `plugins/settings/use-settings.ts`, `projects/icons.ts`. Query keys are built by exported functions (`hooks/agent-history-query-key.ts`) so invalidation and tests share them.

Directory-backed caches (Git status, PR status, file preview) are keyed by `(serverId, cwd)` and are React Query caches, not persisted stores (`docs/data-model.md` "Keying convention").

## Hook shape

A hook that does real work has a pure module beside it and a test for that module:

```
hooks/sidebar-workspaces-view-model.ts      # pure: (inputs) => rows
hooks/sidebar-workspaces-view-model.test.ts
hooks/use-sidebar-workspaces.ts             # subscribes, calls the pure function
```

`hooks/use-archive-agent.ts` exports its pure pieces (`applyArchivedAgentCloseResults`, `selectPendingArchiveAgentIds`) and `use-archive-agent.test.ts` tests them against a seeded store and a `QueryClient`, no renderer. That is the default shape for new hooks.

## Effects

- `useEffect` synchronizes with something outside React: a subscription, a timer, the DOM, the daemon client. It never transforms React state into other React state; derive in render or `useMemo`.
- Subscriptions return their teardown. Infinite animations are subscriptions and start only while their retained panel is active (`docs/coding-standards.md` "React").
- `useRef` holds DOM nodes and non-rendering identities (timer ids, `AbortController`, latest-callback caches). If it affects what renders, it is state.
- Handlers get `useCallback` only when a memoized child depends on them; `useMemo` only for derived structures that cross a `memo` boundary or feed a dependency array.

## Host runtime

`runtime/host-runtime.ts` (`HostRuntimeController`) owns saved hosts, reconnection, and per-host runtime state. `runtime/host-features.ts` is where a feature checks `server_info.features.*` once and either runs or tells the user to update the host. No fallback branches for old daemons in components.

## Anti-patterns

- `useState` + `useEffect` + `isLoading` + `error` for fetched data.
- A raw `useQuery` with its own `staleTime`, bypassing `data/query.ts`.
- A hook that returns a new object or array every render to a consumer that memoizes.
- Reading `server_info.features` in several components instead of once in the host-features boundary.
