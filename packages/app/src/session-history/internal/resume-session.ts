import type { DaemonClient } from "@osuna/client/internal/daemon-client";
import { getCurrentTerminalViewAttributes } from "@/terminal/view-attributes";
import type { ResumeTerminalLaunch } from "./model";
import {
  forgetResumeTerminal,
  lookupResumeTerminal,
  rememberResumeTerminal,
  type ResumeTerminalRef,
} from "./resume-terminals";

export type ResumeSessionClient = Pick<DaemonClient, "createTerminal" | "listTerminals">;

type CreatedTerminal = Awaited<ReturnType<DaemonClient["createTerminal"]>>["terminal"];

export interface ResumeProviderSessionResult {
  terminalId: string;
  /** The terminal the daemon just created, or null when an open one was reused. */
  created: CreatedTerminal | null;
}

export interface ResumeProviderSessionInput {
  client: ResumeSessionClient;
  /** Identifies the terminal to reuse: host, workspace, and the provider session. */
  ref: ResumeTerminalRef;
  launch: ResumeTerminalLaunch;
  /** The directory `list_terminals` is scoped to, which is the workspace's own. */
  workspaceDirectory: string;
  /** Already translated; the daemon answers a failed create with no terminal. */
  openFailedMessage: string;
}

/**
 * Resumes one provider session in a terminal of the given workspace, reusing
 * the terminal a previous click already opened for it. Both the Session history
 * panel and the usage page's session rows go through here, so a session cannot
 * end up running twice under two slightly different launches.
 */
export async function resumeProviderSessionTerminal(
  input: ResumeProviderSessionInput,
): Promise<ResumeProviderSessionResult> {
  const { client, ref, launch } = input;
  const knownTerminalId = lookupResumeTerminal(ref);
  if (knownTerminalId) {
    // The daemon may have reaped it since; only a listed terminal is worth focusing.
    const listed = await client.listTerminals(input.workspaceDirectory, undefined, {
      workspaceId: ref.workspaceId,
    });
    if (listed.terminals.some((terminal) => terminal.id === knownTerminalId)) {
      return { terminalId: knownTerminalId, created: null };
    }
    forgetResumeTerminal(ref);
  }

  const payload = await client.createTerminal(launch.cwd, launch.name, undefined, {
    command: launch.command,
    args: launch.args,
    workspaceId: ref.workspaceId,
    viewAttributes: getCurrentTerminalViewAttributes(),
  });
  if (!payload.terminal) {
    throw new Error(payload.error ?? input.openFailedMessage);
  }
  rememberResumeTerminal({ ...ref, terminalId: payload.terminal.id });
  return { terminalId: payload.terminal.id, created: payload.terminal };
}
