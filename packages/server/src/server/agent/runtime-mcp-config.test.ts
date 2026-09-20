import { describe, expect, test } from "vitest";

import type { AgentSessionConfig } from "./agent-sdk-types.js";
import { stripInternalOsunaMcpServer, withRuntimeOsunaMcpServer } from "./runtime-mcp-config.js";

const BASE_CONFIG: AgentSessionConfig = {
  provider: "claude",
  cwd: "/tmp/agent",
};

describe("withRuntimeOsunaMcpServer", () => {
  test("injects the osuna MCP server with a bearer header when a token is provided", () => {
    const result = withRuntimeOsunaMcpServer({
      config: BASE_CONFIG,
      agentId: "agent-1",
      mcpBaseUrl: "http://127.0.0.1:6767/mcp/agents",
      mcpAuthToken: "cap-token",
    });

    expect(result.mcpServers?.osuna).toEqual({
      type: "http",
      url: "http://127.0.0.1:6767/mcp/agents?callerAgentId=agent-1",
      headers: { Authorization: "Bearer cap-token" },
    });
  });

  test("omits the header when no token is available", () => {
    const result = withRuntimeOsunaMcpServer({
      config: BASE_CONFIG,
      agentId: "agent-1",
      mcpBaseUrl: "http://127.0.0.1:6767/mcp/agents",
      mcpAuthToken: null,
    });

    expect(result.mcpServers?.osuna).toEqual({
      type: "http",
      url: "http://127.0.0.1:6767/mcp/agents?callerAgentId=agent-1",
    });
  });

  test("does not inject when no MCP base URL is configured", () => {
    const result = withRuntimeOsunaMcpServer({
      config: BASE_CONFIG,
      agentId: "agent-1",
      mcpBaseUrl: null,
      mcpAuthToken: "cap-token",
    });

    expect(result.mcpServers).toBeUndefined();
  });
});

describe("stripInternalOsunaMcpServer", () => {
  // Configs stored before the rename hold the daemon's own MCP server under the
  // old key. Keying the lookup off the current name leaves it in the user's
  // config, where the agent would dial a daemon address that is long gone.
  test("drops the daemon's own MCP server whatever key it was stored under", () => {
    const result = stripInternalOsunaMcpServer({
      ...BASE_CONFIG,
      mcpServers: {
        osuna: { type: "http", url: "http://127.0.0.1:6767/mcp/agents?callerAgentId=agent-1" },
        docs: { type: "http", url: "https://example.com/mcp" },
      },
    });

    expect(result.mcpServers).toEqual({ docs: { type: "http", url: "https://example.com/mcp" } });
  });
});
