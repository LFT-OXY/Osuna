// 部分逻辑移植自 magpie（https://github.com/yetone/magpie，internal/provider/detect.go、test.go）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import {
  API_ENDPOINT_REQUEST_FORMATS,
  type ApiEndpointFormatDetection,
  type ApiEndpointRequestFormat,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { isClaudeModel } from "./gateway/routing.js";
import { fetchUpstreamModels } from "./upstream-models.js";
import {
  ANTHROPIC_VERSION,
  describeNetworkError,
  extractErrorDetail,
  isRecord,
  parseJson,
} from "./upstream-http.js";

/*
 * 自动检测请求格式（照 magpie internal/provider/detect.go）：从用户填的一个地址推出每种格式的地址，
 * 先向上游列一次模型挑人选（列模型不花钱），再每种格式各发一条最小对话请求，回应正常的就算这家支持。
 * 列模型就被拒（401 / 403）时三种都算 key 无效，不再发对话请求。
 */

export type DetectOutcome =
  | { kind: "result"; results: ApiEndpointFormatDetection[] }
  | { kind: "cancelled" };

interface FormatProbe {
  // 接在这种格式的地址后面。
  path: string;
  headers(apiKey: string): Record<string, string>;
  body(modelId: string): Record<string, unknown>;
  // 2xx 的响应体确实是这种格式的结果；否则地址背后是别的东西。
  matches(body: unknown): boolean;
}

// 和中转站请求上游时一样：Anthropic 地址两种认证头都带，OpenAI 两种以 /v1 结尾。
const FORMAT_PROBES: Record<ApiEndpointRequestFormat, FormatProbe> = {
  anthropic_messages: {
    path: "/v1/messages",
    headers: (apiKey) => ({
      authorization: `Bearer ${apiKey}`,
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    }),
    body: (modelId) => ({
      model: modelId,
      max_tokens: 16,
      messages: [{ role: "user", content: "hi" }],
    }),
    matches: (body) => isRecord(body) && (body.type === "message" || Array.isArray(body.content)),
  },
  openai_chat: {
    path: "/chat/completions",
    headers: (apiKey) => ({ authorization: `Bearer ${apiKey}` }),
    body: (modelId) => ({
      model: modelId,
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 16,
    }),
    matches: (body) => isRecord(body) && Array.isArray(body.choices),
  },
  openai_responses: {
    path: "/responses",
    headers: (apiKey) => ({ authorization: `Bearer ${apiKey}` }),
    // 不带 max_output_tokens：Codex 自己不发它，有的中转站会拒绝这个参数。
    body: (modelId) => ({
      model: modelId,
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }],
    }),
    matches: (body) => isRecord(body) && (body.object === "response" || Array.isArray(body.output)),
  },
};

const PASTED_ENDPOINT_SUFFIXES = ["/chat/completions", "/responses", "/v1/messages", "/messages"];
const VERSION_SEGMENT = /\/v\d+[a-z]*$/i;

/**
 * 每种格式的建议地址：整段粘进来的接口地址先剪到 base；Anthropic 取不带 /v1 的根（CLI 自己拼 /v1/messages），
 * OpenAI 两种以版本段结尾，没有就补 /v1。
 */
export function suggestedBaseUrls(baseUrl: string): Record<ApiEndpointRequestFormat, string> {
  let base = baseUrl.trim().replace(/\/+$/, "");
  for (const suffix of PASTED_ENDPOINT_SUFFIXES) {
    if (base.endsWith(suffix)) base = base.slice(0, -suffix.length);
  }
  const anthropic = base.replace(/\/v1$/, "");
  const openai = VERSION_SEGMENT.test(base) ? base : `${base}/v1`;
  return { anthropic_messages: anthropic, openai_chat: openai, openai_responses: openai };
}

