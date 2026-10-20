// 部分逻辑移植自 magpie（https://github.com/yetone/magpie，internal/provider/detect.go、test.go）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import {
  API_ENDPOINT_DETECT_MAX_MODELS,
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
import type { CliHeaderSample } from "./store.js";
import { asCliBody, type CliTestClient } from "./test-as.js";

/*
 * 自动检测请求格式（照 magpie internal/provider/detect.go）：从用户填的一个地址推出每种格式的地址，
 * 每种格式各发一条最小对话请求，回应正常的就算这家支持。问哪个模型：用户填的试用模型每种格式都问它；
 * 没填时按格式从表单里已选的模型挑，也没有才向上游列一次模型挑人选（列模型不花钱）。
 * 列模型就被拒（401 / 403）时三种都算 key 无效，不再发对话请求。
 */

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
  // 发给上游时模型叫什么（已保存那家的上游模型名，magpie detect.go 的 UpstreamName）；新加的是模型 id 本身。
  sentNameOf: (modelId: string) => string;
  // 调用方取消（客户端取消或断开）。
  signal: AbortSignal;
  modelsTimeoutMs: number;
  probeTimeoutMs: number;
}): Promise<DetectOutcome> {
  const urls = suggestedBaseUrls(input.baseUrl);
  const picked = [...new Set(input.pickedModelIds.map((id) => id.trim()).filter(Boolean))].slice(
    0,
    API_ENDPOINT_DETECT_MAX_MODELS,
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
  input: {
    apiKey: string | null;
    signal: AbortSignal;
    probeTimeoutMs: number;
    sentNameOf: (modelId: string) => string;
  };
  urls: Record<ApiEndpointRequestFormat, string>;
  modelFor: (format: ApiEndpointRequestFormat) => string | null;
}): Promise<DetectOutcome> {
  const { input, urls, modelFor } = args;
  const results = await Promise.all(
    API_ENDPOINT_REQUEST_FORMATS.map((format) => {
      const modelId = modelFor(format);
      return probeUpstreamFormat({
        format,
        baseUrl: urls[format],
        apiKey: input.apiKey,
        // 自动检测只给「自定义」用。
        templateId: undefined,
        modelId,
        sentModel: modelId === null ? null : input.sentNameOf(modelId),
        signal: input.signal,
        timeoutMs: input.probeTimeoutMs,
      });
    }),
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
  // 请求体里的模型名（上游模型名）；没有模型时为 null。
  sentModel: string | null;
  // 测试模型时 Responses 也限回复 16（照 magpie tinyBody）；检测与测试连接不带，照 Codex 自己的样子。
  capsReply?: boolean;
  // 按 CLI 的样子测（ADR 0013）：带这些请求头、流式发；缺省是 Osuna 自己的样子。
  asCli?: { client: CliTestClient; headers: CliHeaderSample };
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
  const request = probeRequest({ ...input, modelId: input.modelId, probe });
  const timeout = AbortSignal.timeout(input.timeoutMs);
  let status: number;
  let reply: ProbeReply;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: AbortSignal.any([input.signal, timeout]),
    });
    status = response.status;
    const isStreamed = input.asCli !== undefined && isSuccess(status);
    reply = await readProbeReply({ response, isStreamed });
  } catch (error) {
    if (timeout.aborted && !input.signal.aborted) {
      const seconds = Math.round(input.timeoutMs / 1000);
      return result("not_detected", null, `No response from ${url} within ${seconds}s`);
    }
    return result("not_detected", null, `POST ${url}: ${describeNetworkError(error)}`);
  }
  const prefix = `POST ${url}: HTTP ${status}`;
  if (reply.kind === "streamed") {
    if (reply.failure === null) return result("ok", status, null);
    return result("not_detected", status, `${prefix}: ${reply.failure}`);
  }
  const { text } = reply;
  if (isSuccess(status)) {
    if (probe.matches(parseJson(text))) return result("ok", status, null);
    return result("not_detected", status, `${prefix}: not a ${format} response`);
  }
  const detail = extractErrorDetail(text, input.apiKey);
  const message = detail ? `${prefix}: ${detail}` : prefix;
  return result(status === 401 || status === 403 ? "auth_failed" : "not_detected", status, message);
}

function isSuccess(status: number): boolean {
  return status >= 200 && status < 300;
}

