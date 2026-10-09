import type { ProviderOsunaToolsPolicy } from "@osuna/protocol/provider-config";
import type {
  AgentCapabilityFlags,
  AgentLaunchContext,
  AgentSessionConfig,
} from "./agent-sdk-types.js";
import { isOsunaToolEnabled } from "./osuna-tool-policy.js";
import { hasInternalOsunaMcpServer } from "./runtime-mcp-config.js";

export type OsunaToolsGateReason = "mcp_disabled" | "tools_not_injected";

export type CreateAgentsUnavailableReason =
  | OsunaToolsGateReason
  | "create_agent_not_allowed"
  | "tools_not_delivered";

export type CreateAgentsCapability =
  | { canCreateAgents: true }
  | { canCreateAgents: false; unavailableReason: CreateAgentsUnavailableReason };

export interface OsunaToolsGate {
  mcpEnabled: boolean;
  injectIntoAgents: boolean;
}

export function resolveOsunaToolsGateReason(gate: OsunaToolsGate): OsunaToolsGateReason | null {
  if (!gate.mcpEnabled) return "mcp_disabled";
  if (!gate.injectIntoAgents) return "tools_not_injected";
  return null;
}

function resolveBlockedByConfig(
  gateReason: OsunaToolsGateReason | null,
  osunaToolPolicy: ProviderOsunaToolsPolicy | undefined,
): CreateAgentsCapability | null {
  if (gateReason) {
    return { canCreateAgents: false, unavailableReason: gateReason };
  }
  if (!isOsunaToolEnabled(osunaToolPolicy, "create_agent")) {
    return { canCreateAgents: false, unavailableReason: "create_agent_not_allowed" };
  }
  return null;
}

/**
 * 判定一个刚启动的会话能否调用 create_agent。原生通道只认会话绑定的目录
 * （OpenCode 的 bridge manifest 不带策略，不算数）；MCP 通道要求注入了内部
 * osuna 服务器且会话确实接受 MCP 配置。
 */
export function resolveCreateAgentsCapability(input: {
  gateReason: OsunaToolsGateReason | null;
  osunaToolPolicy: ProviderOsunaToolsPolicy | undefined;
  launchContext: AgentLaunchContext;
  providerLaunchConfig: AgentSessionConfig;
  sessionSupportsMcpServers: boolean;
}): CreateAgentsCapability {
  const blocked = resolveBlockedByConfig(input.gateReason, input.osunaToolPolicy);
  if (blocked) return blocked;
  const delivered = input.launchContext.osunaTools
    ? input.launchContext.osunaTools.getTool("create_agent") !== undefined
    : hasInternalOsunaMcpServer(input.providerLaunchConfig) && input.sessionSupportsMcpServers;
  return delivered
    ? { canCreateAgents: true }
    : { canCreateAgents: false, unavailableReason: "tools_not_delivered" };
}

/**
 * 还没有会话时，按开关、策略与 client 声明的通道预测新建会话能否调用 create_agent，给新建界面置灰用。
 * 通道要起会话才知道的 provider（如 Pi）返回 null：不预测，建好后由 daemon 按实际判定。
 */
export function predictCreateAgentsCapability(input: {
  gateReason: OsunaToolsGateReason | null;
  osunaToolPolicy: ProviderOsunaToolsPolicy | undefined;
  clientCapabilities: Pick<
    AgentCapabilityFlags,
    "supportsMcpServers" | "supportsNativeOsunaTools" | "mcpServersDecidedPerSession"
  >;
}): CreateAgentsCapability | null {
  const blocked = resolveBlockedByConfig(input.gateReason, input.osunaToolPolicy);
  if (blocked) return blocked;
  const { supportsNativeOsunaTools, supportsMcpServers, mcpServersDecidedPerSession } =
    input.clientCapabilities;
  if (supportsNativeOsunaTools || supportsMcpServers) return { canCreateAgents: true };
  if (mcpServersDecidedPerSession) return null;
  return { canCreateAgents: false, unavailableReason: "tools_not_delivered" };
}
