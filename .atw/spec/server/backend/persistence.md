# Persistence

There is no database. Daemon state is JSON files under `$PASEO_HOME` (`~/.paseo` in production, `.dev/paseo-home` in this checkout). `docs/data-model.md` is the authority for every record, its schema, and the directory layout; keep it current when you add a file.

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
  `$PASEO_HOME` on the first start after an upgrade.

Add the field to `docs/data-model.md` in the same change, including the sentence
that says what readers do when it is missing.

### Adding a field to a stored API endpoint

A save from an old client (the official Paseo app) omits every field it doesn't know, and it must not clear them (endpoint-management-ux ticket 02, prd 47). `buildEndpoint` in `server/api-endpoints/service.ts` starts from the stored endpoint and replaces only the fields the request carried, so a new field survives an old save with no extra code — **if** it is declared in `StoredApiEndpointSchema` (`store.ts`). That schema is a plain `z.object`: an undeclared key is stripped on read, so it is gone before `buildEndpoint` ever sees it. Each new field: optional in the store schema and in the wire schema, then add it to "a save in the old shape keeps the fields that client does not know" in `api-endpoint-host-wide.e2e.test.ts`: written, saved without it, still there. A field the request may resend with a different meaning (like `modelMapping`) goes in the destructure that drops it from `kept`.

### A file several writers update keeps the fields each write doesn't own

`api-endpoints/endpoint-snapshots.json` (id → last name, price multiplier, deleted) is written on every endpoint save and at startup. `recordEndpointSnapshots` (`api-endpoints/store.ts`) spreads the stored entry and overwrites only what it mirrors from the live endpoint (`name`, `priceMultiplier`) and `deleted`; a gone endpoint keeps its entry as stored, which is how a deleted endpoint stays priced at its last multiplier. A field a later writer adds must survive the same way. Cover it with a store test that renames, deletes and clears, and reads the file back (`api-endpoints/store.test.ts`).

### Removing a field from the agent record

`STORED_AGENT_SCHEMA` (`agent-storage.ts`) is a plain `z.object`, so a key it no longer declares is stripped on read and disappears on the next write. Removing a field needs no migration: drop it from the schema, from `ManagedAgentBase`, from `toStoredAgentRecord`, and from every `registerSession` caller. The daemon E2E for the removal writes the old key into a record file and checks the agent still resumes (`apiEndpointId`, removed in api-endpoint-auto-switch ticket 11; see [RPC and Protocol](./rpc-and-protocol.md#scenario-retiring-a-timeline-notice-the-daemon-used-to-add)).

### Bringing a stored agent back is not activity

Loading an agent's runtime is neither the agent working nor the user reading the
chat. A path that rebuilds a `ManagedAgent` from a stored record must leave the
record's last-updated time and its attention as they were (upstream #5040, merged
in `e9d32a17d`).

- **Pass `restoring: true` to `registerSession`** from any path that brings a known agent back. `resumeAgentFromPersistence` and `reloadAgentSession` do; create and import do not. Without it registration calls `touchUpdatedAt`, the stamp is persisted, and workspace `statusEnteredAt` is re-derived from persisted `updatedAt` on the next daemon start, so the sidebar's "last used" is rewritten permanently.
- **Carry attention in, do not let it default.** `ensureAgentLoaded` passes `{ ...extractTimestamps(record), attention: extractAttention(record) }`. A resume that omits `attention` starts with `{ requiresAttention: false }` and persists it: the chat drops out of Ready to review without the user opening it.
- **Read a record's last-updated time with `resolveStoredAgentUpdatedAt(record)`** (`persistence-hooks.ts`), never `record.updatedAt` or `record.lastActivityAt` alone. Renaming, labelling, unarchiving, marking unread, and clearing attention move `updatedAt` on an unloaded agent without touching `lastActivityAt`. A payload built from the older of the two is dropped by the client (`acceptAgentDirectoryUpdate` rejects state that goes backwards), which is how an unread dot gets stuck.
- Osuna's resume-by-handle path in `session.ts` resumes into a new id with no options. It has no stored timestamps or attention to carry, and `restoring: true` still applies to it through `resumeAgentFromPersistence`.
- Test: `agent-loading.test.ts` "resuming a stored agent keeps its unread flag and its last-activity time" asserts the stored record and the live agent after `ensureAgentLoaded`. A new resume path gets the same assertions.

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

### A statistic that must outlive pruned records lives as sums in bucket rows

Per-request records (`usage/requests/`) are pruned at 30 days / 200 MB, but the
"All" period still has to show output speed and time to first token. So the
15-minute bucket rows carry optional sums (`ttftCount`, `ttftMs`, `speedCount`,
`speedOutput`, `speedMs`), added when the ledger row lands and moved with the
tokens when it merges (`server/usage/call-merge.ts`); the report divides at read
time (`server/usage/speed.ts`). Store sums, never averages: sums add across
buckets, groups and hosts.

Rows written before the columns existed have none, and there is no migration to
backfill them. A merge must not subtract sums that were never added: gate the
correction on the source row carrying the field (the `speedOf` check). Say in
`docs/usage.md` which records the statistic starts from.

### Gotcha: compressing day files where a later record overrides an earlier one

`usage/requests/` keeps one file per UTC day; finished days become
`YYYY-MM-DD.jsonl.gz`, and lines appended afterwards land in a plain sibling
that the next prune folds in as a new gzip member (`server/usage/request-files.ts`,
ported from magpie `history.go`). Two rules that differ from a plain log:

- Read `.gz` first, then the plain sibling, as one day — records are applied in
  order and a later one wins, so the order is the contract.
- When folding, skip the plain segment only if the whole segment already sits
  at the end of the `.gz` (a crash after the rename, before the delete). Don't
  dedupe line by line as magpie does: a repeated line can be the later, winning
  version.

Prune counts compressed bytes against the 200 MB cap, and runs on the same
write queue as appends so nothing is compressed mid-write.

### Gotcha: a correction row must land in the same batch as the rows it corrects

Gateway ledger rows (`usage/requests/YYYY-MM-DD.jsonl`) are written the moment a
request ends, but the scan's transcript rows only reach disk on `flush` (every 20
files or 500ms). A correction derived from both — "move these tokens from no
project to this endpoint" — written eagerly next to the ledger row survives a
hard kill that the transcript rows it pairs with don't. The rescan then applies
the correction a second time: official and unknown-project go negative, the
endpoint counts twice. A graceful-stop restart test never sees this.

The rule, as `UsageCallMerge` (`server/usage/call-merge.ts`) does it:

- The eager write only adds what is true on its own: the ledger row counts under
  no project.
- The move happens in `settle()`, which `UsageService` calls inside the scan
  batch (`service.ts`, before `flush`), so the move, the transcript rows and a
  `{ kind: "merged" }` record land in one append.
- On load, a `merged` record marks the call settled; a ledger row without one
  goes back to the awaiting set and is settled by the next round.

Test it with a unit test that loads state from what was on disk at the kill
point and re-runs the scan (`call-merge.test.ts`), not only with a daemon
restart.

Changing how a parser names a reply id is a persistence change: records already
on disk keep the old id, and a full rescan (cursor reset when the file shrinks or
its inode changes) writes the same call again under the new one, so the Requests
list shows it twice. Carry the old name alongside the new one and drop the
unmatched old-name record on write and on load (`formerReplyId` / `dropFormer`,
`COMPAT(piReplyIdByResponseId)`, pi-omp-endpoints ticket 07, when Pi / OMP moved
to `responseId`).

### Wiring a runtime-safe `config.json` field

A field users can change while the daemon runs needs five edits, and missing any one of them fails quietly rather than loudly (`features.usage.pricing.*` is the worked example):

1. `PersistedConfigSchema` in `server/persisted-config.ts` — the file shape. It is `.strict()`, so an unknown key makes the whole config unreadable.
2. `MutableDaemonConfigSchema` in `packages/protocol/src/messages.ts` — the live shape, and a **separate** patch shape in `MutableDaemonConfigPatchSchema`. A `.default()` in the patch shape resurrects the default whenever someone edits a sibling field: patch `{ overrides }` and a defaulted `autoUpdate: true` rides along and switches auto-update back on. Defaults belong to the full schema only.
3. `RELOADABLE_PATHS` **and** `PERSISTED_TO_MUTABLE_PATH` in `server/daemon-config-store.ts` — without both, `paseo reload` reports the path as restart-required.
4. A merge branch that writes the patch back into the persisted file. `mergeMutableDaemonPatch` covers `daemon.*` and `mergeMutableAgentPatch` covers `agents.*`; a field under `features.*` needs its own.
5. Startup resolution in `server/config.ts`, plus the env override's path in `resolveOverrideControlledPaths` so the UI can tell the user why their edit will not stick.

`deepMerge` already replaces arrays wholesale (`isRecord` excludes them), so a patch that swaps a whole list needs no special case — writing one adds dead code.

Owners read the live value through one resolver rather than repeating `?? default` at each call site; `resolveUsagePricingSettings` in `server/usage/config.ts` is the shape.
### Cache files: unreadable means empty, never "start the source"

`CommandCatalog` (`server/agent/command-catalog.ts`, file
`$PASEO_HOME/command-catalog.json`) holds data the daemon can rebuild: the
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

`api-endpoints/balance-readings.json` (`LastBalanceReadings`, endpoint-balance
ticket 04) is the same kind of cache: unreadable means empty, a failed write
only warns. It holds no key: each entry carries a digest of the settings it was
read with and is dropped when they no longer match. Contract:
rpc-and-protocol.md, "the last balance reading".

`usage/exchange-rate.json` (`UsageExchangeRates`, `server/usage/exchange-rate.ts`,
gateway-ledger-usage ticket 10) caches a value fetched from the network. The RPC
never waits on that fetch: it answers at once with the cached rate (or the
documented default 7.2, flagged), and a stale cache kicks one background fetch
guarded by an in-flight lock, honouring the refetch interval, the failure
back-off and the auto-update switch. When the new value lands the daemon emits
`usage.pricing.updated` and clients re-read. `dispose()` awaits the in-flight
fetch and then stops writing. This is magpie's `fx.Soon`; a request that blocks
for the 15-second timeout shows the user stale defaults for no reason.

