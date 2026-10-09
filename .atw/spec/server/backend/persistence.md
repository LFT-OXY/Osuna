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

### Adding a field that records host state at creation

`apiEndpointId` on the agent record (api-endpoint ticket 08) records the API
endpoint active when the session was created. Unlike `providerSessionIds` it is
set once and never updated.

- **Absent is a real value.** Missing means Official for old and new records alike, so an Official session writes nothing; no `null`, no backfill.
- **Every path that rebuilds a `ManagedAgent` carries it:** `registerSession` options (create, import, resume, reload), `dispatchStoredAgentState` for closed records, and `toStoredAgentRecord`. A path that forgets it silently turns the session into "Official" on the next persist.
- The resume comparison and the notice it produces are in [RPC and Protocol](./rpc-and-protocol.md#scenario-a-one-off-timeline-notice-the-daemon-adds-on-resume).

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
### Cache files: unreadable means empty, never "start the source"

`CommandCatalog` (`server/agent/command-catalog.ts`, file
`$OSUNA_HOME/command-catalog.json`) holds data the daemon can rebuild: the
command list a provider process last reported, per provider and `path.resolve`d
cwd. That makes it the one kind of store where a failed read is harmless — a
missing, corrupt, or schema-invalid file loads as an empty map and is rewritten
on the next report. It is not the cursor case above: nothing downstream
accumulates from it.

- Load once, lazily; memoize the in-flight load so concurrent first calls share
  one read.
- Parse on read **and** `CatalogFileSchema.parse(snapshot)` before
  `writeJsonFileAtomic`; serialize writes through one promise chain.
- Skip the write when the new value equals the stored one. `lookup` runs on
  every menu open for a running agent.
- Cap the entry count (200, least recently reported dropped); cwds are
  unbounded across worktrees.
- An empty cache must degrade to "partial", never to fetching from the source:
  `docs/adr/0003-command-list-never-spawns.md`.

Tests: `agent-manager.test.ts` "listCommands …" — a second `AgentManager` on the
same `commandCatalogPath` reads the entry back (daemon restart), and a
`"{ not json"` file yields `partial: true`.

### Renaming something already on disk

A rename of a file name, directory name, JSON key, label key, or string prefix
that the daemon has ever persisted is a data migration, even when the rename is
mechanical. The 1.0.0 rename from the upstream spelling changed nine such
identifiers and only the directory move had a ticket; the rest surfaced in
review as "old worktrees lost their base ref" and "tool restrictions in
`config.json` silently stopped applying".

- Read the new name first. Fall back to the old name only when the new one is
  absent. Write the new name only. Never rewrite or delete what the old version
  wrote: a rollback to that version must still find its data.
- Tag every fallback with the migration's `COMPAT` tag, written in full on the
  line above it. `findStoredMetadataPath` in `utils/worktree-metadata.ts` is the
  shape for a file path; `persisted-config.ts` has the shape for a JSON key.
- A persisted default is not a default. `config.json` stores the values the
  first launch resolved, so changing a default in code does not reach upgraded
  users. Treat the old default as unset on load; `persisted-config.ts` does this
  for the web app base URL.
- A file that is read in whole by one module (a migration, its tests) goes in
  `MIGRATION_FILES` in `scripts/rename-guard.mjs` **and** carries the tag on its
  first line. A first-line tag alone exempts nothing; the guard treats it as a
  tagged block. Prose that must name the old spelling is registered in
  `DOC_PASSAGE_EXCEPTIONS` by heading or by exact sentence, because a tag in
  Markdown renders on the website.

Before renaming, list what the old name is written into: `rg` the old literal
across `packages/server/src`, `packages/protocol/src` and
`packages/desktop/src`, and for each hit ask whether an installed copy has
already put that string on disk or on the wire.

### Gotcha: anything that resolves the default home moves the old one

`migrateLegacyHomeIfDefault` (`server/legacy-home-migration.ts`) runs in the
launcher, not in the daemon: the CLI `preAction` hook, `startDaemon()` in the
desktop app, and the supervisor entrypoint. A managed daemon always receives an
explicit `OSUNA_HOME` and its stderr is discarded, so it could neither detect
the default case nor report a failure.

It runs before every CLI command, including ones that target a remote host,
because those write `cli-client-id` into the default home and an empty new home
makes the move skip forever.

The consequence for development: any process started from this repo without
`OSUNA_HOME` or `--home` renames the developer's real 0.14.x data directory.
See [Testing](./testing.md) for the isolation every test must have.

## Files and secrets

- Keypairs and other private files go through `server/private-files.ts` (mode `0600`).
- `osuna.pid` is a lock and endpoint record owned by the supervisor; read it, never write it from a feature (`docs/architecture.md` "Storage").
- Temporary directories in tests come from `mkdtemp` and are removed in `afterEach`; the harness in `server/test-utils/osuna-daemon.ts` does this for you.

## Scenario: rewriting a config file another program owns

Reference implementation: API endpoints (api-endpoint tickets 01–02, conflict guard and health in 06). `server/api-endpoints/` rewrites Claude Code's `settings.json` and Codex's `config.toml` so the CLI itself switches to a third-party endpoint. The rules are in `docs/adr/0004-api-endpoint-rewrites-cli-config.md`; this is how the code keeps them.

### 1. Scope / Trigger

- The daemon writes a file that the CLI, the user, other tools, and Osuna's own terminal hooks also write. Anything outside the keys the daemon owns is someone else's data, including formatting and permission bits.

### 2. Signatures

- Pure patch: `applyClaudeApiEndpoint({ text: string | null, env, takeover }) → { kind: "patched", text, takeover } | { kind: "unparsable", message }` and `restoreClaudeOfficial({ text, takeover }) → patched | { kind: "delete" } | { kind: "missing" } | unparsable` in `claude-settings-patch.ts`. No I/O.
- Store: `ApiEndpointStore` (`store.ts`): endpoints, keys, `readClaudeTakeover` / `writeClaudeTakeover`, `writeClaudeSettingsBackup(bytes, at)`.
- Service: `ApiEndpointService` (`service.ts`) resolves the path (`resolveAgentHookConfigPath(claudeAgentHookProvider, { env, homeDir })`, so `CLAUDE_CONFIG_DIR` wins), serializes every mutation through one promise queue, and does the file I/O.
- Codex pure patch (`codex-config-patch.ts`): `applyCodexApiEndpoint({ text, model, table, takeover }) → patched { text, takeover } | unparsable`, `restoreCodexOfficial({ text, takeover })`, `replaceCodexProviderTable({ text, table })`, `removeCodexProviderTable({ text })`, the last three → `patched | missing | unparsable`. `buildCodexAuthCommand({ platform, keyFilePath, systemRoot? }) → { command, args, timeoutMs }` in `codex-auth-command.ts`.
- Codex path: `resolveCodexConfigPath()` takes the directory of the Codex hooks installer path (`CODEX_HOME` wins) plus `config.toml`.
- Guarded write (`config-file.ts`): `writeConfigFileGuarded<T>({ filePath, compute(current: Buffer | null) → { change: write{text} | delete | keep, value: T }, commit(value), rollback(), beforeRecheck? }) → { kind: "written", value } | { kind: "conflict" }`. The service wraps it as `writeConfigFile`, passes `compute(text, bytes)`, and turns `conflict` into `ApiEndpointRequestError("config_conflict")`. Every write and restore of `settings.json` / `config.toml` goes through it.
- Inspect (pure, for health): `inspectClaudeSettings({ text, takeover }) → { kind: "parsed", modifiedKeys, baseUrl } | unparsable`; `inspectCodexConfig({ text, takeover, table }) → { kind: "parsed", modifiedKeys, profileOverride: { profile, keys } | null, baseUrl } | unparsable`. `takeover`/`table` are null in Official.
- Injection: `OsunaDaemonConfig.apiEndpoints: { env?, homeDir?, beforeConfigRecheck? }`. `beforeConfigRecheck` is a test seam only: the daemon tests write the file from it to simulate another tool. `createTestOsunaDaemon` defaults it to a temp `CLAUDE_CONFIG_DIR` and `CODEX_HOME`, so no test daemon can touch the real `~/.claude` or `~/.codex`. `ApiEndpointServiceOptions.providerRuntimeSettings(provider)` is required; bootstrap wires it to `providerSnapshotManager.getRuntimeSettings(provider)` and the service itself calls `probeCodexVersion(this.providerRuntimeSettings("codex"))`, so a test sets `providerOverrides.codex.command` to a fake binary.

### 3. Contracts

- The takeover record keeps each owned key's `original` (`{ present: false }` or `{ present: true, value }`) and `written`, plus `originalFile` (`absent` / `empty` with its text / `content`). Originals are taken from the first takeover only; switching endpoint A to B keeps them.
- Order of one guarded attempt: read bytes + sha256 → `compute` (throws `config_unparsable` before anything is written) → stage a temp file next to the target → `commit` (takeover record, first-write backup, Codex key file) → `beforeRecheck` → re-read and compare the hash → `rename` (or `rm` for `delete`). A changed hash calls `rollback` and recomputes on the new content; after three attempts the result is `conflict` and nothing is left changed. `commit` goes before the re-read so the gap between the check and the rename holds no other disk writes (ADR 0004: "re-read it just before the atomic rename"). The reverse order (file first, record second) loses the originals on a crash.
- `rollback` restores the previous takeover record and key bytes and deletes a backup made in that attempt, so a retried first write leaves exactly one backup.
- The backup is taken once per file lifetime: `backup: null` = never rewritten, `{ path: null }` = the file did not exist at the first write. Never back up a file the daemon already wrote.
- The CLI file is replaced atomically with its previous mode bits (new file: `0600`, because it now holds a token). `writePrivateFileAtomicSync` is wrong here: it forces `0600` on the file and `0700` on `~/.claude`.
- Codex: edit TOML by splicing text at `toml-eslint-parser` node ranges, never by re-serializing. `original` for a top-level key is `{ present: true, raw }`, the value's source text with its quotes. Every edit re-parses its output and checks the written values; failure is `unparsable`.
- Codex switch order: compute the patch (nothing written on `unparsable`) → commit writes `codex-api-key` then `takeover-codex.json` → re-read check → replace `config.toml`. A failed check or replace writes back the previous takeover record and the previous key bytes (or deletes the key file); `setActiveEndpointId` runs only after success.
- Delete of the active endpoint: restore Official and clear the active id, then remove the Codex table. If the second step fails (`config_conflict`), the endpoint stays, the mode stays Official, and `onActiveEndpointChanged` still fires (`finally`), so the snapshot matches.
- Health is read on `list` only, never by a watcher: owned keys vs `written` (Claude `env.*`, the WebSearch deny entry the daemon added; Codex `model_provider`, `model`, and every field of the dedicated table). Other keys never count.
- `providerTable.endpointId` outlives Official. Saving that endpoint while Official calls `replaceCodexProviderTable` and rewrites the key file; deleting it removes the table and the key file, and deletes `config.toml` when nothing is left and `backup.path === null`.

### 4. Validation & Error Matrix

- Not JSON, not an object, `env` not an object, `permissions.deny` not an array → `config_unparsable`, nothing written, active endpoint unchanged.
- File missing on switch → created. File missing on restore → nothing written (`missing`).
- Restore leaves `{}` and `originalFile` was `absent` → file deleted; `empty` → original bytes back.
- Codex: invalid TOML (1.0), `model` / `model_provider` not a string, `model_providers` not a table, or a result that would not parse (e.g. `model_providers` as an inline table) → `config_unparsable`, nothing written. `codex --version` below 0.118.0 or unparsable → `codex_version_unsupported`, nothing written. Codex binary missing → `unknown` with the launch error.
- Codex BOM: the parser rejects it, so each entry point strips a leading BOM and puts it back.
- The file changes between the hash and the rename three times running → `config_conflict`, nothing written, takeover and key file as before.

### 5. Good/Base/Bad Cases

- Good: canonical 2-space file with hooks and permissions; switch and back gives identical bytes.
- Base: a compact one-line `env` object receives a key; that line is re-indented (`jsonc-parser` formats the edited line).
- Bad: `JSON.stringify` of the parsed file (loses the user's formatting); deleting keys that were absent-but-empty (`""` is present, not absent).
- Codex good: `model = 'x'   # note` becomes `model = "relay/gpt"   # note` and comes back as `'x'`; the dedicated table stays after Official.
- Codex base: no top-level keys → inserted at the top of the file; removed byte-exact on Official.
- Codex bad: `@decimalturn/toml-patch` (drops the comment above a key it removes); `smol-toml` stringify (rewrites the whole file).

### 6. Tests Required

- `claude-settings-patch.test.ts`: exact expected text after apply; restore equals the input byte for byte; empty-string original; absent file → `delete`; user's `{\n}` kept; user-owned `"WebSearch"` survives; unparsable shapes.
- `daemon-e2e/api-endpoint-claude.e2e.test.ts`: create → activate → file → Official → file; key absent from every response and from `config.json`; `keys.json` mode `0600`; `settings.json` keeps `0644`; no backup when the file started absent.
- `codex-config-patch.test.ts`: exact text after apply; Official restores the top-level bytes and keeps the table; apply twice is identical; CRLF and BOM kept; inline `model_providers` refused; the dedicated id fails `ProviderOverridesSchema`.
- `codex-auth-command.test.ts`: executes the generated command with `execFile` and asserts stdout equals the key file exactly; this runs on the Windows server CI job.
- `claude-settings-patch.test.ts` also: only mapped tiers are written; a tier dropped on the next apply gets the user's own value back.
- `daemon-e2e/api-endpoint-codex.e2e.test.ts` (POSIX; fake `codex` shell script): `auth.json` byte-identical; version below 0.118.0 refused; unparsable refused with no key file; read-only `CODEX_HOME` keeps the previous mode and key.
- `config-file.test.ts`: one write commits before the replace; a change before the re-check recomputes on the new bytes; three changes → `conflict`, record rolled back, no temp file left; a file that appears mid-write is noticed.
- Daemon tests with `beforeConfigRecheck`: a one-time change keeps the other tool's key and leaves one backup; a file that keeps changing is `config_conflict` for switching and for Official, and the active id does not move; Codex conflict leaves no key file.

### 7. Wrong vs Correct

#### Wrong

```ts
const backupPath = record.backupPath ?? backUp(current); // null "file absent" re-triggers on the next write
writePrivateFileAtomicSync(settingsPath, text); // chmods the user's file and ~/.claude
```

```ts
const result = applyClaudeApiEndpoint({ text: readFile(settingsPath), env, takeover });
writeFile(settingsPath, result.text); // another tool's edit between the read and here is lost
```

#### Correct

```ts
this.writeConfigFile({
  filePath: settingsPath,
  compute: (text, current) => ({ change: { kind: "write", text: apply(text).text }, value: { current } }),
  commit: ({ current }) => {
    if (!record.backup) createdBackup = store.writeClaudeSettingsBackup(current, now());
    store.writeClaudeTakeover({ takeover, backup: record.backup ?? { path: createdBackup } });
  },
  rollback: () => { store.writeClaudeTakeover(record); /* and discard createdBackup */ },
});
```

## Anti-patterns

- `JSON.parse(raw) as StoredAgentRecord`. Parse with the schema.
- A service reading and writing the JSON file itself instead of calling the store.
- Adding a field to a persisted record without adding it to `docs/data-model.md`.
- Catching a parse error and returning a partially built record. Invalid rows are dropped or reported, not repaired silently.
- Renaming a persisted identifier with no fallback read. The schema drops the old key and the feature turns off with no error.
