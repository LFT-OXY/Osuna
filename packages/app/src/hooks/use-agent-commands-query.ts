import { useTranslation } from "react-i18next";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useFetchQuery } from "@/data/query";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { agentCommandsQueryKey, type AgentCommandsDraftConfig } from "@/hooks/agent-commands-query";

// 聚焦预取的新鲜期：反复聚焦不重复请求；打开菜单另有观察者每次都重新请求。
const PREFETCH_STALE_TIME = 60_000;
const MENU_STALE_TIME = 0;

export interface AgentSlashCommand {
  name: string;
  description: string;
  argumentHint: string;
  kind?: string;
}

export interface AgentCommandsList {
  commands: AgentSlashCommand[];
  /** daemon 还没有 provider 进程上报的列表；旧 daemon 不带该字段，视为完整。 */
  partial: boolean;
}

export type DraftCommandConfig = AgentCommandsDraftConfig;

interface ListAgentCommandsOptions {
  agentId: string;
  draftConfig?: DraftCommandConfig;
}

export interface AgentCommandsClient {
  listCommands(options: ListAgentCommandsOptions): ReturnType<DaemonClient["listCommands"]>;
}

export async function fetchAgentCommands(input: {
  client: AgentCommandsClient;
  agentId: string;
  draftConfig?: DraftCommandConfig;
}): Promise<AgentCommandsList> {
  const response = await input.client.listCommands({
    agentId: input.agentId,
    draftConfig: input.draftConfig,
  });
  return {
    commands: response.commands as AgentSlashCommand[],
    partial: response.partial === true,
  };
}

interface AgentCommandsQueryInput {
  serverId: string;
  agentId: string;
  draftConfig?: DraftCommandConfig;
  client: AgentCommandsClient | null;
  /** 连接、retained panel、agent/草稿都就绪时才允许请求。 */
  canFetch: boolean;
  isMenuOpen: boolean;
  prefetch: boolean;
  clientUnavailableMessage: string;
}

/**
 * 同一个 key 上的两个观察者：聚焦预取有 60 秒新鲜期；菜单观察者新鲜期为 0，
 * 每次打开（enabled 由假变真）都会重新请求，期间保留旧数据。
 */
export function agentCommandsQueryInputs(input: AgentCommandsQueryInput) {
  const { client, agentId, draftConfig } = input;
  const base = {
    queryKey: agentCommandsQueryKey({ serverId: input.serverId, agentId, draftConfig }),
    queryFn: async () => {
      if (!client) {
        throw new Error(input.clientUnavailableMessage);
      }
      return fetchAgentCommands({ client, agentId, draftConfig });
    },
    dataShape: "value" as const,
    retry: 3,
    retryDelay: (attemptIndex: number) => Math.min(1000 * 2 ** attemptIndex, 5000),
  };
  return {
    prefetch: {
      ...base,
      staleTimeMs: PREFETCH_STALE_TIME,
      enabled: input.canFetch && input.prefetch,
    },
    menu: { ...base, staleTimeMs: MENU_STALE_TIME, enabled: input.canFetch && input.isMenuOpen },
  };
}

/**
 * - unavailable：请求不了（如断线）且从没拿到过，菜单不显示。
 * - error：只有从没拿到过数据时才算失败；后台刷新失败沿用旧列表。
 */
export type AgentCommandsState =
  | { status: "unavailable" }
  | { status: "loading" }
  | { status: "error"; error: Error }
  | ({ status: "ready" } & AgentCommandsList);

interface AgentCommandsStateInput {
  canFetch: boolean;
  data: AgentCommandsList | undefined;
  error: Error | null;
}

export function selectAgentCommandsState(input: AgentCommandsStateInput): AgentCommandsState {
  if (input.data) {
    return { status: "ready", ...input.data };
  }
  if (input.error) {
    return { status: "error", error: input.error };
  }
  return input.canFetch ? { status: "loading" } : { status: "unavailable" };
}

interface UseAgentCommandsQueryOptions {
  serverId: string;
  agentId: string;
  isMenuOpen: boolean;
  /** Composer input 聚焦时预取，让菜单打开时已有数据。 */
  prefetch: boolean;
  draftConfig?: DraftCommandConfig;
}

export function useAgentCommandsQuery({
  serverId,
  agentId,
  isMenuOpen,
  prefetch,
  draftConfig,
}: UseAgentCommandsQueryOptions): AgentCommandsState {
  const { t } = useTranslation();
  const retainedPanelActive = useRetainedPanelActive();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const canFetch = retainedPanelActive && !!client && isConnected && (!!agentId || !!draftConfig);

  const inputs = agentCommandsQueryInputs({
    serverId,
    agentId,
    draftConfig,
    client,
    canFetch,
    isMenuOpen,
    prefetch,
    clientUnavailableMessage: t("common.errors.daemonClientUnavailable"),
  });
  useFetchQuery(inputs.prefetch);
  const query = useFetchQuery(inputs.menu);

  return selectAgentCommandsState({ canFetch, data: query.data, error: query.error });
}