`api-endpoints/cooldowns.json` (`EndpointCooldowns`, gateway-ledger-usage
ticket 07) is a cache too: losing it costs one more failed request to that
endpoint, never a wrong state, so no `.bak`. Two rules beyond the list above:

- Persist the outcome, not the counter. Each rest's `until`, class and the
  redacted upstream text are stored; the consecutive-failure count that drives
  rate-limit doubling is stripped on save and restored as 0, so backoff starts
  over after a restart (`failures > 0` gates the doubling in `rateRest`).
- Derive the TS unions from the Zod enums the file uses (`RestBySchema`,
  `RestWhySchema` in `gateway/cooldown.ts`). A hand-written parallel union lets a
  new value compile, then makes the write-side `parse` throw and the next read
  drop the whole file.

### State files keep a last good copy (`.bak` / `.bad-<time>`)

`LastGoodFile<T>` (`server/api-endpoints/last-good.ts`, magpie `lastgood` /
`steady`, gateway-robustness ticket 12) guards the three files only the daemon
writes and can't rebuild: `api-endpoints/endpoints.json`, `keys.json` and
`gateway-tokens.json`. The takeover records and the CLIs' own config files keep
"can't parse → don't write" (scenario below).

- Write: a parseable current file is first copied to `<file>.bak`; a current
  file that is already bad is moved aside as `<file>.bad-<time>` (magpie
  `Keep`), then the new content goes through `writePrivateFileAtomicSync`.
- Read a bad file with a good `.bak`: move the bad one aside, put the `.bak`
  bytes back as the file, serve that, one `warn` `{ filePath, why, badPath }`.
  `why` is `BadFileReason` (`empty`, `zero_bytes`, `not_json`,
  `schema_mismatch`) — never the parse error text, which quotes file bytes and
  `keys.json` holds keys. The aside and put-back are best-effort: if either
  fails, warn and still serve the `.bak` value. Served data may be one write
  behind, same as magpie.
- Bad file and bad or missing `.bak`: throw as before
  (`ApiEndpointsFileUnparsableError` for endpoints) and write, move or delete
  nothing.
- Deleting the token file deletes its `.bak` too, so a deleted token can't come
  back through a later fallback. Since cli-wiring-web-search ticket 02 tokens are
  never revoked (ADR 0010); the file is removed only when it would be empty.
- Windows locks: reads and renames retry every 10 ms for up to 0.5 s on any
  error except ENOENT, through the replaceable `DataFileSystem` adapter
  (`NODE_DATA_FILE_SYSTEM` in production, a fake in `last-good.test.ts`). No
  cross-process lock: only the daemon writes these files.
