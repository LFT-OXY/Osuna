# RPC and Protocol

Clients talk to the daemon over one WebSocket session. Every inbound message is a discriminated union on `type`, validated by generated zod-aot code before it reaches a handler (`docs/protocol-validation.md`). Schemas live in `packages/protocol`; the daemon re-exports them through `server/messages.ts` and adds serializers.

Config-shaped schemas that the daemon also persists live in leaf modules, not in `messages.ts`: `AgentProfileSchema` and `AgentSkillSelectionSchema` in `protocol/src/agent-profile.ts`, `PluginIdSchema` / `PluginRequirementsSchema` / `PluginSourceSchema` in `plugin-config.ts`, `TerminalProfileSchema` in `terminal-profile.ts`. `messages.ts` imports and re-exports them, so wire consumers keep their import path; daemon config code (`server/persisted-config.ts`) imports the leaf module so it does not load the whole message union. Upstream owns that split: don't move one of these back into `messages.ts`, and put a fork-only schema that sits beside them (`MutableUsage*`) in `messages.ts` or its own module, not inside an upstream leaf module.

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

- "Never narrow" guards messages some released Osuna version can send or parse. A message upstream introduced after Osuna's last release and that Osuna has not shipped yet (v0.11.0-beta.1's `usage.list_reports.*`, narrowed to a `status` discriminated union in beta.3) may change shape when the upstream merge brings the change; take it as-is, and say so in the merge ticket and PR body because the checklist line "new fields are optional" reads as failed. The old message it replaced (`provider.usage.list`) keeps its shape.
- An optional field the daemon adds to a response is permanent wire shape, not a shim: no `COMPAT` tag. Only the client's capability check (`features.gatewayLedger` in `usage-screen.tsx`) carries `COMPAT(...) remove gate after <date>`.
- A new kind of row that an old client's schema can't express (it requires a string, or an enum without your value) gets an optional boolean marker, and the required fields get placeholders. The usage report's unknown project is the shape: `unknown: true` with `rootPath: ""` and `kind: "directory"` only to satisfy old parsers. The placeholders live in one constant on the daemon (`UNKNOWN_PROJECT`, `server/usage/project-attribution.ts`); the app tests only the marker (`isUnknownUsageProject`). Never recognise the row by `rootPath === ""`.
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
- Codex model providers (cli-wiring-web-search ticket 12): the built-in Codex lists with `thread/list` `modelProviders: []` (every provider); a custom Codex provider lists only its own. Each descriptor carries optional `codexModelProvider` (no capability flag: display only, old daemons omit it and the row shows no label). When a custom Codex provider and the built-in one list the same handle, `dropStockCodexRowsCustomCodexOwns` (`agent-manager.ts`) keeps only the custom row — the built-in one can't resume a provider it has no table for; other derived providers (custom Claude) are never deduped. So the final list can hold fewer than `limit` rows. The app row reads "Codex model provider <id>" on its second line before the directory (directory truncates first, then the label, the id last); the time sits on the title line.
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

Reference implementation: the Routing block for Agent mentions (multi-agent tickets 05, 07 and 09). Reuse this shape when the daemon appends system text to a user message on its way to the provider. The logic map instruction block (`logic-map/logic-map-instruction-block.ts`, logic-map ticket 01) is the second user of the same resolver.

### 1. Scope / Trigger

- The provider must see extra instructions, while the timeline, bubble, title, history replay, and import picker show only what the user wrote. No wire change; gated by `server_info.features.agentMentions`.

### 2. Signatures

- `StartAgentRunOptions.resolveRoutingBlock?: () => Promise<string | null>`; `type RoutingBlockResolver = (agent: ManagedAgent) => Promise<string | null>` on `SendPromptToAgentParams.resolveRoutingBlock` and `StartCreatedAgentInitialPromptParams.resolveRoutingBlock` (`agent/agent-prompt.ts`), and on `CreateAgentFromSessionInput.resolveRoutingBlock` (`agent/create-agent/create.ts`, carried through `ResolvedCreateAgent` to `sendInitialPrompt`); `appendRoutingBlock(prompt, block)`.
- `AgentRunOptions.submittedPrompt?: AgentPromptInput` (`agent/agent-sdk-types.ts`): the original, read by the `recordSubmittedPrompt` calls in `agent-manager.ts` `streamAgent` (after the turn is accepted) and `recordAcceptedSteer`.
- `resolveRoutingBlock({ text, cwd, canCreateAgents, mentionDefaults, agentProfiles, providers })` (`agent/routing-block.ts`); `mentionDefaults: (providerId) => ProviderMentionDefaults | undefined` reads `daemonConfigStore.get().providers[id]?.mentionDefaults` and `agentProfiles` is `daemonConfigStore.get().agentProfiles ?? []`, both taken when the message is sent, so a `set_daemon_config` applies to the next message. `RoutingBlockSettings` is `{ modeId?, thinkingOptionId?, features? }`. Model and thinking fallbacks use `selectDefaultModel` / `resolveThinkingOptionId` shared with metadata generation.
- Config: `ProviderMentionDefaultsSchema = { model?, thinkingOptionId?, modeId? }` (each `z.string().min(1)`) in `packages/protocol/src/provider-config.ts`, on both `ProviderOverrideSchema` (persisted `agents.providers.<id>`) and `MutableDaemonProviderConfigSchema` (wire). Documented in `docs/data-model.md` "Mention defaults".
- `stripTrailingRoutingBlock(text)` (`agent/trailing-routing-block.ts`, a leaf module so providers can import it).
- A second trailing block joins inside `Session.routingBlockResolver`: `[routingBlock, logicMapBlock].filter(Boolean).join("\n\n")`, Routing block first. `resolveLogicMapInstructionBlock({ text, labels })` reads the agent's labels at send time and returns `null` for empty text, like the Routing block. Do not add a second resolver parameter.

### 3. Contracts

- Only client requests pass a resolver, built by `Session.routingBlockResolver(text)`: `handleSendAgentMessageRequest`, and `createSessionAgent` for the first message of `create_agent_request`, `agent.create.request`, and `workspace.create.request` (all three funnel into `createSessionAgent`; hub execution creates do not). The create path resolves against the freshly registered `ManagedAgent`, so its real `createAgentsCapability` decides, not the provider snapshot prediction. MCP `send_agent_prompt` and `create_agent` (`kind: "mcp"`), schedule fires, and finish notifications never pass one, so a parent forwarding the user's text cannot chain-dispatch.
- `startAgentRun` runs `tryRunOutOfBand` on the original first, then calls the resolver. Out-of-band commands never wait on the provider snapshot.
- Array prompts get a trailing text block; string prompts get `\n\n` + block. The timeline records `submittedPrompt`, reconciled by `clientMessageId`.
- A profile mention (`paseo://agent/profile/<id>`) resolves to its profile's `provider` and stacks layers: the profile's `model` / `thinkingOptionId` / `modeId` first, then that provider's Mention defaults (`resolveAgainstCatalog(entry, layers)`). Its non-empty `featureValues` go to `settings.features` as written; they are never validated.
- Layers resolve per field against a `ready` snapshot, first valid layer wins: model → first layer model in the selectable catalog, else the default model; thinking option → first layer value the chosen model offers, skipping any layer whose own model is stale (a retired model takes its thinking option with it), else that model's default (an unset model means the current default model); mode → first layer mode in `entry.modes`, else `defaultModeId` if in `entry.modes`, else `modes[0]`; no modes at all → no `modeId`. A stale profile value therefore falls back to Mention defaults before runtime defaults (decided with the user in ticket 09). A valid lower-layer thinking option applies to a profile's model when that model offers it. Only catalog modes are written because `create_agent` rejects a mode outside `availableModes` and, given none, inherits the parent's mode (same provider) or throws (cross provider).
- `DaemonConfigStore.applySupportedPatch` replaces a provider's `mentionDefaults` wholesale instead of deep-merging, so the card resets a field by omitting it. The persisted side already replaces it through the shallow spread in `applyMutableProviderConfigToOverrides`. `removeProviders` drops it with the entry. Changing it does not rebuild provider catalogs: `mentionDefaults` is not part of a provider definition's `configuration`.
- `stripTrailingRoutingBlock` strips every trailing `<paseo-system>` block in a loop, so Routing + logic map blocks both go; a message that is nothing but blocks is an envelope and comes back unchanged. It needs the closing tag at the end and runs only on provider-sourced text: live echoes, the echo fallback in `reconcileSubmittedPromptEcho`, force hydrate, prime, `buildImportedTimelineRows`, and import previews. Providers that collapse whitespace and truncate (`claude/agent.ts`, `acp-agent.ts`, `omp/` and `pi/session-descriptor.ts`) strip inside their `normalize*PromptPreview` before collapsing; `toRecentProviderSessionDescriptorPayload` strips full-text previews and titles (Codex thread preview).

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

## Scenario: a per-agent switch stored as a label, settable before the agent exists

Reference implementation: the logic map switch (`agent.logic_map.set_enabled.request`, logic-map ticket 01). Reuse this shape for a per-conversation on/off the user flips in the composer, on a running agent or on a draft that has no agent yet.

### 1. Scope / Trigger

- New RPC, new `server_info.features.logicMap` (`// COMPAT(logicMap)`), state that must survive a daemon restart and reach the client with the agent.

### 2. Signatures

- `AgentLogicMapTargetSchema = z.discriminatedUnion("kind", [{ kind: "agent", agentId }, { kind: "draft", workspaceId, createdMapName? }])` (`packages/protocol/src/messages.ts`); request `{ type, requestId, target, enabled, mapName? }` (`mapName` = continue that existing map; added with `features.logicMap`, so no separate flag); response payload `{ requestId, agentId: string | null, mapName: string | null, error: string | null }`.
- `setLogicMapEnabled(deps, { target, enabled })` (`server/logic-map/logic-map-toggle.ts`), deps `Pick`ed from `AgentManager` / `AgentStorage` / `WorkspaceRegistry`; typed errors in `logic-map-errors.ts`.
- Label `LOGIC_MAP_LABEL = "paseo.logic-map"`, value = map name; read with `getLogicMapNameFromLabels` (`@getpaseo/protocol/agent-labels`). `LOGIC_MAP_BRIEFED_LABEL = "paseo.logic-map.briefed"` = the map the agent was last given the once-per-switch-on reminder for; cleared on every on/off/switch.
- App: `useDraftLogicMapStore` (`app/src/logic-map/draft-logic-map-store.ts`, persisted, keyed `buildDraftLogicMapKey({ serverId, draftTabId })`, `createdMapName` optional so older stored drafts still parse); `readDraftLogicMapLabels(store, key)` goes into the create-agent `labels`; `forget(key)` after the agent is created.

### 3. Contracts

- The state is an agent label, not a new `StoredAgentRecord` field: labels already persist atomically, ship in the agent snapshot, and survive restart, so no schema or snapshot change. Cost: anything that can write labels (`update_agent`, `create_agent` labels) can also set it — fine for a user preference, not for a fact the model must not forge (that needs the tool-path stripping in "a daemon-owned agent label fed from the provider's tool call").
- Off removes the label only; the map on disk stays. On with the label already set reuses that map.
- Draft target: daemon creates the empty map under the workspace's `cwd` (or confirms the continued `mapName` exists) and returns `mapName`; it writes no state. The app keeps the draft's chosen map plus the empty map it created (`createdMapName`), reuses the created one when the user picks "新建" again, and sends the chosen map as the label when the first message creates the agent. Switching a draft from its created map to an existing one sends `createdMapName`; the daemon deletes that map only if it is still unwritten (no title, framework, nodes, edges, or other files) and no stored or live agent's label points at it (`discardUnwrittenLogicMap`, `isLogicMapInUse`). Known gap: another draft continuing the same empty map is not checked.
- The instruction block (`resolveLogicMapInstructionBlock`, async, reads the map at send time) varies by map state: framework not judged → judge, record, tell the user; framework present → 3–6 sentence notes, and on the first message after switch-on only (briefed label ≠ map) list marked nodes and ask to link them first; no framework → full node docs; map broken/missing → say which file and what problem. `markLogicMapBriefed` writes the briefed label before the provider receives the message, so a failed send loses that reminder.
- The block is only attached when the session can call the Osuna tools: `resolvePaseoToolsUnavailableReason(agent.createAgentsCapability)` (`server/agent/create-agents-capability.ts`) returns `mcp_disabled` / `tools_not_injected` / `tools_not_delivered` → no block and no `markLogicMapBriefed`, so the first message after the user turns the tools on still gets the once-per-switch-on reminder. `create_agent_not_allowed` covers only `create_agent` and does not count; `undefined` (not resolved yet) sends the block. Without this gate the agent is told to call `read_logic_map` it does not have and answers "tool not found" (logic-map ticket 08). The switch, its label and the map are unaffected. The app shows the same verdict next to the switch, only while the switch is on (`useLogicMapToolsUnavailableReason`, `app/src/logic-map/osuna-tools-availability.ts`, gated by `useLogicMapEnabled` in `composer/index.tsx`; Osuna tools are off by default, and an always-on hint squeezed the Codex speed control into its icon tier at 1280 — CI `codex-speed.spec.ts`): drafts reuse `resolveDraftCreateAgentsVerdict` from `hooks/use-agent-autocomplete.ts` instead of a second selector; only `tools_not_injected` gets the "open settings" action (Settings → Host → Agents), like the Agent mention notice, and only its running-agent copy says to reload the agent. Known gap: a provider tool filter that hides just `read_logic_map` / `update_logic_map` is not detected.
- A label patch on an unloaded agent does not push; the handler calls `agentUpdates.emitStoredRecord(labelWrite.record)` when `labelWrite.live` is false.
- Reads go through `workspace.logic_map.list` / `.get` (`.get` returns a `result` union so a hand-broken file is a readable `corrupt` case, not a transport error). `workspace.logic_map.changed` is opt-in: it is in `SessionEventSubscriptionSchema` and `legacyWantsEvent` returns `false` for it, so only clients that subscribed after seeing `features.logicMap` get it. Disk format and batch writes: `persistence.md` "a folder of files an agent edits in batches".

### 4. Validation & Error Matrix

- `target` missing or wrong `kind` → wire parse rejects (no runtime "agentId or cwd" fallback).
- Agent neither loaded nor stored → `LogicMapAgentNotFoundError`.
- `workspaceId` unknown or `archivedAt` set → `LogicMapWorkspaceNotFoundError` (never trust a client-sent `cwd`: the daemon would create folders anywhere).
- Workspace directory gone → `LogicMapDirectoryMissingError`; no free random name → `LogicMapNameUnavailableError`.
- Every error → response with `error` string; the app toasts and puts the switch back.
- Osuna tools unavailable (any reason except `create_agent_not_allowed`) → not an error: the switch stays on, the block is withheld, the app shows the warning hint.

### 5. Good/Base/Bad Cases

- Good: draft on → off → on → send: one `untitled-*` folder, agent created with the label.
- Base: running agent on twice → second call returns the same `mapName`, no new folder.
- Bad: draft state in a non-persisted store — the draft tab survives restart but the switch comes back off and the folder is orphaned.

### 6. Tests Required

- `messages.logic-map.test.ts`: both target kinds parse, bad target rejected, `features.logicMap` optional.
- `logic-map-store.test.ts`, `logic-map-instruction-block.test.ts`, `trailing-routing-block.test.ts` (both blocks stripped, envelope kept).
- Daemon E2E `daemon-e2e/logic-map-toggle.e2e.test.ts`: label after on/off, restart read-back, unknown workspace rejected, block present only when on, no block when the host turns the tools off or the session cannot receive them.
- App `draft-logic-map-store.test.ts` (rehydrate, reuse); browser `composer-logic-map-toggle.spec.ts` (on/off, reload keeps draft state, host rejects → toast + switch off, old host hint).

### 7. Wrong vs Correct

#### Wrong

```ts
// Bag of optionals: both or neither is a valid payload, and cwd is client-chosen.
z.object({ agentId: z.string().optional(), cwd: z.string().optional(), enabled: z.boolean() });
```

#### Correct

