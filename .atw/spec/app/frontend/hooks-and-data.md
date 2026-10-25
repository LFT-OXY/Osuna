# Hooks and Data

## React Query through `data/query.ts`

`data/query-client.ts` sets `staleTime: Infinity` and disables refetch on mount, reconnect, and focus. Data does not go stale by time; the daemon pushes changes. So do not call `useQuery` from `@tanstack/react-query` directly in features. Use the wrappers in `data/query.ts`, which encode the two shapes the app has:

| Wrapper                             | For                                                 | What it forces you to declare                                                    |
| ----------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------- |
| `useReplicaQuery`                   | A value the daemon pushes over the socket           | `pushEvent`: the outbound message that invalidates it                            |
| `useFetchQuery` / `useFetchQueries` | A request/response value                            | `dataShape: "list" \| "value"` and either `staleTimeMs` or `immutableWhen(data)` |
| `fetchQueryOptions`                 | Prefetch or imperative reads with the same contract | same as above                                                                    |

References: `hooks/use-agent-commands-query.ts`, `data/providers-snapshot.ts`, `plugins/settings/use-settings.ts`, `projects/icons.ts`. Query keys are built by exported functions (`hooks/agent-history-query-key.ts`) so invalidation and tests share them.

When a replica query needs an `observeEvents` subscription of its own (`price-table/use-price-table.ts`, `usage-stats/use-agent-usage.ts`), that subscription belongs to the surface that mounts the query, not to a sibling that happens to mount beside it. Two surfaces reading the same agent — the stream's turn footers and the composer's context meter — each own one, even though that costs a second subscription: a meter whose freshness depends on a stream view being mounted next to it is correct only by accident, and the accident is invisible until someone renders one without the other.

Directory-backed caches (Git status, PR status, file preview) are keyed by `(serverId, cwd)` and are React Query caches, not persisted stores (`docs/data-model.md` "Keying convention").

### Fetches with no push event refresh through `enabled`

Some daemon data has no invalidating message: provider session logs, a file edited outside Paseo. Do not add `focus` / `visibilitychange` / `AppState` listeners that call `refetch()`; `hooks/use-app-visible.ts` already owns those listeners for the whole app, and a second set fires twice per focus (React Query cancels and restarts the in-flight fetch). Gate the query instead:

```ts
// In the runtime-wired wrapper, never inside the surface:
const isVisible = useAppActivelyVisible() && useRetainedPanelActive();
// In the surface:
useFetchQuery({ ..., staleTimeMs: 0, enabled: isClientReady && isVisible });
```

Re-enabling a stale query is a fetch, so "window regains focus" and "hidden retained panel comes back" both refresh with no code of their own, and a hidden panel never fans out requests in the background. `file-pane/pane.tsx` (`isFileQueryEnabled`) and `session-history/index.tsx` are the references. The surface takes `isVisible: boolean` as a prop next to `isConnected`, so a jsdom test drives the transition by rerendering, not by patching `document.hasFocus`.

An always-on surface that must also refresh on a timer adds `refetchInterval` to that same gated observer. The plan usage gauge in the Composer context strip (`plan-usage/use-strip-usage.ts`) polls every five minutes, the daemon's own plan usage cache period, so polling never reaches a source's account API more often than the cache allows. `enabled` is `useRetainedPanelActive() && useAppActivelyVisible()` and the host reporting plan usage (`useHostReportsUsage`), so a hidden tab stops polling and catches up through the stale check when it comes back. `fetchQueryOptions` sets `refetchOnMount: "always"`: every strip mount fetches once.

### A timed read that must tell the daemon who asked

The endpoint balance (`api-endpoints/use-endpoint-balances.ts`) polls with `refetchInterval` (60 s, only while "Auto-refresh balance and plan usage" is on) on the gated observer above, but the daemon treats an opened page as the user's read and a timed one as not (rpc-and-protocol.md, "when an endpoint's balance is read"). `queryFn` cannot see what triggered it, so the hook keeps `openedFor` (a ref holding the endpoint ids already read once): null on mount and whenever the page stops being visible, so the next fetch — mount, a new key, the window coming back — is `open`; a fetch for the same ids after that is `timed`; Refresh sets a one-shot `force` ref before `refetch()`. `internal/balance-reads.ts` turns the kind into `{ asked, force }` and owns the 30-second gap (magpie `QUOTAS_OPEN_GAP`) in a module-level map with `resetBalanceReadsForTests()`. Don't add a `setInterval` that calls `refetch()`: it keeps polling while the page is hidden.

