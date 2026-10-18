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

## Scenario: rewriting a config file another program owns

Reference implementation: API endpoints (api-endpoint tickets 01–02, conflict guard and health in 06; api-endpoint-auto-switch ticket 03 changed *what* is written, ticket 17 added `modelPicker`, ticket 18 the model hints). `server/api-endpoints/` rewrites Claude Code's `settings.json` and Codex's `config.toml` so the CLI talks to the daemon's own gateway (`/api-endpoint-gateway`) with a per-agent token; the real key never leaves the daemon. The editing rules are in `docs/adr/0004-api-endpoint-rewrites-cli-config.md`, what the keys hold in ADR 0007 (draft: the task's `adr-draft.md`); this is how the code keeps them. ADR 0012 (cli-wiring-web-search) replaces parts of both — JSONC `settings.json`, following the CLI's own saved model and thinking level, new owned keys, the kept claude.ai sign-in — and ADR 0010 changes what Codex gets under a ChatGPT sign-in; the code catches up ticket by ticket, so check those ADRs before following a rule below that they contradict.

### 1. Scope / Trigger

- The daemon writes a file that the CLI, the user, other tools, and Osuna's own terminal hooks also write. Anything outside the keys the daemon owns is someone else's data, including formatting and permission bits.

### 2. Signatures

