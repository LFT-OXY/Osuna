# RPC and Protocol

Clients talk to the daemon over one WebSocket session. Every inbound message is a discriminated union on `type`, validated by generated zod-aot code before it reaches a handler (`docs/protocol-validation.md`). Schemas live in `packages/protocol`; the daemon re-exports them through `server/messages.ts` and adds serializers.

## Adding a session RPC

1. **Schema first, in `packages/protocol/src/`.** Add the request and response message schemas to the inbound/outbound unions. Wire types are `z.infer<typeof Schema>`; never hand-write a parallel interface. Schemas stay pure: no `.transform()`, `.catch()`, `.preprocess()`.
2. **Name it with dotted namespaces** per `docs/rpc-namespacing.md`: `domain.namespace.verb.request` pairs with `domain.namespace.verb.response`. Existing flat names (`checkout_pr_merge_request`) are legacy; do not add new ones.
3. **Handle it in `server/session/<domain>/`.** `server/session.ts` dispatches on `msg.type` in a `switch` and delegates to the domain module. `server/session/checkout/checkout-session.ts` is the reference for a delegated handler; the `agent.skills.*` cases in `session.ts` (search for `"agent.skills.get_status.request"`) show the minimal inline shape.
4. **Respond with the correlation key.** Requests carry parameters at the top level plus `requestId`; responses put results under `payload` and echo `requestId`:

   ```ts
   this.emit({
     type: "agent.skills.save_selection.response",
     payload: { requestId: msg.requestId, ...result },
   });
   ```

5. **Gate the feature, not the message.** If an old app must not see the new behavior, advertise it once in `server_info.features.*` (built in `server/websocket-server.ts`) and let the client branch on that. The server-side check stays fail-closed: an advertised capability means the runtime can do it now, not that a handler exists (`docs/coding-standards.md` "Errors").
6. **Cover it with a daemon E2E** in `server/daemon-e2e/` using `createTestPaseoDaemon` + `DaemonClient` (see [Testing](./testing.md)) when the behavior crosses the wire, and a protocol test in `packages/protocol/src/messages.<domain>.test.ts` for schema acceptance of both old and new shapes.

## Compatibility rules

- An old client must parse messages from a new daemon, and a new daemon must parse messages from an old client. New fields are optional. Never narrow, remove, or require.
- Every shim gets a tag at the site that must eventually be deleted:

  ```ts
  // COMPAT(ownedSubscriptions): added in v0.8.0, remove after 2027-03-09 once client floor >= v0.8.0.
  ```

  `rg "COMPAT\("` is the cleanup backlog. Untagged back-compat is permanent by accident. The daemon currently carries well over a hundred tagged sites; follow the exact `COMPAT(name): added in vX, remove after <date>` form so the backlog stays greppable.

- Read `docs/protocol-compatibility.md` before touching `packages/protocol`.

## Scenario: optional request field gated by a daemon feature flag

Reference implementation: `create_terminal_request.viewAttributes` (terminal view attributes, v0.8.1). Reuse this shape whenever a request grows a field that only a newer daemon acts on.

### 1. Scope / Trigger

- A request gains a field the daemon uses to change behavior; old daemons must keep parsing the request and old clients must keep working without the field.

### 2. Signatures

- Schema: `packages/protocol/src/messages.ts` — `TerminalViewAttributesSchema`, `CreateTerminalRequestSchema.viewAttributes`, `server_info.features.terminalViewAttributes`.
- Daemon: `createTerminal(options: CreateTerminalOptions & { viewAttributes?: TerminalViewAttributes })` in `terminal/terminal.ts`; the field threads through `TerminalManager.createTerminal`, `WorkerCreateTerminalOptions`, and `terminal-session-controller.ts` `handleCreateTerminalRequest`.
- Client: `DaemonClient.createTerminal(cwd, name?, requestId?, { viewAttributes? })` in `packages/client/src/daemon-client.ts`.

### 3. Contracts

- Request field: `viewAttributes?: { foreground, background, cursor }`, each `#rrggbb` (`TERMINAL_VIEW_ATTRIBUTE_COLOR_PATTERN`, exported from protocol and the only definition of the format; app and daemon import it).
- Daemon advertises `features.terminalViewAttributes: true` in `server_info` (`server/websocket-server.ts`).
- Client sends the field only when `lastServerInfoMessage.features.terminalViewAttributes === true`; otherwise it is dropped before `SessionInboundMessageSchema.parse`. That is the shim; it carries the COMPAT tag.
- Daemon never reads `features`; it acts on the field when present and stays silent on the dependent queries when absent.

### 4. Validation & Error Matrix

- Field absent -> request parses; daemon treats the value as unknown (no color-query replies).
- Field present but a color is not `#rrggbb` -> `create_terminal_request` fails schema validation (the client already filters values through the same pattern, so this only happens for hand-built messages).
- Field sent to an old daemon -> cannot happen: the client gate drops it when the feature is not advertised.

### 5. Good/Base/Bad Cases

- Good: new app + new daemon; app snapshots the theme colors at create time, daemon answers OSC 10/11/12 and `CSI ?996n` with them.
- Base: old app + new daemon; no field, daemon silent on color queries, terminal otherwise unchanged.
- Bad: putting the feature check on the daemon side, or adding a defensive default color for the absent case; both are what the gate exists to avoid.

### 6. Tests Required

- Protocol: `messages.create-terminal-view-attributes.test.ts` — parses without the field, parses with it, rejects malformed colors, parses the feature flag.
- Client: `daemon-client.test.ts` `test.each([true, false])` — `parseSentFrame(...).viewAttributes` equals the input only when the feature is advertised.
- Daemon: `terminal-session-controller.test.ts` — `create_terminal_request` with the field reaches `terminalManager.createTerminal` with `expect.objectContaining({ viewAttributes })`; `terminal.posix.test.ts` — real PTY replies (see [Testing](./testing.md)).

### 7. Wrong vs Correct

#### Wrong

```ts
// daemon: branching on what the client supports
if (session.clientFeatures.terminalViewAttributes) { ... }
// daemon: faking a value when the client sent nothing
const colors = msg.viewAttributes ?? DEFAULT_DARK_COLORS;
```

#### Correct

```ts
// client (packages/client/src/daemon-client.ts)
// COMPAT(terminalViewAttributes): added in v0.8.1, remove gate after 2027-03-17 once daemon floor >= v0.8.1.
...(this.lastServerInfoMessage?.features?.terminalViewAttributes === true &&
options?.viewAttributes !== undefined
  ? { viewAttributes: options.viewAttributes }
  : {}),
// daemon: act on presence, stay silent on absence
if (viewAttributes) ptyProcess.write(reply);
return true; // consume the query either way
```

## Scenario: live client push accepted only from the terminal size owner

Reference implementation: `terminal_input.view_attributes` (terminal-theme-bridge ticket 02). Reuse this shape when a per-terminal client message must follow an existing ownership rule instead of adding a new arbiter.

### 1. Scope / Trigger

- A client pushes per-terminal state that several connected clients could disagree on (theme colors). The daemon must pick one without a new arbitration rule.

### 2. Signatures

- Schema: `TerminalClientMessageSchema` branch `{ type: "view_attributes", attributes: TerminalViewAttributesSchema }` in `packages/protocol/src/messages.ts`; travels inside `terminal_input` like `resize`.
- Daemon: `applyTerminalViewAttributes(terminal, owner, attributes): boolean` in `terminal/terminal-size-ownership.ts`; `TerminalSessionController.handleTerminalInput` routes the branch there before the generic `session.send`. `ClientMessage` in `terminal/terminal.ts` gains the same branch; `send()` updates the session's stored colors.
- Worker: no new worker protocol type. The `send` request forwards any `ClientMessage`, so the branch reaches the worker session unchanged.
- Client: `DaemonClient.sendTerminalViewAttributes(terminalId, attributes)` in `packages/client/src/daemon-client.ts`; the feature gate lives here, same flag and COMPAT tag as the create-request field above.

### 3. Contracts

- Ownership: the message is applied only when `owner` is the connection holding the size claim (`terminalSizeOwners` WeakMap). No owner yet, or a different owner, means silently dropped; there is no `intent` on this message, so a client claims size first and pushes colors right after.
- `DECSET 2031` / `DECRST 2031` from the foreground program toggles `colorSchemeSubscribed` in the session (CSI handlers on the headless parser, always `return false` so xterm still processes the other modes in the same sequence).
- On each applied push the daemon compares the dark/light classification before and after (`resolveTerminalColorScheme`, relative luminance). Subscribed and changed (including unknown to known) writes one `CSI ?997;1n` or `?997;2n` straight to the PTY; unchanged or unsubscribed writes nothing.

### 4. Validation & Error Matrix

- Malformed color -> `terminal_input` fails schema validation (client filters through `TERMINAL_VIEW_ATTRIBUTE_COLOR_PATTERN` first).
- Push from a non-owner -> dropped, no reply, no log.
- Push before any size claim -> dropped.
- Feature flag not advertised -> `sendTerminalViewAttributes` returns without sending.

### 5. Good/Base/Bad Cases

- Good: Mac pane claims size, pushes light colors; TUI with 2031 enabled gets `?997;2n` when the user switches to dark and the pane pushes again.
- Base: phone opens the same terminal without focusing it; its colors never reach the PTY. Focus on the phone sends a claim, then the phone's colors apply.
- Bad: adding a second WeakMap for color ownership, or accepting the push from any subscriber and letting the last writer win.

### 6. Tests Required

- Protocol: `messages.terminal-input-view-attributes.test.ts` (branch parses; old `resize` still parses; malformed color rejected).
- Ownership: `terminal-size-ownership.test.ts` (no owner / owner / other / after re-claim) and `terminal-session-controller.resize.test.ts` (same through `SessionDelivery` with two sources, asserting the applied backgrounds).
- Worker: `worker-terminal-manager.test.ts` sends the branch through the real worker and reads the OSC 11 reply via `captureTerminal`.
- Daemon PTY: `terminal.posix.test.ts` (flip -> `SCHEME_OK:1`; unknown to known -> `SCHEME_OK:2`; same side -> `SCHEME_TIMEOUT`; unsubscribed -> `SCHEME_TIMEOUT`).
- Client: `daemon-client.test.ts` `test.each([true, false])` on the feature flag.

### 7. Wrong vs Correct

#### Wrong

```ts
// daemon: a second arbiter for colors
const colorOwners = new WeakMap<TerminalSession, object>();
// daemon: notifying on every push
if (colorSchemeSubscribed) ptyProcess.write(toColorSchemeReport(nextScheme));
```

#### Correct

```ts
// terminal-size-ownership.ts: same owner as the size claim
if (terminalSizeOwners.get(terminal)?.deref() !== owner) return false;
terminal.send({ type: "view_attributes", attributes });
// terminal.ts send(): only classification changes reach the PTY
if (colorSchemeSubscribed && previousScheme !== nextScheme) {
  ptyProcess.write(toColorSchemeReport(nextScheme));
}
```

