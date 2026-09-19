import {
  buildResumeTerminalLaunch,
  sessionHistoryRowKey,
  type ResumableProviderSession,
  type ResumeTerminalLaunch,
} from "@/session-history";
import type { MergedUsageSession } from "./sessions";

/** What the usage page's Open button does for one session row. */
export type UsageSessionAction =
  | { kind: "agent"; agentId: string; workspaceId: string | null }
  | {
      kind: "resume";
      workspaceId: string;
      /** The workspace's own directory, which scopes its terminal listing. */
      workspaceDirectory: string;
      /** How the resumed terminal is remembered, shared with Session history. */
      sessionKey: string;
      launch: ResumeTerminalLaunch;
    }
  /** The transcript is gone, the CLI has no resume command, or no workspace holds its directory. */
  | { kind: "unavailable"; reason: "noHandle" | "noWorkspace" };

export interface UsageSessionWorkspace {
  id: string;
  workspaceDirectory: string;
}

/** What the Open button needs off a row; the rest of the row does not matter. */
export type UsageSessionTarget = Pick<
  MergedUsageSession,
  "cwd" | "project" | "handle" | "importedAgentId" | "importedAgentWorkspaceId"
>;

/**
 * A session Paseo owns has one owner — its agent — so it opens that agent and
 * is never resumed a second time. Anything else resumes in a terminal, which
 * needs a workspace on that host to hold the tab: the usage page is host-wide
 * and has no workspace of its own, so it takes the workspace the session ran
 * inside.
 */
export function resolveUsageSessionAction(input: {
  session: UsageSessionTarget;
  workspaces: readonly UsageSessionWorkspace[];
}): UsageSessionAction {
  const { session } = input;
  if (session.importedAgentId) {
    return {
      kind: "agent",
      agentId: session.importedAgentId,
      workspaceId: session.importedAgentWorkspaceId ?? null,
    };
  }
  if (!session.handle) return { kind: "unavailable", reason: "noHandle" };
  const resumable: ResumableProviderSession = {
    providerId: session.handle.providerId,
    providerHandleId: session.handle.providerHandleId,
    cwd: session.cwd,
    title: session.project.displayName,
  };
  const launch = buildResumeTerminalLaunch(resumable);
  if (!launch) return { kind: "unavailable", reason: "noHandle" };
  const workspace = enclosingWorkspace(input.workspaces, session.cwd);
  if (!workspace) return { kind: "unavailable", reason: "noWorkspace" };
  return {
    kind: "resume",
    workspaceId: workspace.id,
    workspaceDirectory: workspace.workspaceDirectory,
    sessionKey: sessionHistoryRowKey(resumable),
    launch,
  };
}

/**
 * The workspace the session ran inside. Session history resumes into whatever
 * workspace its panel sits in, with no equality test on the session's own
 * directory, so a session run in a subdirectory opens there too; the deepest
 * match wins when a project and a directory under it are both open.
 */
function enclosingWorkspace(
  workspaces: readonly UsageSessionWorkspace[],
  cwd: string,
): UsageSessionWorkspace | null {
  const directory = withoutTrailingSlash(cwd);
  let best: UsageSessionWorkspace | null = null;
  for (const workspace of workspaces) {
    const root = withoutTrailingSlash(workspace.workspaceDirectory);
    if (directory !== root && !directory.startsWith(`${root}/`)) continue;
    if (best && withoutTrailingSlash(best.workspaceDirectory).length >= root.length) continue;
    best = workspace;
  }
  return best;
}

function withoutTrailingSlash(directory: string): string {
  return directory.length > 1 ? directory.replace(/\/+$/, "") : directory;
}
