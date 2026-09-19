import type { UsageCli } from "@getpaseo/protocol/usage/types";
import type { AgentManagerEvent, ManagedAgent } from "../agent/agent-manager.js";
import type { AgentTimelineRow } from "../agent/agent-timeline-store-types.js";
import { restoreProviderSessionIds, type StoredAgentRecord } from "../agent/agent-storage.js";
import type { AgentTurnTimestamp } from "./codex-turn-match.js";

/** The CLI sessions one Paseo agent has run in. */
export interface UsageAgentBacking {
  cli: UsageCli;
  /**
   * Oldest first; the last one is the session the agent is writing to now. A
   * Claude resume appends, so an old agent can name several.
   */
  sessionIds: string[];
  cwd: string;
  /** Pi and OMP name their transcript outright; Claude and Codex do not. */
  logPath: string | null;
}

export interface UsageAgentTurnEvent {
  agentId: string;
  /** Paseo's own turn id, absent when the provider ended a turn it never named. */
  turnId: string | null;
}

/**
 * The usage service's window onto the agent world. It is an interface so the
 * service stays testable without an agent manager, and so nothing in here
 * reaches back into agent internals.
 */
export interface UsageAgentBridge {
  getBacking(agentId: string): Promise<UsageAgentBacking | null>;
  /** The agent a parsed session belongs to, for the `usage.updated` payload. */
  findAgentIdForSession(cli: UsageCli, sessionId: string): Promise<string | null>;
  /** When each of the agent's turns began, for Codex history with no turn id. */
  listTurnTimestamps(agentId: string): Promise<AgentTurnTimestamp[]>;
  /** Fires on `turn_completed`, `turn_failed` and `turn_canceled`. */
  subscribeTurnEnd(listener: (event: UsageAgentTurnEvent) => void): () => void;
}

/** Providers whose transcripts the scanner reads; everything else has no usage. */
export function usageCliForProvider(provider: string): UsageCli | null {
  switch (provider) {
    case "claude":
    case "codex":
    case "pi":
    case "omp":
      return provider;
    default:
      return null;
  }
}

/** What the bridge needs from the agent manager, which owns the live agents. */
export interface UsageAgentManagerLike {
  getAgent(agentId: string): ManagedAgent | null;
  listAgents(): ManagedAgent[];
  getTimelineRows(agentId: string): Promise<AgentTimelineRow[]>;
  subscribe(listener: (event: AgentManagerEvent) => void): () => void;
}

/** Agent records on disk, for an agent that is not loaded right now. */
export interface UsageAgentRegistryLike {
  get(agentId: string): Promise<StoredAgentRecord | null>;
  list(): Promise<StoredAgentRecord[]>;
}

const TURN_END_EVENTS = new Set(["turn_completed", "turn_failed", "turn_canceled"]);

export function createUsageAgentBridge(options: {
  agentManager: UsageAgentManagerLike;
  agentStorage: UsageAgentRegistryLike;
}): UsageAgentBridge {
  const { agentManager, agentStorage } = options;
  return {
    async getBacking(agentId) {
      const record: ManagedAgent | StoredAgentRecord | null =
        agentManager.getAgent(agentId) ?? (await agentStorage.get(agentId));
      if (!record) return null;
      const cli = usageCliForProvider(record.provider);
      if (!cli) return null;
      const persistence = record.persistence ?? null;
      const nativeHandle = persistence?.nativeHandle;
      return {
        cli,
        sessionIds: restoreProviderSessionIds({ ...record, persistence }),
        cwd: record.cwd,
        logPath: typeof nativeHandle === "string" ? nativeHandle : null,
      };
    },
    async findAgentIdForSession(cli, sessionId) {
      for (const agent of agentManager.listAgents()) {
        if (agent.provider === cli && agent.providerSessionIds.includes(sessionId)) return agent.id;
      }
      for (const record of await agentStorage.list()) {
        if (record.provider === cli && restoreProviderSessionIds(record).includes(sessionId)) {
          return record.id;
        }
      }
      return null;
    },
    async listTurnTimestamps(agentId) {
      // Only a loaded agent has a timeline; a closed one is matched by nothing.
      if (!agentManager.getAgent(agentId)) return [];
      const seen = new Map<string, string>();
      for (const row of await agentManager.getTimelineRows(agentId)) {
        if (row.item.type !== "user_message" || !row.turnId) continue;
        if (!seen.has(row.turnId)) seen.set(row.turnId, row.timestamp);
      }
      return Array.from(seen, ([turnId, at]) => ({ turnId, at }));
    },
    subscribeTurnEnd(listener) {
      return agentManager.subscribe((event) => {
        if (event.type !== "agent_stream" || !TURN_END_EVENTS.has(event.event.type)) return;
        const turnId = "turnId" in event.event ? (event.event.turnId ?? null) : null;
        listener({ agentId: event.agentId, turnId });
      });
    },
  };
}
