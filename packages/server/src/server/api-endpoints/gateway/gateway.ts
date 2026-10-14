import { timingSafeEqual } from "node:crypto";
import type { Request, RequestHandler, Response } from "express";
import type pino from "pino";
import { extractHttpBearerToken } from "../../auth.js";
import { usableModels } from "../host-endpoints.js";
import {
  API_ENDPOINT_PROVIDERS,
  ApiEndpointStore,
  ApiEndpointsFileUnparsableError,
  type ApiEndpointProvider,
  type ApiEndpointState,
} from "../store.js";
import { isRecord, parseJson } from "../upstream-http.js";
import { sendAgentError, type AgentWire } from "./agent-errors.js";
import { ANSWERED_BY_HEADER, forwardToEndpoint } from "./passthrough.js";
import { resolveGatewayRoute } from "./routing.js";

/*
 * 本机中转站：挂在 daemon 自己的 HTTP 监听上，替 CLI 把请求转给第三方接口。
 * Claude Code 的地址写到前缀为止，Codex 写到 `/v1`，两者落到同一组路径上。
 * 挂在 daemon 密码中间件与全局 JSON 解析之前：请求体自己读，不受 100 kb 上限。
 * 两道门：只收本机回环来源（经代理转来的不算），且口令是某个 Agent 的；口令同时说明是哪个 Agent。
 * 每次请求都重读接口与口令文件，接口页的改动立刻生效。
 */

export const API_ENDPOINT_GATEWAY_PATH = "/api-endpoint-gateway";

// CLI 等上游响应头最长这么久；开口之后不限时，交给 CLI 自己的超时。
const DEFAULT_HEADER_TIMEOUT_MS = 10 * 60 * 1000;
// Claude Code 带图的长上下文也只有几 MB；再大多半是出了错。
const MAX_REQUEST_BODY_BYTES = 64 * 1024 * 1024;

const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const PROXY_HEADERS = ["forwarded", "x-forwarded-for", "x-real-ip"];

export interface ApiEndpointGatewayOverrides {
  // 只给测试缩短等上游响应头的时间。
  gatewayHeaderTimeoutMs?: number;
}

/** 每种 Agent 自己说的请求格式，按请求路径认。 */
const AGENT_PATHS = {
  "/v1/messages": { wire: "anthropic", format: "anthropic_messages" },
  "/v1/responses": { wire: "openai", format: "openai_responses" },
} as const;
type AgentPath = (typeof AGENT_PATHS)[keyof typeof AGENT_PATHS];

export function createApiEndpointGateway(options: {
  paseoHome: string;
  logger: pino.Logger;
  overrides?: ApiEndpointGatewayOverrides;
}): RequestHandler {
  const store = new ApiEndpointStore(options.paseoHome);
  const logger = options.logger.child({ module: "api-endpoint-gateway" });
  const headerTimeoutMs = options.overrides?.gatewayHeaderTimeoutMs ?? DEFAULT_HEADER_TIMEOUT_MS;

  return (req, res) => {
    const wire = wireOf(req);
    if (!isLocalRequest(req)) {
      sendAgentError({
        res,
        wire,
        error: { status: 403, message: "The API endpoint gateway only accepts local requests" },
      });
      return;
    }
    const agent = authenticate(req, store);
    if (agent === null) {
      sendAgentError({
        res,
        wire,
        error: { status: 401, message: "Invalid API endpoint gateway token" },
      });
      return;
    }

    const isWarmUp = req.path === "/api/hello" && (req.method === "GET" || req.method === "HEAD");
    if (isWarmUp) {
      res.status(200).json({ ok: true });
      return;
    }
    if (req.path === "/v1/models" && req.method === "GET") {
      const state = readState({ res, wire, store, logger });
      if (state) res.status(200).json(modelList(state));
      return;
    }
    const target = req.method === "POST" ? agentPath(req.path) : null;
    if (!target) {
      sendAgentError({
        res,
        wire,
        error: { status: 404, message: `${req.method} ${req.path} is not served by the gateway` },
      });
      return;
    }
    void handleAgentRequest({ req, res, agent, store, logger, headerTimeoutMs, ...target }).catch(
      (error: unknown) => {
        logger.error({ err: error }, "API endpoint gateway request crashed");
        if (!res.headersSent) {
          sendAgentError({
            res,
            wire,
            error: { status: 500, message: "API endpoint gateway error" },
          });
        } else {
          res.destroy();
        }
      },
    );
  };
}

