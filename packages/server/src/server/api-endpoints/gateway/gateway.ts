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
import { ConversationSticks, conversationId, turnOf } from "./affinity.js";
import { COOLDOWN, EndpointCooldowns, passing, quotaHeld, type EndpointRest } from "./cooldown.js";
import { endpointFailure, lateRests, retryable } from "./failure.js";
import {
  ANSWERED_BY_HEADER,
  attemptEndpoint,
  sendFailedAttempt,
  type FailedAttempt,
} from "./passthrough.js";
import { resolveGatewayRoute, type GatewayCandidate } from "./routing.js";

/*
 * 本机中转站：挂在 daemon 自己的 HTTP 监听上，替 CLI 把请求转给第三方接口。
 * Claude Code 的地址写到前缀为止，Codex 写到 `/v1`，两者落到同一组路径上。
 * 挂在 daemon 密码中间件与全局 JSON 解析之前：请求体自己读，不受 100 kb 上限。
 * 两道门：只收本机回环来源（经代理转来的不算），且口令是某个 Agent 的；口令同时说明是哪个 Agent。
 * 每次请求都重读接口与口令文件，接口页的改动立刻生效。
 *
 * 自动切换：用户选的那家在开口前失败（额度、欠费、限流、服务器错误、超时）时，按创建顺序换到下一家
 * 有同名模型的接口，失败的那家冷却；开口之后不再换家。冷却与「上次谁答的」只记在内存里。
 */

export const API_ENDPOINT_GATEWAY_PATH = "/api-endpoint-gateway";

// CLI 等上游响应头最长这么久；开口之后不限时，交给 CLI 自己的超时。
const DEFAULT_HEADER_TIMEOUT_MS = 10 * 60 * 1000;
// Claude Code 带图的长上下文也只有几 MB；再大多半是出了错。
const MAX_REQUEST_BODY_BYTES = 64 * 1024 * 1024;

const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const PROXY_HEADERS = ["forwarded", "x-forwarded-for", "x-real-ip"];

