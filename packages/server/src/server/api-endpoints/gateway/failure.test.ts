// 用例取自 magpie（https://github.com/yetone/magpie，internal/gateway/routing.go、fallback.go、gateway.go 的源码注释，shape_fallback_test.go 与 overflow_cap_test.go）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { describe, expect, test } from "vitest";
import {
  EMPTY_REPLY,
  FAILURE_WORDS,
  endpointFailure,
  failure,
  lateRests,
  modelRefused,
  modelRetired,
  requestRefused,
  retryable,
  saysTooLong,
  streamStatus,
  wordsOf,
} from "./failure.js";

/*
 * 判错照 magpie（MIT，THIRD_PARTY_NOTICES；research/magpie-port-inventory.md 第 1 节）：每条正则一正一反，
 * 归类顺序、换不换下一家、只冷却模型的判定各有例子；例子取自 magpie 源码注释里的厂商原话。
 */

// magpie shape_fallback_test.go：Command Code 只带 trace id 的 400（#2313）。
const COMMAND_CODE_BARE_400 =
  '{"message":"invalid request error trace_id: 251c3c29761c17fdc459480ed9c68932","type":"invalid_request_error"}';
// magpie factory_pool_rest_test.go：Factory 的 Standard 用完（#1979）。
const FACTORY_STANDARD_OUT =
  '{"error":{"message":"Factory: You\'ve reached your weekly standard usage limit (resets in 0h 19min). Switch to Droid Core or enable Extra Usage to continue."}}';
// magpie cline_free_limit_test.go：Cline 免费模型当天额度用完（#1398）。
const CLINE_FREE_LIMIT =
  "Daily free limit reached on model deepseek/deepseek-v4-flash. Try again in 23h 59m";
// magpie zcode_blocked_test.go：阿里云 ESA 防火墙挡在 zcode.z.ai 前面的 405 页面。
const BLOCK_PAGE =
  '<html><body><h1>Sorry, your request has been blocked due to unusual activity.</h1><a href="https://errors.aliyun.com/">details</a></body></html>';

// Gemini 的 key 无效：400 INVALID_ARGUMENT，不是 401（任务 10-16-gemini-upstream G4）。
const GEMINI_KEY_INVALID = JSON.stringify({
  error: {
    code: 400,
    message: "API key not valid. Please pass a valid API key.",
    status: "INVALID_ARGUMENT",
    details: [
      {
        "@type": "type.googleapis.com/google.rpc.ErrorInfo",
        reason: "API_KEY_INVALID",
        domain: "googleapis.com",
        metadata: { service: "generativelanguage.googleapis.com" },
      },
    ],
  },
});

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
      // magpie overflow_cap_test.go：中转服务自己的单次输入上限（#2445，B.ai）。
      "Input token exceed the limit (request id: 2026…)",
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
  wrongFormat: {
    hits: [
      "no model endpoints available given user constraints",
      "Model does not support this protocol.",
    ],
    misses: ["The requested model is not supported."],
  },
  retired: {
    hits: ['{"type":"ModelDeprecated"}', "The model gpt-4-0314 has been deprecated"],
    misses: ["deprecated header"],
  },
  zenModelGone: {
    hits: ['{"message":"Model glm-5-free is not supported"}'],
    misses: ["The model is not supported"],
  },
  keyInvalid: {
    hits: [GEMINI_KEY_INVALID, "API key not valid. Please pass a valid API key."],
    misses: ["invalid api key"],
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
  blocked: {
    hits: [
      "Sorry, your request has been blocked due to unusual activity",
      '<a href="https://errors.aliyun.com/">',
    ],
    misses: ["the tool call was blocked by policy"],
  },
  unsaid: {
    hits: [
      COMMAND_CODE_BARE_400,
      `Command Code: ${COMMAND_CODE_BARE_400}`,
      "invalid request error trace_id: 251c3c29761c17fdc459480ed9c68932",
    ],
    misses: [
      '{"message":"invalid request error trace_id: 251c3c29761c17fdc459480ed9c68932: messages.3.content too long"}',
      "invalid request error trace_id: abc",
    ],
  },
  zhipuResets: {
    hits: [
      "Usage limit reached for 5 hour. Your limit will reset at 2026-10-15 20:12",
      "已达到 5 小时的使用上限。您的限额将在 2026-10-15 20:12:13 重置",
    ],
    misses: ["this model is retired at 2026-10-15 20:12:13"],
  },
  resetsSpan: {
    hits: ["weekly standard usage limit (resets in 0h 19min)", "resets in 3d 4h"],
    misses: ["resets at 20:00"],
  },
  clineFreeLimit: {
    hits: [CLINE_FREE_LIMIT],
    misses: ["Daily limit reached"],
  },
  tryAgainIn: {
    hits: ["Try again in 23h 59m"],
    misses: ["try again later"],
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
    // 402 只说用量上限、没提钱：额度用完，不是欠费。
    { status: 402, body: FACTORY_STANDARD_OUT, expected: "quota" },
    {
      status: 402,
      body: '{"error":{"message":"Payment required: your subscription payment failed"}}',
      expected: "credit",
    },
    { status: 402, body: "usage limit reached, add credit to continue", expected: "credit" },
    { status: 402, body: '{"error":{"code":"insufficient_quota"}}', expected: "credit" },
    { status: 429, body: CLINE_FREE_LIMIT, expected: "quota" },
    { status: 405, body: BLOCK_PAGE, expected: "other" },
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
    // 防火墙挡的是这台机器的地址，不是 key。
    expect(endpointFailure(403, BLOCK_PAGE)).toBe("other");
  });

  test("Gemini's 400 saying the key is not valid needs checking too (G4)", () => {
    expect(endpointFailure(400, GEMINI_KEY_INVALID)).toBe("auth");
    expect(endpointFailure(400, '{"error":{"details":[{"reason":"API_KEY_INVALID"}]}}')).toBe(
      "auth",
    );
    expect(endpointFailure(400, "Invalid JSON payload received.")).toBe("other");
    expect(endpointFailure(422, "API key not valid")).toBe("other");
  });
});