async function handleAgentRequest(input: {
  req: Request;
  res: Response;
  agent: ApiEndpointProvider;
  wire: AgentWire;
  format: AgentPath["format"];
  store: ApiEndpointStore;
  logger: pino.Logger;
  headerTimeoutMs: number;
}): Promise<void> {
  const { req, res, wire, store, logger } = input;
  const reply = (status: number, message: string, headers?: Record<string, string>) =>
    sendAgentError({ res, wire, error: { status, message }, headers });

  const body = await readBody(req, MAX_REQUEST_BODY_BYTES);
  if (body === null) {
    reply(413, "The request body is too large for the API endpoint gateway");
    return;
  }
  const parsed = parseJson(body.toString("utf8"));
  const model = isRecord(parsed) && typeof parsed.model === "string" ? parsed.model : null;
  if (model === null) {
    reply(400, "The request has no model");
    return;
  }
  const state = readState({ res, wire, store, logger });
  if (!state) return;

  const route = resolveGatewayRoute({ state, agent: input.agent, model });
  if (!route.ok) {
    reply(404, route.message);
    return;
  }
  const { endpoint, upstreamModel } = route;
  const answeredBy = { [ANSWERED_BY_HEADER]: endpoint.slug };
  const baseUrl = endpoint.baseUrls.find((entry) => entry.format === input.format)?.url;
  if (baseUrl === undefined) {
    // 协议转换在工单 05；在那之前只能直通到有 Agent 自己格式地址的接口。
    reply(502, `${endpoint.name}: no address for this agent's request format`, answeredBy);
    return;
  }
  const apiKey = store.getApiKey(endpoint.id);
  if (apiKey === null) {
    reply(500, `${endpoint.name}: the API key is missing`, answeredBy);
    return;
  }
  logger.debug(
    { agent: input.agent, endpoint: endpoint.slug, upstreamModel },
    "API endpoint gateway forwarding request",
  );
  await forwardToEndpoint({
    req,
    res,
    wire,
    format: input.format,
    endpoint,
    baseUrl,
    apiKey,
    body,
    requestedModel: model,
    upstreamModel,
    headerTimeoutMs: input.headerTimeoutMs,
    logger,
  });
}

function agentPath(path: string): AgentPath | null {
  return path === "/v1/messages" || path === "/v1/responses" ? AGENT_PATHS[path] : null;
}

/** 认不出路径时（鉴权失败、/v1/models）按请求头猜：带 anthropic-version 的是 Claude Code。 */
function wireOf(req: Request): AgentWire {
  const target = agentPath(req.path);
  if (target) return target.wire;
  return req.headers["anthropic-version"] ? "anthropic" : "openai";
}

function isLocalRequest(req: Request): boolean {
  const address = req.socket.remoteAddress;
  return (
    address !== undefined &&
    LOOPBACK_ADDRESSES.has(address) &&
    PROXY_HEADERS.every((name) => req.headers[name] === undefined)
  );
}

/** 口令在 Authorization: Bearer 或 x-api-key 里；对上的那个 Agent 就是来人。 */
function authenticate(req: Request, store: ApiEndpointStore): ApiEndpointProvider | null {
  const header = req.headers["x-api-key"];
  const presented =
    extractHttpBearerToken(req.header("authorization")) ??
    (typeof header === "string" ? header : null);
  if (presented === null) return null;
  const tokens = store.readGatewayTokens();
  const given = Buffer.from(presented);
  return (
    API_ENDPOINT_PROVIDERS.find((provider) => {
      const expected = tokens[provider];
      if (expected === undefined) return false;
      const wanted = Buffer.from(expected);
      return wanted.length === given.length && timingSafeEqual(wanted, given);
    }) ?? null
  );
}

function readState(input: {
  res: Response;
  wire: AgentWire;
  store: ApiEndpointStore;
  logger: pino.Logger;
}): ApiEndpointState | null {
  try {
    return input.store.readState();
  } catch (error) {
    if (!(error instanceof ApiEndpointsFileUnparsableError)) throw error;
    input.logger.error(
      { err: error, filePath: error.filePath },
      "API endpoints file could not be parsed",
    );
    sendAgentError({
      res: input.res,
      wire: input.wire,
      error: { status: 500, message: "The API endpoints file could not be parsed" },
    });
    return null;
  }
}

/** OpenAI 与 Anthropic 两种列表写法合在一份里：开着的接口的已选模型，去重后的光秃秃名字。 */
function modelList(state: ApiEndpointState) {
  const data = usableModels(state).map((model) => ({
    id: model.id,
    object: "model",
    type: "model",
    display_name: model.label ?? model.id,
    created: 0,
    created_at: "1970-01-01T00:00:00Z",
    owned_by: "osuna",
  }));
  return {
    object: "list",
    data,
    has_more: false,
    first_id: data[0]?.id ?? null,
    last_id: data.at(-1)?.id ?? null,
  };
}

/** 读完整个请求体；超过上限返回 null。 */
function readBody(req: Request, limit: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        resolve(null);
        req.removeAllListeners("data");
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