```ts
target: z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("agent"), agentId: z.string() }),
  z.object({ kind: z.literal("draft"), workspaceId: z.string() }),
]),
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

## Scenario: a local HTTP route that relays CLI traffic with a host secret

Reference implementation: the API endpoint gateway (api-endpoint-auto-switch tickets 02 and 04–07), `server/api-endpoints/gateway/`. The why behind its rules: `docs/adr/0007-api-endpoints-route-through-daemon-gateway.md`, partly superseded by `docs/adr/0008-gateway-reshapes-rejected-requests-and-fails-over-refusals.md` (gateway-robustness), and by `0009` (web search per endpoint) and `0010` (Codex wiring, caller recognition instead of token auth) from cli-wiring-web-search, whose code lands ticket by ticket; the gateway-robustness bullets below record what was built and every user decision. Not a session RPC: the CLIs call it over plain HTTP, so it lives outside the WebSocket layer and outside daemon auth.

### 1. Scope / Trigger

- A CLI the daemon configured must reach a third-party upstream, and the upstream's real key must stay inside the daemon. The CLI holds only a daemon-issued token.

### 2. Signatures

- `createApiEndpointGateway({ paseoHome, logger, cooldowns: EndpointCooldowns, overrides?: { gatewayHeaderTimeoutMs?, gatewayRetryPauseMs?, gatewayKeepAliveMs?, gatewayKeepAliveQuietMs? } }): RequestHandler`, mounted in `bootstrap.ts` with `app.use(API_ENDPOINT_GATEWAY_PATH, …)` (`/api-endpoint-gateway`) **before** `createRequireBearerMiddleware` and the global `express.json()`.
- Paths under the prefix: `POST /v1/messages` (Anthropic shape), `POST /v1/messages/count_tokens`, `POST /v1/responses` (OpenAI Responses shape), `GET /v1/models`, `GET /v1/models/{id}`, `POST /v1/chat/completions` (OpenAI Chat shape; pi-omp-endpoints ticket 01), `GET|HEAD /api/hello`. Claude Code's base URL is the prefix, Codex's is prefix + `/v1`; both land on the same paths. Pi and OMP may call any of the three request paths; the caller is recognised by its gateway token first (ADR 0010), and an unrecognised Chat caller is recorded as Pi.
- Two provider sets, not one: the gateway recognises four agents (`claude`, `codex`, `pi`, `omp` — tokens, ledger `cli`, request-format tables), but `CLI_CONFIG_PROVIDERS` / `CliConfigProvider` lists only the CLIs whose config Osuna rewrites and whose switch the RPCs accept. Settings RPCs, config rewrite, reopen hints and test-connection loop over `CLI_CONFIG_PROVIDERS`; a provider joins it in the ticket that wires its config rewrite. Looping over the four-agent list there sends Pi through Claude Code's config rewrite. Pi joined in 10-16-pi-omp-endpoints ticket 02 and its chat lookups and reopen hints in ticket 03. Osuna chat model ids for Pi are `osuna/<id>` (`chatModelId`, the way Pi names Osuna's models); the settings page strips the prefix before picking the default model (`settingsModelGroups` in the app), so `agents.pi.defaultModelId` stays the plain endpoint model id. OMP joined in ticket 04 the same way. Pi and OMP share one shape: `api-endpoints/pi-like-config.ts` (`PiLikeCli`) hides which files each writes (Pi `models.json` + `settings.json`, OMP `models.yml` + `config.yml`), and `service.ts` talks to that interface for apply / inspect / restore / follow / sync; add Pi-family behaviour there, not as another `provider === "pi"` branch. OMP-only rules from magpie: `osuna/**` joins `enabledModels` (`ompEvery`; omitted when the user already picks Osuna models by glob or level entry), and switch-off while another role or fallback chain still names `osuna/` rewrites the provider wiring and leaves `enabledModels` alone (`dropMagpie`). OMP model roles (ticket 05): `agentSettings.omp.modelRoles` is optional, keyed by OMP's role key (`task`, `smol`, `slow`, `plan`, `vision`, `advisor`, `commit`, `tiny`, `memory`; `packages/protocol/src/api-endpoint/omp-model-roles.ts`), sent for any other provider it is ignored like other single-provider fields. Roles follow every default-model rule: settled by `settleAgentSettings` only while the switch is on (a role whose model left is replaced on re-open, never cleared), `:level` and flow-style lists survive re-applies, and switch-off restores only roles still on `osuna/`.
- Model objects (endpoint-management-ux ticket 17, `gateway/model-list.ts`, magpie `modelObject` / `model` MIT; Cursor-only fields left out by the prd): every `/v1/models` entry and the single-model reply are one `GatewayModelObject` — OpenAI and Anthropic list fields together plus `display_name` (facts name, else id), `reasoning` (levels known), `supported_reasoning_levels: [{effort}]`, `context_window` / `context_length` / `max_input_tokens` (only when the window is known), `max_output_tokens` = `publishedOutput(facts)` (`model-facts.ts`, capped by the window; shared with the translated reply cap), `modalities: { input }` only when image support is known (`["text","image"]` or `["text"]`). Facts come from `ModelFactsLookup` (`model-facts.ts`, the one lookup type — parameters are named `factsFor`); a bare name reads `bareModelFacts`: the first enabled endpoint in endpoint order that selected it, the one the gateway sends it to first. Disabled models are absent from both routes (they read `usableModels` / `listed`). `GET /v1/models/{id}`: `modelIdOf` percent-decodes the id (only a `URIError` falls back to the raw text; anything else rethrows), then `singleModel` matches `slug/model` against that endpoint (its facts), else the bare name as listed; a miss → 404 `unknown model <id>` in OpenAI error shape (magpie `writeError(…Chat, 404…)`). Magpie's `unprefixed` (Claude Desktop alias ids) is not ported: Osuna never lists those ids. The ChatGPT backend `/models` (ticket 10) is not changed by this.
- ChatGPT backend (cli-wiring-web-search ticket 08, `gateway/chatgpt-backend.ts`, magpie `codex_backend.go` MIT): every method under prefix + `/backend-api/codex/*` (`CHATGPT_BACKEND_PATH`; the conversation, `/responses/compact`, `/models`, `/alpha/search`, anything else) is relayed byte for byte to `DEFAULT_CHATGPT_BASE_URL` + rest + query: request headers minus hop-by-hop and `Host` (`relayedHeaders` — the user's ChatGPT token and account id included, `Accept-Encoding` kept), body not decoded, no Osuna header added, reply status/headers/body streamed back chunk by chunk, ChatGPT's 401/403 untouched. Recognised as Codex by path. `Authorization: Bearer sk-…` (`isForOpenAiApi`, not for `/models`) goes to `DEFAULT_OPENAI_API_BASE_URL` instead, and an OpenAI 401 there is rewritten as magpie's `codexKeyRefused` (`apiKeyRefusedMessage`). Unreachable → 502 with an explanation (magpie `codexUnreached`). A WebSocket handshake on the path gets `426` (`answerChatGptWebSocket`, a daemon `upgrade` listener registered before `/ws`); the `/ws` server runs `noServer` with its own `upgrade` listener that skips sockets already ended, so only the 426 is written. Test seams: `gatewayChatGptBaseUrl`, `gatewayOpenAiApiBaseUrl` overrides — tests never reach chatgpt.com. Endpoint models on this path (ticket 10, `gateway/chatgpt-models.ts`, `codex-compaction*.ts`, `codex-models-cache.ts`, magpie MIT): `GET …/models` asks ChatGPT (3 s, `gatewayChatGptModelsWaitMs` in tests), else reuses the rewritten CODEX_HOME's `models_cache.json` minus Osuna's own entries; ChatGPT's 401/403 pass through; endpoint models follow as `slug/model` built by `codexEndpointEntries` (ticket 07 facts); `ETag` / `X-Models-Etag` get `+osuna-<tag>` (the tag covers endpoints, selected models, default model). A conversation, `/responses/compact` or `/alpha/search` naming `slug/model` is read (raw, 64 MB cap → 413) and routed through the normal candidates/failover with only Codex identity headers (`codexIdentityHeaders`: magpie's `codexHeader` + `codexClientHeader` list; never `authorization`, `chatgpt-account-id`, cookies, `x-oai-attestation`); a bare name stays a byte-for-byte ChatGPT relay. `/responses/compact` for an endpoint model → 400 as magpie; `/alpha/search` → 200 with an output saying the model can't search (404 would end Codex's turn). `compaction_trigger` for an endpoint model becomes Codex's summary prompt, sent to the gateway's own `/v1/responses`; the summary returns as an `osuna1:` compaction item read back as a summary message next turn (a ChatGPT-model request carrying such an item is re-serialized); summary failures (404, item not found, "Upstream request failed", "response protection") retry as plain text, then fall back to a local summary, and 3 straight failures pause compaction for that conversation for 5 minutes (401/403 not counted). Opening the switch, default model or selected models changing marks Codex's `models_cache.json` stale by editing only `fetched_at` (ChatGPT wiring, Codex on; a guarded-write conflict is logged). Unit tests `gateway/chatgpt-backend.test.ts`; e2e `daemon-e2e/api-endpoint-chatgpt-backend.e2e.test.ts`.
- `resolveGatewayRoute({ state, agent, model }): { ok: true, candidates: GatewayCandidate[] } | { ok: false, message }` in `gateway/routing.ts` is pure; test it directly. `~` in the requested name is read as `/` first. `candidates[0]` is the user's choice: `slug/model` names that endpoint when the part before the first `/` is an enabled endpoint's slug (otherwise the prefix is a vendor prefix and is normalized away); else an endpoint listing the exact id (whole name, then bare name) — exact wins over an endpoint earlier in the order that only matches after normalization (gateway-robustness ticket 02, user decision); else the first endpoint whose listed id has the same `sameModel` key; else Claude tier mapping. The rest are the other enabled endpoints listing the same model (same `sameModel` key), in Endpoint order (array order). Each candidate carries its own `upstreamModel` — the id that endpoint lists — so one request can go out as `claude-opus-4.6` to one endpoint and `anthropic/claude-opus-4-6-20260115` to the next.
- Upstream name and format pin (endpoint-management-ux ticket 15, magpie `modelprefs.go:902-911` `UpstreamNameIn`, settings `modelAPIs`):
  - `modelSettings.models[id].upstreamName`, falling back to the endpoint default's `upstreamName`, is the name actually sent to that endpoint. `*` is replaced with the model id using `replaceAll`, never a regex. A name without `*` is used for every model. A blank name falls through.
  - It is computed per request from the candidate's endpoint and model id. Do not thread a `sentModel` parameter through signatures.
  - Routing, `sameModel` failover matching, the picker and the default model keep the original id.
  - Test connection and detect send the upstream name too (magpie `test.go` / `detect.go`). When editing, the client always sends `endpointId`, so the daemon can resolve the name; a typed key still wins over the stored key.
  - On passthrough, `ReplyModelName` (sharing the line buffer with `WholeArgsTidy` through `JsonEventTidy`) rewrites only a reply `model` field that equals the upstream name back to the original. Every other byte stays as it was, each event is parsed once, and a different model name is left alone.
  - Model-family checks (is it Claude, billing line, reasoning replay, Grok) match on either the original or the upstream name. The advisor tool's model is the upstream name, except an unprefixed Claude id, which is used as is. That last case is a known gap against magpie `advisor.go:95-105`, which resolves an unprefixed id to its provider first.
  - `modelSettings.models[id].format` pins the model to that format's address on this endpoint, even when every pinned attempt is refused (magpie `gateway.go:3497`). Saving a new pin for a format with no address is rejected (magpie `setModelAPI`). If the address is removed later, the pin is void: it is not enforced, and it stays visible with `tone="warning"` and a "not in effect" mark in the dialog and the row menu, where picking it again clears it.
- `sameModel(id): string` (`gateway/routing.ts`, magpie `group.go` sameModel, MIT header kept): lowercase; drop the vendor prefix (text up to the last `/`); in version numbers turn `.`, `_` and Fireworks' `p` between digits into `-`; drop a trailing snapshot date (`-YYYYMMDD` starting `20`, or `-YYMMDD` with YY 23–39 and a real month/day; `@` also counts as the separator). Two ids are the same model when their keys are equal. Never compare raw ids across endpoints for failover — compare keys, send each endpoint its own listed id.
- Codex side calls (`gateway/codex-side-calls.ts`, `CodexLastTurn`, magpie `codex_memory.go` #742): a Codex request is a side call when `x-openai-subagent` (or `x-codex-turn-metadata.thread_source`) is `memory_consolidation` / `memgen` / `memory` / `guardian`, `x-openai-memgen-request` is set, or the model is `codex-auto-review`. Nothing else counts as a review call (magpie `isReviewCall` checks only `guardian` and `codex-auto-review`). When a side call's model has no route, `routeModel` in `gateway.ts` re-resolves with the model of the last Codex own turn (thread_source empty, `user` or `subagent`); if that also fails, or there is no last turn, the original 404 stands. The last turn is recorded when routing succeeds, not when the answer succeeds (magpie `gateway.go:1680`). There is one `CodexLastTurn` per gateway, so every Codex session on the machine shares it (user decision, same granularity as magpie's who+KeyID): two concurrent Codex sessions on different models can send A's memory consolidation to B's last model. Accepted; do not key it per conversation — side calls run on Codex's own thread, so a per-conversation key never finds a previous turn.
- `chooseRequestFormat({ agentFormat, model, formats }): ApiEndpointRequestFormat | null` in `gateway/routing.ts` (pure): a Claude model (name after the last `/` starts with `claude`) goes to `anthropic_messages` whenever the endpoint has it, even over the agent's own format (decision U5: keeps cache marks and thinking); else the agent's own format (passthrough); else the first of `openai_chat` → `openai_responses` → `anthropic_messages`. All three formats translate to each other (ticket 07), so the gateway passes every address the endpoint has.
- Translation (tickets 05–07): `gateway/translation/` holds the intermediate format and one file per protocol. `ir.ts` (`GatewayRequest`, `Part`, `Tool` with `strict`, `NamedTool`, `StreamEvent`, `Usage`, `Reply`, `ReplyCollector`, `RequestShapeError`, `estimateInputTokens`, `openAIEffort`, `thinkingBackOn`), `anthropic.ts`, `chat.ts` and `responses.ts` (each `parse*Request`, `build*Request`, `*Decoder`, `*Encoder`, `render*`; `responses.ts` also the three tool-exchange repairs, `replayedReasoningInput`, `usageFromResponses` / `usageToResponses`), `sse.ts` (`SseReader`, `sseEvent`), `protocols.ts` (`protocolOf(format)`: a complete `Record<ApiEndpointRequestFormat, Protocol>`). `Protocol.encoder({ model, write, request })` and `Protocol.render(reply, { model, request })` get the agent's parsed request: the Responses side needs `request.named` to write Codex's namespaced and custom tool calls back; Anthropic and Chat ignore it. These types never go into `packages/protocol`. `StreamDecoder` is `decode(data, emit)`, `whole(body, emit)` (a reply that came whole, read as the events it would have streamed) and `end?(emit)`; `callsTool(type)` in `ir.ts` is magpie's `streamPart.said` rule for tool blocks and items.
- `gateway/upstream-call.ts` (`openUpstream`, `upstreamUrl`, `readLimited`, `isEventStream`, `failedBySelf`, `FailedAttempt`, `FailureCause`, `OpenedUpstream`, `AttemptOutcome`, `EMPTY_REPLY`, `ANSWERED_BY_HEADER`) is shared by `passthrough.ts` (`attemptEndpoint`) and `translated.ts` (`attemptTranslated`); both return `AttemptOutcome`, so failover treats them the same.
- `ReplyTap` in `gateway/reply-tap.ts` (gateway-robustness ticket 01; moved out of `passthrough.ts` in ticket 13 so `upstream-call.ts` can use it without an import cycle): `new ReplyTap({ format, stream })`, `feed(chunk: Buffer)`, `soFar(): TappedReply` (what a stream has read so far; a whole reply reads nothing before `end`), `end(): TappedReply` (a second call only returns what was read). `TappedReply = { content: ReplyContent[], stop: StopReason | null, ended: boolean, error: { message, code, raw } | null, usage: Usage }`; `content` lists `"text" | "thinking" | "tool_call"` in first-seen order; `error.raw` is the `data:` text of the event that carried the error (the whole body for a whole reply), which failure classification reads.
- Opening (ticket 13): `openUpstream({ …, reads: ApiEndpointRequestFormat | null })` returns `OpenedUpstream = { kind: "opened", response, status, held: Buffer, ended: boolean, tap: ReplyTap | null } | FailedAttempt | { kind: "gone" }`. `reads` is the upstream's format (passthrough: the agent's; translated: `to`); `null` only for `count_tokens`, whose reply is not a conversation and opens at its first byte. The caller writes `held` first, then reads `response` on unless `ended`; passthrough keeps feeding the returned `tap`. `FailedAttempt.cause: "error" | "timeout" | "empty"` replaces the old `timedOut` flag.
- `EndpointCooldowns` (`gateway/cooldown.ts`) is created once in `bootstrap.ts` and passed to both the gateway and `ApiEndpointService` (`ApiEndpointServiceOptions.cooldowns`): `markFailed(report): EndpointRest | null`, `restOf(endpointId, model)`, `endpointRest(endpointId)` (list), `served(endpointId, model)`, `clear(endpointId)`, `clearNeedsCheck(endpointId)`. Memory only; a restarted daemon has none.
- Pure helpers with their own unit tests: `gateway/failure.ts` (`FAILURE_WORDS` — magpie's 20 regexes, `failure`, `endpointFailure`, `retryable`, `modelRetired`, `modelRefused`, `requestRefused`, `lateRests`), `gateway/cooldown.ts` (`COOLDOWN` — 13 constants, `retryAfter`, `resetsAt`, `passing`, `quotaHeld`), `gateway/affinity.ts` (`AFFINITY`, `affinityWhy` — the 12-step table, `turnOf`, `conversationId`, `ConversationSticks`), `gateway/refusals.ts` (`REFUSAL_WORDS`, `refusedShape`, `noteRefusal`, `RefusedShapes`). Their headers carry the MIT short notice pointing at root `THIRD_PARTY_NOTICES`.

### 3. Contracts

- Token file `$PASEO_HOME/api-endpoints/gateway-tokens.json` `{ tokens: { [provider]: token } }` (0600, `ApiEndpointStore.readGatewayTokens` / `writeGatewayTokens`). `ApiEndpointService.commit` syncs it after `writeState`: an agent that is on and has no token gets `randomBytes(32).toString("base64url")` (`nextGatewayTokens`); a token is never revoked — switch off keeps it, switch on again reuses it (cli-wiring-web-search ticket 02, ADR 0010), so sessions still running and Codex conversations recorded under Osuna's table keep reaching the gateway.
- The gateway reads `endpoints.json`, `keys.json` and the token file on every request, so endpoint edits take effect without a hook.
- Request body (gateway-robustness ticket 11, `gateway/request-body.ts`, magpie): `Content-Encoding` `zstd`, `gzip` / `x-gzip` are decoded with Node's built-in zlib (zstd needs Node ≥ 22.15 — CI, Docker `node:22` and Electron 44 have it; an older Node answers zstd with 415); any other encoding → 415; corrupt compressed data → 400 plus one `warn` with the encoding. The 64 MB cap (`MAX_REQUEST_BODY_BYTES`; tests shrink it with `gatewayBodyLimitBytes`) counts decoded bytes while decoding → 413 saying it is the gateway's own limit, no endpoint was asked, and to `/compact` or start a new conversation. Passthrough sends the decoded body and drops `Content-Encoding`.
- Codex `web_search` (cli-wiring-web-search ticket 05, `withoutResponsesWebSearch` in `gateway/web-search.ts`, magpie MIT): each Responses passthrough attempt — first try, failover, refusal retry — checks its own endpoint. An endpoint with `searchesWeb` and a Responses address gets the body as is. Any other endpoint gets, only when the request asks for search (a `web_search` tool that `tool_choice: allowed_tools` does not exclude, magpie `searchAsked`), the body without that tool, without a `tool_choice` naming it (an `allowed_tools` entry is removed alone; none left → `tool_choice` goes), and without `web_search_call` history items; no tools left → `tools` and `tool_choice` both go. A request that does not ask for search passes untouched, history included. Translated attempts (ticket 06, `formatsToSearchOn` / `withWebSearchFor({ request, searches })`): when the request asks for search, only the endpoint's searching formats are tried (magpie "先挑会搜的协议": Chat + Anthropic with the switch on → Anthropic); `web_search` becomes `web_search_20250305` and the reply's search blocks come back to Codex as `web_search_call`. A target format that doesn't search loses the tool and a `tool_choice` naming it (e.g. Anthropic says no such model → Chat without search). No "rejected → strip and retry" path: a non-searching endpoint never receives the tool. Unit tests: `gateway/web-search.test.ts`.
- User-Agent: passthrough and translated attempts (count_tokens too) send the CLI's own `User-Agent`; without one, `Osuna/<daemonVersion>`.
- Reused connection dropped before the reply starts (`upstream.reusedSocket` and ECONNRESET / EPIPE, magpie `replayable`): `sendUpstream` resends at once on a fresh connection, up to `MAX_REPLAYS = 8` (magpie `MaxIdleConnsPerHost`), within the same header timeout; not a failure, no cooldown. A drop on a new connection, or after the agent left, is a normal failure.
- Passthrough: the request body is read whole (64 MB cap, decoded) to find `model`; only the top-level `model` value is replaced with `jsonc-parser` `modify` + `applyEdits`, so every other byte, `cache_control` included, reaches the upstream unchanged — except the Anthropic fixes below. Client `authorization`, `x-api-key`, hop-by-hop, `host`, `content-length`, `accept-encoding` and `x-forwarded-*` are dropped; `accept-encoding: identity` and the real key are added through `signedHeaders` (key headers from `keyHeadersAt`, see "Request headers, extra body and key header" below). The query string is forwarded (`?beta=true`).
- Anthropic passthrough to another vendor's model (ticket 06): `fitAnthropicBody(text, upstreamModel): string` in `passthrough.ts`, applied by `upstreamBody` to `/v1/messages` only (never `count_tokens`), edits with `jsonc-parser` so the rest stays byte for byte. Nothing changes when `isAnthropicModel(upstreamModel)` (`/(?:^|[/.:-])claude-/i`). Otherwise: `thinking` absent → append `{"type":"disabled"}` (vendors think by default; Claude Code's title requests carry none); `thinking.type === "adaptive"` → remove `thinking` (the model's own default decides — user's decision, not "disabled"); `output_config.effort` → removed (the whole `output_config` when nothing else is in it, `format` kept); `enabled` / `disabled` go as sent. Model name containing `deepseek` (case-insensitive, name only, never the host) → `thinkingOnToolTurns(messages)` from `translation/anthropic.ts`: an assistant message with a `tool_use`, or right after a user message made only of `tool_result`s, that has no thinking block gets `{"type":"thinking","thinking":" "}` first; `redacted_thinking` becomes that block (dropped when the message already has thinking). This is the one vendor-name rewrite passthrough does (R-C5's exception).
- Reasoning off, as each model takes it (ticket 16, magpie `thinkingOffOf` / `thinkingOffAsTaken` / `withoutThinkingOff` / `thinkingBackOn`, user's decision 2026-10-15).
  - `thinkingOffAsTaken(body, model): body` in `translation/anthropic.ts` (pure; returns the same object when nothing changes) runs on every built Anthropic body and, through `fitThinkingOff({ text, model, leftOn })` in `passthrough.ts`, on every `/v1/messages` passthrough after `fitAnthropicBody` (jsonc edits of `thinking`, `output_config`, `max_tokens` only). It acts only on `thinking.type` `disabled` / `between_tools`, keyed by `CLAUDE_LINE` (family + version, any relay spelling): Sonnet 5.5 → `{type:"between_tools"}` alone, effort `xhigh`/`max` → `high`; Opus 5.5, Fable 5.x, Mythos 5.x → no `thinking`, effort `low` when none was set, `max_tokens` < 2048 gets +2048 (magpie `classifierRoom`: it still thinks adaptively); Opus 5, Haiku 5.5 → `disabled`, effort above high → `high`; 4.x and earlier, Sonnet 5, Haiku 5 → `disabled` (a `between_tools` they don't take becomes `disabled`); other vendors and unknown or later lines → as sent.
  - Refusal retry (`gateway/refusals.ts`): `refusedShape({ format, body, status, text }): "none" | "thinkingOff" | null` reads a 400 against the body actually sent. `none`: OpenAI body effort `none` and the text matches both `effortLevelsNamed` (`\blow\b\W+(?:medium|high)\b`) and `noneQuoted`. `thinkingOff`: Anthropic body turns thinking off and the text matches `alwaysThinks` (decoded through `wordsOf`), `mandatoryReasoning`, `thinkingOffRefused`, or the `none` rule. `noteRefusal` records it in `RefusedShapes` (`Failover.refusals`, key endpoint id + upstream model + shape, memory only) and the attempt asks the same endpoint once more before returning — so this runs before the R-B8 switch decision and before the last-endpoint in-place retry; a second refusal is handled by the normal rules. A shape already recorded is still retried (concurrent first requests both went out the old way), but only the first record of a shape logs. Each new record logs `info` `refusalNote(shape)` `{ endpoint: name, model, refused }`: reasoning shapes `"API endpoint refused reasoning off; asking it again with reasoning on"`, `format:*` `"API endpoint does not serve this model in this format; asking its next format"`, key-header shapes `"API endpoint takes its key in one header only; sending it that way"`.
  - `RefusedShape`: `"none"`, `"thinkingOff"`, `format:<ApiEndpointRequestFormat>`, `"bothKeyHeaders"`, `"xApiKeyAlone"` (gateway-robustness ticket 03, prd 18 / 19.1 / 19.2). Every shape uses the same `RefusedShapes` memory (endpoint id + upstream model + shape, cleared on daemon restart) and the same "ask the same endpoint once more before opening and before the switch decision" rule. Keyed per model even for key headers, where magpie keys per endpoint and persists it — a second model on the same endpoint pays one extra 401 to learn it.
  - Wrong format (`refusesFormat({ status, text })`: 4xx and `FAILURE_WORDS.wrongFormat`, magpie `wrongEndpoint` phrases, e.g. `no model endpoints available given user constraints`): `askEndpoint` records `format:<format>`, then `nextFormat` picks the endpoint's next unrecorded format by `chooseRequestFormat` order, translating from the agent's body when the format differs (null when translation fails → the failure stands). When every format of that endpoint+model is recorded, the attempt returns the failure — `wrongFormat` also counts in `retryable` and `modelRefused`, so only that model on that endpoint cools and the gateway switches — and `RefusedShapes.forget` drops those `format:*` records so the endpoint is asked from its first format again after cooldown. Without the forget, a format the upstream later adds is never asked until restart. `model_not_supported`-style text is `unserved`, not `wrongFormat`: it cools at once with no format walk (magpie). `askableFormat` skips recorded formats when choosing the first attempt.
  - Refused fields (gateway-robustness ticket 04, prd 19.3–19.5 / 19.8 / 19.9, magpie `refuseShapes` / `withoutRefusedShapes`; recognition in `gateway/refused-fields.ts`, memory and re-asking in `refusals.ts`). `DroppedField` shapes join `RefusedShape`: `safeguards`, `display`, `displayValue`, `sampling` (temperature / top_p / top_k called deprecated), `deferredTools` (`tool_addition` / `tool_removal` / `tool_reference` blocks in messages), `toolResultRefs`, `toolStrict`, `imageTool`. `refusedFields({ format, body, status, text })` counts a field only when the upstream's text names it **and** the body actually sent carries it; `refusesContent(status)` is 400 or 422 (magpie `badRequest`). `withoutRefusedFields` drops every recorded field (returns the same object when nothing changes); passthrough rewrites only the changed top-level keys and keeps the rest byte for byte. Each new record logs `info` `"API endpoint refused a field of the request; asking it again without it"`.
    - `askRefitted({ refusals, format, sent, outcome, refit, ask })` loops: record what the failure names, rebuild the body from all records, ask again; stops when nothing new is recognised or the body stops changing. Each field drops at most once, so the loop is bounded. A refusal it cannot recognise falls to the normal rules (switch, or hand to the CLI). User decision 2026-10-17: keep magpie's loop, not a single re-ask.
    - Safeguards refused → only `safeguards` is dropped; the dangerous-tool-use beta header stays (magpie; dropping the beta for non-Claude models is prd 20, a separate ticket). User decision 2026-10-17. `safeguard_results` lives in replies, so there is nothing to drop from a request.
    - Deferred tools: drop the blocks and messages left empty, merge tool definitions given only in messages into `tools` (`tools` wins on a name clash). A tool result holding only `tool_reference` keeps its references and gets a leading text block naming the loaded tools, so call/result pairing stays valid. Cases `safeguards` and deferred tools exist only on passthrough (they don't survive translation); `display` also applies on the translated Codex → Anthropic path.
    - Codex `image_gen` tool: `askWithoutImageTool` re-asks without it after a bare 400/422 (no recognised refusal, not `wrongFormat`) on any non-OpenAI host (`takesImageTool(baseUrl)` — OpenAI's own host keeps it), and records `imageTool` only when the retry opened. A failed retry hands back that failure; unlike magpie's translated path it does not put the tool back and try further guesses.
  - Downgrades (gateway-robustness ticket 05, prd 19.6 / 19.7, magpie `format.go` / `prefill.go`; recognition and rewriting in `gateway/refused-downgrades.ts`, memory and re-asking through the same `noteRefusal` / `askRefitted` loop). `DowngradedShape = "jsonSchema" | "structuredOutput" | "prefill"` joins `RefusedShape`; recorded at refusal time like every other shape. Logs: `"API endpoint refused a JSON schema; asking it again for a JSON object with the schema in the system prompt"`, `"API endpoint refused structured output; asking it again with the format told in the system prompt"`, `"API endpoint refused a conversation ending with the assistant's message; it takes no prefill for this model"`.
    - Structured output (Responses `text.format`, Chat `response_format`, Anthropic `output_config.format`): `jsonSchema` → ask for `json_object` and write the schema into the system prompt; `structuredOutput` → drop the field and tell the format in the system prompt only. Anthropic's field only carries a schema, so it goes straight to the text step. Passthrough: `withDowngrades`; translated: `downgradedRequest`.
    - Prefill (conversation ends with the assistant's own text, not its tool call): recorded for every client, but only Chat / Responses clients (Codex) get an appended user turn `"Continue."` and the re-ask; Claude Code's prefill is its own ask, so the refusal goes back to it unchanged (user decision 2026-10-17, magpie `LastIsTurn`). `refusesPrefill(refusals: ShapeRefusals): boolean` in `refusals.ts` is the pure query ticket 21 reads. Gotchas for ticket 21: the record is per endpoint + model, not per format (magpie keys by protocol too), so a Chat-address prefill refusal also blocks continuation on that endpoint's Anthropic address; and `downgradedRequest` has no magpie `!req.Resume` guard, so a continuation request must not get the user turn appended.
  - Both key headers refused (`refusesBothKeyHeaders`: 401, text names both `x-api-key` and `authorization`, plus one of magpie `BothAuthRefused`'s "not together" phrases): `askWithOneKeyHeader` re-asks with `x-api-key` only, then `Authorization: Bearer` only (magpie `OneAuthOrder`), and records the first one not refused again with 401/403 (`bothKeyHeaders` → send `xApiKey`; `xApiKeyAlone` → send `bearer`). `keyHeadersFor({ format, refusals })`: OpenAI formats always Bearer only; Anthropic sends both unless a record says otherwise. Runs in passthrough and translated attempts; `count_tokens` does not use it (falls back to the local estimate on failure). The endpoint is not marked "needs checking" when the one-header retry succeeds.
  - What a recorded refusal changes: passthrough Responses `reasoning.effort` `none` → `low` (`noneAsLow`); passthrough Anthropic → `thinkingLeftOn` (drop the thinking-off, model decides; a Claude also gets effort `low` when none was set, plus the +2048 room); translated → `thinkingBackOn(request)` (`thinkOff: false`, effort `low` when empty), applied by `allowedReasoning` only when the built body would carry the refused shape. R-C3's `disabled` added for non-Claude models falls under the same fallback.
- Passthrough generic patches (gateway-robustness ticket 06, prd 3 / 20, magpie). Decided by the target model only, never by vendor. `upstreamBody` in `passthrough.ts`:
  - Every Anthropic request, count_tokens included (magpie runs these before its `countsTokens` branch), goes through `fitClaudeCodeBody`: to a non-Claude model (`!isAnthropicModel`) drop the billing line (`withoutBillingLine`: system blocks starting `x-anthropic-billing-header`) and `safeguards`, and `withoutReviewBeta` strips `dangerous-tool-use-*` from `anthropic-beta`; to a Claude model the body is byte for byte the client's except the model name. `withAdvisorFitted`: the advisor server tool gets this endpoint's listed Claude id (`[1m]` dropped) when the endpoint has a Claude, else the tool, its description and its `tool_addition` go. `adaptiveThinkingAsTaken` (4.6+ Claude): `enabled` + budget → `adaptive` with an effort derived from the budget; only that derived `xhigh` becomes `max` — a client-written `output_config.effort: "xhigh"` is left alone (magpie `adaptiveThinking`). `refusesSampling(model)` Claude drops temperature / top_p / top_k (`withoutSampling`) — on the translated Anthropic build too (magpie `samplingAsTaken` covers every path).
  - Conversation-only: `fitThinkingOff`, refused fields, and for Responses upstreams `withoutBareReasoning` — drop reasoning items with no `encrypted_content` unless the request has `store: true` (magpie's rule, so any vendor's unsealed reasoning goes, not only the gateway's own `rs_` items; DeepSeek still gets its reasoning text). `joinToolRuns` moves model text said between calls of one run before the first call (`moveSaidBeforeCalls`).
  - On the translation path only (as in magpie): `buildResponsesRequest` runs `pairedToolInput` (orphaned calls get an interrupted result) and `withoutSecondAnswers` (a second answer to the same call is dropped); it does not run `joinToolRuns`.
  - "Models known to refuse temperature / top_p don't get them" needs per-model data and is translation-only in magpie — done in ticket 07 (user decision 2026-10-17). The other three deviations from the ticket text above (derived-only xhigh, magpie's reasoning rule, translation-only pairing) are user-accepted.
- Translation generic patches (gateway-robustness ticket 07, prd 21, magpie).
  - Model facts: `ModelFactsLookup = (endpoint, modelId) => ModelFacts` (`gateway.ts`), wired in `bootstrap.ts` to `ApiEndpointService.modelFacts(endpoint, modelId)`; `ModelFacts = { context?, output?, efforts?: string[], takesSampling?: boolean }` (`api-endpoints/model-facts.ts`). The endpoint's own model list wins over models.dev (`mergeModelFacts`). `efforts: []` means models.dev lists the model with no levels (magpie `Levelless`); `undefined` means unknown. `takesSampling` comes only from the models.dev provider whose api host equals this endpoint's host (`samplingFor`, magpie `RejectsTemperature` reads the bound provider's own entry); providers without an api URL in models.dev (e.g. OpenAI) and every relay host stay unknown and keep sampling. Ticket 15 reuses this lookup — never add a second one.
  - Effort: `nearestEffort(want, levels)` picks over the whole ladder none…ultra (`Effort` includes `minimal` and `ultra`), nearest wins, a tie goes up; a model whose levels are known-empty drops to high on OpenAI formats; an unknown model keeps the asked level (magpie `fitFor`).
  - Reply cap: a Messages request with no `max_tokens` gets `publishedOutput(facts)` (published output, capped by the window), else 16384.
  - Codex fields (`prompt_cache_key`, `include`, `client_metadata`, `text.verbosity`): all four to Responses upstreams, only `prompt_cache_key` to Chat, none to Anthropic (magpie; user-accepted, the ticket's acceptance said Anthropic too). A refusal naming `prompt_cache_key` (refused field `cacheKey`) — or an unnamed 400 — drops it and re-asks once; recorded when that re-ask opens (magpie `gateway.go` ~4846 / 4993).
  - Tool schema whose root is `anyOf` / `oneOf` / `allOf`: wrapped into an object always for Messages and up front for `api.x.ai` (`foldsRootsUpFront`); Chat / Responses only after the upstream refuses, then remembered. These refused-field re-asks apply to passthrough too.
  - Chat upstream `extra_content.google.thought` (Vertex) and `<thought>` spans read as reasoning; Codex-bound assistant messages carry `phase`. `reasoning_details` is read only from Chat-client history (magpie `chattidy.go`) — Pi / OMP are the Chat clients (pi-omp-endpoints ticket 01).
  - Not done: `configuration_update` for Codex effort changes (user decision 2026-10-17). In magpie it is off by default (`MAGPIE_EFFORT_UPDATES`), only for gpt-6 on OpenAI / ChatGPT, and patches passthrough Responses bodies; open a new ticket if it's ever needed.
  - Handed over from ticket 06: models with `takesSampling: false` don't get temperature / top_p on Chat and Responses builds.
- Model-output fixes (gateway-robustness ticket 08, prd 23 / 24, magpie). Translated replies, plus Chat passthrough. Anthropic and Responses passthrough replies are never rewritten (magpie strips fences only in `encoder()` / `render()`). Chat passthrough (pi-omp-endpoints ticket 01) carries every tidier magpie hangs on that path (`gateway.go:4364-4378`): `ChatStreamTidy` / `ChatWholeTidy` (`chat-reply-tidy.ts`, magpie `chattidy.go`), `TextCallStreamTidy` when the request has tools, `GeminiSignatureTidy` (`gemini-signatures.ts`, magpie `gemini_signature.go` / `gemini_sigstore.go`), and on the request side `mistralThinking` with no `withReasoningOnToolTurns` for Mistral. Opening a new passthrough path means porting every tidier magpie attaches to it; the first cut of ticket 01 wired only the Grok and model-name fixes and review sent it back as doing less than magpie. Both run as a `ReplyFilter` (`translation/ir.ts`) in `translated.ts`, streaming and whole.
  - `translation/fence.ts`: when the request asks for JSON (`json_schema` or `json_object`; the original `input.request.format`, so a downgraded format still counts), strip a ``` fence (no tag or `json`) wrapping the whole answer whose body is one complete JSON value. Streaming holds text until it can decide; usage events may pass the held text, as in magpie `fenceEncoder`. Anything else keeps its fences.
  - `translation/text-calls.ts`: when the request offered tools, Hermes `<tool_call>`, DeepSeek DSML and GLM `arg_key` text calls become real tool calls and the reply ends as a tool-use stop. Applies to every translated upstream, not only Chat (magpie `textCallNames(request.Tools)` ignores the protocol; the ticket said "Chat 上游"). A call naming a tool not offered, or with unreadable arguments, is handed through as text; a lone leftover tag with no call is removed (magpie #823). Arguments keep the model's key order (magpie sorts; tests compare parsed objects).
- Vendor rewrites (gateway-robustness ticket 16, prd 25, magpie), all in `gateway/vendor-rewrites.ts` (`withVendorRewrites`, plus MiniMax's `withThinkingInline` on translated Chat); passthrough rewrites only changed top-level keys, translated bodies go through `translatedBody({ …, baseUrl })`; count_tokens is rewritten too (magpie `forwardOnce`). Only these four; no preset — official hosts only (`hostOf`), so the same model through a relay is sent unchanged.
  - Kimi / Moonshot official host: message `reasoning_details` → `reasoning_content` (never fires today: Osuna's translated Chat requests don't carry `reasoning_details`); a tool schema with `enum` / `const` and no `type` gets one from its values (`[1.0]` → `integer`, JS can't tell 1.0 from 1; magpie says `number`). Passthrough re-serialises the whole `tools` key, so `1.0` becomes `1` — values unchanged, stable across turns.
  - MiniMax official host: Chat history thinking written back as `<think>…</think>`; its Anthropic address keeps thinking blocks.
  - DeepSeek official host: `\0` in tool schemas → `\u0000`.
  - Kimi and DeepSeek official hosts: deferred tool blocks are dropped up front (ticket 04's `withoutDeferredTools`). magpie does this only for Kimi and OpenCode's DeepSeek route; the ticket names DeepSeek, so it's here.
  - Grok (model name, any host; `api.x.ai` also counts for request rewrites, magpie `grokToolPatterns`): tool-schema regex patterns rewritten to what Grok accepts; replies (model name only, magpie `grokServed`) get whole-number tool arguments back (`2500.0` → `2500`, `gateway/grok-integral.ts`), streamed and whole, translated and passthrough. A rewritten passthrough reply drops the upstream `content-length` (chunked instead).
- Upstream reply shapes (gateway-robustness ticket 18, prd 22 / 26, magpie):
  - Whole-stream-in-one-chunk hang (fixed in ticket 18, handed over from 16): after `awaitOpening` settles, `end` may already be queued with its listener gone. `OpenedUpstream` no longer carries `ended`; `readStream`, `relay` and `readLimited` check `response.readableEnded || response.destroyed` before attaching listeners. Keep that check if you add any await between opening and reading.
  - Whole JSON when a stream was asked: the translated path reads it by protocol and renders whatever the CLI asked for. Passthrough hands it through as is before a keepalive, and rewrites it into a stream (`whole-stream.ts`, `wholeAsStream`) only after the keepalive already sent stream headers (magpie `fallback.go:2226-2246`; user decision 2026-10-17).
  - A 2xx that isn't the protocol's reply (`not-api-reply.ts`: HTML login / Cloudflare challenge, empty, not starting with JSON, judged at the first non-whitespace byte, up to 1 MB) → 502, switch and cool, the page `<title>` in the reason, log and final error; firewall pages also get magpie's `BLOCKED_HINT`. Passthrough and translated alike.
  - In-stream errors: Responses `invalid_request_error` reads as 400 and keeps the vendor's `type`, `code`, `param` (`vendorErrorOf` in `translation/ir.ts`); Chat and Anthropic stream errors keep only the refusal code and go out as generic types (magpie `responses.go:1416-1471`, `anthropic.go:1233`, `chat.go:989`; user decision 2026-10-17). An error named only by its `event:` line is recognised when the data has no top-level `type`.
  - Zhipu 200 envelope (`zhipu-envelope.ts`, official host, plain uncompressed JSON under `MAX_ENVELOPE_BYTES`, `{"code":…,"success":false}`): its code maps to 401 (needs check) or 429 (cools), then the normal switch. The e2e points `dns.lookup` at localhost to reach it.
  - Failure `warn` logs now carry `detail` (upstream text, key redacted). `redactKey(text, apiKey)` in `upstream-http.ts` is the one redactor — an empty key returns the text unchanged (`replaceAll("")` would insert `***` between every character).
- Upstream URL (`upstreamUrl`): `anthropic_messages` base + `/v1/messages`; OpenAI bases already end in `/v1`: `openai_chat` + `/chat/completions`, `openai_responses` + `/responses`.
- Responses passthrough runs `joinToolRuns` → `orphanedToolOutputs` → `pairToolItems` on the raw body first (magpie's order); a body with nothing to mend is sent byte for byte. A translation reads the mended body too.
- Responses passthrough to a model whose name contains `deepseek` (ticket 07): `fitResponsesBody(text, upstreamModel)` in `passthrough.ts` (applied by `upstreamBody`) uses `replayedReasoningInput(input): { input, reordered } | null`. A `reasoning` item with no non-empty `reasoning_text` gets `content: [{type:"reasoning_text", text: <summary text or " ">}]` (sealed `encrypted_content` kept); then every model step (run of reasoning / assistant message / `*_call`) that makes a call or follows a `*_output` must lead with a reasoning item — its own first one moved ahead, else a `" "` one (`reasonFirst`, magpie #1592/#1822). Only filled → jsonc edits `["input", i, "content"]` alone; reordered → the whole `input` value is replaced; nothing to do → byte for byte.
- Translated attempt: the agent's body is parsed once into `GatewayRequest` (only when some reachable candidate needs translation). A `RequestShapeError` drops only the candidates that need translation; passthrough candidates are still asked, and the 400 is answered only when no candidate is left (`askableCandidates` / `readTranslated` in `gateway.ts`; magpie instead answers 400 when it reaches such a candidate — implementer's choice, recorded in ticket 07). The body is then built for the target format with `stream: true` always, sent with `content-type: application/json`, `accept: text/event-stream`, `accept-encoding: identity`, `Authorization: Bearer <key>` (Anthropic targets also `x-api-key` and `anthropic-version: 2023-06-01`); the agent's other headers are not forwarded. The upstream SSE is decoded event by event; a streaming agent gets each event re-encoded at once (`content-type: text/event-stream; charset=utf-8`), a non-streaming agent gets one `render*` JSON after the stream ends. The `model` in every translated reply is the name the agent asked for (`relay-c/deepseek-v3`, `opus`), never the upstream's. Chat requests: system blocks joined into one `system` message, tool results before the turn's own text, `pairToolMessages` mends the exchange, `stream_options.include_usage`, `reasoning_effort` with `xhigh`/`max` lowered to `high`; a client's own effort `none` goes as `none` (`openAIEffort`: `thinkOff && effort !== ""` — `effortOf` reads `none` as `low`, Anthropic `disabled` carries no effort, so Claude Code's thinking off still goes to Chat/Responses with no effort). Anthropic requests: `pairToolBlocks`, then thinking and cache marks (below). Foreign call ids reach Claude Code as `mp_` + base64url and come back decoded.
- Translation details (ticket 06, magpie's `anthropicBody` / `buildChat` / `chatDecoder`):
  - Anthropic build: `cache_control: {type:"ephemeral"}` on the last message's last non-thinking block, on `system` (sent as one text block), and on the last tool only when there is no system prompt. Thinking: `thinkOff` → `{type:"disabled"}`, then the whole body goes through `thinkingOffAsTaken` (below); asked to think and the model is a Claude ≥ 4.6 (`CLAUDE_VERSION`) → `{type:"adaptive", display:"summarized"}` + `output_config.effort` (`xhigh` → `max` on 4.6); else, when `maxTokens` is 0 or > 2048, `{type:"enabled", budget_tokens: budgetOf(effort)}` (low 4096 / medium 10000 / high 24000 / xhigh,max 32000), capped at `maxTokens − 1024` when the client gave one, otherwise `max_tokens` raised to budget + 4096; `temperature` / `top_p` only when not thinking. A translated request that never mentioned thinking gets no `thinking` field, for any model (magpie adds `disabled` only on passthrough).
  - Images: `ImagePart { mediaType, data, url }` — base64, or a URL forwarded as is (never fetched). Chat `image_url` data URLs parse to base64. Tool-result images: inside `tool_result.content` beside the text for Anthropic; for Chat the tool message says `[The tool returned an image; it follows in the next message.]` and the images go in the next user message after `[From the result of <tool> (tool call <id>):]`.
  - Files: Anthropic `document` blocks (message or tool result) are dropped. Chat `file` parts → `FilePart` (MIME from the data URL, else the `FILE_TYPES` extension table in `chat.ts` — no MIME dependency, unknown → `application/octet-stream`; a `file_id` is kept in `url`) and are sent as the text `[attachment <mime>]` / `[attachment <mime>: <file id>]`.
  - Structured output: `GatewayRequest.format: Format | null`, `Format = {type:"json_object"} | SchemaFormat`. Read from Anthropic `output_config.format` (json_schema only, named `response`) and Chat `response_format` (`openAIFormat`; a schema-less json_schema is json_object, `text` is null). Chat gets `response_format`; Anthropic gets `output_config.format {type, schema}` beside any effort, and json_object as `Respond with a single JSON object and nothing else.` appended to the system prompt. A refusal is not retried.
  - DeepSeek replay (`replaysThinking(model)`, name contains `deepseek`): Chat assistant turns carry `reasoning_content` = their thinking text, or `" "` on a turn that calls tools or answers tool results; Anthropic sends unsigned thinking as `{type:"thinking", thinking}` and runs `thinkingOnToolTurns`. Every other model gets no unsigned thinking; signed thinking goes only to Anthropic.
    - Responses (ticket 07, magpie `responses.go`). Parse: `instructions` + `system`/`developer` messages before the first reply → `system`; a `developer`/`system` message after any reply stays in place as a user `<system-reminder>\n…\n</system-reminder>` (keeps the system prompt, and so Anthropic's cache prefix, stable); `agent_message` → user turn; adjacent same-role messages merged; `reasoning` → thinking text from `reasoning_text`, else the summary — `encrypted_content` is never read (Responses → Responses is always passthrough, so sealed reasoning only ever reaches Responses); `input_file` dropped; `input_image` with only a `file_id` → `RequestShapeError` when it is in the last input item, dropped in earlier ones. Tools: `function`; `custom` (Codex's freeform tools) offered as a function taking one `input` string (description gains the input rule and grammar) and its history call read as `{"input": …}`; `namespace` tools flattened to `<namespace>__<name>` (> 64 chars → first 55 + `_` + 8 hex of sha256); boolean `encrypted` marks stripped from schemas; `web_search` and other server tools dropped; `tool_search` and Responses Lite `additional_tools` are not handled (Osuna's Codex catalog enables neither). `GatewayRequest.named[flat] = { namespace, name, custom }`. `tool_choice`: strings, `{type:"function", name}`, `allowed_tools` (mode `auto`/`required` else `RequestShapeError`; filters tools and `named`). `text.format` → `format`; `reasoning` present → `thinking`, its effort via `effortOf`, `"none"` → `thinkOff`; `service_tier` is not carried. Build: `{model, input, stream, store:false}` + `instructions`, `max_output_tokens`, `temperature`/`top_p`, `text.format`, `reasoning: {effort (openAIEffort), summary:"auto"}` or `{summary:"auto"}` when only thinking, tools with `strict` always written, `tool_choice`, `parallel_tool_calls`. Thinking goes only to a DeepSeek model, as `reasoning` items with `reasonFirst`. Decode: call arguments are emitted when the call is done, preferring the fuller of streamed deltas and the done event's (`pickArgs`, magpie #613); `response.incomplete` → `length` / `filter`; a call streamed or listed → `tool`; `response.failed`, `error` events and any event carrying `error` → error. Encode for Codex: `response.created` + `response.in_progress`, items opened/closed with `output_item.added/done`, `sequence_number` from 0, model is the asked name, `response.completed` / `response.incomplete` with usage (`input_tokens` = prompt incl. cache, `cached_tokens`, `cache_write_tokens`), errors as `response.failed`. A namespaced call goes back with `name`, `namespace` and `encrypted_function_args: []`; a custom tool's call goes back as `custom_tool_call` (`ctc_` id) with `input` and no argument delta events.
  - Chat decoding: a leading `<think>…</think>` or `<thought>…</thought>` in `content` (after spaces/newlines) is emitted as `think` events, tags split across chunks included; text that only starts like a tag is held. `StreamDecoder.end?(emit)` hands back what is held; `translated.ts` calls it after `SseReader.end()` on both the streaming and whole-reply paths, and so does `ReplyTap.end()` — a decoder that holds text must implement it.
- A 2xx that is not an event stream (no `text/event-stream` content type and the first chunk does not start with `data:`, `event:` or `:`) is a pre-first-byte 502 failure: it switches and cools like a server error.
- `count_tokens`: routed like `/v1/messages`; the first candidate not cooling (else the first) is asked at its Anthropic address + `/v1/messages/count_tokens` (query kept) and its answer piped back; with no Anthropic address, or any failure there, the gateway answers `{ input_tokens: estimateInputTokens(request) }` (UTF-8 bytes of system, texts, call args and names, tool names, descriptions and schemas, ÷ 4, floored). Counting never switches or cools.
- Every response after an endpoint is chosen carries `x-osuna-api-endpoint: <slug>`. The slug, not the name: Node throws on non-Latin-1 header values and names can be Chinese.
- Failover (ticket 04). The plan for one request: drop candidates that need a check (`why: "auth"`), ready ones first, then only the cooling one that is back soonest (magpie restLast + probeOne), then `ConversationSticks.order` moves last time's answerer to the front when the conversation is within a turn, or its cache read ≥ 1024 tokens less than 5 minutes ago, and it is not cooling. Conversation key: `<agent>|<requested model>|<conversationId>`; `conversationId` reads `x-claude-code-session-id`, `thread-id`, `thread_id`, `session-id`, `session_id`, `x-client-request-id`, else hashes the first user message.
- The reply opens at its first content (ticket 13, prd items 8 and 12, magpie `holdWriter.scan`): `awaitOpening` in `upstream-call.ts` feeds every chunk to a `ReplyTap` and holds the bytes until it reads non-empty text, non-empty thinking or a tool call. Frames before that (`message_start`, `response.created`, `ping`, empty blocks) reach the agent only then, in order and unchanged. Thinking is content: it is not held. Before opening:
  - an error event (or a whole body that is an error) → `FailedAttempt` with `text = error.raw`, `status = streamStatus(raw)` (`failure.ts`, magpie `streamStatus`: too long 400, `overloaded` 529, credit words without "rate" 402, rate / quota words 429, unserved model 400, `invalid` / `context_length` / `too long` 400, else 502), the upstream's headers and `error.type` / `code`; the upstream response is destroyed. It then goes through the normal `retryable` / cooldown rules.
  - the body closes without `end` → 502 `<origin>: the connection closed before the reply began`.
  - the reply ends as an empty reply → `failedBySelf({ status: 502, detail: EMPTY_REPLY, cause: "empty" })`. Empty (magpie `repliesCounted` + `uncounted` + `answersNothing`, user's decision 2026-10-17) = the upstream format is `anthropic_messages` or `openai_responses`, `stop !== null` (the reply said, in its protocol, how it ended), no content, `usage.input + output + cacheRead + cacheWrite === 0`, stop not `length` or `filter`. A Chat reply is never empty (Chat need not count tokens); Claude's own empty `end_turn` after a tool result counts its prompt and stays an answer. magpie judges empty only on the translated path; Osuna judges both (prd item 12). A reply that said no stop — zero bytes, an HTML page, `{}` — is not judged here and is handed over as before; non-protocol 2xx bodies belong to ticket 18.
  - more than 1 MB held (`MAX_HELD_BYTES`, magpie `holdMost`) → opens anyway.
  - No time limit on holding. A CLI that hangs up while frames are held aborts the upstream request through `sendUpstream`'s `abandon`.
  After opening the gateway pipes and never switches; if the upstream breaks it ends the stream with an in-protocol error (below, ticket 20) and cools that endpoint (`lateRests`).
- Keepalive before opening (ticket 17, prd items 9–11, magpie `keepAlive` / `keepQuiet`): `handleAgentRequest` builds one `AgentKeepAlive` (`keepalive.ts`) per agent request, `since` = when the request came in, `streams` = the body's `stream === true` (count_tokens and non-streaming requests get none). After `gatewayKeepAliveMs` (default `KEEPALIVE_EVERY_MS`, 15 s) with no opening it writes 200 + `text/event-stream; charset=utf-8`, then one event every interval: Anthropic `event: ping` / `{"type":"ping"}`, OpenAI `event: response.in_progress` / `{"type":"response.in_progress","response":{"object":"response","status":"in_progress","output":[]}}` — never an SSE comment, which Codex does not count. `openUpstream`'s `onHeard` calls `heard()` when a request goes out and on every chunk before opening; while nothing was heard for `gatewayKeepAliveQuietMs` (default 5 min) no event goes out, and it resumes when a new request is sent. At opening `attemptEndpoint` / `attemptTranslated` call `stop()` first and skip `writeHead` when `res.headersSent`, so the reply follows the pings in the same response (without `x-osuna-api-endpoint`). `askInTurn` runs inside `try { … } finally { keepAlive.stop() }`. No 4-minute cap for Codex (magpie `agentQuietMost`): magpie needs it because its keepalive is a comment Codex ignores; a real `response.in_progress` resets Codex's 300 s idle timer.
- After the keepalive sent the headers, `sendAgentError` cannot set a status or headers: it ends the stream with one error event (magpie `streamFailure`) — Anthropic `event: error` `{"type":"error","error":{"type":"api_error","message"}}` (Claude Code then retries non-streaming), OpenAI `event: response.failed` `{"type":"response.failed","response":{"object":"response","status":"failed","error":{"code":"server_error","message"}}}` (Codex retries the turn up to 5 times and shows the reason). The message is the same `<name>: <upstream text>`; `Retry-After` is lost. This covers every failure after the keepalive began: all candidates failed, all cooling, empty replies. Known gap left to ticket 18: a passthrough upstream that ignores `stream: true` and answers whole JSON after the keepalive began is written into the event stream unchanged.
- Empty reply in `gateway.ts`: `askUntilSettled` asks the same endpoint once more at once (no `passing` pause, the `again` counter untouched); a second empty reply returns it as failed. `askInTurn` does not cool the endpoint for it (magpie #1221: the request's fault, not the account's), logs the switch with `failure: "empty"`, and on the last candidate answers 502 `<name>: an empty reply (the model answered nothing; try again)` in the agent's shape. A CLI that did not ask to stream is judged the same way: passthrough reads the whole reply before opening, translation always streams upstream.
- Reading a passthrough reply (gateway-robustness ticket 01): `relay()` writes the held bytes, then pipes every byte unchanged and feeds the same chunks to the `ReplyTap` `openUpstream` started, which reads them with `protocolOf(format).decoder()` — the decoders translation uses, never a second parser. A stream goes through `SseReader` event by event; a reply that came whole is buffered up to 8 MB (`MAX_WHOLE_REPLY_BYTES`, magpie `sniff.go`) and handed to `decoder.whole`; over the cap, or not JSON, nothing is read. Stickiness takes `usage.cacheRead` from it.
  - Content (magpie `streamPart.said`, `anthropicDeltaSays`): non-empty text; non-empty thinking text — a signature alone, or a reasoning item without summary text, is not; tool calls are `tool_start` and `other_tool` (a block or item whose type contains `call` or `tool` or starts with `mcp_`: `server_tool_use`, `custom_tool_call`, `web_search_call`, …). Codex's own calls (`CALL_TYPES`: `function_call`, `custom_tool_call`, `tool_search_call`) make the stop `tool`; server tools do not.
  - `done` is Anthropic `message_stop`, Chat `[DONE]`, Responses `response.completed` or `response.incomplete`; `response.failed` is an `error`. A reply that came whole ends with `done` unless it is an error body. Whether `response.incomplete` counts as finished for the broken-stream rules is ticket 20's call (prd item 40); `stop` already tells `length` and `filter` apart.
  - `done` and `other_tool` write nothing: each encoder's `event()` falls through to its `default` branch, and `ReplyCollector.add` returns on them without touching `fresh`. Check a new `StreamEvent` kind against all three encoders and `ReplyCollector`.
- Retryable failure (`retryable`) → `markFailed` → next candidate, logging `info` `"API endpoint gateway switched endpoints"` `{ from, to, model, failure, status, until }`. Every failed attempt also logs `warn` `"API endpoint returned an error"` `{ endpoint: slug, status }`. Cooldown start/end log `"API endpoint is cooling down"` `{ endpoint: name, model?, failure, status, until }` and `"API endpoint cooldown ended"` (timer, `served`, `clear`). No key ever.
- Cooldown by class: credit 30 min; quota = reset time in the error, else `Retry-After`, else 15 min, capped 8 days; rate 1 min doubling to 30 min (doubles only when limited again within 30 min of the last one ending; a vendor time ≥ that wins); other (5xx, header timeout, network) 1 min doubling to 10 min until it answers; auth (401/403 not explained by credit/quota words, a retired or unserved model, or region) = needs check with `until: null`. Not cooled: proxy failures and `requestRefused` (400/422 shape, unapproved client, region — switch only). A model the key does not serve (`modelRefused`) or a quota error saying other models still work cools `"<endpointId>/<model>"` only, which the endpoint list does not show.
- Per-endpoint cooldown settings (ticket 24, magpie `QuotaRest` / `RestCap`): `StoredApiEndpoint.cooldownSettings?: { quotaRestMinutes?, restCapMinutes?, noFailRest? }` reaches `markFailed` on `FailureReport.endpoint`. Unset or 0 is the constant above, so nothing set behaves exactly as before. `quotaRestMinutes` replaces the 15 min default; `quotaResetAt` (`"08:00"` host clock, `"16:00Z"`, `"00:00+08:00"`; protocol `parseResetAt` / `nextResetAt`, magpie `ParseResetAt` / `NextResetAt`) rests until its next occurrence instead and wins over the minutes (save keeps only it; the store drops an unreadable one); a reset time in the error still wins, and so does `Retry-After` unless it was cut to `longestWait` and the endpoint's own is longer. `restCapMinutes` replaces both `longestRetry` and `longestRateRest`; a vendor time ≥ the doubled rest still wins. `noFailRest` makes an `other` failure that is not `unserved` and not 401/403 return `null` with no failure counted; rate limits keep the 30 min cap. Minutes are clamped to 0..`API_ENDPOINT_COOLDOWN_MAX_MINUTES` (8 days) at use, since a hand-edited file is not validated. Wire field is `cooldownSettings` because `cooldown` is the live state. Save replaces it whole (`{}` clears, omitted keeps, copy carries), drops 0s and drops `restCapMinutes` when `noFailRest` is on, and rejects non-integers or out-of-range values with `invalid_cooldown_settings` `{ field, max }`. Tests pass `cooldownsNow` (gateway override) for a fixed clock. UI: the edit dialog's Advanced section (one Advanced, shared with ticket 22's headers / extra body / key header and ticket 23's certificate switch, one `FieldLabel` style, tooltips open below); minutes vs "until a time" is a segmented either/or that sends only the chosen one, the time field shows "each day, e.g. 08:00" and its tooltip explains the host clock vs `Z` / `+08:00`.
- In-place retry also applies when every candidate after the current one is cooling for quota/credit: the current endpoint is treated as the last (prd 31, ticket text) and, once its retries are spent, its own error goes back — magpie only does this under `passing` and then hands back the later endpoint's quota error.
- The last candidate: on 408/5xx/529 it is asked again after 1 s, 2 s (twice); on a short 429 rate limit up to three times; never when the wait would exceed 8 s, never after a header timeout. Then it is cooled like the others.
- Every candidate cooling for quota/credit after a 429/402 with the vendor's words (`quotaHeld(rests): QuotaHold | null`, `{ first, backAt }`): no upstream request; the **first** candidate's stored words (ticket 09, magpie), and both the message's time and `Retry-After` use `backAt`, the earliest any candidate is back (magpie `gateway.go:2498`) — never the first candidate's own `until`. All candidates needing a check: the last one's stored error. Other cooldowns still probe the soonest-back endpoint.
- Failure classes added in gateway-robustness ticket 09 (prd 26–32, magpie):
  - 402 counts as quota only when it says usage limit and names no money (`usedUp` without `credit` words); every other 402 is credit. A quota 402 still cools the whole endpoint: magpie cools only the model for subscription quota pools (`routing.go:891-909`), which Osuna's plain keys don't have.
  - Reset times also read from `resets in 0h 19min` (`FAILURE_WORDS.resetsSpan`, alongside `tryAgainIn`) and Zhipu 1308 / 1310 times with no zone, read as Beijing time; written waits over `COOLDOWN.longestWritten` are ignored.
  - Retryable (switch): a vendor firewall block page — not marked needs-check even on 403, because it blocks the address, not the key (Osuna's call; magpie has no auth class and rewrites the page with `BlockedHint`, not done); an unexplained 400, including Command Code's trace-id-only 400, switches without cooling (magpie `shapeRefused`).
  - Cline free-model daily limit (host `cline.bot`) cools only that model.
  - The model key `"<endpointId>/<model>"` has its own failure count; model-level cooldowns double by that count, so one model failing doesn't lengthen the endpoint's other models (`backoff(): Backoff`, magpie #2241).
- Retired models (gateway-robustness ticket 10, prd 37–39). `RetiredModels` (`api-endpoints/retired-models.ts`, one per daemon, built in `bootstrap.ts` `createRetiredModels`, disposed on shutdown) keeps `$PASEO_HOME/api-endpoints/retired-models.json` `{ models: [{ endpointId, model, retiredAt: ISO }] }` — a cache: Zod-validated, atomic write, unreadable → empty with one `warn`. `retire({ endpoint, model })` on `modelRetired` (incl. OpenCode Zen 410 / 401); `restore` when that endpoint+model answers; both log `info` (`"API endpoint model retired"` with `until`, `"API endpoint model back in service"` with `why: answered | expired`).
  - `listed(state)` is a pure read: the state minus active records (and Claude tier mappings pointing at them). Everything that offers models to an agent reads through it — gateway `/v1/models`, the Codex catalog, Claude's `modelPicker`, snapshot models and groups, bare-name routing, followers and the closest-ids 404. A slug-pinned request ignores it. An endpoint's selected models and provider defaults are untouched.
  - Expiry is timer-driven: one unref'd timer aimed at the earliest `retiredAt + 7 days`, re-armed on every save and at startup (records already past the week expire at once); on firing it drops expired records, which calls `onChanged` → `ApiEndpointService.retiredModelsChanged()` → rewrite the Codex catalog / Claude settings (ADR 0004) and notify clients. Without the timer, Codex (which reads the catalog file) would miss the model past the week until the next request.
  - User decision 2026-10-17 (kept as built, close to magpie): a slug-pinned request still fails over to other endpoints after a retired answer, and the retired endpoint+model is also cooled by the normal rules, so while cooling a pinned request asks the others first. The vendor's words reach the CLI only when no other endpoint offers the model.
  - Test clock / timers come through `RetiredModelsOverrides` (`apiEndpoints.retiredModelsNow`, `retiredModelsTimers`), in-process only like `ApiEndpointGatewayOverrides`.
- Stickiness inputs (gateway-robustness ticket 14, prd 33, magpie `affinity.go`). `AnswerEnd` carries the whole `Usage`, and `ConversationSticks.answered` records it:
  - Warm means `cacheRead + cacheWrite >= 1024` (writes count, not only hits). A reply reporting zero read and zero write counts the sent prompt (`usage.input`) as written — deliberately not vendor-gated (magpie `answered()`), so a non-caching relay with a ≥ 1024-token prompt also sticks for the normal warm period.
  - 1-hour cache (only Anthropic usage reports `ephemeral_1h_input_tokens`; Chat / Responses are 0): stays warm for an hour; a read covering the recorded tokens renews the hour, a smaller read drops it, a different answerer (endpoint or model) starts over. Cold = past the normal window **and** no warm hour.
  - Last answerer is matched endpoint + model + effort → endpoint + model → endpoint. The effort level is a reserved slot (user decision 2026-10-17): magpie's effort is fixed per routing-group member (`w.Fixed == c.effort`), Osuna candidates carry none, so in production it collapses to the two lower levels. It is proven only in `affinity.test.ts`.
- Context too long (gateway-robustness ticket 15, prd 34–36, `gateway/overflow.ts`, magpie). Window = ticket 07's `ModelFactsLookup` `context`; size = `estimateInputTokens`.
  - Before sending, `roomyCandidates` skips candidates whose known window can't hold the estimate (`RoomyPlan { plan, skipped }`, logged); unknown windows are never skipped.
  - `overflowOf(failed, candidate)`: `said` when the upstream says too long — including a relay's own single-request input cap (`Input token exceed the limit`, magpie `overflow_cap_test.go`; `readsTooLong` / `saysTooLong` in `failure.ts`); `unsaid` when the failure gives no reason (`!saidWhy && !modelRefused`) and the estimate is over 1.2× the known window — told with magpie's `tooLongUnsaid` wording `prompt is too long: about N tokens…` (+ up to 200 chars of the original when it reads like an overflow). An unexplained 5xx on the last candidate is retried in place first (magpie `settle`).
  - Osuna's own rule: `largerWindows` — after a too-long, switch only to later same-model candidates whose known window is larger than this one's known window; unknown on either side → no switch, the CLI compacts. Stricter than magpie, which also switches on equal / unknown windows (#2445, a relay cap smaller than the model window); kept because the ticket says "已知窗口更大". Too-long never cools (magpie "nobody rests"); a switch logs `failure: "too_long"`.
  - Every recognised too-long reaches the CLI in its own words, at every error exit (`sendAgentError` in `agent-errors.ts`, magpie `writeErrorSaid`): 400 `invalid_request_error` with `code: context_length_exceeded`, and on the Anthropic side `prompt is too long: ` is prefixed when missing — otherwise neither Claude Code nor Codex compacts. After a keepalive 200 the stream error event carries `context_length_exceeded` too (magpie `streamError`).
- Refusal failover (gateway-robustness ticket 19, prd 13–17, `gateway/safety-filter.ts`, magpie). A refusal is read from the error or the ending only, never from quoted answer text:
  - Error form: HTTP error body or in-stream error with code `content_filter`, `*_policy`, an `invalid_prompt` saying usage policy, or the whole sentence `HIGH_RISK_REFUSAL` ("The request was rejected because it was considered high risk"). Recorded as `REFUSED_STATUS` (400) with `cause: "refused"`, so a 403-said refusal never marks needs-check, and `askRefitted` skips refused failures (no field / downgrade re-asks on refusal text). `FailedAttempt` is a union on `cause`; only the `refused` branch carries `handBack: HandBack | null`.
  - End form, before any content: Anthropic `stop_reason: refusal` (with `stop_details` category / explanation), Chat `finish_reason: content_filter`, Responses incomplete for `content_filter`.
  - Before opening: no cooldown, no needs-check; ask the remaining same-model candidates (still cut by `spentAfter` — candidates all cooling aren't asked), switch logged `failure: "refused"`.
  - All refused: Claude Code gets the first **end-form** refusal held back (200, `stop_reason: refusal`, `stop_details`, streamed or whole as it asked; after a keepalive it ends the stream with it) — the first end-form one, not strictly the first-ranked endpoint (user decision 2026-10-17); all error-form → 400 (`api_error` in-stream after keepalive). Codex gets a Responses-shaped 400 `"<endpoint>: <model> refused this request (<reason>)"` with `code: invalid_prompt`; after a keepalive, `response.failed` with `invalid_prompt`.
  - Codex terminal code conclusion (`REFUSED_CODE` in `agent-errors.ts`): `invalid_prompt` — openai/codex@ce0323f2 reads it as InvalidPrompt, doesn't retry and shows the message (`codex-rs/codex-api/src/sse/responses_error.rs:82`, `api_bridge.rs:150-172`, `protocol/src/error.rs:155` / `:422`). magpie sends `server_error` after keepalive (`gateway.go:6366`), which Codex retries up to 5 times into the same refusal — not copied. `bio_policy` / `cyber_policy` also stop Codex but display as OpenAI's own policies.
  - If an earlier endpoint refused but the last one failed otherwise, the last one's error goes back (magpie).
  - After opening: the refusal reaches the CLI as the upstream sent it and is recorded as `refused`, not served — cooldown untouched, no retired-model restore, no stickiness. Translation carries Anthropic `stop_details` to Anthropic clients.
- Broken stream after opening (gateway-robustness ticket 20, prd 40 / 42 / 43, `gateway/broken-reply.ts`, magpie `replyEnds` / `cutMidReply`):
  - Not finished = Anthropic with neither `stop_reason` nor `message_stop` (`message_delta` with a stop counts); Responses with no ending event (`completed`, `incomplete`, `failed`, `error` all end it); a stream that already carried an error is finished; Chat is never "not finished" (no `[DONE]` can be complete). Passthrough judges from the `ReplyTap` (`endedShort`), translation from `ReplyEndingWatch` — one `ReplyEnding` shape. A post-opening refusal (ticket 19) is finished, not a break.
  - Streaming, passthrough and translated: on a connection loss (`connectionLost({ error })` → `connection lost mid-reply (<cause>)`) or `ENDED_SHORT` (`the reply ended before it was complete`), write a blank line (completing a half-written line first), then one in-protocol error event — Claude Code `api_error`, Codex `response.failed` — with `brokenMessage`: `<endpoint>: <reason> (502: you can retry your request)`, then end the response normally. Translation no longer calls `encoder.finish()` (no fake `message_stop` / `response.completed`); the encoder still closes open blocks (`content_block_stop`, `*.done`) before the error, so there the blank line isn't adjacent to the error event (magpie closes the same way). The endpoint cools by the existing rules.
  - Not streaming: translated → 502 with the reason; passthrough whole replies already sent `200` at opening, so they still drop the connection (the ticket only covers translated).
- Continuation after a break (gateway-robustness ticket 21, prd 41, `gateway/continuation.ts`, magpie `continuation.go`). Translated streaming replies only (magpie continues translated replies only; Claude Code → Anthropic is passthrough and gets ticket 20's tail error). In `streamReply`, a ticket-20 break is continued **before** the held-content flushes (`calls`, `numbers`, `fence` are shared across attempts and released only when giving up), at most 2 times, waiting `doubledPause` (1×, 2× `retryPauseMs`, shared with `cooldown.ts`).
  - Continue only when all hold: the upstream can resume from a prefill (`prefillMode`: Anthropic natively; Chat only DeepSeek prefix mode via `/beta` and Kimi partial mode, LAN relays excluded), something was said and no tool call has started (`mayGoOn`), the reply didn't end as a refusal (`refusedAfterOpening` — e.g. Chat `content_filter` then a drop), and `refusesPrefill(refusals)` is false (re-read each try, so a prefill refusal recorded by `noteRefusal` stops the next one).
  - The continuation request sends what the agent already received as an assistant prefill, never appends a user turn (`lastIsTurn` requires no continuation), hides resumed reasoning and drops text the model echoes from the start (`unecho`). The agent sees one reply: one `message_start` / `message_stop`, or one `response.created` / `response.completed`.
  - While waiting and while the continuation is asked, ticket 17's keepalive restarts (Codex real `response.in_progress`, Claude Code `ping`) — without it Codex drops at 300 s.
  - Giving up (can't resume, or broke a third time) writes ticket 20's tail error. The text is the continuation request's own failure (status added for passing failures), except a prefill refusal, which reports the original break reason (magpie).
  - Not continued: a code-less in-stream error event (magpie counts "an error out of nowhere" as a break; prd 40 limits breaks to ticket 20's cases).
- Endpoint list (`ApiEndpointService.toWire`): `cooldown?: { state: "cooling_down" | "needs_check", reason, until: ISO | null } | null` from `endpointRest`. `set_endpoint_state { clearCooldown: true }` → `clear`; `save` of an existing endpoint → `clear` when the key or addresses changed, else `clearNeedsCheck`; `delete` → `clear`.

### 4. Validation & Error Matrix

Caller recognition (cli-wiring-web-search ticket 02, `gateway/callers.ts` `judgeCaller`, magpie MIT): a loopback request without forwarding headers is accepted with any token or none. The agent is the one whose token matches (Bearer, then `x-api-key`); otherwise the User-Agent product name (claude: `claude`/`cc`/`claude-code`, prefixes `claude-cli`/`claude-code`; codex: `codex`, prefixes `codex`/`acp-extension-codex`); otherwise the path (`/v1/messages` Claude Code, `/v1/responses` Codex — not in magpie). The gateway is mounted before the host allowlist and CORS in `bootstrap.ts` so a rebinding rejection comes back in the agent's error shape, not the allowlist's `Invalid Host header`. There is no 401 any more.

All errors are wrapped in the agent's protocol (`gateway/agent-errors.ts`): `/v1/messages` or an `anthropic-version` header → `{ type: "error", error: { type, message } }`; otherwise `{ error: { message, type, code, param: null } }`. `type` defaults by status (400 `invalid_request_error`, 401 `authentication_error`, 403 `permission_error`, 404 `not_found_error`, 413 `request_too_large`, 429 `rate_limit_error`, 529 `overloaded_error`, other 5xx `api_error`).

| Condition | Status | Message |
|---|---|---|
| Socket not loopback | 403 | `The API endpoint gateway only accepts requests from this computer` |
| Any of `Forwarded`, `X-Forwarded-For`, `X-Real-IP`, `Cf-Connecting-IP`, `True-Client-IP`, `Tailscale-User-Login` (magpie `lan.go`) | 403 | `… this one came through a proxy or tunnel …` |
| No matching token, browser markers, and a `Host` that is not this machine (DNS rebinding; localhost, loopback IPs, `os.hostname()` and container host names pass) | 403 | `… doesn't answer a browser that reached it as <host> …` |
| `Origin` of another site; `Origin: null` or a localhost-subdomain page without a matching token (magpie `cors.go`) | 403 | names the page / says to open it at localhost |
| Decoded body over 64 MB | 413 | `The request body is over the API endpoint gateway's limit of 64 MB (decompressed); no API endpoint was asked. …` with `/compact` |
| `Content-Encoding` other than zstd / gzip, or zstd on a Node without it | 415 | names the encoding / says to send identity or gzip |
| Compressed body that does not decode | 400 | `The request body is not valid <encoding> data` |
| Body has no string `model` | 400 | `The request has no model` |
| Claude Code web-search sub-request (an Anthropic request whose `tools` hold a server tool whose `type` starts with `web_search`, `asksAnthropicWebSearch`) and no candidate for its model is on with `searchesWeb` and an Anthropic address | 400 `invalid_request_error` | `Web search is not available for <model>: no API endpoint that is on and serves this model has "Searches the web by itself" turned on in Osuna.` No upstream is asked. Not 401/403 (Claude Code asks to log in again) and not 429/5xx (it retries); Claude Code's search tool is never stripped (ADR 0009). When candidates exist, `webSearchCandidates` keeps only those, trimmed to their searching addresses — the Anthropic one when there is one (passthrough), else Responses (ticket 06: `web_search_20250305` → native `{type:"web_search"}` with `include: ["web_search_call.action.sources"]` except xAI's own URL; a forced search is `tool_choice: {type:"function", name:"web_search"}` as magpie, unverified against a real API; replies come back as `server_tool_use` + `web_search_tool_result` whose title is the URL unless Responses gives one) — and they fail over as usual; the conversation's own endpoint does not matter, a Subagent's search goes by the Subagent's model (cli-wiring-web-search tickets 04, 06) |
| Claude Code's switch on, caller Claude Code, a Claude-family id (`claudeFamily`, no vendor prefix — on-sale or not) or a bare tier name (ticket 17, magpie `claudeTierStandIn` / `claudeStandInAt`, user chose magpie 2026-10-18) | — (no 404) | Family id: the first endpoint mapping its tier, else the stored default model (unless the default is that very id → normal lookup); a family id matching no tier → default model. Bare tier name: by name first, then mapping, then default model. `routing.ts` steps 5–6 |
| Request carrying a claude.ai token (ticket 18, `gateway/claude-signin.ts`, magpie `signInWriter` / `refusedMessage` MIT) | — | The token is never forwarded (the endpoint's own key is sent); `oauth-` betas are dropped on every passthrough incl. count_tokens. Upstream 401, or 403 saying the OAuth token was revoked → 502 `api_error` naming the endpoint (Claude Code would otherwise ask to log in again); other errors keep their status with `x-api-key` → `API key` in the body and in stream error events. count_tokens: an upstream 401 falls back to the local estimate (200). The wrapper replaces `writeHead`/`write`/`end` through `Reflect.apply`, typed without casts |
| No enabled endpoint offers the model (after the Codex side-call stand-in) | 404 | `No enabled API endpoint offers the model "<model>"`, plus `; did you mean <id>, <id>, <id>?` with up to three closest ids (magpie `closest.go`: word in display name 4, in id 3, only in slug/name 1, whole joined name in label or id +4; matches only on the endpoint name do not count). Every no-model 404 carries the tail, so tests asserting the old exact message (e.g. "Codex 请求不走 Claude 档位映射") were updated for the tail only — an accepted exception to "tier-mapping cases unchanged" |
| The chosen candidate has no address at all | 502 | `<name>: no address for this agent's request format` |
| Body needs translation, is not that protocol's shape (e.g. no `messages` array, bad `allowed_tools` mode), and no passthrough candidate is left | 400 | `invalid request: messages must be an array` / `invalid allowed_tools mode "<mode>"` |
| Codex's last input item has an `input_image` with only a `file_id`, and every candidate needs translation | 400 | `The latest message has an image given only as an OpenAI file_id, which this API endpoint cannot open; send the image itself` |
| Translated non-streaming reply: upstream broke off, or said only an error | 502 | `<name>: <network error or upstream error message>` |
| No candidate has a stored key | 500 | `<name>: the API key is missing` |
| Upstream status ≥ 400, not retryable (e.g. context too long, plain 400) | same status, no switch, no cooldown | `<name>: <upstream message, key redacted, 300 chars>`; upstream `error.type` / `error.code` kept; `retry-after` and `*ratelimit*reset*` headers copied |
| Retryable failure, another candidate left | — | switch; the agent sees only the next candidate's answer |
| Retryable failure on the last candidate | same status | as above, plus ` (available again at <heldClock>)` — `HH:MM UTC±H[:MM]`, prefixed `YYYY-MM-DD ` when not today (`heldClock(at, now)`, magpie `routing.go:601` with Osuna's date format; the zone is on every such message, not only all-cooling) — for credit/quota/rate; a 429 without `Retry-After` gets one from the cooldown |
| No response headers within `gatewayHeaderTimeoutMs` (default 10 min) | 504 | `<name>: no response headers within <s>s` |
| Connection error before headers | 502 | `<name>: <origin>: <network error>` |
| 2xx closed before the first content | 502 | `<name>: <origin>: the connection closed before the reply began` |
| Error event before the first content | `streamStatus(raw)`, switches like an error body | `<name>: <upstream message>` on the last candidate |
| Empty reply twice at an endpoint, no candidate left | 502, no cooldown | `<name>: an empty reply (the model answered nothing; try again)` |
| Any failure above after the keepalive sent its 200 (streaming request, no opening within `gatewayKeepAliveMs`) | 200 already sent | one stream event: Anthropic `error` with `api_error`, OpenAI `response.failed` with `server_error`; same message, no headers |
| All candidates held out of quota/credit, or all need a check | stored status | `<last name>: <stored upstream message>` + reset text; `Retry-After` when held |

### 5. Good/Base/Bad Cases

- Good: `relay-a/kimi-k2` → endpoint `relay-a`, body sent with `"model":"kimi-k2"`, SSE chunks arrive one by one.
- Base: a bare name that two endpoints selected goes to the earlier one; a slug whose endpoint is closed, deleted, or did not select the model falls back to the bare name; `moonshotai/kimi-k2` selected as a whole name is not split. A 429 from A with B also offering the model: B answers with `x-osuna-api-endpoint: relay-b`, A shows `cooling_down` in the list.
- Good (translation): Claude Code asks `deepseek-v3`, only `relay-c` (Chat address) selected it → upstream gets `POST /v1/chat/completions` with the Chat body, the agent gets Anthropic `message_start` … `message_stop` with `model: "deepseek-v3"`, `stop_reason: "tool_use"`, usage input = prompt − cached.
- Good (ticket 07): Codex asks `glm-4.6`, only `relay-b` (Anthropic address) selected it → upstream gets `/v1/messages` with `system` from `instructions`, the agent gets `response.created` … `response.completed` with a `function_call` item and `model: "glm-4.6"`. Claude Code asks `grok-4` on a Responses-only endpoint → `/v1/responses` with `store: false`, `instructions`, `strict: false` tools, answered as Anthropic events.
- Base (ticket 06): Claude Code asks `relay-b/glm-4.6` with `thinking: {type:"adaptive"}` and `output_config.effort` → GLM gets neither field and thinks by its own default; the same session's title request (no `thinking`) gets `thinking: {type:"disabled"}`. A Claude model gets the body untouched.
- Bad: mounting after the bearer middleware — with a daemon password set, every CLI request is compared against the password and gets 401.
- Bad: reading a passthrough reply with a scan of its own, as the old `CacheReadTap` did with a regex over `cached_tokens`: a model's text quoting `"cached_tokens": 5000` counted as a cache hit, DeepSeek's `prompt_cache_hit_tokens` never did, and nothing else in the reply was known.
- Bad (ticket 17): keeping Codex alive with `: keepalive` comments. Codex drops comment lines and its idle timer keeps running, so it hangs up at 300 s anyway; use the protocol's own event.
- Bad (ticket 13): taking the first byte for the opening. `message_start` then `overloaded_error` reached Claude Code as the whole answer and the next endpoint was never asked.
- Bad: cooling an endpoint for a 400 the request itself caused ("Extra inputs are not permitted"). Every endpoint refuses the same tool schema, so each would cool in turn and the list would show them all cooling; `requestRefused` switches without cooling.

### 6. Tests Required

- `gateway/routing.test.ts`: slug direct, bare name by Endpoint order, slashed bare name, tier mapping (Claude only), selected Claude model sent as is, closed/deleted slug falls back, same-named followers in Endpoint order, nothing found; ticket 02 — `sameModel` on the four spellings (vendor prefix, `.`/`_`/`p` versions, snapshot dates), `~` as `/`, a non-slug prefix normalized, exact id ahead of a normalized match, each candidate's own `upstreamModel`, closest-ids ordering and the 404 tail. E2E (`api-endpoint-gateway.e2e.test.ts`): `claude-opus-4-6` fails over from `claude-opus-4.6` to `anthropic/claude-opus-4-6-20260115` with each upstream seeing its own id; `codex-auto-review` and a `x-openai-subagent: guardian` request go to the last turn's model, and 404 when there is none.
- `gateway/failure.test.ts`, `cooldown.test.ts`, `affinity.test.ts`: each of the 20 regexes hits and misses; `failure` order; auth mapping; `retryable` table; 13 constants; each cooldown class and its doubling; `retryAfter` header forms; written reset times; `passing`; `quotaHeld`; each of the 12 affinity steps; turn counting for both wires; conversation ids.
- `gateway/routing.test.ts` also: format choice — passthrough, Claude model to Anthropic over the agent's own, Chat first, then Responses, then Anthropic, no address.
- `gateway/translation/{anthropic,chat,responses}.test.ts`: magpie cases — Anthropic and Chat tool pairing (synthetic results, orphan results as text/user, duplicates, thinking-only turn, whole session), `pairToolItems` / `orphanedToolOutputs` / `joinToolRuns` with byte-for-byte no-ops, Chat stream decoding (first choice only, index forms, repeated ids, reasoning under two names, error chunk), Chat → Anthropic events in full, stop maps both ways, usage maps (cache split, DeepSeek/Moonshot/Anthropic cache names), call-id encoding, magpie's `anthropic-to-chat` and `chat-to-anthropic` upstream bodies (compared by value). Ticket 06 adds: `<think>`/`<thought>` cases from `minimax_think_test.go` (one character a chunk, a later tag is text, `<thin` is text, held text handed back by `end`), the three cache marks, thinking build (adaptive + effort, 4.6 max, budget and raised `max_tokens`, cap ≤ 2048 keeps temperature, `thinkOff`, no field when unasked), images both ways and in tool results, `anthropic_image_source_test.go` source fields, `document` dropped, `TestChatFilePart` placeholders, structured output from `format_test.go`, DeepSeek replay on Chat (`reasoning_content` text / `" "`) and on Anthropic (`" "` + unsigned text), signed thinking kept for Anthropic, live reasoning → `thinking_delta`, web search tool left out when the target doesn't search (ticket 06 adds both search directions, streamed and whole).
- `gateway/translation/responses.test.ts` (ticket 07): magpie's `responses-to-anthropic`, `responses-to-chat` (minus `service_tier`) and `anthropic-to-responses` upstream bodies by value; namespaced tools offered flat, unsealed and in `named`, long names cut to 64 and distinct, a namespaced history call by flat name; custom tool description/schema and history call; `allowed_tools` filter and bad mode; web search dropped unless the endpoint searches on Responses (ticket 06); `agent_message`; a later developer message as a system reminder with the system unchanged; `strict` from Chat/Anthropic; file_id image refused in the latest turn, dropped earlier; `input_file` dropped; usage cache read/write round trip; sealed stream → summary thinking + call with done arguments, no `encrypted_content` anywhere, also through `AnthropicEncoder`; incomplete → length/filter; failed / error / shapeless error; Codex event sequence with `sequence_number`, completed output and usage; namespaced and custom calls streamed and rendered; error → `response.failed`; context-window stop → `incomplete`; structured output Responses ↔ Chat/Anthropic; DeepSeek `replayedReasoningInput` cases from `deepseek_step_lead_test.go` and translated `reasonFirst` (other models get no `reasoning_text`).
- `translation/fence.test.ts`, `translation/text-calls.test.ts` (ticket 08, magpie fixtures). E2E: JSON fence stripped streaming and whole for json_schema and json_object, kept without a format; Hermes / DSML / GLM each become a tool call (Claude Code and Codex); same text with no tools kept.
- `gateway/passthrough.test.ts` + `translation/responses.test.ts` + `translation/anthropic.test.ts` (ticket 06, magpie fixtures): billing line and review fields per target model, advisor both cases, adaptive on 4.6+ only, sampling on passthrough and the translated build, count_tokens gets the same Claude Code patches, the three Responses pairing fixes. E2E: one Claude Code request to a Claude model is byte for byte except the model; Codex translated then switched to a Responses passthrough carries no bare reasoning items. Ticket 04's safeguards refusal cases now use a Claude model (non-Claude targets never get the field).
- `gateway/refused-downgrades.test.ts` (ticket 05, magpie cases with source header) and `refusals.test.ts` `refusesPrefill` (other model / other endpoint unaffected). E2E (ticket 05): structured output refused twice → `json_object` + schema in system, then text only, next request starts at the remembered step (Codex passthrough and Claude Code translated to Chat); Codex prefill gets the user turn now and next time; Claude Code prefill sent once; logs; reset after restart.
- `gateway/refused-fields.test.ts` (ticket 04, magpie cases with source header): each field recognised only when named and carried; drops and the `tool_reference` text line. E2E (ticket 04): per field, passthrough and translated — refused → same endpoint re-asked without it, next request for that endpoint+model goes without it, another model on the same endpoint and another endpoint still send it (full request sequences asserted, e.g. `[true, false]`); reset after restart.
- `gateway/refusals.test.ts` (ticket 03): magpie `wrongEndpoint` and `BothAuthRefused` vendor texts hit and miss; header order and recording in `askWithOneKeyHeader`. E2E (ticket 03): Anthropic address says no such model → same request translated to the Chat address, second request goes straight to Chat, no cooldown, reset after restart; every format refuses → that model cools and the next endpoint answers, then after cooldown both formats are asked again in order; both headers refused → `x-api-key` only, next request sends only it, reset after restart; translated attempt learns Bearer only.
- `gateway/refusals.test.ts` (ticket 16): `none` read from Responses and Chat bodies; not read off a 500, a non-none effort, levels without a quoted none, a sentence's "None"; `thinkingOff` read from magpie's GLM 1210 (plain and `\u`-escaped Chinese), OpenRouter mandatory, Opus 5.5 `thinking.type.disabled`, DashScope, Ark and the none text, for `disabled` and `between_tools`; not for a thinking body or another 400; `RefusedShapes` keyed by endpoint, model and shape. `translation/anthropic.test.ts` adds magpie's `thinking_off_test.go` table (both `TestThinkingOffAsTheModelTakesIt` and `…LeavesOtherModelsAlone`, the latter asserting the same object back) and a Codex none built for four Claudes; `responses.test.ts` adds none → Chat/Responses `none`, `thinkingBackOn` → `low`, Claude Code off → Chat with no effort, back on → GLM budget 4096 / Opus 5.5 adaptive + low.
- `gateway/passthrough.test.ts`: `fitThinkingOff` — Sonnet 5.5 `between_tools` byte for byte elsewhere, Opus 5.5 no thinking + low + room, thinking / untold / 4.8 bodies byte for byte, `leftOn` for GLM (thinking removed) and an unknown Claude (+ effort low). `fitResponsesBody` — summary becomes text with the body head unchanged, empty item gets `" "`, own text untouched, only `content` edited when nothing moves, reorder when a step said something before its reasoning, a non-DeepSeek model byte for byte. `fitAnthropicBody` — Claude byte for byte; adaptive + effort removed with the rest byte for byte; `format` kept beside a removed effort; no `thinking` → disabled; enabled / disabled untouched; magpie's DeepSeek conversation (redacted → space, tool turns get a space block, signed thinking kept) and the same body to GLM byte for byte. `ReplyTap` — per protocol, a stream cut inside an event, a number and a multi-byte character still reads content in first-seen order, the stop, `ended` and cache read/write; `ping` and `response.created` are no content; a refusal stop → `filter`; error events; a thinking block with only a signature says nothing; a server tool and Codex's `apply_patch` are tool calls, the latter stopping for tools; a whole reply in each format reads like its stream; a refusal and an error body that came whole; not JSON or over 8 MB → nothing read.
- `daemon-e2e/api-endpoint-gateway.e2e.test.ts` (local only; not in `test:integration`): no token, a ChatGPT token or a claude.ai token taken and told apart by `User-Agent`, 403 through a proxy header, works with a daemon password and a 300 kB body, token file created 0600 and kept when the agent is turned off, byte-exact passthrough and progressive streaming, non-streaming reply whole, wrapped 429/400/503 with `Retry-After`, 504 on header timeout, no real key in log lines or responses, `/v1/models` dedup; endpoint-management-ux ticket 17: `/v1/models` entries carry the facts and leave out a disabled model, `/v1/models/{id}` hit equals the list entry, bare name, unknown and malformed-escape ids → 404, disabled model → 404; switch on 429/402/503/header timeout/pre-byte close, no switch on a context-too-long 400, switch without cooling on a shape 400, broken stream after the reply opened, cooling skipped until `clearCooldown`, 401 → needs check until the connection is edited, model-only edit keeps a cooldown, all held out of quota, restart clears cooldowns, log lines, stickiness within a turn and on a warm cache; Claude Code → Chat-only endpoint translated with the full upstream body and full Anthropic event list, non-streaming agent streamed upstream and answered whole, Chat 400 wrapped under the name, `count_tokens` passed to an Anthropic address and estimated for a Chat one, a Codex lone call mended before Responses passthrough; a Chat endpoint's `reasoning_content` and leading `<think>` both reach Claude Code as a thinking block then text; Claude's signed thinking left out for a Chat endpoint and passed through to an Anthropic one; a tier mapped to a non-Claude model gets `thinking: disabled`; tool turns to `deepseek-v3` carry `reasoning_content: " "`; Codex → Anthropic-only endpoint (full upstream body, Responses events, completed usage), Codex → Chat-only streamed and whole, Claude Code → Responses-only endpoint (full upstream body, full Anthropic event list), file_id image → 400 in OpenAI shape with no upstream request. Passthrough bodies in the byte-exact tests carry `thinking: enabled` so a non-Claude model needs no edit. Ticket 16 adds "reasoning turned off, sent the way each model takes it": Responses passthrough refusing none → `none` then `low`, next request `low`, another model still `none`; the same through a Chat endpoint (translated); Claude Code passthrough and Codex translated thinking-off to Sonnet 5.5 / Opus 5.5 / Opus 5 / Opus 4.8 reach the upstream as the table says; GLM refusing R-C3's added `disabled` → retried without thinking and remembered; a translated Codex none to GLM refused → retried with `enabled` budget 4096 and remembered. Ticket 13 adds "the reply opens at its first content": `message_start` + `ping` then `overloaded_error` → next endpoint, none of the first stream reaches the agent, the first cools; Codex `response.created` then `response.failed` → next endpoint (translated), its answer only; thinking streams out before the upstream errors and nothing switches; an empty reply (all usage 0) asks A twice, then B, A not cooled, switch logged `failure: "empty"`; both endpoints empty → 502 `api_error` with the empty-reply text, streamed and not, each asked twice; a reply that counted its prompt (input 5, output 0) and an empty Chat reply are answers, asked once; Codex all empty → the same error in OpenAI shape. Ticket 17 adds "the agent is kept alive while the reply has not opened" (`keepAliveMs: 30` etc.; the upstream is held until the test has read the pings, so the order does not depend on timing): Claude Code gets 200 `text/event-stream` and only pings, then `message_start` and the text after them; a translated Chat reply follows the pings; Codex gets `response.in_progress` with data and no comment line, then the reply; all candidates 503 after the keepalive → Claude Code's last event `api_error` `Relay B: upstream busy`, Codex's `response.failed` `server_error`; empty replies after the keepalive → `api_error` with the empty-reply text; a 429 with `retry-after: 30` before the keepalive → 429 JSON with the header; silence over `keepAliveQuietMs: 100` → no more pings; `stream: false` → JSON, no keepalive. The fake upstream's default reply is a one-word Anthropic answer, since `{}` read through the Responses decoder says it completed with nothing in it, which is an empty reply.
- `gateway/failure.test.ts` (ticket 13): `streamStatus` — overloaded 529, context length 400, balance 402, rate limit and quota 429, missing model 400, invalid request 400, anything else 502. `gateway/passthrough.test.ts` imports `ReplyTap` from `reply-tap.ts` and asserts `error.raw`.

### 7. Wrong vs Correct

#### Wrong

```ts
const json = JSON.parse(body); json.model = upstreamModel;
upstream.end(JSON.stringify(json)); // reorders nothing, but drops formatting and can change number spelling
```

#### Correct

```ts
const text = body.toString("utf8");
upstream.end(applyEdits(text, modify(text, ["model"], upstreamModel, {})));
```

Use `node:http` / `node:https`, not `fetch`: undici decompresses the body behind your back and caps the wait for response headers at 5 minutes, below the 10-minute contract.

#### Wrong

```ts
// a second reading of the reply, beside the decoders translation uses
for (const match of text.matchAll(/"cached_tokens"\s*:\s*(\d+)/g)) cacheRead = Math.max(cacheRead, Number(match[1]));
```

#### Correct

```ts
const opened = await openUpstream({ res, url, headers, body, apiKey, headerTimeoutMs, reads: format });
if (opened.kind !== "opened") return opened; // error, break or empty reply before content: switch
res.write(opened.held); // the frames held until the first content
response.on("data", (chunk: Buffer) => opened.tap?.feed(chunk));
response.once("end", () => {
  const usage = opened.tap?.end().usage; // content, stop, ended and error are read the same way
});
```

## Scenario: host state that replaces a provider's model catalogue

Reference implementation: the active API endpoint (api-endpoint ticket 05). Reuse this shape for any host-side mode that decides which models a provider may run.

### 1. Scope / Trigger

- Something on the host, not the provider's own catalogue, decides the exact set of models a built-in provider accepts, and the set changes at runtime without a config reload.

### 2. Signatures

- `ProviderModelOverride = (provider: AgentProvider) => AgentModelDefinition[] | null` in `server/agent/agent-sdk-types.ts`; `null` means "use the provider's catalogue".
- `ApiEndpointService.activeModels(provider: string): AgentModelDefinition[] | null` is the single source: while the agent's switch is on, the enabled endpoints' selected models deduped by bare name (`usableModels`), `isDefault` on the agent's default model.
- `ApiEndpointService.activeModelGroups(provider): ApiEndpointModelGroup[] | null` (api-endpoint-auto-switch ticket 10), built on `endpointModelGroups(state)` in `host-endpoints.ts`: one `{ name, models }` per enabled endpoint with selected models, Endpoint order; model `id` is `<slug>/<model>` (a name collision with another endpoint's slugged id keeps the first), `label` the bare name, `isDefault` only on the first group holding the agent's default. Published as `ProviderSnapshotEntry.apiEndpointModelGroups?` through `ProviderSnapshotManagerOptions.apiEndpointModelGroups: ApiEndpointModelGroupsLookup`; the type is the protocol's `ApiEndpointModelGroup` (`protocol/src/agent-types.ts`), re-exported from `agent-sdk-types.ts`.
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
- `models` stays bare for old clients (the old-app projection); only `apiEndpointModelGroups` carries slugs, so a new client picks a specific endpoint and an old one routes by Endpoint order. Since endpoint-management-ux ticket 04 the list also sends each endpoint's `slug` (optional field, searched by the list page). Lists and snapshots never carry a key, only `hasApiKey` and `apiKeyMask`; since ticket 05 the one way a key goes out is `provider.api_endpoint.reveal_key`, answered only on an authenticated connection with `daemon.manage` when the user presses Show in the edit dialog. Since ticket 06 `provider.api_endpoint.list_templates` (`daemon.read`) sends the built-in templates from `server/api-endpoints/templates.ts`; the client fills a template's base URLs into the save request itself and sends `templateId` / `region` with it, and only asks for the list when the host declares `apiEndpointManagement`. `agentFingerprint` includes the groups, so selecting a model on a second endpoint or renaming an endpoint republishes the snapshot even when the bare list is unchanged.

### 4. Validation & Error Matrix

- Official, or a provider with no endpoint support → override `null`, catalogue unchanged, field absent.
- Endpoint store unreadable → thrown inside `refreshProvider`'s try, the entry becomes `status: "error"`; inside `resolveDefaultModelId` it is outside the try and propagates.
- Custom provider that `extends: claude` → id is not `claude`, override `null`; its catalogue is not replaced.

### 5. Good/Base/Bad Cases

- Good: activate → snapshot lists only `relay/*`, `isModelListAuthoritative: true`; a create with no model runs `relay/haiku`.
- Good: endpoints A `[shared, a1]` and B `[b1, shared]`, default `b1` → `models` `[shared, a1, b1*]`, groups `A: [a/shared, a/a1]`, `B: [b/b1*, b/shared]`.
- Base: back to Official → the next refresh publishes the provider's own catalogue and drops the field.
- Bad: replacing models only in the snapshot — the picker looks right, but `paseo run` with no `--model` still sends `claude-opus-*` to the relay.

### 6. Tests Required

- Daemon E2E (`daemon-e2e/api-endpoint-claude.e2e.test.ts` "provider snapshot follows…", `api-endpoint-codex.e2e.test.ts`): `expect.poll` the snapshot after activate / edit / Official / delete; `createAgent` with no model asserts `agent.model` is the endpoint's default id.
- Unit (`provider-snapshot-manager.test.ts`): override replaces rows the catalogue returned, runs `resolveConfiguredModel`, sets and clears the flag; a real `ClaudeAgentClient` on a temp `settings.json` (version injected, `isAvailable` overridden, no CLI run) proves the settings rows disappear.
- Protocol (`messages.api-endpoint.test.ts`): entry parses with and without the field; likewise `apiEndpointModelGroups`.
- Daemon E2E (`api-endpoint-host-wide.e2e.test.ts` "the model list has each model name once…"): groups, ids, labels and the single `isDefault` while on; field absent after the switch goes off.

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

- Wire (`protocol/src/api-endpoint/rpc-schemas.ts`): `ApiEndpointHealthIssueSchema = { code: string, message: string }`; list payload adds `health?: ApiEndpointHealthIssue[]`, `cliBaseUrl?: string | null`, `runningSessionCount?: number`, and `gatewayUnavailable?: ApiEndpointHealthIssue | null` (api-endpoint-auto-switch ticket 03).
- Service: `ApiEndpointService.list(provider): Promise<ApiEndpointListResult>` (`ApiEndpointListResult` is `Required<Pick<payload, "endpoints" | "activeEndpointId" | "health" | "cliBaseUrl" | "runningSessionCount" | "agents" | "gatewayUnavailable">>`), `activeEndpointId(provider)` for the sync error path. Internal unions: `ApiEndpointHealthCode` for `health`, `GatewayUnavailableCode` for `gatewayUnavailable` and the refusal error.
- Count: required option `ApiEndpointServiceOptions.countLiveSessions(provider) => number`, wired in bootstrap to `AgentManager.countLiveAgents(provider)` (non-internal agents of exactly that provider whose lifecycle is `initializing`, `idle`, or `running`).
- Hint area (cli-wiring-web-search ticket 03): list payload adds `agentIssues?: Record<provider, ApiEndpointAgentIssue[]>` with `ApiEndpointAgentIssueSchema = { code: string, params?: Record<string, string>, message: string }` — every agent's issues regardless of the requested provider; the app translates by `code` and falls back to the English `message`. Codes so far: `not_through_gateway` (`file`, `keys`), `config_unparsable` (`file`, `detail`), `codex_profile_override` (`file`, `profile`, `keys`), `model_replaced` (`file`, `model` — `""` when the CLI removed it — and `defaultModel`; actions Re-apply and the model-only keep); later tickets add codes (comments, cloud switches, model replaced, bypassed, proxy …), so the app's code → copy/actions tables must stay one place to extend. `health` keeps being sent for old clients. `set_agent_settings` gains optional `reapply: true` (with `enabled: true`: rewrite even when settings didn't change). New RPC `provider.api_endpoint.keep_current_settings.request/.response` `{ provider, code? } → { provider, agent | null, error | null }`: switch off, files left as they are, no more warning; already off → no-op. With `code: "model_replaced"` (ticket 21) it answers Model replaced instead: the CLI's model is kept, the switch stays on; old daemons ignore `code` but never report `model_replaced`, so the button never reaches them. All of it is gated on `server_info.features.apiEndpointCliWiring` (`COMPAT(apiEndpointCliWiring)`); without it the app shows one line asking to update the host. Ticket 24 adds `codex_multi_agent_v2_on` (`file`) and `codex_multi_agent_v2_unreadable` (`file`, `detail`), checked only while Codex's `allowsAnySubagentModel` is on; both carry fix steps and no actions (Osuna never changes `multi_agent_v2`). Ticket 25 adds `bypassed` (`how`: `used` / `elsewhere` / `refused`, `at`: ISO time the app shows as hours:minutes in the viewer's language, `host` for `elsewhere`; actions Re-apply and Switch to official). The CLI records are read through the service option `readCliUse` (default `cli-bypass.ts` `readCliUse`). The daemon reports it only while the switch is on and no other issue except the two multi_agent_v2 notices is up (magpie's Drift returns the config's own drift first); the gateway records each provider's last request (`GatewaySightings`, shared by bootstrap with the service, kept in `gateway-seen.json`) — any accepted request on the agent paths, count_tokens or the ChatGPT backend paths, before routing. `set_agent_settings` and the agent settings add optional Codex-only `forcedSubagentModelId` (`string | null`) and `allowsAnySubagentModel` (`boolean`); Claude Code is refused with `invalid_input`; old daemons ignore them and the app shows the rows behind the same `apiEndpointCliWiring` gate as tickets 22–23.
- Switch-off preview (cli-wiring-web-search ticket 26): `provider.api_endpoint.preview_switch_off.request { provider }` → `.response { provider, preview: { files: ApiEndpointSwitchOffFile[] } | null, error | null }`; `ApiEndpointSwitchOffFile = { path, change: string /* edited | created | removed */, lines: { op: string /* removed | added | restored */, text, was? }[] }`. Strings, not enums, so a newer daemon can add kinds; the app (`internal/switch-off-preview.ts`) parses them into unions and describes the whole preview in words when one is unknown. `preview: null` with an error (e.g. `config_unparsable`) means it can't be had: the confirm sheet shows the fallback text and the reason and stays confirmable. Permission `daemon.manage`. Gated on `apiEndpointCliWiring`: only then do the agent switch and the hint area's Switch to official open the sheet (`switch-off-sheet.tsx`, like magpie's every disconnect entry going through `askDisconnect`); older hosts switch off at once. The sheet sends the switch-off itself (`set_agent_settings { enabled: false }`) and keeps a refusal in place; after a `config_unparsable` refusal it offers Keep current settings (`keep_current_settings`: off, files untouched). The Codex note is shown for provider `codex` in every state, as magpie does by agent id.
- Who to reopen (cli-wiring-web-search ticket 27, `reopen-hints.ts`, magpie MIT `StaleCopies` / `changedAt` / `KeepCodexDaemonCurrent`): list payload adds `reopenHints?: Record<provider, ApiEndpointReopenHint[]>` with `{ kind: string, count?, since? (ISO), app?, command?, message }`, every agent's hints regardless of the requested provider; the app maps each known `kind` to a view only when the fields it needs are there, otherwise shows the English `message`. Kinds: `osuna_sessions` (`count`), `cli` / `ide` (`count`, `since`), `app` / `embedded` (`count`, `since`, `app`: one row per desktop app bundle name such as ChatGPT vs Codex, or per embedding app), `app_server` (`since`, `command: "codex app-server daemon restart"`), `app_server_restarted` (`since`), `claude_live_env` (Claude Code only, sent after its other hints: which changes running sessions take at once). The change time is not the rewrite time: it is when the digest of what the CLI reads at start last changed (`cliChangedAt`; Claude Code's settings.json `env`, `model`, `effortLevel`, `ultracode`, `modelSettings`; Codex's top-level provider/model/catalog/base-url/effort keys, Osuna's `model_providers` table and `codex-models.json`), so a Re-apply that writes the same values, the CLI's own writes and a daemon restart don't move it; a digest first seen takes the files' latest mtime. It is only computed for a provider Osuna has rewritten (`cli-rewrites.json` has it); nothing is listed before that. Copies count when started more than a second before the change; Osuna's own child processes are left out and counted as `osuna_sessions` from `AgentManager.countLiveAgentsStartedBefore`. Codex's shared app-server is dated by its pid file's mtime; with no codex client attached it is restarted; processes and clients of another `CODEX_HOME` are excluded where `readCodexHome` can read it (Linux). Looking happens in the background (`CliReopenHints`), one look at a time: after every commit that synced a CLI it lists processes for stale copies; every 15 s (`REOPEN_CHECK_EVERY_MS`, timers injectable as `reopenHintsTimers`, stopped by `ApiEndpointService.dispose()` on daemon stop) it reads only the app-server's pid record and lists processes only when that record is older than the change. The list RPC reads the last look, waits (at most 3 s) only when no copies were listed for the current change, and relists in the background when that listing is 15 s old. Process listing, reading a process's `CODEX_HOME`, locating codex and running commands go only through the replaceable `HostProcesses` adapter (`host-processes.ts`, service option `hostProcesses`; ticket 28 adds `readSystemProxy`): `createSystemHostProcesses` throws `RealHostProcessesInTestError` when `VITEST` is set, the in-process test daemon passes `FakeHostProcesses`, and Playwright daemons get a fake adapter that `daemon-upgrade-seal.mjs` installs at `Symbol.for("paseo.e2e.hostProcesses")` (table from `PASEO_E2E_PROCESS_TABLE_PATH`, commands only recorded). A listing or restart that fails (`HostProcessesError`) only logs and drops those rows. On Windows (`reportsStartTimes: false`) processes are listed only for the app-server check. The app's "Got it" hides the block until the hints change, per host and provider (`stores/reopen-seen-store.ts`, in memory, magpie `staleSeen`). Not gated by a new feature flag: the field is optional and the app shows it inside the `apiEndpointCliWiring` hint area.
- Proxy that doesn't pass Codex's requests on (cli-wiring-web-search ticket 28, `codex-proxy.ts` / `system-proxy.ts`, magpie MIT `codex_proxy.go` / `netproxy`): Codex's `agentIssues` adds `codex_proxied` (`host`: the gateway's host:port; `proxy`: the proxy with its account taken out; `from`: `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` / `windows_settings` / `system_settings`; `fix`: `environment` / `windows` / `other`, magpie's three fix wordings; action Switch to official, plus fix steps). The daemon decides `from` and `fix`; the app only maps them to copy and falls back to the English `message` for a value it doesn't know. Which proxy Codex takes follows reqwest/hyper-util and Codex's own `respect_system_proxy` path (`codexProxyFor`, `readCodexRespectsSystemProxy` reads `[features] respect_system_proxy = true` only): the environment is the login shell's over the daemon's own (service option `proxyEnv`, default `env`; the login shell is asked the cloud-switch and proxy variables together in one run, `LOGIN_SHELL_KEYS`, like magpie's `shellVars`), the system proxy comes only from `HostProcesses.readSystemProxy()` (`scutil --proxy` / `reg query` Internet Settings; kept 15 s when set, 2 s when none; a `HostProcessesError` reads as none and logs). Reported only while Codex's switch is on and no other issue except the multi_agent_v2 notices is up, before `bypassed` (which it then suppresses), and only when the gateway answers directly while `GET <gateway>/` through the proxy (service option `probeThroughProxy`; 3 s timeout, `User-Agent: Osuna/<daemon version>`, socks treated as http like Codex) doesn't answer `{"name":"osuna"}`. A proxy address that can't be parsed is not reported. A check that throws resolves to no issue and logs: it never fails the list RPC. The check runs in the background (`CodexProxyCheck`): the list RPC waits for it at most 3 s, then uses the last answer for the same gateway; proxy answers are kept 20 s; nothing is persisted. Every Codex process Osuna starts through `buildCodexAppServerEnv` gets `localhost,127.0.0.1,::1` appended to `NO_PROXY` and `no_proxy` (magpie `withProxy`; existing `NO_PROXY`, else `no_proxy`, entries kept first); `findCodexCommand` (the shared app-server restart) does not, since terminal Codex is only told. Tests never see the developer's proxy: `createTestPaseoDaemon` defaults `proxyEnv: {}` and a `probeThroughProxy` that throws, so only suites that start a fake proxy on loopback pass the real probe (`test-utils/forwarding-proxy.ts` `passOn` for one that forwards); vitest daemons set `FakeHostProcesses.systemProxy` and `readLoginShellEnv`; `withUpgradeSeal` (`spawn-node.ts`) and `daemon-upgrade-seal.mjs` strip `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` / `NO_PROXY` in every casing, and Playwright daemons read the fake system proxy from `PASEO_E2E_SYSTEM_PROXY_PATH` through the seal. In the app, fix steps can be a numbered list whose steps carry a command row (monospace, Copy, same as the install section); expanded fix steps sit under the description, above the buttons, for every issue. Not gated by a new feature flag: it is one more code in the `apiEndpointCliWiring` hint area.
- App: the new app shows no `health` (ticket 10 removed the old per-agent section and its Alert); since ticket 03 it shows `agentIssues` in the provider page's hint area (`api-endpoints/agent-issues.tsx`), with outline action buttons whose failure stays until retry or dismiss; since cli-wiring-web-search ticket 29 all of one agent's issues (and an action failure) render as sections of ONE `<Alert>` (design.md one-Alert-per-region), each section keeping its own title, body, buttons and How to fix, the Alert variant being the most severe section's; it reads only `gatewayUnavailable`, through `selectAgentApiEndpointsView` in `api-endpoints/internal/agent-settings.ts`, to grey out the switch and say why. Old clients still render `health`.

### 3. Contracts

- Health codes: `modified_externally` (an owned key no longer holds `written`; message names the keys), `config_unparsable`, `codex_profile_override` (legacy top-level `profile` whose `[profiles.<name>]` sets `model_provider` / `model` / `model_catalog_json`; reported in both modes so it shows before enabling). v0.15 daemons also send `codex_version_unsupported` / `codex_unavailable`; ticket 03 dropped the Codex version check (no `auth.command` any more), and the app keeps the `codex_version_unsupported` key under `COMPAT(codexVersionUnsupported)`.
- `gatewayUnavailable` is host state, not file health: `gateway_requires_tcp` (daemon listens on a socket or pipe) or `gateway_not_ready` (before the listener binds). Turning a switch on (`set_agent_settings`, old `set_active(id)`) is refused with the same `{ code, message }` as the error, so the app can explain the greyed-out switch from the list and the refusal alike.
- `cliBaseUrl` is set only in Official: Claude `env.ANTHROPIC_BASE_URL`; Codex the effective provider (profile over top level, default `openai`), its `model_providers.<id>.base_url`, or `openai_base_url` for `openai`.
- Re-apply has no RPC of its own: it is `set_active` with the active id (old clients) or `set_agent_settings { enabled: true, reapply: true }` (ticket 03), so it runs the same conflict guard. "Switch to Official" is `set_active(null)` / switch off. "Keep current settings" is `keep_current_settings`: forget the takeover record, then switch off, and put the record back if that fails.
- New write error `config_conflict` (file kept changing during the write). The app localizes it and `modified_externally`, `config_unparsable` (health wording), `codex_profile_override`; other codes show the daemon message.
- `runningSessionCount` counts live sessions, not only `running` ones: an idle Claude process re-reads `settings.json` on its next turn, so it is affected too. Custom providers that extend `claude` are not counted. The count answers "how many sessions does rewriting the CLI config touch", so it lives on the list and the app fetches the list again right before each confirmation.
- The app reads the optional fields with `?? []` / `?? null`: the protocol keeps new fields optional, so this default is permanent, not a COMPAT shim. A `null` count drops the session line from the confirmation and keeps the terminal line.

### 4. Validation & Error Matrix

- Owned key edited → `modified_externally`; other keys edited → no issue.
- File deleted while an endpoint is active → every owned key listed as modified.
- File does not parse → `config_unparsable` in `health`; the list itself still succeeds.
- Daemon on a socket → `gatewayUnavailable.code = "gateway_requires_tcp"`, `list.error` stays null, switches already on stay on.

### 5. Good/Base/Bad Cases

- Good: another tool rewrites `env.ANTHROPIC_BASE_URL` → the list reports `modified_externally`; an old client's panel shows one error Alert with Re-apply and Switch to Official.
- Base: Official with a hand-written relay → no issue, `cliBaseUrl` says where the CLI's own settings point (old clients show it on the Official row).
- Bad: a watcher that rewrites the file when it changes (ADR 0004: never overwrite silently).

### 6. Tests Required

- Pure: `inspectClaudeSettings` / `inspectCodexConfig` cases in the patch tests (owned vs other keys, deleted file, WebSearch entry only when added, every table field, legacy profile, base URL resolution).
- Daemon: modified → re-apply → clean; modified → Official restores originals; `cliBaseUrl` in Official only; socket listener reports `gatewayUnavailable` and refuses turn-on; `runningSessionCount` counts two Claude agents and not the Codex one, and drops after `archiveAgent`.
- App: `agent-settings.test.ts` (switch blocked by `gatewayUnavailable` or no usable endpoint, never while on).
- Protocol: payload parses with health/cliBaseUrl/runningSessionCount/gatewayUnavailable and without them.

### 7. Wrong vs Correct

#### Wrong

```ts
// A host condition squeezed into file health: the app can't tell it from a broken settings.json,
// and the refusal error carries a different code than the list.
health.push({ code: "gateway_requires_tcp", message });
throw new ApiEndpointRequestError("gateway_unavailable", message);
```

#### Correct

```ts
return { ...result, gatewayUnavailable: this.gatewayUnavailable() }; // { code, message } | null
throw new ApiEndpointRequestError(issue.code, issue.message); // same code as the list
```

## Scenario: retiring a timeline notice the daemon used to add

Reference: the API endpoint mode notice, added in api-endpoint ticket 08 and removed in api-endpoint-auto-switch ticket 11. Sessions no longer remember the mode they were created in: the gateway routes by model name, and when no endpoint can serve a request the agent shows the wrapped error in the conversation.

### 1. Scope / Trigger

- A daemon-authored `notification` field is no longer produced, but the protocol has to keep parsing it and timelines already persisted on disk still carry it.

### 2. Signatures

- Wire, kept and never sent: `notification.apiEndpointModeMismatch?: ApiEndpointModeMismatch` (`protocol/src/messages.ts` timeline union, `protocol/src/agent-types.ts`, `ApiEndpointModeMismatchSchema` in `protocol/src/api-endpoint/rpc-schemas.ts`). The server's own `AgentTimelineItem` (`agent-sdk-types.ts`) no longer has the field.
- Gone: `StoredAgentRecord.apiEndpointId`, `ManagedAgentBase.apiEndpointId`, `ApiEndpointModeSource`, `AgentManagerOptions.apiEndpointMode`, `buildApiEndpointModeNotice`, `ApiEndpointService.endpointName`, and the `options.apiEndpointId` argument of `resumeAgentFromPersistence`.
- App: `reduceTimelineEvent` in `app/src/types/stream.ts` returns the state unchanged for a `notification` carrying `apiEndpointModeMismatch` (tagged `COMPAT(apiEndpointGateway)`).

### 3. Contracts

- Resume does not compare or record any host mode; nothing is queued or appended after `hydrateTimelineFromProvider`.
- A record file written by an older daemon with `apiEndpointId` still loads: `STORED_AGENT_SCHEMA` is a plain `z.object`, so the key is stripped on read and dropped on the next write. No migration.
- A notice an older daemon already appended to a durable timeline (or a v0.15 host still sends) is not shown by the new app.

### 4. Validation & Error Matrix

- Record with `apiEndpointId` naming a deleted endpoint → loads, resumes, no notification, a prompt completes.
- Timeline row with `apiEndpointModeMismatch` → dropped by the app reducer; other notifications render `message` as before.

### 5. Good/Base/Bad Cases

- Good: drop the producer, keep the optional wire field with a comment saying it is no longer sent, filter legacy rows at the one reducer that turns timeline items into stream items.
- Base: old app against a new daemon → never receives the field, renders nothing new.
- Bad: removing the field from the protocol schema — an old daemon's message then fails to parse in a new app.

### 6. Tests Required

- Daemon E2E (`api-endpoint-claude.e2e.test.ts` "a resumed agent session says nothing about the API endpoint mode"): a new record has no `apiEndpointId`; a record patched with the id of a deleted endpoint, after a restart, has no notification and finishes a prompt.
- App (`types/stream.test.ts` "drops the API endpoint mode notice an older host left in the timeline"): hydrating such a row yields `[]`.

### 7. Wrong vs Correct

#### Wrong

```ts
// Stops parsing what an older daemon sends.
z.object({ type: z.literal("notification"), level, message }).strict();
```

#### Correct

```ts
// v0.16 起 daemon 不再发送；字段留着让老消息照常解析。
apiEndpointModeMismatch: ApiEndpointModeMismatchSchema.optional(),
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
- Filled only when `entry.source === "builtin"` and the catalog probe succeeded; `error`, `unavailable`, disabled, custom and ACP entries omit it. A plugin-registered provider (Muse Code, Antigravity from the built-in plugins) is `custom` too — `createGeneration` marks every id in `pluginProviders` that way — so it never carries `version`, never appears in `provider.version.check` results, and `provider.upgrade` answers `unsupported`. When its command is off PATH the entry is `error` (`<cmd> not found on PATH`), not `unavailable`: the refresh's first step calls `getCatalogCacheKey`, which the plugin runtime resolves through `resolveLaunch()`, and that throws before `isAvailable()` is ever asked.
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
- Same shape, page-driven: `provider.api_endpoint.vendor_status.request` (`api-endpoints/vendor-status.ts`). The client asks only while the API endpoints or usage page is mounted (react-query `refetchInterval`, 5 min); the daemon caches each page 5 min, failures included, and reads nothing while `isModelsDevAutoUpdate()` (the price table switch) is false. `createTestPaseoDaemon` merges `vendorStatusUrls` over loopback defaults, so a test that overrides one vendor never sends the others to the real pages. The page is parsed as leniently as magpie's `json.Unmarshal` (component and incident fields `.nullish()`; only a missing `components` is unreadable), so one malformed incident never hides an outage. Incident links are kept only when http(s), as magpie's `/api/open` opens only those; the app opens them through `openExternalUrl`. A notice also shows on the Claude Code / Codex plan usage cards (magpie `markUpstream`). Known, not this ticket: the usage page's own cards overlap at 390 and its heatmap month labels collide at 1280 — left for ticket 30's visual pass.

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