- Pure patch: `applyClaudeApiEndpoint({ text: string | null, wiring: { baseUrl, token, model, modelPicker: ClaudeModelPickerOption[], hintEnv: ClaudeHintEnv }, takeover }) → { kind: "patched", text, takeover } | { kind: "unparsable", message }` and `restoreClaudeOfficial({ text, takeover }) → patched | { kind: "delete" } | { kind: "missing" } | unparsable` in `claude-settings-patch.ts`. No I/O.
- Store: `ApiEndpointStore` (`store.ts`): `readState()` / `writeState(state)` for `endpoints.json` (see the next scenario), `getApiKey` / `setApiKey` / `removeApiKey`, `readClaudeTakeover` / `writeClaudeTakeover`, `writeClaudeSettingsBackup(bytes, at)`, `readGatewayTokens` / `writeGatewayTokens` (empty → file deleted), `codexModelCatalogPath` / `readCodexModelCatalog` / `writeCodexModelCatalog(text | null)`, `removeLegacyCodexKeyFile()`.
- Model hints (pure, `claude-model-hints.ts`, after magpie's `claude1M` / `claudeWindow` / `claudeOutput` / `claudeCaps`): `markOneMillion({ id, facts }) → id | id + "[1m]"`; `claudeHintEnv({ start: ClaudeHintModel, listed: ClaudeHintModel[] }) → Partial<Record<"CLAUDE_CODE_MAX_CONTEXT_TOKENS" | "CLAUDE_CODE_MAX_OUTPUT_TOKENS" | "CLAUDE_CODE_MODEL_CAPABILITIES", string>>`. `ClaudeHintModel = { id /* as Claude Code sees it */, facts: ModelFacts }`.
- Model facts (`model-facts.ts`, after magpie's `catalog.go`): `ModelFacts = { context?, output?, efforts? }`; `indexModelsDev(apiJson) → ModelsDevIndex` (by bare lowercase id, the value most providers give, ties to the smaller / fewer levels, window = input limit else context, under 2048 = unknown); `lookupModelFacts(index, id)` (bare id, then without a `:suffix`; unknown → `{}`); `mergeModelFacts(listed, known)` per field, the endpoint's list first. `fetchUpstreamModels` returns `ListedModel = ApiEndpointModel & { facts? }` read from `max_input_tokens` / `context_length` / `context_window`, `max_output_tokens` / Anthropic's `max_tokens` (only next to `max_input_tokens`) / `top_provider.max_completion_tokens`, `supported_reasoning_levels` / `capabilities.effort.<level>.supported`.
- models.dev (`models-dev.ts`): `new ModelsDevCatalog({ filePath, logger, now?, isAllowed, onUpdated, fetch?, timers? })` with `facts(id)`, `start()` (first check in 30 s), `wake()` (check now), `dispose()`. Same schedule as the price table (24 h, 1 h retry, `If-None-Match`, 15 s timeout); `isAllowed` is asked before every request: price-table auto-update on AND Claude Code or Codex switch on (cli-wiring-web-search ticket 07; both off → no download, the first switch turned on triggers a check). An update or an endpoint list refetch rewrites `settings.json` hints and `codex-models.json`.
- Codex catalog entries (ticket 07, `codex-model-catalog.ts` `codexModelEntry`, reused by ticket 10's merged list; magpie MIT): facts come from the endpoint's own listing first, then models.dev (`mergeModelFacts`), looked up at the first enabled endpoint that selected the model. Known context → `context_window` only (no `max_context_window`, as magpie); efforts → `supported_reasoning_levels` passed as-is, trimmed, deduped, empties dropped (`codexReasoningLevels` — Codex takes any non-empty name, an empty one breaks the whole file); default level as magpie's `ModelDefault` / `NearestEffort` (`codexDefaultLevel`); vision → `input_modalities` (`takesImages`). Unknown facts keep the old defaults: 272K, four fixed levels, no `input_modalities` (Codex then assumes images — also true for an old `models-dev.json` without the vision fact until the next download). No reply limit: Codex's `ModelInfo` has no such field (openai/codex `codex-rs/protocol/src/openai_models.rs:408-515` @ ce0323f2).
- Service: `ApiEndpointService` (`service.ts`) resolves the path (`resolveAgentHookConfigPath(claudeAgentHookProvider, { env, homeDir })`, so `CLAUDE_CONFIG_DIR` wins), serializes every mutation through one promise queue, and does the file I/O.
- Codex pure patch (`codex-config-patch.ts`): `applyCodexApiEndpoint({ text, wiring: { baseUrl /* ends in /v1 */, token, model, catalogPath }, takeover }) → patched { text, takeover } | unparsable`; `restoreCodexOfficial({ text, takeover }) → patched | delete | missing | unparsable`; `refreshCodexProviderTable({ text, table }) → patched | absent | unparsable` — at every daemon start, switch on or off, points a table that is there at the current gateway URL and token and replaces a v0.15 `auth.command` table the same way (no table → writes nothing).
- Codex model catalog (`codex-model-catalog.ts`): `buildCodexModelCatalog(state) → string` (JSON). Entries carry `base_instructions` = `CODEX_BASE_INSTRUCTIONS` (`codex-base-instructions.ts`, vendored from openai/codex, Apache-2.0).
- Codex sign-in wiring (cli-wiring-web-search ticket 09, ADR 0010): the sign-in is asked from Codex itself — a temporary `codex -c model_provider="openai" app-server` answering `account/read` (`codex-sign-in.ts` `createCodexSignInReader`, `CODEX_HOME` = the directory of the `config.toml` being rewritten), never `auth.json` or the keychain — before switching Codex on, on status read while Codex is on, and once in the background after the gateway attaches; an unknown answer keeps the current wiring. Injection `readCodexSignIn` (test daemons default to a fake answering signed out; the app e2e upgrade seal blocks the probe — tests never spawn real Codex). ChatGPT wiring: top-level `openai_base_url` = gateway + `/backend-api/codex` (a user-written one is recorded and restored, magpie replaces it too), Osuna's `model_provider` / `model_catalog_json` removed, the Osuna table still written, `model` untouched — except when a user-written top-level `model_provider` (not `openai`, not a CC Switch mirror) is removed (recorded, restored on switch-off, at the end of the top-level keys): then `model` = magpie `connect`'s pick (same name, then the tier's family, else the first) as `slug/model`. API key or signed out: the old wiring. A sign-in change rewrites with the new wiring and restores the old wiring's keys, unless the file was changed externally (then it waits for Re-apply). An externally changed `openai_base_url` is "not through the gateway". CC Switch-style OpenAI mirror tables (ticket 11, magpie `isCCSwitchMirror` / `takeMirrors` / `giveMirrors`: a `[model_providers.<id>]` header table — inline and dotted forms are not tables to magpie either — with `name = "OpenAI"`, `requires_openai_auth`, no `base_url`, not named by a profile): under the ChatGPT wiring with the switch on, their `base_url` = the gateway's ChatGPT backend; the record keeps optional `mirrors.<id> = { original, written }` and only grows — a mirror stays recorded while its address is still the one Osuna wrote (even if later profile-named or renamed, then no longer rewritten on a port change) and is dropped only once the address changed; switch-off or the API-key wiring removes/restores every recorded mirror still holding our address. A changed mirror address reports `model_providers.<id>.base_url` as "not through the gateway" (`isCodexMirrorKey`); Re-apply no longer wires a table that stopped looking like a mirror.
- Claude `settings.json` as JSONC (cli-wiring-web-search ticket 15, ADR 0012, `claude-settings-patch.ts`): a leading BOM is split off on read (`splitBom`) and put back on write; comments and trailing commas parse with `jsonc-parser`; only owned keys are edited and every other byte stays — `editBesideComment` keeps a line-end comment on its line when a key is added at, or removed from, the end (jsonc-parser would move or drop it). Restore is byte-exact, comments included. A file with comments or trailing commas is still rewritten and, while the switch is on, reports hint `settings_has_comments` (`isReadableByClaudeCode: false`; Claude Code skips the whole file — non-interactive SDK sessions only debug-log it, verified in Claude Code 2.1.302's shipped code, so Osuna's Claude chats go official) with fix steps. A file even JSONC can't read is refused with `config_unparsable` and `ApiEndpointError.params` (`reason`: `syntax` with line/column, `root_not_object`, `key_not_object`, `key_not_array`); `ApiEndpointRequestError` takes one object parameter. Paths in copy abbreviate home as `~`.
- Claude cloud-platform switches (cli-wiring-web-search ticket 16, ADR 0012, `claude-cloud-switches.ts`, magpie `claudeClouds` / `claudeSwitchOn` / `claudeCloud` MIT): takeover removes `CLAUDE_CODE_USE_{BEDROCK,VERTEX,FOUNDRY,ANTHROPIC_AWS,ANTHROPIC_GOOGLE_CLOUD,MANTLE}` that are on in `settings.json` `env`, recording them in optional `takeover.clouds` (`COMPAT(claudeCloudSwitchRecord)`); switch-off puts back each one the user hasn't set again since; off switches and other cloud vars untouched. While the switch is on, a switch on in managed settings (macOS `/Library/Application Support/ClaudeCode`, Linux `/etc/claude-code`, Windows `C:\Program Files\ClaudeCode`, incl. `managed-settings.d/`), `~/.claude.json` `env` or the login-shell environment reports hint `cloud_switch_on` with its source (one at a time, first found, as magpie); a managed `env.ANTHROPIC_BASE_URL` that doesn't reach the gateway reports `managed_base_url` as "not through the gateway" — `gateway-reach.ts` probes it like magpie's `proxyBase` / `probedNow` (20 s memo) against the gateway's `GET /` → `{"name":"osuna"}`. Sources Osuna can't edit offer Switch to official, Keep current settings and How to fix — no Re-apply. Login-shell env: `login-shell-env.ts` asks the login shell (`-ilc`, then `-lc`) plus fish and nushell when installed and configured, first answer per variable, one-minute cache, never on Windows, falling back to the process env. All three readers are replaceable; test daemons answer nothing and app e2e points `PASEO_CLAUDE_MANAGED_SETTINGS_DIR` at a temp dir — tests never read the real managed dir, `~/.claude.json` or spawn a real shell.
- Claude Code fixes (cli-wiring-web-search ticket 17, magpie MIT): `claudeSpelled` (`claude-spelling.ts`, magpie `ClaudeSpelled`) rewrites a dotted Claude version in the written `model` and Osuna's own `modelPicker` rows only when the hyphen form uniquely matches an on-sale id (other vendors and user-written rows untouched; ticket 22 reuses it for background/Subagent models). `env.CLAUDE_CODE_AUTO_MODE_SERVER=0` is written while no reachable model is reviewed by Anthropic (`isAutoModeReviewed`: a Claude-named selected/mapped model or an `api.anthropic.com` endpoint with models selected), recomputed on every rewrite and part of the CLI fingerprint, ownership kept in the takeover's `hintEnv` (a user-written value is never touched; removed on switch-off). Capability hints add xhigh for a non-Claude model that reaches max.
- Codex path: `resolveCodexConfigPath()` takes the directory of the Codex hooks installer path (`CODEX_HOME` wins) plus `config.toml`.
- Guarded write (`config-file.ts`): `writeConfigFileGuarded<T>({ filePath, compute(current: Buffer | null) → { change: write{text} | delete | keep, value: T }, commit(value), rollback(), beforeRecheck? }) → { kind: "written", value } | { kind: "conflict" }`. The service wraps it as `writeConfigFile`, passes `compute(text, bytes)`, and turns `conflict` into `ApiEndpointRequestError("config_conflict")`. Every write and restore of `settings.json` / `config.toml` goes through it.
- Inspect (pure, for health): `inspectClaudeSettings({ text, takeover }) → { kind: "parsed", modifiedKeys, baseUrl } | unparsable`; `inspectCodexConfig({ text, takeover }) → { kind: "parsed", modifiedKeys, profileOverride: { profile, keys } | null, baseUrl } | unparsable`. `takeover` is null in Official; the Codex table to check is `takeover.table`.
- Gateway address: `ApiEndpointService.attachGateway(url: string | null): Promise<void>`, called by bootstrap right after the main listener binds with `createApiEndpointGatewayUrl(boundListenTarget)` (`http://127.0.0.1:<port>/api-endpoint-gateway`; `0.0.0.0` → `127.0.0.1`; `null` for a socket or pipe). Before it runs the service is `pending`.
- Injection: `PaseoDaemonConfig.apiEndpoints: { env?, homeDir?, beforeConfigRecheck?, gatewayHeaderTimeoutMs? }`; bootstrap also passes `isModelsDevAutoUpdate: () => usage.pricing.autoUpdate`, absent (never download) in tests unless set; tests drive downloads with the test-only `modelsDevFetch` / `modelsDevTimers` options (fake fetch, manual timers — never the real network). `beforeConfigRecheck` is a test seam only: the daemon tests write the file from it to simulate another tool. `createTestPaseoDaemon` defaults it to a temp `CLAUDE_CONFIG_DIR` and `CODEX_HOME`, so no test daemon can touch the real `~/.claude` or `~/.codex`. There is no Codex version check and no `providerRuntimeSettings` option any more.

### 3. Contracts

- The takeover record keeps each owned key's `original` (`{ present: false }` or `{ present: true, value }`) and `written`, plus `originalFile` (`absent` / `empty` with its text / `content`). Originals are taken from the first takeover only; a later rewrite (new port, new default model) keeps them.
- Claude writes `env.ANTHROPIC_BASE_URL` (gateway), `env.ANTHROPIC_AUTH_TOKEN` (token), `env.ANTHROPIC_API_KEY: ""`, top-level `model` (`takeover.model`, optional because v0.15 records lack it), the WebSearch deny entry (only while no endpoint that is on has `searchesWeb` with an Anthropic or Responses address — `someEndpointSearchesWeb`, cli-wiring-web-search ticket 04, ADR 0009; otherwise Osuna's own entry is removed, plus a `deny` / `permissions` it created that is now empty; the condition is part of the CLI fingerprint so a change rewrites the file; a user-written `"WebSearch"` is never touched), and top-level `modelPicker: { options: [{ model, label, description }] }`. `ANTHROPIC_MODEL`, `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU,FABLE}_MODEL` and `ANTHROPIC_SMALL_FAST_MODEL` are recorded with `written: null` and removed — only when present at takeover or already in the record — and come back on Official at the end of `env` (jsonc appends; values equal, position not).
- Codex writes top-level `model_provider = "osuna_api_endpoint"`, `model`, `model_catalog_json` (absolute path of `codex-models.json`) and the table `[model_providers.osuna_api_endpoint]` with `name = "Osuna"`, `base_url` (gateway + `/v1`), `wire_api = "responses"`, `experimental_bearer_token` (token in plain text). The record adds `table: { baseUrl, bearerToken }`, `fileCreated` and optional `tableKept` (cli-wiring-web-search ticket 03: "Keep current settings" while the table itself was changed outside Osuna — the table is the user's, startup `refreshCodexProviderTable` skips it until the switch is on again, ADR 0012). Official restores the three top-level keys and keeps the table (cli-wiring-web-search ticket 02, ADR 0010), so Codex conversations recorded under it still resume through the gateway; `fileCreated` and nothing left → `delete`.
- Claude `modelPicker` (ticket 17, after magpie's `writePicker`): one row per selected model of every endpoint that is on, built by `cliModels(state, provider, defaultModelId)` from `endpointModelGroups` (the chat model selector's order): `model` = `slug/model`, `label` = `model.label ?? model.id`, `description` = endpoint name; Codex always gets `[]`. Ownership is `takeover.modelPicker.written`: non-null means the file's `modelPicker` is the daemon's. A `modelPicker` in the file with `written: null` is the user's and is never touched, during the takeover or on Official; no rows → not written, and the daemon's own is deleted. Official deletes only the daemon's own. A daemon-written picker the user then edited is still the daemon's and is overwritten on the next rewrite (magpie does the same). Records from before ticket 17 have no `modelPicker` (`COMPAT(claudeModelPickerRecord)`).
- Claude model hints (ticket 18): facts for a picker row come from that endpoint's `catalog.models[].facts`, then models.dev; for the start model (a bare id) from the first enabled endpoint that selected it. `[1m]` goes on `model` and on every picker row whose window is ≥ 1M, Claude models included (Claude Code strips it before sending, verified on 2.1.299). `CLAUDE_CODE_MAX_CONTEXT_TOKENS` = the start model's window unless it is a Claude model, marked, or unknown. `CLAUDE_CODE_MAX_OUTPUT_TOKENS` = the least `output` over the start model and every non-Claude row, not written when the start model is a Claude model, any of those is unknown, or the least is ≤ 32000. `CLAUDE_CODE_MODEL_CAPABILITIES` = `pattern=effort[,xhigh_effort][,max_effort]` joined by `;`, start model first, one per non-Claude model with any of low/medium/high/xhigh/max; the pattern is the id lowercased (Claude Code lowercases the model, not the pattern — checked with `-effort` on 2.1.299), ids with `;=,` or a trailing `*` skipped, at most 8000 chars. Ownership is `takeover.hintEnv` (`{ [key]: value }`): a key is the daemon's only while the file holds exactly the recorded value; absent or the daemon's → written or deleted, otherwise the user's and never touched, not recorded, not deleted on Official, not reported as modified. Records from before ticket 18 lack `hintEnv` (`COMPAT(claudeModelHintRecord)`), which also triggers one rewrite on start. When facts change underneath — models.dev updated, or a refetched catalog changes `cliFingerprint` — `rewriteClaudeHints` rewrites `settings.json` unless Claude is off, the gateway has no URL, or `inspectClaude` reports an owned key modified (then it only logs). Facts never reach a client: `toWireModel` strips them from fetch results and the `catalog` projection.
- Only the agent switch, the default model, the gateway URL, the token and (Claude only) the picker rows and model hints reach the CLI files: `cliFingerprint` holds exactly these (`cliModels`), so renaming an endpoint, changing its selected models or its switch rewrites `settings.json`, while its URL or key never do; the Codex catalog (visible bare names deduped + hidden `slug/model` per enabled endpoint; every entry has `supported_reasoning_levels` low/medium/high/xhigh with Codex's own descriptions, `supports_reasoning_summaries: true`, and `default_reasoning_level` = the level nearest the top-level `model_reasoning_effort` of `config.toml` read by `readCodexReasoningEffort` — ties go up, never none, unset/unreadable/unknown → medium; ticket 16) is regenerated in `commit` whenever its text changes, written before `config.toml` so the path never dangles, put back on a failed commit, deleted when Codex is Official.
- Order of one guarded attempt: read bytes + sha256 → `compute` (throws `config_unparsable` before anything is written) → stage a temp file next to the target → `commit` (takeover record, first-write backup, Codex key file) → `beforeRecheck` → re-read and compare the hash → `rename` (or `rm` for `delete`). A changed hash calls `rollback` and recomputes on the new content; after three attempts the result is `conflict` and nothing is left changed. `commit` goes before the re-read so the gap between the check and the rename holds no other disk writes (ADR 0004: "re-read it just before the atomic rename"). The reverse order (file first, record second) loses the originals on a crash.
- `rollback` restores the previous takeover record and key bytes and deletes a backup made in that attempt, so a retried first write leaves exactly one backup.
- The backup is taken once per file lifetime: `backup: null` = never rewritten, `{ path: null }` = the file did not exist at the first write. Never back up a file the daemon already wrote.
- The CLI file is replaced atomically with its previous mode bits (new file: `0600`, because it now holds a token). `writePrivateFileAtomicSync` is wrong here: it forces `0600` on the file and `0700` on `~/.claude`.
- Codex: edit TOML by splicing text at `toml-eslint-parser` node ranges, never by re-serializing. `original` for a top-level key is `{ present: true, raw }`, the value's source text with its quotes. Every edit re-parses its output and checks the written values; failure is `unparsable`.
- Codex switch order: compute the patch (nothing written on `unparsable`) → commit writes `takeover-codex.json` → re-read check → replace `config.toml` → delete a v0.15 `codex-api-key` if present. A failed check or replace writes back the previous takeover record; `endpoints.json` and `gateway-tokens.json` are written only after every CLI file succeeded (`commit`, next scenario).
- Delete of an endpoint: the settle rule moves each agent's default or sends it to Official, and the CLI files follow only if the default changed. Any CLI failure (`config_conflict`) leaves `endpoints.json` and the key untouched, so the endpoint and the mode stay.
- Health is read on `list` only, never by a watcher: owned keys vs `written` (Claude `env.*` including removed keys that came back, top-level `model`, the daemon's own `modelPicker` compared as `JSON.stringify({ options: written })`, the WebSearch deny entry the daemon added; Codex the three top-level keys and every field of the table). Other keys never count.
- Start-up (`attachGateway`): tokens are backfilled for agents that are on without one (legacy conversion never went through off→on); an agent that is on is rewritten only when the recorded gateway URL or token differs from now (port change, backfilled token, v0.15 record that pointed straight at a relay, a Claude record without `modelPicker` from before ticket 17) — an outside edit of `model` is reported, not overwritten. Official Codex: a leftover v0.15 table and key file are removed. Errors are logged; the daemon still starts.
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

- Stored endpoint: `id`, `slug` (generated from the name, locked, never a field in any response; it reaches clients only inside the opaque `<slug>/<model>` ids of the provider snapshot's `apiEndpointModelGroups`, see rpc-and-protocol.md "host state that replaces a provider's model catalogue"), `name`, `baseUrls: [{ format: "anthropic_messages" | "openai_chat" | "openai_responses", url }]` (one per format, canonical order, at least one), `models`, `modelMapping?` (any format), `enabled`, `legacyDefaultModelId?`, `catalog?: { fetchedAt, models }` (last upstream listing, written only by a format fetch for a saved endpoint), `manualModels?` (hand-added names, kept whether selected or not), `searchesWeb?` ("Searches the web by itself", cli-wiring-web-search ticket 04: read as `z.boolean().optional()` so a hand-written `false` still parses, written only as `true`; a save that omits it keeps the stored value, like `manualModels`, so old clients never turn it off; counts only with an Anthropic or Responses address, `searchesWebItself`), `createdAt`, `updatedAt`. Array order is creation order. Only `models` is "selected"; routing never reads `catalog` or `manualModels` (see rpc-and-protocol.md, "fetch_models and test_connection by base URL and request format").
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
- Ticket 14: Session history multi-select moves rows of one provider at a time (one `CODEX_HOME` per move) and lists per-row results. Codex's ``Model provider `…` not found`` on resume becomes `CodexModelProviderMissingError` (`codex-conversations/model-provider-missing.ts`); import, `resume_agent_request` and `refresh_agent_request` map errors through `toAgentResumeWireError` (`agent-resume-errors.ts`) so the wire error carries `codex_model_provider_missing` (`CODEX_MODEL_PROVIDER_MISSING_ERROR_CODE`) and the app never matches English text. The app shows the explanation and the move button in Session history's import error and in the archived agent callout; an unarchive (`refresh_agent_request`) that fails to resume puts the agent back in the archive with the error kept. Not covered (user deferred): an unarchived agent that fails to load after a daemon restart ("Failed to load agent" page).
- Known limit (verified with real Codex 0.163.0, temp `CODEX_HOME`): if Codex rebuilds its state DB before the moved conversation is resumed once, the move reverts; the dialog says to resume once.

## Anti-patterns

- `JSON.parse(raw) as StoredAgentRecord`. Parse with the schema.
- A service reading and writing the JSON file itself instead of calling the store.
- Adding a field to a persisted record without adding it to `docs/data-model.md`.
- Catching a parse error and returning a partially built record. Invalid rows are dropped or reported, not repaired silently.