export interface ApiEndpointGatewayOverrides {
  // 只给测试缩短等上游响应头的时间与最后一家原地重试前的等待。
  gatewayHeaderTimeoutMs?: number;
  gatewayRetryPauseMs?: number;
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
  cooldowns: EndpointCooldowns;
  overrides?: ApiEndpointGatewayOverrides;
}): RequestHandler {
  const store = new ApiEndpointStore(options.paseoHome);
  const logger = options.logger.child({ module: "api-endpoint-gateway" });
  const failover: Failover = {
    cooldowns: options.cooldowns,
    sticks: new ConversationSticks(),
    headerTimeoutMs: options.overrides?.gatewayHeaderTimeoutMs ?? DEFAULT_HEADER_TIMEOUT_MS,
    retryPauseMs: options.overrides?.gatewayRetryPauseMs ?? COOLDOWN.retryPause,
  };

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
    void handleAgentRequest({ req, res, agent, store, logger, failover, ...target }).catch(
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

interface Failover {
  cooldowns: EndpointCooldowns;
  sticks: ConversationSticks;
  headerTimeoutMs: number;
  retryPauseMs: number;
}

/** 能直通的候选：这家有 Agent 自己格式的地址与 key（协议转换在工单 05）。 */
interface PassableCandidate extends GatewayCandidate {
  baseUrl: string;
  apiKey: string;
}

async function handleAgentRequest(input: {
  req: Request;
  res: Response;
  agent: ApiEndpointProvider;
  wire: AgentWire;
  format: AgentPath["format"];
  store: ApiEndpointStore;
  logger: pino.Logger;
  failover: Failover;
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
  const passable = route.candidates.flatMap((candidate): PassableCandidate[] => {
    const baseUrl = candidate.endpoint.baseUrls.find((entry) => entry.format === input.format)?.url;
    const apiKey = store.getApiKey(candidate.endpoint.id);
    return baseUrl !== undefined && apiKey !== null ? [{ ...candidate, baseUrl, apiKey }] : [];
  });
  const chosen = route.candidates[0];
  if (passable.length === 0 && chosen) {
    const answeredBy = { [ANSWERED_BY_HEADER]: chosen.endpoint.slug };
    const hasAddress = chosen.endpoint.baseUrls.some((entry) => entry.format === input.format);
    if (hasAddress) reply(500, `${chosen.endpoint.name}: the API key is missing`, answeredBy);
    else
      reply(502, `${chosen.endpoint.name}: no address for this agent's request format`, answeredBy);
    return;
  }

  const conversation = `${input.agent}|${model}|${conversationId(req.headers, parsed)}`;
  const planned = planAttempts({
    passable,
    failover: input.failover,
    conversation,
    within: turnOf(wire, parsed).within,
  });
  if (planned.kind === "rest") {
    sendRest({ res, wire, ...planned });
    return;
  }
  await askInTurn({ ...input, body, model, conversation, plan: planned.plan });
}

type PlannedAttempts =
  | { kind: "ask"; plan: PassableCandidate[] }
  | { kind: "rest"; candidate: GatewayCandidate; rest: EndpointRest; backAt?: number };

/**
 * 这次按什么顺序问：需要检查的不选；冷却中的排在后面，只留最早恢复的一家去问（magpie 的 restLast + probeOne），
 * 再按粘性把上次回答者挪到前面。都需要检查、或全都因额度用完在冷却时不问，交出记着的错误。
 */
function planAttempts(input: {
  passable: PassableCandidate[];
  failover: Failover;
  conversation: string;
  within: boolean;
}): PlannedAttempts {
  const { cooldowns, sticks } = input.failover;
  const restOf = (candidate: GatewayCandidate) =>
    cooldowns.restOf(candidate.endpoint.id, candidate.upstreamModel);
  const unchecked = input.passable.filter((candidate) => restOf(candidate)?.why !== "auth");
  const ready = unchecked.filter((candidate) => restOf(candidate) === null);
  const resting = unchecked.filter((candidate) => restOf(candidate) !== null);
  const lastPassable = input.passable.at(-1);
  const lastRest = lastPassable ? restOf(lastPassable) : null;
  if (unchecked.length === 0 && lastPassable && lastRest) {
    return { kind: "rest", candidate: lastPassable, rest: lastRest };
  }
  const held = ready.length === 0 ? quotaHeld(resting.map(restOf)) : null;
  const heldBy = resting.at(-1);
  if (held && heldBy) {
    return { kind: "rest", candidate: heldBy, rest: held.last, backAt: held.backAt };
  }
  const soonest = [...resting].sort(
    (a, b) => (restOf(a)?.until ?? Infinity) - (restOf(b)?.until ?? Infinity),
  )[0];
  const plan = sticks.order({
    key: input.conversation,
    candidates: soonest ? [...ready, soonest] : ready,
    within: input.within,
    resting: (candidate) => restOf(candidate) !== null,
  });
  return { kind: "ask", plan };
}

/** 按顺序问：开口前失败且值得换就冷却这家、换下一家；最后一家的错误交给 Agent。 */
async function askInTurn(input: {
  req: Request;
  res: Response;
  wire: AgentWire;
  format: AgentPath["format"];
  logger: pino.Logger;
  failover: Failover;
  body: Buffer;
  model: string;
  conversation: string;
  plan: PassableCandidate[];
}): Promise<void> {
  const { res, wire, logger, plan } = input;
  const { cooldowns, sticks } = input.failover;
  for (const [index, candidate] of plan.entries()) {
    const next = plan[index + 1];
    const outcome = await askUntilSettled({ ...input, candidate, last: next === undefined });
    if (outcome.kind === "gone") return;
    if (outcome.kind === "answered") {
      const end = await outcome.finished;
      if (end.kind === "complete") {
        cooldowns.served(candidate.endpoint.id, candidate.upstreamModel);
        sticks.answered(input.conversation, {
          endpointId: candidate.endpoint.id,
          model: candidate.upstreamModel,
          cacheRead: end.cacheRead,
        });
      } else if (end.kind === "broken" && lateRests(end.message)) {
        markFailed({
          cooldowns,
          candidate,
          failed: { status: 502, headers: {}, text: end.message, detail: end.message },
        });
      }
      return;
    }
    const { failed } = outcome;
    logger.warn(
      { endpoint: candidate.endpoint.slug, status: failed.status },
      "API endpoint returned an error",
    );
    if (!retryable(failed.status, failed.text)) {
      sendFailedAttempt({
        res,
        wire,
        endpoint: candidate.endpoint,
        failed,
        suffix: "",
        headers: {},
      });
      return;
    }
    const rest = markFailed({ cooldowns, candidate, failed });
    if (next) {
      logger.info(
        {
          from: candidate.endpoint.name,
          to: next.endpoint.name,
          model: candidate.upstreamModel,
          failure: rest?.why ?? endpointFailure(failed.status, failed.text),
          status: failed.status,
          until: rest?.until ? new Date(rest.until).toISOString() : null,
        },
        "API endpoint gateway switched endpoints",
      );
      continue;
    }
    sendFailedAttempt({
      res,
      wire,
      endpoint: candidate.endpoint,
      failed,
      suffix: backAgainSuffix(rest),
      headers: missingRetryAfter(failed, rest),
    });
    return;
  }
}

type SettledAttempt =
  | Exclude<Awaited<ReturnType<typeof attemptEndpoint>>, FailedAttempt>
  | { kind: "failed"; failed: FailedAttempt };

/** 问一家；它是最后一家且只是一时忙或限流时，稍等后原地再问（magpie 的 passing）。 */
async function askUntilSettled(input: {
  req: Request;
  res: Response;
  body: Buffer;
  model: string;
  candidate: PassableCandidate;
  last: boolean;
  format: AgentPath["format"];
  failover: Failover;
}): Promise<SettledAttempt> {
  const { candidate, res } = input;
  for (let again = 0; ; again++) {
    const outcome = await attemptEndpoint({
      req: input.req,
      res,
      format: input.format,
      endpoint: candidate.endpoint,
      baseUrl: candidate.baseUrl,
      apiKey: candidate.apiKey,
      body: input.body,
      requestedModel: input.model,
      upstreamModel: candidate.upstreamModel,
      headerTimeoutMs: input.failover.headerTimeoutMs,
    });
    if (outcome.kind !== "failed") return outcome;
    const pause =
      input.last && !outcome.timedOut && retryable(outcome.status, outcome.text)
        ? passing({
            status: outcome.status,
            headers: outcome.headers,
            body: outcome.text,
            again,
            retryPauseMs: input.failover.retryPauseMs,
            now: Date.now(),
          })
        : { again: false, waitMs: 0 };
    if (!pause.again) return { kind: "failed", failed: outcome };
    await new Promise((resolve) => setTimeout(resolve, pause.waitMs));
    if (res.destroyed) return { kind: "gone" };
  }
}

/** 把一次失败记进冷却：判错读上游原文，全在冷却时交出的是打过码的原文。 */
function markFailed(input: {
  cooldowns: EndpointCooldowns;
  candidate: GatewayCandidate;
  failed: Pick<FailedAttempt, "status" | "headers" | "text" | "detail">;
}): EndpointRest | null {
  const { candidate, failed } = input;
  return input.cooldowns.markFailed({
    endpoint: candidate.endpoint,
    model: candidate.upstreamModel,
    status: failed.status,
    headers: failed.headers,
    body: failed.text,
    said: failed.detail,
  });
}

/** 额度、欠费、限流判出了恢复时间：附在上游原文后面。 */
function backAgainSuffix(rest: EndpointRest | null): string {
  const backed = rest?.why === "credit" || rest?.why === "quota" || rest?.why === "rate";
  return backed && rest.until !== null ? ` (available again at ${formatBackAt(rest.until)})` : "";
}

/** 当天只写时分，否则带日期；用 daemon 所在机器的本地时间。 */
function formatBackAt(at: number): string {
  const back = new Date(at);
  const pad = (value: number) => String(value).padStart(2, "0");
  const time = `${pad(back.getHours())}:${pad(back.getMinutes())}`;
  if (back.toDateString() === new Date().toDateString()) return time;
  return `${back.getFullYear()}-${pad(back.getMonth() + 1)}-${pad(back.getDate())} ${time}`;
}

/** 429 没带 Retry-After 时告诉 CLI 何时再问：这家冷却结束的时刻。 */
function missingRetryAfter(
  failed: FailedAttempt,
  rest: EndpointRest | null,
): Record<string, string> {
  if (failed.status !== 429 || failed.headers["retry-after"] !== undefined) return {};
  return rest?.until ? { "retry-after": retryAfterSeconds(rest.until) } : {};
}

function retryAfterSeconds(at: number): string {
  return String(Math.max(Math.ceil((at - Date.now()) / 1000), 1));
}

/** 不问上游，直接交出冷却里记着的那次错误：全在额度冷却中，或都需要检查。 */
function sendRest(input: {
  res: Response;
  wire: AgentWire;
  candidate: GatewayCandidate;
  rest: EndpointRest;
  backAt?: number;
}): void {
  const { rest } = input;
  sendAgentError({
    res: input.res,
    wire: input.wire,
    error: {
      status: rest.status,
      message: `${input.candidate.endpoint.name}: ${rest.said}${backAgainSuffix(rest)}`,
    },
    headers: {
      [ANSWERED_BY_HEADER]: input.candidate.endpoint.slug,
      ...(input.backAt === undefined ? {} : { "retry-after": retryAfterSeconds(input.backAt) }),
    },
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