### Background refresh on a timer: record the attempt before the request

The daily model-list refresh (`api-endpoints/catalog-refresh.ts`, ticket 11) is the exception to "no timer": it sends the user's key upstream on its own, so a loop bug costs requests. It follows magpie `autolist.go`:

- It checks every minute. An endpoint is due when its last fetch is over a day old. After a failed attempt it waits `min(15 min, refresh interval)` before trying again.
- Record the attempt time **before** calling the fetch, and clear it only on success. If you write it after the fetch returns, an unexpected throw (a catalog write hitting `EACCES`) records nothing, and the endpoint is asked again every minute with its key.
- Each endpoint is its own boundary (`refreshOne`): an unexpected error is logged at `error` and counted as a failure, so the endpoints after it in the same pass still refresh. Upstream failures come back as the `"failed"` outcome, not a throw.
- Clock and timers are injected, and the test daemon reaches only loopback (`reachesUnasked`). Test: a refresh that throws is not retried inside the retry interval, and the next endpoint in the same pass still refreshes.

## Scenario: a request that runs a command on the host

Example: `provider.upgrade.request`, which runs a built-in CLI's own upgrade subcommand (`claude update`, `opencode upgrade`, …), or, for Codex and a Homebrew-cask Claude Code, the official upgrade for the way it was installed.

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
- Homebrew cask rule, shared by Codex and Claude Code (`findHomebrewCask({ realPath, platform, caskNames })` → `{ prefix, cask } | null`): macOS only, prefix `/opt/homebrew` or `/usr/local`, real path starts with `<prefix>/Caskroom/<cask>/` for one of `caskNames`. Command: `<prefix>/bin/brew upgrade --cask <cask>` (absolute brew, the matched cask name).
- Claude Code: `claude update` under a Homebrew cask prints "managed by Homebrew" and exits 0, so the service also passes the real path for `claude`. A match on `claude-code` or `claude-code@latest` runs that cask's brew upgrade; anything else (not macOS, outside the Caskroom, another cask name such as `claude-code-beta`, replace mode starting an interpreter whose real path is `node`) runs `claude update` with the usual replace/append argv handling. WinGet, apk and mise installs are not detected; they surface as `version_unchanged`.
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
- Base: `claude update` prints `Claude is managed by …` and exits 0 for an install nothing detects (WinGet, apk), version stays `2.1.280` → `version_unchanged` with that output; the App shows its own title over the output, and an older App shows "Upgrade failed" plus the raw `error`.
- Good: Claude Code at `/opt/homebrew/Caskroom/claude-code@latest/2.1.280/claude` → runs `/opt/homebrew/bin/brew upgrade --cask claude-code@latest` (verified on a real install 2026-10-08, 2.1.280 → 2.1.293). Homebrew casks trail npm by hours; in that window the result is `version_unchanged`.
- Bad: waiting on `close` — `claude update` exits but its background helper holds the pipe, the request never answers, and every later upgrade of that provider gets `in_progress` until the daemon restarts.

