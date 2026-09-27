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

## Scenario: desktop app update install (`install_app_update`)

1. **Scope.** Cross-layer IPC contract between `packages/desktop/src/features/app-update-service.ts` (producer) and `packages/app/src/desktop/updates/` (consumer). Changing either side means changing both.
2. **Signatures.** Renderer: `installDesktopAppUpdate({ releaseChannel }) → Promise<DesktopAppUpdateInstallResult>` (`desktop-updates.ts`). Main: `downloadAndInstallUpdate(input, onBeforeQuit)`; the service takes `createInstallHandoffDeadline(): AbortSignal` (60 s in `auto-updater.ts`) and the runtime reports `onBeforeQuitForUpdate()`.
3. **Contract.** A discriminated union, mirrored on both sides:
   ```ts
   type InstallFailure = { reason: "handoff-timeout" } | { reason: "updater-error"; message: string };
   type InstallResult =
     | { installed: true; version; message; failure: null }
     | { installed: false; version; message; failure: InstallFailure | null };
   ```
   `installed: true` is returned only after Electron's `before-quit-for-update`. `failure: null` with `installed: false` is a normal outcome (no update, deferred, superseded, dev mode), not an error. The renderer parses defensively; a missing `failure` is `null`.
4. **Error matrix.** Updater `error` event before the handoff → `updater-error` with the raw updater message (Squirrel.Mac signature errors land here). No handoff before the deadline → `handoff-timeout`, translated in the renderer (`desktop.updates.installTimedOut`). A failed recheck or download → `updater-error`. The silent quit-time path (`installUpdateOnQuit`, `restart: false`) does not wait for a handoff, because MacUpdater's no-relaunch path never emits it.
5. **Cases.** Good: handoff → renderer `installed`. Base: nothing to install → `up-to-date`. Bad: any `failure` → `install-failed` keeps `availableUpdate`, shows the reason and a Releases entry (`openDesktopReleasesPage`); the callout's Retry reinstalls; silent rechecks leave `install-failed` in place. On failure the main process restarts the daemon it stopped for the update (`daemon-manager.ts`). A Squirrel success after the timeout still restarts the app while the UI says failed; an unrelated updater error inside the window also fails the install.
6. **Tests.** `app-update-service.test.ts` "manual install handoff" (pending before handoff, restart after, updater error, timeout, concurrent requests); `desktop-app-updater.test.ts` (install-failed, localized timeout, silent recheck); `resolve-update-callout.test.ts` (Retry + Download actions).
7. **Wrong vs correct.** Wrong: return `{ installed: true }` right after `quitAndInstall()`, or map `installed: false` to `up-to-date`; both hide a rejected update. Correct: wait for the handoff and map `failure` to `install-failed`.

## Props

- 3+ props with any boolean or optional → a named props interface, not positional args to a helper.
- Name multi-property shapes; no inline `Array<{ … }>` in signatures.
- Static literals passed across `memo` boundaries are module-scope `as const`.

## Anti-patterns

- `as Agent` on a partially built object in a test; build the full object with a `makeAgent(overrides)` helper.
- `Partial<State>` spread into a store to skip fields.
- `string` for `provider`, `status`, or `phase`.
- Optional fields added to a type to avoid updating callers.
