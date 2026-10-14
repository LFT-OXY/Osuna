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

### Adding a field that records host state at creation

`apiEndpointId` on the agent record (api-endpoint ticket 08) records the API
endpoint active when the session was created. Unlike `providerSessionIds` it is
set once and never updated.

- **Absent is a real value.** Missing means Official for old and new records alike, so an Official session writes nothing; no `null`, no backfill.
- **Every path that rebuilds a `ManagedAgent` carries it:** `registerSession` options (create, import, resume, reload), `dispatchStoredAgentState` for closed records, and `toStoredAgentRecord`. A path that forgets it silently turns the session into "Official" on the next persist.
- The resume comparison and the notice it produces are in [RPC and Protocol](./rpc-and-protocol.md#scenario-a-one-off-timeline-notice-the-daemon-adds-on-resume).

### Bringing a stored agent back is not activity

Loading an agent's runtime is neither the agent working nor the user reading the
chat. A path that rebuilds a `ManagedAgent` from a stored record must leave the
record's last-updated time and its attention as they were (upstream #5040, merged
in `e9d32a17d`).

- **Pass `restoring: true` to `registerSession`** from any path that brings a known agent back. `resumeAgentFromPersistence` and `reloadAgentSession` do; create and import do not. Without it registration calls `touchUpdatedAt`, the stamp is persisted, and workspace `statusEnteredAt` is re-derived from persisted `updatedAt` on the next daemon start, so the sidebar's "last used" is rewritten permanently.
- **Carry attention in, do not let it default.** `ensureAgentLoaded` passes `{ ...extractTimestamps(record), attention: extractAttention(record) }`. A resume that omits `attention` starts with `{ requiresAttention: false }` and persists it: the chat drops out of Ready to review without the user opening it.
- **Read a record's last-updated time with `resolveStoredAgentUpdatedAt(record)`** (`persistence-hooks.ts`), never `record.updatedAt` or `record.lastActivityAt` alone. Renaming, labelling, unarchiving, marking unread, and clearing attention move `updatedAt` on an unloaded agent without touching `lastActivityAt`. A payload built from the older of the two is dropped by the client (`acceptAgentDirectoryUpdate` rejects state that goes backwards), which is how an unread dot gets stuck.
- Osuna's resume-by-handle path in `session.ts` resumes into a new id and passes only `apiEndpointId`. It has no stored timestamps or attention to carry, and `restoring: true` still applies to it through `resumeAgentFromPersistence`.
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

## Files and secrets

- Keypairs and other private files go through `server/private-files.ts` (mode `0600`).
- `paseo.pid` is a lock and endpoint record owned by the supervisor; read it, never write it from a feature (`docs/architecture.md` "Storage").
- Temporary directories in tests come from `mkdtemp` and are removed in `afterEach`; the harness in `server/test-utils/paseo-daemon.ts` does this for you.

## Scenario: rewriting a config file another program owns

Reference implementation: API endpoints (api-endpoint tickets 01–02, conflict guard and health in 06; api-endpoint-auto-switch ticket 03 changed *what* is written). `server/api-endpoints/` rewrites Claude Code's `settings.json` and Codex's `config.toml` so the CLI talks to the daemon's own gateway (`/api-endpoint-gateway`) with a per-agent token; the real key never leaves the daemon. The editing rules are in `docs/adr/0004-api-endpoint-rewrites-cli-config.md`, what the keys hold in ADR 0007 (draft: the task's `adr-draft.md`); this is how the code keeps them.

### 1. Scope / Trigger

- The daemon writes a file that the CLI, the user, other tools, and Osuna's own terminal hooks also write. Anything outside the keys the daemon owns is someone else's data, including formatting and permission bits.

### 2. Signatures

