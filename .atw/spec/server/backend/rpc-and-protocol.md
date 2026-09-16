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

## Errors on the wire

Handlers do not throw across the socket. They catch at the handler boundary, map to a wire error with a string-literal `code`, log with `err`, and emit a failure payload. See [Error Handling](./error-handling.md) for `SessionRequestError` and the `toXWireError` mapping functions.

## Anti-patterns

- Adding a `.request` without its `.response` and not saying why next to the schema.
- Deriving a response type by hand instead of from the protocol schema.
- Checking `server_info.features` on the daemon side, or adding a defensive fallback path for old clients instead of a tagged shim.
- Putting GitHub-specific enums into a `checkout.forge.*` name; forge-neutral names carry forge-neutral shapes only.
