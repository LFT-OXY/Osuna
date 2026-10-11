import type { QueryClient } from "@tanstack/react-query";
import type { AgentProvider } from "@getpaseo/protocol/agent-types";
import { normalizeWorkspacePath } from "@/utils/workspace-identity";

export const AGENT_COMMANDS_QUERY_ROOT = "agentCommands";

export interface AgentCommandsDraftConfig {
  provider: AgentProvider;
  cwd: string;
  modeId?: string;
  model?: string;
  thinkingOptionId?: string;
  featureValues?: Record<string, unknown>;
}

export function normalizeAgentCommandsCwd(cwd: string): string {
  return normalizeWorkspacePath(cwd) ?? "";
}

export function agentCommandsQueryRoot(serverId: string) {
  return [AGENT_COMMANDS_QUERY_ROOT, serverId] as const;
}

export function sessionAgentCommandsQueryKey(input: { serverId: string; agentId: string }) {
  return [...agentCommandsQueryRoot(input.serverId), "session", input.agentId] as const;
}

function draftAgentCommandsCheckoutScope(input: { serverId: string; cwd: string }) {
  return [
    ...agentCommandsQueryRoot(input.serverId),
    "draft",
    "cwd",
    normalizeAgentCommandsCwd(input.cwd),
  ] as const;
}

export function draftAgentCommandsQueryKey(input: {
  serverId: string;
  draftConfig: AgentCommandsDraftConfig;
}) {
  const { draftConfig } = input;
  // daemon 的指令目录只按 provider + 工作目录区分，切换 model / mode 不应换成空键闪"加载中"。
  return [
    ...draftAgentCommandsCheckoutScope({ serverId: input.serverId, cwd: draftConfig.cwd }),
    "provider",
    draftConfig.provider,
  ] as const;
}

// Draft commands include project skills read from the checkout. When the checkout moves to
// another branch the cached list describes files that are gone, so it is dropped rather than
// shown while a refetch runs.
export function resetDraftAgentCommandsForCheckout(
  queryClient: QueryClient,
  input: { serverId: string; cwd: string },
): Promise<void> {
  return queryClient.resetQueries({ queryKey: draftAgentCommandsCheckoutScope(input) });
}

export function agentCommandsQueryKey(input: {
  serverId: string;
  agentId: string;
  draftConfig?: AgentCommandsDraftConfig;
}) {
  if (input.draftConfig) {
    return draftAgentCommandsQueryKey({
      serverId: input.serverId,
      draftConfig: input.draftConfig,
    });
  }
  return sessionAgentCommandsQueryKey({ serverId: input.serverId, agentId: input.agentId });
}
