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

## Errors on the wire

Handlers do not throw across the socket. They catch at the handler boundary, map to a wire error with a string-literal `code`, log with `err`, and emit a failure payload. See [Error Handling](./error-handling.md) for `SessionRequestError` and the `toXWireError` mapping functions.

## Anti-patterns

- Adding a `.request` without its `.response` and not saying why next to the schema.
- Deriving a response type by hand instead of from the protocol schema.
- Checking `server_info.features` on the daemon side, or adding a defensive fallback path for old clients instead of a tagged shim.
- Putting GitHub-specific enums into a `checkout.forge.*` name; forge-neutral names carry forge-neutral shapes only.
