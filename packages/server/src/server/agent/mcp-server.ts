import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
  CallToolResult,
  ServerNotification,
  ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";

import { addModelVisibleStructuredContent } from "./tools/osuna-tool-serialization.js";
import { createOsunaToolCatalog, type OsunaToolHostDependencies } from "./tools/osuna-tools.js";
import type { OsunaToolResult } from "./tools/types.js";

export type AgentMcpServerOptions = OsunaToolHostDependencies;

type McpToolContext = RequestHandlerExtra<ServerRequest, ServerNotification>;

// Claude、Codex、Pi（pi-mcp-adapter）各自在 tools/call 的 _meta 里放 tool call id 的键。
const PROVIDER_TOOL_CALL_ID_META_KEYS = [
  "claudecode/toolUseId",
  "callId",
  "pi-mcp-adapter/toolCallId",
] as const;

function readProviderToolCallId(context: McpToolContext | undefined): string | undefined {
  const meta: Record<string, unknown> | undefined = context?._meta;
  for (const key of PROVIDER_TOOL_CALL_ID_META_KEYS) {
    const value = meta?.[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function toMcpToolResult(result: OsunaToolResult): CallToolResult {
  const modelVisibleResult = addModelVisibleStructuredContent(result);
  return {
    content: modelVisibleResult.content as CallToolResult["content"],
    ...(modelVisibleResult.structuredContent !== undefined
      ? {
          structuredContent:
            modelVisibleResult.structuredContent as CallToolResult["structuredContent"],
        }
      : {}),
    ...(modelVisibleResult.isError !== undefined ? { isError: modelVisibleResult.isError } : {}),
  };
}

export async function createAgentMcpServer(options: AgentMcpServerOptions): Promise<McpServer> {
  const catalog = await createOsunaToolCatalog(options);
  const server = new McpServer({
    name: "agent-mcp",
    version: "2.0.0",
  });

  for (const tool of catalog.tools.values()) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
      },
      async (args: unknown, context?: McpToolContext) => {
        const providerToolCallId = readProviderToolCallId(context);
        return toMcpToolResult(
          await catalog.executeTool(tool.name, args, {
            signal: context?.signal,
            ...(providerToolCallId ? { providerToolCallId } : {}),
          }),
        );
      },
    );
  }

  return server;
}
