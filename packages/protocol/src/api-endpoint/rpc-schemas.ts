import { z } from "zod";

/*
 * 第三方接口（API endpoint）：Claude Code / Codex 在「官方」和一个保存的第三方接口之间切换。
 * provider 用字符串而非枚举，以后支持更多提供方时老客户端照常解析。
 * API key 只会出现在 save 请求里；任何响应都只带 hasApiKey。
 */

export const ApiEndpointModelSchema = z.object({
  id: z.string(),
  label: z.string().optional(),
});
export type ApiEndpointModel = z.infer<typeof ApiEndpointModelSchema>;

/**
 * Claude 的模型映射：每档写进 settings.json 的 ANTHROPIC_DEFAULT_<档位>_MODEL，只改写 `/model opus` 这类别名。
 * 每档都是勾选的模型之一；没有的档位不写。Codex 接口没有映射。
 */
export const API_ENDPOINT_MODEL_TIERS = ["opus", "sonnet", "haiku", "fable"] as const;
export type ApiEndpointModelTier = (typeof API_ENDPOINT_MODEL_TIERS)[number];

/** 有模型映射的提供方；App 据此显示映射区，daemon 据此拒绝其他提供方的映射。 */
const MODEL_MAPPING_PROVIDERS: ReadonlySet<string> = new Set(["claude"]);

export function apiEndpointHasModelMapping(provider: string): boolean {
  return MODEL_MAPPING_PROVIDERS.has(provider);
}

export const ApiEndpointModelMappingSchema = z.object({
  opus: z.string().optional(),
  sonnet: z.string().optional(),
  haiku: z.string().optional(),
  fable: z.string().optional(),
});
export type ApiEndpointModelMapping = z.infer<typeof ApiEndpointModelMappingSchema>;

export const ApiEndpointSchema = z.object({
  id: z.string(),
  provider: z.string(),
  name: z.string(),
  baseUrl: z.string(),
  models: z.array(ApiEndpointModelSchema),
  defaultModelId: z.string(),
  modelMapping: ApiEndpointModelMappingSchema.optional(),
  hasApiKey: z.boolean(),
});
export type ApiEndpoint = z.infer<typeof ApiEndpointSchema>;

/** `code` 是字符串，daemon 新增错误码时老客户端照常解析并显示 message。 */
export const ApiEndpointErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
});
export type ApiEndpointError = z.infer<typeof ApiEndpointErrorSchema>;

export const ApiEndpointListRequestSchema = z.object({
  type: z.literal("provider.api_endpoint.list.request"),
  requestId: z.string(),
  provider: z.string(),
});
export type ApiEndpointListRequest = z.infer<typeof ApiEndpointListRequestSchema>;

/** `activeEndpointId: null` 表示「官方」。 */
export const ApiEndpointListResponseSchema = z.object({
  type: z.literal("provider.api_endpoint.list.response"),
  payload: z.object({
    requestId: z.string(),
    provider: z.string(),
    endpoints: z.array(ApiEndpointSchema),
    activeEndpointId: z.string().nullable(),
    error: ApiEndpointErrorSchema.nullable(),
  }),
});
export type ApiEndpointListResponse = z.infer<typeof ApiEndpointListResponseSchema>;

/**
 * 没有 endpointId 是新建，有则更新。更新时省略 apiKey 表示保留原 key；
 * 新建时 apiKey 必填。modelMapping 每次都整份提交，省略即不映射。
 */
export const ApiEndpointSaveRequestSchema = z.object({
  type: z.literal("provider.api_endpoint.save.request"),
  requestId: z.string(),
  provider: z.string(),
  endpointId: z.string().optional(),
  name: z.string(),
  baseUrl: z.string(),
  apiKey: z.string().optional(),
  models: z.array(ApiEndpointModelSchema),
  defaultModelId: z.string(),
  modelMapping: ApiEndpointModelMappingSchema.optional(),
});
export type ApiEndpointSaveRequest = z.infer<typeof ApiEndpointSaveRequestSchema>;

