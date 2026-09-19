import type { UsageSessionRow } from "@getpaseo/protocol/usage/types";
/** A session row and the host it ran on; sessions never merge across hosts. */
export interface MergedUsageSession extends UsageSessionRow {
  serverId: string;
  /** Row identity across refetches: the host, the session, and the day it is on. */
  key: string;
}

export interface UsageSessionsPage {
  serverId: string;
  sessions: readonly UsageSessionRow[];
  truncated: boolean;
}

export interface MergedUsageSessions {
  sessions: MergedUsageSession[];
  /** Any host left rows out, so the list is not the whole day. */
  truncated: boolean;
}

export function usageSessionKey(serverId: string, session: UsageSessionRow): string {
  return `${serverId}:${session.cli}:${session.sessionId}:${session.day}`;
}

/** Every host's rows in one list, newest activity first. */
export function mergeUsageSessions(pages: readonly UsageSessionsPage[]): MergedUsageSessions {
  const sessions: MergedUsageSession[] = [];
  let truncated = false;
  for (const page of pages) {
    truncated ||= page.truncated;
    for (const session of page.sessions) {
      sessions.push({
        ...session,
        serverId: page.serverId,
        key: usageSessionKey(page.serverId, session),
      });
    }
  }
  sessions.sort((a, b) => {
    if (a.lastAt !== b.lastAt) return a.lastAt < b.lastAt ? 1 : -1;
    return a.key < b.key ? -1 : 1;
  });
  return { sessions, truncated };
}
