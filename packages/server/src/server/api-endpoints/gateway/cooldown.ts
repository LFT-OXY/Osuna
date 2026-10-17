// 部分逻辑移植自 magpie（https://github.com/yetone/magpie，internal/gateway/routing.go、fallback.go）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import type { IncomingHttpHeaders } from "node:http";
import type pino from "pino";
import { hostOf } from "../model-facts.js";
import { isRecord, parseJson } from "../upstream-http.js";
import {
  FAILURE_WORDS,
  endpointFailure,
  failure,
  modelRefused,
  requestRefused,
  wordsOf,
  type FailureClass,
} from "./failure.js";

/*
 * 冷却：一家接口失败后多久不被自动选中。只记在内存里，daemon 重启清零。
 * 冷却按整家接口记；只因模型被拒（这把 key 不提供它）、厂商说只是这个模型的额度、或这个模型自己接连失败时，
 * 只冷却这家的这个模型。
 * 冷却结束的时刻也会记一行日志，所以每条冷却挂一个定时器。
 */

const MINUTE = 60_000;

export const COOLDOWN = {
  // 其他失败与限流的起始冷却。
  fallbackCooldown: MINUTE,
  creditRest: 30 * MINUTE,
  // 额度用完、厂商没说何时恢复。
  quotaRest: 15 * MINUTE,
  // 厂商的 Retry-After 最多信这么久。
  longestWait: 60 * MINUTE,
  // 额度用完最多冷却这么久：一周的窗口再多一天。
  longestQuota: 8 * 24 * 60 * MINUTE,
  longestRetry: 10 * MINUTE,
  longestRateRest: 30 * MINUTE,
  // 上次限流冷却结束超过这么久再被限流，算新的一次，从一分钟重来。
  rateForget: 30 * MINUTE,
  // 错误文字里写的重置时间最远信多久。
  longestWritten: 7 * 24 * 60 * MINUTE,
  // 最后一家的原地重试：服务器忙两次、限流三次，每次等待翻倍，等太久就不等。
  lastRetries: 2,
  rateRetries: 3,
  longestPause: 8_000,
  retryPause: 1_000,
} as const;

/** 冷却时长由什么定的：欠费、厂商的 Retry-After、错误里写的重置时间、额度默认、起始冷却、翻倍、需要检查。 */
export type RestBy =
  | "credit"
  | "retry-after"
  | "resets"
  | "quota"
  | "cooldown"
  | "backoff"
  | "auth";

export interface EndpointRest {
  endpointId: string;
  endpointName: string;
  // 只冷却这个模型时有值。
  model: string | null;
  why: FailureClass;
  status: number;
  by: RestBy;
  // 连续失败次数，翻倍用。
  failures: number;
  // 需要检查（key 无效）没有结束时刻，直到用户编辑这家接口。
  until: number | null;
  // 上游原文（key 已打码）：全在冷却时原样交给 Agent。
  said: string;
}

/** 一次失败交给冷却记录的样子：哪家、哪个模型、问的哪个地址、上游怎么答的。 */
export interface FailureReport {
  endpoint: { id: string; name: string };
  model: string;
  baseUrl: string;
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
  said: string;
}

