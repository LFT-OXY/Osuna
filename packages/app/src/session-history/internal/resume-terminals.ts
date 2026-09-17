/**
 * Which terminal a workspace already opened for a provider session, so a second
 * click focuses that tab instead of resuming the session in a second process.
 *
 * In memory only, read at click time and never rendered. The terminal itself
 * survives on the daemon, but persisting this map would mean cleaning it up
 * whenever the daemon reaps a terminal; losing it on restart and opening one
 * more terminal is the cheaper failure.
 */
export interface ResumeTerminalRef {
  serverId: string;
  workspaceId: string;
  /** The row's `providerId:providerHandleId`. */
  sessionKey: string;
}

/** `serverId:workspaceId` → session key → terminal id. */
const terminalIdsByWorkspace = new Map<string, Map<string, string>>();

function workspaceBucketKey(ref: Pick<ResumeTerminalRef, "serverId" | "workspaceId">): string {
  return `${ref.serverId}:${ref.workspaceId}`;
}

export function lookupResumeTerminal(ref: ResumeTerminalRef): string | null {
  return terminalIdsByWorkspace.get(workspaceBucketKey(ref))?.get(ref.sessionKey) ?? null;
}

export function rememberResumeTerminal(input: ResumeTerminalRef & { terminalId: string }): void {
  const bucket = workspaceBucketKey(input);
  const sessions = terminalIdsByWorkspace.get(bucket) ?? new Map<string, string>();
  sessions.set(input.sessionKey, input.terminalId);
  terminalIdsByWorkspace.set(bucket, sessions);
}

export function forgetResumeTerminal(ref: ResumeTerminalRef): void {
  terminalIdsByWorkspace.get(workspaceBucketKey(ref))?.delete(ref.sessionKey);
}

export function resetResumeTerminalsForTests(): void {
  terminalIdsByWorkspace.clear();
}
