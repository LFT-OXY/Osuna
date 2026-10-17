// 用例取自 magpie（https://github.com/yetone/magpie，internal/gateway/routing.go、fallback.go 的冷却常量，zhipu_resets_test.go）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import pino from "pino";
import { describe, expect, test, vi } from "vitest";
import {
  COOLDOWN,
  EndpointCooldowns,
  heldClock,
  passing,
  quotaHeld,
  resetsAt,
  retryAfter,
} from "./cooldown.js";

/*
 * 冷却照 magpie（research/magpie-port-inventory.md 第 2 节）：时长常量、各分类的冷却时长、
 * 限流与服务器错误的翻倍、厂商自己说的时间、最后一家的原地重试、全在冷却时不再请求。
 */

const MINUTE = 60_000;
const START = Date.parse("2026-10-14T12:00:00Z");

function cooldowns() {
  const clock = { now: START };
  const lines: string[] = [];
  const logger = pino({ level: "info" }, { write: (line: string) => lines.push(line) });
  const store = new EndpointCooldowns({ logger, now: () => clock.now });
  return { store, clock, lines };
}

const A = { id: "ep_a", name: "Relay A" };
const B = { id: "ep_b", name: "Relay B" };

function fail(
  store: EndpointCooldowns,
  input: {
    status: number;
    body?: string;
    headers?: Record<string, string>;
    endpoint?: typeof A;
    model?: string;
    baseUrl?: string;
  },
) {
  return store.markFailed({
    endpoint: input.endpoint ?? A,
    model: input.model ?? "kimi-k2",
    baseUrl: input.baseUrl ?? "https://relay-a.test/v1",
    status: input.status,
    headers: input.headers ?? {},
    body: input.body ?? "",
    said: input.body ?? "",
  });
}

describe("the cooldown constants", () => {
  test("are magpie's", () => {
    expect(COOLDOWN).toEqual({
      fallbackCooldown: MINUTE,
      creditRest: 30 * MINUTE,
      quotaRest: 15 * MINUTE,
      longestWait: 60 * MINUTE,
      longestQuota: 8 * 24 * 60 * MINUTE,
      longestRetry: 10 * MINUTE,
      longestRateRest: 30 * MINUTE,
      rateForget: 30 * MINUTE,
      longestWritten: 7 * 24 * 60 * MINUTE,
      lastRetries: 2,
      rateRetries: 3,
      longestPause: 8_000,
      retryPause: 1_000,
    });
  });
});

