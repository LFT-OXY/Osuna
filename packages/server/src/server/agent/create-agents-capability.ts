import type { ProviderPaseoToolsPolicy } from "@getpaseo/protocol/provider-config";
import type {
  AgentCapabilityFlags,
  AgentLaunchContext,
  AgentSessionConfig,
} from "./agent-sdk-types.js";
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

function resolveBlockedByConfig(
  gateReason: PaseoToolsGateReason | null,
  paseoToolPolicy: ProviderPaseoToolsPolicy | undefined,
): CreateAgentsCapability | null {
  if (gateReason) {
    return { canCreateAgents: false, unavailableReason: gateReason };
  }
  if (!isPaseoToolEnabled(paseoToolPolicy, "create_agent")) {
    return { canCreateAgents: false, unavailableReason: "create_agent_not_allowed" };
  }
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
  const blocked = resolveBlockedByConfig(input.gateReason, input.paseoToolPolicy);
  if (blocked) return blocked;
  const delivered = input.launchContext.paseoTools
    ? input.launchContext.paseoTools.getTool("create_agent") !== undefined
    : hasInternalPaseoMcpServer(input.providerLaunchConfig) && input.sessionSupportsMcpServers;
  return delivered
    ? { canCreateAgents: true }
    : { canCreateAgents: false, unavailableReason: "tools_not_delivered" };
}

/**
 * 还没有会话时，按开关、策略与 client 声明的通道预测新建会话能否调用 create_agent，给新建界面置灰用。
 * 通道要起会话才知道的 provider（如 Pi）返回 null：不预测，建好后由 daemon 按实际判定。
 */
export function predictCreateAgentsCapability(input: {
  gateReason: PaseoToolsGateReason | null;
  paseoToolPolicy: ProviderPaseoToolsPolicy | undefined;
  clientCapabilities: Pick<
    AgentCapabilityFlags,
    "supportsMcpServers" | "supportsNativePaseoTools" | "mcpServersDecidedPerSession"
  >;
}): CreateAgentsCapability | null {
  const blocked = resolveBlockedByConfig(input.gateReason, input.paseoToolPolicy);
  if (blocked) return blocked;
  const { supportsNativePaseoTools, supportsMcpServers, mcpServersDecidedPerSession } =
    input.clientCapabilities;
  if (supportsNativePaseoTools || supportsMcpServers) return { canCreateAgents: true };
  if (mcpServersDecidedPerSession) return null;
  return { canCreateAgents: false, unavailableReason: "tools_not_delivered" };
}