### A query that depends on another query's answer: gate the fetch and the read

The gauge shows the account its agent runs under. It asks the daemon first (`usage.list_reports` with `agentId`, `stripAgentReportsQueryInput`, key `["usage", serverId, "strip", agentId]`, `retry: false`) and reads the host's list (`stripHostReportsQueryInput`, upstream's `usageReportsQueryKey`) only when `stripNeedsHostReports` says so: a draft has no agent to ask, the daemon named no account, or the request failed with no earlier answer. Both builders take a `StripUsageSource` so `use-strip-usage.test.ts` drives them with a fake in Node.

The host list's key is shared with upstream's modal and sidebar summary, and the sidebar reads it as soon as the app opens (`useHasUsageSummary` in `left-sidebar.tsx`), so that cache is full before the agent's answer arrives. `enabled: false` stops the strip's own fetch; it does not stop `query.data` from returning what another observer put there. `resolveStripReports` hands the host's list on only when `stripNeedsHostReports` is true. Without that second gate the gauge showed the host's first account for the provider, then swapped to the agent's.

The strip keeps its own copy of the agent's reports. Upstream's `useAgentUsage` (the context window card) uses `gcTime: 0` so an agent resumed under another login never shows the old one; an always-mounted observer on that key would keep the old data alive and upstream's e2e asserts the loading sentence on reopen. A draft's query takes `skipToken`; give the builder an explicit return type, because `skipToken` inferred through an object literal widens to `symbol` and `useFetchQuery` rejects it.

Code outside `usage/` reaches upstream's host-list query through the export block at the end of `usage/queries.ts` (`hostUsageQueryKey`, `usageReportsQueryKey`, `listHostUsageReports`, `refreshHostUsageReports`, `requireUsageClient`, `USAGE_REPORTS_STALE_TIME_MS`). Add to that block; do not copy the key or the fetcher. The Usage page's plan card (`plan-usage/use-hosts.ts`) mounts one such query per counted host and groups them with the pure `resolvePlanUsageHosts` (`plan-usage/hosts.ts`).

### Refresh on every open, prefetch on focus: two observers on one key

The Command menu wants both: fetch when the Composer input gains focus so the menu opens with data, and fetch again every time the menu opens while keeping the old list on screen. One observer cannot do both, because typing `/` in an already-focused input does not flip its `enabled`. `hooks/use-agent-commands-query.ts` mounts two `useFetchQuery` observers on the same key:

```ts
const inputs = agentCommandsQueryInputs({ ..., canFetch, isMenuOpen, prefetch });
useFetchQuery(inputs.prefetch); // staleTimeMs: 60_000, enabled: canFetch && prefetch
const query = useFetchQuery(inputs.menu); // staleTimeMs: 0, enabled: canFetch && isMenuOpen
return selectAgentCommandsState({ canFetch, data: query.data, error: query.error });
```

`staleTime` is evaluated per observer, so refocusing within a minute does not refetch, while every menu open (`enabled` false → true on a stale query) does. An open that lands while the focus fetch is still in flight joins that fetch instead of starting a second one. Use `dataShape: "value"` here: `"list"` adds `keepPreviousData`, which would show another agent's commands under a new key.

Expose the result as a discriminated union (`unavailable | loading | error | ready`), not `{ isLoading, error, data }`. Two rules live in the selector: data wins over error, so a failed background refresh keeps the old list instead of replacing it with an error row; and "cannot fetch and never had data" (host disconnected) is `unavailable`, which hides the menu instead of showing a loading row that never ends.

### One observer checks, the others read; a forced recheck goes through `prefetchQuery`

Provider version checks (`provider-detail/version-check.ts`) have one owner: `ProvidersPage` mounts `useProviderVersionCheck(serverId, { checkOnMount: true })` with `staleTimeMs: 0`, so every open asks the daemon, which answers from its own one-hour cache. The list row and the detail read the same key with `checkOnMount: false` (`enabled: false`), so they never start a request. The composer popup renders the same detail with `checksVersions: false`: no recheck on refresh and no update arrow.