- Pure patch: `applyClaudeApiEndpoint({ text: string | null, wiring: { baseUrl, token, model }, takeover }) → { kind: "patched", text, takeover } | { kind: "unparsable", message }` and `restoreClaudeOfficial({ text, takeover }) → patched | { kind: "delete" } | { kind: "missing" } | unparsable` in `claude-settings-patch.ts`. No I/O.
- Store: `ApiEndpointStore` (`store.ts`): `readState()` / `writeState(state)` for `endpoints.json` (see the next scenario), `getApiKey` / `setApiKey` / `removeApiKey`, `readClaudeTakeover` / `writeClaudeTakeover`, `writeClaudeSettingsBackup(bytes, at)`, `readGatewayTokens` / `writeGatewayTokens` (empty → file deleted), `codexModelCatalogPath` / `readCodexModelCatalog` / `writeCodexModelCatalog(text | null)`, `removeLegacyCodexKeyFile()`.
- Service: `ApiEndpointService` (`service.ts`) resolves the path (`resolveAgentHookConfigPath(claudeAgentHookProvider, { env, homeDir })`, so `CLAUDE_CONFIG_DIR` wins), serializes every mutation through one promise queue, and does the file I/O.
- Codex pure patch (`codex-config-patch.ts`): `applyCodexApiEndpoint({ text, wiring: { baseUrl /* ends in /v1 */, token, model, catalogPath }, takeover }) → patched { text, takeover } | unparsable`; `restoreCodexOfficial({ text, takeover }) → patched | delete | missing | unparsable`; `removeCodexProviderTable({ text }) → patched | missing | unparsable` (only for the v0.15 leftover cleanup).
- Codex model catalog (`codex-model-catalog.ts`): `buildCodexModelCatalog(state) → string` (JSON). Entries carry `base_instructions` = `CODEX_BASE_INSTRUCTIONS` (`codex-base-instructions.ts`, vendored from openai/codex, Apache-2.0).
- Codex path: `resolveCodexConfigPath()` takes the directory of the Codex hooks installer path (`CODEX_HOME` wins) plus `config.toml`.
- Guarded write (`config-file.ts`): `writeConfigFileGuarded<T>({ filePath, compute(current: Buffer | null) → { change: write{text} | delete | keep, value: T }, commit(value), rollback(), beforeRecheck? }) → { kind: "written", value } | { kind: "conflict" }`. The service wraps it as `writeConfigFile`, passes `compute(text, bytes)`, and turns `conflict` into `ApiEndpointRequestError("config_conflict")`. Every write and restore of `settings.json` / `config.toml` goes through it.
- Inspect (pure, for health): `inspectClaudeSettings({ text, takeover }) → { kind: "parsed", modifiedKeys, baseUrl } | unparsable`; `inspectCodexConfig({ text, takeover }) → { kind: "parsed", modifiedKeys, profileOverride: { profile, keys } | null, baseUrl } | unparsable`. `takeover` is null in Official; the Codex table to check is `takeover.table`.
- Gateway address: `ApiEndpointService.attachGateway(url: string | null): Promise<void>`, called by bootstrap right after the main listener binds with `createApiEndpointGatewayUrl(boundListenTarget)` (`http://127.0.0.1:<port>/api-endpoint-gateway`; `0.0.0.0` → `127.0.0.1`; `null` for a socket or pipe). Before it runs the service is `pending`.
- Injection: `PaseoDaemonConfig.apiEndpoints: { env?, homeDir?, beforeConfigRecheck?, gatewayHeaderTimeoutMs? }`. `beforeConfigRecheck` is a test seam only: the daemon tests write the file from it to simulate another tool. `createTestPaseoDaemon` defaults it to a temp `CLAUDE_CONFIG_DIR` and `CODEX_HOME`, so no test daemon can touch the real `~/.claude` or `~/.codex`. There is no Codex version check and no `providerRuntimeSettings` option any more.

### 3. Contracts

- The takeover record keeps each owned key's `original` (`{ present: false }` or `{ present: true, value }`) and `written`, plus `originalFile` (`absent` / `empty` with its text / `content`). Originals are taken from the first takeover only; a later rewrite (new port, new default model) keeps them.
- Claude writes `env.ANTHROPIC_BASE_URL` (gateway), `env.ANTHROPIC_AUTH_TOKEN` (token), `env.ANTHROPIC_API_KEY: ""`, top-level `model` (`takeover.model`, optional because v0.15 records lack it), and the WebSearch deny entry. `ANTHROPIC_MODEL`, `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU,FABLE}_MODEL` and `ANTHROPIC_SMALL_FAST_MODEL` are recorded with `written: null` and removed — only when present at takeover or already in the record — and come back on Official at the end of `env` (jsonc appends; values equal, position not).
- Codex writes top-level `model_provider = "osuna_api_endpoint"`, `model`, `model_catalog_json` (absolute path of `codex-models.json`) and the table `[model_providers.osuna_api_endpoint]` with `name = "Osuna"`, `base_url` (gateway + `/v1`), `wire_api = "responses"`, `experimental_bearer_token` (token in plain text). The record adds `table: { baseUrl, bearerToken }` and `fileCreated`. Official restores the three keys and removes the table; `fileCreated` and nothing left → `delete`. This replaces ADR 0004's "the table stays after Official".
- Only the agent switch, the default model, the gateway URL and the token reach the CLI files. Editing an endpoint's URL, key or models never rewrites them; the Codex catalog (visible bare names deduped + hidden `slug/model` per enabled endpoint) is regenerated in `commit` whenever its text changes, written before `config.toml` so the path never dangles, put back on a failed commit, deleted when Codex is Official.
- Order of one guarded attempt: read bytes + sha256 → `compute` (throws `config_unparsable` before anything is written) → stage a temp file next to the target → `commit` (takeover record, first-write backup, Codex key file) → `beforeRecheck` → re-read and compare the hash → `rename` (or `rm` for `delete`). A changed hash calls `rollback` and recomputes on the new content; after three attempts the result is `conflict` and nothing is left changed. `commit` goes before the re-read so the gap between the check and the rename holds no other disk writes (ADR 0004: "re-read it just before the atomic rename"). The reverse order (file first, record second) loses the originals on a crash.
- `rollback` restores the previous takeover record and key bytes and deletes a backup made in that attempt, so a retried first write leaves exactly one backup.
- The backup is taken once per file lifetime: `backup: null` = never rewritten, `{ path: null }` = the file did not exist at the first write. Never back up a file the daemon already wrote.
- The CLI file is replaced atomically with its previous mode bits (new file: `0600`, because it now holds a token). `writePrivateFileAtomicSync` is wrong here: it forces `0600` on the file and `0700` on `~/.claude`.
- Codex: edit TOML by splicing text at `toml-eslint-parser` node ranges, never by re-serializing. `original` for a top-level key is `{ present: true, raw }`, the value's source text with its quotes. Every edit re-parses its output and checks the written values; failure is `unparsable`.
- Codex switch order: compute the patch (nothing written on `unparsable`) → commit writes `takeover-codex.json` → re-read check → replace `config.toml` → delete a v0.15 `codex-api-key` if present. A failed check or replace writes back the previous takeover record; `endpoints.json` and `gateway-tokens.json` are written only after every CLI file succeeded (`commit`, next scenario).
- Delete of an endpoint: the settle rule moves each agent's default or sends it to Official, and the CLI files follow only if the default changed. Any CLI failure (`config_conflict`) leaves `endpoints.json` and the key untouched, so the endpoint and the mode stay.
- Health is read on `list` only, never by a watcher: owned keys vs `written` (Claude `env.*` including removed keys that came back, top-level `model`, the WebSearch deny entry the daemon added; Codex the three top-level keys and every field of the table). Other keys never count.
- Start-up (`attachGateway`): tokens are backfilled for agents that are on without one (legacy conversion never went through off→on); an agent that is on is rewritten only when the recorded gateway URL or token differs from now (port change, backfilled token, v0.15 record that pointed straight at a relay) — an outside edit of `model` is reported, not overwritten. Official Codex: a leftover v0.15 table and key file are removed. Errors are logged; the daemon still starts.
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

