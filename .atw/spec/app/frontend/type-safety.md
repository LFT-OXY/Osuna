# Type Safety

TypeScript is strict and `typecheck` runs `tsgo --noEmit` for the package. The rules from `docs/coding-standards.md` "Types" apply unchanged: no `any`, no `as` to silence errors, no `@ts-ignore`, one canonical type per concept.

## Where types come from

| Concept                   | Source                                                                                                | Do not                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Anything on the wire      | `@getpaseo/protocol/*` subpaths (`agent-lifecycle`, `messages`, `workspace-labels`, `forge-manifest`) | Redeclare a wire shape locally                |
| Client API                | `@getpaseo/client/internal/daemon-client` (`DaemonClient`)                                            | Type the client as `any` in tests             |
| Stream and timeline items | `types/stream.ts`, `types/shared.ts`, `types/agent-directory.ts`                                      | Add a parallel `StreamItem`-like union        |
| Store state               | The `interface … State` next to `create<State>()`                                                     | Export `ReturnType<typeof useStore.getState>` |
| Composer attachments      | `attachments/types.ts`                                                                                | Inline `{ id: string; mimeType: string }`     |

If a Zod schema exists (protocol, persisted settings, plugin manifests), the type is `z.infer<typeof Schema>`. A slice of a wire message is derived, not retyped: `Pick<FetchRecentProviderSessionsResponseMessage["payload"], "entries" | "providerErrors">` for a sub-object, `NonNullable<Payload["providerErrors"]>[number]` for an element of an optional array (`session-history/internal/model.ts`). A hand-written `interface { provider: string; message: string }` that mirrors the schema drifts the day the schema gains a field.

## Model states, not flags

- Load state is a discriminated union (`{ status: "loading" } | { status: "ready"; data } | { status: "error"; error }`), never `{ isLoading; error?; data? }`. `docs/forms.md` "Data gating" and the schedules screen state module (`screens/schedules-screen-state.ts`) are references.
- An agent's turn is `{ phase: "idle" | … }` on the `Agent` type; branch on `phase`, do not add booleans beside it.
- A value that is one of a known set is a string-literal union (`CommandCenterScope = "files" | null` in `stores/keyboard-shortcuts-store.ts`).
- Intentionally empty is `null`, not `undefined`. The seeded `Agent` in `hooks/use-archive-agent.test.ts` shows the full shape with explicit nulls.

## Boundaries

Validate at the edges: the socket (protocol schemas), AsyncStorage / IndexedDB / SQLite rows (`runtime/replica-cache` parses and drops invalid rows), pasted or picked files (`hooks/picked-image-normalizer.ts`), deep links (`@getpaseo/protocol/agent-deep-link`). After the parse, no `?.` on fields the type guarantees.

Platform capability is also a type boundary: `constants/platform.ts` exports `isWeb`, `isNative`, `isDev`, `getIsElectron()`. Inside an `isWeb` block, DOM types are fine; outside it, casting a RN ref to `HTMLElement` is the red flag reviewers look for.

## Scenario: desktop app update (`check_app_update` / `download_app_update` / `cancel_app_update_download` / `install_app_update`)

1. **Scope.** Cross-layer IPC contract between `packages/desktop/src/features/app-update-service.ts` (producer) and `packages/app/src/desktop/updates/` (consumer). Changing either side means changing both. Main and renderer ship in one desktop build, so no `COMPAT` shim.
2. **Signatures.** Renderer (`desktop-updates.ts`): `checkDesktopAppUpdate({ intent }) → { …, state }`, `downloadDesktopAppUpdate() → DesktopAppUpdateState`, `cancelDesktopAppUpdateDownload() → DesktopAppUpdateState`, `installDesktopAppUpdate() → DesktopAppUpdateInstallResult`, `subscribeToDesktopAppUpdateState(listener)` on `paseo:event:app-update-state`. Main service: `checkForAppUpdate`, `downloadUpdate()`, `cancelDownload()`, `switchReleaseChannel({ currentVersion, releaseChannel })`, `installUpdate({ currentVersion }, onBeforeQuit)`, `installUpdateOnQuit`; runtime `downloadUpdate(targetVersion, signal: AbortSignal)` (the Electron runtime turns the signal into a `CancellationToken`); deps `createInstallHandoffDeadline(): AbortSignal` (60 s), `installsOnQuit`, `publishState(state)`. `createDaemonCommandHandlers({ appUpdates })` takes the update commands as a port (`AppUpdateCommands`, production `electronAppUpdateCommands`).
3. **Contract.** The main process owns the phase; the renderer mirrors it.
   ```ts
   type AppUpdateState = {
     revision: number; // bumped on every change; the renderer drops a lower revision
     phase: "none" | "available" | "downloading" | "downloaded" | "installing" | "failed";
     targetVersion: string | null;
     failure: { action: "download"; message } | ({ action: "install" } & InstallFailure) | null;
     progress: { percent; transferred; total; bytesPerSecond } | null; // percent 0–100; only while downloading
     installsOnQuit: boolean; // false on Linux AppImage
   };
   type InstallFailure = { reason: "handoff-timeout" } | { reason: "updater-error"; message: string };
   ```
   `autoDownload` is off: a check never downloads. `install` runs only for the downloaded target and otherwise returns `installed: false, failure: null` without starting a download. `installed: true` is returned only after Electron's `before-quit-for-update`. The renderer parses the state once at the boundary (`parseDesktopAppUpdateState`); a check result with a malformed `state` throws, a malformed push is dropped, and a `progress` missing any finite number field parses as `null`. `progress` is reset when a download starts, forwarded from electron-updater's `download-progress` without extra throttling (each event bumps `revision`), and progress events outside a download are dropped.

   The release channel belongs to the main process. `check_app_update` reads it from the saved desktop settings; the renderer does not send one, because renderer settings are optimistic and not synced across windows, so another window may still hold the old channel. Saving settings (`patch_desktop_settings` → `onPatched`) calls `switchReleaseChannel`: if the channel changed and nothing is installing, it cancels a running download, clears the update state, adopts the channel, and runs an automatic check on the new channel that publishes to every window. Cancel, download and channel switch share the check queue, so a cancel issued after a download request always cancels that download, and a new download waits until the cancelled one has settled (electron-updater hands back its in-flight promise otherwise).
