import type { z } from "zod";
import type { ProviderPaseoToolsPolicy } from "@getpaseo/protocol/provider-config";

export interface PaseoToolExecutionContext {
  signal?: AbortSignal;
  sendUpdate?: (update: PaseoToolResult) => void;
  // provider 侧这次工具调用的 id，与父时间线条目的 callId 相同；由各通道边界读出。
  providerToolCallId?: string;
}

export interface PaseoToolResult {
  content: Array<{ type: string; text?: string; [key: string]: unknown }>;
  structuredContent?: unknown;
  isError?: boolean;
}

export interface PaseoToolConfig {
  title?: string;
  description?: string;
  inputSchema?: z.ZodRawShape | z.ZodType;
  outputSchema?: z.ZodRawShape;
}

export interface PaseoToolDefinition extends PaseoToolConfig {
  name: string;
  description: string;
  handler: (input: unknown, context: PaseoToolExecutionContext) => Promise<PaseoToolResult>;
}

export interface PaseoToolCatalog {
  tools: ReadonlyMap<string, PaseoToolDefinition>;
  getTool(name: string): PaseoToolDefinition | undefined;
  executeTool(
    name: string,
    input: unknown,
    context?: PaseoToolExecutionContext,
  ): Promise<PaseoToolResult>;
}

export interface PaseoToolRuntimeContext {
  callerAgentId?: string;
  paseoToolPolicy?: ProviderPaseoToolsPolicy;
  enableVoiceTools?: boolean;
  voiceOnly?: boolean;
}

export type PaseoToolCatalogFactory = (
  context: PaseoToolRuntimeContext,
) => PaseoToolCatalog | Promise<PaseoToolCatalog>;