export const ApiEndpointSaveResponseSchema = z.object({
  type: z.literal("provider.api_endpoint.save.response"),
  payload: z.object({
    requestId: z.string(),
    endpoint: ApiEndpointSchema.nullable(),
    error: ApiEndpointErrorSchema.nullable(),
  }),
});
export type ApiEndpointSaveResponse = z.infer<typeof ApiEndpointSaveResponseSchema>;

/** 删除当前启用的接口时，daemon 先切回官方再删除。 */
export const ApiEndpointDeleteRequestSchema = z.object({
  type: z.literal("provider.api_endpoint.delete.request"),
  requestId: z.string(),
  provider: z.string(),
  endpointId: z.string(),
});
export type ApiEndpointDeleteRequest = z.infer<typeof ApiEndpointDeleteRequestSchema>;

export const ApiEndpointDeleteResponseSchema = z.object({
  type: z.literal("provider.api_endpoint.delete.response"),
  payload: z.object({
    requestId: z.string(),
    activeEndpointId: z.string().nullable(),
    error: ApiEndpointErrorSchema.nullable(),
  }),
});
export type ApiEndpointDeleteResponse = z.infer<typeof ApiEndpointDeleteResponseSchema>;

/** `endpointId: null` 表示切回「官方」。 */
export const ApiEndpointSetActiveRequestSchema = z.object({
  type: z.literal("provider.api_endpoint.set_active.request"),
  requestId: z.string(),
  provider: z.string(),
  endpointId: z.string().nullable(),
});
export type ApiEndpointSetActiveRequest = z.infer<typeof ApiEndpointSetActiveRequestSchema>;

export const ApiEndpointSetActiveResponseSchema = z.object({
  type: z.literal("provider.api_endpoint.set_active.response"),
  payload: z.object({
    requestId: z.string(),
    activeEndpointId: z.string().nullable(),
    error: ApiEndpointErrorSchema.nullable(),
  }),
});
export type ApiEndpointSetActiveResponse = z.infer<typeof ApiEndpointSetActiveResponseSchema>;

/**
 * daemon 在主机上向上游列出模型，key 不经过客户端。编辑已保存的接口时带 endpointId、
 * 省略 apiKey（或留空），就用已保存的 key。可以用 cancel 按 requestId 取消。
 */
export const ApiEndpointFetchModelsRequestSchema = z.object({
  type: z.literal("provider.api_endpoint.fetch_models.request"),
  requestId: z.string(),
  provider: z.string(),
  endpointId: z.string().optional(),
  baseUrl: z.string(),
  apiKey: z.string().optional(),
});
export type ApiEndpointFetchModelsRequest = z.infer<typeof ApiEndpointFetchModelsRequestSchema>;

export const ApiEndpointFetchModelsResponseSchema = z.object({
  type: z.literal("provider.api_endpoint.fetch_models.response"),
  payload: z.object({
    requestId: z.string(),
    models: z.array(ApiEndpointModelSchema),
    error: ApiEndpointErrorSchema.nullable(),
  }),
});
export type ApiEndpointFetchModelsResponse = z.infer<typeof ApiEndpointFetchModelsResponseSchema>;

/**
 * 取消同一连接上还在进行的上游请求；被取消的请求照常回一条 error.code 为 cancelled 的响应。
 * `cancelled: false` 表示那条请求已经结束或不存在。
 */
export const ApiEndpointCancelRequestSchema = z.object({
  type: z.literal("provider.api_endpoint.cancel.request"),
  requestId: z.string(),
  targetRequestId: z.string(),
});
export type ApiEndpointCancelRequest = z.infer<typeof ApiEndpointCancelRequestSchema>;

export const ApiEndpointCancelResponseSchema = z.object({
  type: z.literal("provider.api_endpoint.cancel.response"),
  payload: z.object({
    requestId: z.string(),
    cancelled: z.boolean(),
  }),
});
export type ApiEndpointCancelResponse = z.infer<typeof ApiEndpointCancelResponseSchema>;
