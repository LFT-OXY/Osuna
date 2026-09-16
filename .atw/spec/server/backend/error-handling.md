# Error Handling

The house rules are in `docs/coding-standards.md` "Errors" and "Confidence". This guide shows the daemon's concrete shapes.

## Typed error classes

Throw classes that carry the fields a caller will read. The daemon has dozens; these are the reference shapes:

| Class | File | What it carries |
|-------|------|-----------------|
| `WorktreeRequestError` | `server/worktree-errors.ts` | `code: WorktreeWireErrorCode` (a string-literal union) plus message |
| `SessionRequestError` | `server/session.ts` | error code + message for a session RPC failure |
| `PidLockError` | `server/pid-lock.ts` | why the lock could not be taken |
| `CursorError` | `server/pagination/cursor.ts` | invalid pagination cursor |
| `WorkspaceAutomationBlockedError` | `server/workspace-automation-gate.ts` | the gate that refused an automated action |
| `MissingCheckoutTargetError`, `UnsupportedForgeCheckoutTargetError` | `server/resolve-worktree-creation-intent.ts` | which part of a checkout intent was unusable |

Shape to copy from `worktree-errors.ts`:

```ts
export class WorktreeRequestError extends Error {
  readonly code: WorktreeWireErrorCode;
  constructor(error: WorktreeWireError) {
    super(error.message);
    this.name = "WorktreeRequestError";
    this.code = error.code;
  }
}
```

Set `this.name`, keep fields `readonly`, use a string-literal union for `code`.

## Mapping to the wire

Domain errors become wire errors at the handler boundary through a `toXWireError(error: unknown)` function that branches on `instanceof` and ends with an explicit `unknown` code. `toWorktreeWireError` in `server/worktree-errors.ts` and `toCheckoutError` in `server/checkout-git-utils.ts` are the pattern. The handler then logs and emits a failure payload; see `handleCreateAgentRequest` in `server/session.ts`:

```ts
} catch (error) {
  const wireError = error instanceof SessionRequestError ? error : toWorktreeWireError(error);
  this.sessionLogger.error({ err: error }, "Failed to create agent");
  this.emit({ type: "status", payload: { status: "agent_create_failed", requestId: msg.requestId, error: wireError.message, errorCode: wireError.code } });
}
```

## Rules

- **Catch on `instanceof`, rethrow the rest.** A `catch` that cannot name what it handles should not exist. `catch (e) { return null }` is forbidden.
- **Fail explicitly.** If the caller asked for provider X and X is unavailable, throw; do not substitute Y.
- **Fail closed on capabilities.** Advertising a feature in `server_info.features` means the runtime can do it now. If it cannot, refuse server-side and send the reason separately for UI.
- **Log with the `err` key**, `logger.error({ err: error }, "message")`, so pino serializes the stack. See [Logging](./logging.md).
- **User-facing copy and log strings are different strings.** The wire `message` is what the app shows; log lines carry context objects.
- **Process exits are deliberate.** Supervisor and worker lifecycle reasons are enumerated in `server/lifecycle-reasons.ts`; do not `process.exit` from a feature module.

## Anti-patterns

- `throw new Error("Provider X not found")` from a module that already has a typed error class nearby.
- `try/catch` around code that cannot throw, or "just in case".
- Swallowing an error from `writeJsonFileAtomic` and continuing as if the write happened.
- Wrapping optional dependencies in `try/catch` at import time. That pattern exists for a few native modules (`sherpa-onnx-node`) and is not a general license; it also breaks the packaging dependency check described in `docs/testing.md`.
