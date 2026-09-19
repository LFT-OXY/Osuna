import type { UsageCli } from "@getpaseo/protocol/usage/types";
import type { UsageScanState } from "./types.js";

/**
 * Claude hands out a new session id on every resume and writes the id it forked
 * from into the new transcript, so one conversation is several ids. Counting or
 * listing those ids separately reports one conversation as many sessions, so
 * the whole chain is reported under the id it last used.
 *
 * Only Claude resumes this way; for the other three a session is its own chain.
 */
export interface UsageSessionChains {
  /** The id a session is reported under. */
  canonical(cli: UsageCli, sessionId: string): string;
  /** Every id reported under this one, the id itself included. */
  members(cli: UsageCli, sessionId: string): string[];
}

/** One `forkedFrom` edge, with what decides a tie when a session was forked twice. */
interface ChainEdge {
  child: string;
  lastAt: string;
}

export function buildUsageSessionChains(scanState: UsageScanState): UsageSessionChains {
  const childOf = new Map<string, ChainEdge>();
  for (const cursor of Object.values(scanState.cursors)) {
    const parser = cursor.parser;
    // A subagent transcript repeats its parent's ids and names no resume.
    if (parser.kind !== "claude" || parser.subagent) continue;
    const child = parser.sessionId;
    const parent = parser.forkedFromSessionId;
    if (!child || !parent || child === parent) continue;
    const existing = childOf.get(parent);
    const edge = { child, lastAt: cursor.lastAt ?? "" };
    if (!existing || isLaterEdge(edge, existing)) childOf.set(parent, edge);
  }

  // The edges are a bijection once ties are resolved, so the parent link is the
  // inverse map: following it back collects a chain without revisiting a branch
  // that lost its tie.
  const parentOf = new Map<string, string>();
  for (const [parent, edge] of childOf) parentOf.set(edge.child, parent);

  // The report asks for the canonical id once per bucket row — tens of
  // thousands of times on a machine with a year of logs — so each walk is kept.
  const canonicalCache = new Map<string, string>();

  return {
    canonical(cli, sessionId) {
      if (cli !== "claude") return sessionId;
      const cached = canonicalCache.get(sessionId);
      if (cached !== undefined) return cached;
      let current = sessionId;
      const seen = new Set([current]);
      for (let next = childOf.get(current)?.child; next && !seen.has(next); ) {
        seen.add(next);
        current = next;
        next = childOf.get(current)?.child;
      }
      // Every id the walk passed shares this answer, so one walk fills them all.
      for (const member of seen) canonicalCache.set(member, current);
      return current;
    },
    members(cli, sessionId) {
      if (cli !== "claude") return [sessionId];
      const members = [sessionId];
      const seen = new Set(members);
      for (let parent = parentOf.get(sessionId); parent && !seen.has(parent); ) {
        seen.add(parent);
        members.push(parent);
        parent = parentOf.get(parent);
      }
      return members;
    },
  };
}

/** The transcript written most recently wins; the id breaks a same-instant tie. */
function isLaterEdge(candidate: ChainEdge, current: ChainEdge): boolean {
  if (candidate.lastAt !== current.lastAt) return candidate.lastAt > current.lastAt;
  return candidate.child > current.child;
}