export async function detectUpstreamFormats(input: {
  baseUrl: string;
  apiKey: string;
  // 调用方取消（客户端取消或断开）。
  signal: AbortSignal;
  modelsTimeoutMs: number;
  probeTimeoutMs: number;
}): Promise<DetectOutcome> {
  const urls = suggestedBaseUrls(input.baseUrl);
  const listed = await fetchUpstreamModels({
    // claude 的请求头两种认证都带，也认 Anthropic 的分页。
    provider: "claude",
    baseUrl: urls.anthropic_messages,
    apiKey: input.apiKey,
    signal: input.signal,
    timeoutMs: input.modelsTimeoutMs,
  });
  if (!listed.ok) {
    if (listed.error.code === "cancelled") return { kind: "cancelled" };
    const httpStatus = listed.error.status ?? null;
    const rejected = httpStatus === 401 || httpStatus === 403;
    // 列模型就被拒：三种格式都是这把 key 的问题；其余失败是没有模型可问。
    const outcome: Pick<ApiEndpointFormatDetection, "status" | "httpStatus" | "message"> = rejected
      ? { status: "auth_failed", httpStatus, message: listed.error.message }
      : {
          status: "not_detected",
          httpStatus: null,
          message: `Could not list models to try: ${listed.error.message}`,
        };
    return {
      kind: "result",
      results: API_ENDPOINT_REQUEST_FORMATS.map((format) => ({
        format,
        url: urls[format],
        ...outcome,
      })),
    };
  }
  const modelIds = listed.models.map((model) => model.id);
  const results = await Promise.all(
    API_ENDPOINT_REQUEST_FORMATS.map((format) =>
      probeUpstreamFormat({
        format,
        baseUrl: urls[format],
        apiKey: input.apiKey,
        modelId: pickProbeModel(modelIds, format),
        signal: input.signal,
        timeoutMs: input.probeTimeoutMs,
      }),
    ),
  );
  if (input.signal.aborted) return { kind: "cancelled" };
  return { kind: "result", results };
}

/** 用一个模型向一种格式的地址发一条最小对话请求，回这种格式的检测结果。 */
export async function probeUpstreamFormat(input: {
  format: ApiEndpointRequestFormat;
  baseUrl: string;
  apiKey: string;
  modelId: string | null;
  signal: AbortSignal;
  timeoutMs: number;
}): Promise<ApiEndpointFormatDetection> {
  const { format, baseUrl } = input;
  const result = (
    status: ApiEndpointFormatDetection["status"],
    httpStatus: number | null,
    message: string | null,
  ): ApiEndpointFormatDetection => ({
    format,
    url: baseUrl,
    status,
    httpStatus,
    message: message === null ? null : message.replaceAll(input.apiKey, "***"),
  });
  if (input.modelId === null) {
    return result("not_detected", null, "The upstream listed no models to try");
  }
  const probe = FORMAT_PROBES[format];
  const url = `${baseUrl}${probe.path}`;
  const timeout = AbortSignal.timeout(input.timeoutMs);
  let status: number;
  let text: string;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...probe.headers(input.apiKey),
      },
      body: JSON.stringify(probe.body(input.modelId)),
      signal: AbortSignal.any([input.signal, timeout]),
    });
    status = response.status;
    text = await response.text();
  } catch (error) {
    if (timeout.aborted && !input.signal.aborted) {
      const seconds = Math.round(input.timeoutMs / 1000);
      return result("not_detected", null, `No response from ${url} within ${seconds}s`);
    }
    return result("not_detected", null, `POST ${url}: ${describeNetworkError(error)}`);
  }
  const prefix = `POST ${url}: HTTP ${status}`;
  if (status >= 200 && status < 300) {
    if (probe.matches(parseJson(text))) return result("ok", status, null);
    return result("not_detected", status, `${prefix}: not a ${format} response`);
  }
  const detail = extractErrorDetail(text, input.apiKey);
  const message = detail ? `${prefix}: ${detail}` : prefix;
  return result(status === 401 || status === 403 ? "auth_failed" : "not_detected", status, message);
}

// OpenAI 自家模型名的前缀（magpie internal/agent/icons.go 的 gpt 家族）。
const OPENAI_MODEL = /^(gpt|o1|o3|o4|codex)/i;

/**
 * 给一种格式挑要问的模型（magpie 的 detectModel）：Anthropic 问 Claude 模型，Responses 问 OpenAI 模型，
 * Chat 问非 Claude 的；挑不到就取第一个。详情页按格式测试连接也用它挑。
 */
export function pickProbeModel(ids: string[], format: ApiEndpointRequestFormat): string | null {
  const madeFor = (id: string): boolean => {
    const bare = id.slice(id.lastIndexOf("/") + 1);
    if (format === "anthropic_messages") return isClaudeModel(id);
    if (format === "openai_responses") return OPENAI_MODEL.test(bare);
    return !isClaudeModel(id);
  };
  return ids.find(madeFor) ?? ids[0] ?? null;
}
