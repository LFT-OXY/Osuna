import { describe, expect, test } from "vitest";
import {
  FAILURE_WORDS,
  endpointFailure,
  failure,
  lateRests,
  modelRefused,
  modelRetired,
  retryable,
  wordsOf,
} from "./failure.js";

/*
 * 判错照 magpie（research/magpie-port-inventory.md 第 1 节）：每条正则一正一反，
 * 归类顺序、换不换下一家、只冷却模型的判定各有例子；例子取自 magpie 源码注释里的厂商原话。
 */

const WORD_CASES: Record<keyof typeof FAILURE_WORDS, { hits: string[]; misses: string[] }> = {
  credit: {
    hits: ["Insufficient balance", "billing hard limit", "账户余额不足", "账户已停用"],
    misses: ["Rate limit exceeded"],
  },
  broke: {
    hits: ["余额不足或无可用资源包，请充值", "Credits exhausted. Please visit the link below"],
    misses: ["credit card on file"],
  },
  usedUp: {
    hits: ["You exceeded your current quota", "usage limit reached", "本月额度已用完"],
    misses: ["Rate limit exceeded"],
  },
  rate: {
    hits: ["Rate limit exceeded", "Too Many Requests", "60 RPM", "请求太频繁"],
    misses: ["daily quota used"],
  },
  planned: {
    hits: ["api key 7天限额已用完", "a day's free requests per day", "weekly cap"],
    misses: ["Rate limit exceeded"],
  },
  resets: {
    hits: ["Claude AI usage limit reached|1760184962"],
    misses: ["usage limit reached"],
  },
  resetsWhen: {
    hits: [
      "将在 2026-10-11 20:16:02 UTC+8重置",
      "your usage will reset at 2026-10-11 12:37:53 UTC+8, please wait",
    ],
    misses: ["your usage will reset at 2026-10-11 12:37:53 UTC+"],
  },
  otherModels: {
    hits: ["您也可以切换其他模型继续使用", "or switch to other models"],
    misses: ["switch it off"],
  },
  quotaCodes: {
    hits: ["usage_limit_reached", "RESOURCE_EXHAUSTED"],
    misses: ["当前模型负载已经达到上限，请稍后重试"],
  },
  proxyDown: {
    hits: ["proxyconnect tcp: dial tcp 127.0.0.1:7890", "socks connect tcp"],
    misses: ["connection refused"],
  },
  tooLong: {
    hits: [
      "prompt is too long: 210000 tokens > 200000 maximum",
      "This model's maximum context length is 128000 tokens",
      "exceeded model token limit",
      "上下文长度超过限制",
    ],
    misses: ["max_tokens is too large"],
  },
  pace: {
    hits: ["Rate limit reached for TPM", "please wait and try again later", "throttled"],
    misses: ["prompt is too long"],
  },
  quota: {
    hits: ["insufficient_quota", "server overloaded", "限流中"],
    misses: ["invalid json"],
  },
  unserved: {
    hits: ["model is not available in the current token plan", "model_not_found", "模型不存在"],
    misses: ["invalid api key"],
  },
  retired: {
    hits: ['{"type":"ModelDeprecated"}', "The model gpt-4-0314 has been deprecated"],
    misses: ["deprecated header"],
  },
  zenModelGone: {
    hits: ['{"message":"Model glm-5-free is not supported"}'],
    misses: ["The model is not supported"],
  },
  refused: {
    hits: ["Illegal API invocation from an unapproved channel"],
    misses: ["refused to connect"],
  },
  shape: {
    hits: ["unknown field `foo`", "Extra inputs are not permitted", "failed to deserialize"],
    misses: ["unknown error"],
  },
  region: {
    hits: [
      "User location is not supported for the API use.",
      "unsupported_country_region_territory",
    ],
    misses: ["location header missing"],
  },
  protection: {
    hits: ["response protection is unavailable"],
    misses: ["protection enabled"],
  },
};

describe("the vendor words magpie reads", () => {
  test.each(Object.entries(WORD_CASES))("%s", (name, { hits, misses }) => {
    const words = FAILURE_WORDS[name as keyof typeof FAILURE_WORDS];
    for (const hit of hits) expect(words.test(hit), hit).toBe(true);
    for (const miss of misses) expect(words.test(miss), miss).toBe(false);
  });

  test("escaped Chinese in JSON is matched decoded too", () => {
    const body = JSON.stringify({ error: { message: "用量已达上限" } }).replace(
      /[一-鿿]/g,
      (c) => `\\u${c.charCodeAt(0).toString(16)}`,
    );
    expect(body).not.toContain("用量");
    expect(wordsOf(body)).toContain("用量已达上限");
    expect(failure(429, body)).toBe("quota");
  });
});

