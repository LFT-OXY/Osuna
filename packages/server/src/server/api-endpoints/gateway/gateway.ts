import { timingSafeEqual } from "node:crypto";
import type { Request, RequestHandler, Response } from "express";
import type pino from "pino";
import type { ApiEndpointRequestFormat } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
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
import { attemptEndpoint, sendFailedAttempt } from "./passthrough.js";
import { chooseRequestFormat, resolveGatewayRoute, type GatewayCandidate } from "./routing.js";
import { attemptTranslated } from "./translated.js";
import { parseAnthropicRequest } from "./translation/anthropic.js";
import { RequestShapeError, estimateInputTokens, type GatewayRequest } from "./translation/ir.js";
import { protocolOf, translatable } from "./translation/protocols.js";
import { joinToolRuns, orphanedToolOutputs, pairToolItems } from "./translation/responses.js";
import { ANSWERED_BY_HEADER, type AttemptOutcome, type FailedAttempt } from "./upstream-call.js";

/*
 * 本机中转站：挂在 daemon 自己的 HTTP 监听上，替 CLI 把请求转给第三方接口。
 * Claude Code 的地址写到前缀为止，Codex 写到 `/v1`，两者落到同一组路径上。
 * 挂在 daemon 密码中间件与全局 JSON 解析之前：请求体自己读，不受 100 kb 上限。
 * 两道门：只收本机回环来源（经代理转来的不算），且口令是某个 Agent 的；口令同时说明是哪个 Agent。
 * 每次请求都重读接口与口令文件，接口页的改动立刻生效。
 *
 * 每家接口按 chooseRequestFormat 挑格式：有 Agent 自己格式的地址就直通，否则经中间格式翻译过去。
 *
 * 自动切换：用户选的那家在开口前失败（额度、欠费、限流、服务器错误、超时）时，按创建顺序换到下一家
 * 有同名模型的接口，失败的那家冷却；开口之后不再换家。冷却与「上次谁答的」只记在内存里。
 */

export const API_ENDPOINT_GATEWAY_PATH = "/api-endpoint-gateway";

// CLI 等上游响应头最长这么久；开口之后不限时，交给 CLI 自己的超时。
const DEFAULT_HEADER_TIMEOUT_MS = 10 * 60 * 1000;
// Claude Code 带图的长上下文也只有几 MB；再大多半是出了错。
const MAX_REQUEST_BODY_BYTES = 64 * 1024 * 1024;

const COUNT_TOKENS_PATH = "/v1/messages/count_tokens";

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
    const counting = req.method === "POST" && req.path === COUNT_TOKENS_PATH;
    if (!target && !counting) {
      sendAgentError({
        res,
        wire,
        error: { status: 404, message: `${req.method} ${req.path} is not served by the gateway` },
      });
      return;
    }
    const handled = target
      ? handleAgentRequest({ req, res, agent, store, logger, failover, ...target })
      : countTokens({ req, res, agent, store, logger, failover });
    void handled.catch((error: unknown) => {
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
    });
  };
}

interface Failover {
  cooldowns: EndpointCooldowns;
  sticks: ConversationSticks;
  headerTimeoutMs: number;
  retryPauseMs: number;
}

/** 读出 Agent 的请求体与模型名，按模型名找到候选；读不了或找不到时已按 Agent 协议回了错误，返回 null。 */
async function routeAgentRequest(input: {
  req: Request;
  res: Response;
  wire: AgentWire;
  agent: ApiEndpointProvider;
  store: ApiEndpointStore;
  logger: pino.Logger;
}): Promise<{
  body: Buffer;
  parsed: unknown;
  model: string;
  candidates: GatewayCandidate[];
} | null> {
  const { res, wire } = input;
  const reply = (status: number, message: string) =>
    sendAgentError({ res, wire, error: { status, message } });
  const body = await readBody(input.req, MAX_REQUEST_BODY_BYTES);
  if (body === null) {
    reply(413, "The request body is too large for the API endpoint gateway");
    return null;
  }
  const parsed = parseJson(body.toString("utf8"));
  const model = isRecord(parsed) && typeof parsed.model === "string" ? parsed.model : null;
  if (model === null) {
    reply(400, "The request has no model");
    return null;
  }
  const state = readState({ res, wire, store: input.store, logger: input.logger });
  if (!state) return null;
  const route = resolveGatewayRoute({ state, agent: input.agent, model });
  if (!route.ok) {
    reply(404, route.message);
    return null;
  }
  return { body, parsed, model, candidates: route.candidates };
}

