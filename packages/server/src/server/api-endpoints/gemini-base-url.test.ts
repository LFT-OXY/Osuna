// 用例取自 magpie（MIT，THIRD_PARTY_NOTICES）：https://github.com/yetone/magpie 的 internal/provider/gemini_api_test.go。
import { describe, expect, test } from "vitest";
import { geminiBaseUrl, geminiPath } from "./gemini-base-url.js";
import { templateBaseUrl } from "./templates.js";

describe("the base a Gemini base URL is kept as (magpie GeminiBase)", () => {
  test.each([
    ["", ""],
    ["generativelanguage.googleapis.com", "https://generativelanguage.googleapis.com/v1beta"],
    [
      "https://generativelanguage.googleapis.com/",
      "https://generativelanguage.googleapis.com/v1beta",
    ],
    [
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:streamGenerateContent?alt=sse",
      "https://generativelanguage.googleapis.com/v1beta",
    ],
    ["https://relay.example/proxy/v1beta/models", "https://relay.example/proxy/v1beta"],
    ["https://relay.example/proxy/v1", "https://relay.example/proxy/v1"],
    ["  https://relay.example/v1beta/  ", "https://relay.example/v1beta"],
  ])("%j is kept as %j", (raw, want) => {
    expect(geminiBaseUrl(raw)).toBe(want);
  });

  test("is how a Gemini base URL is saved, from any template", () => {
    const url = "https://relay.example";
    expect(templateBaseUrl({ templateId: undefined, format: "gemini", url })).toBe(
      "https://relay.example/v1beta",
    );
    expect(templateBaseUrl({ templateId: "azure", format: "gemini", url })).toBe(
      "https://relay.example/v1beta",
    );
    expect(templateBaseUrl({ templateId: undefined, format: "openai_chat", url })).toBe(url);
  });
});

describe("the path a Gemini model is asked at (magpie GeminiPath)", () => {
  test("models/ comes off and the name is escaped as Go's url.PathEscape does", () => {
    expect(geminiPath({ model: "models/gemini-2.5-pro", stream: true })).toBe(
      "/models/gemini-2.5-pro:streamGenerateContent?alt=sse",
    );
    expect(geminiPath({ model: "a b/c,d;e:f@g$h&i+j=k!l", stream: false })).toBe(
      "/models/a%20b%2Fc%2Cd%3Be:f@g$h&i+j=k%21l:generateContent",
    );
  });
});
