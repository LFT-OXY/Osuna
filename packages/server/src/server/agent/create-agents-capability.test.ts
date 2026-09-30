import { describe, expect, test } from "vitest";
import type { AgentSessionConfig } from "./agent-sdk-types.js";
import {
  predictCreateAgentsCapability,
  resolveCreateAgentsCapability,
} from "./create-agents-capability.js";
import type { PaseoToolCatalog, PaseoToolDefinition } from "./tools/types.js";

const baseConfig: AgentSessionConfig = { provider: "codex", cwd: "/tmp/project" };
const internalPaseoConfig: AgentSessionConfig = {
  ...baseConfig,
  mcpServers: {
    paseo: { type: "http", url: "http://127.0.0.1:6767/mcp/agents?callerAgentId=a" },
  },
};

function catalogWith(toolNames: string[]): PaseoToolCatalog {
  const tools = new Map<string, PaseoToolDefinition>(
    toolNames.map((name) => [
      name,
      {
        name,
        description: name,
        handler: async () => {
          throw new Error("not used");
        },
      },
    ]),
  );
  return {
    tools,
    getTool: (name) => tools.get(name),
    executeTool: async () => {
      throw new Error("not used");
    },
  };
}

describe("resolveCreateAgentsCapability", () => {
  test("the global gate reason wins over everything else", () => {
    expect(
      resolveCreateAgentsCapability({
        gateReason: "mcp_disabled",
        paseoToolPolicy: { disabledTools: ["create_agent"] },
        launchContext: { agentId: "a", env: {} },
        providerLaunchConfig: baseConfig,
        sessionSupportsMcpServers: false,
      }),
    ).toEqual({ canCreateAgents: false, unavailableReason: "mcp_disabled" });
  });

  test("a disabled policy reports create_agent_not_allowed", () => {
    expect(
      resolveCreateAgentsCapability({
        gateReason: null,
        paseoToolPolicy: { enabled: false },
        launchContext: { agentId: "a", env: {} },
        providerLaunchConfig: baseConfig,
        sessionSupportsMcpServers: true,
      }),
    ).toEqual({ canCreateAgents: false, unavailableReason: "create_agent_not_allowed" });
  });

  test("a native catalog that binds create_agent can create agents", () => {
    expect(
      resolveCreateAgentsCapability({
        gateReason: null,
        paseoToolPolicy: undefined,
        launchContext: { agentId: "a", env: {}, paseoTools: catalogWith(["create_agent"]) },
        providerLaunchConfig: baseConfig,
        sessionSupportsMcpServers: false,
      }),
    ).toEqual({ canCreateAgents: true });
  });

  test("a native catalog without create_agent is not delivered even when MCP is on", () => {
    expect(
      resolveCreateAgentsCapability({
        gateReason: null,
        paseoToolPolicy: undefined,
        launchContext: { agentId: "a", env: {}, paseoTools: catalogWith(["list_agents"]) },
        providerLaunchConfig: internalPaseoConfig,
        sessionSupportsMcpServers: true,
      }),
    ).toEqual({ canCreateAgents: false, unavailableReason: "tools_not_delivered" });
  });

  test("a user-owned server named paseo does not count as delivery", () => {
    expect(
      resolveCreateAgentsCapability({
        gateReason: null,
        paseoToolPolicy: undefined,
        launchContext: { agentId: "a", env: {} },
        providerLaunchConfig: {
          ...baseConfig,
          mcpServers: { paseo: { type: "stdio", command: "my-paseo" } },
        },
        sessionSupportsMcpServers: true,
      }),
    ).toEqual({ canCreateAgents: false, unavailableReason: "tools_not_delivered" });
  });

  test("the internal MCP server needs a session that accepts MCP servers", () => {
    const input = {
      gateReason: null,
      paseoToolPolicy: undefined,
      launchContext: { agentId: "a", env: {} },
      providerLaunchConfig: internalPaseoConfig,
    };
    expect(resolveCreateAgentsCapability({ ...input, sessionSupportsMcpServers: true })).toEqual({
      canCreateAgents: true,
    });
    expect(resolveCreateAgentsCapability({ ...input, sessionSupportsMcpServers: false })).toEqual({
      canCreateAgents: false,
      unavailableReason: "tools_not_delivered",
    });
  });
});

describe("predictCreateAgentsCapability", () => {
  test("checks the global gate, then the provider policy", () => {
    const clientCapabilities = { supportsMcpServers: true };
    expect(
      predictCreateAgentsCapability({
        gateReason: "tools_not_injected",
        paseoToolPolicy: { enabled: false },
        clientCapabilities,
      }),
    ).toEqual({ canCreateAgents: false, unavailableReason: "tools_not_injected" });
    expect(
      predictCreateAgentsCapability({
        gateReason: null,
        paseoToolPolicy: { disabledTools: ["create_agent"] },
        clientCapabilities,
      }),
    ).toEqual({ canCreateAgents: false, unavailableReason: "create_agent_not_allowed" });
  });

  test("a client with native Paseo tools delivers create_agent without MCP", () => {
    expect(
      predictCreateAgentsCapability({
        gateReason: null,
        paseoToolPolicy: undefined,
        clientCapabilities: { supportsMcpServers: false, supportsNativePaseoTools: true },
      }),
    ).toEqual({ canCreateAgents: true });
  });

  test("makes no prediction when MCP support is decided per session", () => {
    // Pi 装没装 adapter 要按 cwd 起会话才知道。
    expect(
      predictCreateAgentsCapability({
        gateReason: null,
        paseoToolPolicy: undefined,
        clientCapabilities: { supportsMcpServers: false, mcpServersDecidedPerSession: true },
      }),
    ).toBeNull();
    expect(
      predictCreateAgentsCapability({
        gateReason: "tools_not_injected",
        paseoToolPolicy: undefined,
        clientCapabilities: { supportsMcpServers: false, mcpServersDecidedPerSession: true },
      }),
    ).toEqual({ canCreateAgents: false, unavailableReason: "tools_not_injected" });
  });

  test("a client that cannot take MCP servers predicts tools_not_delivered", () => {
    expect(
      predictCreateAgentsCapability({
        gateReason: null,
        paseoToolPolicy: undefined,
        clientCapabilities: { supportsMcpServers: false },
      }),
    ).toEqual({ canCreateAgents: false, unavailableReason: "tools_not_delivered" });
  });
});
