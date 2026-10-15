import pino from "pino";
import { describe, expect, test, vi } from "vitest";
import {
  COOLDOWN,
  EndpointCooldowns,
  passing,
  quotaHeld,
  resetsAt,
  retryAfter,
} from "./cooldown.js";

/*
 * 冷却照 magpie（MIT，THIRD_PARTY_NOTICES；research/magpie-port-inventory.md 第 2 节）：时长常量、各分类的冷却时长、
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
  input: { status: number; body?: string; headers?: Record<string, string>; endpoint?: typeof A },
) {
  return store.markFailed({
    endpoint: input.endpoint ?? A,
    model: "kimi-k2",
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
  test("held when each rests out of quota or credit for a 429 or 402 with the vendor's words", () => {
    const { store, clock } = cooldowns();
    const a = fail(store, { status: 429, body: "quota exhausted" });
    const b = fail(store, { status: 402, body: "no credit", endpoint: B });
    expect(quotaHeld([a, b])).toEqual({ last: b, backAt: a?.until });
    clock.now += MINUTE;
    const c = fail(store, { status: 503, body: "busy" });
    expect(quotaHeld([c, b])).toBeNull();
    expect(quotaHeld([])).toBeNull();
  });
});