## Scenario: optional request field that widens a listing, gated in the app

Reference implementation: `fetch_recent_provider_sessions_request.includeImported` and
`RecentProviderSessionDescriptorPayload.importedAgentId` (session-history-panel ticket 03,
v0.8.1). Reuse this shape when an existing listing RPC must stop hiding rows for one new
consumer while every old consumer keeps the filtered result.

### 1. Scope / Trigger

- The import sheet needs the daemon to hide sessions Paseo already owns; the Session history
  view needs them shown and marked. One RPC, two consumers, no second RPC.

### 2. Signatures

- Schema: `packages/protocol/src/messages.ts` — `FetchRecentProviderSessionsRequestMessageSchema.includeImported?: boolean`,
  `RecentProviderSessionDescriptorPayloadSchema.importedAgentId?: string` and
  `importedAgentWorkspaceId?: string`, `server_info.features.sessionHistory`.
- Daemon: `listImportableProviderSessions({ request, ... })` in `server/agent/import-sessions.ts`;
  `toRecentProviderSessionDescriptorPayload(session, { providerLabel, importedAgentId?, importedAgentWorkspaceId? })`
  in `server/agent/agent-projections.ts`.
- Client: `DaemonClient.fetchRecentProviderSessions({ ..., includeImported? })` passes the field
  through unchanged; it carries no gate of its own.
- App: `session-history/index.tsx` — `SessionHistoryView` reads `useHostFeature(serverId, "sessionHistory")`
  once and hands the surface `isSupported`; the surface disables the query and renders the
  update prompt. The COMPAT tag sits on that gate.

### 3. Contracts

- `includeImported` absent or `false`: identical to before — rows owned by an active (non-archived)
  Paseo agent are dropped and counted in `filteredAlreadyImportedCount`; no descriptor carries
  `importedAgentId`; the provider listing is asked for `limit + importedCount` rows so the filter
  can still fill `limit`.
- `includeImported: true`: nothing is dropped, `filteredAlreadyImportedCount` is `0`, the listing
  is asked for exactly `limit` rows, and every row Paseo ever owned carries `importedAgentId` plus
  `importedAgentWorkspaceId` when the record has one (legacy agents predate ownership stamping).
  The workspace id is not optional sugar: the app opens the row through `navigateToAgent`, which
  falls back to the host-level agent route (no `pin`) for an agent it cannot find in the session
  store, and archived agents are never there.
- Owner resolution: active in-memory agents first, then active stored records, then archived
  records, first writer wins per handle key (`sessionId` and `nativeHandle` both map). An archived
  twin therefore never shadows a live agent.
