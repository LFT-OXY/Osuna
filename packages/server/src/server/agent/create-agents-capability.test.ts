import { describe, expect, test } from "vitest";
import type { AgentSessionConfig } from "./agent-sdk-types.js";
import {
  predictCreateAgentsCapability,
  resolveCreateAgentsCapability,
} from "./create-agents-capability.js";
import type { OsunaToolCatalog, OsunaToolDefinition } from "./tools/types.js";

const baseConfig: AgentSessionConfig = { provider: "codex", cwd: "/tmp/project" };
const internalOsunaConfig: AgentSessionConfig = {
  ...baseConfig,
  mcpServers: {
    osuna: { type: "http", url: "http://127.0.0.1:6767/mcp/agents?callerAgentId=a" },
  },
};

function catalogWith(toolNames: string[]): OsunaToolCatalog {
  const tools = new Map<string, OsunaToolDefinition>(
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
        osunaToolPolicy: { disabledTools: ["create_agent"] },
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
        osunaToolPolicy: { enabled: false },
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
        osunaToolPolicy: undefined,
        launchContext: { agentId: "a", env: {}, osunaTools: catalogWith(["create_agent"]) },
        providerLaunchConfig: baseConfig,
        sessionSupportsMcpServers: false,
      }),
    ).toEqual({ canCreateAgents: true });
  });

  test("a native catalog without create_agent is not delivered even when MCP is on", () => {
    expect(
      resolveCreateAgentsCapability({
        gateReason: null,
        osunaToolPolicy: undefined,
        launchContext: { agentId: "a", env: {}, osunaTools: catalogWith(["list_agents"]) },
        providerLaunchConfig: internalOsunaConfig,
        sessionSupportsMcpServers: true,
      }),
    ).toEqual({ canCreateAgents: false, unavailableReason: "tools_not_delivered" });
  });

  test("a user-owned server named osuna does not count as delivery", () => {
    expect(
      resolveCreateAgentsCapability({
        gateReason: null,
        osunaToolPolicy: undefined,
        launchContext: { agentId: "a", env: {} },
        providerLaunchConfig: {
          ...baseConfig,
          mcpServers: { osuna: { type: "stdio", command: "my-osuna" } },
        },
        sessionSupportsMcpServers: true,
      }),
    ).toEqual({ canCreateAgents: false, unavailableReason: "tools_not_delivered" });
  });

  test("the internal MCP server needs a session that accepts MCP servers", () => {
    const input = {
      gateReason: null,
      osunaToolPolicy: undefined,
      launchContext: { agentId: "a", env: {} },
      providerLaunchConfig: internalOsunaConfig,
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
        osunaToolPolicy: { enabled: false },
        clientCapabilities,
      }),
    ).toEqual({ canCreateAgents: false, unavailableReason: "tools_not_injected" });
    expect(
      predictCreateAgentsCapability({
        gateReason: null,
        osunaToolPolicy: { disabledTools: ["create_agent"] },
        clientCapabilities,
      }),
    ).toEqual({ canCreateAgents: false, unavailableReason: "create_agent_not_allowed" });
  });

  test("a client with native Osuna tools delivers create_agent without MCP", () => {
    expect(
      predictCreateAgentsCapability({
        gateReason: null,
        osunaToolPolicy: undefined,
        clientCapabilities: { supportsMcpServers: false, supportsNativeOsunaTools: true },
      }),
    ).toEqual({ canCreateAgents: true });
  });

  test("makes no prediction when MCP support is decided per session", () => {
    // Pi 装没装 adapter 要按 cwd 起会话才知道。
    expect(
      predictCreateAgentsCapability({
        gateReason: null,
        osunaToolPolicy: undefined,
        clientCapabilities: { supportsMcpServers: false, mcpServersDecidedPerSession: true },
      }),
    ).toBeNull();
    expect(
      predictCreateAgentsCapability({
        gateReason: "tools_not_injected",
        osunaToolPolicy: undefined,
        clientCapabilities: { supportsMcpServers: false, mcpServersDecidedPerSession: true },
      }),
    ).toEqual({ canCreateAgents: false, unavailableReason: "tools_not_injected" });
  });

  test("a client that cannot take MCP servers predicts tools_not_delivered", () => {
    expect(
      predictCreateAgentsCapability({
        gateReason: null,
        osunaToolPolicy: undefined,
        clientCapabilities: { supportsMcpServers: false },
      }),
    ).toEqual({ canCreateAgents: false, unavailableReason: "tools_not_delivered" });
  });
});