describe("how long an endpoint sits out", () => {
  test("out of credit: half an hour", () => {
    const { store } = cooldowns();
    expect(fail(store, { status: 402 })).toMatchObject({
      why: "credit",
      by: "credit",
      until: START + 30 * MINUTE,
    });
  });

  test("out of quota: as long as the vendor says, a quarter hour when it says nothing", () => {
    const { store } = cooldowns();
    expect(fail(store, { status: 429, body: "quota exhausted" })).toMatchObject({
      why: "quota",
      by: "quota",
      until: START + 15 * MINUTE,
    });
    const resetsIn2h = Math.floor((START + 120 * MINUTE) / 1000);
    expect(
      fail(store, { status: 429, body: `Claude AI usage limit reached|${resetsIn2h}` }),
    ).toMatchObject({ why: "quota", by: "resets", until: resetsIn2h * 1000 });
    expect(
      fail(store, { status: 429, body: "quota exhausted", headers: { "retry-after": "1200" } }),
    ).toMatchObject({ by: "retry-after", until: START + 20 * MINUTE });
  });

  test("out of quota is believed for at most eight days", () => {
    const { store } = cooldowns();
    const in20Days = Math.floor((START + 20 * 24 * 60 * MINUTE) / 1000);
    expect(
      fail(store, {
        status: 429,
        body: JSON.stringify({ error: { type: "usage_limit_reached", resets_at: in20Days } }),
      }),
    ).toMatchObject({ by: "resets", until: START + COOLDOWN.longestQuota });
  });

  test("rate limited: a minute, doubled each time it is limited again soon after, up to half an hour", () => {
    const { store, clock } = cooldowns();
    const rested: number[] = [];
    for (let i = 0; i < 7; i++) {
      const rest = fail(store, { status: 429, body: "Rate limit exceeded" });
      rested.push(((rest?.until ?? 0) - clock.now) / MINUTE);
      // 冷却刚结束又被限流。
      clock.now = (rest?.until ?? 0) + MINUTE;
    }
    expect(rested).toEqual([1, 2, 4, 8, 16, 30, 30]);
  });

  test("rate limited again while still resting keeps the count; after half an hour it starts over", () => {
    const { store, clock } = cooldowns();
    fail(store, { status: 429, body: "Rate limit exceeded" });
    clock.now += 2 * MINUTE;
    const second = fail(store, { status: 429, body: "Rate limit exceeded" });
    expect(second).toMatchObject({ failures: 2, by: "backoff", until: clock.now + 2 * MINUTE });
    const third = fail(store, { status: 429, body: "Rate limit exceeded" });
    expect(third).toMatchObject({ failures: 2 });
    clock.now = (third?.until ?? 0) + 31 * MINUTE;
    expect(fail(store, { status: 429, body: "Rate limit exceeded" })).toMatchObject({
      failures: 1,
      by: "cooldown",
      until: clock.now + MINUTE,
    });
  });

  test("rate limited with the vendor's own longer time: that time", () => {
    const { store } = cooldowns();
    expect(
      fail(store, { status: 429, body: "slow down", headers: { "retry-after": "300" } }),
    ).toMatchObject({ why: "rate", by: "retry-after", until: START + 5 * MINUTE });
    expect(
      fail(store, {
        status: 429,
        body: "slow down",
        headers: { "retry-after": "20" },
        endpoint: B,
      }),
    ).toMatchObject({ by: "cooldown", until: START + MINUTE });
  });

  test("any other failure: a minute, doubled each time in a row, up to ten minutes, until it answers", () => {
    const { store, clock } = cooldowns();
    const rested: number[] = [];
    for (let i = 0; i < 6; i++) {
      const rest = fail(store, { status: 503 });
      rested.push(((rest?.until ?? 0) - clock.now) / MINUTE);
    }
    expect(rested).toEqual([1, 2, 4, 8, 10, 10]);
    store.served("ep_a", "kimi-k2");
    expect(store.restOf("ep_a", "kimi-k2")).toBeNull();
    expect(fail(store, { status: 503 })).toMatchObject({ until: clock.now + MINUTE });
  });

  test("a bad key needs checking with no end; a proxy that did not connect rests nobody", () => {
    const { store } = cooldowns();
    expect(fail(store, { status: 401, body: "invalid api key" })).toMatchObject({
      why: "auth",
      until: null,
    });
    expect(store.restOf("ep_a", "kimi-k2")).toMatchObject({ why: "auth" });
    expect(fail(store, { status: 502, body: "proxyconnect tcp", endpoint: B })).toBeNull();
    expect(store.restOf("ep_b", "kimi-k2")).toBeNull();
  });

  test("a request the vendor cannot read, or refuses from this client, rests nobody", () => {
    const { store } = cooldowns();
    expect(fail(store, { status: 400, body: "Extra inputs are not permitted" })).toBeNull();
    expect(
      fail(store, { status: 400, body: "Illegal API invocation from an unapproved channel" }),
    ).toBeNull();
    expect(store.restOf("ep_a", "kimi-k2")).toBeNull();
    expect(fail(store, { status: 400, body: "quota exceeded" })).toMatchObject({ why: "quota" });
  });

  test("a model the key does not serve rests only that model", () => {
    const { store } = cooldowns();
    fail(store, { status: 404, body: "model_not_found" });
    expect(store.restOf("ep_a", "kimi-k2")).toMatchObject({ model: "kimi-k2" });
    expect(store.restOf("ep_a", "glm-4.6")).toBeNull();
    expect(store.endpointRest("ep_a")).toBeNull();
    fail(store, {
      status: 429,
      body: "将在 2026-10-14 20:30:00 UTC+8重置，您也可以切换其他模型继续使用",
    });
    expect(store.restOf("ep_a", "glm-4.6")).toBeNull();
  });

  test("a 402 that says a usage limit and nothing of money is out of quota until it says, not out of credit", () => {
    const { store } = cooldowns();
    const factory =
      '{"error":{"message":"Factory: You\'ve reached your weekly standard usage limit (resets in 0h 19min). Switch to Droid Core or enable Extra Usage to continue."}}';
    expect(fail(store, { status: 402, body: factory })).toMatchObject({
      why: "quota",
      by: "resets",
      until: START + 19 * MINUTE,
    });
    expect(
      fail(store, {
        status: 402,
        body: '{"error":{"message":"Payment required: your subscription payment failed"}}',
        endpoint: B,
      }),
    ).toMatchObject({ why: "credit", until: START + 30 * MINUTE });
  });

  test("Cline's free model out of its day rests that model alone, until the time it says", () => {
    const { store } = cooldowns();
    const said =
      "Daily free limit reached on model deepseek/deepseek-v4-flash. Try again in 23h 59m";
    const free = "cline-free/deepseek-v4.1-flash";
    expect(
      fail(store, {
        status: 429,
        body: JSON.stringify({ error: { message: said } }),
        model: free,
        baseUrl: "https://api.cline.bot/api/v1",
      }),
    ).toMatchObject({
      why: "quota",
      model: free,
      by: "resets",
      until: START + (23 * 60 + 59) * MINUTE,
    });
    expect(store.restOf("ep_a", free)).toMatchObject({ model: free });
    expect(store.restOf("ep_a", "cline-free/mimo-v2.6-flash")).toBeNull();
    expect(store.endpointRest("ep_a")).toBeNull();
    // 别家说同样的话照旧冷却整家，恢复时间不按 Cline 的说法读。
    expect(fail(store, { status: 429, body: said, model: free, endpoint: B })).toMatchObject({
      model: null,
      by: "quota",
      until: START + 15 * MINUTE,
    });
  });

  test("a model failing again after a sibling answered climbs its own ladder and rests alone", () => {
    const { store, clock } = cooldowns();
    const glm = "glm-4.6";
    expect(fail(store, { status: 503 })).toMatchObject({ model: null, failures: 1 });
    // 冷却结束后，同一家的另一个模型答上了：整家的失败次数清零，kimi-k2 自己的还留着。
    clock.now += 2 * MINUTE;
    store.served("ep_a", glm);
    const second = fail(store, { status: 503 });
    expect(second).toMatchObject({ model: "kimi-k2", failures: 2, until: clock.now + 2 * MINUTE });
    expect(store.restOf("ep_a", glm)).toBeNull();
    expect(store.endpointRest("ep_a")).toBeNull();
    clock.now += 3 * MINUTE;
    store.served("ep_a", glm);
    expect(fail(store, { status: 503 })).toMatchObject({
      model: "kimi-k2",
      failures: 3,
      until: clock.now + 4 * MINUTE,
    });
    expect(store.restOf("ep_a", glm)).toBeNull();
    // 它自己答上了，自己的次数也清零。
    clock.now += 5 * MINUTE;
    store.served("ep_a", "kimi-k2");
    expect(fail(store, { status: 503 })).toMatchObject({ model: null, failures: 1 });
  });

  test("a rest ends on its own, when it answers, or when cleared by hand; and each is logged", () => {
    vi.useFakeTimers({ now: START });
    const lines: string[] = [];
    const logger = pino({ level: "info" }, { write: (line: string) => lines.push(line) });
    const store = new EndpointCooldowns({ logger });
    try {
      fail(store, { status: 402 });
      vi.advanceTimersByTime(31 * MINUTE);
      expect(store.restOf("ep_a", "kimi-k2")).toBeNull();
      fail(store, { status: 503 });
      store.served("ep_a", "kimi-k2");
      fail(store, { status: 401 });
      store.clear("ep_a");
      expect(store.endpointRest("ep_a")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
    const logged = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(logged.map((line) => line.msg)).toEqual([
      "API endpoint is cooling down",
      "API endpoint cooldown ended",
      "API endpoint is cooling down",
      "API endpoint cooldown ended",
      "API endpoint is cooling down",
      "API endpoint cooldown ended",
    ]);
    expect(logged[4]).toMatchObject({ endpoint: "Relay A", failure: "auth", until: null });
    expect(logged[0]).toMatchObject({
      endpoint: "Relay A",
      failure: "credit",
      until: new Date(START + 30 * MINUTE).toISOString(),
    });
  });
});

describe("what the vendor says about when to try again", () => {
  test("Retry-After in seconds or as a date, then the ratelimit reset headers, at most an hour", () => {
    expect(retryAfter({ "retry-after": "30" }, START)).toBe(30_000);
    expect(retryAfter({ "retry-after": new Date(START + 90_000).toUTCString() }, START)).toBe(
      90_000,
    );
    expect(retryAfter({ "anthropic-ratelimit-tokens-reset": "2026-10-14T12:02:00Z" }, START)).toBe(
      2 * MINUTE,
    );
    expect(retryAfter({ "x-ratelimit-reset-requests": "1m30s" }, START)).toBe(90_000);
    expect(
      retryAfter({ "x-ratelimit-reset": String(Math.floor((START + 45_000) / 1000)) }, START),
    ).toBe(45_000);
    expect(retryAfter({ "retry-after": "86400" }, START)).toBe(COOLDOWN.longestWait);
    expect(retryAfter({}, START)).toBe(0);
  });

  test("a reset time written in the error, in its own offset, believed for a week", () => {
    expect(resetsAt("将在 2026-10-14 21:00:00 UTC+8重置", START)).toBe(60 * MINUTE);
    expect(resetsAt("your usage will reset at 2026-10-14 13:30:00 UTC+0, ok", START)).toBe(
      90 * MINUTE,
    );
    expect(resetsAt("将在 2026-13-45 21:00:00 UTC+8重置", START)).toBe(0);
    expect(resetsAt("将在 2026-10-14 10:00:00 UTC+0重置", START)).toBe(0);
    expect(resetsAt("将在 2026-11-14 10:00:00 UTC+0重置", START)).toBe(0);
    expect(resetsAt(JSON.stringify({ error: { resets_in_seconds: 600 } }), START)).toBe(
      10 * MINUTE,
    );
  });

  test("Zhipu's 1308 and 1310 written without a zone, read in Beijing's time (magpie zhipu_resets_test.go)", () => {
    const SECOND = 1_000;
    const HOUR = 60 * MINUTE;
    // 北京时间 16:25。
    const player = Date.parse("2026-10-15T08:25:00Z");
    const zaiPlayer = "Usage limit reached for 5 hour. Your limit will reset at 2026-10-15 20:12";
    const zai1308 = "Usage limit reached for 5 hour. Your limit will reset at 2026-10-15 20:12:13";
    const zai1310 = "Weekly/Monthly Limit Exhausted. Your limit will reset at 2026-10-10 21:00:06";
    const bigmodel = "已达到 5 小时的使用上限。您的限额将在 2026-10-15 20:12:13 重置";
    const escapedBigmodel = JSON.stringify({ error: { code: "1308", message: bigmodel } }).replace(
      /[一-鿿]/g,
      (c) => `\\u${c.charCodeAt(0).toString(16)}`,
    );
    const cases = [
      { body: zaiPlayer, now: player, wait: 3 * HOUR + 47 * MINUTE },
      {
        body: JSON.stringify({ error: { code: "1308", message: zaiPlayer } }),
        now: player,
        wait: 3 * HOUR + 47 * MINUTE,
      },
      {
        body: JSON.stringify({ type: "error", error: { type: "1308", message: zai1308 } }),
        now: player,
        wait: 3 * HOUR + 47 * MINUTE + 13 * SECOND,
      },
      {
        body: "Usage limit reached for 5 hour. Your limit will reset at 2026-09-22 01:18:11",
        now: Date.parse("2026-09-21T17:17:32Z"),
        wait: 39 * SECOND,
      },
      {
        body: JSON.stringify({ error: { code: "1310", message: zai1310 } }),
        now: Date.parse("2026-10-09T11:32:34Z"),
        wait: 25 * HOUR + 27 * MINUTE + 32 * SECOND,
      },
      { body: bigmodel, now: player, wait: 3 * HOUR + 47 * MINUTE + 13 * SECOND },
      { body: escapedBigmodel, now: player, wait: 3 * HOUR + 47 * MINUTE + 13 * SECOND },
      // 截断的、自带时区的、不是真日期的、已过去的、超过一周的、别家不带时区的：都不读。
      { body: zai1308.slice(0, -1), now: player, wait: 0 },
      { body: zai1308.slice(0, -2), now: player, wait: 0 },
      { body: zaiPlayer.slice(0, -1), now: player, wait: 0 },
      { body: zaiPlayer.slice(0, zaiPlayer.indexOf(" 20:12")), now: player, wait: 0 },
      { body: `${zai1308} UTC`, now: player, wait: 0 },
      { body: `${zai1308}+00:00`, now: player, wait: 0 },
      { body: `${zai1308}Z`, now: player, wait: 0 },
      { body: zai1308.replace("2026-10-15", "2026-13-15"), now: player, wait: 0 },
      { body: zai1308.replace("20:12:13", "25:12:13"), now: player, wait: 0 },
      { body: zai1308, now: Date.parse("2026-10-15T12:13:00Z"), wait: 0 },
      { body: zai1308, now: Date.parse("2026-10-07T00:00:00Z"), wait: 0 },
      { body: "将在 2026-10-11 20:16:02 重置", now: player, wait: 0 },
      { body: "this model is retired at 2026-10-15 20:12:13", now: player, wait: 0 },
    ];
    expect(cases.map(({ body, now }) => ({ body, now, wait: resetsAt(body, now) }))).toEqual(cases);
  });

  test("how long until it is back, written in days, hours and minutes", () => {
    expect(resetsAt("weekly standard usage limit (resets in 0h 19min).", START)).toBe(19 * MINUTE);
    expect(resetsAt("Droid Core usage limit (resets in 3d 4h).", START)).toBe(
      (3 * 24 + 4) * 60 * MINUTE,
    );
    expect(resetsAt("resets in 45 minutes", START)).toBe(45 * MINUTE);
    expect(resetsAt("resets in 8d", START)).toBe(0);
    expect(resetsAt("resets in a while", START)).toBe(0);
  });
});

describe("telling when it is back", () => {
  test("the time with its offset, and the date when it is not today", () => {
    const zone = process.env.TZ;
    const told = (tz: string, at: string, now: string) => {
      process.env.TZ = tz;
      return heldClock(Date.parse(at), Date.parse(now));
    };
    try {
      const now = "2026-10-15T08:25:00Z";
      expect([
        told("Asia/Shanghai", "2026-10-15T12:12:13Z", now),
        told("Asia/Shanghai", "2026-10-16T01:00:00Z", now),
        told("UTC", "2026-10-15T12:12:13Z", now),
        told("America/St_Johns", "2026-10-15T12:12:13Z", now),
      ]).toEqual(["20:12 UTC+8", "2026-10-16 09:00 UTC+8", "12:12 UTC+0", "09:42 UTC-2:30"]);
    } finally {
      if (zone === undefined) delete process.env.TZ;
      else process.env.TZ = zone;
    }
  });
});

describe("asking the last endpoint again after a moment", () => {
  test("a busy server twice, a rate limit three times, waiting longer each time", () => {
    const ask = (status: number, again: number, body = "") =>
      passing({ status, headers: {}, body, again, retryPauseMs: 1_000, now: START });
    expect(ask(503, 0)).toEqual({ again: true, waitMs: 1_000 });
    expect(ask(529, 1)).toEqual({ again: true, waitMs: 2_000 });
    expect(ask(503, 2).again).toBe(false);
    expect(ask(429, 2, "Rate limit exceeded")).toEqual({ again: true, waitMs: 4_000 });
    expect(ask(429, 3, "Rate limit exceeded").again).toBe(false);
  });

  test("not when it is out of quota or credit, not for other errors, not when the wait is long", () => {
    const ask = (status: number, body: string, headers: Record<string, string> = {}) =>
      passing({ status, headers, body, again: 0, retryPauseMs: 1_000, now: START }).again;
    expect(ask(429, "quota exhausted")).toBe(false);
    expect(ask(429, "Rate limit exceeded, check your billing")).toBe(false);
    expect(ask(400, "bad request")).toBe(false);
    expect(ask(503, "busy", { "retry-after": "30" })).toBe(false);
    expect(ask(503, "busy", { "retry-after": "5" })).toBe(true);
  });
});

describe("not asking at all while every endpoint is out of quota", () => {
  test("held when each rests out of quota or credit for a 429 or 402 with the vendor's words; the first one's words are given", () => {
    const { store, clock } = cooldowns();
    clock.now += MINUTE;
    const a = fail(store, { status: 429, body: "quota exhausted" });
    clock.now -= MINUTE;
    const b = fail(store, { status: 402, body: "no credit", endpoint: B });
    expect(quotaHeld([a, b])).toEqual({ first: a, backAt: a?.until });
    expect(quotaHeld([b, a])).toEqual({ first: b, backAt: a?.until });
    clock.now += MINUTE;
    const c = fail(store, { status: 503, body: "busy" });
    expect(quotaHeld([c, b])).toBeNull();
    expect(quotaHeld([])).toBeNull();
  });
});
