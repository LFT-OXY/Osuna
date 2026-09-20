import type { z } from "zod";
import type { ProviderOsunaToolsPolicy } from "@osuna/protocol/provider-config";

export interface OsunaToolExecutionContext {
  signal?: AbortSignal;
  sendUpdate?: (update: OsunaToolResult) => void;
}

export interface OsunaToolResult {
  content: Array<{ type: string; text?: string; [key: string]: unknown }>;
  structuredContent?: unknown;
  isError?: boolean;
}

export interface OsunaToolConfig {
  title?: string;
  description?: string;
  inputSchema?: z.ZodRawShape | z.ZodType;
  outputSchema?: z.ZodRawShape;
}

export interface OsunaToolDefinition extends OsunaToolConfig {
  name: string;
  description: string;
  handler: (input: unknown, context: OsunaToolExecutionContext) => Promise<OsunaToolResult>;
}

export interface OsunaToolCatalog {
  tools: ReadonlyMap<string, OsunaToolDefinition>;
  getTool(name: string): OsunaToolDefinition | undefined;
  executeTool(
    name: string,
    input: unknown,
    context?: OsunaToolExecutionContext,
  ): Promise<OsunaToolResult>;
}

export interface OsunaToolRuntimeContext {
  callerAgentId?: string;
  osunaToolPolicy?: ProviderOsunaToolsPolicy;
  enableVoiceTools?: boolean;
  voiceOnly?: boolean;
}

export type OsunaToolCatalogFactory = (
  context: OsunaToolRuntimeContext,
) => OsunaToolCatalog | Promise<OsunaToolCatalog>;
