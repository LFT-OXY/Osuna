import type { FetchRecentProviderSessionEntry } from "@osuna/client/internal/daemon-client";
import type { FetchRecentProviderSessionsResponseMessage } from "@osuna/protocol/messages";
import {
  buildProviderCommand,
  buildProviderCommandArgv,
  hasProviderCommand,
} from "@/utils/provider-command-templates";

/** The protocol ceiling on `limit`; the panel asks for the whole list and filters locally. */
export const SESSION_HISTORY_FETCH_LIMIT = 200;

export const SESSION_HISTORY_SCOPES = ["workspace", "project", "host"] as const;

export type SessionHistoryScope = (typeof SESSION_HISTORY_SCOPES)[number];

/**
 * The directories one listing asks the daemon about. Project scope is one
 * request per active workspace of the project on this host; host scope is a
 * single request with no directory at all, which is why it is the empty list.
 */
export interface SessionHistoryDirectories {
  /** The current workspace's directory. */
  workspaceDirectory: string;
  /** Directories of the project's active workspaces on this host; may not yet list the current one. */
  projectWorkspaceDirectories: readonly string[];
}

export function resolveSessionHistoryCwds(
  scope: SessionHistoryScope,
  directories: SessionHistoryDirectories,
): string[] {
  switch (scope) {
    case "workspace":
      return [directories.workspaceDirectory];
    case "project": {
      const distinct = new Set([
        directories.workspaceDirectory,
        ...directories.projectWorkspaceDirectories,
      ]);
      return Array.from(distinct).sort();
    }
    case "host":
      return [];
  }
}

export function buildSessionHistoryQueryKey(input: {
  serverId: string;
  scope: SessionHistoryScope;
  cwds: readonly string[];
}) {
  return ["session-history", input.serverId, input.scope, [...input.cwds]] as const;
}

/** The wire response minus `requestId`; what one directory's listing contributes. */
export type SessionHistoryPayload = Pick<
  FetchRecentProviderSessionsResponseMessage["payload"],
  "entries" | "providerErrors"
>;

export type SessionHistoryProviderError = NonNullable<
  SessionHistoryPayload["providerErrors"]
>[number];

export interface SessionHistoryListing {
  entries: FetchRecentProviderSessionEntry[];
  /** Each provider failure once, however many directories reported it. */
  providerErrors: SessionHistoryProviderError[];
}

/** One listing out of the per-directory responses a project-scoped fetch fans out to. */
export function mergeSessionHistoryPayloads(
  payloads: ReadonlyArray<SessionHistoryPayload>,
): SessionHistoryListing {
  const entries: FetchRecentProviderSessionEntry[] = [];
  const providerErrors: SessionHistoryProviderError[] = [];
  const seenErrors = new Set<string>();
  for (const payload of payloads) {
    entries.push(...payload.entries);
    for (const error of payload.providerErrors ?? []) {
      const errorKey = `${error.provider}\u0000${error.message}`;
      if (seenErrors.has(errorKey)) continue;
      seenErrors.add(errorKey);
      providerErrors.push(error);
    }
  }
  return { entries, providerErrors };
}

export interface SessionHistoryRow {
  /** `providerId:providerHandleId`, the identity a provider session keeps across refreshes. */
  key: string;
  providerId: string;
  providerLabel: string;
  providerHandleId: string;
  cwd: string;
  title: string;
  lastActivityAt: string;
  /** The Paseo agent that owns this session; such a row opens the agent, never a terminal. */
  importedAgentId: string | null;
  /** That agent's workspace, so opening it lands in a workspace tab even when the agent is archived. */
  importedAgentWorkspaceId: string | null;
  /** Lower-cased title and prompt previews; what the search box matches against. */
  searchText: string;
}

export function sessionHistoryRowKey(entry: {
  providerId: string;
  providerHandleId: string;
}): string {
  return `${entry.providerId}:${entry.providerHandleId}`;
}

/** Session title, else the first prompt, else the provider's own name. */
export function resolveSessionHistoryTitle(entry: FetchRecentProviderSessionEntry): string {
  const title = entry.title?.trim();
  if (title) {
    return title;
  }
  const firstPrompt = entry.firstPromptPreview?.trim();
  if (firstPrompt) {
    return firstPrompt;
  }
  return entry.providerLabel;
}

/**
 * Rows the panel can act on: one per provider session, only for providers the
 * client knows how to resume, newest activity first.
 */
export function buildSessionHistoryRows(
  entries: ReadonlyArray<FetchRecentProviderSessionEntry>,
): SessionHistoryRow[] {
  const seen = new Set<string>();
  const rows: SessionHistoryRow[] = [];
  for (const entry of entries) {
    if (!hasProviderCommand(entry.providerId, "resume")) continue;
    const key = sessionHistoryRowKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    const title = resolveSessionHistoryTitle(entry);
    rows.push({
      key,
      providerId: entry.providerId,
      providerLabel: entry.providerLabel,
      providerHandleId: entry.providerHandleId,
      cwd: entry.cwd,
      title,
      lastActivityAt: entry.lastActivityAt,
      importedAgentId: entry.importedAgentId ?? null,
      importedAgentWorkspaceId: entry.importedAgentWorkspaceId ?? null,
      searchText: [title, entry.firstPromptPreview, entry.lastPromptPreview]
        .filter((text): text is string => Boolean(text))
        .join("\n")
        .toLowerCase(),
    });
  }
  rows.sort(
    (left, right) =>
      new Date(right.lastActivityAt).getTime() - new Date(left.lastActivityAt).getTime(),
  );
  return rows;
}

export interface ResumeTerminalLaunch {
  cwd: string;
  name: string;
  command: string;
  args: string[];
}

/**
 * What a resumable provider session is, wherever it is listed: Session history
 * rows and the usage page's session rows both satisfy it.
 */
export interface ResumableProviderSession {
  providerId: string;
  providerHandleId: string;
  cwd: string;
  title: string;
}

/** What to hand `create_terminal_request` so the new tab is the provider's own resumed session. */
export function buildResumeTerminalLaunch(
  row: ResumableProviderSession,
): ResumeTerminalLaunch | null {
  const argv = buildProviderCommandArgv({
    provider: row.providerId,
    id: "resume",
    sessionId: row.providerHandleId,
  });
  if (!argv) {
    return null;
  }
  return { cwd: row.cwd, name: row.title, command: argv.command, args: argv.args };
}

/** The resume command as one line, for pasting into a terminal Paseo does not own. */
export function buildResumeCommand(row: SessionHistoryRow): string | null {
  return buildProviderCommand({
    provider: row.providerId,
    id: "resume",
    sessionId: row.providerHandleId,
  });
}

/** Client-side search over title and prompt previews; a blank query is no filter. */
export function filterSessionHistoryRows(
  rows: SessionHistoryRow[],
  query: string,
): SessionHistoryRow[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return rows;
  }
  return rows.filter((row) => row.searchText.includes(needle));
}

function withoutTrailingSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

/**
 * Where a session lives, relative to the project root. Null at the root itself;
 * the full path when the directory is outside the project (Paseo worktrees live
 * under `$PASEO_HOME/worktrees`, so they show in full).
 */
export function formatSessionHistoryDirectory(
  cwd: string,
  projectRootPath: string | null,
): string | null {
  if (projectRootPath === null) {
    return null;
  }
  const directory = withoutTrailingSlash(cwd);
  const root = withoutTrailingSlash(projectRootPath);
  if (directory === root) {
    return null;
  }
  if (directory.startsWith(`${root}/`)) {
    return directory.slice(root.length + 1);
  }
  return directory;
}