/**
 * Claude Code 的 count_tokens：用户选的那家（冷却中、需要检查的跳过）有 Anthropic 地址就转给它，
 * 没有、或它数不了（报错、连不上）就按字节数 / 4 本地估算。数 token 不换家、不冷却。
 */
async function countTokens(input: {
  req: Request;
  res: Response;
  agent: ApiEndpointProvider;
  store: ApiEndpointStore;
  logger: pino.Logger;
  failover: Failover;
}): Promise<void> {
  const { res } = input;
  const wire = "anthropic";
  const routed = await routeAgentRequest({ ...input, wire });
  if (!routed) return;
  const { body, parsed, model, candidates } = routed;
  const { cooldowns } = input.failover;
  const counter =
    candidates.find(
      (candidate) => cooldowns.restOf(candidate.endpoint.id, candidate.upstreamModel) === null,
    ) ?? candidates[0];
  if (!counter || (await countOnEndpoint({ ...input, body, model, counter }))) return;
  try {
    const request = parseAnthropicRequest(parsed);
    res
      .status(200)
      .set(ANSWERED_BY_HEADER, counter.endpoint.slug)
      .json({ input_tokens: estimateInputTokens(request) });
  } catch (error) {
    if (!(error instanceof RequestShapeError)) throw error;
    sendAgentError({ res, wire, error: { status: 400, message: error.message } });
  }
}

/** 转给这家的 Anthropic 地址数；它答了（或 Agent 走了）为 true，要本地估算为 false。 */
async function countOnEndpoint(input: {
  req: Request;
  res: Response;
  store: ApiEndpointStore;
  logger: pino.Logger;
  failover: Failover;
  body: Buffer;
  model: string;
  counter: GatewayCandidate;
}): Promise<boolean> {
  const { endpoint } = input.counter;
  const baseUrl = endpoint.baseUrls.find((entry) => entry.format === "anthropic_messages")?.url;
  const apiKey = input.store.getApiKey(endpoint.id);
  if (baseUrl === undefined || apiKey === null) return false;
  const outcome = await attemptEndpoint({
    req: input.req,
    res: input.res,
    format: "anthropic_messages",
    pathSuffix: "/count_tokens",
    endpoint,
    baseUrl,
    apiKey,
    body: input.body,
    requestedModel: input.model,
    upstreamModel: input.counter.upstreamModel,
    headerTimeoutMs: input.failover.headerTimeoutMs,
  });
  if (outcome.kind === "answered") await outcome.finished;
  if (outcome.kind !== "failed") return true;
  input.logger.debug(
    { endpoint: endpoint.slug, status: outcome.status },
    "API endpoint could not count tokens; estimating",
  );
  return false;
}

/**
 * 能问的候选：这次用哪种格式问它、那个格式的地址与 key。Agent 自己的格式即直通；
 * 别的格式带上读成中间格式的请求，翻译过去。
 */
interface AskableCandidate extends GatewayCandidate {
  format: ApiEndpointRequestFormat;
  baseUrl: string;
  apiKey: string;
  translated: GatewayRequest | null;
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
  const { req, res, wire, store } = input;
  const reply = (status: number, message: string, headers?: Record<string, string>) =>
    sendAgentError({ res, wire, error: { status, message }, headers });