### 6. Tests Required

- Unit `provider-upgrade-command.test.ts`: each provider's subcommand; replace argv kept; append args dropped; custom / ACP ids unsupported; Claude cask (`/opt/homebrew` + `claude-code@latest`, `/usr/local` + `claude-code`) → exact brew argv, and `claude update` off macOS, outside the Caskroom, under another cask, and for a replace-mode interpreter; every row of the Codex table (macOS / Linux / Windows standalone with `codexHome`, both Caskroom prefixes, npm under Homebrew node / official installer / nvm / Windows package and shim with the exact `prefix`, Store, bun, pnpm, formula, hand-placed, interpreter) and the exact command + `env` per method; tail clipping.
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

## Scenario: fetch_models and test_connection by base URL and request format

Reference implementation: api-endpoint-auto-switch ticket 09 (`ApiEndpointService.fetchModels` / `testFormat` / `keepCatalog` in `server/api-endpoints/service.ts`, `pickProbeModel` / `probeUpstreamFormat` in `upstream-detect.ts`). The endpoint detail page asks per address; old clients keep asking per provider.

### 1. Scope / Trigger

- Request contract change on two existing RPCs plus two new optional fields on `ApiEndpoint`, and a new field persisted in `endpoints.json`.

### 2. Signatures

- `fetch_models.request` adds `format?: string`. `test_connection.request` adds `format?: string` and makes `modelId` optional.
- Unsaved form values (endpoint-management-ux ticket 10): both add `templateId?` / `region?` (the form's template; given → used instead of the saved endpoint's, unknown → `invalid_input`); `fetch_models` adds `preview?: boolean` (with `endpointId` it only borrows that endpoint's key, nothing stored); `test_connection` adds `modelIds?: string[]` (the form's models then its fetched list; given → picked from instead of the saved endpoint's). `detect_formats.request` adds `modelId?` (asked on every format, no listing) and `modelIds?` (the form's picked models, first 30, picked per format before listing); each result adds `durationMs?` and `modelId?`. `detect_formats.request` adds `eachModel?: boolean` (ticket 21, magpie `DetectModels`): `modelIds`' first 30 each asked once on every format by `detectEachModel` in `detect-models.ts` — 8 at a time, 12 s per request, 2 min in all (`DETECT_EACH_DEFAULTS`, overridable as `detectEach`, timers shared with `modelTestTimers`, pool shared with test models via `runPool`); image models listed but not asked; disabled models are asked, by this and by the single detection (magpie's detection never checks Disabled models — only Test models and the gateway do). A reason the daemon decides carries `code` + `params` on the cell (`upstream_timeout` {seconds}, `batch_timeout`, `not_asked`, `image_model`; single detection too: `no_model_to_try`, `models_list_failed` {detail}, `upstream_unreachable` {detail}, `wrong_shape` {format}) and the app words it; upstream text stays in `message` uncoded; `message` stays the English original. The cap is `API_ENDPOINT_DETECT_MAX_MODELS` in protocol. The response adds `models?: { modelId, results }[]` and `results` becomes, per format, the first model that answered (else the first model's). No models → `invalid_input`. The client waits 140 s for it. `save.request` adds `catalog?: ApiEndpointModel[]`.
- `ApiEndpoint` adds `catalog?: { fetchedAt: string; models: ApiEndpointModel[] }` and `manualModels?: ApiEndpointModel[]`; `save.request` adds `manualModels?`.
- Service: `fetchModels(provider, { endpointId?, baseUrl, apiKey?, format? }, signal)`; `testConnection(provider, { ..., modelId?, format? }, signal)` routes to `testFormat(format, input, signal)` when `format` is set.

### 3. Contracts

- `format` set → `provider` is ignored; listing headers follow the format (`anthropic_messages` → Bearer + `x-api-key` + `anthropic-version`, OpenAI formats → Bearer only, via `providerWithListingHeaders`). No `format` → the old per-provider behaviour, read-only.
- `fetch_models` with `format` **and** `endpointId` (and no `preview: true`) succeeds → the list is stored as that endpoint's `catalog` with `fetchedAt = now`, inside the mutation queue, writing only `endpoints.json` (no CLI, catalog or token change). A failed fetch leaves the stored catalog alone; an endpoint deleted meanwhile is not written back.
- `test_connection` with `format`: model = `modelId`, else `pickProbeModel` over `modelIds` when given, otherwise the endpoint's selected models then its catalog; nothing picked → the template's built-in list when it has no list endpoint (Bedrock), else one upstream listing. Bedrock candidates are filtered by `modelFormatsAt`; an Azure template's OpenAI addresses go through `templateBaseUrl` first, as on save. The probe is `probeUpstreamFormat` (same path, body and shape check as auto-detect). Result codes inside `result.error`: 401/403 → `auth_failed`; no response → `upstream_unreachable` with `status: null`; anything else → `upstream_error`. A rejected listing returns `auth_failed` / the listing code without probing.
- `save`: `manualModels` given (even `[]`) replaces the endpoint's list; omitted keeps it (the connection dialog and old clients omit it). `catalog` given (the add dialog's fetched list) is stored with `fetchedAt` = save time; omitted, `buildEndpoint` carries the existing one (or the duplicated endpoint's) over.
- Routing, the Codex model catalog and `usableModels` read only `models`; `catalog` and `manualModels` exist for the detail page.

### 4. Validation & Error Matrix

- Unknown `format` → `invalid_input`. No key and no saved key → `invalid_input`, nothing sent. Cancel → `cancelled` (top-level `error`, `result: null`).

### 5. Good/Base/Bad Cases

- Good: endpoint with Anthropic + Responses addresses, models `[gpt-5, claude-sonnet-4-5]` → Anthropic probe asks `claude-sonnet-4-5`, Responses asks `gpt-5`.
- Base: nothing selected, no catalog → `GET <base>/v1/models` then one probe.
- Bad: persisting the catalog from an old client's provider-mode fetch — the old form expects `fetch_models` to be read-only.

### 6. Tests Required

- `daemon-e2e/api-endpoint-models.e2e.test.ts` ("by base URL and request format"): catalog kept with `fetchedAt`; OpenAI format sends no `x-api-key`; failed fetch keeps the old catalog; `manualModels` survive a save that omits them and the catalog survives a connection edit.
- `daemon-e2e/api-endpoint-test-connection.e2e.test.ts` (same describe name): per-format model pick, `auth_failed` on 401, list-then-probe with nothing selected, 404 in another format → `upstream_error`.
- `messages.api-endpoint.test.ts`: endpoint with `catalog` / `manualModels`, save with `manualModels`, both requests with `format` and no `modelId`.

### 7. Wrong vs Correct

#### Wrong

```ts
// A fetch without endpointId (trying an unsaved address) has nowhere to store the list.
if (input.format !== undefined) await this.keepCatalog(input.endpointId!, models);
```

#### Correct

```ts
if (format !== null && input.endpointId) await this.keepCatalog(input.endpointId, result.models);
```

- Default thinking wire fields (cli-wiring-web-search ticket 20), all optional, old daemons neither send nor read them: agent settings and `set_agent_settings` carry `defaultThinkingOptionId: z.string().nullable().optional()` (null = unset, omitted = unchanged) and `usesUltraCode: z.boolean().optional()` (Claude Code only); `ProviderSnapshotEntry.lockedThinkingOptionId?: string` is present only when every session of that provider runs at one level (Claude Code default thinking max). Responses report the clamped Claude level, not the stored one. The app hides the default-thinking row when the model groups carry no `thinkingOptions` (old daemon) — tagged `COMPAT(apiEndpointCliWiring)`.

### Request headers, extra body and key header (endpoint-management-ux ticket 22, magpie `account.go:211-258`, `extrabody.go`, `authheader.go`, `test.go:464-466`)

- Endpoint fields (optional, one shared protocol `ApiEndpointRequestExtrasSchema` spread into every wire/input type): `headers` (name → value, empty values kept), `extraBody` (JSON object), `keyHeader` (`both` default | `x_api_key` | `bearer`), narrowed to the union once in the session layer.
- One exit: every upstream request — gateway passthrough and translated, count_tokens (headers only, never the extra body), test connection, detection (single and per-model), fetch models (save-time and daily refresh), test models (plain and CLI-style) — gets its headers from `signedHeaders`. User headers are written after Osuna's, same name case-insensitive replaces; `anthropic-beta` merged and deduped, the CLI's own values first. A user-set auth header disables ADR 0008's two-header → one-header retry.
- Key header (`keyHeadersAt`, `request-extras.ts`): an anthropic.com host or Bedrock always gets `x-api-key` alone (magpie); otherwise the user's choice applies on third-party Anthropic addresses only and the form shows the choice only there.
- Extra body (`withExtraBody` / `withExtraBodyText`): Messages, Chat, Responses, direct and translated; the 10 reserved fields, `!` force-override, fill-only-missing, `${sessionId}` at any depth (session header list, ≤128 chars, else derived from the first user message so every turn of a conversation matches; tests and detection use `osuna-test-` + random) as magpie. Empty extra body returns the body untouched before any parse (byte-exact passthrough keeps its cost). Fields an upstream refused are recorded per endpoint, model **and format** and stripped on later requests of that format (more than magpie, which does it on Anthropic only, so a refused field isn't re-added on every retry). Saving with a reserved field is refused (code + params) and the form warns in place.
- Invalid header names/values (not an RFC 9110 token; a value with line breaks, control characters or anything outside Latin-1 such as Chinese) are saved as magpie does; the form warns, and each request reports `invalid_header` (code + params) without sending; the gateway treats it as a failed attempt (502 `other`, normal cooldown) and fails over.
- Secrets: user header values are redacted wherever the key is (`redactKey` / `extractErrorDetail` take the secrets list) — an upstream echoing the user's `Authorization` never reaches a response or an agent error. Raw headers go to the client in the endpoint list for editing (magpie `providerJSON` does the same); the key never does.
- Template-suggested headers (ticket 06 data) show as "Suggested" one-click adds, distinct from "Add header".

### Skip certificate check (endpoint-management-ux ticket 23, magpie `insecure_tls.go`, `netproxy/unchecked.go`)

- `insecureTls?: boolean` sits in `ApiEndpointRequestExtrasSchema`, so the endpoint, save and the three unsaved checks carry it like the headers; the server's `RequestExtras` turns it into `uncheckedHosts` (`uncheckedHostsOf`: `host:port` of the endpoint's own https addresses, `isHttpsUrl` from protocol, empty unless on and `templateId` is empty). Unsaved checks take the form's value over the saved one, and the form's addresses over the saved ones per format (`formAddressesOver`, magpie `typed`): an address the form replaced is checked again.
- One decision, `skipsCertificateCheck({ url, uncheckedHosts })` in `insecure-tls.ts`, used by both upstream transports. The fetch paths (fetch models save-time and daily, test connection, detection, test models) call `upstreamFetch`: checked hosts use the global fetch; unchecked ones use npm undici's own `fetch` with an undici `Agent` from the same package (never hand an npm undici dispatcher to Node's fetch: Node 22 bundles undici 6), one agent per set of unchecked hosts (cap 32), so a redirect to another of the endpoint's hosts stays unchecked and one elsewhere is checked. Callers read the reply through `UpstreamResponse` (`text()` or `chunks()`), which both fetches satisfy. `commit` closes the agents of hosts no longer unchecked (addresses changed, switched off, endpoint off or deleted); `dispose` closes all. Known small window: `Agent.close()` waits for in-flight requests, but a fetch reaching a redirect hop after the close fails once with "fetch failed", and a long operation that computed `uncheckedHosts` before the change (daily refresh, paged model listing) can rebuild an agent for a replaced host for that one request; that agent is only closed at the cap or a later release of the same host. The gateway's `sendOnce` passes `rejectUnauthorized: false` (the global https agent keys pools by it, so checked and unchecked sockets never mix). Never `NODE_TLS_REJECT_UNAUTHORIZED`, never a global dispatcher.
- Save with it on for a template endpoint → `insecure_tls_template` (params `template`), as magpie `Validate`. The daemon doesn't refuse an http-only endpoint (magpie neither); the form offers the switch only with an https address and sends `false` otherwise (magpie `onHTTPS`). Stored only as `true`; projected only when `true`.
- Tests: `daemon-e2e/api-endpoint-insecure-tls.e2e.test.ts` makes a self-signed certificate with `openssl` in the temp dir and serves HTTPS on 127.0.0.1.