A refresh that must bypass the daemon cache calls `recheckProviderVersions`, which runs `queryClient.prefetchQuery({ staleTime: 0, retry: false, queryFn })` and merges the rechecked providers into the cached list. Don't write `try { … } catch {}` around the RPC to keep the old list on failure: `prefetchQuery` already records the error on the query and keeps the previous data, which is the "check failed → show nothing new" behavior.

`prefetchQuery` (like `fetchQuery`) joins a fetch already in flight on the same key instead of starting its own, so a forced recheck issued while the page's first check is still pending would silently return the unforced answer. `recheckProviderVersions` waits for the in-flight fetch (`isFetching({ queryKey }) > 0` → one `prefetchQuery` that joins it), then prefetches again. The test "still forces the recheck when the page's check has not answered yet" holds the first answer open to prove it.

Test it in Node with `QueryObserver` and a fake client (`version-check.test.ts`); "did not check" is `fetchStatus === "idle"` plus an empty call list.

### A list in daemon config is written back whole

`useDaemonConfig().patchConfig` replaces an array field (`usage.pricing.overrides`, profiles) rather than merging into it, so every edit to one entry sends the whole list. Three rules follow, all in `price-table/price-table-section.tsx` `writeOverrides`:

- Compute the new list from the loaded `config`. When `config` is still `null`, fail the write with the row's localized error instead of starting from `config?.… ?? []`; an empty base sends a one-entry list and deletes every other entry, notes included.
- One write at a time per list. Two writes started from the same snapshot each drop the other's change. Hold the rows that write the list while one is in flight (`price-table/price-rows.ts` `resolveRowWriteState` → `idle | writing | locked`). Releasing the lock right after `patchConfig` resolves is safe: it writes the response into the config query before it returns, so the next write reads the new list.
- Removing an entry removes every entry the daemon would match (`pricing.ts` `removePricingOverride`, case- and space-insensitive). The daemon takes the last duplicate, so deleting one leaves the other in force.
- A row that client state pulled into a group (the LiteLLM model being customized, `price-rows.ts` `customizing`) stays pulled in after its save lands. `patchConfig` resolves before the refetch triggered by `usage.pricing.updated` does, so the model is still `priceSource: "table"` for one round trip; dropping it on `saved` bounces the row into the other group and back. Drop it on `cancelled` and `removed`, where the daemon's list already puts it where it belongs.

Test the list functions in Node (`pricing.test.ts`) and read the list back from the daemon in e2e (`usage-price-table.spec.ts` `readCustomPrices`), not from the page that wrote it.

### Checkout diff pushes are applied at most once a second

`reconcileCheckoutDiffSubscriptions` in `data/push-router.ts` applies `checkout_diff_update` per subscription at most once per `CHECKOUT_DIFF_MIN_APPLY_INTERVAL_MS` (1s): inside the window only the latest payload is kept and applied when the window ends, so the trailing update is never lost. The first full snapshot after subscribing is applied at once and does not start the window. Every path that ends a subscription (full snapshot, error, reconcile release, unmount) calls `cancelPendingUpdate`. The client throttles even though the daemon does too (`CheckoutDiffManager`, server quality-guidelines), because an older daemon does not. Test: `push-router.test.ts` (latest payload only within 1s, trailing payload kept).

### A tree-only Changes panel subscribes to the file list only

When the panel shows only the tree (`presentation === "tree"`, no diff body), `useWorkingDiff` subscribes with `compare.filesOnly: true` — but only if `server_info.features.checkoutDiffFilesOnly` is true, and only while that diff has no unsent review comments (`resolveWorkingDiffSubscription` in `git/working-diff-subscription.ts`). With pending review comments it keeps the full subscription and keeps publishing the review attachment, because a file list has no hunks to build review context from (user decision, 10-19-diff-view-large-changesets 08). A files-only panel publishes no attachment, so it never clears one another panel published. `filesOnly` is part of the query key (`git/query-keys.ts`) and of the push-router match, so the list and the full diff are separate caches; showing the body switches to the full subscription and hiding it switches back. Default expansion (`onFiles`) is fed by either, since the list carries path, counts and `generated`. Tests: `working-diff-subscription.test.ts`, `use-diff-query.test.ts`, `push-router.test.ts` (both switch directions, no flag → always full).

### Checkout diff subscriptions pause while the page is hidden

