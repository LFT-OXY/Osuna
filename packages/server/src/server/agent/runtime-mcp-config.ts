import type { AgentSessionConfig, McpServerConfig } from "./agent-sdk-types.js";

const OSUNA_MCP_SERVER_NAME = "osuna";
const OSUNA_MCP_PATHNAME = "/mcp/agents";

export function stripInternalPaseoMcpServer(config: AgentSessionConfig): AgentSessionConfig {
  const mcpServers = config.mcpServers;
  if (!mcpServers) {
    return config;
  }

  // Claim the entry by its URL, not by its key: configs stored before the CLI
  // rename hold this same server under the old name, and a key-based lookup
  // would leave it in the user's config pointing at a daemon address long gone.
  const kept = Object.entries(mcpServers).filter(([, server]) => !isInternalPaseoMcpServer(server));
  if (kept.length === Object.keys(mcpServers).length) {
    return config;
  }

  const next = { ...config };
  if (kept.length > 0) {
    next.mcpServers = Object.fromEntries(kept);
  } else {
    delete next.mcpServers;
  }
  return next;
}

export function withRuntimePaseoMcpServer(params: {
  config: AgentSessionConfig;
  agentId: string;
  mcpBaseUrl: string | null;
  /**
   * Capability token authenticating the injected connection to the daemon's
   * Agent MCP endpoint. The daemon password is gated off this route, so without
   * this header the agent's MCP requests are rejected when a password is set.
   */
  mcpAuthToken: string | null;
}): AgentSessionConfig {
  const storedConfig = stripInternalPaseoMcpServer(params.config);
  if (!params.mcpBaseUrl || storedConfig.mcpServers?.[OSUNA_MCP_SERVER_NAME]) {
    return storedConfig;
  }

  return {
    ...storedConfig,
    mcpServers: {
      [OSUNA_MCP_SERVER_NAME]: {
        type: "http",
        url: `${params.mcpBaseUrl}?callerAgentId=${params.agentId}`,
        ...(params.mcpAuthToken
          ? { headers: { Authorization: `Bearer ${params.mcpAuthToken}` } }
          : {}),
      },
      ...storedConfig.mcpServers,
    },
  };
}

function isInternalPaseoMcpServer(config: McpServerConfig): boolean {
  if (config.type !== "http" && config.type !== "sse") {
    return false;
  }

  try {
    return new URL(config.url).pathname === OSUNA_MCP_PATHNAME;
  } catch {
    return false;
  }
}
