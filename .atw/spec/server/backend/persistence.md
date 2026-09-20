# Persistence

There is no database. Daemon state is JSON files under `$OSUNA_HOME` (`~/.osuna` in production, `.dev/osuna-home` in this checkout). `docs/data-model.md` is the authority for every record, its schema, and the directory layout; keep it current when you add a file.

## The store shape

A store is a class that owns one file or one directory, parses with a Zod schema on every read and before every write, and exposes methods that answer a caller's question. Reference implementations:

| Store                     | File                            | Pattern it demonstrates                                                                                                          |
| ------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `AgentStorage`            | `server/agent/agent-storage.ts` | One JSON file per record under `agents/{sanitized-cwd}/{id}.json`; `list`, `get`, `listByWorkspace`, `upsert`, `remove`, `flush` |
| `WorkspaceRegistry`       | `server/workspace-registry.ts`  | One array file `projects/workspaces.json`; `this.schema.parse(record)` on every mutation path                                    |
| `DaemonConfigStore`       | `server/daemon-config-store.ts` | Mutable `config.json` with reload and change details                                                                             |
| `PersistedConfig` helpers | `server/persisted-config.ts`    | Read-merge-write with an optional logger for a config file                                                                       |

Rules the stores share:

- **Parse at the boundary, trust inside.** `parseStoredAgentRecord(value)` in `agent-storage.ts` is the only place an agent file becomes a `StoredAgentRecord`. After that the type is the truth; no `?.` on fields the schema guarantees.
- **The record type is `z.infer<typeof Schema>`.** `StoredAgentRecord = z.infer<typeof STORED_AGENT_SCHEMA>`. Never hand-write a parallel interface.
- **Writes are atomic.** Use `writeJsonFileAtomic` / `writeFileAtomic` from `server/atomic-file.ts`: temp file in the target directory, then rename. Do not `writeFile` a store file directly.
- **Store methods own atomicity.** If a caller would need a queue, lock, or read-merge-write loop, that belongs behind the store method (`docs/data-model.md` "Store Surface Rules"). `WorkspaceRegistry` stages updates and parses the changed set before committing; `workspace-labels` uses a journaled transaction file for compound commits.
- **Boundary returns answer the caller's question.** `listByWorkspace(workspaceId)` exists so callers do not repeat `list().filter(...)`.
- **No migrations framework.** Schemas accept old shapes with optional fields and defaults; a record that fails to parse is treated as invalid, not migrated in place. `server/workspace-registry-bootstrap-legacy.ts` is what a deliberate one-off upgrade looks like when one is unavoidable.

### Adding a field that records history the old records never kept

`providerSessionIds` on the agent record (usage ticket 07, v0.8.2) is the shape:
a list of every provider session an agent has run in, where the old records hold
only the last handle. Three rules make it safe without a migration.

- **One write point.** Every place that refreshed `agent.persistence` now goes
  through `applyPersistenceHandle` in `server/agent/agent-manager.ts`, which sets
  the handle and appends its id. Five assignment sites meant five chances for the
  list to miss an id; one function means the list is exactly the ids the agent ran
  in.
- **Read the fallback through one exported function.** `restoreProviderSessionIds`
  in `agent-storage.ts` derives `[persistence.sessionId]` when the field is
  absent, and both consumers — the manager restoring an agent and the usage
  bridge reading a record off disk — call it. A second inline `?? [handle]` is
  where the two answers start to diverge.
- **Never write the derived value back.** The record stays as it was until
  something real changes it; a read-time backfill would rewrite every file in
  `$OSUNA_HOME` on the first start after an upgrade.

Add the field to `docs/data-model.md` in the same change, including the sentence
that says what readers do when it is missing.

### Gotcha: a cursor file that fails to parse replays everything

`UsageStore.loadScanState()` drops the whole file and returns an empty state when
the Zod parse fails — `server/usage/store.ts`. That is the right call for a
cursor, but usage bucket rows are **increments**, so a rescan from offset 0
appends a second copy of every row already on disk and the report doubles.

The consequence for `USAGE_PARSER_STATE_SCHEMA` (`server/usage/types.ts`): a new
variant in the discriminated union is safe, a **new required field on an existing
variant is not** — every cursor written by the previous daemon version fails the
parse at once. Give new fields a default, or accept them as optional and fill
them in the parser.

### Gotcha: the cursor moves even when a derived row was dropped

A scan cursor records _bytes consumed_, not _rows produced_. So any row derived
from those bytes that can fail to be produced is lost for good the moment the
cursor advances — the lines are never read again.

`UsageService` hits this with turn rows: a Pi/OMP subagent names no turn, so its
rows are matched against the parent session's turn spans, and a scan that lands
while the parent turn is still open finds a span too short. Dropping the misses
looked correct (the spec allows unattached tokens to stay in the bucket rows)
but made it the _normal_ outcome for live sessions rather than an edge case.