- Not done: fsync before rename (magpie does it for its zero-byte-after-power-loss
  bug #1505).

Tests: `last-good.test.ts` (busy read/rename retried then succeeds, held past
0.5 s throws, put-back failing still serves `.bak`); gateway e2e — each of the
three files corrupted → requests still served, one `.bad-` file, one warn;
`.bak` also bad → error, directory unchanged; takeover record unchanged.

## Files and secrets

- Keypairs and other private files go through `server/private-files.ts` (mode `0600`).
- `paseo.pid` is a lock and endpoint record owned by the supervisor; read it, never write it from a feature (`docs/architecture.md` "Storage").
- Temporary directories in tests come from `mkdtemp` and are removed in `afterEach`; the harness in `server/test-utils/paseo-daemon.ts` does this for you.
- Files other apps own that the daemon only reads (Import, `api-endpoints/import-apps.ts`, ADR 0013): the daemon opens them read-only and never writes them. SQLite goes through `process.getBuiltinModule("node:sqlite")` with `{ readOnly: true }`; a reader still takes SQLite's shared lock, and a WAL database may get its `-wal`/`-shm` touched. A Node without `getBuiltinModule` or `node:sqlite` is a per-source `no_sqlite`, never a failed scan; on Node 22 only node:sqlite's ExperimentalWarning is dropped (`withoutSqliteExperimentalWarning`). Keys read from them stay in the daemon: the client gets `maskApiKey` and an HMAC fingerprint keyed by a random secret in `api-endpoints/import-fingerprint-key.json` (0600, created on first scan, a new one if it can't be parsed). The secret is persisted so a fingerprint is the same across restarts: `endpoints.json` `ignoredImports` (the prompt's Ignore, ticket 27) stores fingerprints and has to recognise them later. It covers the whole entry with its key (magpie `importFingerprint`), so a changed key is offered again, and without the secret a fingerprint can't be checked against a guessed key. `createTestPaseoDaemon` points `importSourcePaths` (CC Switch, Alma, OpenCode) at the temp root by default; Claude Code and Codex follow the daemon's `env`/`homeDir`. The e2e asserts a scan leaves the five files' mtimes and their directories' listings unchanged.

## Scenario: rewriting a config file another program owns

Reference implementation: API endpoints (api-endpoint tickets 01–02, conflict guard and health in 06; api-endpoint-auto-switch ticket 03 changed *what* is written, ticket 17 added `modelPicker`, ticket 18 the model hints). `server/api-endpoints/` rewrites Claude Code's `settings.json` and Codex's `config.toml` so the CLI talks to the daemon's own gateway (`/api-endpoint-gateway`) with a per-agent token; the real key is never written into a CLI config file and stays in the daemon's `keys.json` (mode `0600`), read back only through `provider.api_endpoint.reveal_key` (see `rpc-and-protocol.md`). The editing rules are in `docs/adr/0004-api-endpoint-rewrites-cli-config.md`, what the keys hold in ADR 0007; this is how the code keeps them. ADR 0012 (cli-wiring-web-search) replaces parts of both — JSONC `settings.json`, following the CLI's own saved model and thinking level, new owned keys, the kept claude.ai sign-in — and ADR 0010 changes what Codex gets under a ChatGPT sign-in; the scenarios below include those changes.

### 1. Scope / Trigger

- The daemon writes a file that the CLI, the user, other tools, and Osuna's own terminal hooks also write. Anything outside the keys the daemon owns is someone else's data, including formatting and permission bits.

### 2. Signatures

- Pure patch: `applyClaudeApiEndpoint({ text: string | null, wiring: { baseUrl, token, model, modelPicker: ClaudeModelPickerOption[], hintEnv: ClaudeHintEnv }, takeover }) → { kind: "patched", text, takeover } | { kind: "unparsable", message }` and `restoreClaudeOfficial({ text, takeover }) → patched | { kind: "delete" } | { kind: "missing" } | unparsable` in `claude-settings-patch.ts`. No I/O.
- Store: `ApiEndpointStore` (`store.ts`): `readState()` / `writeState(state)` for `endpoints.json` (see the next scenario), `getApiKey` / `setApiKey` / `removeApiKey`, `readClaudeTakeover` / `writeClaudeTakeover`, `writeClaudeSettingsBackup(bytes, at)`, `readGatewayTokens` / `writeGatewayTokens` (empty → file deleted), `codexModelCatalogPath` / `readCodexModelCatalog` / `writeCodexModelCatalog(text | null)`, `removeLegacyCodexKeyFile()`.
- Model hints (pure, `claude-model-hints.ts`, after magpie's `claude1M` / `claudeWindow` / `claudeOutput` / `claudeCaps`): `markOneMillion({ id, facts }) → id | id + "[1m]"`; `claudeHints({ start, tiers, subagent, listed, longConversations }) → { env: Partial<Record<"CLAUDE_CODE_MAX_CONTEXT_TOKENS" | "CLAUDE_CODE_MAX_OUTPUT_TOKENS" | "CLAUDE_CODE_MODEL_CAPABILITIES" | "CLAUDE_CODE_AUTO_COMPACT_WINDOW", string>>, compactYieldsToOwn }`. `ClaudeHintModel = { id /* as Claude Code sees it */, facts: EndpointModelFacts }`.
- Model facts (`model-facts.ts`, after magpie's `catalog.go`): `ModelFacts = { context?, output?, efforts?, images?, takesSampling?, thinks? }` (`thinks`: most models.dev providers say `reasoning: true` or give levels, magpie `catalog.Thinks`; daemon-only, never sent to clients; an older `models-dev.json` cache lacks it until the next refresh, so readers treat absent as "levels decide" — Pi's `reasoning` is `thinks || efforts.length > 0`, pi-omp-endpoints ticket 02); `indexModelsDev(apiJson) → ModelsDevIndex` (by bare lowercase id, the value most providers give, ties to the smaller / fewer levels, window = input limit else context, under 2048 = unknown); `lookupModelFacts(index, id)` (bare id, then without a `:suffix`; unknown → `{}`); `mergeModelFacts(listed, known)` per field, the endpoint's list first. `fetchUpstreamModels` returns `ListedModel = ApiEndpointModel & { facts? }` read from `max_input_tokens` / `context_length` / `context_window`, `max_output_tokens` / Anthropic's `max_tokens` (only next to `max_input_tokens`) / `top_provider.max_completion_tokens`, `supported_reasoning_levels` / `capabilities.effort.<level>.supported`.
- models.dev (`models-dev.ts`): `new ModelsDevCatalog({ filePath, logger, now?, isAllowed, onUpdated, fetch?, timers? })` with `facts(id)`, `start()` (first check in 30 s), `wake()` (check now), `dispose()`. Same schedule as the price table (24 h, 1 h retry, `If-None-Match`, 15 s timeout); `isAllowed` is asked before every request: price-table auto-update on AND Claude Code or Codex switch on (cli-wiring-web-search ticket 07; both off → no download, the first switch turned on triggers a check). An update or an endpoint list refetch rewrites `settings.json` hints and `codex-models.json`.
- Codex catalog entries (ticket 07, `codex-model-catalog.ts` `codexModelEntry`, reused by ticket 10's merged list; magpie MIT): facts come from the endpoint's own listing first, then models.dev (`mergeModelFacts`), looked up at the first enabled endpoint that selected the model. Facts resolve per model as model setting → endpoint default → upstream list → models.dev → built-in default (ticket 13, `resolveModelFacts` in `packages/protocol/src/api-endpoint/model-settings.ts`, shared by daemon and app). The window told to Codex follows magpie `codexcat.go` `work.Working` / `CompactFor` (`codexWorkingWindow`): a compaction threshold wins; a context the user set by hand (on the model or as the endpoint default) is told in full unless the host Compact at is typed; otherwise a window over the host's compaction size is told as that size — `hostCompactAt` (protocol `model-settings.ts`): Full window → none (whole window), else the host Compact at, else `WORKING_WINDOW` 272K. `max_context_window` = the full window, written only when the told window is smaller. Host-wide **Long conversations** (ticket 14, magpie `FullContext` / `CompactAt` / `SetCompactAt`): optional `endpoints.json` `longConversations: { fullContext?, compactAt? }`, set through `provider.api_endpoint.set_long_conversations` (272K stored as unset, as magpie), listed as the list response's optional `longConversations`, gated on `apiEndpointManagement`; it is part of `cliModels`, so a change rewrites `settings.json` and the catalog. Every `commit` caller spreads `...state` so the field survives a save; efforts → `supported_reasoning_levels` passed as-is, trimmed, deduped, empties dropped (`codexReasoningLevels` — Codex takes any non-empty name, an empty one breaks the whole file); default level as magpie's `ModelDefault` / `NearestEffort` (`codexDefaultLevel`); vision → `input_modalities` (`takesImages`). Unknown facts keep the old defaults: 272K, four fixed levels, no `input_modalities` (Codex then assumes images — also true for an old `models-dev.json` without the vision fact until the next download). No reply limit: Codex's `ModelInfo` has no such field (openai/codex `codex-rs/protocol/src/openai_models.rs:408-515` @ ce0323f2).
- Host-wide **Endpoint name in model lists** (endpoint-management-ux ticket 18, magpie "Provider in model names" / `provider.Labels`): optional `endpoints.json` `endpointNameDisplay`, one of `always` (default) / `clash` / `never`, set through `provider.api_endpoint.set_endpoint_name_display`, listed as the list response's optional `endpointNameDisplay` plus `endpointNamesUnreached` (agents the setting can't reach, e.g. Codex on an API key whose catalog shows bare names), and as the snapshot's `apiEndpointNameDisplay`; gated on `apiEndpointManagement`; part of the CLI-file fingerprint, so a change rewrites Claude's `settings.json` and Codex's catalog. Wire is `z.string()`; code uses the `ApiEndpointNameDisplay` union (protocol `api-endpoint/endpoint-names.ts`), parsed once at the boundary by `apiEndpointNameDisplayOf` — an unknown value is `always` forever (forward-compat, plain comment); only "old host sent nothing" is a `COMPAT(apiEndpointNameDisplay)` fallback. `showsEndpointNames({ display, names })` is the one rule: `clash` marks a row only when another row in the **same whole list** shows the same label, case-insensitive (magpie `same[strings.ToLower]`). The lists: Osuna's picker (flat, no endpoint group headings, in `clash` / `never`), Default model choices (count over every option by its shown label, the bare one included), Codex catalog display names (count includes ChatGPT's own models, magpie `codex_models.go:607-609`; the slug `slug/model` still tells rows apart under `never`), Claude Code `/model` rows (`name (endpoint)` with description `via Osuna` when shown, else the endpoint name stays in the description, magpie `claude.go:933-939`). The endpoint page's preview line runs the same functions over the real list (disabled models dropped) so it never disagrees with the pickers. Tests: protocol `endpoint-names.test.ts`, app `endpoint-name-display-form.test.ts`, daemon e2e for Codex (temp `CODEX_HOME`) and Claude (temp `CLAUDE_CONFIG_DIR`) in all three modes.
- Service: `ApiEndpointService` (`service.ts`) resolves the path (`resolveAgentHookConfigPath(claudeAgentHookProvider, { env, homeDir })`, so `CLAUDE_CONFIG_DIR` wins), serializes every mutation through one promise queue, and does the file I/O.
- Codex pure patch (`codex-config-patch.ts`): `applyCodexApiEndpoint({ text, wiring: CodexGatewayWiring /* baseUrl (ends in /v1), token, model, catalogPath, chatgptBaseUrl, endpointModels, defaultThinking, subagent, memoryModel */, takeover }) → patched { text, takeover } | unparsable`; `restoreCodexOfficial({ text, takeover }) → patched | delete | missing | unparsable`; `refreshCodexProviderTable({ text, table }) → patched | absent | unparsable` — at every daemon start, switch on or off, points a table that is there at the current gateway URL and token and replaces a v0.15 `auth.command` table the same way (no table → writes nothing).
- Codex model catalog (`codex-model-catalog.ts`): `buildCodexModelCatalog(state) → string` (JSON). Entries carry `base_instructions` = `CODEX_BASE_INSTRUCTIONS` (`codex-base-instructions.ts`, vendored from openai/codex, Apache-2.0).
- Host-wide **Endpoint name in model lists** (endpoint-management-ux ticket 18, magpie `PlainNames` / `SuffixMode`): optional `endpoints.json` `endpointNameDisplay` (`clash` or `never`; `always` is not stored), set through `provider.api_endpoint.set_endpoint_name_display`, listed as the list response's optional `endpointNameDisplay` and the provider snapshot's `apiEndpointNameDisplay`, gated on `apiEndpointManagement`. One rule for daemon and app: `showsEndpointNames` (protocol `api-endpoint/endpoint-names.ts`), a clash being two names in one list equal ignoring case. Unknown or missing values become `always` only through `apiEndpointNameDisplayOf`, at the boundary (file read, list response, snapshot). It names Claude Code's `modelPicker` rows `name (endpoint)` with the description `via Osuna` (magpie `listLabels`; a row without the name keeps the endpoint in its description) and the ChatGPT-signed-in Codex entries — named at merge time by `namedCodexEndpointEntries`, counting ChatGPT's own models in the clash (magpie `codexListed`), the list tag carrying the setting and endpoint names so Codex refetches; the setter goes through `commit`. The list's optional `endpointNamesUnreached` names the agents it can't reach (an API-key Codex lists bare names; magpie `noNamesSaid`). The gateway's `/v1/models` is not touched.
- Codex sign-in wiring (cli-wiring-web-search ticket 09, ADR 0010): the sign-in is asked from Codex itself — a temporary `codex -c model_provider="openai" app-server` answering `account/read` (`codex-sign-in.ts` `createCodexSignInReader`, `CODEX_HOME` = the directory of the `config.toml` being rewritten), never `auth.json` or the keychain — before switching Codex on, on status read while Codex is on, and once in the background after the gateway attaches; an unknown answer keeps the current wiring. Injection `readCodexSignIn` (test daemons default to a fake answering signed out; the app e2e upgrade seal blocks the probe — tests never spawn real Codex). ChatGPT wiring: top-level `openai_base_url` = gateway + `/backend-api/codex` (a user-written one is recorded and restored, magpie replaces it too), Osuna's `model_provider` / `model_catalog_json` removed, the Osuna table still written, `model` untouched — except when a user-written top-level `model_provider` (not `openai`, not a CC Switch mirror) is removed (recorded, restored on switch-off, at the end of the top-level keys): then `model` = magpie `connect`'s pick (same name, then the tier's family, else the first) as `slug/model`. API key or signed out: the old wiring. A sign-in change rewrites with the new wiring and restores the old wiring's keys, unless the file was changed externally (then it waits for Re-apply). An externally changed `openai_base_url` is "not through the gateway". CC Switch-style OpenAI mirror tables (ticket 11, magpie `isCCSwitchMirror` / `takeMirrors` / `giveMirrors`: a `[model_providers.<id>]` header table — inline and dotted forms are not tables to magpie either — with `name = "OpenAI"`, `requires_openai_auth`, no `base_url`, not named by a profile): under the ChatGPT wiring with the switch on, their `base_url` = the gateway's ChatGPT backend; the record keeps optional `mirrors.<id> = { original, written }` and only grows — a mirror stays recorded while its address is still the one Osuna wrote (even if later profile-named or renamed, then no longer rewritten on a port change) and is dropped only once the address changed; switch-off or the API-key wiring removes/restores every recorded mirror still holding our address. A changed mirror address reports `model_providers.<id>.base_url` as "not through the gateway" (`isCodexMirrorKey`); Re-apply no longer wires a table that stopped looking like a mirror.
- Claude `settings.json` as JSONC (cli-wiring-web-search ticket 15, ADR 0012, `claude-settings-patch.ts`): a leading BOM is split off on read (`splitBom`) and put back on write; comments and trailing commas parse with `jsonc-parser`; only owned keys are edited and every other byte stays — `editBesideComment` keeps a line-end comment on its line when a key is added at, or removed from, the end (jsonc-parser would move or drop it). Restore is byte-exact, comments included. A file with comments or trailing commas is still rewritten and, while the switch is on, reports hint `settings_has_comments` (`isReadableByClaudeCode: false`; Claude Code skips the whole file — non-interactive SDK sessions only debug-log it, verified in Claude Code 2.1.302's shipped code, so Osuna's Claude chats go official) with fix steps. A file even JSONC can't read is refused with `config_unparsable` and `ApiEndpointError.params` (`reason`: `syntax` with line/column, `root_not_object`, `key_not_object`, `key_not_array`); `ApiEndpointRequestError` takes one object parameter. Paths in copy abbreviate home as `~`.
- Claude cloud-platform switches (cli-wiring-web-search ticket 16, ADR 0012, `claude-cloud-switches.ts`, magpie `claudeClouds` / `claudeSwitchOn` / `claudeCloud` MIT): takeover removes `CLAUDE_CODE_USE_{BEDROCK,VERTEX,FOUNDRY,ANTHROPIC_AWS,ANTHROPIC_GOOGLE_CLOUD,MANTLE}` that are on in `settings.json` `env`, recording them in optional `takeover.clouds` (`COMPAT(claudeCloudSwitchRecord)`); switch-off puts back each one the user hasn't set again since; off switches and other cloud vars untouched. While the switch is on, a switch on in managed settings (macOS `/Library/Application Support/ClaudeCode`, Linux `/etc/claude-code`, Windows `C:\Program Files\ClaudeCode`, incl. `managed-settings.d/`), `~/.claude.json` `env` or the login-shell environment reports hint `cloud_switch_on` with its source (one at a time, first found, as magpie); a managed `env.ANTHROPIC_BASE_URL` that doesn't reach the gateway reports `managed_base_url` as "not through the gateway" — `gateway-reach.ts` probes it like magpie's `proxyBase` / `probedNow` (20 s memo) against the gateway's `GET /` → `{"name":"osuna"}`. Sources Osuna can't edit offer Switch to official, Keep current settings and How to fix — no Re-apply. Login-shell env: `login-shell-env.ts` asks the login shell (`-ilc`, then `-lc`) plus fish and nushell when installed and configured, first answer per variable, one-minute cache, never on Windows, falling back to the process env. All three readers are replaceable; test daemons answer nothing and app e2e points `PASEO_CLAUDE_MANAGED_SETTINGS_DIR` at a temp dir — tests never read the real managed dir, `~/.claude.json` or spawn a real shell.
- Claude Code fixes (cli-wiring-web-search ticket 17, magpie MIT): `claudeSpelled` (`claude-spelling.ts`, magpie `ClaudeSpelled`) rewrites a dotted Claude version in the written `model` and Osuna's own `modelPicker` rows only when the hyphen form uniquely matches an on-sale id (other vendors and user-written rows untouched; ticket 22 reuses it for background/Subagent models). `env.CLAUDE_CODE_AUTO_MODE_SERVER=0` is written while no reachable model is reviewed by Anthropic (`isAutoModeReviewed`: a Claude-named selected/mapped model or an `api.anthropic.com` endpoint with models selected), recomputed on every rewrite and part of the CLI fingerprint, ownership kept in the takeover's `hintEnv` (a user-written value is never touched; removed on switch-off). Capability hints add xhigh for a non-Claude model that reaches max.
- Kept claude.ai sign-in (cli-wiring-web-search ticket 18, ADR 0012): `agents.claude.keepsClaudeAiLogin` (optional; settable with the main switch off). On: `env.ANTHROPIC_AUTH_TOKEN` is written as `""` (owned key), so Claude Code sends its claude.ai sign-in; off: the gateway token goes back. Inconsistencies reported in the hint area as magpie's `Check`: option on but a token filled back in (Claude Code sends the token, not its sign-in — Re-apply / stop keeping), option off but the token empty or gone (Keep / Re-apply).
- Default model on switch-on (cli-wiring-web-search ticket 19, `default-model-pick.ts` `pickDefaultModel`, magpie MIT): when `set_agent_settings` turns a switch on without `defaultModelId`, picks in magpie's order — `joined` (ChatGPT-signed-in Codex whose `model` stays its own; ahead of everything), `kept`, `again` (the model recorded in the takeover's `reconnect` at the last switch-off), `same` (the CLI's current model served by an endpoint), `alike` (tier mapping, then same-family name), `default` (CLI has no model: Claude — newest Claude model by models.dev release date, cached in `models-dev.json`; Codex — first visible model by priority in `models_cache.json`, more than magpie), `first`; none usable → refused. The response carries optional `connection: { how, model, previousModel }` (`how` is a string so new kinds can come) and the app shows one sentence. A default may be `slug/model` (pinned endpoint first, failover to same-name endpoints; a closed pinned endpoint falls back to the bare name); under the ChatGPT wiring with a user provider the bare pick is written as the first endpoint's `slug/model`. The endpoint list still never carries `slug`: the app builds pinned options from the snapshot's `apiEndpointModelGroups` (gated on `apiEndpointCliWiring`). Pinned names appear in Codex's catalog / merged list.
- Rewrite time (cli-wiring-web-search ticket 25, `store.ts` `recordCliRewrite` / `readCliRewrittenAt`, magpie MIT `applied.json` `at`): `commit` records `api-endpoints/cli-rewrites.json` `{ claude?, codex? }` (ISO) for every provider whose CLI config it synced, `reapply: true` included, so a reapply renews it even when the file bytes don't change. Zod on read and write; unreadable or schema-invalid reads as empty (it only feeds the Bypassed hint and gates who to reopen), and no entry counts from the daemon's start (magpie always has `rec.At`). Why persisted: Codex's log-database check (`cli-bypass.ts` `readCodexLastRequest`) has no daemon-start floor, so after a restart only the stored time keeps a request made before the last rewrite from counting. Ticket 27 adds `cli-start-reads.json` `{ claude?, codex?: { digest, at } }` (zod, `store.ts` `readCliStartRead` / `writeCliStartRead`, magpie's stash `<agent>.started`): the digest of what each CLI reads at start and since when it is so; unreadable reads as empty, and a failed write only logs (the next look takes the files' mtime again). Same reason for `gateway-seen.json` (`GatewaySightings`, magpie `usage.LastSeen` reading its log tail): the gateway's last request per agent, to the second, written at most once a second, read once at start, so a Codex request received before a restart still answers a connection logged before it. It never blocks a request or the start: memory is updated first and the write runs after the request (`setImmediate`); an errno failure on write, and any read or parse failure, only logs a warning (read failure → never seen).
- Default thinking (cli-wiring-web-search ticket 20, `default-thinking.ts`, magpie MIT; agent settings `defaultThinkingOptionId?: string | null` and Claude-only `usesUltraCode?: boolean`, both optional, absent = untouched). Claude Code: low–xhigh → top-level `effortLevel`, plus `modelSettings.<claudeName>.effortLevel` when the default model is a Claude model, and `env.CLAUDE_CODE_EFFORT_LEVEL` removed; max → `env.CLAUDE_CODE_EFFORT_LEVEL` (it beats the SDK's `--effort`, read from CLI 2.1.302 / 2.1.246, so every session incl. Osuna's is locked and the snapshot carries `lockedThinkingOptionId`); Ultra Code is a separate switch (`ultracode: true` / removed), combinable with any level, refused unless the default model takes xhigh; picking a level never touches `ultracode`. Options follow magpie `claudeEffortsFor` (Claude models by the CLI table, any other model all five). Changing the default model never rewrites the Claude file: the daemon reports settings magpie-`Get`-style through `shownAgent` — level `claudeClamp`ed (highest level not above the chosen one), `usesUltraCode: false` for a model without xhigh — while the stored value stays (switching back restores it). Codex: top-level `model_reasoning_effort`, any non-empty level accepted without a default model; settled only when the default model changes (nearest level → medium → high → first; unknown levels → untouched). Written keys record their originals (`thinking.keys`, `thinking.created`; `COMPAT(claudeThinkingRecord)` for older records) and are restored on switch-off; a level the CLI itself changed is not counted as modified and is followed (ticket 21, below). Osuna's own Claude chats pass `settings.ultracode: false` unless Ultra Code was picked; new chats with no remembered choice start at the default thinking. The app never re-derives clamp or lock rules: it shows what the daemon reports.
  - Wrong: clamp to the *nearest* level (xhigh → max on Opus 4.6 silently locks every session). Correct: highest level not above, on read only.
- Following the CLI's own picks (cli-wiring-web-search ticket 21, ADR 0012, magpie `Follow` / `Drift` `replaced` / `Keep`, MIT): on every status read and before every rewrite (`exclusiveFollowing`, and in `attachGateway` once the address is bound) the service reads what the CLI saved itself. A `model` that an enabled endpoint serves (`servedModel`: bare, `slug/model`, `[1m]`, spelling; Claude tier names through `mappedTierModel`; under Codex's ChatGPT wiring only an exact `slug/model`, read from the file even when Osuna recorded no `model` — the joined case) becomes the default model through `commit(…, { isFollowingCli: true })`, which rewrites the followers (hints, `modelSettings` path, Codex catalog) but not the model. A model no endpoint serves is hint `model_replaced`; a ChatGPT model picked beside the ChatGPT wiring is not. The takeover's model record (Claude `model`, Codex `keys.model`) gains optional `held: "followed" | "kept"` (`cli-model-hold.ts`) and Claude's `written` may be null: a held model, or one the CLI changed and not yet answered, is left untouched by every rewrite (`shouldRewriteModel` false) until Re-apply or an Osuna-side default-model change (`shouldRewriteCliModel`); the hold is recorded only after the followed settings commit, so a failed write is followed again next read; `keepCliModel` writes the takeover record only when it differs (`isDeepStrictEqual`), because it runs on every status read; `kept` (Keep current settings on Model replaced) silences the warning for later unserved picks too, `followed` does not. Thinking follows the level Claude Code would actually read (magpie's effort `Get`: `env.CLAUDE_CODE_EFFORT_LEVEL`, then the model's `modelSettings`, then top `effortLevel` for models that read it — `CLAUDE_TOP_EFFORT`, magpie `claudeTopEffort`) and Codex's `model_reasoning_effort`, compared with Osuna's stored default thinking even when that is unset (magpie always shows the file); Ultra Code follows `ultracode` the same way. `keep_current_settings` `code` is parsed at the session into the `KeepCurrentSettingsCode` union and anything else is refused with `invalid_input`. A Codex level the CLI deleted is followed as unset and its recorded original forgotten, so switch-off doesn't put an old level back.
  - Wrong: re-writing the default model on the next rewrite because `model` no longer equals `written`. Correct: a changed model is the CLI's until the user answers.
- Switch-off preview (cli-wiring-web-search ticket 26, magpie `DisconnectPreview` / `diffLines` / `mask`, MIT): `ApiEndpointService.previewSwitchOff(provider) → { files }` runs under `exclusive` (not `exclusiveFollowing`: following the CLI's picks may write). It reads the CLI file and the takeover record and calls the same plan the real switch-off uses — `claudeRestorePlan` / `codexRestorePlan` (module functions in `service.ts`, also the `compute` of `restoreClaudeOfficial` / `restoreCodexOfficial`) — so every owned key a later ticket adds to the takeover shows up without touching the preview. `switch-off-preview.ts` `switchOffFileChange({ path, homeDir, before, after: ConfigFileChange })` turns the plan into `{ path (~/ under home), change: edited | created | removed, lines }`; `diffLines` is magpie's line diff (Myers up to 4000 edits, then in-order matching; a removed and an added line with the same key and indent pair into `restored` with `was`; lone brackets dropped; `maskSecret` hides values of keys matching key/token/secret/password/auth, except `…TOKENS`, empty, `{…}` and `$VAR`). Switch off or no takeover → `files: []`. Unparsable → throws `config_unparsable` like the switch-off.
  - Wrong: describe the restore a second time for the preview. Correct: diff the real plan's output; Osuna's own files (`codex-models.json`) are not listed, as magpie lists only the agent's folder.
- Codex path: `resolveCodexConfigPath()` takes the directory of the Codex hooks installer path (`CODEX_HOME` wins) plus `config.toml`.
- Guarded write (`config-file.ts`): `writeConfigFileGuarded<T>({ filePath, compute(current: Buffer | null) → { change: write{text} | delete | keep, value: T }, commit(value), rollback(), beforeRecheck? }) → { kind: "written", value } | { kind: "conflict" }`. The service wraps it as `writeConfigFile`, passes `compute(text, bytes)`, and turns `conflict` into `ApiEndpointRequestError("config_conflict")`. Every write and restore of `settings.json` / `config.toml` goes through it.
- Inspect (pure, for health): `inspectClaudeSettings({ text, takeover }) → { kind: "parsed", modifiedKeys, baseUrl } | unparsable`; `inspectCodexConfig({ text, takeover }) → { kind: "parsed", modifiedKeys, profileOverride: { profile, keys } | null, baseUrl } | unparsable`. `takeover` is null in Official; the Codex table to check is `takeover.table`.
- Gateway address: `ApiEndpointService.attachGateway(url: string | null): Promise<void>`, called by bootstrap right after the main listener binds with `createApiEndpointGatewayUrl(boundListenTarget)` (`http://127.0.0.1:<port>/api-endpoint-gateway`; `0.0.0.0` → `127.0.0.1`; `null` for a socket or pipe). Before it runs the service is `pending`.
- Injection: `PaseoDaemonConfig.apiEndpoints` is `ApiEndpointServiceOverrides` (the swappable option list, kept in `service.ts` so `bootstrap.ts` names no provider) `& ApiEndpointGatewayOverrides & RetiredModelsOverrides`; bootstrap also passes `isModelsDevAutoUpdate: () => usage.pricing.autoUpdate`, absent (never download) in tests unless set; tests drive downloads with the test-only `modelsDevFetch` / `modelsDevTimers` options (fake fetch, manual timers — never the real network). `beforeConfigRecheck` is a test seam only: the daemon tests write the file from it to simulate another tool. `createTestPaseoDaemon` defaults it to a temp `CLAUDE_CONFIG_DIR` and `CODEX_HOME`, so no test daemon can touch the real `~/.claude` or `~/.codex`. There is no Codex version check. `ApiEndpointServiceOptions.providerRuntimeSettings(provider)` is optional; bootstrap passes `(provider) => config.agentProviderSettings?.[provider]`, and the service uses it to find the user-configured `codex` for `createSystemHostProcesses` and, when `readCodexSignIn` is not injected, to build `createCodexSignInReader` (without it the sign-in reads as unknown, as in service unit tests). When `readCodexCliVersion` is not injected it also builds the `InstalledCodexVersion` reader (`codexCliVersionReader`: npm package first, `probeCodexVersion` only as a fallback); without it the installed version is never asked. `readCodexCliVersion` is in `ApiEndpointServiceOverrides`, and a daemon test that tests a model "as Codex" injects a fake one so no real `codex` runs. The newest Codex version seen through the gateway lives in the service (`SeenCodexVersion`, memory only); the gateway hands each ChatGPT-backend request's headers over through the generic `noteCliVersion` callback, which bootstrap wires to `apiEndpointService.noteCliVersion`.

### 3. Contracts

- The takeover record keeps each owned key's `original` (`{ present: false }` or `{ present: true, value }`) and `written`, plus `originalFile` (`absent` / `empty` with its text / `content`). Originals are taken from the first takeover only; a later rewrite (new port, new default model) keeps them.
- Claude writes `env.ANTHROPIC_BASE_URL` (gateway), `env.ANTHROPIC_AUTH_TOKEN` (token), `env.ANTHROPIC_API_KEY: ""`, top-level `model` (`takeover.model`, optional because v0.15 records lack it), the WebSearch deny entry (only while no endpoint that is on has `searchesWeb` with an Anthropic or Responses address — `someEndpointSearchesWeb`, cli-wiring-web-search ticket 04, ADR 0009; otherwise Osuna's own entry is removed, plus a `deny` / `permissions` it created that is now empty; the condition is part of the CLI fingerprint so a change rewrites the file; a user-written `"WebSearch"` is never touched), and top-level `modelPicker: { options: [{ model, label, description }] }`. `ANTHROPIC_MODEL`, `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU,FABLE}_MODEL`, `ANTHROPIC_SMALL_FAST_MODEL` and `CLAUDE_CODE_SUBAGENT_MODEL` (magpie `claudeEnv`) are recorded with `written: null` and removed — only when present at takeover or already in the record — and come back on Official at the end of `env` (jsonc appends; values equal, position not). Exception (cli-wiring-web-search ticket 22): while the agent settings set `backgroundModelId`, `ANTHROPIC_SMALL_FAST_MODEL` is written as that model (spelled like the start model: `[1m]`, `claudeSpelled`); while `subagentModelId` or `subagentThinkingOptionId` is set, `CLAUDE_CODE_SUBAGENT_MODEL` is written as `<model>:<level>` before any `[1m]` (`claudeModelAt`, magpie `tierWith`), a level set alone hanging on the main model the file holds after the write (the CLI's own when held, magpie `setSubagent`). The level is one of none–max (magpie `MemberEfforts`), not checked against the model. A Subagent value hand-edited to a served model is followed into the settings (`readClaudeCliPicks().subagent`, magpie's `Get` reads the file); an unserved one, and any background-model edit, stays an ordinary `modified_externally` key and is written over on the next rewrite. `settleAgentSettings` clears a background model no endpoint serves any more, and an unserved Subagent model together with its level (magpie `subagentOwn`). The gateway reads `<model>:<level>` with `gateway/fixed-effort.ts` (magpie `askedAt`): the whole id wins when some endpoint selected it; otherwise the model is routed bare and every candidate is asked at the level fitted to its own levels (`fitFixedEffort`, magpie `fitLevel`) — passthrough in the agent's format with adaptive thinking kept even for a non-Claude model on an Anthropic address, translation through `requestForModel`; count_tokens counts the bare model only. Codex counterpart (ticket 23, magpie `subagents` / `subagent_effort` / `memories` fields, MIT): agent settings `subagentModelId`, `subagentThinkingOptionId` and Codex-only `memoryModelId` write `[agents] default_subagent_model`, `default_subagent_reasoning_effort` and `[memories] extract_model` + `consolidation_model` (same value) only while set — unset never touches a user's own. They are recorded in `takeover.keys` as `"agents.<key>"` / `"memories.<key>"` with `{ original, written }` and put back on unset or Official; an `[agents]` / `[memories]` table Osuna had to add is recorded in optional `createdTables` and removed once empty (magpie `DelTOMLKey`); new tables go before Osuna's provider table so a rewrite is byte-stable; an inline or dotted `agents` / `memories` makes the patch `unparsable`. Under the ChatGPT wiring Codex's own models (visible entries of `models_cache.json`, `codexOwnModels`, magpie `catalog.Codex()`) are choices too; the daemon sends the merged option list in the snapshot's `sideModelOptions` (`{ id, model, endpointName }`, Codex's own first with `endpointName: "ChatGPT"`, then bare endpoint models, then `slug/model` per endpoint; a bare endpoint model with the same name as one of Codex's own is left out, since a bare name there means Codex's own) and the app shows it as is; and an endpoint model is written as the first `slug/model` listing it (`codexListedName`, `/model`'s spelling); the API-key wiring offers endpoint models only, as Codex reads only Osuna's catalog then. The level must be one the Subagent model takes (the main model when unset: the default model, or under the ChatGPT wiring `config.toml`'s `model`), Codex's own models by their cached `supported_reasoning_levels`; unknown levels accept anything and the snapshot's `subagentThinkingOptions` falls back to low–xhigh; `settleSubagentThinking` in `commit` drops a level the current model doesn't take (magpie `dropSubEffort`). File edits are read back (`readCodexCliPicks` `subagent` / `subagentLevel` / `memory`, magpie `Get`): a served model or one of Codex's own is followed (so never reported or written back), a level always (not counted as modified), a model Codex doesn't know stays `modified_externally`. `settleAgentSettings({ state, codexOwnModels })` clears Subagent and memory models neither served nor Codex's own (Codex keeps its level for the settle). Ticket 24 (magpie `CodexSubagentModel` and `CodexAgentsV1`, MIT): Codex-only `forcedSubagentModelId` and `allowsAnySubagentModel` write nothing to `config.toml` and are not part of the CLI fingerprint. The forced model is validated like the default Subagent model (`codexSideModel`) but not settled away when unserved (magpie keeps it); the gateway (`gateway/codex-requests.ts`, `codex-subagents.ts`) moves a request whose `x-openai-subagent` is `collab_spawn` / `thread_spawn` / `agent_job` to it, unless no endpoint (nor, under the ChatGPT wiring, Codex's own list) serves it, or the request carries a task the ChatGPT backend sealed and the model isn't one of Codex's own. The switch writes `multi_agent_version: "v1"` into every `codex-models.json` entry (`buildCodexModelCatalog({ marksAgentsV1 })`) and, under the ChatGPT wiring, into ChatGPT's own and the endpoint entries of the merged `/models` list; the list tag gains a `v1.` prefix so Codex refetches, and `codex-agent-versions.json` remembers ChatGPT's own versions so a cached V1 list is put back when the cache stands in. The list's hint area reads `config.toml` for Codex's own `multi_agent_v2` (`readCodexMultiAgentV2`) only while the switch is on; an unparsable file shows both `config_unparsable` and `codex_multi_agent_v2_unreadable`, as magpie shows its Check error and `codexV1ReadErrorNotice`. Under the ChatGPT wiring a sealed task sent to an endpoint model is refused with 400 and magpie's `sealedWayOut` sentence (`sealedTaskMessage`).
- Codex writes top-level `model_provider = "osuna_api_endpoint"`, `model`, `model_catalog_json` (absolute path of `codex-models.json`) and the table `[model_providers.osuna_api_endpoint]` with `name = "Osuna"`, `base_url` (gateway + `/v1`), `wire_api = "responses"`, `experimental_bearer_token` (token in plain text). The record adds `table: { baseUrl, bearerToken }`, `fileCreated` and optional `tableKept` (cli-wiring-web-search ticket 03: "Keep current settings" while the table itself was changed outside Osuna — the table is the user's, startup `refreshCodexProviderTable` skips it until the switch is on again, ADR 0012). Official restores the three top-level keys and keeps the table (cli-wiring-web-search ticket 02, ADR 0010), so Codex conversations recorded under it still resume through the gateway; `fileCreated` and nothing left → `delete`.
- Claude `modelPicker` (ticket 17, after magpie's `writePicker`): one row per selected model of every endpoint that is on, built by `cliModels(state, provider, defaultModelId)` from `endpointModelGroups` (the chat model selector's order): `model` = `slug/model`, `label` = `model.label ?? model.id`, `description` = endpoint name; Codex always gets `[]`. Ownership is `takeover.modelPicker.written`: non-null means the file's `modelPicker` is the daemon's. A `modelPicker` in the file with `written: null` is the user's and is never touched, during the takeover or on Official; no rows → not written, and the daemon's own is deleted. Official deletes only the daemon's own. A daemon-written picker the user then edited is still the daemon's and is overwritten on the next rewrite (magpie does the same). Records from before ticket 17 have no `modelPicker` (`COMPAT(claudeModelPickerRecord)`).
- Claude model hints (ticket 18, merged toward magpie in ticket 14 — `claudeHints` in `claude-model-hints.ts`): facts are the resolved model settings (`modelFacts`, so hand-set context, output, levels and Compact at count); for the start, background and Subagent models (bare ids) from the first enabled endpoint that selected them. Ids are `claudeSpelled` first. `[1m]` goes on `model` and on every picker row whose window is ≥ 1M, Claude models included (Claude Code strips it before sending, verified on 2.1.299). `CLAUDE_CODE_MAX_CONTEXT_TOKENS` (magpie `claudeWindow`) = the start model's window, a Claude model's too; a `[1m]` start takes the least unmarked window of the tier models (Osuna's only tier is the background model); unknown → not written. `CLAUDE_CODE_MAX_OUTPUT_TOKENS` (magpie `claudeOutput`) = the least `output` over the start, background and Subagent models that aren't Claude models — other picker rows don't count; not written when the start model is a Claude model, one of those is unknown, or the least is ≤ 32000. `CLAUDE_CODE_MODEL_CAPABILITIES` (magpie `claudeCapabilities`) = `pattern=effort[,xhigh_effort][,max_effort]` joined by `;`, start and background models first, then every picker row; a Claude-named model is named too, with only the levels `claudeEffortsFor` gives it (no `xhigh_effort` added for Opus/Sonnet 4.6); the pattern is the id without `[1m]`, lowercased (Claude Code lowercases the model, not the pattern — checked with `-effort` on 2.1.299), ids with `;=,` or a trailing `*` skipped, at most 8000 chars. `CLAUDE_CODE_AUTO_COMPACT_WINDOW` (magpie `writeCompact`) = the start model's own or endpoint-default Compact at (a Claude model's too); otherwise none for a Claude model, none when the context was typed and no host Compact at is, else `hostCompactAt` (272K by default, none under Full window). The 272K default (no host Compact at typed) gives way — `wiring.compactYieldsToOwn` — to the user's own top-level `autoCompactWindow` or `modelSettings.<main model>.autoCompactWindow` in `settings.json` (magpie `claudeOwnCompact`, keys compared without `[1m]`, dashed, case-insensitive). Ownership is `takeover.hintEnv` (`{ [key]: value }`): a key is the daemon's only while the file holds exactly the recorded value; absent or the daemon's → written or deleted, otherwise the user's and never touched, not recorded, not deleted on Official, not reported as modified. Records from before ticket 18 lack `hintEnv` (`COMPAT(claudeModelHintRecord)`), which also triggers one rewrite on start. When facts change underneath — models.dev updated, or a refetched catalog changes `cliFingerprint` — `rewriteClaudeHints` rewrites `settings.json` unless Claude is off, the gateway has no URL, or `inspectClaude` reports an owned key modified (then it only logs). Facts never reach a client: `toWireModel` strips them from fetch results and the `catalog` projection.
- Only the agent switch, the default model, the gateway URL, the token and (Claude only) the picker rows and model hints reach the CLI files: `cliFingerprint` holds exactly these (`cliModels`), so renaming an endpoint, changing its selected models or its switch rewrites `settings.json`, while its URL or key never do; the Codex catalog (visible bare names deduped + hidden `slug/model` per enabled endpoint; entries per "Codex catalog entries" above) is regenerated in `commit` whenever its text changes, written before `config.toml` so the path never dangles, put back on a failed commit, deleted when Codex is Official.
- Order of one guarded attempt: read bytes + sha256 → `compute` (throws `config_unparsable` before anything is written) → stage a temp file next to the target → `commit` (takeover record, first-write backup, Codex key file) → `beforeRecheck` → re-read and compare the hash → `rename` (or `rm` for `delete`). A changed hash calls `rollback` and recomputes on the new content; after three attempts the result is `conflict` and nothing is left changed. `commit` goes before the re-read so the gap between the check and the rename holds no other disk writes (ADR 0004: "re-read it just before the atomic rename"). The reverse order (file first, record second) loses the originals on a crash.
- `rollback` restores the previous takeover record and key bytes and deletes a backup made in that attempt, so a retried first write leaves exactly one backup.
- The backup is taken once per file lifetime: `backup: null` = never rewritten, `{ path: null }` = the file did not exist at the first write. Never back up a file the daemon already wrote.
- The CLI file is replaced atomically with its previous mode bits (new file: `0600`, because it now holds a token). `writePrivateFileAtomicSync` is wrong here: it forces `0600` on the file and `0700` on `~/.claude`.
- Codex: edit TOML by splicing text at `toml-eslint-parser` node ranges, never by re-serializing. `original` for a top-level key is `{ present: true, raw }`, the value's source text with its quotes. Every edit re-parses its output and checks the written values; failure is `unparsable`.
- Codex switch order: compute the patch (nothing written on `unparsable`) → commit writes `takeover-codex.json` → re-read check → replace `config.toml` → delete a v0.15 `codex-api-key` if present. A failed check or replace writes back the previous takeover record; `endpoints.json` and `gateway-tokens.json` are written only after every CLI file succeeded (`commit`, next scenario).
- Delete of an endpoint: the settle rule moves each agent's default or sends it to Official, and the CLI files follow only if the default changed. Any CLI failure (`config_conflict`) leaves `endpoints.json` and the key untouched, so the endpoint and the mode stay.
- Health is read on `list` only, never by a watcher: owned keys vs `written` (Claude `env.*` including removed keys that came back, top-level `model`, the daemon's own `modelPicker` compared as `JSON.stringify({ options: written })`, the WebSearch deny entry the daemon added; Codex the top-level keys in `takeover.keys`, every field of the table and each recorded mirror's `base_url`). Other keys never count. A model or thinking level the CLI saved itself is followed, not counted (ticket 21 above); `agentIssues` carries the cases ADR 0012 lists.
- Start-up (`attachGateway`): tokens are backfilled for agents that are on without one (legacy conversion never went through off→on); an agent that is on is rewritten only when the recorded gateway URL or token differs from now (port change, backfilled token, v0.15 record that pointed straight at a relay, a Claude record without `modelPicker` from before ticket 17) — an outside edit of `model` is followed or reported, never overwritten. Official Codex: a kept Osuna table (and a v0.15 `auth.command` table) is pointed at the current gateway unless `tableKept`, and a v0.15 key file is removed. Errors are logged; the daemon still starts.
- Socket listener: `gatewayUnavailable = { code: "gateway_requires_tcp" }`; turning a switch on is refused with that code; an agent already on keeps its file (written URL reused for a new default model). An agent on whose record holds no gateway URL is skipped, so turning an endpoint off still works and no token is written next to a relay URL.

### 4. Validation & Error Matrix

- Not JSON, not an object, `env` not an object, `permissions.deny` not an array → `config_unparsable`, nothing written, active endpoint unchanged.
- File missing on switch → created. File missing on restore → nothing written (`missing`).
- Restore leaves `{}` and `originalFile` was `absent` → file deleted; `empty` → original bytes back.
- Codex: invalid TOML (1.0), `model` / `model_provider` / `model_catalog_json` not a string, `model_providers` not a table, or a result that would not parse (e.g. `model_providers` as an inline table) → `config_unparsable`, nothing written, no catalog left behind.
- Turning a switch on while the gateway is not bound → `gateway_requires_tcp` (socket) or `gateway_not_ready` (before bind); nothing written.
- Codex BOM: the parser rejects it, so each entry point strips a leading BOM and puts it back.
- The file changes between the hash and the rename three times running → `config_conflict`, nothing written, takeover and key file as before.

### 5. Good/Base/Bad Cases

- Good: canonical 2-space file with hooks and permissions; switch and back gives identical bytes.
- Base: a compact one-line `env` object receives a key; that line is re-indented (`jsonc-parser` formats the edited line).
- Bad: `JSON.stringify` of the parsed file (loses the user's formatting); deleting keys that were absent-but-empty (`""` is present, not absent).
- Codex good: `model = 'x'   # note` becomes `model = "relay/gpt"   # note` and comes back as `'x'`; Official returns the file byte for byte, table gone.
- Codex base: no top-level keys → inserted at the top of the file; removed byte-exact on Official.
- Codex bad: `@decimalturn/toml-patch` (drops the comment above a key it removes); `smol-toml` stringify (rewrites the whole file).

### 6. Tests Required

- `claude-settings-patch.test.ts`: exact expected text after apply; restore equals the input byte for byte; empty-string original; absent file → `delete`; user's `{\n}` kept; user-owned `"WebSearch"` survives; unparsable shapes; model/tier/small-fast variables removed and restored by value; a v0.15 record (relay URL, real key, `ANTHROPIC_MODEL`) taken over and restored; `modelPicker` exact text, rewritten as rows change, dropped at zero rows, a user's picker untouched through apply and restore, a record without `modelPicker` gets one, the daemon's picker edited outside counts as modified and a user's does not; hint env written and removed byte-exact, a user's hint untouched through apply and restore, a hint the user changed after the daemon wrote it becomes theirs and is not counted as modified.
- `claude-model-hints.test.ts`: `[1m]` at ≥ 1M (Claude ids too); window from the start model only; no output under a Claude start model, with an unknown row, or at ≤ 32000; lowercase capability patterns, start first, odd ids skipped.
- `model-facts.test.ts` / `models-dev.test.ts` / `upstream-models.test.ts`: majority vote and ties, prefix/case/`:suffix` lookup, small windows ignored; first download at 30 s, cache survives restart, fresh cache not refetched, etag 304, failure keeps facts and retries in 1 h, nothing fetched while not allowed, `wake` checks at once; each vendor list shape read into `facts`.
- `daemon-e2e/api-endpoint-claude.e2e.test.ts`: create → activate → file holds gateway URL + token + top-level `model`, never the key → Official → file byte-identical; the token stays in `gateway-tokens.json` and the same token is written again when the switch goes back on; key absent from every response and from `config.json`; `keys.json` mode `0600`; `settings.json` keeps `0644`; no backup when the file started absent; `modelPicker` follows selected models and endpoint switches and Official returns the bytes; a user's `modelPicker` stays byte-exact; with a seeded `models-dev.json` the file gets `[1m]` rows and the three hints and Official returns the bytes; a user's `CLAUDE_CODE_MAX_OUTPUT_TOKENS` survives switch and Official; a refetched catalog with its own window wins over models.dev, rewrites `settings.json`, and the fetch result and list carry no facts.
- `codex-config-patch.test.ts`: exact text after apply; Official restores the three top-level keys and keeps the table; `refreshCodexProviderTable` points a kept or v0.15 table at a new port; apply twice is identical; a v0.15 `auth` table replaced; CRLF and BOM kept; inline `model_providers` refused; the dedicated id fails `ProviderOverridesSchema`.
- `codex-model-catalog.test.ts`: visible/hidden order and names, required fields and base instructions, no duplicate slug.
- `daemon-e2e/api-endpoint-codex.e2e.test.ts` (POSIX): exact `config.toml` with port and token; catalog follows models, endpoint switch and agent switch; `auth.json` byte-identical; unparsable refused with no catalog; read-only `CODEX_HOME` keeps the previous mode and catalog.
- `daemon-e2e/api-endpoint-gateway.e2e.test.ts` "across daemon starts": restart on another port rewrites only the URL; legacy-on agents get tokens and a pointed config on start; a pre-ticket-17 Claude record gets `modelPicker` on start and nothing else changes; v0.15 table and key file removed on start; socket listener refuses turn-on with `gateway_requires_tcp` and leaves files alone.
- `config-file.test.ts`: one write commits before the replace; a change before the re-check recomputes on the new bytes; three changes → `conflict`, record rolled back, no temp file left; a file that appears mid-write is noticed.
- Daemon tests with `beforeConfigRecheck`: a one-time change keeps the other tool's key and leaves one backup; a file that keeps changing is `config_conflict` for switching and for Official, and the active id does not move; Codex conflict leaves no catalog and no token.

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

## Scenario: host-wide API endpoints and the old-client projection

Reference implementation: api-endpoint-auto-switch ticket 01 (`server/api-endpoints/store.ts`, `host-endpoints.ts`, `service.ts`). Endpoints are shared by the whole host; each agent (claude, codex) has a switch and a bare default model. Old clients, including the official Paseo app, see a single-endpoint projection.

### 1. Scope / Trigger

- `endpoints.json` changed shape (v0.15.0 per-provider file → host-wide file) with no migration program, and a protocol response carries both a new shape and a projection.

### 2. Signatures

- `ApiEndpointStore.readState(): ApiEndpointState` — `{ endpoints: StoredApiEndpoint[]; agents: Record<"claude" | "codex", { enabled; defaultModelId: string | null }> }`. Reads the current shape, else converts the legacy shape in memory (`upgradeLegacyFile`), else throws `ApiEndpointsFileUnparsableError`. Never writes.
- `writeState(state)` always writes the current shape; the first write upgrades a legacy file.
- Pure rules (`host-endpoints.ts`): `generateEndpointSlug(name, taken)`, `usableModels(state)`, `endpointModelGroups(state)`, `settleAgentSettings(state)`, `agentTargetEndpoint(state, provider)`, `projectedBaseUrl(endpoint, provider)`, `projectedDefaultModelId(agent, endpoint)`, `findEndpoint(state, id)`.
- Service mutations all go through `commit(previous, proposed, { keys?, rewrite? })`.

### 3. Contracts

- Stored endpoint: `id`, `slug` (generated from the name, locked, never a field in any response; it reaches clients only inside the opaque `<slug>/<model>` ids of the provider snapshot's `apiEndpointModelGroups`, see rpc-and-protocol.md "host state that replaces a provider's model catalogue"), `name`, `baseUrls: [{ format: "anthropic_messages" | "openai_chat" | "openai_responses", url }]` (one per format, canonical order, at least one), `models`, `modelMapping?` (any format), `enabled`, `legacyDefaultModelId?`, `catalog?: { fetchedAt, models }` (last upstream listing, written only by a format fetch for a saved endpoint), `manualModels?` (hand-added names, kept whether selected or not), `searchesWeb?` ("Searches the web by itself", cli-wiring-web-search ticket 04: read as `z.boolean().optional()` so a hand-written `false` still parses, written only as `true`; a save that omits it keeps the stored value, like `manualModels`, so old clients never turn it off; counts only with an Anthropic or Responses address, `searchesWebItself`), `templateId?` and `region?` (the **Template** and its region or plan, endpoint-management-ux ticket 06: checked against `templates.ts` on save — an unknown template, a region not of it, or a region with no template is `invalid_input`; omitted keeps the stored pair, and a new `templateId` without a `region` drops the old region), `createdAt`, `updatedAt`. Array order is the **Endpoint order** (endpoint-management-ux ticket 03): `provider.api_endpoint.set_order` rewrites it as a whole through `commit` (an id named twice or not an endpoint is `invalid_input`; ids left out follow in their current order, as magpie `SetOrder`), a new endpoint is appended, and the endpoint switch never moves it. Only `models` is "selected"; routing never reads `catalog` or `manualModels` (see rpc-and-protocol.md, "fetch_models and test_connection by base URL and request format").
- `legacyDefaultModelId` exists only for the projection: what the old form last chose for this endpoint (migrated from the old `defaultModelId`). Nothing else reads it.
- Legacy conversion: `baseUrl` goes under the old provider's own format (claude → `anthropic_messages`, codex → `openai_responses`); an endpoint active for some agent is `enabled`, that agent's switch is on with the old endpoint's `defaultModelId`; the rest are off.
- `commit`: `settleAgentSettings` (an enabled agent whose default is not usable gets the earliest enabled endpoint's first model; nothing usable → switch off) → an off→on agent requires a bound gateway → `nextGatewayTokens` (new on off→on, kept while on, dropped when off) → Codex catalog → for each agent whose CLI fingerprint `[gateway URL, token, default model]` changed (or `rewrite`), rewrite or restore its CLI file → write keys → `writeState` → write tokens → `onActiveEndpointChanged(provider)` for agents whose model list, default or target changed. A CLI failure reverts the agents already rewritten and the catalog, and persists nothing.
- The CLI points at the gateway; `agentTargetEndpoint` is only the old-client projection's `activeEndpointId`.
- Projection per requesting provider: `provider` = that provider, `baseUrl` = `projectedBaseUrl`, `defaultModelId` = agent default if the switch is on and this endpoint has it, else `legacyDefaultModelId` if still selected, else first model; `activeEndpointId` = `agentTargetEndpoint`. The provider snapshot lists `usableModels` (deduped by id) only while the switch is on, which makes `isModelListAuthoritative` follow the switch.
- Old `save` (no `baseUrls`): `baseUrl` replaces only the agent's own format URL; a new endpoint is created off; editing the endpoint the agent points at sets the agent default to the form's `defaultModelId`; a Codex form keeps the existing tier mapping. New `save` (`baseUrls`): models may be empty, a new endpoint is created on, the switch is changed elsewhere.
- Old `set_active(id)`: endpoint on, switch on, default = projected default; other endpoints stay on (turning them off would move the other agent). Always rewrites the CLI file (`rewrite`), because the old app's "re-apply" is `set_active` on the current endpoint. `set_active(null)`: switch off.
- `set_agent_settings`: on requires a usable model, keeps the current default when still usable; off ignores `defaultModelId` and is never refused. `set_endpoint_state`: `enabled` flips the switch; `clearCooldown` is accepted and has nothing to clear until ticket 04.

### 4. Validation & Error Matrix

- `endpoints.json` not JSON or neither shape → `ApiEndpointsFileUnparsableError` → service logs `"API endpoints file could not be parsed"` at error level and answers `endpoints_unparsable`; nothing written or deleted. The snapshot path treats it as Official.
- Switch on with no enabled endpoint that has a selected model → `no_usable_model`.
- Default model not among usable models while turning on → `invalid_input`.
- Old `set_active` on an endpoint with no models → `no_usable_model`.
- New save: unknown format, two URLs of one format, no URL → `invalid_input`.

### 5. Good/Base/Bad Cases

- Good: legacy file with both agents active → list shows both switches on, the two active endpoints on and the rest off, file bytes unchanged until the first write.
- Base: two endpoints both select `shared`; deleting the first keeps the default `shared` and moves the CLI to the second.
- Bad: old `set_active(B)` when an earlier enabled endpoint A also selects the projected default → `activeEndpointId` stays A. Correct by the projection rule; give B different model names in a test that needs a real switch.

### 6. Tests Required

- `daemon-e2e/api-endpoint-host-wide.e2e.test.ts`: legacy read (agents, enabled, baseUrls, active ids, file untouched); first write upgrades and drops `active` / `provider` / `baseUrl` / `defaultModelId`, slugs `relay-a`, `relay-b`, `api-1`, `relay-a-2`; corrupt file kept and logged; no `slug` or key in list/save responses, `keys.json` `0600`; switch refusals and auto default; missing-default rule for delete, endpoint off and model removal, CLI restored when nothing is left; projection list, `set_active`, old save, deduped snapshot.
- The older `api-endpoint-*` e2e files assert the gateway wiring (ticket 03 rewrote their file expectations).
- `packages/protocol`: `messages.api-endpoint.test.ts` (new fields, both new messages, feature flag) and `messages.wire-compat.test.ts` (an old-client copy of the list schema parses a host-wide response).

### 7. Wrong vs Correct

#### Wrong

```ts
// Writes endpoints.json first: a CLI conflict leaves the state saying "on" while the file says Official.
this.store.writeState(next);
this.syncCli("claude", cliTarget(next, "claude"), keyOf);
```

#### Correct

```ts
const next = await this.commit(state, proposed, { keys }); // settle → CLI files → keys → state → notify
```

## Scenario: moving a Codex conversation to another Codex model provider

Reference implementation: cli-wiring-web-search ticket 13 (`server/codex-conversations/move-to-model-provider.ts`, `model-providers.ts`, magpie `internal/sessions/codex_provider.go` MIT; ADR 0011). Ticket 14 adds batch moves and the resume-error button on the same RPC (`threadIds`).

- RPCs: `provider.codex.session.list_model_providers.request/.response` (targets: the config's tables, built-in `openai`, Osuna's own — listed but unselectable with a reason when `config.toml` has no Osuna table) and `provider.codex.session.move_model_provider.request/.response` (`providerId` required: the Codex provider whose Session history row it is; its own `CODEX_HOME` from that provider's env is where files, `config.toml` and `state_*.sqlite` are read — as magpie's `codexHomeOf(path)`). Permissions `daemon.read` / `daemon.manage`. UI gated on `apiEndpointCliWiring`.
- Skip a conversation whose file was written in the last minute (`reason: "active"`); `not_found` when no file. Before changing anything, check Node has `sqlite` and zstd, else change nothing.
- Backup first: copy every rollout file (plain and zstd twin) to `$PASEO_HOME/codex-model-provider-moves/<id>/` with `move.json` (thread id, from, to, at, file pairs), written with `writePrivateFileAtomicSync`, never read back. No guarded re-read before rename: the one-minute rule is the concurrency guard (ADR 0011).
- Rewrite each `session_meta` carrying a provider — provider only, other bytes unchanged; zstd recompressed; temp file beside, fsync, mtime restored (Node keeps microseconds), rename. A file-step failure restores the changed files from the backup → `failed` with `backupPath`. Then each `state_*.sqlite`'s row for the thread; a missing table or a failing `pragma_table_info` is skipped (magpie); a DB failure leaves files moved → `state_database_failed` with `backupPath`. An unparsable `config.toml` doesn't abort the move. Settings-snapshot events keep the old provider (magpie). Moving back to the original provider restores plain files byte for byte.
- Ticket 14: Session history multi-select moves rows of one provider at a time (one `CODEX_HOME` per move) and lists per-row results. Codex's ``Model provider `…` not found`` on resume becomes `CodexModelProviderMissingError` (`codex-conversations/model-provider-missing.ts`); import, `resume_agent_request` and `refresh_agent_request` map errors through `toAgentResumeWireError` (`agent-resume-errors.ts`) so the wire error carries `codex_model_provider_missing` (`CODEX_MODEL_PROVIDER_MISSING_ERROR_CODE`) and the app never matches English text. The app shows the explanation and the move button in Session history's import error and in the archived agent callout; an unarchive (`refresh_agent_request`) that fails to resume puts the agent back in the archive with the error kept only when `isCodexModelProviderMissing(error)` (walks `cause` for `CodexModelProviderMissingError`); any other resume failure leaves the agent unarchived and still returns `agent_refresh_failed`. Worktree restore depends on that: unarchiving an agent whose workspace directory is gone fails on the missing cwd, yet the agent must end up unarchived (`worktree-restore.spec.ts`; `session.workspaces.test.ts` "cannot resume because …" covers both branches). `resume_agent_request` (CLI only) still re-archives on any failure; the difference is intentional. Not covered (user deferred): an unarchived agent that fails to load after a daemon restart ("Failed to load agent" page).
- Known limit (verified with real Codex 0.163.0, temp `CODEX_HOME`): if Codex rebuilds its state DB before the moved conversation is resumed once, the move reverts; the dialog says to resume once.

## Scenario: a folder of files an agent edits in batches, inside the workspace

Reference implementation: logic maps (`server/logic-map/`, logic-map ticket 02). Reuse this shape when agent tools write several files that must change together, in the user's repo rather than `$PASEO_HOME`.

### 1. Scope / Trigger

- One logical write touches a skeleton JSON plus per-item Markdown files, can come from two agents at once, and the files are hand-editable (they live in git under `<cwd>/docs/logic-maps/<name>/`).

### 2. Signatures

- `updateLogicMap(location: { cwd, mapName }, operations): Promise<{ skeleton, warnings }>` (`logic-map-store.ts`); `applyLogicMapOperations(current, operations)` is pure and returns `{ skeleton, docWrites, docDeletes, externalLinks, problems, warnings }` (`logic-map-operations.ts`).
- `parseLogicMapSkeleton(value)` (`logic-map-skeleton.ts`): the disk schema. Wire schema `LogicMapSkeletonSchema` lives in `@getpaseo/protocol/messages`.
- Tools `read_logic_map` / `update_logic_map` (`logic-map-tools.ts`), registered next to `create_agent`; they resolve the map from the caller agent's `paseo.logic-map` label and `cwd`, never from tool input.

### 3. Contracts

- Two schemas: the disk schema is `.strict()` with non-empty ids/titles so a hand-broken file reads as corrupt; the wire schema stays loose and pure so an old client parses a map with fields it does not know. New disk fields are optional with a default (`failure: z.boolean().default(false)`).
- Validate the whole batch first (pure apply + external-file checks); any problem → `LogicMapUpdateRejectedError(problems)` and nothing touches disk.
- Writes are serialized per resolved folder (`runExclusive`), so concurrent batches both land instead of last-write-wins.
- Write order: docs → skeleton (atomic) → deletes. Before writing, `snapshotFiles` captures every file the batch touches; any failure runs `restoreFiles(snapshot)` and rethrows.
- Derived flags (`pendingLink`) are recomputed over all nodes on every batch, not only the nodes written in it, so a later framework change updates old nodes.
- Missing node docs are a warning, not a rejection (logic-map ticket 09): after every batch `missingDocWarnings` lists each non-subgraph node that should have a doc and has none — framework `none`: `doc === null`; framework present: no notes and no external link — as `id (title)` in the same `warnings` array as the 20-node reminder, and the instruction block tells the agent the tool lists them. Before the framework is judged nothing is listed. Subgraph nodes are exempt because clicking one enters its layer, so a doc on it has no way to be opened; the app's "没有文档" tag (`isMissingDoc`, `app/src/logic-map/layout.ts`) uses the same rule, change both together. Without the warning, Codex and Pi wrote docs for 3 of 43 and 7 of 20 nodes in real runs.
- External-file checks branch on the error code: `ENOENT`/`ENOTDIR` → "does not exist", `EISDIR` → "is a folder", anything else rethrows.

### 4. Validation & Error Matrix

- Caller has no label → `LogicMapOffError`. Bad batch → `LogicMapUpdateRejectedError` with every problem listed for the agent. Over 20 nodes in a layer → written, plus a warning. Non-subgraph node missing its doc (framework judged) → written, plus a warning naming it. Hand-broken `map.json` on read → readable "which map, which file, what problem" error to clients.

### 5. Good/Base/Bad Cases

- Good: two agents update the same map concurrently; both changes are on disk.
- Base: a batch with one bad edge; nothing changes on disk.
- Bad: `fs.readFile(p).catch(() => null)` to test existence — EACCES reads as "missing".

### 6. Tests Required

- `logic-map-tools.test.ts`: one rejection case per rule (`test.each`), concurrency, rollback on a real write failure (a 240-char id makes the temp filename hit `ENAMETOOLONG`), `pendingLink` across framework changes, missing-doc warnings in both framework modes (listed, cleared once filled, subgraph nodes never listed), external heading matching (setext, inline code, links, fenced code ignored).
- `logic-map-store.test.ts`: disk schema rejects empty id/title and unknown fields; missing `failure` reads as `false`.

### 7. Wrong vs Correct

#### Wrong

```ts
for (const [file, content] of docWrites) await writeFileAtomic(file, content);
await writeJsonFileAtomic(skeletonFile, skeleton); // fails → new docs stay on disk
```

#### Correct

```ts
const snapshot = await snapshotFiles([...docFiles, skeletonFile, ...docDeletes]);
try { /* docs → skeleton → deletes */ } catch (error) { await restoreFiles(snapshot); throw error; }
```

## Anti-patterns

- `JSON.parse(raw) as StoredAgentRecord`. Parse with the schema.
- A service reading and writing the JSON file itself instead of calling the store.
- Adding a field to a persisted record without adding it to `docs/data-model.md`.
- Catching a parse error and returning a partially built record. Invalid rows are dropped or reported, not repaired silently.
