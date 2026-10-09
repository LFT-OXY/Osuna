import {
  apiEndpointProtocolName,
  type ApiEndpointTestConnectionResult,
} from "@osuna/protocol/api-endpoint/rpc-schemas";
import type { ApiEndpointProvider } from "./store.js";
import {
  ANTHROPIC_VERSION,
  describeNetworkError,
  extractErrorDetail,
  isRecord,
  parseJson,
  structuredErrorMessage,
} from "./upstream-http.js";

/*
 * 测试连接：daemon 在主机上用 CLI 实际使用的协议发一条最小对话请求，只验证接口本身。
 * CLI 这一侧的问题（Claude 的登录冲突、Codex 多轮带 previous_response_id）要到真实对话才会暴露。
 */

// 上游侧的失败，放在结果的 error 里而不是 RPC 的 error 里。
export type UpstreamConnectionFailureCode =
  | "upstream_error"
  | "upstream_unreachable"
  | "upstream_timeout"
  | "protocol_unsupported";

export type UpstreamConnectionOutcome =
  | { kind: "result"; result: ApiEndpointTestConnectionResult }
  | { kind: "cancelled" };

interface ProtocolSpec {
  path: string;
  headers(apiKey: string): Record<string, string>;
  body(modelId: string): Record<string, unknown>;
  // 200 的响应体确实是这个协议的结果；否则地址背后是别的协议（比如只有 Chat Completions）。
  matches(body: unknown): boolean;
}

const PROTOCOLS: Record<ApiEndpointProvider, ProtocolSpec> = {
  claude: {
    // Claude Code 把 ANTHROPIC_BASE_URL 拼上 /v1/messages。
    path: "/v1/messages",
    // 和 Claude Code 用 ANTHROPIC_AUTH_TOKEN 时一样只带 Bearer：只认 x-api-key 的网关 CLI 也用不了。
    headers: (apiKey) => ({
      authorization: `Bearer ${apiKey}`,
      "anthropic-version": ANTHROPIC_VERSION,
    }),
    body: (modelId) => ({
      model: modelId,
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }],
    }),
    matches: (body) => isRecord(body) && (body.type === "message" || Array.isArray(body.content)),
  },
  codex: {
    // base 已按 Codex 的规则以 /v1 结尾。
    path: "/responses",
    headers: (apiKey) => ({ authorization: `Bearer ${apiKey}` }),
    // 不带 max_output_tokens：Codex 自己不发它，有的中转站会拒绝这个参数。
    body: (modelId) => ({
      model: modelId,
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "ping" }] }],
    }),
    matches: (body) => isRecord(body) && (body.object === "response" || Array.isArray(body.output)),
  },
};

export async function testUpstreamConnection(input: {
  provider: ApiEndpointProvider;
  baseUrl: string;
  apiKey: string;
  modelId: string;
  // 调用方取消（客户端取消或断开）。
  signal: AbortSignal;
  timeoutMs: number;
}): Promise<UpstreamConnectionOutcome> {
  const protocol = PROTOCOLS[input.provider];
  const timeout = AbortSignal.timeout(input.timeoutMs);
  const signal = AbortSignal.any([input.signal, timeout]);
  const url = `${input.baseUrl.trim().replace(/\/+$/, "")}${protocol.path}`;
  const startedAt = performance.now();
  const elapsed = () => Math.round(performance.now() - startedAt);
  const fail = (
    status: number | null,
    code: UpstreamConnectionFailureCode,
    message: string,
  ): UpstreamConnectionOutcome => ({
    kind: "result",
    result: {
      ok: false,
      status,
      durationMs: elapsed(),
      error: { code, message: message.replaceAll(input.apiKey, "***") },
    },
  });

  let status: number;
  let text: string;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...protocol.headers(input.apiKey),
      },
      body: JSON.stringify(protocol.body(input.modelId)),
      signal,
    });
    status = response.status;
    text = await response.text();
  } catch (error) {
    if (input.signal.aborted) return { kind: "cancelled" };
    if (timeout.aborted) {
      return fail(
        null,
        "upstream_timeout",
        `No response from ${url} within ${Math.round(input.timeoutMs / 1000)}s`,
      );
    }
    return fail(null, "upstream_unreachable", `POST ${url}: ${describeNetworkError(error)}`);
  }

  const prefix = `POST ${url}: HTTP ${status}`;
  if (status < 200 || status >= 300) {
    const detail = extractErrorDetail(text, input.apiKey);
    const message = detail ? `${prefix}: ${detail}` : prefix;
    const code = isPathMissing(status, text) ? "protocol_unsupported" : "upstream_error";
    return fail(status, code, message);
  }
  if (!protocol.matches(parseJson(text))) {
    const name = apiEndpointProtocolName(input.provider);
    return fail(status, "protocol_unsupported", `${prefix}: not an ${name} response`);
  }
  return { kind: "result", result: { ok: true, status, durationMs: elapsed(), error: null } };
}

// 框架对未知路径的默认回复（裸 404、FastAPI 的 {"detail":"Not Found"}、OpenAI 的 "Invalid URL (POST …)"）。
const PATH_MISSING_MESSAGE = /^(not found\b|invalid url\b)/i;

/**
 * 地址上没有这个协议：405，或者 404 的错误体只是框架的默认回复。
 * 404 带上游自己写的错误（例如模型不存在）是真实的错误，照原样报。
 */
function isPathMissing(status: number, text: string): boolean {
  if (status === 405) return true;
  if (status !== 404) return false;
  const message = structuredErrorMessage(text);
  return message === null || PATH_MISSING_MESSAGE.test(message.trim());
}