`useCheckoutDiffQuery` subscribes only while `isCheckoutDiffSubscriptionWanted` holds: enabled, retained panel active, connected, a cwd, and `useAppVisible()`. That is the page-hidden notion (minimized window, other browser tab, native app not `active`), not `useAppActivelyVisible()`: a blurred window is still on screen and keeps updating. This is a push subscription, so it differs on purpose from the focus-gated fetches above. Hiding goes through the normal release path (pending throttled pushes are cancelled, the daemon target closes); becoming visible resubscribes and the first snapshot replaces the old one. Because the last unsubscribe also drops the daemon's per-file reuse, the body after restore is a cold compute (list ~1s, body ~7.5s in the diff-panel scenario); the user accepted "file list within 2s" as the bar and left keeping the reuse cache alive after the last unsubscribe to phase 2 (10-19-diff-view-large-changesets 09). Tests: `use-diff-query.test.ts` (`checkoutDiffQueryInput` + real `QueryObserver`: hidden releases, visible resubscribes); the `useAppVisible()` call itself is covered only by the desktop live check, since a hook test would have to patch `document.visibilityState`.

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

### Don't: a store subscription whose value is a `useMemo` over a version counter

Metro builds this app with the React Compiler (`[metro] React Compiler enabled`). The compiler re-derives a `useMemo`'s dependencies from the callback body and ignores the written dependency array, so a counter that is read only to be discarded is dead code and drops out of the memo's key.

```ts
// Don't — froze for every caller that passed a stable `serverIds`.
const version = useSyncExternalStore(store.subscribeAll, () => store.getVersion(), …);
return useMemo(() => {
  void version; // the reactivity "trigger" the compiler deletes
  return new Map(serverIds.map((id) => [id, store.getSnapshot(id)?.connectionStatus ?? "connecting"]));
}, [serverIds, store, version]);
```

The bug is invisible in tests that pass a fresh array each render — `serverIds` then changes identity every render and carries the recompute by accident. It only shows once a caller memoizes the argument, and it shows as stale data, not as a crash: the usage page sat on a spinner forever because its hosts read `connecting` from the render they mounted on.

```ts
// Do — the value itself is the snapshot, cached so the reference is stable.
const cacheRef = useRef<HostConnectionStatusesSnapshot | null>(null);
const read = useCallback(() => {
  const snapshot = readHostConnectionStatuses(store, serverIds, cacheRef.current);
  cacheRef.current = snapshot;
  return snapshot.statuses;
}, [serverIds, store]);
return useSyncExternalStore(store.subscribeAll, read, read);
```

`useSyncExternalStore` requires `getSnapshot` to return the same reference while nothing has moved, so the cache is not an optimization — it is the contract. Keep the compare-and-reuse in a plain exported function (`readHostConnectionStatuses` in `runtime/host-runtime.ts`) taking a narrow port (`HostConnectionStatusSource`), so a test asserts both halves — same reference while statuses hold, new map when one changes — with no renderer.

## Host runtime

`runtime/host-runtime.ts` (`HostRuntimeController`) owns saved hosts, reconnection, and per-host runtime state. `runtime/host-features.ts` is where a feature checks `server_info.features.*` once and either runs or tells the user to update the host. No fallback branches for old daemons in components.

The check lives in the runtime-wired wrapper, not the surface: `SessionHistoryView` calls `useHostFeature(serverId, "sessionHistory")` and passes `isSupported` down; `SessionHistorySurface` folds it into the query's `enabled` and renders the update prompt after the disconnected state (a disconnected host has no `server_info`, so its flag reads false and would otherwise show the wrong message). The `// COMPAT(name): added in vX, remove after <date>` tag goes on that one line in the surface, and the jsdom test drives the state through the prop. The same wrapper owns any navigation the surface triggers (`navigateToAgent` for a Paseo-owned row) so the surface stays a plain-props seam with no router import.

A surface that shows the update prompt inline — no disconnected state of its own to render first — takes the three-state read instead: `useHostFeatureAvailability(serverId, feature)` is `true` / `false` once `server_info` has arrived and `null` while it has not. `null` renders nothing, because a host that has not answered is not an outdated one, and `useHostFeature`'s boolean cannot tell them apart. `resolveSessionTotal` (`usage-stats/turn-usage.ts`), which the context window card's session total renders, is the reference (`{ usageSupport, summary, provider }` → `null` / `hostUpgradeRequired` / `summary`, every branch in `turn-usage.test.ts`); `usage-stats/host-options.ts` applies the same three states across a list of hosts.