function headerValue(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/** Go 的 time.ParseDuration 写法（`1m30s`、`250ms`），解析不了返回 null。 */
function parseGoDuration(text: string): number | null {
  const units: Record<string, number> = {
    ns: 1e-6,
    us: 1e-3,
    µs: 1e-3,
    μs: 1e-3,
    ms: 1,
    s: 1000,
    m: MINUTE,
    h: 60 * MINUTE,
  };
  const parts = [...text.matchAll(/(\d+(?:\.\d*)?|\.\d+)(ns|us|µs|μs|ms|s|m|h)/g)];
  if (parts.length === 0 || parts.map((part) => part[0]).join("") !== text) return null;
  return parts.reduce((sum, part) => sum + Number(part[1]) * (units[part[2] ?? ""] ?? 0), 0);
}

/**
 * 厂商说的何时再试：Retry-After（秒数或 HTTP 日期），没有就看 OpenAI / Anthropic 那类
 * 名字同时含 ratelimit 与 reset 的头（RFC3339、Go 时长或 unix 秒）。最多信一小时；没说返回 0。
 */
export function retryAfter(headers: IncomingHttpHeaders, now: number): number {
  let wait = 0;
  const said = headerValue(headers, "retry-after");
  if (said !== undefined && said !== "") {
    const seconds = Number(said);
    if (Number.isFinite(seconds)) wait = seconds * 1000;
    else if (!Number.isNaN(Date.parse(said))) wait = Date.parse(said) - now;
  }
  for (const [name, value] of Object.entries(headers)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (wait > 0 || first === undefined || !name.includes("reset") || !name.includes("ratelimit")) {
      continue;
    }
    const duration = parseGoDuration(first);
    if (/^\d{4}-\d{2}-\d{2}T/.test(first) && !Number.isNaN(Date.parse(first))) {
      wait = Math.max(wait, Date.parse(first) - now);
    } else if (duration !== null) {
      wait = Math.max(wait, duration);
    } else if (/^\d+$/.test(first) && Number(first) > 1e9) {
      wait = Math.max(wait, Number(first) * 1000 - now);
    }
  }
  return wait <= 0 ? 0 : Math.min(wait, COOLDOWN.longestWait);
}

/** ChatGPT 的 {"error":{"resets_at":<unix>,"resets_in_seconds":<n>}}。 */
function resetsIn(body: string, now: number): number {
  const parsed = parseJson(body);
  const error = isRecord(parsed) && isRecord(parsed.error) ? parsed.error : null;
  if (!error) return 0;
  const at = typeof error.resets_at === "number" ? error.resets_at : 0;
  if (at > 0 && at * 1000 > now) return at * 1000 - now;
  const seconds = typeof error.resets_in_seconds === "number" ? error.resets_in_seconds : 0;
  return Math.max(seconds, 0) * 1000;
}

/** 错误文字里按自带时区写的重置时间；不是真实日期、已过去或超过一周返回 0。 */
function resetsWritten(body: string, now: number): number {
  const match = FAILURE_WORDS.resetsWhen.exec(wordsOf(body));
  if (!match) return 0;
  const part = (group: number) => Number(match[group]);
  const y = part(1);
  const mo = part(2);
  const d = part(3);
  const h = part(4);
  const mi = part(5);
  const s = part(6);
  const offsetHours = Number(match[8] ?? 0);
  const offsetMinutes = Number(match[9] ?? 0);
  if (offsetHours > 14 || offsetMinutes > 59) return 0;
  const offset = (match[7] === "-" ? -1 : 1) * (offsetHours * 60 + offsetMinutes) * MINUTE;
  const local = wallClock({ y, mo, d, h, mi, s });
  if (local === null) return 0;
  const wait = local - offset - now;
  return wait > 0 && wait <= COOLDOWN.longestWritten ? wait : 0;
}

/** 按 UTC 读的年月日时分秒；2026-13-45、24:61 这类会被进位的不是真实日期，返回 null。 */
function wallClock(parts: {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}): number | null {
  const { y, mo, d, h, mi, s } = parts;
  const at = Date.UTC(y, mo - 1, d, h, mi, s);
  const local = new Date(at);
  const carried =
    local.getUTCFullYear() !== y ||
    local.getUTCMonth() !== mo - 1 ||
    local.getUTCDate() !== d ||
    local.getUTCHours() !== h ||
    local.getUTCMinutes() !== mi ||
    local.getUTCSeconds() !== s;
  return carried ? null : at;
}

// 智谱写恢复时间用的时区：北京时间。
const ZHIPU_OFFSET = 8 * 60 * MINUTE;

/**
 * 智谱 1308、1310 写的恢复时间按北京时间读（magpie 的 resetsZhipu）。秒数被截断、后面自带时区
 * （那归 resetsWritten 读）、不是真实日期、已过去或超过一周返回 0。
 */
function resetsZhipu(body: string, now: number): number {
  const match = FAILURE_WORDS.zhipuResets.exec(wordsOf(body));
  if (!match) return 0;
  const after = (match[7] ?? "").trimStart();
  const ownZone = /^(?:[\d:+\-Z]|UTC|GMT)/i.test(after);
  if (ownZone) return 0;
  const [y, mo, d, h, mi, s] = match.slice(1, 7).map((group) => Number(group ?? 0));
  const at = wallClock({ y, mo, d, h, mi, s });
  if (at === null) return 0;
  const wait = at - ZHIPU_OFFSET - now;
  return wait > 0 && wait <= COOLDOWN.longestWritten ? wait : 0;
}

/** resetsIn / tryAgainIn 读出的天、小时、分钟；一个都没写或超过一周返回 0。 */
function spanWritten(match: RegExpExecArray | null): number {
  if (!match) return 0;
  const [days, hours, minutes] = match.slice(1, 4);
  if (days === undefined && hours === undefined && minutes === undefined) return 0;
  const span =
    Number(days ?? 0) * 24 * 60 * MINUTE +
    Number(hours ?? 0) * 60 * MINUTE +
    Number(minutes ?? 0) * MINUTE;
  return span > COOLDOWN.longestWritten ? 0 : span;
}

/** 错误里说的恢复时间：Claude Code 的 resets 行、ChatGPT 的 resets_at、文字写的日期、智谱的北京时间、「resets in」；没说返回 0。 */
export function resetsAt(body: string, now: number): number {
  const match = FAILURE_WORDS.resets.exec(body);
  if (match && Number(match[1]) * 1000 > now) return Number(match[1]) * 1000 - now;
  return (
    resetsIn(body, now) ||
    resetsWritten(body, now) ||
    resetsZhipu(body, now) ||
    spanWritten(FAILURE_WORDS.resetsIn.exec(wordsOf(body)))
  );
}

/** 请求发到 Cline 的 API（cline.bot 及其子域名），被拒是因为某个免费模型当天的额度用完。 */
function clineModelLimited(attempt: FailureReport): boolean {
  const host = hostOf(attempt.baseUrl);
  const atCline = host === "cline.bot" || host.endsWith(".cline.bot");
  return atCline && FAILURE_WORDS.clineFreeLimit.test(wordsOf(attempt.body));
}

/**
 * 什么时候能再问，写给 Agent 看：当天只写时分，否则带日期；后面跟 daemon 所在机器的时区，
 * 读的人可能不在同一个时区（magpie 的 heldClock）。
 */
export function heldClock(at: number, now: number): string {
  const back = new Date(at);
  const pad = (value: number) => String(value).padStart(2, "0");
  const time = `${pad(back.getHours())}:${pad(back.getMinutes())}`;
  const sameDay = back.toDateString() === new Date(now).toDateString();
  const date = `${back.getFullYear()}-${pad(back.getMonth() + 1)}-${pad(back.getDate())}`;
  const offset = -back.getTimezoneOffset();
  const sign = offset < 0 ? "-" : "+";
  const away = Math.abs(offset);
  const offsetHours = Math.floor(away / 60);
  const offsetMinutes = away % 60;
  const minutesPart = offsetMinutes > 0 ? `:${pad(offsetMinutes)}` : "";
  const zone = `UTC${sign}${offsetHours}${minutesPart}`;
  return sameDay ? `${time} ${zone}` : `${date} ${time} ${zone}`;
}

/**
 * 最后一家失败后要不要等一会儿再问它一次：服务器忙最多两次，短时限流最多三次，
 * 每次等待翻倍（厂商给了 Retry-After 就等它），超过 8 秒就不等，把错误交给 Agent。
 */
export function passing(input: {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
  again: number;
  retryPauseMs: number;
  now: number;
}): { again: boolean; waitMs: number } {
  const said = retryAfter(input.headers, input.now);
  const waitMs = said > 0 ? said : input.retryPauseMs * 2 ** input.again;
  if (waitMs > COOLDOWN.longestPause) return { again: false, waitMs: 0 };
  if ([408, 500, 502, 503, 504, 529].includes(input.status)) {
    return { again: input.again < COOLDOWN.lastRetries, waitMs };
  }
  if (input.status === 429) {
    // 额度用完或没钱不会几秒内好。
    const again =
      input.again < COOLDOWN.rateRetries &&
      failure(input.status, input.body) === "rate" &&
      !FAILURE_WORDS.credit.test(wordsOf(input.body));
    return { again, waitMs };
  }
  return { again: false, waitMs: 0 };
}

/**
 * 候选的每一家都因 429 / 402 的额度用完或欠费在冷却、且留着厂商原话时，这次不再请求：
 * 交出排第一那家的错误，`backAt` 是最早恢复的时刻。任何一家不是这样（或不在冷却）就返回 null。
 */
export function quotaHeld(
  rests: ReadonlyArray<EndpointRest | null>,
): { first: EndpointRest; backAt: number } | null {
  let backAt = Number.POSITIVE_INFINITY;
  for (const rest of rests) {
    const held =
      rest !== null &&
      (rest.why === "quota" || rest.why === "credit") &&
      (rest.status === 429 || rest.status === 402) &&
      rest.said !== "" &&
      rest.until !== null;
    if (!held) return null;
    backAt = Math.min(backAt, rest.until ?? backAt);
  }
  const first = rests[0];
  return first ? { first, backAt } : null;
}

/** 这些冷却都是额度用完或欠费：这几家多半都不会答（magpie 的 spentAfter）。 */
export function spentAfter(rests: ReadonlyArray<EndpointRest | null>): boolean {
  const spent = (rest: EndpointRest | null) => rest?.why === "quota" || rest?.why === "credit";
  return rests.length > 0 && rests.every(spent);
}

/** 额度用完只是这个模型的：写明了恢复时间又说其他模型还能用，或 Cline 某个免费模型当天用完。 */
function modelOwnQuota(attempt: FailureReport): boolean {
  const words = wordsOf(attempt.body);
  const otherModelsServe =
    FAILURE_WORDS.resetsWhen.test(words) && FAILURE_WORDS.otherModels.test(words);
  return otherModelsServe || clineModelLimited(attempt);
}

/** 额度用完：错误里写的重置时间（Cline 免费模型说的「再过多久」也算），其次 Retry-After，都没有就一刻钟；最多八天。 */
function quotaRest(attempt: FailureReport, now: number): { duration: number; by: RestBy } {
  const clineBack = clineModelLimited(attempt)
    ? spanWritten(FAILURE_WORDS.tryAgainIn.exec(wordsOf(attempt.body)))
    : 0;
  const resets = resetsAt(attempt.body, now) || clineBack;
  const said = retryAfter(attempt.headers, now);
  if (resets > 0) return { duration: Math.min(resets, COOLDOWN.longestQuota), by: "resets" };
  if (said > 0) return { duration: said, by: "retry-after" };
  return { duration: COOLDOWN.quotaRest, by: "quota" };
}

/** 一分钟起，每多失败一次翻倍，到 `longest` 为止。 */
function doubled(failures: number, longest: number): number {
  return Math.min(COOLDOWN.fallbackCooldown * 2 ** Math.min(failures - 1, 10), longest);
}

export class EndpointCooldowns {
  private readonly logger: pino.Logger;
  private readonly now: () => number;
  // 冷却结束后记录仍留着：限流「刚结束又被限流」要看上一次。
  private readonly rests = new Map<string, EndpointRest>();
  // 连续的其他失败次数，按冷却键记，模型自己的另记一份（「<endpointId>/<model>」）；答复成功清零。
  private readonly failures = new Map<string, number>();
  private readonly endTimers = new Map<string, NodeJS.Timeout>();

  constructor(options: { logger: pino.Logger; now?: () => number }) {
    this.logger = options.logger.child({ module: "api-endpoint-cooldowns" });
    this.now = options.now ?? Date.now;
  }

  /** 这家接口（或它的这个模型）正在冷却中；先看整家，再看模型。 */
  restOf(endpointId: string, model: string): EndpointRest | null {
    return this.active(endpointId) ?? this.active(`${endpointId}/${model}`);
  }

  /** 整家接口的冷却，接口列表显示用。 */
  endpointRest(endpointId: string): EndpointRest | null {
    return this.active(endpointId);
  }

  /** 照 magpie 的 restAfterMarked 定冷却；代理没连上、请求本身被拒都不怪这家，返回 null。 */
  markFailed(attempt: FailureReport): EndpointRest | null {
    const now = this.now();
    const why = endpointFailure(attempt.status, attempt.body);
    if (why === "proxy" || requestRefused(attempt.status, attempt.body)) return null;
    const { id } = attempt.endpoint;
    const modelKey = `${id}/${attempt.model}`;
    const unserved = why === "other" && modelRefused(attempt.status, attempt.body);
    const modelQuota = why === "quota" && modelOwnQuota(attempt);
    let key = unserved || modelQuota ? modelKey : id;

    let duration: number | null;
    let by: RestBy;
    let failures = 1;
    switch (why) {
      case "credit":
        duration = COOLDOWN.creditRest;
        by = "credit";
        break;
      case "quota":
        ({ duration, by } = quotaRest(attempt, now));
        break;
      case "rate":
        ({ duration, by, failures } = this.rateRest({ key, attempt, now }));
        break;
      case "auth":
        duration = null;
        by = "auth";
        break;
      case "other":
        ({ failures, key } = this.backoff({ key, modelKey, unserved }));
        duration = doubled(failures, COOLDOWN.longestRetry);
        by = "backoff";
        break;
    }

    const rest: EndpointRest = {
      endpointId: id,
      endpointName: attempt.endpoint.name,
      model: key === modelKey ? attempt.model : null,
      why,
      status: attempt.status,
      by,
      failures,
      until: duration === null ? null : now + duration,
      said: attempt.said,
    };
    this.rests.set(key, rest);
    this.logger.info(
      {
        endpoint: rest.endpointName,
        ...(rest.model ? { model: rest.model } : {}),
        failure: why,
        status: rest.status,
        until: rest.until === null ? null : new Date(rest.until).toISOString(),
      },
      "API endpoint is cooling down",
    );
    this.scheduleEnd(key, rest);
    return rest;
  }

  /** 答复成功：这家与这个模型的冷却和连续失败次数一起清掉。 */
  served(endpointId: string, model: string): void {
    for (const key of [endpointId, `${endpointId}/${model}`]) {
      this.failures.delete(key);
      this.end(key);
    }
  }

  /** 用户编辑了这家接口：「需要检查」解除，冷却照旧。 */
  clearNeedsCheck(endpointId: string): void {
    if (this.rests.get(endpointId)?.why === "auth") this.end(endpointId);
  }

  /** 「立刻恢复」、编辑连接与删除：清掉这家及其各个模型的冷却。 */
  clear(endpointId: string): void {
    for (const key of this.rests.keys()) {
      if (key === endpointId || key.startsWith(`${endpointId}/`)) {
        this.failures.delete(key);
        this.end(key);
      }
    }
  }

  /**
   * 其他失败记一次，整家（或不提供的这个模型）一份，模型自己一份。模型自己的次数只有它自己答上才清零；
   * 比整家的多，说明同一家别的模型其间答上过，失败是这个模型的：按它自己的次数翻倍，只冷却它（magpie #2241）。
   */
  private backoff(input: { key: string; modelKey: string; unserved: boolean }): {
    failures: number;
    key: string;
  } {
    const failures = this.countFailure(input.key);
    const own = input.unserved ? 0 : this.countFailure(input.modelKey);
    return own > failures ? { failures: own, key: input.modelKey } : { failures, key: input.key };
  }

  private countFailure(key: string): number {
    const failures = (this.failures.get(key) ?? 0) + 1;
    this.failures.set(key, failures);
    return failures;
  }

  private active(key: string): EndpointRest | null {
    const rest = this.rests.get(key);
    if (!rest) return null;
    return rest.until === null || rest.until > this.now() ? rest : null;
  }

  /** 限流：一分钟起，冷却刚结束又被限流就翻倍，最长半小时；厂商说的时间更长就用它。 */
  private rateRest(input: { key: string; attempt: FailureReport; now: number }): {
    duration: number;
    by: RestBy;
    failures: number;
  } {
    const { now } = input;
    const previous = this.rests.get(input.key);
    let failures = 1;
    if (previous?.why === "rate" && previous.until !== null) {
      if (now < previous.until) failures = Math.max(previous.failures, 1);
      else if (now - previous.until < COOLDOWN.rateForget) {
        failures = Math.max(previous.failures, 1) + 1;
      }
    }
    let duration = doubled(failures, COOLDOWN.longestRateRest);
    let by: RestBy = failures > 1 ? "backoff" : "cooldown";
    let said = retryAfter(input.attempt.headers, now);
    let saidBy: RestBy = "retry-after";
    const resets = resetsAt(input.attempt.body, now);
    if (resets > said) {
      said = Math.min(resets, COOLDOWN.longestQuota);
      saidBy = "resets";
    }
    if (said > 0 && said >= duration) {
      duration = said;
      by = saidBy;
    }
    return { duration, by, failures };
  }

  private scheduleEnd(key: string, rest: EndpointRest): void {
    clearTimeout(this.endTimers.get(key));
    this.endTimers.delete(key);
    if (rest.until === null) return;
    const timer = setTimeout(() => {
      this.endTimers.delete(key);
      this.logEnded(rest);
    }, rest.until - this.now());
    timer.unref();
    this.endTimers.set(key, timer);
  }

  private end(key: string): void {
    const rest = this.active(key);
    clearTimeout(this.endTimers.get(key));
    this.endTimers.delete(key);
    this.rests.delete(key);
    if (rest) this.logEnded(rest);
  }

  private logEnded(rest: EndpointRest): void {
    this.logger.info(
      {
        endpoint: rest.endpointName,
        ...(rest.model ? { model: rest.model } : {}),
        failure: rest.why,
      },
      "API endpoint cooldown ended",
    );
  }
}
