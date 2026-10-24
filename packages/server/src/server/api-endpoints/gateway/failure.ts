// 部分逻辑移植自 magpie（https://github.com/yetone/magpie，internal/gateway/routing.go、fallback.go、gateway.go，internal/provider/test.go）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { parseJson } from "../upstream-http.js";

/*
 * 上游失败的判定：为什么失败（决定冷却多久）、值不值得换下一家、是不是只该冷却这个模型。
 * 词表与归类顺序照 magpie 原样；magpie 为订阅账号与个别厂商加的分类（verify、restricted 等）这里没有。
 * 「auth」是 Osuna 加的：key 无效或无权限，接口标「需要检查」，直到用户编辑它；Gemini 用 400 说 key 无效，也算（比 magpie 多）。
 */

export const FAILURE_WORDS = {
  // 账户或 key 没钱了。
  credit:
    /insufficient.?(balance|credit|fund)|balance|credit|billing|payment|arrear|overdue|suspended|余额|欠费|充值|账户.*(不足|停)/i,
  // 429 里说余额本身用完了（智谱 1113、WorkBuddy 14018）。
  broke: /insufficient.?(balance|credit|fund)|\bcredits? (are )?exhausted\b|余额不足|欠费|请充值/i,
  // 套餐眼下允许的量用完了。
  usedUp:
    /quota|usage.?limit|out of budget|budget (exceeded|exhausted)|limit.?reached|hit your .*limit|limit.{0,24}resets|exceeded.*(plan|limit)|额度|用量|套餐|上限/i,
  // 429 里的短时限流：每秒 / 每分钟的请求数或 token 数。
  rate: /rate.?limit|too many requests|per.?(second|sec|minute|min)\b|\b[rt]pm\b|频率|太频繁/i,
  // 429 里说套餐自己的额度用完了，不论有没有限流字样。
  planned:
    /quota|usage.?limit|hit your .*limit|limit.{0,24}resets|per.?(day|week|month)|daily|weekly|monthly|额度|用量|套餐|限额已用完/i,
  // Claude Code 的「usage limit reached|<重置的 unix 秒>」。
  resets: /limit reached\|(\d{10})\b/i,
  // 429 里用文字写明几点恢复：完整日期时间 + 时区偏移，后面紧跟「重置」或标点。
  resetsWhen:
    /(?:\bresets? at|将在|将于)\s*(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2}):(\d{2})\s*(?:UTC|GMT)([+-])(\d{1,2})(?::?(\d{2}))?(?:\s*(?:重置|[,.;，。；]))/i,
  // 拒绝里说这个账户的其他模型还能用：只冷却这个模型。
  otherModels: /switch(?:ing)? to (?:the )?other models?|切换(?:到)?其他模型/i,
  // 厂商自己的「额度用完」代码；5xx 只认代码不认词（中转站的「负载已经达到上限」是负载不是套餐）。
  quotaCodes: /limit reached\|\d{10}\b|usage_limit_reached|RESOURCE_EXHAUSTED/i,
  // 代理本身连不上。
  proxyDown: /proxyconnect |socks connect /,
  // 对话超过模型的上下文。
  tooLong: new RegExp(
    String.raw`context_length_exceeded|prompt is too long|input is too long|(exceeds?|exceeded|over|beyond)( the)?( model'?s?)?( maximum)? context|context (length|limit|window) (exceeded|is exceeded)|maximum context length|too many (input |prompt )?tokens|上下文(长度)?(超|过长)|超(过|出)(了)?(模型)?(的)?(最大)?上下文` +
      String.raw`|input token count.*exceeds the maximum|maximum prompt length is \d|reduce the length of the messages|maximum allowed input length|longer than the model'?s context length|available context size|greater than the context length|prompt token count of [\d,]+ exceeds the limit|context window exceeds limit|exceeded model token limit|configured context size|prompt too long|prompt exceeds max length|context_window_exceeded|exceeded (max |maximum )?context length|range of input length should be|token limit exceeded` +
      // 中转服务自己的单次输入上限（magpie #2445，B.ai 的「Input token exceed the limit」）。
      String.raw`|input tokens? (count )?(exceeds?|exceeded) (the )?(max(imum)? )?limit`,
    "i",
  ),
  // 速率类措辞，有它就不算对话超长。
  pace: /rate.?limit|per (minute|hour|day)|\bTP[MD]\b|please wait|try again later|throttl/i,
  // 额度 / 余额 / 限流任一，比上面几条都宽：有的厂商用 400 或 403 说这些。
  quota:
    /quota|insufficient|balance|credit|billing|out of budget|budget (exceeded|exhausted)|exceeded|rate.?limit|usage.?limit|limit.?reached|hit your .*limit|limit.{0,24}resets|too many requests|overloaded|余额|额度|欠费|限流|频率|套餐|用量|上限/i,
  // 这把 key / 这个套餐不提供这个模型。
  unserved:
    /model.{0,80}(not (supported|accessible|available|found|enabled|allowed)|unsupported|does ?n[o']t exist|unknown|invalid)|(no such|unknown|invalid|unsupported) model|model_not_found|模型.{0,12}(不存在|不支持|无权|未开通)/i,
  // 这个格式的地址不提供这个模型，别的格式的地址也许提供（magpie 的 wrongEndpoint）。
  wrongFormat:
    /not a chat model|not supported in (?:the |\/)v1\/(?:chat\/completions|responses)|only supported in \/?v1\/responses|use \/?v1\/(?:completions|responses|chat\/completions)|not accessible via the|unsupported_api_for_model|no model endpoints available given user constraints|is not supported for format|does not support this protocol|requires responses/i,
  // 模型已退役。
  retired:
    /"ModelDeprecated"|model_deprecated|model.{0,80}(has been|was|is now|is) (deprecated|retired|discontinued|decommissioned|sunset)/i,
  // OpenCode Zen 用 401 说模型下线了。
  zenModelGone: /(^|[\s:"])Model [^"\s]+ is not supported("|\s*$)/,
  // Gemini 用 400 INVALID_ARGUMENT 说 key 无效。
  keyInvalid: /API key not valid|API_KEY_INVALID/,
  // 厂商拒收这个客户端。
  refused: /unapproved channel|illegal api invocation/i,
  // 厂商读不懂请求的形状。
  shape:
    /failed to deserialize|unknown (item |content |input )?(type|variant|field|parameter)|unknown_parameter|unrecognized (request argument|field|parameter)|extra (inputs|fields) are not permitted|additional properties are not allowed|schema exceeds the maximum (nesting )?depth|schema[^"]{0,60}\bnesting depth\b/i,
  // 所在地区不支持。
  region:
    /\buser location is not supported for the api use\b|unsupported_country_region_territory|country, region,? or territory not supported/i,
  // ChatGPT 后端的「response protection is unavailable」：同样的历史在哪都一样失败。
  protection: /response protection is unavailable/i,
  // 厂商的边缘防火墙挡了这台机器的地址（阿里云 ESA 挡在 zcode.z.ai 前面的 405 页面）：换条路的别家也许能答。
  blocked: /request has been blocked|errors\.aliyun\.com/i,
  // Command Code 只带 trace id、不说原因的 400（以前是 422）：同样的请求别家也许收，这家不冷却。
  unsaid: /(^|"|\\"|: )invalid request error trace_id: [0-9a-f]{16,}(\\?"|\s*$)/i,
  // 智谱 1308、1310 写的恢复时间，不带时区（按北京时间）；至少写到分钟。
  zhipuResets:
    /(?:\bYour limit will reset at|您的限额将在)\s*(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(\s*\S{0,3})/i,
  // 用天、小时、分钟写的还有多久恢复（Factory 402 的「resets in 0h 19min」）。
  resetsSpan:
    /\bresets? in (?:(\d+)\s*d(?:ays?)?\b\s*)?(?:(\d+)\s*h(?:ours?|rs?)?\b\s*)?(?:(\d+)\s*m(?:in(?:utes?|s)?)?\b)?/i,
  // Cline 某个免费模型当天的额度用完：只是这个模型的。
  clineFreeLimit: /free limit reached on model/i,
  // Cline 免费模型额度用完时说的还有多久（「Try again in 23h 59m」），单位同 resetsSpan。
  tryAgainIn:
    /\btry again in (?:(\d+)\s*d(?:ays?)?\b\s*)?(?:(\d+)\s*h(?:ours?|rs?)?\b\s*)?(?:(\d+)\s*m(?:in(?:utes?|s)?)?\b)?/i,
} as const;

const W = FAILURE_WORDS;

// 空回复交给 Agent 的说法（magpie 的 emptyReply）。
export const EMPTY_REPLY = "an empty reply (the model answered nothing; try again)";

/** 决定冷却多久的失败分类。 */
export type FailureClass = "credit" | "quota" | "rate" | "other" | "auth" | "proxy";

/**
 * 正则匹配前把 JSON 里的字符串解码后附在原文后面：Python 的 json.dumps 默认把中文转成 \uXXXX，
 * 「用量」「将在…重置」要解码后才认得出。不是 JSON 就原样返回。
 */
export function wordsOf(body: string): string {
  if (!body.includes("\\u")) return body;
  const value = parseJson(body);
  if (value === undefined) return body;
  const strings: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node === "string") strings.push(node);
    else if (Array.isArray(node)) node.forEach(walk);
    else if (node !== null && typeof node === "object") Object.values(node).forEach(walk);
  };
  walk(value);
  return [body, ...strings].join("\n");
}

/** 对话超过了模型的上下文；说的是 max_tokens 或限流的不算。 */
function tooLong(status: number, body: string): boolean {
  if (status < 400 || status > 499 || status === 429) return false;
  if (/max_tokens|max_output_tokens|max_completion_tokens/.test(body)) return false;
  return !W.pace.test(body) && W.tooLong.test(body);
}

function overflowed(status: number, body: string): boolean {
  return (status === 400 || status === 413 || status === 422) && tooLong(status, body);
}

/** 带这个状态码的这段话读起来是对话太长（不是 max_tokens 或限流）。 */
export function readsTooLong(status: number, message: string): boolean {
  return tooLong(status, message);
}

/** 上游说这次请求超过了模型（或中转服务）能收的长度：400、413、422 且词表说是对话太长。 */
export function saysTooLong(status: number, rawBody: string): boolean {
  return overflowed(status, wordsOf(rawBody));
}

/**
 * 402 只说用量上限、没提钱：是套餐的额度用完，不是欠费（magpie #1979，Factory 的 Standard 用完）。
 */
function quotaPaymentRequired(status: number, body: string): boolean {
  const saysUsageLimit = W.usedUp.test(body);
  const saysMoney = W.credit.test(body) || body.includes("insufficient_quota");
  return status === 402 && saysUsageLimit && !saysMoney;
}

/** 429 只在说余额本身用完时才算欠费，否则多半是限流或额度。 */
function outOfCredit(status: number, body: string): boolean {
  return (
    status === 402 ||
    (W.credit.test(body) && (status !== 429 || W.broke.test(body))) ||
    body.includes("insufficient_quota")
  );
}

/** magpie 的 failure()：顺序即优先级。 */
export function failure(status: number, rawBody: string): FailureClass {
  if (status === 502 && W.proxyDown.test(rawBody)) return "proxy";
  const body = wordsOf(rawBody);
  if (overflowed(status, body)) return "other";
  if (quotaPaymentRequired(status, body)) return "quota";
  if (outOfCredit(status, body)) return "credit";
  if (status === 429 && W.resetsWhen.test(body)) return "quota";
  if (status === 429 && W.rate.test(body) && !W.planned.test(body)) return "rate";
  if (
    (status >= 500 && W.quotaCodes.test(body)) ||
    (status < 500 && W.usedUp.test(body)) ||
    (status === 429 && W.planned.test(body))
  ) {
    return "quota";
  }
  return status === 429 ? "rate" : "other";
}

/**
 * 一家接口为什么失败：magpie 的分类之外，401 / 403 没说出别的原因时算 key 无效或无权限。
 * 模型下线、套餐不含这个模型、地区不支持、防火墙挡了地址都不是 key 的问题。
 */
export function endpointFailure(status: number, body: string): FailureClass {
  const why = failure(status, body);
  if (why === "other" && keyInvalid(status, body)) return "auth";
  if (why !== "other" || (status !== 401 && status !== 403)) return why;
  const words = wordsOf(body);
  const notTheKey = modelRefused(status, body) || W.region.test(words) || W.blocked.test(words);
  return notTheKey ? "other" : "auth";
}

/** 上游拒了这把 key：401 / 403，或 Gemini 的 400 key 无效（识别、测试连接、拉模型共用）。 */
export function isKeyRejected(status: number, rawBody: string): boolean {
  return status === 401 || status === 403 || keyInvalid(status, rawBody);
}

/** Gemini 的 key 无效：400 且错误说 key 不对（API key not valid / API_KEY_INVALID）。 */
function keyInvalid(status: number, rawBody: string): boolean {
  return status === 400 && W.keyInvalid.test(wordsOf(rawBody));
}

/** 值不值得换下一家：上下文超长哪家都装不下，交给 Agent 压缩；其余 4xx 只在词表说明原因时换。 */
export function retryable(status: number, rawBody: string): boolean {
  const body = wordsOf(rawBody);
  if (overflowed(status, body)) return false;
  if ([401, 402, 403, 404, 408, 429].includes(status) || status >= 500) return true;
  if (modelRetired(status, body) || keyInvalid(status, body)) return true;
  // 防火墙挡了这个地址：别家走的是别的路。
  if (status >= 400 && W.blocked.test(body)) return true;
  if (status === 400 || status === 422) {
    const said = [W.quota, W.unserved, W.wrongFormat, W.refused, W.shape, W.unsaid, W.region];
    return said.some((words) => words.test(body));
  }
  return false;
}

/** 模型已退役：别家可能还提供它。 */
export function modelRetired(status: number, rawBody: string): boolean {
  if (status === 401) return W.zenModelGone.test(rawBody);
  if (![400, 404, 410, 422].includes(status)) return false;
  const body = wordsOf(rawBody);
  return W.retired.test(body) && !W.quota.test(body);
}

/** 只因为模型被拒（这把 key 不提供它）：只冷却这个模型，这家的其他模型照常。 */
export function modelRefused(status: number, rawBody: string): boolean {
  if (modelRetired(status, rawBody)) return true;
  if (![400, 403, 404, 422].includes(status)) return false;
  const body = wordsOf(rawBody);
  const unserved = W.unserved.test(body) || W.wrongFormat.test(body);
  return unserved && !W.quota.test(body) && !W.refused.test(body);
}

/**
 * 请求本身被拒：厂商读不懂它的形状、只回 trace id 不说原因、拒收这个客户端、或不服务所在地区。换下一家问，
 * 但不怪这家，不冷却（magpie 的 shape / unsaid / refused）；否则一个被拒的工具定义会让每家都冷却。
 */
export function requestRefused(status: number, rawBody: string): boolean {
  if (status !== 400 && status !== 422) return false;
  const body = wordsOf(rawBody);
  if (W.quota.test(body) || modelRefused(status, rawBody)) return false;
  return [W.shape, W.unsaid, W.refused, W.region].some((words) => words.test(body));
}

/**
 * 流里的错误事件（或 2xx 里包着的错误）代表哪个状态码，判错与冷却照它走（magpie 的 streamStatus）。
 * 对话超长排在额度之前：「context_length_exceeded」里的 exceeded 会被当成额度。
 */
export function streamStatus(rawMessage: string): number {
  const message = wordsOf(rawMessage);
  if (tooLong(400, message)) return 400;
  if (/overloaded/i.test(message)) return 529;
  if (W.credit.test(message) && !/rate/i.test(message)) return 402;
  if (/rate_limit|rate limit|too many/i.test(message) || W.quota.test(message)) return 429;
  if (W.unserved.test(message)) return 400;
  if (/invalid|context_length|too long/i.test(message)) return 400;
  return 502;
}

/** 回复开始后断掉时这家要不要冷却：对话超长、厂商拒收、保护机制或模型只给了空回复导致的不怪这家（magpie #1221）。 */
export function lateRests(message: string): boolean {
  const notTheEndpoint =
    tooLong(400, message) ||
    W.refused.test(message) ||
    W.protection.test(message) ||
    message.includes(EMPTY_REPLY);
  return !notTheEndpoint;
}