A descriptive `server_info` field that is not a gate (`hostPlatform`, the daemon's `process.platform`) is an optional plain `z.string()` on `ServerInfoStatusPayloadSchema`, not an enum, so an old app parses a value it has never seen. The app keeps it in `DaemonServerInfo`, typed as `ServerInfoStatusPayload["hostPlatform"]`. Copying it takes four edits, and missing one fails silently: both copy sites in `contexts/session-context.tsx` (the cached `getLastServerInfoMessage()` and the `status` feed), the merge in `updateSessionServerInfo`, and the comparison in `isSessionServerInfoUnchanged`. Leave the comparison out and a message that changes only this field is treated as a no-op, so the store keeps the old value. A missing field means "unknown": the reader degrades instead of branching on the daemon version. The Install and upgrade section, for example, opens on the first install method (`selectDefaultMethod` in `provider-install-guide/internal/model.ts`). The field can also arrive after the first render, so a default derived from it is not copied into `useState`: the surface stores only what the user picked (`pickedMethodId`) and falls back to the resolver's `defaultMethod` until they pick (`selectShownMethod` in `provider-install-guide/index.tsx`).

**A response flag that explains an empty list is believed only behind its feature flag.** `usage.list_reports` answers `cliSignInsOff: true` when the host's Read CLI sign-ins switch is off. `listReports` in `usage/queries.ts` stores the flag in its own query (`cliSignInsOffQueryKey`) beside the reports, ANDed with `selectHostFeature(..., "readCliSignIns")` under one `COMPAT(readCliSignIns)` tag, so the modal and the Usage page read one answer and the report data shape stays upstream's. A non-empty list wins over the flag. Surfaces that only hide plan usage (sidebar summary, context strip, context details) need nothing: the daemon already answers empty. Toggling the switch invalidates the usage query (`host-privacy-section.tsx`), otherwise the "off" notice stays after turning it back on.

**A link into a section of a settings page uses `?focus=`.** `buildSettingsHostPrivacyRoute` (`utils/host-routes.ts`) appends `?focus=privacy`; the section reads `useLocalSearchParams`, waits until its config has loaded, and calls `revealInScrollContainer` (`provider-detail/reveal`) in a `requestAnimationFrame`. Revealing before the config loads scrolls to a section whose height is still changing. Reuse this shape for the next section deep link instead of adding an anchor system.

**A one-shot action across several hosts reports who was left out.** The Usage page's list views (`usage-stats/aggregated-requests.ts`, `aggregated-sessions.ts`, `aggregated-usage.ts`) ask online hosts only and show whatever answers. An action that produces something the user keeps — the Requests CSV export (`usage-stats/requests-export.ts`) — does the same, but must name every host it didn't include, offline or errored, next to the control until dismissed or re-run, and fails only when no host answered. Silently dropping offline hosts while failing on an errored one hands over a file with missing rows and no hint (user decision, gateway-ledger-usage ticket 06).

**A feature flag says the daemon can answer, not that it has an answer for this object.** `usage.agent.get` / `usage.agent.turns.list` report `complete: false` and zero rows forever for an agent whose CLI the scanner never reads — a mock agent, OpenCode, Copilot — because "not finished scanning" and "nothing to scan" are the same field. A placeholder or an empty state keyed on `complete` alone therefore becomes permanent furniture on those agents, and zeroes read as "you spent nothing", which is not what the daemon said. Separate the two cases on the client: `usage-stats/sources.ts` `isUsageTrackedProvider` says whether this agent's provider produces rows at all, so an empty report from one of the four scanned CLIs shows the section marked incomplete while an empty report from anything else shows nothing. Where no provider is in hand, fall back to evidence that rows exist (`usage-stats/turn-usage.ts`: `isTurnUsagePending` wants a row already, `hasAgentUsage` wants a turn or a first timestamp).

## Anti-patterns

- `useState` + `useEffect` + `isLoading` + `error` for fetched data.
- A raw `useQuery` with its own `staleTime`, bypassing `data/query.ts`.
- A hook that returns a new object or array every render to a consumer that memoizes.
- Reading `server_info.features` in several components instead of once in the host-features boundary.
