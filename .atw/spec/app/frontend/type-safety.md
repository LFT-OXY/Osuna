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

## Props

- 3+ props with any boolean or optional → a named props interface, not positional args to a helper.
- Name multi-property shapes; no inline `Array<{ … }>` in signatures.
- Static literals passed across `memo` boundaries are module-scope `as const`.

## Anti-patterns

- `as Agent` on a partially built object in a test; build the full object with a `makeAgent(overrides)` helper.
- `Partial<State>` spread into a store to skip fields.
- `string` for `provider`, `status`, or `phase`.
- Optional fields added to a type to avoid updating callers.