### Per-model detection (endpoint-management-ux ticket 21, magpie `DetectModels` / app "Each picked model")

- `detect_formats.request` gains optional `eachModel` and `models` (`api-endpoints/detect-models.ts`): the first `API_ENDPOINT_DETECT_MAX_MODELS` (30, protocol) picked models, each asked once per format; 8 at a time, 12 s per request, 2 min overall, image-generation models skipped, unfinished ones "not asked". Response `models` lists each model's per-format result; `results` per format is the first model that answered, else the first model's. Results arrive together at the end (magpie has no per-row progress). Shares the pool / deadline / timers with test models; cancel is the detect cancel.
- Detection (single and per-model) **asks disabled models** — magpie's detect never checks `ModelDisabled`; only test models and the gateway skip them (prd 27 / 72).
- Every reason the daemon writes itself is an error code + params, localized by the app (single detection too: no model to ask, no models listed, unreachable, timeout, not an X response); upstream text is shown as-is.
- "Use these": on an existing endpoint only, a model that answered on exactly one format of two or more asked gets that format as "Use only this format" (saved with the form); a new endpoint gets none (magpie `give = p ? … : []`).
- `apiEndpointManagement` and `eachModel` ship in the same unreleased version, so no extra gate.

## Scenario: test models — a user-pressed batch of real upstream requests with progress