- `claude-settings-patch.test.ts`: exact expected text after apply; restore equals the input byte for byte; empty-string original; absent file → `delete`; user's `{\n}` kept; user-owned `"WebSearch"` survives; unparsable shapes; model/tier/small-fast variables removed and restored by value; a v0.15 record (relay URL, real key, `ANTHROPIC_MODEL`) taken over and restored.
- `daemon-e2e/api-endpoint-claude.e2e.test.ts`: create → activate → file holds gateway URL + token + top-level `model`, never the key → Official → file byte-identical and `gateway-tokens.json` gone; the token answers `/api/hello` 200 while on and 401 after; key absent from every response and from `config.json`; `keys.json` mode `0600`; `settings.json` keeps `0644`; no backup when the file started absent.
- `codex-config-patch.test.ts`: exact text after apply; Official restores the bytes and removes the table; apply twice is identical; a v0.15 `auth` table replaced; CRLF and BOM kept; inline `model_providers` refused; the dedicated id fails `ProviderOverridesSchema`.
- `codex-model-catalog.test.ts`: visible/hidden order and names, required fields and base instructions, no duplicate slug.
- `daemon-e2e/api-endpoint-codex.e2e.test.ts` (POSIX): exact `config.toml` with port and token; catalog follows models, endpoint switch and agent switch; `auth.json` byte-identical; unparsable refused with no catalog; read-only `CODEX_HOME` keeps the previous mode and catalog.
- `daemon-e2e/api-endpoint-gateway.e2e.test.ts` "across daemon starts": restart on another port rewrites only the URL; legacy-on agents get tokens and a pointed config on start; v0.15 table and key file removed on start; socket listener refuses turn-on with `gateway_requires_tcp` and leaves files alone.
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

- Stored endpoint: `id`, `slug` (generated from the name, locked, never a field in any response; it reaches clients only inside the opaque `<slug>/<model>` ids of the provider snapshot's `apiEndpointModelGroups`, see rpc-and-protocol.md "host state that replaces a provider's model catalogue"), `name`, `baseUrls: [{ format: "anthropic_messages" | "openai_chat" | "openai_responses", url }]` (one per format, canonical order, at least one), `models`, `modelMapping?` (any format), `enabled`, `legacyDefaultModelId?`, `catalog?: { fetchedAt, models }` (last upstream listing, written only by a format fetch for a saved endpoint), `manualModels?` (hand-added names, kept whether selected or not), `createdAt`, `updatedAt`. Array order is creation order. Only `models` is "selected"; routing never reads `catalog` or `manualModels` (see rpc-and-protocol.md, "fetch_models and test_connection by base URL and request format").
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

## Anti-patterns

- `JSON.parse(raw) as StoredAgentRecord`. Parse with the schema.
- A service reading and writing the JSON file itself instead of calling the store.
- Adding a field to a persisted record without adding it to `docs/data-model.md`.
- Catching a parse error and returning a partially built record. Invalid rows are dropped or reported, not repaired silently.
