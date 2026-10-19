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
  redactKey,
} from "./upstream-http.js";
import { keyHeaderValues, type KeyHeaders } from "./gateway/refusals.js";
import { templateKeyHeaders } from "./templates.js";
import { asCompletionTokens, takesCompletionTokens } from "./gateway/template-rewrites.js";

/*
 * 自动检测请求格式（照 magpie internal/provider/detect.go）：从用户填的一个地址推出每种格式的地址，
 * 每种格式各发一条最小对话请求，回应正常的就算这家支持。问哪个模型：用户填的试用模型每种格式都问它；
 * 没填时按格式从表单里已选的模型挑，也没有才向上游列一次模型挑人选（列模型不花钱）。
 * 列模型就被拒（401 / 403）时三种都算 key 无效，不再发对话请求。
 */

// 一次检测最多从这么多个已选模型里挑（照 magpie DetectMax）。
export const DETECT_MAX_MODELS = 30;

export type DetectOutcome =
  | { kind: "result"; results: ApiEndpointFormatDetection[] }
  | { kind: "cancelled" };

interface FormatProbe {
  // 接在这种格式的地址后面。
  path: string;
  // key 放哪（模板另有规定的除外）与这种格式另要的头。
  keys: KeyHeaders;
  headers: Record<string, string>;
  body(modelId: string): Record<string, unknown>;
  // 2xx 的响应体确实是这种格式的结果；否则地址背后是别的东西。
  matches(body: unknown): boolean;
}

// 和中转站请求上游时一样：Anthropic 地址两种认证头都带，OpenAI 两种以 /v1 结尾。
const FORMAT_PROBES: Record<ApiEndpointRequestFormat, FormatProbe> = {
  anthropic_messages: {
    path: "/v1/messages",
    keys: "both",
    headers: { "anthropic-version": ANTHROPIC_VERSION },
    body: (modelId) => ({
      model: modelId,
      max_tokens: 16,
      messages: [{ role: "user", content: "hi" }],
    }),
    matches: (body) => isRecord(body) && (body.type === "message" || Array.isArray(body.content)),
  },
  openai_chat: {
    path: "/chat/completions",
    keys: "bearer",
    headers: {},
    body: (modelId) => ({
      model: modelId,
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 16,
    }),
    matches: (body) => isRecord(body) && Array.isArray(body.choices),
  },
  openai_responses: {
    path: "/responses",
    keys: "bearer",
    headers: {},
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
  // 没 key 的接口为 null，不带认证头。
  apiKey: string | null;
  // 用户填的试用模型：每种格式都问它；没填为 null。
  modelId: string | null;
  // 表单里已选、还没保存的模型：没填试用模型时按格式从它们里挑，空的才向上游列。
  pickedModelIds: string[];
  // 调用方取消（客户端取消或断开）。
  signal: AbortSignal;
  modelsTimeoutMs: number;
  probeTimeoutMs: number;
}): Promise<DetectOutcome> {
  const urls = suggestedBaseUrls(input.baseUrl);
  const picked = [...new Set(input.pickedModelIds.map((id) => id.trim()).filter(Boolean))].slice(
    0,
    DETECT_MAX_MODELS,
  );
  if (input.modelId !== null || picked.length > 0) {
    return probeAll({
      input,
      urls,
      modelFor: (format) => input.modelId ?? pickProbeModel(picked, format),
    });
  }
  const listed = await fetchUpstreamModels({
    // claude 的请求头两种认证都带，也认 Anthropic 的分页。
    provider: "claude",
    baseUrl: urls.anthropic_messages,
    apiKey: input.apiKey,
    // 自动检测只给「自定义」用。
    templateId: undefined,
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
  return probeAll({ input, urls, modelFor: (format) => pickProbeModel(modelIds, format) });
}

/** 每种格式同时问一次，各用 modelFor 给它挑的模型。 */
async function probeAll(args: {
  input: { apiKey: string | null; signal: AbortSignal; probeTimeoutMs: number };
  urls: Record<ApiEndpointRequestFormat, string>;
  modelFor: (format: ApiEndpointRequestFormat) => string | null;
}): Promise<DetectOutcome> {
  const { input, urls, modelFor } = args;
  const results = await Promise.all(
    API_ENDPOINT_REQUEST_FORMATS.map((format) =>
      probeUpstreamFormat({
        format,
        baseUrl: urls[format],
        apiKey: input.apiKey,
        // 自动检测只给「自定义」用。
        templateId: undefined,
        modelId: modelFor(format),
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
  // 没 key 的接口为 null，不带认证头。
  apiKey: string | null;
  // Bedrock、Azure 的认证头与 Chat 的回复上限字段由模板定；「自定义」的没有。
  templateId: string | undefined;
  modelId: string | null;
  signal: AbortSignal;
  timeoutMs: number;
}): Promise<ApiEndpointFormatDetection> {
  const { format, baseUrl } = input;
  const startedAt = performance.now();
  const result = (
    status: ApiEndpointFormatDetection["status"],
    httpStatus: number | null,
    message: string | null,
  ): ApiEndpointFormatDetection => ({
    format,
    url: baseUrl,
    status,
    httpStatus,
    message: message === null ? null : redactKey(message, input.apiKey),
    durationMs: Math.round(performance.now() - startedAt),
    ...(input.modelId === null ? {} : { modelId: input.modelId }),
  });
  if (input.modelId === null) {
    return result("not_detected", null, "The upstream listed no models to try");
  }
  const probe = FORMAT_PROBES[format];
  const url = `${baseUrl}${probe.path}`;
  const { templateId } = input;
  const keys = templateKeyHeaders({ templateId, format }) ?? probe.keys;
  // Bedrock、Azure 的 Chat 不收 max_tokens（照 magpie tinyBody）。
  const asked = probe.body(input.modelId);
  const completionTokens = format === "openai_chat" && takesCompletionTokens(templateId);
  const body = completionTokens ? asCompletionTokens(asked) : asked;
  const timeout = AbortSignal.timeout(input.timeoutMs);
  let status: number;
  let text: string;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...probe.headers,
        ...keyHeaderValues({ apiKey: input.apiKey, keys }),
      },
      body: JSON.stringify(body),
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