4. **Error matrix.** Download rejection or updater `error` while downloading → `failed` / `download`. Updater `error` before the install handoff → `failed` / `install` / `updater-error` with the raw message (Squirrel.Mac signature errors). No handoff before the deadline → `handoff-timeout`, translated in the renderer (`desktop.updates.installTimedOut`). A manual check clears a failure for the same version; an automatic check keeps it. While downloading or installing, a check returns the current state without querying the feed. Cancelling is not a failure: the phase goes back to `available` at once, the rejected download (electron-updater rejects with `CancellationError` and emits no `error` event) is ignored because its signal is aborted, and `failure` stays `null`. A cancel that arrives after the package finished downloading lands in `downloaded`. A channel switch during `installing` is ignored. The silent quit-time path (`installUpdateOnQuit`, `restart: false`) rechecks, installs only a version that is already downloaded, never downloads, and does not wait for a handoff (MacUpdater's no-relaunch path never emits it).
5. **Cases.** Renderer status: `available` / `downloading` / `downloaded` / `installing` follow the phase; `failed` + `install` → `install-failed` (Retry reinstalls, Releases entry via `openDesktopReleasesPage`); `failed` + `download` → `error`. A command in flight shows its phase before the push arrives (`pendingAction`). A failed manual check shows `error` only while nothing is actionable (`none` / `available`); once an update is downloading, downloaded, or installing, the status keeps the phase and the message shows beside it, so the Install entry stays reachable. A thrown download/cancel/install command (`actionError`) shows `error` until the next action, a non-silent check, or a change of the mirrored phase (a failed cancel leaves the download running; once it lands in `downloaded` the stale error is dropped). While the cancel command is in flight the snapshot sets `isCancellingDownload` and the card shows a disabled "Cancelling..." button. On install failure the main process restarts the daemon it stopped for the update (`daemon-manager.ts`). A Squirrel success after the timeout still restarts the app while the UI says failed.
6. **Tests.** `app-update-service.test.ts` (check does not download, download phases and broadcast, cancel back to `available` without failure, redownload after cancel, cancel queued behind a check, channel switch cancels/clears/rechecks, stale-channel check does not cancel, install refused when not downloaded, handoff outcomes, quit-time install only for the downloaded version); `daemon-manager.test.ts` (check uses the saved channel, settings save switches the channel, via a fake `appUpdates` port); `desktop-app-updater.test.ts` (mirroring, revision ordering, pending actions including cancelling, stale command errors, hide rules); `resolve-update-callout.test.ts` (per-stage descriptor, Cancel / Cancelling..., progress label and floor-rounded percent); `desktop-updates.test.ts` (state parsing); `packages/desktop/e2e/updates.spec.ts` drives progress through `reportUpdateDownloadProgress` in the fake bridge and covers cancel success and a failing cancel (`failUpdateAction: "cancel"`).
7. **Wrong vs correct.** Wrong: return `{ installed: true }` right after `quitAndInstall()`, keep a renderer-only copy of the phase, let `install` fall back to downloading, or treat "the check's channel differs from the configured one" as a channel switch (a window with stale settings would cancel another window's download). Correct: wait for the handoff, derive the renderer status from the mirrored state, make download an explicit user action, and switch channels only from the settings write.

## Props

- 3+ props with any boolean or optional → a named props interface, not positional args to a helper.
- Name multi-property shapes; no inline `Array<{ … }>` in signatures.
- Static literals passed across `memo` boundaries are module-scope `as const`.

## Anti-patterns

- `as Agent` on a partially built object in a test; build the full object with a `makeAgent(overrides)` helper.
- `Partial<State>` spread into a store to skip fields.
- `string` for `provider`, `status`, or `phase`.
- Optional fields added to a type to avoid updating callers.