Two rules follow for anything shaped like this:

- **Order the work so the dependency is read first.** `runRound` sorts every
  main-thread file ahead of every subagent file, rather than trusting the root
  order or mtime.
- **Buffer the misses in memory and retry them, with an explicit give-up
  condition.** `retryPendingTurnRows` retries at the end of each round and lets
  a draft go only when its turn provably cannot still grow — a later turn has
  begun — or after a generous TTL that only guards against a leak.

The buffer is memory only, so state it in the docs: a restart inside the window
loses those rows. That is a deliberate trade against persisting a second
unresolved-row file.

### Wiring a runtime-safe `config.json` field

A field users can change while the daemon runs needs five edits, and missing any one of them fails quietly rather than loudly (`features.usage.pricing.*` is the worked example):

1. `PersistedConfigSchema` in `server/persisted-config.ts` — the file shape. It is `.strict()`, so an unknown key makes the whole config unreadable.
2. `MutableDaemonConfigSchema` in `packages/protocol/src/messages.ts` — the live shape, and a **separate** patch shape in `MutableDaemonConfigPatchSchema`. A `.default()` in the patch shape resurrects the default whenever someone edits a sibling field: patch `{ overrides }` and a defaulted `autoUpdate: true` rides along and switches auto-update back on. Defaults belong to the full schema only.
3. `RELOADABLE_PATHS` **and** `PERSISTED_TO_MUTABLE_PATH` in `server/daemon-config-store.ts` — without both, `osuna reload` reports the path as restart-required.
4. A merge branch that writes the patch back into the persisted file. `mergeMutableDaemonPatch` covers `daemon.*` and `mergeMutableAgentPatch` covers `agents.*`; a field under `features.*` needs its own.
5. Startup resolution in `server/config.ts`, plus the env override's path in `resolveOverrideControlledPaths` so the UI can tell the user why their edit will not stick.

`deepMerge` already replaces arrays wholesale (`isRecord` excludes them), so a patch that swaps a whole list needs no special case — writing one adds dead code.

Owners read the live value through one resolver rather than repeating `?? default` at each call site; `resolveUsagePricingSettings` in `server/usage/config.ts` is the shape.

### Config values this fork ships with no default

`daemon.relay.endpoint` (`OSUNA_RELAY_ENDPOINT`) and `app.baseUrl` (`OSUNA_APP_BASE_URL`) both resolve to `null` when unset — see `resolveRelayConfig` and `resolveStaticLoadConfigSettings` in `server/config.ts`. The fork hosts neither a relay nor a web app, so there is nothing to fall back to, and pointing at a domain nobody owns is harder to diagnose than an empty value.

Three consequences that are not visible from the field declarations:

- **`generateLocalPairingOffer` returns `url: null` when either is unset.** It reports which one through `unavailableReason`, so callers name the missing setting instead of printing one message for every way pairing can fail. Any fixture that asserts on a pairing link has to configure both — see [Testing](./testing.md).
- **Offline pairing ignores the process environment.** `resolveLocalPairingOffer` in `packages/cli/src/commands/daemon/pair.ts` passes `{ env: {} }` to `resolveConfigFromPersisted`, so user-facing copy has to lead with `osuna daemon config set <path> <value>`; telling the user to export an env var is advice that does nothing on that path.
- **`daemon.relay.endpoint` is restart-required, not reloadable.** It is absent from `RELOADABLE_PATHS`, so `osuna daemon reload` warns and changes nothing. A running daemon that still has no pairing link after both values are saved needs a restart, and that is a distinct state worth its own message.

## Files and secrets

- Keypairs and other private files go through `server/private-files.ts` (mode `0600`).
- `osuna.pid` is a lock and endpoint record owned by the supervisor; read it, never write it from a feature (`docs/architecture.md` "Storage"). `acquirePidLock` additionally reads the pre-rename `paseo.pid` once, behind the tagged `COMPAT(pid-lock-paseo-name)` shim: a live lock under the old name counts as "an instance is already running". That read is the one place where being unable to read a lock must not be collapsed into "no lock" — `readPidLock` returns `null` only for ENOENT and throws for everything else, and the throw has to propagate, because a lock you cannot read is not proof that no daemon holds it. Never write, migrate, or delete the old file.
- Temporary directories in tests come from `mkdtemp` and are removed in `afterEach`; the harness in `server/test-utils/paseo-daemon.ts` does this for you.

## Anti-patterns

- `JSON.parse(raw) as StoredAgentRecord`. Parse with the schema.
- A service reading and writing the JSON file itself instead of calling the store.
- Adding a field to a persisted record without adding it to `docs/data-model.md`.
- Catching a parse error and returning a partially built record. Invalid rows are dropped or reported, not repaired silently.