- `AgentManager.listImportableSessions` runs `getProviderAvailability(provider)` on every
  candidate before the listing fan-out, and what an unavailable provider gets depends on who
  asked for it. A Paseo-shipped provider the user never installed is dropped silently — no rows,
  no error entry; nobody wants a Codex error for not having Codex. Anything else — a provider
  declared in daemon config, a plugin-contributed one — becomes a `providerErrors` entry and is
  never listed, so a typo in `command` surfaces as an error with Retry instead of an empty list.
  The signal is membership in `BUILTIN_PROVIDER_IDS` plus the ids in
  `DEV_AGENT_PROVIDER_DEFINITIONS` (dev's `mock` is Paseo's, not the user's), never
  `derivedFromProviderId` — that is `null` for built-ins and for generic ACP custom providers
  alike. A probe that returns `false` with no error text synthesises
  `Provider '<id>' is not available`; the error path must not rely on the listing call throwing,
  or an ACP client that answers an empty list for a missing binary swallows the failure again.
  A probe that throws is logged at `warn` and counts as unavailable. Always go through
  `getProviderAvailability`, never a hand-rolled `try { client.isAvailable() }` — the helper
  already carries the catch-and-warn contract and the two would drift. `docs/providers.md`
  states the same contract for provider authors.
- The daemon never reads `features`; the flag exists because the field and the flag shipped
  together, so an old daemon silently ignores `includeImported` and would answer with the filtered
  list — the app refuses to show that instead of listing it.

### 4. Validation & Error Matrix

- `includeImported` not a boolean -> request fails schema validation.
- Field sent to an old daemon -> cannot happen from the app (query disabled without the flag);
  a hand-built request just gets the filtered list.
- Descriptor without `importedAgentId` -> parses; the row is external.
- `client.isAvailable()` returns `false` or throws for a Paseo-shipped provider -> skipped,
  absent from both `sessions` and `providerErrors`. Same for a config-declared or
  plugin-contributed provider -> no rows, one `providerErrors` entry carrying the probe's error
  text or the synthesised `Provider '<id>' is not available`. Available but
  `listImportableSessions` throws or exceeds the 90 s timeout -> `providerErrors` entry, other
  providers' rows still returned.

### 5. Good/Base/Bad Cases

- Good: new app + new daemon; the view lists external and owned sessions, owned rows badge and
  open their agent, the import sheet (no field) still hides owned rows.
- Base: old app + new daemon; no field, filtered list, old import sheet unchanged.
- Bad: keying the owner map only on `sessionId` (Codex rows carry the native handle), filling
  `importedAgentId` when the field is absent (old app would still parse it, but the import sheet
  would then offer to import a session it already owns), or shipping the agent id without its
  workspace id and letting the client "look it up" — the client has nothing to look in.

### 6. Tests Required

- Protocol: `messages.workspaces.test.ts` — request with and without the field, descriptor with
  and without `importedAgentId`, `server_info` with and without the flag.
- Daemon: `import-sessions.test.ts` — `includeImported: true` returns live / stored / archived /
  external rows with the right agent and workspace ids and `listImportableSessions` asked for
  `limit`; a live agent and an archived record sharing one handle report the live agent; `false`
  returns the archived row unmarked. `agent-projections.test.ts` — the field appears only when
  supplied.
- Daemon availability gate: `agent-manager.test.ts` — one unavailable provider, one whose probe
  throws, and one available-but-failing provider in the same manager; assert the full
  `{ sessions, providerErrors }` shape holds only the healthy rows and the failing provider's
  error, and that the two skipped clients' listing was never called. A second test covers the
  declared side: an unavailable generic ACP provider and one whose probe throws both appear in
  `providerErrors` while an unavailable built-in stays silent.
- Client: `daemon-client.test.ts` — the sent frame carries `includeImported`.
- App: `session-history/index.test.tsx` — requests carry `includeImported: true`; an owned row
  badges and calls `onOpenAgent(agentId, workspaceId)` without `createTerminal`;
  `isSupported: false` renders the update prompt and never fetches.

### 7. Wrong vs Correct

#### Wrong

```ts
// daemon: a parallel RPC for the same listing
case "session_history.list.request": ...
// app: falling back to the filtered list on an old host
const rows = supportsSessionHistory ? owned.concat(external) : external;
// daemon: re-probing availability by hand next to the fan-out
try { available = await client.isAvailable(); } catch { available = false; }
```

#### Correct

```ts
// daemon (import-sessions.ts): one flag, one branch, old path untouched
if (!includeImported && importedHandles.has(handleKey)) {
  filteredAlreadyImportedCount += 1;
  continue;
}
// app (session-history/index.tsx)
// COMPAT(sessionHistory): added in v0.8.1, remove gate after 2027-03-18.
const canList = isClientReady && isSupported;
```

## Scenario: a broadcast that must reach modern clients

Reference implementation: `usage.pricing.updated` (usage ticket 05, v0.8.2). Reuse this shape for any new daemon-initiated message that is not a reply.

### 1. Scope / Trigger

- The daemon wants to tell every connected client that something changed, outside any request it is answering.

### 2. Signatures

- Schema: a member of `SessionOutboundMessageSchema` in `packages/protocol/src/messages.ts`.
- Category: the same literal added to `SessionEventSubscriptionSchema` (same file).
- Routing: the same `case` added to `sessionEventCategory()` in `server/session.ts`.
- Permission: an entry in `OUTBOUND_PERMISSION` in `server/authorization/operation-permissions.ts`.
- Client: `DaemonClient.observeEvents([...])` in `packages/client/src/daemon-client.ts`.

### 3. Contracts

- **`wsServer.broadcast()` alone does not deliver it.** For a client with the `ownedSubscriptions` capability, `SessionDelivery.permits()` drops every message that has no owning subscription (`server/session/owned-subscriptions/index.ts`). A broadcast with no event category reaches only pre-v0.8.0 clients — silently, with no log line and no error.
- `sessionEventCategory()` returning the type is what routes it to `emitSubscribedEvent()`, which fans it out to the subscriptions that asked for that category. A client that did not subscribe receives nothing; that is the point.
- The client subscribes with `observeEvents`, gated on the feature flag that owns the message. `SessionEventSubscriptionSchema` is a `z.enum`, so an old daemon rejects the whole `session.events.set_subscription.request` if it sees a name it does not know — never send a new category name to a daemon that has not advertised the feature.
- **Carry no `requestId` unless the message really is a reply.** `replies.ts` classifies every correlated outbound message and fails typecheck until it is declared in `exceptions`. A payload is fine on its own — `usage.updated` carries `{ cli, sessionId, agentId? }` so a screen can tell whether the change was its own — it is the `requestId` that makes the classifier call it a reply. A notification with nothing to say takes no `payload` at all.

### 4. Validation & Error Matrix

- Broadcast with no event category, modern client -> silently dropped by `permits()`.
- Broadcast with a category, client never subscribed -> not delivered; no error.
- New category name sent to a daemon that predates it -> the subscription request fails schema validation, so the client loses every category in that call.
- Message carries `payload.requestId` but is not a reply -> `Record<ExceptionalReply, …>` in `replies.ts` fails to typecheck.

### 5. Good/Base/Bad Cases

- Good: new app + new daemon; the app subscribes once behind the feature gate and re-reads on each notification.
- Base: pre-v0.8.0 client; the legacy path in `emitSubscribedEvent()` delivers by capability instead of subscription.
- Bad: shipping the broadcast without the category and testing only by polling the matching RPC — the poll passes, the push never worked.

### 6. Tests Required

- Daemon E2E: `observeEvents([...])`, trigger the change, assert the handler fired. `usage-pricing.e2e.test.ts` "reprices history the moment an override is saved" is the reference.
- Protocol: the category parses inside `session.events.set_subscription.request`, and the message parses in the outbound union.

### 7. Wrong vs Correct

#### Wrong

```ts
// The message exists, is authorized, and never arrives.
wsServer?.broadcast(wrapSessionMessage({ type: "usage.pricing.updated" }));
// ...and nothing else.
```

#### Correct

```ts
// packages/protocol/src/messages.ts
export const SessionEventSubscriptionSchema = z.enum([
  // ...
  // COMPAT(usage): added in v0.8.2, remove gate after 2027-09-19.
  "usage.pricing.updated",
]);

// server/session.ts
function sessionEventCategory(message: SessionOutboundMessage) {
  switch (message.type) {
    // ...
    case "usage.pricing.updated":
      return message.type;
  }
}

// client, behind the feature gate that owns the message
await client.observeEvents(["usage.pricing.updated"]);
```

## Scenario: an agent snapshot field the daemon decides at session start

Reference implementation: `canCreateAgents` / `createAgentsUnavailableReason` (multi-agent ticket 02). Reuse this shape for any per-agent fact that depends on daemon config plus what the provider session actually accepted.

### 1. Scope / Trigger

- The app needs a per-agent answer that is neither a provider capability (`session.capabilities`) nor persisted state, and that must not change under a running session when config changes.

### 2. Signatures

- Pure decision: `resolveCreateAgentsCapability(input)` in `server/agent/create-agents-capability.ts` → `{ canCreateAgents: true } | { canCreateAgents: false; unavailableReason }`.
- Global gate: `AgentManager.setPaseoToolsGate({ mcpEnabled, injectIntoAgents })`, called from `bootstrap.ts` (initial, on listen, and in the `mcp.enabled` / `mcp.injectIntoAgents` field-change callbacks). There is no boolean setter any more.
- Storage: `ManagedAgent.createAgentsCapability`, written only by `registerSession` (its `options.createAgentsCapability` is required); projected in `toAgentPayload`.
- Wire: `AgentSnapshotPayloadSchema.canCreateAgents: z.boolean().optional()`, `createAgentsUnavailableReason: z.string().optional()`; `server_info.features.agentMentions`.
- Prediction (ticket 10), for the new agent screen before any session exists: `predictCreateAgentsCapability({ gateReason, paseoToolPolicy, clientCapabilities })` → `CreateAgentsCapability | null`, wrapped by `AgentManager.predictCreateAgentsCapability(provider, clientCapabilities)`. `ProviderSnapshotManager.setCreateAgentsPredictor(predictor)` (wired once in `bootstrap.ts`) and `refreshCreateAgentsPredictions()`. Wire: the same two optional fields on `ProviderSnapshotEntrySchema` (and the hand-written `ProviderSnapshotEntry` in `protocol/agent-types.ts` and `server/agent/agent-sdk-types.ts`). Client flag `AgentCapabilityFlags.mcpServersDecidedPerSession?` (client only; Pi sets it in `capabilitiesForClient`).

### 3. Contracts

- Computed on all four registration paths — create, resume, import, reload — after the provider session exists, because Pi's MCP support is only known from `session.capabilities.supportsMcpServers`.
- Reason precedence: `mcp_disabled` → `tools_not_injected` → `create_agent_not_allowed` → `tools_not_delivered`. The reason is present only when `canCreateAgents` is false.
- Delivery: a native catalog on the launch context decides alone (`getTool("create_agent")`); OpenCode's bridge manifest is policy-free and never counts. Otherwise the launch config must hold the daemon's internal `paseo` MCP server and the session must accept MCP. A user-owned server named `paseo` is not delivery.
- The gate is read once, in `prepareSessionConfig`, and folded into `paseoToolPolicy` (`{ enabled: false }` when closed). `buildLaunchContext` reads only that policy, so a toggle between the two awaits cannot make the catalog and the snapshot disagree.
- Stored (not loaded) agents from `buildStoredAgentPayload` omit both fields; sending to them resumes, which decides.
- Prediction uses the same gate and policy, then only the client's declared channel: `supportsNativePaseoTools || supportsMcpServers` → true; `mcpServersDecidedPerSession` → `null`, no fields written (Pi: the adapter probe needs a session per cwd; decided with the user on 2026-09-30 so a working Pi is not grayed out); otherwise `tools_not_delivered`. Gate and policy reasons are still written for Pi. The daemon decides for real once the session exists, and attaches the Routing block only then.
- Fields are overlaid in `ProviderSnapshotManager.withCreateAgentsPrediction`, called from `publishTargets` and `getOrCreateTarget`. The overlaid record goes through `identifyEntry`, so the prediction is part of `contentHash`: a toggle pushes `providers_snapshot_update` and `ifNoneMatch` sees the change. A `WeakMap` keyed by the catalog record keeps the overlaid record stable while the prediction is unchanged. Disabled providers and providers without a materialized client get no fields.
- Republishing: `bootstrap.ts` wraps every gate change in a local `setPaseoToolsGate` that calls `refreshCreateAgentsPredictions()`. Provider policy changes need nothing extra: `set_daemon_config` → `prepareMutableProviderConfig().commit()` → `installGeneration` → `publishTargets`, and the predictor reads `daemonConfigStore.get().providers` live.

### 4. Validation & Error Matrix

- `mcp.enabled` false → `mcp_disabled`.
- `mcp.enabled` true, `injectIntoAgents` false → `tools_not_injected`.
- Provider `paseoTools.enabled: false` or `disabledTools` has `create_agent` → `create_agent_not_allowed`.
- Session without MCP support, native catalog without `create_agent`, or internal server not injected → `tools_not_delivered`.
- Config changed while running → snapshot unchanged until reload/resume. Known gap: turning `mcp.enabled` off in the config file kills the MCP endpoint immediately, but the snapshot still says `true` (the app cannot change that key).
- Provider snapshot prediction, by contrast, follows config changes immediately. Known gap: before the daemon listens, `mcpBaseUrl` is null, so an MCP-channel prediction of `true` can precede a session that gets `tools_not_delivered`.

### 5. Good/Base/Bad Cases

- Good: new app + new daemon; app gates on `features.agentMentions`, then reads the two fields.
- Base: old daemon; fields absent, `agentMentions` absent, app tells the user to update the host.
- Bad: putting the flag into `capabilities` — replica-cache stores capabilities with a `z.strictObject` key list and the key means "provider can", not "daemon injected".

### 6. Tests Required

- Daemon E2E `daemon-e2e/agent-create-agents-capability.e2e.test.ts`: each reason from one config (`mcpEnabled`, `mcpInjectIntoAgents`, `providerOverrides.<id>.paseoTools`, fake client `supportsMcpServers`), the true case with no reason, and `patchDaemonConfig` → unchanged → `refreshAgent` → updated.
- Unit `agent/create-agents-capability.test.ts`: native catalog with/without `create_agent`, user-owned `paseo` server, internal server with/without session MCP support.
- Protocol `messages.wire-compat.test.ts`: snapshot without the fields, with an unknown reason string, and `agentMentions` optional; provider snapshot entry likewise.
- Daemon E2E `describe("provider snapshot create-agents prediction")` in the same file: each config → the predicted fields equal what `createAgent` then reports; `mcpServersDecidedPerSession` → no fields, session still decides; `patchDaemonConfig` of `mcp.injectIntoAgents` and `paseoTools` updates `getProvidersSnapshot` without a reload (`paseoTools` patches merge, so reset with `disabledTools: []`, not `{}`).
- Unit `predictCreateAgentsCapability` in `agent/create-agents-capability.test.ts`: gate before policy, native channel, per-session channel → `null` unless gate/policy blocks.

### 7. Wrong vs Correct

#### Wrong

```ts
// Reads the live gate a second time; a toggle between prepare and launch leaves
// the MCP server injected but no native catalog, and the snapshot misreports.
if (this.paseoToolsEnabled && isPaseoToolPolicyEnabled(policy) && client.capabilities.supportsNativePaseoTools) {

// Prediction added in the catalog session after hashing: snapshotHash and
// sameSnapshotRecords never see it, so toggling injection pushes nothing.
entries.map((entry) => ({ ...entry, canCreateAgents: predict(entry.provider) }));
```

#### Correct

```ts
// Overlay before publishing, re-identified so contentHash covers the prediction.
const records = order.map((provider) => this.withCreateAgentsPrediction(record(provider)));
```

#### Correct

```ts
// prepareSessionConfig captured the gate and folded it into the policy.
if (isPaseoToolPolicyEnabled(paseoToolPolicy) && client.capabilities.supportsNativePaseoTools) {
```

## Scenario: a daemon-owned agent label fed from the provider's tool call

Reference implementation: `paseo.parent-tool-call-id` (multi-agent ticket 04). Reuse this shape when a Paseo tool needs a fact only the provider channel knows.

### 1. Scope / Trigger

- A tool handler needs provider-side call identity (the id that becomes the timeline `callId`), and the result must be a label the model cannot forge. No wire schema change: labels are already `Record<string, string>`; the feature is gated by `server_info.features.subagentCallLinks`.

### 2. Signatures

- `PaseoToolExecutionContext.providerToolCallId?: string` (`agent/tools/types.ts`).
- Channel boundaries fill it: `mcp-server.ts` `readProviderToolCallId(context)` from `_meta` keys `claudecode/toolUseId` → `callId` → `pi-mcp-adapter/toolCallId`; `opencode/bridge-plugin.mjs` sends `context.callID` as header `X-Paseo-Tool-Call-Id`, `opencode/bridge.ts` reads it; `omp/host-tools.ts` passes `request.toolCallId`.
- `CreateAgentFromMcpInput.parentToolCallId?: string`; `withParentToolCallIdLabel({ labels, parentAgentId, parentToolCallId })` in `create-agent/intent.ts`, applied in `resolveMcpCreateAgent` only.
- Constants: `PARENT_TOOL_CALL_ID_LABEL` (`@getpaseo/protocol/agent-labels`), `PASEO_CREATE_AGENT_TOOL_NAME = "paseo.create_agent"` (`@getpaseo/protocol/tool-name-normalization`).

### 3. Contracts

- The tool-created path (`kind: "mcp"`) always drops a model-supplied value for the key (from `labels` or `childAgentDefaultLabels`), then writes it only when there is a parent agent and an id. Legacy detached create gets no label.
- The WebSocket session create path (`session.ts`) does not strip it: that caller is the user/app, and app e2e seeds children through labels.
- Detach keeps the label (`detachedAgentLabelPatch` clears only the parent and open-tab labels).
- Timeline names: OpenCode `paseo_create_agent`, OMP bare `create_agent`, and Pi `mcp` proxy / `mcp__paseo` `{tool, args}` / direct `paseo_create_agent` / `mcp__paseo_create_agent` become `paseo.create_agent` with flat input, in the adapters' `parseToolArgs` / tool-call mapper so live and history share it. Other Paseo tools keep their names.

### 4. Validation & Error Matrix

- No id (old Claude Code, Codex < 0.148, pi-mcp-adapter < 3.0, ACP providers) → no label, no error.
- Id empty or whitespace → treated as absent; otherwise trimmed.
- Pi proxy `{tool: "create_agent"}` without `server: "paseo"`, or Pi direct tool under `toolPrefix: "none"` → not renamed (ambiguous server).
- Pi end event without a tracked start → name may still resolve from `result.details`, but input is `null`.

### 5. Good/Base/Bad Cases

- Good: Codex parent calls `create_agent` with `_meta.callId`; child carries parent id and call id; app matches the timeline item.
- Base: provider sends no id; child has only the parent label; app shows the generic tool card.
- Bad: reading the id inside the tool from provider-specific shapes — the tool would learn about providers, and OpenCode/OMP never reach MCP.

### 6. Tests Required

- Unit `agent/mcp-server.test.ts` "parent tool call id label": each `_meta` key, override of a model value, no id → no label (in-memory MCP client, real `AgentManager` + `AgentStorage`).
- `opencode/bridge.test.ts`: plugin with and without `callID` → `providerToolCallId` seen by the catalog. `omp/host-tools.test.ts`: `toolCallId` reaches the handler.
- Mapper tests for OpenCode, Pi (all six shapes), OMP: name `paseo.create_agent`, detail `{ type: "unknown", input: <flat args>, output: null }`.
- Daemon E2E `daemon-e2e/subagent-call-links.e2e.test.ts`: `features.subagentCallLinks`, real `/mcp/agents?callerAgentId=` with and without `_meta`.
- Protocol `messages.wire-compat.test.ts`: `subagentCallLinks` optional.

### 7. Wrong vs Correct

#### Wrong

```ts
// Strips in the shared intent: the app's WS create path loses labels it set on purpose.
const { [PARENT_TOOL_CALL_ID_LABEL]: _dropped, ...labels } = { ...input.labels };
```

#### Correct

```ts
// resolveMcpCreateAgent — tool path only.
const labels = withParentToolCallIdLabel({
  labels: intent.labels,
  parentAgentId: intent.parentAgentId,
  parentToolCallId: input.parentToolCallId,
});
```

## Scenario: a provider subagent's permission, attributed on the parent

Reference implementation: multi-agent ticket 13. Reuse this shape when a request raised inside a provider-owned child must be told apart on the parent agent.

### 1. Scope / Trigger

- Provider subagents run in the parent's provider runtime, so their `permission_requested` events reach `AgentManager` under the parent agentId. The app needs to know which descriptor asked. No wire schema change: the id rides in the existing `AgentPermissionRequest.metadata` record, and no feature flag gates it (an old app ignores the key; an old daemon never sends it). The descriptor `status` enum is not extended.

### 2. Signatures

- `@getpaseo/protocol/provider-subagent-permission`: `PROVIDER_SUBAGENT_ID_METADATA_KEY = "providerSubagentId"`, `providerSubagentPermissionMetadata(subagentId): Record<string, string>` (write), `getProviderSubagentIdFromPermission(request: Pick<AgentPermissionRequest, "metadata">): string | null` (read).
- Claude: `ClaudeTaskProtocolSource.resolveTaskSubagentId(taskId)` (`claude/subagents/live-source.ts`), called with `canUseTool`'s `options.agentID` in `handlePermissionRequest`.
- Codex: `CodexAppServerAgentSession.providerSubagentMetadata(threadId)` spread into all four approval handlers (command, file change, `request_user_input`, MCP elicitation).
- OpenCode: `appendOpenCodePermissionAsked` (parent translator) and the forwarded child `question` in `translateProviderSubagentEvent`.

### 3. Contracts

- The value is the provider-subagent descriptor id: Claude the declared Task `tool_use_id` (via `task_id`), Codex the child `threadId`, OpenCode the child `sessionID`.
- Only a child's request is tagged: Codex skips `threadId === currentThreadId` (and a null current thread), OpenCode skips `sessionID === state.sessionId`, Claude tags only when `agentID` maps to a declared task.
- The request still belongs to the parent agent: `respondToPermission` goes to the parent agentId; the app's read-only panel passes `permissionAgentId={parentAgentId}` to `AgentStreamView`.

### 4. Validation & Error Matrix

- Claude `agentID` absent, unknown, or an undeclared task → no key, request stays parent-only. `agentID == task_started.task_id` is assumed from the hook `agent_id` rule and not verified live.
- Codex approval before `currentThreadId` is known → no key. Codex child async questions are still dropped (`receiveAsyncQuestion`), unchanged.
- OMP `extension_ui_request` has no child id → never tagged.
- Key present but empty/non-string → reader returns `null`.

### 5. Good/Base/Bad Cases

- Good: Codex child thread asks for a command approval → `metadata.providerSubagentId = "<child thread>"` → track row and dispatch row show waiting for approval; the read-only tab shows the card.
- Base: parent's own approval → no key, only the parent panel shows it.
- Bad: adding a `waiting_for_approval` descriptor status — narrows old clients' enum parse and duplicates state the parent snapshot already carries.

### 6. Tests Required

- `claude/agent.test.ts` "tags a subagent's permission request…": `task_started` then `canUseTool` with/without `agentID`.
- `codex-app-server-agent.test.ts` "tags approvals from a collab child thread…": four child handlers tagged, parent thread untagged.
- `opencode/event-translator.test.ts` child `permission.asked` expects the key; `opencode-agent.test.ts` forwarded child question carries it.
- `mock-load-test-agent.test.ts`: scripted `providerSubagent.permission` parks until answered, then the subagent completes.
- App: `subagents/select.test.ts` (grouping, row counts, dispatch pending name, owned-permissions selector identity), browser `dispatch-group.spec.ts` provider permission case.

### 7. Wrong vs Correct

#### Wrong

```ts
// Hand-built key in each adapter — a typo silently detaches the permission from its row.
metadata: { providerSubagentID: childSessionId },
```

#### Correct

```ts
...(childSessionId ? { metadata: providerSubagentPermissionMetadata(childSessionId) } : {}),
```

## Scenario: a provider-bound prompt that differs from what the user sent

Reference implementation: the Routing block for Agent mentions (multi-agent tickets 05, 07 and 09). Reuse this shape when the daemon appends system text to a user message on its way to the provider.

### 1. Scope / Trigger

- The provider must see extra instructions, while the timeline, bubble, title, history replay, and import picker show only what the user wrote. No wire change; gated by `server_info.features.agentMentions`.

### 2. Signatures

- `StartAgentRunOptions.resolveRoutingBlock?: () => Promise<string | null>`; `type RoutingBlockResolver = (agent: ManagedAgent) => Promise<string | null>` on `SendPromptToAgentParams.resolveRoutingBlock` and `StartCreatedAgentInitialPromptParams.resolveRoutingBlock` (`agent/agent-prompt.ts`), and on `CreateAgentFromSessionInput.resolveRoutingBlock` (`agent/create-agent/create.ts`, carried through `ResolvedCreateAgent` to `sendInitialPrompt`); `appendRoutingBlock(prompt, block)`.
- `AgentRunOptions.submittedPrompt?: AgentPromptInput` (`agent/agent-sdk-types.ts`): the original, read by the `recordSubmittedPrompt` calls in `agent-manager.ts` `streamAgent` (after the turn is accepted) and `recordAcceptedSteer`.
- `resolveRoutingBlock({ text, cwd, canCreateAgents, mentionDefaults, agentProfiles, providers })` (`agent/routing-block.ts`); `mentionDefaults: (providerId) => ProviderMentionDefaults | undefined` reads `daemonConfigStore.get().providers[id]?.mentionDefaults` and `agentProfiles` is `daemonConfigStore.get().agentProfiles ?? []`, both taken when the message is sent, so a `set_daemon_config` applies to the next message. `RoutingBlockSettings` is `{ modeId?, thinkingOptionId?, features? }`. Model and thinking fallbacks use `selectDefaultModel` / `resolveThinkingOptionId` shared with metadata generation.
- Config: `ProviderMentionDefaultsSchema = { model?, thinkingOptionId?, modeId? }` (each `z.string().min(1)`) in `packages/protocol/src/provider-config.ts`, on both `ProviderOverrideSchema` (persisted `agents.providers.<id>`) and `MutableDaemonProviderConfigSchema` (wire). Documented in `docs/data-model.md` "Mention defaults".
- `stripTrailingRoutingBlock(text)` (`agent/trailing-routing-block.ts`, a leaf module so providers can import it).

### 3. Contracts

- Only client requests pass a resolver, built by `Session.routingBlockResolver(text)`: `handleSendAgentMessageRequest`, and `createSessionAgent` for the first message of `create_agent_request`, `agent.create.request`, and `workspace.create.request` (all three funnel into `createSessionAgent`; hub execution creates do not). The create path resolves against the freshly registered `ManagedAgent`, so its real `createAgentsCapability` decides, not the provider snapshot prediction. MCP `send_agent_prompt` and `create_agent` (`kind: "mcp"`), schedule fires, and finish notifications never pass one, so a parent forwarding the user's text cannot chain-dispatch.
- `startAgentRun` runs `tryRunOutOfBand` on the original first, then calls the resolver. Out-of-band commands never wait on the provider snapshot.
- Array prompts get a trailing text block; string prompts get `\n\n` + block. The timeline records `submittedPrompt`, reconciled by `clientMessageId`.
- A profile mention (`paseo://agent/profile/<id>`) resolves to its profile's `provider` and stacks layers: the profile's `model` / `thinkingOptionId` / `modeId` first, then that provider's Mention defaults (`resolveAgainstCatalog(entry, layers)`). Its non-empty `featureValues` go to `settings.features` as written; they are never validated.
- Layers resolve per field against a `ready` snapshot, first valid layer wins: model → first layer model in the selectable catalog, else the default model; thinking option → first layer value the chosen model offers, skipping any layer whose own model is stale (a retired model takes its thinking option with it), else that model's default (an unset model means the current default model); mode → first layer mode in `entry.modes`, else `defaultModeId` if in `entry.modes`, else `modes[0]`; no modes at all → no `modeId`. A stale profile value therefore falls back to Mention defaults before runtime defaults (decided with the user in ticket 09). A valid lower-layer thinking option applies to a profile's model when that model offers it. Only catalog modes are written because `create_agent` rejects a mode outside `availableModes` and, given none, inherits the parent's mode (same provider) or throws (cross provider).
- `DaemonConfigStore.applySupportedPatch` replaces a provider's `mentionDefaults` wholesale instead of deep-merging, so the card resets a field by omitting it. The persisted side already replaces it through the shallow spread in `applyMutableProviderConfigToOverrides`. `removeProviders` drops it with the entry. Changing it does not rebuild provider catalogs: `mentionDefaults` is not part of a provider definition's `configuration`.
- `stripTrailingRoutingBlock` needs the closing tag at the end and runs only on provider-sourced text: live echoes, the echo fallback in `reconcileSubmittedPromptEcho`, force hydrate, prime, `buildImportedTimelineRows`, and import previews. Providers that collapse whitespace and truncate (`claude/agent.ts`, `acp-agent.ts`, `omp/` and `pi/session-descriptor.ts`) strip inside their `normalize*PromptPreview` before collapsing; `toRecentProviderSessionDescriptorPayload` strips full-text previews and titles (Codex thread preview).

### 4. Validation & Error Matrix

- Session `canCreateAgents` false → no block, original text sent.
- Mention of an unregistered, disabled, or `unavailable` provider, directly or through a profile → line `N. @Label -> cannot start: <reason>. Tell the user.` with the provider's reason; other mentions still route.
- Profile id not in `agentProfiles` → `cannot start: agent profile "<id>" no longer exists`.
- Snapshot `loading` / `error` → configured values (profile over Mention defaults, per field) passed through unvalidated (`provider "<id>/<model>"` when a model is set); unset fields are omitted, so with no configured `modeId` the block carries none. `create_agent` then waits for a ready snapshot itself and fails if it never becomes ready.
- Stale Mention defaults → per-field fallback above; the send is never blocked and nothing is logged.
- `getProvider` throwing → the send fails (snapshot inconsistency, not swallowed).

### 5. Good/Base/Bad Cases

- Good: `[@Claude](paseo://agent/provider/claude) write tests` → provider gets text + block; timeline shows the text.
- Base: a message without mentions that ends in a user-written `<paseo-system>` block → sent and recorded unchanged.
- Bad: stripping in `submittedPromptText` — every entrypoint loses user-written trailing blocks, including MCP and schedule prompts that never carried one.

### 6. Tests Required

- Daemon E2E `daemon-e2e/agent-mention-routing-block.e2e.test.ts`: exact block text and order, same provider twice, steer via permission park, sequential sends, `/fake-oob`, `mcpInjectIntoAgents: false`, disabled/unknown provider lines, MCP + schedule prompt arrays, recorded-as-written. `describe("Routing block for the first message of a new agent")`: `test.each` over the three create requests (`create_agent_request` as a raw frame through its own WebSocket, since `DaemonClient.createAgent` negotiates `agent.create.request`), each with and without injection, and MCP `create_agent` (needs `provider: "codex/<model>"`) receiving the text unchanged.
- `agent-manager.test.ts` (`fakeCodexEmitting` turn/history items, resumed `streamHistory`, `importSession`): echo, force hydrate, prime, import rows and imported title.
- Daemon E2E `describe("Mention defaults")` in the same file: `set_daemon_config` read-back and next-send effect, unset fields at runtime defaults, the four stale cases (stale model drops the thinking option, thinking outside the model, thinking against the default model valid and invalid), catalog `error` pass-through, wholesale replace, `removeProviders` clearing memory and `config.json`. The fake client's `fetchCatalog` option supplies thinking options or a rejecting catalog.
- Daemon E2E `describe("Agent profile mentions")`: profile fields over Mention defaults over runtime defaults with `features`, stale profile values falling back to Mention defaults, deleted profile and profiles on a disabled or unregistered provider. `routing-block.test.ts` covers a profile on an `error` snapshot and on an `unavailable` provider.
- `routing-block.test.ts` (snapshot `error` / `loading` → provider only, `loading` passes configured values through; `defaultModeId` null or outside the catalog → first mode; no modes → no `modeId`; `getProvider` throwing rejects), `trailing-routing-block.test.ts`, `agent-projections.test.ts`, import previews in `claude/agent.test.ts`, `omp/` and `pi/session-descriptor.test.ts`, `session.create-agent-title.test.ts` (links → labels). ACP previews share the same one-line change and have no fixture for loaded prompts.

### 7. Wrong vs Correct

#### Wrong

```ts
// Resolved before startAgentRun: /goal waits on the snapshot, and the block rides into OOB parsing.
const block = await resolveRoutingBlock(input);
await startAgentRun(manager, id, appendRoutingBlock(prompt, block), logger);

// Mode left to create_agent: a same-provider parent's mode leaks into the subagent.
settings: { ...(entry.defaultModeId ? { modeId: entry.defaultModeId } : {}) }
```

#### Correct

```ts
await sendPromptToAgent({
  ...params,
  resolveRoutingBlock: this.routingBlockResolver(msg.text),
});
// createSessionAgent → createAgentCommand({ kind: "session", resolveRoutingBlock: this.routingBlockResolver(trimmedPrompt) })

// Only a catalog mode, and always one when the catalog has modes.
const modeIds = (entry.modes ?? []).map((mode) => mode.id);
const modeId = [configuredModeId, entry.defaultModeId ?? undefined].find(
  (id) => id !== undefined && modeIds.includes(id),
) ?? modeIds[0];
```

## Scenario: the daemon calls an upstream with a secret the client never sees

Reference implementations: `provider.api_endpoint.fetch_models` / `provider.api_endpoint.cancel` (api-endpoint ticket 03) and `provider.api_endpoint.test_connection` (ticket 04), which share the cancel RPC and the session's pending-request map.

### 1. Scope / Trigger

- An RPC makes an outbound HTTP request with a key stored on the host. The key must not reach the client, the request must time out, and the client must be able to cancel it.

### 2. Signatures

- `fetchUpstreamModels({ provider, baseUrl, apiKey, signal, timeoutMs }) → { ok: true, models } | { ok: false, error: UpstreamFailure }` in `server/api-endpoints/upstream-models.ts`; no throw, no logging.
- `testUpstreamConnection({ provider, baseUrl, apiKey, modelId, signal, timeoutMs }) → { kind: "result", result: ApiEndpointTestConnectionResult } | { kind: "cancelled" }` in `server/api-endpoints/upstream-connection.ts`. Upstream failures are a `result` with `ok: false`, not a thrown error.
- Shared helpers (`extractErrorDetail(text, apiKey)`, `structuredErrorMessage`, `describeNetworkError`, `ANTHROPIC_VERSION`) live in `server/api-endpoints/upstream-http.ts`.
- `ApiEndpointService.fetchModels(provider, ApiEndpointUpstreamInput, signal) → ApiEndpointModel[]` and `testConnection(provider, ApiEndpointUpstreamInput & { modelId }, signal) → ApiEndpointTestConnectionResult`; both throw `ApiEndpointRequestError` for request-level failures (`invalid_input`, `not_found`, `cancelled`).
- `ApiEndpointSession.handle(request, connectionSignal)`: session passes `this.delivery.requestSignal`. `dispose()` aborts every pending upstream request; `Session.cleanup` calls it.
- Client: `apiEndpointFetchModels(options, requestId?)`, `apiEndpointTestConnection(options, requestId?)`, `apiEndpointCancel(targetRequestId)`. The caller picks the `requestId` so it can cancel it.

### 3. Contracts

- Pending requests live in a `Map<requestId, AbortController>` per session; the upstream signal is `AbortSignal.any([controller.signal, connectionSignal])`, and the timeout is added inside `fetchUpstreamModels` so `cancelled` and `upstream_timeout` stay distinguishable.
- A cancelled request still gets its response, with `error.code: "cancelled"`. `cancel` answers `cancelled: false` when the target already finished.
- The key comes from the request, else from the saved endpoint; it is never in a response or a log. Echoed upstream text has the key replaced with `***` **before** it is truncated to 300 characters — truncating first can cut the key in half and leak the first half.
- `test_connection` response: `{ requestId, result: { ok, status: number | null, durationMs, error } | null, error }`. `result` carries the upstream verdict (`status: null` when nothing came back); the top-level `error` is set only when the request itself was refused or cancelled, and then `result` is `null`.
- Test requests mirror the CLI: Claude `POST <base>/v1/messages` with Bearer + `anthropic-version` only (no `x-api-key`, as Claude Code sends with `ANTHROPIC_AUTH_TOKEN`), body `{ model, max_tokens: 1, messages: [ping] }`; Codex `POST <base with /v1>/responses` with Bearer, body `{ model, input: [message] }` — no `store`, `previous_response_id`, or `max_output_tokens`. Timeout 30 s (`connectionTestTimeoutMs`), fetch is 15 s.
- The protocol name shown to users comes from `apiEndpointProtocolName(provider)` in `@getpaseo/protocol/api-endpoint/rpc-schemas`; daemon and App both read it.
- Read-only upstream calls stay out of the service's mutation queue.

### 4. Validation & Error Matrix

- No typed key and no `endpointId` with a saved key → `invalid_input`, no request sent. Unknown `endpointId` → `not_found`.
- Non-404/405 status on either address → `upstream_error` (`HTTP <status>: <detail>`). Both addresses unreachable → `upstream_unreachable`. Otherwise (404, not a model list) → `models_unsupported`.
- Timeout → `upstream_timeout`, second address not tried. Client cancel or disconnect → `cancelled`.
- Test connection, inside `result.error`: 405, or 404 whose body is a framework default (no JSON error, or a message starting `Not Found` / `Invalid URL`) → `protocol_unsupported`; any other non-2xx → `upstream_error` with `POST <url>: HTTP <status>: <detail>` (a 404 "model does not exist" stays here); 2xx whose body is not the protocol's object (`type: "message"` / `object: "response"`) → `protocol_unsupported`; no response → `upstream_unreachable` or `upstream_timeout` with `status: null`. No model → `invalid_input` before any request.

### 5. Good/Base/Bad Cases

- Good: Codex base `https://relay/v1` → `/v1/v1/models` 404 → `/v1/models` lists `models[].slug`.
- Base: upstream returns `data: []` → `ok` with no models; the form says so and offers manual add.
- Bad: reporting the second address's 404 when the first returned 401 (hides the real cause).
- Good (test): Codex relay with only Chat Completions → bare 404 on `/v1/responses` → `protocol_unsupported`; the App says the address lacks OpenAI Responses and to check the Base URL.
- Bad (test): treating every 404 as "protocol unsupported" — OpenAI and Anthropic answer an unknown model with a JSON 404 too.

### 6. Tests Required

- `upstream-models.test.ts` against a local `node:http` server: both addresses, both shapes, pagination, 401 without the key in the message, unsupported, timeout (one request only), cancel, unreachable.
- `daemon-e2e/api-endpoint-models.e2e.test.ts`: typed key; saved key with a blank field (upstream sees it, response does not); Codex fallback; 401; no key → no request; cancel by `requestId`; mapping written and restored.
- `upstream-connection.test.ts` against a local `node:http` server: exact request body and headers per provider; 401 message with `***`; unknown model stays `upstream_error`; key echoed across the 300-char cut not leaked; bare and framework-JSON 404 plus a Chat Completions 200 → `protocol_unsupported`; timeout and unreachable with `status: null`; cancel → `{ kind: "cancelled" }`.
- `daemon-e2e/api-endpoint-test-connection.e2e.test.ts`: saved key with a blank field; 401 and unknown model with status and upstream text; Codex base without `/v1` hits `/v1/responses`; chat-only relay → `protocol_unsupported`; no key / blank model → no request; cancel by `requestId`.
- `messages.api-endpoint.test.ts`: request/response parse, including an error code the client has never seen.

### 7. Wrong vs Correct

#### Wrong

```ts
// 客户端放弃等待，daemon 仍然挂着请求直到超时，也分不清超时和取消
const result = await fetch(url, { signal: AbortSignal.timeout(15_000) });
```

#### Correct

```ts
const timeout = AbortSignal.timeout(input.timeoutMs);
const signal = AbortSignal.any([input.signal, timeout]); // input.signal = client cancel + disconnect
// catch: input.signal.aborted → cancelled; timeout.aborted → upstream_timeout
```

## Scenario: host state that replaces a provider's model catalogue

Reference implementation: the active API endpoint (api-endpoint ticket 05). Reuse this shape for any host-side mode that decides which models a provider may run.

### 1. Scope / Trigger

- Something on the host, not the provider's own catalogue, decides the exact set of models a built-in provider accepts, and the set changes at runtime without a config reload.

### 2. Signatures

- `ProviderModelOverride = (provider: AgentProvider) => AgentModelDefinition[] | null` in `server/agent/agent-sdk-types.ts`; `null` means "use the provider's catalogue".
- `ApiEndpointService.activeModels(provider: string): AgentModelDefinition[] | null` is the single source: the active endpoint's checked models with real ids, `isDefault` on the endpoint's default model.
- Injected twice from `bootstrap.ts`: `ProviderSnapshotManagerOptions.modelOverride` and `AgentManagerOptions.modelOverride`.
- `ApiEndpointServiceOptions.onActiveEndpointChanged(provider)` → `providerSnapshotManager.refreshSettingsSnapshot({ providers: [provider] })`, with `.catch` logging `{ err }`.
- Wire: `ProviderSnapshotEntry.isModelListAuthoritative?: boolean` in `packages/protocol/src/messages.ts` and both hand-written `ProviderSnapshotEntry` interfaces (`protocol/src/agent-types.ts`, `server/agent/agent-sdk-types.ts`).
- The same refresh also publishes `ProviderSnapshotEntry.activeApiEndpoint?: ApiEndpointRef` (`{ id, name }`), from `ProviderSnapshotManagerOptions.activeApiEndpoint: ActiveApiEndpointLookup`. It is the app's only source for "this provider is on an endpoint" outside the provider panel (plan usage label, the inherited-endpoint hint); set on `ready` entries only, like the model override.

### 3. Contracts

- `ProviderSnapshotManager.refreshProvider` still runs availability and `fetchCatalog` (modes, default mode come from there), then replaces `catalog.models` wholesale with the override, passes each row through `client.resolveConfiguredModel` like config.json profile models, and sets `isModelListAuthoritative: true`. Nothing the provider appended survives — Claude's `settings.json` rows (`ANTHROPIC_MODEL`, `ANTHROPIC_DEFAULT_*_MODEL`) would otherwise duplicate the endpoint's models.
- `AgentManager.resolveDefaultModelId` reads the override before `client.fetchCatalog`. It bypasses the snapshot, so without this a CLI / MCP / schedule create with no model gets the official default.
- The override reads the store on every call; there is no cache to invalidate. The refresh only republishes. Refresh after: activate, back to Official, save of the active endpoint, delete of the active endpoint. Detecting an external change does not refresh: the override reads the store, which an outside edit to the CLI file does not touch, so a refresh would publish the same list.
- `ApiEndpointService` is constructed before `createAgentProviderRuntime` and the `AgentManager`; its callbacks close over `providerSnapshotManager` and `agentManager`, declared later, and run only after startup.
- The field is optional and needs no capability gate: an old host never sends it and the app treats absence as non-authoritative; an old app ignores it.

### 4. Validation & Error Matrix

- Official, or a provider with no endpoint support → override `null`, catalogue unchanged, field absent.
- Endpoint store unreadable → thrown inside `refreshProvider`'s try, the entry becomes `status: "error"`; inside `resolveDefaultModelId` it is outside the try and propagates.
- Custom provider that `extends: claude` → id is not `claude`, override `null`; its catalogue is not replaced.

### 5. Good/Base/Bad Cases

- Good: activate → snapshot lists only `relay/*`, `isModelListAuthoritative: true`; a create with no model runs `relay/haiku`.
- Base: back to Official → the next refresh publishes the provider's own catalogue and drops the field.
- Bad: replacing models only in the snapshot — the picker looks right, but `paseo run` with no `--model` still sends `claude-opus-*` to the relay.

### 6. Tests Required

- Daemon E2E (`daemon-e2e/api-endpoint-claude.e2e.test.ts` "provider snapshot follows…", `api-endpoint-codex.e2e.test.ts`): `expect.poll` the snapshot after activate / edit / Official / delete; `createAgent` with no model asserts `agent.model` is the endpoint's default id.
- Unit (`provider-snapshot-manager.test.ts`): override replaces rows the catalogue returned, runs `resolveConfiguredModel`, sets and clears the flag; a real `ClaudeAgentClient` on a temp `settings.json` (version injected, `isAvailable` overridden, no CLI run) proves the settings rows disappear.
- Protocol (`messages.api-endpoint.test.ts`): entry parses with and without the field.

### 7. Wrong vs Correct

#### Wrong

```ts
// Snapshot-only: AgentManager.resolveDefaultModelId still asks client.fetchCatalog.
const models = override ?? catalog.models;
```

#### Correct

```ts
// bootstrap.ts — one source, two consumers.
function apiEndpointModelOverride(provider: AgentProvider): AgentModelDefinition[] | null {
  return apiEndpointService.activeModels(provider);
}
// snapshotManager: { modelOverride: apiEndpointModelOverride }
// new AgentManager({ modelOverride: apiEndpointModelOverride, ... })
```

## Scenario: a listing that reports the health of a file the daemon doesn't own

Reference implementation: `provider.api_endpoint.list` health (api-endpoint ticket 06) and the live session count (ticket 07).

### 1. Scope / Trigger

- The daemon writes a file others also write, and the client has to show whether the file still holds what the daemon wrote, without a watcher.

### 2. Signatures

- Wire (`protocol/src/api-endpoint/rpc-schemas.ts`): `ApiEndpointHealthIssueSchema = { code: string, message: string }`; list payload adds `health?: ApiEndpointHealthIssue[]`, `cliBaseUrl?: string | null`, and `runningSessionCount?: number`.
- Service: `ApiEndpointService.list(provider): Promise<ApiEndpointListResult>` (async; `ApiEndpointListResult` is `Required<Pick<payload, "endpoints" | "activeEndpointId" | "health" | "cliBaseUrl" | "runningSessionCount">>`), `activeEndpointId(provider)` for the sync error path. Internal `ApiEndpointHealthCode` union.
- Count: required option `ApiEndpointServiceOptions.countLiveSessions(provider) => number`, wired in bootstrap to `AgentManager.countLiveAgents(provider)` (non-internal agents of exactly that provider whose lifecycle is `initializing`, `idle`, or `running`).
- App: `selectApiEndpointHealthView(state) → { alert: { variant, issues, activeEndpoint } | null, officialTarget }`, `apiEndpointHealthMessageKey(issue)` in `api-endpoints/internal/section-state.ts`.

### 3. Contracts

- Codes: `modified_externally` (an owned key no longer holds `written`; message names the keys), `config_unparsable`, `codex_version_unsupported` (active Codex endpoint and `codex --version` below 0.118.0), `codex_unavailable` (the probe itself failed; never reported as "outdated"), `codex_profile_override` (legacy top-level `profile` whose `[profiles.<name>]` sets `model_provider` / `model`; reported in both modes so it shows before enabling).
- `cliBaseUrl` is set only in Official: Claude `env.ANTHROPIC_BASE_URL`; Codex the effective provider (profile over top level, default `openai`), its `model_providers.<id>.base_url`, or `openai_base_url` for `openai`.
- Re-apply has no RPC of its own: it is `set_active` with the active id, so it runs the same version check and conflict guard. "Switch to Official" is `set_active(null)`.
- New write error `config_conflict` (file kept changing during the write). The app localizes it and `modified_externally`, `config_unparsable` (health wording), `codex_profile_override`; other codes show the daemon message.
- `runningSessionCount` counts live sessions, not only `running` ones: an idle Claude process re-reads `settings.json` on its next turn, so it is affected too. Custom providers that extend `claude` are not counted. The count answers "how many sessions does rewriting the CLI config touch", so it lives on the list and the app fetches the list again right before each confirmation.
- The app reads the optional fields with `?? []` / `?? null`: the protocol keeps new fields optional, so this default is permanent, not a COMPAT shim. A `null` count drops the session line from the confirmation and keeps the terminal line.

### 4. Validation & Error Matrix

- Owned key edited → `modified_externally`; other keys edited → no issue.
- File deleted while an endpoint is active → every owned key listed as modified.
- File does not parse → `config_unparsable` in `health`; the list itself still succeeds.
- Codex binary missing → `codex_unavailable` in `health`; `list.error` stays null.

### 5. Good/Base/Bad Cases

- Good: another tool rewrites `env.ANTHROPIC_BASE_URL` → the panel shows one error Alert with Re-apply and Switch to Official.
- Base: Official with a hand-written relay → no Alert, the Official row says where the CLI's own settings point.
- Bad: a watcher that rewrites the file when it changes (ADR 0004: never overwrite silently).

### 6. Tests Required

- Pure: `inspectClaudeSettings` / `inspectCodexConfig` cases in the patch tests (owned vs other keys, deleted file, WebSearch entry only when added, every table field, legacy profile, base URL resolution).
- Daemon: modified → re-apply → clean; modified → Official restores originals; `cliBaseUrl` in Official only; downgraded and missing Codex; `runningSessionCount` counts two Claude agents and not the Codex one, and drops after `archiveAgent`.
- App: `section-state.test.ts` for the view derivation; `index.test.tsx` for the Alert buttons and the Official hint.
- Protocol: payload parses with health/cliBaseUrl/runningSessionCount and without them.

### 7. Wrong vs Correct

#### Wrong

```ts
} catch (error) {
  return { code: "codex_version_unsupported", message: String(error) }; // "update Codex" for a missing binary
}
```

#### Correct

```ts
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  return { code: "codex_unavailable", message: `Couldn't run codex --version: ${reason}` };
}
```

## Scenario: a one-off timeline notice the daemon adds on resume

Reference implementation: the API endpoint mode notice (api-endpoint ticket 08). Reuse the shape when resuming a session should tell the user something the provider history can't.

### 1. Scope / Trigger

- A persisted agent carries host state from its creation (here: which API endpoint was active), and resuming it under different host state deserves a warning in the conversation. The text must be localized, but timeline items are daemon-authored.

### 2. Signatures

- Record: `StoredAgentRecord.apiEndpointId?: string` (`agent-storage.ts`), `ManagedAgentBase.apiEndpointId?: string`, projected by `toStoredAgentRecord` and carried by `dispatchStoredAgentState`, reload, and `registerSession({ apiEndpointId })`.
- Port: `ApiEndpointModeSource { active(provider): ApiEndpointRef | null; endpointName(provider, id): string | null }` in `agent-sdk-types.ts`, wired in `bootstrap.ts` to `ApiEndpointService.activeEndpoint` / `endpointName`; `AgentManagerOptions.apiEndpointMode`.
- Builder: `buildApiEndpointModeNotice({ modes, provider, createdIn: string | null }) → notification | null` in `server/agent/api-endpoint-mode-notice.ts`.
- Wire: `notification.apiEndpointModeMismatch?: { createdIn: ApiEndpointCreatedRef | null; current: ApiEndpointRef | null }` (`ApiEndpointCreatedRef.name` is `null` for a deleted endpoint) in `protocol/src/api-endpoint/rpc-schemas.ts`, on the `messages.ts` timeline union and both hand-written `AgentTimelineItem` types.
- `resumeAgentFromPersistence(handle, overrides, agentId, options: { …, apiEndpointId?: string | null })`: the caller's value is used only when no record exists under `agentId` (`session.ts` `resume_agent_request` resumes under a new id and passes the matched record's mode).

### 3. Contracts

- Stamp at create and import with `active(provider)?.id`; absent means Official, including records written before the field existed. Resume never rewrites it.
- Creation mode on resume: record by id → `record.apiEndpointId ?? null`; else the caller's value; else unknown → stamp the current mode and queue nothing.
- The notice is queued after `registerSession` and appended by `hydrateTimelineFromProvider` after the history rows, so it lands at the end of the conversation, not before the replayed history. `appendTimelineItem` is fine: `registerSession` already touched `updatedAt` on this resume.
- Not queued for `purpose: "history"` (viewing an archived session). Dropped when a deep-equal notice is already in the retained timeline: `closeAgent` keeps `timelineStore`, so an in-process re-resume would otherwise add a second copy. After a daemon restart the timeline is rebuilt and one notice appears again — "once per resume" by design; nothing extra is persisted.
- `message` is the English fallback for old clients; the app renders `apiEndpointModeMismatch` through `describeApiEndpointModeMismatch` (`app/src/api-endpoints/internal/notices.ts`, exported from `@/api-endpoints`), which returns `null` for Official→Official and the app keeps `message`.

### 4. Validation & Error Matrix

- Provider without endpoint support (`findProvider` misses) → `active` returns null, record has no field → no notice.
- Created under an endpoint since deleted → `createdIn: { id, name: null }`, "…an API endpoint that has since been deleted…".
- Record without a persistence handle → `ensureAgentLoaded` creates a new provider session with the same id; it is stamped with the current mode, no notice (a new session is not a continuation).
- No `apiEndpointMode` injected (unit suites) → nothing stamped, nothing queued.

### 5. Good/Base/Bad Cases

- Good: created on endpoint "Relay", switched to Official, daemon restarted → fetching the timeline resumes it and ends with one warning naming "Relay".
- Base: created and resumed in the same mode → no notice; record keeps its field.
- Bad: appending the notice right after `resumeSession` — history hydration then replays the provider log after it, and the warning sits above the conversation it is about.

### 6. Tests Required

- Daemon E2E (`api-endpoint-claude.e2e.test.ts` "an agent session remembers…"): record has `apiEndpointId` under an endpoint and none under Official or for Codex; restart → exactly one notice with the full `apiEndpointModeMismatch`, still one after a second fetch and after `agentManager.closeAgent` + fetch; old/Official record resumed under an endpoint → `createdIn: null`; deleted endpoint → `name: null`; archived agent fetched after restart → no notice.
- Protocol (`messages.api-endpoint.test.ts`): notification parses with and without the field; snapshot entry with and without `activeApiEndpoint`.
- App (`api-endpoints/internal/notices.test.ts`): every created/current combination → key and params; `undefined` and Official→Official → `null`.

### 7. Wrong vs Correct

#### Wrong

```ts
// Localizing on the daemon, or a one-shot flag persisted on the record.
item = { type: "notification", level: "warning", message: t("…") };
```

#### Correct

```ts
// Structured facts for the app, English for old clients, queued until history is in.
const notice = buildApiEndpointModeNotice({ modes: this.apiEndpointMode, provider, createdIn });
if (notice) this.pendingApiEndpointModeNotices.set(agentId, notice);
```

## Scenario: optional snapshot field filled by a best-effort probe

Example: `ProviderSnapshotEntry.version`, the installed CLI version of a built-in provider, gated by `server_info.features.providerVersions`.

### 1. Scope / Trigger

- A new optional field on a provider snapshot entry whose value comes from running a host command (`<cli> --version`), where failure must never change the entry's status.

### 2. Signatures

- Protocol: `ProviderSnapshotEntrySchema.version: z.string().optional()`; `features.providerVersions: z.boolean().optional()` (`packages/protocol/src/messages.ts`).
- Server: `AgentClient.resolveInstalledVersion?(signal?): Promise<string | null>`; `ProviderCatalog.installedVersion?: DiscoveredCliVersion` where `DiscoveredCliVersion = { status: "found"; version } | { status: "unreadable" }` (`agent-sdk-types.ts`).
- Helper: `parseCliVersion(output): string | null` and `resolveProviderCliVersion({ runtimeSettings, defaultBinary, signal })` (`agent/provider-cli-version.ts`).

### 3. Contracts

- `version` is the first plain `x.y.z` in stdout+stderr; prerelease suffixes are dropped.
- Filled only when `entry.source === "builtin"` and the catalog probe succeeded; `error`, `unavailable`, disabled, custom and ACP entries omit it.
- The probe runs the command the provider actually launches (config `command` + `env`), after the refresh deadline, with its own 5 s exec timeout.
- A provider that already ran `--version` during `fetchCatalog` (Claude) reports it through `ProviderCatalog.installedVersion`; the manager then skips its own probe.
- The daemon advertises `providerVersions: true` unconditionally; the app gates the list row and the detail "Version" section on it (`COMPAT(providerVersions)`).

### 4. Validation & Error Matrix

- Output has no `x.y.z` → field omitted, status unchanged.
- Probe throws / times out → logged at debug, field omitted, status unchanged.
- Catalog probe fails → status `error`, no probe, no field.
- Old daemon → no flag → app shows no version.

### 5. Good/Base/Bad Cases

- Good: fake `copilot` prints `GitHub Copilot CLI 1.0.89.` → `{ status: "ready", version: "1.0.89" }`.
- Base: unreadable output → `{ status: "ready" }` with no `version`.
- Bad: putting the probe inside `runProviderRefreshWithDeadline` — a slow probe turns a ready entry into `error`.

### 6. Tests Required

- Unit `provider-cli-version.test.ts`: real samples for codex, copilot, opencode, pi, omp; unparseable inputs → `null`. Claude's sample lives in `claude/models.test.ts` (`parseClaudeCodeVersion`).
- Daemon e2e `daemon-e2e/provider-version.e2e.test.ts` (real clients, fake sh CLIs): Claude ready + version; unreadable → ready without version on both the Claude and the generic path; custom and disabled entries carry none.
- App jsdom: list row `"3 models · v2.1.280"` only with the flag; detail order and version/install-guide exclusivity.

### 7. Wrong vs Correct

#### Wrong

```ts
// Runs --version a second time for Claude and can time the whole refresh out.
operation: async (context) => ({ catalog: await fetchCatalog(), version: await client.resolveInstalledVersion?.(context.signal) }),
```

#### Correct

```ts
const catalog = await runProviderRefreshWithDeadline({ … return await definition.fetchCatalog(…) });
let version: string | undefined;
if (base.source === "builtin") version = await this.readInstalledVersion({ provider, catalog, client });
```

## Scenario: a user-triggered outbound lookup cached in the daemon

Example: `provider.version.check.request`, which compares each built-in CLI's installed `version` with npm's `latest`.

### 1. Scope / Trigger

- A read RPC whose answer needs the public internet. `docs/usage.md` ("The one outbound request") allows only one daemon-initiated request, so this one must run only when a client asks.

### 2. Signatures

- Protocol: `ProviderVersionCheckRequestSchema { requestId, providers?: string[], force?: boolean }`; response `{ requestId, results: ProviderVersionCheckResult[] }`, result `{ provider, installedVersion?, latestVersion?, updateAvailable, error? }` (`packages/protocol/src/messages.ts`). Permission `daemon.read` both ways.
- Package names: `AgentProviderDefinition.npmPackage` (`packages/protocol/src/provider-manifest.ts`), one per built-in provider.
- Server: `ProviderVersionCheckService.check({ providers?, force? })`, `isNewerVersion({ installed, latest })`, `FetchLatestVersion = ({ npmPackage, signal }) => Promise<string>` (`agent/provider-version-check.ts`). `WebSocketServer` builds the service from `providerSnapshotManager.listProviders({ wait: true })`; the fetcher comes from `PaseoDaemonConfig.providerVersions.fetchLatestVersion`, default `fetchNpmLatestVersion` (`registry.npmjs.org/-/package/<pkg>/dist-tags`, zod-parsed, 15 s timeout).
- Client: `DaemonClient.checkProviderVersions({ providers?, force? })`.

### 3. Contracts

- Only `source === "builtin"` entries with an `npmPackage` appear in `results`.
- An entry without `version` (disabled, not installed, unreadable) returns `{ provider, updateAvailable: false }` and is never looked up.
- Latest versions are cached in memory per provider for 1 hour; failures are not cached. Concurrent lookups for one provider share one request, `force` included. `force` skips the cache.
- `updateAvailable` is a semver compare; either side unparseable → `false`.
- No lookup at startup or on a timer. `createTestPaseoDaemon` injects a fetcher that throws, so a test daemon never reaches npm.

### 4. Validation & Error Matrix

- npm non-2xx, timeout, or no `latest` tag → that result carries `error` (the message), `updateAvailable: false`, no `latestVersion`; logged at `warn`; other providers unaffected.
- Snapshot read throws → `rpc_error` with code `provider_version_check_failed`.

### 5. Good/Base/Bad Cases

- Good: installed `2.1.280`, latest `2.1.285` → `{ installedVersion: "2.1.280", latestVersion: "2.1.285", updateAvailable: true }`.
- Base: registry unreachable for copilot → copilot has `error`, claude still answers.
- Bad: querying npm for every built-in provider on daemon start "to warm the cache" — it breaks the outbound-request rule.

### 6. Tests Required

- Unit `provider-version-check.test.ts`: semver cases (numeric not lexical, prerelease, unparseable); cache expiry via injected `now`; concurrent checks share one lookup.
- Daemon e2e `daemon-e2e/provider-version.e2e.test.ts` with a stub registry: latest + `updateAvailable`; cached answer until `force`; one failed lookup only marks that provider; entries without a version are not looked up (the stub would write an `error` if they were).
- Protocol `messages.test.ts`: request with and without optional fields; results omitting versions and error.

### 7. Wrong vs Correct

#### Wrong

```ts
// Session-level optional service plus an rpc_error branch, only so in-process tests can omit it.
providerVersionCheckService?: ProviderVersionCheckService;
```

#### Correct

```ts
// The WebSocketServer owns it; only the network function is injectable at the daemon config boundary.
this.providerVersionCheckService = new ProviderVersionCheckService({
  listProviders: () => providerSnapshotManager.listProviders({ wait: true }),
  fetchLatestVersion,
  logger: this.logger.child({ module: "provider-version-check" }),
});
```

## Scenario: a request that runs a command on the host

Example: `provider.upgrade.request`, which runs a built-in CLI's own upgrade subcommand (`claude update`, `opencode upgrade`, …), or, for Codex, the official upgrade for the way it was installed.

### 1. Scope / Trigger

- An RPC that executes a program on the daemon host, can run for minutes, and must report the program's raw output. Permission is `daemon.manage` both ways (same class as plugin install/update).

### 2. Signatures

- Protocol: `ProviderUpgradeRequestSchema { requestId, provider }`; response payload `ProviderUpgradeResponsePayload { requestId, provider, ok, version?, output?, errorCode?: string, error? }`; known codes `PROVIDER_UPGRADE_ERROR_CODES` (`unsupported | install_method_unknown | not_installed | in_progress | command_failed | timeout | version_unchanged`). `errorCode` is a plain string on the wire so a newer daemon's code never fails an older client's parse.
- Pure (`agent/provider-upgrade-command.ts`):
  - `hasProviderUpgradeCommand(provider)` — true for the subcommand table plus `codex`.
  - `resolveProviderUpgradeCommand({ provider, launch, executableRealPath, platform })` → `{ kind: "run"; command; args; env? } | { kind: "install_method_unknown" } | { kind: "unsupported" }`. `env` is overlaid on the provider's `envOverlay` by the service.
  - `detectCodexInstallMethod({ realPath, platform })` → `{ method: "standalone"; codexHome } | { method: "homebrew"; prefix } | { method: "npm"; prefix } | { method: "unknown" }`.
  - `clipUpgradeOutput(output, limit = 32_000)`.
- Launch: `AgentClient.resolveCliLaunch?(): Promise<ProviderCliLaunch | null>` (`{ executable, args, source, env }`, built on `resolveProviderCliLaunch` in `agent/provider-cli-version.ts`), forwarded in `wrapClientProvider`, reached through `ProviderSnapshotManager.resolveCliLaunch(provider)` (null when disabled).
- Service: `ProviderUpgradeService.upgrade(provider)` returns `Omit<ProviderUpgradeResponsePayload, "requestId">` (`agent/provider-upgrade.ts`). `createProviderVersionServices` in `websocket-server.ts` builds it next to the version check; `PaseoDaemonConfig.providerVersions.upgradeTimeoutMs` (default 10 min) is the test seam.
- Client: `DaemonClient.upgradeProvider({ provider })`, request timeout 20 min.

### 3. Contracts

- Order of refusals, none of which runs anything: non-builtin entry → `unsupported`; no upgrade command → `unsupported` (checked before the executable is looked up); no executable → `not_installed` (so a disabled Codex answers `not_installed`, not `unsupported`); Codex install method not recognised → `install_method_unknown`, `error` names the real path.
- Codex has no upgrade subcommand. The service passes `fs.realpath(launch.executable)` (the unresolved path when realpath throws — that can only push the result towards `install_method_unknown`) and `process.platform`. Rules, in this order, mirroring upstream `codex-rs/install-context` and the commands in `codex-rs/tui/src/update_action.rs`:

  | Real path (Windows: `\` → `/`, compared lower-case) | Method | Command |
  |---|---|---|
  | basename does not start with `codex` (replace-mode `node cli.js`: the executable is the interpreter) | unknown | — |
  | contains `/packages/standalone/releases/` | standalone, `codexHome` = the part before it | POSIX `sh -c "curl -fsSL https://chatgpt.com/codex/install.sh \| CODEX_NON_INTERACTIVE=1 sh"`; Windows `powershell -ExecutionPolicy Bypass -c "$env:CODEX_NON_INTERACTIVE=1; irm https://chatgpt.com/codex/install.ps1 \| iex"`; both with `env: { CODEX_HOME: codexHome }` |
  | POSIX contains `/lib/node_modules/@openai/codex/`; Windows `/npm/node_modules/@openai/codex/` or ends in `/npm/codex`, `/npm/codex.cmd` or `/npm/codex.ps1` | npm, `prefix` = the part before `/lib` (Windows: the `npm` dir) | `npm install -g --prefix <prefix> @openai/codex@latest` (package name from the manifest's `npmPackage`) |
  | macOS and starts with `/opt/homebrew/Caskroom/codex/` or `/usr/local/Caskroom/codex/` | homebrew | `<prefix>/bin/brew upgrade --cask codex` |
  | anything else: Microsoft Store, bun / pnpm global dirs, the Homebrew formula (`Cellar/codex`), a binary placed by hand, Linux `/usr/local` | unknown | — |

  A Homebrew node keeps npm globals under `/opt/homebrew/lib/node_modules`: that path is npm, not Homebrew, which is why the Homebrew rule matches `Caskroom/codex` and not the bare prefix.
- One run per provider: the provider id is added to the running set before the first `await`; a second request gets `in_progress` with no `output`.
- The executable is the provider's resolved one with its env. Replace-mode argv stays in front of the subcommand; append-mode args are dropped (a CLI reads a subcommand after session flags as a prompt).
- stdin is ignored; stdout and stderr are appended in arrival order and clipped to the tail while streaming.
- The run ends on the child's `exit`, not on `close`: a self-updater can leave a background process that inherits stdout, and `close` then never comes. After `exit` wait at most 2 s for `close` (listen for it before awaiting `exit`, it can fire synchronously right after), then destroy both pipes.
- Timeout and daemon shutdown kill the process tree (`terminateWithTreeKill`, 3 s grace).
- Whenever the command ran, success or not: forget the provider's cached latest version, `refreshSettingsSnapshot({ providers: [provider] })`, then read the entry's `version` into the response. The snapshot push therefore reaches the client before the response.
- The "before" version is the snapshot entry's `version` read at the start of `runUpgrade` (no probe before the command); the "after" version is the refreshed entry's. Both come from the same snapshot source, so a parser difference can never make them disagree. A snapshot that is stale-old (the user upgraded outside Osuna) can only turn a would-be `version_unchanged` into `ok: true`, never the reverse.

### 4. Validation & Error Matrix

- Exit 0, before and after both readable and equal → `version_unchanged`, `error: "<command line> exited cleanly but the version is still X"`, `output`, `version`. CLI self-update subcommands often only print a hint for a package-manager install (`claude update` under Homebrew) and exit 0; a lagging package manager looks the same.
- Exit 0, otherwise (versions differ, or either is unreadable) → `ok: true`, `output`, `version` if readable.
- Non-zero exit → `command_failed`, `error: "<command line> exited with code N"`, `output`.
- Spawn failure → `command_failed`, `error` is the spawn error, `output` (possibly empty).
- Past the timeout → `timeout`, partial `output`.
- Snapshot refresh throws → logged at `warn`, result unchanged.
- The service itself throws → `rpc_error` code `provider_upgrade_failed`.

### 5. Good/Base/Bad Cases

- Good: installed `2.1.280`, `claude update` writes `2.1.285` → `{ ok: true, version: "2.1.285" }`, the next check re-queries npm without `force`.
- Base: the CLI prints `EACCES` to stderr and exits 1 → `command_failed` with both streams in order and `version` still `2.1.280`.
- Base: `claude update` prints `Claude is managed by Homebrew…` and exits 0, version stays `2.1.280` → `version_unchanged` with that output; the App shows its own title over the output, and an older App shows "Upgrade failed" plus the raw `error`.
- Bad: waiting on `close` — `claude update` exits but its background helper holds the pipe, the request never answers, and every later upgrade of that provider gets `in_progress` until the daemon restarts.

### 6. Tests Required

- Unit `provider-upgrade-command.test.ts`: each provider's subcommand; replace argv kept; append args dropped; custom / ACP ids unsupported; every row of the Codex table (macOS / Linux / Windows standalone with `codexHome`, both Caskroom prefixes, npm under Homebrew node / official installer / nvm / Windows package and shim with the exact `prefix`, Store, bun, pnpm, formula, hand-placed, interpreter) and the exact command + `env` per method; tail clipping.
- Daemon e2e `daemon-e2e/provider-upgrade.e2e.test.ts` with a fake `sh` CLI (version file + `update` branch): success updates the snapshot `version` and the exact argv; cached latest forgotten; raw output on failure; exit 0 with an unchanged version → `version_unchanged` with output and `version`; exit 0 with the version unreadable before, after, or both → `ok: true` (`test.each`); `in_progress` while a run holds a file lock; timeout with `upgradeTimeoutMs: 1000` keeps partial output; a background `sleep 30 &` does not hold the answer; custom providers `unsupported`.
- Same e2e, Codex: `<tmp>/npm-prefix/bin/codex` symlinked to `lib/node_modules/@openai/codex/bin/codex.js`, a recording fake `npm` first on the provider env's `PATH` → argv is `install -g --prefix <realpath of the prefix> @openai/codex@latest` (assert on the argv, not `version`: the fake Codex has no app-server, so its entry is `error` and carries no version); a Codex outside every known layout → `install_method_unknown`, no `output`, npm never called.
- `provider-registry.test.ts`: a wrapped profile still exposes `resolveCliLaunch`.
- Protocol `messages.test.ts`: request for an unknown provider id; response with an unknown `errorCode`.

### 7. Wrong vs Correct

#### Wrong

```ts
// Hangs forever when a grandchild inherits stdout.
const exitCode = await new Promise<number | null>((resolve) => child.once("close", resolve));
```

#### Correct

```ts
const closed = once(child, "close").then(() => undefined, () => undefined);
[exitCode] = (await once(child, "exit")) as [number | null];
await drainOutput({ child, closed }); // race with a 2 s cap, then destroy the pipes
```

#### Wrong

```ts
// Upgrades with whichever npm PATH finds first: codex under nvm, npm from Homebrew → a second codex.
return { kind: "run", command: "npm", args: ["install", "-g", "@openai/codex@latest"] };
```

#### Correct

```ts
return { kind: "run", command: "npm", args: ["install", "-g", "--prefix", install.prefix, `${npmPackage}@latest`] };
```

## Errors on the wire

Handlers do not throw across the socket. They catch at the handler boundary, map to a wire error with a string-literal `code`, log with `err`, and emit a failure payload. See [Error Handling](./error-handling.md) for `SessionRequestError` and the `toXWireError` mapping functions.

## Anti-patterns

- Adding a `.request` without its `.response` and not saying why next to the schema.
- Deriving a response type by hand instead of from the protocol schema.
- Checking `server_info.features` on the daemon side, or adding a defensive fallback path for old clients instead of a tagged shim.
- Putting GitHub-specific enums into a `checkout.forge.*` name; forge-neutral names carry forge-neutral shapes only.