### 1. Scope / Trigger

- endpoint-management-ux ticket 19 (`api-endpoints/model-tests.ts`, magpie `internal/provider/test.go` `TestModels` / `testOne`, MIT). Every request carries the user's key, so it runs only when the user presses "Test models" or a row's "Test this" — no timer, no automatic run.

### CLI-style methods (ticket 20, ADR 0013, magpie `test_as.go` / `codexSign`)

- Methods: `plain` | `claude_code` | `codex` (`CliTestClient` and the per-CLI rules live in one table, `CLI_TEST_POLICIES` in `api-endpoints/test-as.ts`: formats, needs-a-sample, relay-only). The list response's optional `testsAs` says which a given endpoint offers; the app narrows the wire string to the literal union once.
- Samples: `api-endpoints/cli-header-samples.json` (0600, atomic, rewritten only on change). Headers only, never a body; magpie's strip list (`claudeCodeHeader` / `codexClientHeader` filter then `shapeHeader`) plus cookie: no auth, session, thread, request id, cookie, `anthropic-beta`; no sample without a User-Agent. Claude Code's sample is taken right after the gateway reads the model, before routing (magpie `gateway.go:1372-1380`) — a disabled-model 403 or a missing route still leaves one. Codex's is taken when it goes to Responses or Chat.
- `claude_code`: Anthropic only; only endpoints whose template group is relay service or that were added as custom, and never a vendor's own API (`isVendorApi`: anthropic.com, googleapis.com, Bedrock, Azure — by preset or host). No sample → `sampleMissing`, no request, reason says to use Claude Code with one of these endpoints once (copy never names the gateway — glossary "Gateway").
- `codex`: Responses, else Chat, any address; `store: false` on Responses. No sample → headers built as magpie `codexSign`, version = newest of built-in, `models_cache.json`, the local CLI, and the version seen through the gateway. Local CLI version follows magpie `proc.Version`: read the npm package first, run the binary (`probeCodexVersion`) only if that fails, never run the same executable (path + size + mtime) again after a failure (magpie #864, macOS malware prompt each run), concurrent lookups share one process. Known difference: a timeout also counts as failure (magpie retries) because `probeCodexVersion` can't tell them apart. A failed system-name lookup is not cached.
- Stream read to the first content or error, 1 MB cap (magpie test.go:564-611).
- Gateway fix found here: a Codex request translated to Chat carries the Codex identity headers as magpie `forwardOnce` does (gateway.go:3729-3737); `authorization`, `chatgpt-account-id`, cookies never reach the upstream (e2e asserts both).
- Menu: an unavailable method stays in the row menu, not clickable; only icon and title dim, the reason keeps full `foregroundMuted` and is never truncated.

### 2. Signatures

- `provider.api_endpoint.test_models.request { requestId, endpointId, modelId?, method? }` → pushes `test_models.started { requestId, modelIds }`, then one `test_models.progress { requestId, result, done, total }` per finished model, then `test_models.response { requestId, results, error }`. Cancel with the existing `provider.api_endpoint.cancel` by `requestId`.
- `method` is a loose string; `API_ENDPOINT_MODEL_TEST_METHODS = ["plain", "claude_code", "codex"]`. A daemon rejects a method it doesn't know with `invalid_input`.
- CLI methods (ticket 20, ADR 0013, `test-as.ts` / `cli-header-samples.ts`): `ApiEndpoint.testsAs?: { method, unavailable: { code, message } | null }[]` lists what the endpoint offers — `codex` with a Responses or Chat URL, `claude_code` with an Anthropic URL on a relay-group template or "Custom", and not a vendor's own API (Bedrock / Azure template or host, Anthropic URL on `anthropic.com` / `googleapis.com`). Per-CLI rules live in one table, `CLI_TEST_POLICIES` in `test-as.ts`. A method not offered → `invalid_input`, nothing sent. No Claude Code sample → every model `cli_sample_missing`, no request. No Codex sample → magpie `codexSign` headers, version = newest of built-in `0.159.0`, Codex's `models_cache.json` `client_version`, the installed CLI (`InstalledCodexVersion` in `codex-cli-version.ts`, magpie `proc.Version`: npm `package.json` or Windows shim first, else one `probeCodexVersion` run; a run with no version is not repeated until the executable's path, size or mtime changes; concurrent lookups share one run; the service caches 10 min; tests always fake it) and the newest version seen on the ChatGPT backend path (`SeenCodexVersion`). One attempt only, on the CLI's format (pins ignored), body `stream: true` (+ `store: false` for Codex on Responses), sample headers over Osuna's, the endpoint's key on top; a 2xx stream is read to its first content event or error (`streamAnswer`).
- The gateway writes the sample (`CliHeaderSamples.saw`): Claude Code as soon as a `/v1/messages` request from `claude-cli/` has its model read, before routing (a disabled model or a 404 still leaves it); Codex in `askOnce` when the attempt goes to Responses or Chat, where a translated attempt also carries Codex's identity headers (`codexIdentityFor` → `attemptTranslated({ clientIdentity })`). Unchanged samples are not rewritten (memory cache per gateway), so a test that deletes the file must send different headers to get it back.
- `MODEL_TEST_DEFAULTS = { concurrency: 4, modelTimeoutMs: 20_000, batchTimeoutMs: 180_000 }`; `ModelTestClock { now, timers }` is injected (tests use manual timers).

### 3. Contracts

- Result: `{ modelId, ok, format | null, status | null, durationMs, error | null }`. `format` null = no request sent; `status` null = no response. `error.message` is the upstream reason only — no request URL, no status prefix (stripped daemon-side).
- `error.code`: `model_disabled` (params model, pattern), `auth_failed`, `upstream_error`, `upstream_unreachable`, `upstream_timeout` (params seconds — the UI interpolates it, never hardcodes 20), `batch_timeout`, `no_format`.
- Each model: "hi", reply cap 16 in that format's own field (Responses `max_output_tokens`). Formats tried one after another: formats the catalog lists for the model first, else Anthropic first for a Claude model, then the endpoint's addresses in order (magpie's pick, accepted as "依次试"); "Use only this format" tries only that one. First answer wins; all fail → the **first** format's reason, even if a later one timed out.
- `started.modelIds` is the daemon's real plan (after `retiredModels.listed`; disabled ones included and recorded as disabled without a request). The client marks only those "Testing…".
- Results live in page memory only; leaving the page drops them and cancels a running batch (unmount → cancel; a cancel failure there goes to `console.error`, nowhere else to show it).
- Gated on `apiEndpointManagement`; the view's gate carries `COMPAT(apiEndpointManagement)`.

### 4. Validation & Error Matrix

- Unknown endpoint / unknown method → response `results: []`, `error` set, no upstream request.
- Disabled model → `model_disabled`, no request, no duration shown.
- No address can serve the model → `no_format`, no duration.
- Per-model total over 20 s → `upstream_timeout`, stop trying other formats.
- Batch over 3 min → every unfinished model `batch_timeout`.
- Cancel → no new requests; response carries finished results and a cancelled error.
- Client cancel: only `DaemonConnectionError` with `code === "DAEMON_CONNECTION_LOST"` is ignored (the daemon cancelled with the connection); a request timeout or anything else is shown as the batch's failed state.

### 5. Good/Base/Bad Cases

- Good: 5 models, 4 in flight at most, rows fill in one by one, summary "4 tested · 1 failed" (only the failed count in error tone).
- Base: "Test this" on one model → one started/progress/response with that model.
- Bad: marking every catalog model "Testing…" from the client's list — a model retired this week then sits at "Testing…" and the total jumps.

### 6. Tests Required

- Daemon e2e `daemon-e2e/api-endpoint-test-models.e2e.test.ts` (loopback fake upstream, manual timers): concurrency ≤ 4, per-model progress, failures, single and batch timeout, a later format's timeout keeps the first reason, cancel sends nothing more, disabled sends nothing, only-this-format.
- Browser `settings-api-endpoints.spec.ts`: batch, single, cancel, both filters, leaving clears results, leaving mid-run aborts the in-flight upstream requests and sends no more.
- App unit `internal/model-tests.test.ts`: summary, duration only when a request was made, reason line text.

### 7. Wrong vs Correct

#### Wrong

```ts
// 复制出来的不是上游原文
reason.replaceAll("-", "‑");
// 吞掉所有取消错误
void client.apiEndpointCancel(id).catch(() => undefined);
```

#### Correct

```tsx
// 文字照原样，Web 上用样式不让模型名折行
<Text selectable>{reason}</Text>
// 只放过连接已断
const isConnectionGone =
  error instanceof DaemonConnectionError && error.code === "DAEMON_CONNECTION_LOST";
if (!isConnectionGone) throw error;
```

## Scenario: import endpoints from other apps (endpoint-management-ux ticket 26, magpie `importapps.go` / `import_codex.go` / `import_opencode.go`, ADR 0013)

- RPCs: `provider.api_endpoint.import_scan` and `provider.api_endpoint.import` (`daemon.manage`, gated on `apiEndpointManagement`; code is `api-endpoints/import-apps.ts` + service `scanImports` / `importOne`).
- Sources, read from the daemon's host only: CC Switch `cc-switch.db` (else `config.json`), Claude Code `settings.json` (while Osuna owns it, the ADR 0004 recorded originals — the gateway itself is never offered), Codex `config.toml` plus `model_catalog_json`, Alma `chat_threads.db`, OpenCode `auth.json` (read only when the dialog asks). Gemini is skipped until sub-task 7. Paths are test seams; the test daemon and the browser spec point them, HOME and XDG dirs at temp dirs — no test ever reads the real files.
- Read-only: SQLite through `process.getBuiltinModule("node:sqlite")` with `{ readOnly: true }`, nothing written; SQLite may still take shared locks and touch `-wal` / `-shm`. Missing `getBuiltinModule` / `node:sqlite` → that source reports `no_sqlite`; only node:sqlite's `ExperimentalWarning` is suppressed, and only around that call. Per-source reasons: `unreadable` (incl. permission / CANTOPEN), `busy`, `not_database`, `not_json`, `no_providers_table`, `no_sqlite`.
- Scan returns name, per-format addresses, masked key, models, source, status (`new` / `added` / `name_taken` / `other_key`, settled as magpie `settle`, request headers compared) and a fingerprint = HMAC-SHA256 with a random secret persisted 0600 (a client can't test guessed keys; it stays the same across restarts so ignored entries are recognised — see persistence.md). A fingerprint the daemon no longer finds (the app's file changed) → the UI says the scan is out of date and rescans. Key originals never leave the daemon.
- Address only on a template's host (not an exact template address): keep the template id / icon / catalog (and region when it matches), keep the address as given (magpie `importapps.go:384-388`).
- Import goes item by item like magpie: stop at the first error, keep what landed, return `imported` plus `failed` (code + params) for any error (a write failure is `import_failed`); the UI refreshes, toasts the added ones and keeps the dialog open on the failed one. Actions: add / replace (keeps id, slug, order, ends enabled) / rename-then-add; an empty rename means not renamed; a name-taken item that is also another key of the same endpoint is preselected as "add a new one".
- UI: one section per app with its importable count, "–" plus the reason when not found or unreadable; select-all from one item; switches, not checkboxes; rename and keep-both/replace dim while the item's switch is off; the masked key never breaks.
- The prompt (ticket 27, magpie `GET /api/importapps/discovery`, `discoverLocalProviders`): `provider.api_endpoint.import_discovery` returns `{ fingerprint, sourceId, source }` for entries the dialog would preselect (`isPreselectedImport` in protocol `api-endpoint/import-offer.ts`, shared with the app's `initialImportPicks`) minus `ignoredImports`; never OpenCode. The daemon reads and settles at most once a minute (`DISCOVERY_READ_INTERVAL_MS`, injected `now`) and keeps only the candidates, never keys; a `commit` that changes endpoints or keys, an import, and the dialog's own scan replace or drop it (the browser spec calls `import_scan` after writing fake sources). `provider.api_endpoint.import_ignore` takes 64-hex fingerprints only (`invalid_input` otherwise), merges them into `ignoredImports` through `commit`, keeps the newest 500, and does not prune ones not seen now (magpie keeps them too). Its failures are `import_ignore_failed` with `params.reason`; the app words every failure itself and never shows the host's message. Review opens Import with only the prompt's fingerprints picked; a failed discovery shows no prompt; a failed Ignore keeps it with the reason.
- Discovery prompt (ticket 27, magpie app.js:9846-9903, `gui/importapps.go:29-48`): `provider.api_endpoint.import_discovery` / `import_ignore` (`daemon.manage`). Runs on opening the API endpoints page, OpenCode excluded; the other apps' files are really read at most once a minute (injected clock), the cache keeps only fingerprints and sources and is dropped when stale or after an import. Offered = what the import dialog would preselect (one shared rule in protocol). The bar always sits at the page top (prd 42 says so; magpie's compact variant next to the add button is not used), "View" opens the dialog with only those preselected, "Ignore" stores the fingerprints in host-wide `ignoredImports` (64-hex, capped at 500, oldest dropped; not pruned, as magpie keeps them). To survive restarts the fingerprint HMAC secret is persisted in `api-endpoints/import-fingerprint-key.json` (0600, atomic); a corrupt file is regenerated with a warn line (ignored items re-prompt), an unreadable one makes discovery `unknown`. A changed key re-prompts. Failures are code + reason, localized; a failed discovery shows no bar.
- Import links (ticket 28, magpie `importurl.go:11-160`, app.js:10139-10200, ADR 0002): only the desktop app receives `paseo://import?…`; the main process hands it to the focused window (opening one if needed, holding it until the renderer is ready); Agent links are untouched and the link is never logged. Nothing is added without the confirm dialog: `provider.api_endpoint.import_link_preview` parses and stores nothing, `import_link_icon` fetches the `icon=` picture separately so the dialog opens at once (magpie: "the dialog being open is the confirmation"; explicit `icon=` beats preset / `catalog=` icon, kept in memory, stored only when the add succeeds), `import_link` re-parses and re-validates in the daemon (`daemon.manage`). Rules as magpie: https only, http for loopback / LAN (incl. IPv4-mapped IPv6, `utils/local-host.ts`); no userinfo, non-empty query or fragment (an empty `?` / `#` is accepted and stripped); key ≤ 4096 bytes, no control chars; name cut to 80 bytes byte-safely (again after a " 2" rename); ≤ 200 models (extra dropped); unknown preset, Vertex, no address, only a Gemini address (until sub-task 7) are refused with `import_link_refused` + reason + params, never the key. Replace target = magpie `Find(id)`: same id, then an existing name equal to the link's id — never the link's name alone. `catalog=` picks the vendor icon via template `modelsDevIds` (`IconForCatalog`); facts have no field. Tests: the test daemon and the browser-test daemon both take a `fetchSite` seam that throws by default.

## Scenario: when an endpoint's balance is read (endpoint-balance ticket 03, magpie `provider/quota_asked.go`, `balance.go` `KeyBalances` / `ForgetBalances`)

### 1. Scope / Trigger
- New RPC, a new optional request field pair and a host-wide setting in `endpoints.json`; the client and the daemon must agree on which reads are the user's.

### 2. Signatures
- `provider.api_endpoint.read_balance.request { endpointIds, asked?: boolean, force?: boolean }` (`daemon.read`).
- `provider.api_endpoint.set_balance_auto_refresh.request { enabled: boolean }` → `.response { requestId, error }` (`daemon.manage`, service `setBalanceAutoRefresh` through `commit`).
- List payload `balanceAutoRefresh?: boolean`; stored as `balanceAutoRefresh: false` only when off. All under the `apiEndpointBalance` capability.
- Service `readBalances({ endpointIds, asked, force, signal })`; `readEndpointBalance({ …, signal, deadline })`.

### 3. Contracts
- `keptBalances` (service memory, empty at start): endpoint id → `{ reading, at }`. A read within `BALANCE_KEPT_MS` (60 s, injected `now`) of `at` returns the kept reading; `force` skips it. `save`, `delete` and an import that replaces an endpoint drop that id. Every result is kept, failures too.
- Switch off (`state.balanceAutoRefresh === false`) and neither `asked` nor `force`: send nothing; return the kept reading however old, else `notAskedReading` = `failed`, `reason: "temporary"`, `hint: "not_asked"`, `readAt: null` (magpie `errNotAsked`); with a last reading on disk that reading answers instead, `stale` = the not-asked failure (ticket 04, below).
- Timeouts: 15 s per request (`BALANCE_READ_TIMEOUT_MS`), 30 s for the whole RPC (`BALANCE_PAGE_TIMEOUT_MS`, the `deadline` signal). A deadline abort is a `temporary` failure; a connection abort (`signal`) still throws.
- Nothing reads at startup; the switch doesn't touch the price table or the CLI logins' plan usage.

### 4. Validation & Error Matrix
- Unknown id → not in `readings`. Store unreadable → whole RPC `error`. Switch write failure → `error` from `toWireError`, the app shows it under the switch and the switch goes back.

### 5. Good/Base/Bad Cases
- Good: list and detail open together → one upstream request in the minute.
- Base: switch off, page opened → `asked: true` → reads (cache still applies).
- Bad: switch off, a timed read → no request, `not_asked` until the user opens a page or refreshes.

### 6. Tests Required
- `daemon-e2e/api-endpoint-balance.e2e.test.ts` "when the API endpoint balance is read": kept for a minute then asked again; force inside the minute; save drops it; switch default/off/restart; off + timed asks nothing; off + asked/force read, timed keeps old reading; no request at startup.
- Browser `Balance` › "auto refresh on…": counts `read_balance` frames and their `asked`/`force` with `page.clock`.

### 7. Wrong vs Correct
#### Wrong
```ts
// a timed read with the switch off still reaches the vendor once the cache expires
if (kept && isFresh) return kept.reading;
```
#### Correct
```ts
const held = state.balanceAutoRefresh === false && !input.asked && !input.force;
const usesKept = kept !== undefined && !input.force && (isFresh || held);
if (usesKept) return kept.reading;
if (held) return this.lastBalances.standIn(settings, notAskedReading(endpoint.id));
```

## Scenario: the last balance reading (endpoint-balance ticket 04, magpie `provider/quota_last.go` `keepLast` / `passing` / `keyTag`)

### 1. Scope / Trigger
- A new persisted cache file and a new optional wire field on every balance reading; the app words the reading by it.

### 2. Signatures
- `LastBalanceReadings` (`api-endpoints/balance-last.ts`), built by the service on `api-endpoints/balance-readings.json`:
  - `keep(settings: BalanceSettings, reading)`; `standIn(settings, reading) → reading`; `forget(endpointId)`.
  - `BalanceSettings = { endpoint: Pick<StoredApiEndpoint, "baseUrls" | "balance">, apiKey, balanceToken }`.
- Wire: `ApiEndpointBalanceReadingSchema.stale?: ApiEndpointBalanceFailure`.

### 3. Contracts
- File: `{ readings: { [endpointId]: { fingerprint, readAt, items, windows? } } }`. `fingerprint` = sha256 of `{ baseUrls, apiKey, balance?, balanceToken? }` (`balance` and the token only when set, so readings kept before tickets 05 and 06 still match), first 32 hex; never the key or a token.
- `keep` stores only `status: "ok"` readings with at least one item or window (ticket 08); an empty `ok` (Ollama without purchased credits) and every failure leave the previous entry alone (magpie returns early on no windows and no balance).
- `standIn` replaces a reading whose `failure.reason === "temporary"` (429, 408, 5xx, timeout, deadline, network error, and `not_asked`) with `{ status: "ok", items, readAt: <last readAt>, failure: null, stale: <this time's failure> }`. Other readings pass through unchanged.
- Invalidation is lazy: a fingerprint mismatch at `standIn` drops the entry and returns the failure; `delete` calls `forget`. Renaming or saving unchanged settings keeps it.
- In `readBalances`: fresh read → `keep` → `standIn`, except when `unsendableHeader(extras) !== null` (a settings problem; magpie's `passing` doesn't match it either). The result, stale or not, goes into `keptBalances` for the minute.
- App: `stale` with `hint: "not_asked"` → caption "Not refreshed · last read {time}" (muted); any other `stale` → "Couldn't read just now · last read {time}" (`statusWarning`, testID `api-endpoint-balance-stale`). The row needs nothing: the reading is `ok`.
- Later tickets: the token (ticket 06) is in `fingerprintOf`, the user ID rides in `balance`; ticket 06's `windows` are stored with the entry; plan windows (ticket 08) are stored the same way and get their pace recomputed when served ("a plan key's windows and their pace").

### 4. Validation & Error Matrix
- File missing → no last readings. Unreadable or schema-invalid → empty, one warn line. Write failure → warn only; the reading is still returned and memory updated.
- `token_rejected`, `wrong_url`, `no_value`, `not_offered`, unsendable header → the failure itself, no `stale`.

### 5. Good/Base/Bad Cases
- Good: read ¥110, then 503 → `ok` ¥110 with the old `readAt` and `stale.status: 503`; same after a restart.
- Base: switch off, restart, timed read → last reading with `stale.hint: "not_asked"`, no request.
- Bad: key changed, then 503 → `failed temporary`; the old key's balance is never shown.

### 6. Tests Required
- `daemon-e2e/api-endpoint-balance.e2e.test.ts`: 503 and 429 give the last reading with `stale`; it survives a restart and the file has no key; 401 has no `stale`; base URL or key change drops it, a rename does not; delete removes it from the file; switch off + restart + timed read gives it with `not_asked`.
- Protocol `messages.api-endpoint.test.ts`: a reading with `stale` parses.
- Browser `Balance` › "a temporary failure keeps showing the last reading…": stale caption, item still shown, row still shows the amount.

### 7. Wrong vs Correct
#### Wrong
```ts
// the old balance survives a key change: the next outage shows another key's money
lastBalances[endpoint.id] = { readAt, items };
```
#### Correct
```ts
this.lastBalances.keep({ endpoint, apiKey }, fresh); // stores fingerprintOf({ baseUrls, apiKey })
const reading = unsendableHeader(extras) === null ? this.lastBalances.standIn(settings, fresh) : fresh;
```

## Scenario: a balance URL the user gave, and Check balance (endpoint-balance ticket 05, magpie `provider/balance.go` `balanceRead` / `readBalanceParts` / `balanceExpr`)

### 1. Scope / Trigger
- New optional endpoint field on the wire and on disk, a new save field, a new RPC, and a pure port of magpie's balance-field parser.

### 2. Signatures
- Protocol `ApiEndpointBalanceSettingsSchema = { url?, method?, field? }` (strings); `ApiEndpoint.balance?`, `ApiEndpointSaveRequest.balance?`.
- `provider.api_endpoint.check_balance.request { endpointId?, apiKey?, baseUrls?, templateId?, balance, ...ApiEndpointRequestExtras }` → `.response { requestId, reading: ApiEndpointBalanceReading | null, error }` (`daemon.manage`, cancellable through `cancel`, gated by `apiEndpointBalance`).
- Shared `protocol/api-endpoint/balance-settings.ts`: `balanceMethodOf(raw) → "GET" | "POST" | null`, `defaultBalanceField(url) → string | null`.
- Server `balance-field.ts`: `readBalanceField(reply, field) → { kind: "items", items } | { kind: "no_value", detail }`, `numberOf`. Service `checkBalance(ApiEndpointCheckBalanceInput, signal)`.

### 3. Contracts
- Stored `balance: { url, method?: "POST", field? }`; GET and an empty field are not stored; no URL → no `balance`. Save: omitted keeps (old clients, copies take the source's), an object replaces whole, one without a URL clears.
- A `balance.url` wins over the host table: `sourceOf` returns the custom source first, so an endpoint on `api.deepseek.com` with a Balance URL never asks DeepSeek. No key → `unsupported`, nothing sent.
- Request: `GET`, or `POST` with no body; `Authorization: Bearer <key>`, `Accept`, `User-Agent: Osuna/<v>`, then the endpoint's headers with `{key}` names replaced (`KEY_NAMES`, magpie `balanceKeyNames`); in the URL the key is Go-`QueryEscape`d (space `+`). The escaped key joins the redaction secrets.
- Reply read up to 1 MiB of bytes (`readCapped` over `response.chunks()`), not characters after a full `text()`.
- Field empty → `defaultBalanceField(url)`; no default → `no_value` "no balance path: …".
- Items: `{ label: string | null, text, value, unit, ratio }`; `$ ¥ € £` → `USD CNY EUR GBP`; a `%` item has `unit: "%"`, `value` = percent, `ratio` = 0–1. A missing amount among several is `text: "—"`, `value: null` — its reason is not on the wire (PRD 21's item shape has no error field; magpie keeps it for a hover).
- Check balance: same `readEndpointBalance` with the form's values over the saved endpoint's; never touches `keptBalances` or `LastBalanceReadings`.
- Port deviations kept on purpose: a custom reply that is not JSON is `wrong_url` (PRD 16), where magpie says "the reply is not JSON".

### 4. Validation & Error Matrix
- Save or check with `method` not GET/POST (any case, trimmed) → `invalid_balance_settings`, `params.field: "method"`, nothing sent.
- Hand-edited stored method that reads as neither → `failed wrong_url`, detail magpie's sentence, nothing sent.
- Field errors → `no_value` with magpie's English sentence as `detail` (key masked).
- `check_balance` with an unknown `endpointId` → `reading: null`, `error.code: "not_found"`; aborted → `cancelled`.

### 5. Good/Base/Bad Cases
- Good: `{ url: ".../query?apikey={key}", field: "$data.left" }`, reply `{"data":{"left":"7.5"}}` → `$7.50`, URL carries the escaped key.
- Base: `/v1/dashboard/billing/credit_grants` with no field → `$total_available` → `$12.50`.
- Bad: field `data.list.*.left` → `no_value` "…several values where one is wanted…".

### 6. Tests Required
- `api-endpoints/balance-field.test.ts`: every magpie `TestReadBalancePath` / `TestBalancePathLists` / `TestBalanceParts` case, each error sentence, numbers in filters (`1e21`, `1e-7`), a `"0x10"` string staying a string, `defaultBalanceField`.
- `daemon-e2e/api-endpoint-balance.e2e.test.ts` "at an address the user gave": GET with placeholders and headers, POST no body, labels/percent/dash, three defaults, no default, missing path, known host overridden, unreachable URL masks the key, 1 MB cut → `wrong_url`, old-client save keeps / empty URL clears / copy takes, PUT refused, settings change drops the last reading; check: unsaved new endpoint, edit with saved key, no URL finds the vendor, failure reading, not kept, unknown endpoint, PUT refused.
- Protocol: save/endpoint with and without `balance`; `check_balance` request, reading and rejection.
- App `connection-form-model.test.ts` and browser `Balance` › "Check balance asks…", "…fill in its balance URL…".

### 7. Wrong vs Correct
#### Wrong
```ts
// JS Number() takes "0x10" and "0b11"; a filter on 1e21 compares "1e+21"
const n = Number(value.trim());
got = String(value);
```
#### Correct
```ts
if (!DECIMAL.test(value.trim())) return null; // what Go's ParseFloat reads
got = plainNumber(value); // FormatFloat(n, 'f', -1, 64): shortest digits, no exponent
```

## Scenario: an account's balance asked with its own token (endpoint-balance ticket 06, magpie `provider/balance.go` `keyQueryOf` / `keyNotToken` / `balanceAuthorization`, `sub2api_usage.go`)

### 1. Scope / Trigger
- A new secret beside the key (stored, masked on the wire, revealed on demand), a new RPC, new optional fields on save, check, endpoint, failure and reading.

### 2. Signatures
- Protocol: `ApiEndpointBalanceSettingsSchema` gains `userId?`; `ApiEndpoint.balanceTokenMask?`; `ApiEndpointSaveRequest.balanceToken?` and `ApiEndpointCheckBalanceRequest.balanceToken?`; failure `useUrl?`; hints `token_on_key_url`, `new_api_user_missing`; reading `windows?: ApiEndpointBalanceWindow[]` (`{ id, label, usedPct?, remainingPct?, resetsAt?, used?, limit?, unit? }` — `ProviderUsageWindowSchema`'s names written out again, because `messages.ts` imports `rpc-schemas.ts` and deriving would make a cycle).
- `provider.api_endpoint.reveal_secret.request { endpointId, secret }` → `.response { requestId, value: string | null, error }` (`daemon.manage`). `secret` is a wire string; the session checks it against `API_ENDPOINT_SECRETS` (`["balance_token"]`, ticket 10's AK/SK join it) and answers `invalid_input` for any other, then calls the per-secret service method (`revealBalanceToken`).
- Store: `keys.json` `{ keys, balanceTokens? }`; `getBalanceToken(id)`, `setBalanceToken(id, token | null)`, `removeSecrets(id)` on delete (`removeApiKey` stays key-only: import replacing a keyless endpoint keeps the token).
- Shared paths: `protocol/api-endpoint/balance-settings.ts` `NEW_API_BALANCE_QUERIES`, `SUB2API_BALANCE_QUERIES` (`{ account, key }`) and `balanceUrlPath(url)`; the daemon's `TOKEN_QUERIES`, the editor's `balanceFixOf` and `defaultBalanceField` all read them.

### 3. Contracts
- `balanceToken` on save: non-empty (trimmed) replaces, `""` clears, omitted keeps; a copy without it takes the source's. On check: omitted uses the saved one of `endpointId`, `""` means none. The editor sends a duplicate's `endpointId` on check even with a typed key, so the source's token is used.
- Token as `Authorization` (whole header): contains a space → as is; `eyJ…` with three dot parts → `Bearer <token>`; else bare. A token equal to the key (optionally `Bearer `-prefixed) counts as no token.
- With a Balance URL: the endpoint's headers go along, then `Authorization` is the token. AiHubMix with a token and no Balance URL: `aihubmix_account` (`https://aihubmix.com/api/user/self`), only `Authorization`, `Accept`, UA; `data.quota / 500000`.
- `balance.userId` → `New-Api-User` on Balance URL requests only, replacing any case variant from the endpoint's headers. Never on chat requests (it is not a header).
- Token + path `/api/usage/token` or `/v1/usage` → `failed wrong_url`, `hint: token_on_key_url`, `useUrl` = same origin + the account query, nothing sent.
- Account query without a token and without an own `Authorization`/`Cookie` header → asks `origin + prefix + key query` (query string and hash dropped); a field equal to the account default becomes empty so the key query's default applies.
- `/v1/usage` (after that rewrite) also reads `rate_limits` → windows `5h`, `1d`, `7d` in that order, `limit > 0` only, `usedPct` clamped 0–100, `resetsAt` ISO or null, `unit: "USD"`. No `remaining` and no field of the user's → one item = `max(0, min(limit − used))` USD.
- `success:false` whose message mentions `new-api-user` (any case) → `hint: new_api_user_missing` on the `token_rejected` failure.
- The token joins the redaction secrets; no log line, list, read or check reply carries it.

### 4. Validation & Error Matrix
- `reveal_secret` unknown `secret` → `invalid_input`; unknown endpoint → `not_found`.
- AiHubMix account reply `success` not true and no message → `token_rejected` "AiHubMix didn't take the access token".

### 5. Good/Base/Bad Cases
- Good: `/api/user/self` + token `abc` + userId `42` → `Authorization: abc`, `New-Api-User: 42`, `$5.00`.
- Base: `/api/user/self` with no token → asks `/api/usage/token` with `Bearer <key>`.
- Bad: token + `/v1/usage` → no request, `useUrl: <origin>/api/v1/user/profile`.

### 6. Tests Required
- `daemon-e2e/api-endpoint-balance.e2e.test.ts` (account-token tests and the AiHubMix one in "other known vendors"): header forms, header vs user ID, no user ID on test_connection's chat request, hint, both key queries refused, key-query fallback, own Authorization kept, key-as-token, sub2api windows with and without `remaining`, mask/reveal/no token in list, read, check, log (logger at `trace`) and `endpoints.json`, save keep/clear/copy, check typed/cleared/saved, token change drops the last reading and `balance-readings.json` has no token.
- Protocol: token on save/check, mask and userId on endpoint, `reveal_secret`, reading with windows and `useUrl`, older reading.
- App `connection-form-model.test.ts` "the account's balance token and user ID"; browser `Balance` › "a token beside the key's own query…", "sub2api's key query shows…".

### 7. Wrong vs Correct
#### Wrong
```ts
// the user's Authorization header wins over the token, and the token goes as Bearer always
headers = withUserHeaders({ authorization: `Bearer ${token}`, ...base }, extras);
```
#### Correct
```ts
headers = withoutHeader(withUserHeaders(base, extras), "authorization");
headers.authorization = balanceAuthorization(source.token);
```

## Scenario: Detect URL — a user-pressed guess at the balance URL (endpoint-balance ticket 07; magpie has no counterpart)

### 1. Scope / Trigger
- New RPC carrying the form's unsaved key and addresses to an address the user never typed; the only balance request that guesses, so when it may be sent is part of the contract.

### 2. Signatures
- `provider.api_endpoint.detect_balance_url.request { endpointId?, apiKey?, baseUrls?, templateId?, ...ApiEndpointRequestExtras }` → `.response { requestId, detected: { url, field } | null, attempts: { url, reading: ApiEndpointBalanceReading }[], error }` (`daemon.manage`, cancellable through `cancel`, gated by `apiEndpointBalance`).
- Server `balance.ts` `balanceSiteOf(baseUrls) → string | null`; service `detectBalanceUrl(ApiEndpointBalanceFormInput, signal)`. `ApiEndpointBalanceFormInput` is the form values shared with `checkBalance` (`formBalanceValues` resolves key, addresses and extras for both; session `balanceFormOf` copies them off either request).
- App: `ConnectionFormDeps.detectBalanceUrl`, state `balanceDetect: idle | detecting | found { url, reading } | missed { attempts } | failed { message }`, `canDetectBalanceUrl`.

### 3. Contracts
- Site = origin of the first http(s) base URL in the order Chat, Anthropic, Responses (magpie editor's `origin(draft.chat || draft.anthropic || draft.responses)`); path prefixes are dropped (see the task's `research/decisions.md`).
- Tries `NEW_API_BALANCE_QUERIES.key` then `SUB2API_BALANCE_QUERIES.key` on the site, each through `readEndpointBalance` with `balance: { url }`, `balanceToken: null`, a fresh `BALANCE_READ_TIMEOUT_MS`; stops at the first `status: "ok"`. `detected.field` is `defaultBalanceField(url)`.
- `attempts` lists every try in order (the last is the hit). Nothing touches `keptBalances` or `LastBalanceReadings`; the daemon never calls it from list, read_balance or startup.
- App on `found`: URL filled (generation bumped), method `GET`, field through `fieldAfterUsing`. `missed` / `failed` stay until pressed again or the dialog closes; closing aborts the request.

### 4. Validation & Error Matrix
- No key (typed or saved) → `error.code: "invalid_input"`, `attempts: []`, nothing sent.
- No http(s) base URL → `invalid_input`, nothing sent.
- Unknown `endpointId` → `not_found`; aborted → `cancelled` (app maps to `idle`).
- Each failed try keeps its own `reading.failure` (404 → `wrong_url`, 401 → `token_rejected`, key masked).

### 5. Good/Base/Bad Cases
- Good: new-api site answers `/api/usage/token` → one attempt, `detected.field: "$data.total_available / 500000"`.
- Base: `/api/usage/token` 404, `/v1/usage` `{ remaining: 3.5 }` → two attempts, `detected.url` ends `/v1/usage`.
- Bad: wrong key → `detected: null`, two `token_rejected` attempts.

### 6. Tests Required
- `daemon-e2e/api-endpoint-balance.e2e.test.ts` › "detecting the balance address…": new-api first try (headers, UA, nothing saved), sub2api second, neither with masked key, edited endpoint uses the saved key and never the token, no key / no site refused, never sent on list / read / restart.
- Protocol `messages.api-endpoint.test.ts`: request, found, rejection.
- App `connection-form-model.test.ts` › "detecting the balance address"; browser `Balance` › "Detect URL fills in…".

### 7. Wrong vs Correct
#### Wrong
```ts
// 填了令牌就用令牌试：两个 key 级地址只认 key，令牌在这里一定被拒（工单 06 的 token_on_key_url）
readEndpointBalance({ ..., balanceToken: this.store.getBalanceToken(id) });
```
#### Correct
```ts
readEndpointBalance({ endpoint: { id, baseUrls, balance: { url } }, apiKey, balanceToken: null, ... });
```

## Scenario: a plan key's windows and their pace (endpoint-balance ticket 08, magpie `provider/planquota.go`, `window_pace.go`, `window_holds.go` `Bounds`)

### 1. Scope / Trigger
- New outbound requests (vendor plan queries) merged into the existing balance reading, new optional window fields on the wire, and a pace the daemon owns.

### 2. Signatures
- Server `balance-plan.ts`: `PLAN_VENDOR_URLS` (spread into `BALANCE_VENDOR_URLS`, so the test daemon's dead-port default and `balanceUrls` injection cover them; Kimi Code's entries are the site, the path comes from the endpoint), `planSourceOf({ baseUrls, vendorUrls }) → PlanSource | null`, `planRequestHeaders`, `shownWindows`, `withPace({ window, span, now })`, `withPaceAt({ reading, now })`, `zhipuKeyRefusal(body)`.
- Server `window-pace.ts`: `windowStart({ resetsAt, span }) → ms | null` (span is ms or `"month"`), `paceBetween({ usedPct, start, end, now }) → number | null`, `windowPace`.
- `ReadBalanceInput.withPlan?: boolean` (only `readBalances` sets it; Check balance and Detect URL never read plans), `hasLastReading?: boolean`; `LastBalanceReadings.has(settings, endpointId)`.

### 3. Contracts
- Window (`ApiEndpointBalanceWindowSchema`, all optional): `startsAt` (reset minus span; a month's on the same day a month before, Go `AddDate`), `pacePct` (used% − elapsed share; positive runs out before reset), `aside: true` (GLM `TIME_LIMIT` "MCP · Month", MiniMax non-`general` buckets). `id` convention: `Nmin` / `Nh` / `Nd` / `month` / `allowance` / `mcp_month`, a bucket as `video:24h`, a repeat as `#2`; the app translates by id and falls back to `label`.
- `readBalances` returns every reading through `withPaceAt(now)`, so kept (1-minute or switch-off) and last readings show today's pace, none once `now >= resetsAt`.
- Plan requests: `authorization` (`Bearer` except GLM's bare key), `accept: application/json`, `accept-language: en-US,en`, `user-agent: Osuna/<version>`; never the endpoint's headers. OpenCode Go adds a fresh `x-opencode-session` = `x-opencode-session-id` (`ses_` + 12 hex + 14 base62).
- Merge: balance and plan run together; both ok → balance items + `[...balance.windows, ...plan.windows]`; only one ok → that one; neither → the plan's failure. A plan with no windows contributes nothing.
- `PlanSource.sure` (GLM on `/api/coding/`, Kimi Code, OpenCode Go): failures show. Not sure (MiniMax, GLM elsewhere): a failure shows nothing, except a temporary one when `hasLastReading` (then `standIn` gives the last reading).
- `LastBalanceReadings.keep` stores `ok` readings with items **or** windows.

### 4. Validation & Error Matrix
- GLM 401, or any status with `{ success: false, code: 1000–1005 }` → `token_rejected`, `hint: "glm_key_refused"`, `seeAt` = bigmodel / z.ai keys page, detail = vendor's words.
- OpenCode Go 403 → `token_rejected` + `opencode_go_no_subscription`; 401 → `opencode_key_refused`.
- Other ≥300 → `failureOfStatus`; non-JSON → `wrong_url`; reader `no_value` (GLM `success:false`, MiniMax `base_resp` code ≠ 0, no windows in Kimi/OpenCode) → `no_value` with detail.

### 5. Good/Base/Bad Cases
- Good: GLM coding key → 5h, 7d, MCP month aside, `items: []`, each with `startsAt` and `pacePct`.
- Base: OpenCode Go weekly at 0% → `resetsAt: null`, no `startsAt`/`pacePct`.
- Bad: pay-as-you-go MiniMax key → `unsupported`, not a failure card.

### 6. Tests Required
- `window-pace.test.ts`: +10 at half time, negative, month start, >100 clamp, null cases.
- `daemon-e2e/api-endpoint-balance.e2e.test.ts` › "API endpoint plan windows": each vendor's URL, headers and windows; GLM refusals; non-sure GLM / MiniMax unsupported; OpenCode Go both paths with session headers, 401/403; last reading keeps windows; pace recomputed an hour later and gone after reset; MiniMax busy before first read unsupported, after it stale; Check balance asks no plan.
- App `balance-windows.test.ts` (`tightestWindow`, `paceOf`), `balance-copy.test.ts` (ids → English and zh labels); browser `Balance` › GLM windows + used/remaining toggle + row, GLM refusal.

### 7. Wrong vs Correct
#### Wrong
```ts
// 上次读数带着读取那一刻的配速：几小时后、甚至窗口重置后还写「配速 −48%」
return this.lastBalances.standIn(settings, fresh);
```
#### Correct
```ts
const readings = await Promise.all(/* … */);
return readings.map((reading) => withPaceAt({ reading, now: this.now().getTime() }));
```

## Scenario: Command Code, Ollama Cloud and a GLM team's plan windows (endpoint-balance ticket 09, magpie `commandcode_plan.go`, `ollama_usage.go`, `planquota.go` `planKeyWindows` / `zhipuKeyTeamWindows`, `zcode_team.go` `zhipuResets`)

### 1. Scope / Trigger
- Two more plan sources on the same balance reading, a second request for Command Code's plan id, GLM team requests driven by two new optional balance settings, and new optional reading fields (`team`, `resets`).

### 2. Signatures
- `PLAN_VENDOR_URLS` gains `glm_cn_biz` (`https://bigmodel.cn/api/monitor/usage/quota/limit`), `commandcode`, `ollama` (moved here from the balance table; the balance reads them through the spread) and `commandcode_subscriptions`. The browser harness `e2e/support/daemon-upgrade-seal.mjs` seals `https://bigmodel.cn/` too.
- `PlanSource.team: { urls: string[]; language: "zh" | "en" } | null` — BigModel `[glm_cn, glm_cn_biz]` + `zh`, Z.ai `[glm_z]` + `en`.
- `balance-plan.ts`: `commandCodePlanIdOf(body)`, `commandCodeCreditsWindow({ body, planId })`, `commandCodeSubscriptionPlanId(body) → string | null` ("" = no plan), `zhipuTeamHeaders`, `zhipuTeamQuotaUrl(q) = q + "?type=2"`, `zhipuTeamResetsUrl(q)` (`…/api/biz/customer-package-reset/list?targetType=TEAM` on the same site), `readZhipuResets(body)`.
- `ReadBalanceInput.commandCodePlans?: Map<string, { planId, at }>` — one per service, keyed by subscriptions URL + key.

### 3. Contracts
- Settings: `ApiEndpointBalanceSettings.teamOrgId?`, `teamProjectId?`; stored in `balance` trimmed, each only when non-empty, and `balance.url` is now optional on disk — `balance` exists when there is a URL or a team ID. They are in the last-reading fingerprint (via `balance`).
- Reading: `team?: true`, `resets?: { count, until: string | null, byWindow?, fiveHour?, weekly?, each?: [{ until: string | null, window? }] }`, sorted soonest first, never-expiring last; kept by `LastBalanceReadings` and carried through the balance/plan merge.
- Window ids added: `session` (Ollama legacy, no span), `credits` (Command Code month's credits, `unit: "USD"`, `used`/`limit`, no reset → no pace).
- Command Code: windows only from `windowLimits` with `cap > 0`; none → no plan. Credits window when the plan id is known (reply's `planId`, else subscriptions, cached 10 min; a failed ask reuses the last id) and some credit number is given: pool = max(plan monthly, monthlyCredits) + purchased + free.
- Ollama: allowance window `month` when the period is 27–32 days, else `allowance`, span = until − from; every Ollama window `aside` when purchased credits > 0.
- GLM team: asked only when both IDs are set, the own read has no windows or failed for a reason other than `glm_key_refused`; first site whose `?type=2` reply has windows wins; resets asked at that site, failure → no `resets`. Headers: bare key, `accept`, `accept-language`, `user-agent`, `bigmodel-organization`, `bigmodel-project`, `set-language`.

### 4. Validation & Error Matrix
- One team ID only → daemon stores it but asks no team; the edit dialog (Zhipu address only) shows `teamBothNeeded`, marks the empty box `invalid` and disables Save (magpie's editor check).
- Team quota ≥300 / non-JSON / no windows → next site, then the personal result stands.
- Resets reply: non-2xx, `code` not in `"" | 0 | 200`, or zero available → no `resets`.

### 5. Good/Base/Bad Cases
- Good: GLM key, empty personal limits, both IDs → `team: true`, team 5h/7d, `resets.byWindow` counts.
- Base: open.bigmodel.cn answers no team windows → bigmodel.cn asked; resets 404 there → windows without `resets`.
- Bad: refused GLM key → only the personal request; no team request.

### 6. Tests Required
- `daemon-e2e/api-endpoint-balance.e2e.test.ts` › "API endpoint plan windows": team IDs kept / cleared; team windows + resets + headers + last reading on disk; bigmodel.cn fallback and Z.ai `en`; half IDs or refused key ask no team; own plan asks no team; Command Code windows + credits, subscription cached 10 min, pay-as-you-go; Ollama month aside and legacy session/weekly.
- App: `internal/balance-settings-form.test.ts` (`balanceSettingsOf` with team IDs, `hasLoneTeamId`, `isZhipuAddress`), `balance-copy.test.ts` (`session`, `credits`, `resetsLine` en/zh); browser `Balance` › "a GLM team's IDs are asked for at Zhipu's address only…".

### 7. Wrong vs Correct
#### Wrong
```ts
// 余额与套餐都读到时只拼窗口：团队标记和重置次数丢了
return { ...balance, windows: [...(balance.windows ?? []), ...(planned.windows ?? [])] };
```
#### Correct
```ts
return {
  ...balance,
  windows: [...(balance.windows ?? []), ...(planned.windows ?? [])],
  ...(planned.team ? { team: true } : {}),
  ...(planned.resets === undefined ? {} : { resets: planned.resets }),
};
```

## Scenario: Plan windows read with a cloud access key (Volcengine Ark, Tencent Token Plan Enterprise)

### 1. Scope / Trigger
- Trigger: new secrets in `keys.json`, new save/endpoint/reveal fields, a new reading status, and signed requests to two vendors' open platforms (api-endpoint balance ticket 10, after magpie `volcengine_usage.go`, `tencent_usage.go`, `access_key_card.go`).

### 2. Signatures
- Protocol `balance-settings.ts`: `accessKeyVendorOf(addresses) → "volcengine" | "tencent" | null` (any `ark.*.volces.com` host; `tokenhub(-intl).tencentmaas.com` under `/plan/`), `TENCENT_TOKEN_PLAN_REGIONS` (host → `ap-guangzhou` / `ap-singapore`). The app and daemon both use it.
- Server `balance-access-key.ts` (pure): `volcSign`, `tc3Sign`, `accessKeyPlanOf(baseUrls) → { vendor: "volcengine", action: "GetCodingPlanUsage" | "GetAFPUsage", region } | { vendor: "tencent", region } | null` (`/api/v3` pay-as-you-go → null), `volcRequest`, `tencentRequest`, `openApiErrorOf`, `readVolcPlan → { windows, tier }`, `readTencentPlanList`, `withTencentDetail`, `tencentPlanWindow`, `tencentStopped`, `tencentTeamOf`.
- `PLAN_VENDOR_URLS.volcengine_open` (`https://open.volcengineapi.com/`), `.tencent_open` (`https://tokenhub.tencentcloudapi.com/`); tests inject both; the browser seal covers both origins. Signing uses the host actually sent to (`new URL(openUrl).host`), so a local fake verifies the real signature.
- Store: `keys.json` `accessKeys?: { [endpointId]: { id?, secret? } }`; `getAccessKey(id) → { id: string | null, secret: string | null }`, `setAccessKey(id, { id, secret })` (both null drops the entry); `removeSecrets` drops it too.
- Service: `revealSecret(endpointId, secret: ApiEndpointSecret)` replaces `revealBalanceToken`; `ReadBalanceInput.accessKey?`; `BalanceSettings.accessKey` (in the last-reading fingerprint only when set).

### 3. Contracts
- Save: `accessKeyId?`, `secretAccessKey?` — each non-empty (trimmed) replaces, `""` clears, omitted keeps; both omitted on a copy takes the source's pair.
- Endpoint: `accessKeyIdMask?`, `secretAccessKeyMask?` (`maskApiKey`). Reveal: `secret` `access_key_id` / `secret_access_key`.
- Reading: status `needs_access_key` (either half missing; nothing sent; `readAt` and `failure` null); hint `access_key_refused`; optional `planTier` (Agent Plan `Tier`), `stoppedPlans: [{ team: string | null, status, reason: string | null }]` (Tencent `Status` ≠ `enable`; `NORMAL`/`none` reasons → null; `team` only with several plans), `unreadTeams: string[]` (several plans, some with no quota). All carried through the merge and kept by `LastBalanceReadings`.
- Requests: Volcengine `POST <open>/?Action=…&Version=2024-01-01`, body `{}`, headers `content-type`, `x-date`, `x-content-sha256`, `authorization`, `accept`, `user-agent`. Tencent `POST <open>/` with `x-tc-action`, `x-tc-version: 2026-03-22`, `x-tc-region`, `x-tc-timestamp`, TC3 `authorization`, `user-agent` (no `Accept`, as magpie); `DescribeTokenPlanList {"Offset":0,"Limit":100}` then `DescribeTokenPlan {"TeamId"}` per team. Never the plan key or endpoint headers.
- Windows: `5h`, `7d`, `month` (30-day span for pace); Tencent `month` with `used`/`limit`, `unit` `credits` or `tokens`, span = cycle end − start; several teams → id `<team>:month`, label `<team> · Month`.

### 4. Validation & Error Matrix
- Error code about the key (Volc: accesskey/signature/accessdenied/unauthorized/forbidden/credential/authfailure; Tencent: `AuthFailure*`/unauthorized) or HTTP 401/403 → `token_rejected` + `access_key_refused`, detail `Code Message` masked.
- Code containing limitexceeded/internalerror/unavailable/timeout → `temporary` (last reading stands in). Other code → by HTTP status, `no_value` on 200.
- Non-JSON 2xx → `wrong_url`; network → `temporary`.
- No windows → `no_value` with magpie's sentence; Tencent no team plans → `no_value` naming the region.
- Edit dialog: the two fields only when `accessKeyVendorOf` matches; an ID without a Secret shows `accessKeySecretNeeded` and disables Save (a Secret alone is allowed, as magpie).

### 5. Good/Base/Bad Cases
- Good: Ark Coding Plan with both keys → three windows, signature verified by the fake.
- Base: Tencent with three teams, one stopped, one without quota → two windows, `stoppedPlans`, `unreadTeams`.
- Bad: Ark endpoint with only an ID saved → `needs_access_key`, no request.

### 6. Tests Required
- `balance-access-key.test.ts`: SDK vectors for `volcSign` (from magpie `TestVolcSignMatchesSDK`; Volcengine's docs give no worked example), Tencent doc vector for `tc3Sign`, plan-of, readers, `tencentStopped`.
- `daemon-e2e/api-endpoint-balance.e2e.test.ts` › "…read with a cloud access key": signature recomputed from the received request, URLs, bodies, `needs_access_key` without requests, refusals, temporary, masks/reveal/copy/clear, no secret in replies or logs.
- App: `connection-form-model.test.ts` › "the cloud access key…"; browser `Balance` › Volcengine and Tencent cases.

### 7. Wrong vs Correct
#### Wrong
```ts
// 签名里写死真实主机：测试把地址换成本机后签名对不上
volcSign({ ..., host: "open.volcengineapi.com" });
```
#### Correct
```ts
const open = new URL(input.openUrl);
volcSign({ ..., host: open.host });
```

## Scenario: Codex resets on the plan usage card (endpoint-balance ticket 11, magpie `provider/codex_resets.go` `codexResets` / `codexResetCreditsWire`, `subscription_usage.go` `codexWindows`)

### 1. Scope / Trigger
- A plugin usage source's report gains a field that crosses plugin SDK → daemon registry → protocol → app, and the plugin context gains the daemon version.

### 2. Signatures
- Plugin SDK `@getpaseo/plugin/server/usage`: `UsageResets { count; until: string | null; byWindow?; fiveHour?; weekly?; each?: UsageReset[] }`, `UsageReset { until: string | null; window? }`; available `UsageReport.resets?`.
- `PluginServerContext.appVersion: string` (`plugin-process.ts` passes the `initialize` message's `appVersion`). Name it in a plugin's own requests: `Osuna/${server.appVersion}`.
- Codex: `fetchUsage(input, fetchApi, lookup, userAgent)`; `readResets({ count, headers, fetchApi }) → UsageResets | undefined` in `plugins/codex-usage-source/server/resets.ts`.

### 3. Contracts
- Count: `wham/usage` → `rate_limit_reset_credits.available_count` (magpie's JSON tag; the ticket's "available" is the Go field name). `<= 0` or absent → no `resets`, no second request.
- List: `GET https://chatgpt.com/backend-api/wham/rate-limit-reset-credits`, same bearer + `ChatGPT-Account-Id` as `wham/usage`, `User-Agent` = Osuna's (the `wham/usage` request keeps upstream's browser UA; tracked in task `10-22-endpoint-requests-user-agent`), `AbortSignal.timeout(4000)`.
- Cards: `status === "available"` and a non-empty `id`; `expires_at` counts only when RFC3339 (else never expires); soonest first, never-expiring last; `until` = first card's; `each` only when `cards.length === count`.
- Protocol: `UsageReportSchema` available branch `resets: ApiEndpointBalanceResetsSchema.optional()` (same shape as an endpoint reading's). Old apps drop it; no capability gate for display.

### 4. Validation & Error Matrix
| List request | Result |
| --- | --- |
| 2xx, cards = count | `{ count, until, each }` |
| 2xx, cards ≠ count | `{ count, until }` |
| non-2xx, HTML / bad JSON (`SyntaxError`), wrong shape (`ZodError`), network (`TypeError`), timeout / abort (`DOMException`) | `{ count, until: null }` |
| any other throw | rethrown → the report fails as before |

### 5. Good/Base/Bad Cases
- Good: 2 resets, list of 2 → line + expandable cards. Base: list times out → "2 resets left" alone. Bad: list of 1 for a count of 2 → that one is not shown as if it were both.

### 6. Tests Required
- `plugins/codex-usage-source/server/usage.test.ts`: count + list (order, UA, account header, a non-RFC3339 date counts as never), list failures keep the count, count mismatch drops `each`, no resets → one request, `auth.json` byte-identical.
- `plugins/usage-sources/index.test.ts`: a report's `resets` passes the registry's `UsageReportSchema.parse`.
- `e2e/browser/usage-modal.spec.ts` "Codex resets show on the plan usage card…": real Codex adapter through `installCodexWindowUsage(payload, resetCredits)`, modal + usage page, 1280/390 × light/dark.

### 7. Wrong vs Correct
#### Wrong
```ts
} catch {
  return null; // 吞掉一切，连写错的代码也当成「清单读不到」
}
```
#### Correct
```ts
} catch (error) {
  if (isListFailure(error)) return null; // 超时、连不上、不是 JSON、不是清单的形状
  throw error;
}
```

## Scenario: Using a Codex reset from the plan usage card (endpoint-balance ticket 12, magpie `provider/codex_resets.go` `useCodexReset` / `consumeCodexReset` / `newRedeemID`)

### 1. Scope / Trigger
- First Osuna request that changes an account with a CLI's sign-in (the sign-in file itself is still only read). A new optional plugin SDK call crosses plugin process → daemon registry → protocol RPC → app.

### 2. Signatures
- Plugin SDK: `UsageSourceRegistration.consumeReset?(input): Promise<UsageResetOutcome>`, `UsageResetOutcome { code: string; windows: number }`.
- Plugin process: request `{ type: "usage.consume_reset"; requestId; sourceId; input }`; ready metadata `usageSources[].consumesResets?: boolean` (set when the source has `consumeReset`). Runtime: `PluginRuntime.consumeUsageReset(pluginId, sourceId, input)`.
- Registry: `UsageSourceRegistry.consumeReset(reportId): Promise<UsageResetResult>` (`{ outcome, entry }`); `PluginManager.consumeUsageReset(reportId)`.
- RPC: `usage.reset.consume.request { requestId, reportId }` → `usage.reset.consume.response { requestId, outcome: { code, windows, message? } | null, report: UsageReportEntry | null, error: string | null }`. Permission `daemon.manage` (it changes the account). Client: `DaemonClient.consumeUsageReset(reportId)`.
- Capability: `server_info.features.planUsageResets`, declared only when the daemon has a plugin runtime. Report entries carry `consumesResets?: true` when their source can.
- Codex: `consumeReset(input, fetchApi, lookup, userAgent)` in `server/usage.ts`, `consumeSoonestReset({ headers, fetchApi })` in `server/resets.ts`.

### 3. Contracts
- Codex reads the list again (`readCards`, same 4 s timeout), picks the first available card (soonest, never-expiring last, stable order), then `POST …/wham/rate-limit-reset-credits/consume` with the list's headers + `Content-Type: application/json`, body `{ credit_id, redeem_request_id: randomUUID() }` — a fresh v4 per call; it is the vendor's idempotency key.
- The registry calls the source with the login whose report the card last showed (`answeredBy`, set in `fetchWithFallback` when a login answers `available`; falls back to the first login), then deletes the account's cache **and pending** entries (a read started before the reset would otherwise answer the forced read with old windows) and returns `fetchId(id, known, true)`.
- `message` is magpie's `ResetOutcome.Text` in English (`resetOutcomeText`); the app translates `reset` / `nothing_to_reset` / `no_credit` / `already_redeemed` / `already_used` itself and shows `message` (else `code`) for anything else.

### 4. Validation & Error Matrix
| Condition | Result |
| --- | --- |
| list unreadable (non-2xx, HTML, wrong shape, network, timeout) | throws "Couldn't read which reset runs out first, so none was used"; no POST |
| list has no available card | `{ code: "no_credit", windows: 0 }`; no POST |
| consume non-2xx | throws `Codex refused the reset (HTTP <status>)` |
| consume 2xx without `code` | throws "Codex's answer to the reset said nothing" |
| unknown report id / source without `consumeReset` | response `error`, `outcome: null`, `report: null` |
| failure of any kind | cache untouched |

### 5. Good/Base/Bad Cases
- Good: 2 windows used, confirm → `reset`/2, card re-read shows 0% and one reset fewer. Base: no window used → `nothing_to_reset`, reset kept. Bad: list times out → nothing spent, the error stays in the confirmation sheet.

### 6. Tests Required
- `plugins/codex-usage-source/server/usage.test.ts`: picks the soonest, UUID v4 that differs per call, UA/account/Content-Type headers, four outcome codes passed through, none left → no POST, unreadable list → no POST, 403 / empty answer throw, `auth.json` byte-identical.
- `usage-sources/index.test.ts`: uses the answering login, re-reads past the cache, words per code (unknown passed through), sources without it refuse and don't set `consumesResets`, a failure leaves the cache.
- `session/usage/usage-session.test.ts`: success and error payloads.
- `e2e/browser/usage-modal.spec.ts` "using a reset asks first…": a fake plugin (`installResetUsage`) at 1280/390 — confirmation text, cancel sends nothing, failure in the sheet, in-progress button disabled, success line + updated card, Dismiss.

### 7. Wrong vs Correct
#### Wrong
```ts
// 让厂商自己挑：可能用掉更久的那张
await fetch(`${RESETS_URL}/consume`, { method: "POST", body: "{}" });
```
#### Correct
```ts
const soonest = cards[0]; // 自己点名最早过期的那张；清单读不到就一张都不用
body: JSON.stringify({ credit_id: soonest.id, redeem_request_id: randomUUID() }),
```