describe("whether another endpoint is worth asking", () => {
  test.each([401, 402, 403, 404, 408, 429, 500, 502, 503, 529])("%i is", (status) => {
    expect(retryable(status, "x")).toBe(true);
  });

  test("Gemini's 400 saying the key is not valid is, and rests the endpoint (G4)", () => {
    expect(retryable(400, GEMINI_KEY_INVALID)).toBe(true);
    expect(requestRefused(400, GEMINI_KEY_INVALID)).toBe(false);
  });

  test("a conversation too long for the model is not: every endpoint would refuse it", () => {
    expect(retryable(400, "prompt is too long: 210000 tokens")).toBe(false);
    expect(retryable(413, "context_length_exceeded")).toBe(false);
  });

  test("a relay's own cap on one request's input reads as too long; rate limits worded with input tokens do not (magpie #2445)", () => {
    const capped = "Input token exceed the limit (request id: 2026…)";
    expect(
      saysTooLong(400, `{"error":{"message":"${capped}","type":"invalid_request_error"}}`),
    ).toBe(true);
    expect(retryable(400, `{"error":{"message":"${capped}"}}`)).toBe(false);
    const rates = [
      "Input token exceed the limit per minute",
      "Input tokens exceeded the limit, please wait",
      "input tokens exceed the TPM limit",
    ];
    expect(rates.map((message) => saysTooLong(400, message))).toEqual([false, false, false]);
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

  test("a vendor's firewall blocking this address is, at any error status", () => {
    expect(retryable(405, BLOCK_PAGE)).toBe(true);
    expect(retryable(400, BLOCK_PAGE)).toBe(true);
    expect(retryable(405, "method not allowed")).toBe(false);
  });

  test("a 400 that says nothing but its trace id is, and rests nobody (Command Code)", () => {
    const cases = [
      { status: 400, body: COMMAND_CODE_BARE_400, expected: true },
      { status: 400, body: `Command Code: ${COMMAND_CODE_BARE_400}`, expected: true },
      {
        status: 400,
        body: '{"message":"{\\"message\\":\\"invalid request error trace_id: a050673b3298a747a15895803095bcf0\\",\\"type\\":\\"invalid_request_error\\"}\\n","type":"invalid_request_error"}',
        expected: true,
      },
      {
        status: 422,
        body: '{"message":"{\\"message\\":\\"invalid request error trace_id: f9965636e3da815215348ef4ddf2ae63\\",\\"type\\":\\"invalid_request_error\\"}\\n","type":"server_error"}',
        expected: true,
      },
      {
        status: 400,
        body: '{"message":"The input is longer than the model\'s context length trace_id: e811a6f10da868000cc12a043c07a73b","type":"invalid_request_error"}',
        expected: false,
      },
      {
        status: 400,
        body: '{"error":{"message":"Invalid option: expected one of \\"low\\"|\\"medium\\"|\\"high\\"","type":"invalid_request_error","param":"reasoning_effort"}}',
        expected: false,
      },
      {
        status: 400,
        body: '{"message":"invalid request error trace_id: 251c3c29761c17fdc459480ed9c68932: messages.3.content too long","type":"invalid_request_error"}',
        expected: false,
      },
      { status: 200, body: COMMAND_CODE_BARE_400, expected: false },
    ];
    expect(
      cases.map(({ status, body }) => ({
        status,
        body,
        expected: retryable(status, body) && requestRefused(status, body),
      })),
    ).toEqual(cases);
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
    // 这个地址不提供、别的格式的地址也许提供：所有格式都这样说时也只冷却这个模型。
    expect(modelRefused(400, "no model endpoints available given user constraints")).toBe(true);
    expect(retryable(400, "no model endpoints available given user constraints")).toBe(true);
  });

  test("a reply that ended empty after it began rests nobody (magpie #1221)", () => {
    expect(lateRests(EMPTY_REPLY)).toBe(false);
  });

  test("a reply that broke off rests its endpoint unless the conversation or a filter was the cause", () => {
    expect(lateRests("socket hang up")).toBe(true);
    expect(lateRests("prompt is too long")).toBe(false);
    expect(lateRests("Illegal API invocation from an unapproved channel")).toBe(false);
    expect(lateRests("response protection is unavailable")).toBe(false);
  });
});

describe("the status an error inside a stream stands for", () => {
  test.each([
    {
      said: '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
      status: 529,
    },
    { said: '{"error":{"code":"context_length_exceeded","message":"input exceeds"}}', status: 400 },
    { said: '{"error":{"message":"Insufficient balance"}}', status: 402 },
    { said: '{"error":{"type":"rate_limit_error","message":"slow down"}}', status: 429 },
    { said: '{"error":{"message":"You exceeded your current quota"}}', status: 429 },
    { said: '{"error":{"message":"model gpt-9 does not exist"}}', status: 400 },
    { said: '{"error":{"type":"invalid_request_error","message":"bad"}}', status: 400 },
    { said: '{"error":{"code":"server_error","message":"Something went wrong"}}', status: 502 },
  ])("$said is $status", ({ said, status }) => {
    expect(streamStatus(said)).toBe(status);
  });
});
