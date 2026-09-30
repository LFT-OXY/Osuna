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

export const ApiEndpointSchema = z.object({
  id: z.string(),
  provider: z.string(),
  name: z.string(),
  baseUrl: z.string(),
  models: z.array(ApiEndpointModelSchema),
  defaultModelId: z.string(),
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
 * 新建时 apiKey 必填。
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
