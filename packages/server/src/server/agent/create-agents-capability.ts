import type { ProviderPaseoToolsPolicy } from "@getpaseo/protocol/provider-config";
import type { AgentLaunchContext, AgentSessionConfig } from "./agent-sdk-types.js";
import { isPaseoToolEnabled } from "./paseo-tool-policy.js";
import { hasInternalPaseoMcpServer } from "./runtime-mcp-config.js";

export type PaseoToolsGateReason = "mcp_disabled" | "tools_not_injected";

export type CreateAgentsUnavailableReason =
  | PaseoToolsGateReason
  | "create_agent_not_allowed"
  | "tools_not_delivered";

export type CreateAgentsCapability =
  | { canCreateAgents: true }
  | { canCreateAgents: false; unavailableReason: CreateAgentsUnavailableReason };

export interface PaseoToolsGate {
  mcpEnabled: boolean;
  injectIntoAgents: boolean;
}

export function resolvePaseoToolsGateReason(gate: PaseoToolsGate): PaseoToolsGateReason | null {
  if (!gate.mcpEnabled) return "mcp_disabled";
  if (!gate.injectIntoAgents) return "tools_not_injected";
  return null;
}

/**
 * 判定一个刚启动的会话能否调用 create_agent。原生通道只认会话绑定的目录
 * （OpenCode 的 bridge manifest 不带策略，不算数）；MCP 通道要求注入了内部
 * paseo 服务器且会话确实接受 MCP 配置。
 */
export function resolveCreateAgentsCapability(input: {
  gateReason: PaseoToolsGateReason | null;
  paseoToolPolicy: ProviderPaseoToolsPolicy | undefined;
  launchContext: AgentLaunchContext;
  providerLaunchConfig: AgentSessionConfig;
  sessionSupportsMcpServers: boolean;
}): CreateAgentsCapability {
  if (input.gateReason) {
    return { canCreateAgents: false, unavailableReason: input.gateReason };
  }
  if (!isPaseoToolEnabled(input.paseoToolPolicy, "create_agent")) {
    return { canCreateAgents: false, unavailableReason: "create_agent_not_allowed" };
  }
  const delivered = input.launchContext.paseoTools
    ? input.launchContext.paseoTools.getTool("create_agent") !== undefined
    : hasInternalPaseoMcpServer(input.providerLaunchConfig) && input.sessionSupportsMcpServers;
  return delivered
    ? { canCreateAgents: true }
    : { canCreateAgents: false, unavailableReason: "tools_not_delivered" };
}