describe("why a reply failed", () => {
  test.each([
    { status: 502, body: "proxyconnect tcp: refused", expected: "proxy" },
    { status: 400, body: "prompt is too long: 210000 tokens", expected: "other" },
    { status: 402, body: "Payment Required", expected: "credit" },
    { status: 403, body: "Insufficient balance", expected: "credit" },
    { status: 429, body: "余额不足或无可用资源包，请充值", expected: "credit" },
    { status: 429, body: '{"error":{"code":"insufficient_quota"}}', expected: "credit" },
    { status: 429, body: "将在 2026-10-11 20:16:02 UTC+8重置", expected: "quota" },
    { status: 429, body: "Rate limit exceeded", expected: "rate" },
    { status: 429, body: "api key 7天限额已用完 rate_limit_exceeded", expected: "quota" },
    { status: 503, body: '{"error":{"status":"RESOURCE_EXHAUSTED"}}', expected: "quota" },
    { status: 500, body: "当前模型负载已经达到上限，请稍后重试", expected: "other" },
    { status: 400, body: "You exceeded your current quota", expected: "quota" },
    { status: 429, body: "slow", expected: "rate" },
    { status: 503, body: "upstream unavailable", expected: "other" },
  ])("$status $body → $expected", ({ status, body, expected }) => {
    expect(failure(status, body)).toBe(expected);
  });

  test("a refused key or permission needs checking, unless the words say why otherwise", () => {
    expect(endpointFailure(401, "invalid api key")).toBe("auth");
    expect(endpointFailure(403, "forbidden")).toBe("auth");
    expect(endpointFailure(403, "Insufficient balance")).toBe("credit");
    // OpenCode Zen 用 401 说模型下线了，key 本身没问题。
    expect(endpointFailure(401, '{"message":"Model glm-5-free is not supported"}')).toBe("other");
    expect(endpointFailure(403, "model is not available in the current token plan")).toBe("other");
    expect(endpointFailure(403, "User location is not supported for the API use.")).toBe("other");
  });
});

describe("whether another endpoint is worth asking", () => {
  test.each([401, 402, 403, 404, 408, 429, 500, 502, 503, 529])("%i is", (status) => {
    expect(retryable(status, "x")).toBe(true);
  });

  test("a conversation too long for the model is not: every endpoint would refuse it", () => {
    expect(retryable(400, "prompt is too long: 210000 tokens")).toBe(false);
    expect(retryable(413, "context_length_exceeded")).toBe(false);
  });

  test("a 400 or 422 is only when its words say quota, unserved, refused, shape or region", () => {
    expect(retryable(400, "invalid json")).toBe(false);
    expect(retryable(400, "quota exceeded")).toBe(true);
    expect(retryable(422, "model_not_found")).toBe(true);
    expect(retryable(400, "unapproved channel")).toBe(true);
    expect(retryable(400, "Extra inputs are not permitted")).toBe(true);
    expect(retryable(400, "unsupported_country_region_territory")).toBe(true);
    expect(retryable(409, "quota exceeded")).toBe(false);
  });

  test("a retired model is, at any of its statuses", () => {
    expect(retryable(410, "The model x has been deprecated")).toBe(true);
    expect(modelRetired(410, "The model x has been deprecated")).toBe(true);
    expect(modelRetired(400, "The model has been deprecated, quota exceeded")).toBe(false);
    expect(modelRetired(401, '{"message":"Model glm-5-free is not supported"}')).toBe(true);
    expect(modelRetired(500, "The model x has been deprecated")).toBe(false);
  });

  test("a model the key does not serve rests only that model", () => {
    expect(modelRefused(403, "model is not available in the current token plan")).toBe(true);
    expect(modelRefused(404, "model_not_found")).toBe(true);
    expect(modelRefused(403, "model not available, quota exceeded")).toBe(false);
    expect(modelRefused(429, "model_not_found")).toBe(false);
  });

  test("a reply that broke off rests its endpoint unless the conversation or a filter was the cause", () => {
    expect(lateRests("socket hang up")).toBe(true);
    expect(lateRests("prompt is too long")).toBe(false);
    expect(lateRests("Illegal API invocation from an unapproved channel")).toBe(false);
    expect(lateRests("response protection is unavailable")).toBe(false);
  });
});
