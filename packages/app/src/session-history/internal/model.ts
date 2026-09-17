import type { FetchRecentProviderSessionEntry } from "@getpaseo/client/internal/daemon-client";
import { buildProviderCommandArgv, hasProviderCommand } from "@/utils/provider-command-templates";

/** The protocol ceiling on `limit`; the panel asks for the whole list and filters locally. */
export const SESSION_HISTORY_FETCH_LIMIT = 200;

export type SessionHistoryScope = "workspace" | "project" | "host";

export function buildSessionHistoryQueryKey(input: {
  serverId: string;
  scope: SessionHistoryScope;
  cwds: readonly string[];
}) {
  return ["session-history", input.serverId, input.scope, [...input.cwds]] as const;
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
    rows.push({
      key,
      providerId: entry.providerId,
      providerLabel: entry.providerLabel,
      providerHandleId: entry.providerHandleId,
      cwd: entry.cwd,
      title: resolveSessionHistoryTitle(entry),
      lastActivityAt: entry.lastActivityAt,
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

/** What to hand `create_terminal_request` so the new tab is the provider's own resumed session. */
export function buildResumeTerminalLaunch(row: SessionHistoryRow): ResumeTerminalLaunch | null {
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
