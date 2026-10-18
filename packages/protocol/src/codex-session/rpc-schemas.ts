import { z } from "zod";

/*
 * 把 Codex 对话挪到另一个 Codex 服务商（ADR 0011，照 magpie 的 MoveCodexProvider）。
 * 只有新客户端在 server_info.features.apiEndpointCliWiring 为 true 时才发这两个请求。
 * 原因、来源等用字符串而非枚举：以后加新值时老客户端照常解析。
 */

/**
 * 续 Codex 对话失败、因为它记的 Codex 服务商已不在 Codex 设置里（Codex 报 ``Model provider `…` not found``）：
 * 导入失败的 `agent_create_failed.errorCode` 带这个值，app 据此给出「挪到另一个 Codex 服务商」，不去匹配英文原文。
 * 老 daemon 不发，老客户端忽略。
 */
export const CODEX_MODEL_PROVIDER_MISSING_ERROR_CODE = "codex_model_provider_missing";

export const CodexSessionErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
});
export type CodexSessionError = z.infer<typeof CodexSessionErrorSchema>;

/**
 * 能挪去的 Codex 服务商。`source`：builtin（内置 openai）、osuna（Osuna 自己的服务商）、
 * config（config.toml 里 [model_providers.<id>] 的表）。`name` 是表里写的 name，没写就没有。
 * `unavailableReason` 有值时不能选：no_table 表示 config.toml 里没有这张表，挪过去的对话续不上。
 */
export const CodexSessionModelProviderSchema = z.object({
  id: z.string(),
  source: z.string(),
  name: z.string().optional(),
  unavailableReason: z.string().optional(),
});
export type CodexSessionModelProvider = z.infer<typeof CodexSessionModelProviderSchema>;

export const CodexSessionListModelProvidersRequestSchema = z.object({
  type: z.literal("provider.codex.session.list_model_providers.request"),
  requestId: z.string(),
  // 会话历史里这一行的提供方（codex 或派生自它的自定义提供方）：读的是它的 CODEX_HOME 里的 config.toml。
  providerId: z.string(),
});
export type CodexSessionListModelProvidersRequest = z.infer<
  typeof CodexSessionListModelProvidersRequestSchema
>;

export const CodexSessionListModelProvidersResponseSchema = z.object({
  type: z.literal("provider.codex.session.list_model_providers.response"),
  payload: z.object({
    requestId: z.string(),
    modelProviders: z.array(CodexSessionModelProviderSchema),
    error: CodexSessionErrorSchema.nullable(),
  }),
});
export type CodexSessionListModelProvidersResponse = z.infer<
  typeof CodexSessionListModelProvidersResponseSchema
>;

export const CodexSessionMoveModelProviderRequestSchema = z.object({
  type: z.literal("provider.codex.session.move_model_provider.request"),
  requestId: z.string(),
  // 会话历史列出这些对话的提供方：在它的 CODEX_HOME 里找对话文件与状态库。
  providerId: z.string(),
  threadIds: z.array(z.string()),
  to: z.string(),
});
export type CodexSessionMoveModelProviderRequest = z.infer<
  typeof CodexSessionMoveModelProviderRequestSchema
>;

/** 挪好的一段对话：原服务商、改过的对话文件、改过的状态库、这次的备份目录。 */
export const CodexSessionMovedSchema = z.object({
  threadId: z.string(),
  from: z.string().nullable(),
  files: z.array(z.string()),
  stateDatabases: z.array(z.string()),
  backupPath: z.string(),
});
export type CodexSessionMoved = z.infer<typeof CodexSessionMovedSchema>;

/**
 * 没挪完的一段对话。`reason`：active（一分钟内写过，什么都没动）、not_found（找不到对话文件）、
 * failed（改对话文件时失败，已改的文件已用备份改回）、state_database_failed（对话文件已挪，
 * 某个状态库没改成，照 magpie 不回滚）。`message` 是 daemon 的原话；做过备份时带 `backupPath`。
 */
export const CodexSessionMoveSkippedSchema = z.object({
  threadId: z.string(),
  reason: z.string(),
  message: z.string(),
  backupPath: z.string().optional(),
});
export type CodexSessionMoveSkipped = z.infer<typeof CodexSessionMoveSkippedSchema>;

export const CodexSessionMoveModelProviderResponseSchema = z.object({
  type: z.literal("provider.codex.session.move_model_provider.response"),
  payload: z.object({
    requestId: z.string(),
    to: z.string(),
    moved: z.array(CodexSessionMovedSchema),
    skipped: z.array(CodexSessionMoveSkippedSchema),
    error: CodexSessionErrorSchema.nullable(),
  }),
});
export type CodexSessionMoveModelProviderResponse = z.infer<
  typeof CodexSessionMoveModelProviderResponseSchema
>;
