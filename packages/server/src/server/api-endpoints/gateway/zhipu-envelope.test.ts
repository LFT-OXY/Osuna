// 用例照 magpie（https://github.com/yetone/magpie，internal/gateway/zhipu_envelope_test.go 的 zhipuResponses 与 TestZhipuResponsesRefusalIsRefusal）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { describe, expect, test } from "vitest";
import { endpointFailure, retryable } from "./failure.js";
import { zhipuRefusal } from "./zhipu-envelope.js";

const JSON_HEADERS = { "content-type": "application/json" };
const KEY_REFUSED = '{"code":1000,"msg":"身份验证失败。","success":false}';
const RATE_LIMITED =
  '{"code":"1302","msg":"您的账户已达到速率限制，请您控制请求频率","success":false}';

describe("Zhipu's refusal wrapped in a 200", () => {
  test.each(["open.bigmodel.cn", "api.z.ai"])(
    "%s: a refused key is a 401 that needs a check, in OpenAI's words",
    (host) => {
      const refusal = zhipuRefusal({ host, headers: JSON_HEADERS, body: Buffer.from(KEY_REFUSED) });

      expect(refusal).toEqual({
        status: 401,
        text: '{"error":{"message":"身份验证失败。","code":"1000"}}',
      });
      expect(endpointFailure(401, refusal?.text ?? "")).toBe("auth");
    },
  );

  test("a rate limit is a 429 that switches and cools as one", () => {
    const refusal = zhipuRefusal({
      host: "open.bigmodel.cn",
      headers: JSON_HEADERS,
      body: Buffer.from(RATE_LIMITED),
    });

    expect(refusal).toEqual({
      status: 429,
      text: '{"error":{"message":"您的账户已达到速率限制，请您控制请求频率","code":"1302"}}',
    });
    expect(retryable(429, refusal?.text ?? "")).toBe(true);
    expect(endpointFailure(429, refusal?.text ?? "")).toBe("rate");
  });

  test("a reply, a stream, another host and a compressed body are left alone", () => {
    const reply =
      '{"id":"resp_1","object":"response","status":"completed","model":"glm-5.1","output":[]}';
    const cases = [
      { host: "open.bigmodel.cn", headers: JSON_HEADERS, body: reply },
      {
        host: "open.bigmodel.cn",
        headers: { "content-type": "text/event-stream" },
        body: KEY_REFUSED,
      },
      { host: "relay.example.com", headers: JSON_HEADERS, body: KEY_REFUSED },
      {
        host: "api.z.ai",
        headers: { ...JSON_HEADERS, "content-encoding": "gzip" },
        body: KEY_REFUSED,
      },
      { host: "api.z.ai", headers: JSON_HEADERS, body: '{"success":false}' },
    ];

    for (const { host, headers, body } of cases) {
      expect(zhipuRefusal({ host, headers, body: Buffer.from(body) })).toBeNull();
    }
  });
});
