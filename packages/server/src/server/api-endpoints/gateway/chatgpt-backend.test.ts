// 用例取自 magpie（https://github.com/yetone/magpie，internal/gateway/codex_backend_test.go 的
// TestCodexNativeModelStaysNative 与 TestCodexWebSocketUpgradeRequired）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { describe, expect, test } from "vitest";
import {
  apiKeyRefusedMessage,
  chatgptBackendRest,
  chatgptTarget,
  isWebSocketHandshake,
  relayedHeaders,
} from "./chatgpt-backend.js";

const bases = {
  chatgpt: "https://chatgpt.com/backend-api/codex",
  openAiApi: "https://api.openai.com/v1",
};

describe("the ChatGPT backend paths", () => {
  test("are /backend-api/codex and what is under it", () => {
    expect(chatgptBackendRest("/backend-api/codex/responses")).toBe("/responses");
    expect(chatgptBackendRest("/backend-api/codex/responses/compact")).toBe("/responses/compact");
    expect(chatgptBackendRest("/backend-api/codex")).toBe("");
    expect(chatgptBackendRest("/backend-api/codexx/responses")).toBeNull();
    expect(chatgptBackendRest("/v1/responses")).toBeNull();
  });
});

describe("where a ChatGPT backend request goes", () => {
  test("a ChatGPT sign-in goes to ChatGPT with the path and query as they came", () => {
    expect(
      chatgptTarget({
        url: "/backend-api/codex/models?client_version=0.130.0",
        authorization: "Bearer eyJhbGciOiJSUzI1NiJ9.e30.c2ln",
        bases,
      }),
    ).toBe("https://chatgpt.com/backend-api/codex/models?client_version=0.130.0");
    expect(
      chatgptTarget({ url: "/backend-api/codex/alpha/search", authorization: undefined, bases }),
    ).toBe("https://chatgpt.com/backend-api/codex/alpha/search");
  });

  test("an API key goes to the OpenAI API, its model list still to ChatGPT", () => {
    const apiKey = "Bearer sk-test";
    expect(
      chatgptTarget({ url: "/backend-api/codex/responses", authorization: apiKey, bases }),
    ).toBe("https://api.openai.com/v1/responses");
    expect(
      chatgptTarget({ url: "/backend-api/codex/responses/compact", authorization: apiKey, bases }),
    ).toBe("https://api.openai.com/v1/responses/compact");
    expect(
      chatgptTarget({
        url: "/backend-api/codex/models?client_version=1",
        authorization: apiKey,
        bases,
      }),
    ).toBe("https://chatgpt.com/backend-api/codex/models?client_version=1");
  });
});

describe("the OpenAI API refusing Codex's API key", () => {
  test("is told with OpenAI's own words, or its whole answer when it gives none", () => {
    const advice =
      "This is one of Codex's own models, which goes to OpenAI with Codex's own sign-in: " +
      "pick an endpoint model (<endpoint>/<model>) in Codex, or sign Codex in with ChatGPT, or with an OpenAI API key";
    expect(apiKeyRefusedMessage('{"error":{"message":"Incorrect API key provided"}}')).toBe(
      `OpenAI refused the API key Codex is signed in with (Incorrect API key provided). ${advice}`,
    );
    expect(apiKeyRefusedMessage("  Unauthorized\n")).toBe(
      `OpenAI refused the API key Codex is signed in with (Unauthorized). ${advice}`,
    );
  });
});

describe("headers relayed to and from ChatGPT", () => {
  test("everything but hop-by-hop headers and Host, the sign-in included", () => {
    expect(
      relayedHeaders({
        host: "127.0.0.1:6767",
        connection: "keep-alive",
        "keep-alive": "timeout=5",
        "proxy-connection": "keep-alive",
        "transfer-encoding": "chunked",
        upgrade: "h2c",
        te: "trailers",
        trailer: "x-checksum",
        authorization: "Bearer chatgpt-token",
        "chatgpt-account-id": "acct-1",
        "content-encoding": "zstd",
        "content-length": "42",
        "x-codex-turn-state": "ts-1",
        "set-cookie": ["a=1", "b=2"],
      }),
    ).toEqual({
      authorization: "Bearer chatgpt-token",
      "chatgpt-account-id": "acct-1",
      "content-encoding": "zstd",
      "content-length": "42",
      "x-codex-turn-state": "ts-1",
      "set-cookie": ["a=1", "b=2"],
    });
  });
});

describe("a WebSocket handshake", () => {
  test("is told by Upgrade: websocket in any case", () => {
    expect(isWebSocketHandshake({ upgrade: "websocket" })).toBe(true);
    expect(isWebSocketHandshake({ upgrade: "WebSocket" })).toBe(true);
    expect(isWebSocketHandshake({ upgrade: "h2c" })).toBe(false);
    expect(isWebSocketHandshake({})).toBe(false);
  });
});