/** 发出去的请求体与请求头。 */
function probeRequest(input: {
  format: ApiEndpointRequestFormat;
  probe: FormatProbe;
  apiKey: string | null;
  templateId: string | undefined;
  modelId: string;
  sentModel: string | null;
  capsReply?: boolean;
  asCli?: { client: CliTestClient; headers: CliHeaderSample };
}): { body: Record<string, unknown>; headers: Record<string, string> } {
  const { format, probe, templateId, asCli } = input;
  const keys = templateKeyHeaders({ templateId, format }) ?? probe.keys;
  const asked = probe.body(input.sentModel ?? input.modelId);
  if (input.capsReply === true && format === "openai_responses") asked.max_output_tokens = 16;
  // Bedrock、Azure 的 Chat 不收 max_tokens（照 magpie tinyBody）。
  const completionTokens = format === "openai_chat" && takesCompletionTokens(templateId);
  const capped = completionTokens ? asCompletionTokens(asked) : asked;
  let body = capped;
  // 按 CLI 的样子测：它的请求头在 Osuna 的之上，认证头仍是这家的 key（magpie clientHeaders）。
  let cliHeaders: Record<string, string> = {};
  if (asCli) {
    body = asCliBody({ client: asCli.client, format, body: capped });
    cliHeaders = { ...asCli.headers, accept: "application/json, text/event-stream" };
  }
  const headers = {
    accept: "application/json",
    "content-type": "application/json",
    ...probe.headers,
    ...cliHeaders,
    ...keyHeaderValues({ apiKey: input.apiKey, keys }),
  };
  return { body, headers };
}

/** 读回来的：流式的读到第一段内容或错误为止（failure 为 null 即答上了），其余整份读成文字。 */
type ProbeReply = { kind: "streamed"; failure: string | null } | { kind: "whole"; text: string };

async function readProbeReply(input: {
  response: Response;
  isStreamed: boolean;
}): Promise<ProbeReply> {
  if (input.isStreamed) return { kind: "streamed", failure: await streamAnswer(input.response) };
  return { kind: "whole", text: await input.response.text() };
}

// 流式回答最多读这么多字节（magpie streamAnswer 的 1 MB）。
const STREAM_READ_LIMIT = 1 << 20;

/** 这一行事件说明模型开口了：一段文字、一段思考或一次工具调用（Chat、Responses、Anthropic 的事件）。 */
function saysSomething(event: Record<string, unknown>): boolean {
  const type = typeof event.type === "string" ? event.type : "";
  const isContentEvent =
    type === "content_block_start" ||
    type === "content_block_delta" ||
    type === "response.output_item.added" ||
    (type.startsWith("response.") && type.endsWith(".delta"));
  if (isContentEvent) return true;
  const choices = Array.isArray(event.choices) ? event.choices : [];
  return choices.some((choice) => {
    const delta = isRecord(choice) && isRecord(choice.delta) ? choice.delta : {};
    return ["content", "reasoning", "reasoning_content", "tool_calls"].some((key) => {
      const value = delta[key];
      return value !== undefined && value !== null && value !== "";
    });
  });
}

/** 这一行事件是流里的错误时，它的原因；不是为 null。 */
function streamError(event: Record<string, unknown>, data: string): string | null {
  const hasError = event.error !== undefined && event.error !== null;
  if (event.type === "error" || hasError)
    return extractErrorDetail(data, null) || "error in the stream";
  if (event.type !== "response.failed") return null;
  const response = isRecord(event.response) ? event.response : {};
  const failed = response.error;
  if (failed === undefined || failed === null) return "response failed";
  return extractErrorDetail(JSON.stringify({ error: failed }), null) || "response failed";
}

/**
 * 流式请求先回 200，模型还可能在流里失败：读到它第一次开口或报错为止（magpie streamAnswer）。
 * 流读完了两样都没有也算答上，和整份回答的 200 一样。返回失败的原因，答上为 null。
 */
async function streamAnswer(response: Response): Promise<string | null> {
  const reader = response.body?.getReader();
  if (reader === undefined) return null;
  const decoder = new TextDecoder();
  let pending = "";
  let read = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) return null;
      read += chunk.value.byteLength;
      pending += decoder.decode(chunk.value, { stream: true });
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        const verdict = lineVerdict(line);
        if (verdict?.kind === "answered") return null;
        if (verdict?.kind === "failed") return verdict.reason;
      }
      if (read >= STREAM_READ_LIMIT) return null;
    }
  } finally {
    await reader.cancel();
  }
}

type StreamVerdict = { kind: "answered" } | { kind: "failed"; reason: string };

/** 一行流说明了什么；还说不准为 null。 */
function lineVerdict(line: string): StreamVerdict | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const data = trimmed.slice("data:".length).trim();
  if (data === "" || data === "[DONE]") return null;
  const event = parseJson(data);
  if (!isRecord(event)) return null;
  const reason = streamError(event, data);
  if (reason !== null) return { kind: "failed", reason };
  return saysSomething(event) ? { kind: "answered" } : null;
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
