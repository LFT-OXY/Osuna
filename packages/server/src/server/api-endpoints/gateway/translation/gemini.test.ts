// 用例取自 magpie（MIT，THIRD_PARTY_NOTICES）：https://github.com/yetone/magpie 的 internal/gateway/codeassist.go 的 buildCodeAssistSent、codeAssistDecoder 与 stopFromGemini，gemini.go 的 geminiRequest，upstream.go 的 streamErrorText。

import { describe, expect, test } from "vitest";
import { parseAnthropicRequest } from "./anthropic.js";
import { parseChatRequest } from "./chat.js";
import { GeminiDecoder, buildGeminiRequest } from "./gemini.js";
import type { StreamEvent } from "./ir.js";

/*
 * Gemini 这一侧的翻译（只做上游）：各 Agent 的请求翻成 generateContent 请求、Gemini 的流解码。
 */

function decoded(chunks: unknown[]): StreamEvent[] {
  const events: StreamEvent[] = [];
  const decoder = new GeminiDecoder();
  for (const chunk of chunks) decoder.decode(JSON.stringify(chunk), (event) => events.push(event));
  decoder.end?.((event) => events.push(event));
  return events;
}

describe("a request asked of a Gemini endpoint", () => {
  test("turns become user and model contents, the system prompt a systemInstruction with no role", () => {
    const request = parseAnthropicRequest({
      model: "gemini-2.5-pro",
      max_tokens: 1024,
      stream: true,
      temperature: 0.5,
      top_p: 0.9,
      stop_sequences: ["END"],
      system: [{ type: "text", text: "You are Claude Code." }],
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
        { role: "user", content: "list files" },
      ],
    });

    const built = buildGeminiRequest(request, "gemini-2.5-pro");

    expect(built).toEqual({
      contents: [
        { role: "user", parts: [{ text: "hi" }] },
        { role: "model", parts: [{ text: "hello" }] },
        { role: "user", parts: [{ text: "list files" }] },
      ],
      systemInstruction: { parts: [{ text: "You are Claude Code." }] },
      generationConfig: {
        maxOutputTokens: 1024,
        temperature: 0.5,
        topP: 0.9,
        stopSequences: ["END"],
      },
    });
  });

  test("neighbouring turns of the same role are joined into one", () => {
    const request = parseChatRequest({
      model: "gemini-2.5-flash",
      messages: [
        { role: "user", content: "one" },
        { role: "user", content: "two" },
        { role: "assistant", content: "a" },
        { role: "assistant", content: "b" },
        { role: "user", content: "three" },
      ],
    });

    const built = buildGeminiRequest(request, "gemini-2.5-flash");

    expect(built.contents).toEqual([
      { role: "user", parts: [{ text: "one" }, { text: "two" }] },
      { role: "model", parts: [{ text: "a" }, { text: "b" }] },
      { role: "user", parts: [{ text: "three" }] },
    ]);
    expect(built).not.toHaveProperty("systemInstruction");
    expect(built).not.toHaveProperty("generationConfig");
    expect(built).not.toHaveProperty("model");
    expect(built).not.toHaveProperty("stream");
    expect(built).not.toHaveProperty("safetySettings");
  });

  test("a JSON answer is asked with responseMimeType, and the client's schema when it gave one", () => {
    const schema = { type: "object", properties: { n: { type: "number" } } };
    const withSchema = parseChatRequest({
      model: "gemini-2.5-flash",
      messages: [{ role: "user", content: "count" }],
      response_format: { type: "json_schema", json_schema: { name: "n", schema } },
    });
    const anyObject = parseChatRequest({
      model: "gemini-2.5-flash",
      messages: [{ role: "user", content: "count" }],
      response_format: { type: "json_object" },
    });

    expect(buildGeminiRequest(withSchema, "gemini-2.5-flash").generationConfig).toEqual({
      responseMimeType: "application/json",
      responseJsonSchema: schema,
    });
    expect(buildGeminiRequest(anyObject, "gemini-2.5-flash").generationConfig).toEqual({
      responseMimeType: "application/json",
    });
  });
});

describe("decoding a Gemini stream", () => {
  test("text streams as it comes; the prompt count rides on the start, the whole count on the end", () => {
    const events = decoded([
      {
        responseId: "resp-1",
        candidates: [{ content: { role: "model", parts: [{ text: "hel" }] } }],
        usageMetadata: { promptTokenCount: 120, cachedContentTokenCount: 100 },
      },
      { candidates: [{ content: { role: "model", parts: [{ text: "lo" }] } }] },
      {
        candidates: [{ content: { role: "model", parts: [] }, finishReason: "STOP" }],
        usageMetadata: {
          promptTokenCount: 120,
          cachedContentTokenCount: 100,
          candidatesTokenCount: 30,
          thoughtsTokenCount: 5,
        },
      },
    ]);

    expect(events).toEqual([
      {
        kind: "start",
        id: "resp-1",
        usage: {
          input: 20,
          output: 0,
          cacheRead: 100,
          cacheWrite: 0,
          cacheWrite1h: 0,
          reasoning: 0,
        },
      },
      { kind: "text", text: "hel" },
      { kind: "text", text: "lo" },
      { kind: "stop", stop: "stop" },
      {
        kind: "usage",
        usage: {
          input: 20,
          output: 35,
          cacheRead: 100,
          cacheWrite: 0,
          cacheWrite1h: 0,
          reasoning: 5,
        },
      },
    ]);
  });

  test("finish reasons map as magpie's stopFromGemini", () => {
    const stopOf = (finishReason: string) =>
      decoded([{ candidates: [{ content: { parts: [{ text: "x" }] }, finishReason }] }]).find(
        (event) => event.kind === "stop",
      );
    expect(stopOf("MAX_TOKENS")).toEqual({ kind: "stop", stop: "length" });
    for (const reason of [
      "STOP",
      "FINISH_REASON_UNSPECIFIED",
      "OTHER",
      "MALFORMED_FUNCTION_CALL",
      "UNEXPECTED_TOOL_CALL",
    ]) {
      expect(stopOf(reason), reason).toEqual({ kind: "stop", stop: "stop" });
    }
    for (const reason of ["SAFETY", "RECITATION", "PROHIBITED_CONTENT", "SPII"]) {
      expect(stopOf(reason), reason).toEqual({ kind: "stop", stop: "filter" });
    }
  });

  test("a chunk with only usage does not end the reply", () => {
    const events = decoded([
      { candidates: [{ content: { parts: [{ text: "x" }] } }] },
      { usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 1 } },
    ]);

    expect(events.map((event) => event.kind)).toEqual(["start", "text"]);
  });

  test("an error in the stream ends the reply as an error", () => {
    const events = decoded([{ error: { code: 500, message: "internal", status: "INTERNAL" } }]);

    expect(events).toEqual([{ kind: "error", message: "internal", code: null, vendorError: null }]);
  });

  test("an error said as a string, or as an object with only a type, is told in its words", () => {
    expect(decoded([{ error: "quota gone" }])).toEqual([
      { kind: "error", message: "quota gone", code: null, vendorError: null },
    ]);
    expect(decoded([{ error: { type: "overloaded" } }])).toEqual([
      { kind: "error", message: "overloaded", code: null, vendorError: null },
    ]);
  });

  test("a whole reply reads as its one-chunk stream", () => {
    const events: StreamEvent[] = [];
    new GeminiDecoder().whole(
      {
        candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 1 },
      },
      (event) => events.push(event),
    );

    expect(events.map((event) => event.kind)).toEqual(["start", "text", "stop", "usage"]);
  });
});