  const routed = await routeAgentRequest(input);
  if (!routed) return;
  const { body, parsed, model, candidates } = routed;
  let passable: AskableCandidate[];
  try {
    passable = askableCandidates({
      candidates,
      format: input.format,
      parsed,
      store,
    });
  } catch (error) {
    if (!(error instanceof RequestShapeError)) throw error;
    reply(400, error.message);
    return;
  }
  const chosen = candidates[0];
  if (passable.length === 0 && chosen) {
    const answeredBy = { [ANSWERED_BY_HEADER]: chosen.endpoint.slug };
    if (askableFormat(chosen, input.format)) {
      reply(500, `${chosen.endpoint.name}: the API key is missing`, answeredBy);
    } else {
      reply(502, `${chosen.endpoint.name}: no address for this agent's request format`, answeredBy);
    }
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
  await askInTurn({
    ...input,
    body: mendedBody(input.format, body),
    model,
    conversation,
    plan: planned.plan,
  });
}

/** 这家用哪种格式问：只在 Agent 自己的格式与已有翻译的格式里挑（chooseRequestFormat）。 */
function askableFormat(
  candidate: GatewayCandidate,
  agentFormat: ApiEndpointRequestFormat,
): ApiEndpointRequestFormat | null {
  return chooseRequestFormat({
    agentFormat,
    model: candidate.upstreamModel,
    formats: candidate.endpoint.baseUrls
      .map((entry) => entry.format)
      .filter((format) => format === agentFormat || translatable(agentFormat, format)),
  });
}

/** 有地址、有 key、有能用的格式的候选；要翻译时把 Agent 的请求读成中间格式（读不懂抛 RequestShapeError）。 */
function askableCandidates(input: {
  candidates: GatewayCandidate[];
  format: ApiEndpointRequestFormat;
  parsed: unknown;
  store: ApiEndpointStore;
}): AskableCandidate[] {
  let translated: GatewayRequest | null = null;
  const translatedRequest = () => {
    translated ??= protocolOf(input.format).parse(input.parsed);
    return translated;
  };
  return input.candidates.flatMap((candidate): AskableCandidate[] => {
    const format = askableFormat(candidate, input.format);
    const baseUrl = candidate.endpoint.baseUrls.find((entry) => entry.format === format)?.url;
    const apiKey = input.store.getApiKey(candidate.endpoint.id);
    if (format === null || baseUrl === undefined || apiKey === null) return [];
    const request = format === input.format ? null : translatedRequest();
    return [{ ...candidate, format, baseUrl, apiKey, translated: request }];
  });
}

/** Responses 请求直通前先修补工具往来（夹在一串里的项、没有调用的结果、没有结果的调用）；没什么可改时原样不动。 */
function mendedBody(format: ApiEndpointRequestFormat, body: Buffer): Buffer {
  if (format !== "openai_responses") return body;
  const text = body.toString("utf8");
  const mended = pairToolItems(orphanedToolOutputs(joinToolRuns(text)));
  return mended === text ? body : Buffer.from(mended);
}

type PlannedAttempts =
  | { kind: "ask"; plan: AskableCandidate[] }
  | { kind: "rest"; candidate: GatewayCandidate; rest: EndpointRest; backAt?: number };

/**
 * 这次按什么顺序问：需要检查的不选；冷却中的排在后面，只留最早恢复的一家去问（magpie 的 restLast + probeOne），
 * 再按粘性把上次回答者挪到前面。都需要检查、或全都因额度用完在冷却时不问，交出记着的错误。
 */
function planAttempts(input: {
  passable: AskableCandidate[];
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
  plan: AskableCandidate[];
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
  | Exclude<AttemptOutcome, FailedAttempt>
  | { kind: "failed"; failed: FailedAttempt };

/** 问一家；它是最后一家且只是一时忙或限流时，稍等后原地再问（magpie 的 passing）。 */
async function askUntilSettled(input: {
  req: Request;
  res: Response;
  wire: AgentWire;
  body: Buffer;
  model: string;
  candidate: AskableCandidate;
  last: boolean;
  format: AgentPath["format"];
  failover: Failover;
}): Promise<SettledAttempt> {
  const { res } = input;
  for (let again = 0; ; again++) {
    const outcome = await askEndpoint(input);
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

/** 问一次：这家用 Agent 自己的格式就直通，否则翻译。 */
function askEndpoint(input: {
  req: Request;
  res: Response;
  wire: AgentWire;
  body: Buffer;
  model: string;
  candidate: AskableCandidate;
  format: AgentPath["format"];
  failover: Failover;
}): Promise<AttemptOutcome> {
  const { candidate } = input;
  const target = {
    res: input.res,
    endpoint: candidate.endpoint,
    baseUrl: candidate.baseUrl,
    apiKey: candidate.apiKey,
    requestedModel: input.model,
    upstreamModel: candidate.upstreamModel,
    headerTimeoutMs: input.failover.headerTimeoutMs,
  };
  if (candidate.translated === null) {
    return attemptEndpoint({ ...target, req: input.req, format: input.format, body: input.body });
  }
  return attemptTranslated({
    ...target,
    wire: input.wire,
    from: input.format,
    to: candidate.format,
    request: candidate.translated,
  });
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
