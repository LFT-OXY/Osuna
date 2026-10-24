// 用例取自 magpie（MIT，THIRD_PARTY_NOTICES）：https://github.com/yetone/magpie 的 internal/gateway/codeassist.go 的 buildCodeAssistSent、dropSecondAnswers、pairFunctionTurns、thinkingConfig、codeAssistDecoder 与 stopFromGemini，
// gemini.go 的 geminiRequest，upstream.go 的 streamErrorText，compacting.go 的 compacting 与 prefill.go 的 modelLastAsk。

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { GeminiSignatureStore, unsignedId } from "../gemini-signatures.js";
import { parseAnthropicRequest } from "./anthropic.js";
import { parseChatRequest } from "./chat.js";
import { GeminiDecoder, buildGeminiRequest } from "./gemini.js";
import { INTERRUPTED_TOOL, type GatewayRequest, type Message, type StreamEvent } from "./ir.js";

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

describe("how hard a Gemini model is asked to think", () => {
  const asked = (model: string, effort: string) =>
    parseChatRequest({
      model,
      messages: [{ role: "user", content: "think" }],
      ...(effort === "" ? {} : { reasoning_effort: effort }),
    });
  const thinkingOf = (model: string, request: GatewayRequest) =>
    (buildGeminiRequest(request, model).generationConfig as Record<string, unknown> | undefined)
      ?.thinkingConfig;

  test("a model before Gemini 3 is given a budget by the effort", () => {
    expect(thinkingOf("gemini-2.5-pro", asked("gemini-2.5-pro", "low"))).toEqual({
      includeThoughts: true,
      thinkingBudget: 4096,
    });
    expect(thinkingOf("gemini-2.5-pro", asked("gemini-2.5-pro", "medium"))).toEqual({
      includeThoughts: true,
      thinkingBudget: 10_000,
    });
    expect(thinkingOf("gemini-2.5-flash", asked("gemini-2.5-flash", "high"))).toEqual({
      includeThoughts: true,
      thinkingBudget: 24_000,
    });
    expect(thinkingOf("models/gemini-2.5-pro", asked("gemini-2.5-pro", "xhigh"))).toEqual({
      includeThoughts: true,
      thinkingBudget: 32_000,
    });
  });

  test("a name that says no generation is given a budget too", () => {
    expect(thinkingOf("gemini-flash-latest", asked("gemini-flash-latest", "high"))).toEqual({
      includeThoughts: true,
      thinkingBudget: 24_000,
    });
  });

  test("Gemini 3 and later are given a level: medium is medium for Flash and later generations, high for 3 Pro", () => {
    expect(thinkingOf("gemini-3-pro-preview", asked("gemini-3-pro-preview", "low"))).toEqual({
      includeThoughts: true,
      thinkingLevel: "low",
    });
    expect(thinkingOf("gemini-3-pro-preview", asked("gemini-3-pro-preview", "medium"))).toEqual({
      includeThoughts: true,
      thinkingLevel: "high",
    });
    expect(thinkingOf("gemini-3-flash", asked("gemini-3-flash", "medium"))).toEqual({
      includeThoughts: true,
      thinkingLevel: "medium",
    });
    expect(thinkingOf("gemini-4-argon", asked("gemini-4-argon", "medium"))).toEqual({
      includeThoughts: true,
      thinkingLevel: "medium",
    });
    expect(thinkingOf("gemini-3-pro-preview", asked("gemini-3-pro-preview", "xhigh"))).toEqual({
      includeThoughts: true,
      thinkingLevel: "high",
    });
    expect(thinkingOf("gemini-pro-agent", asked("gemini-pro-agent", "low"))).toEqual({
      includeThoughts: true,
      thinkingLevel: "low",
    });
  });

  test("reasoning turned off goes at low, or 4096, not as nothing", () => {
    expect(thinkingOf("gemini-3-pro-preview", asked("gemini-3-pro-preview", "none"))).toEqual({
      includeThoughts: true,
      thinkingLevel: "low",
    });
    expect(thinkingOf("gemini-2.5-pro", asked("gemini-2.5-pro", "none"))).toEqual({
      includeThoughts: true,
      thinkingBudget: 4096,
    });
  });

  test("minimal fitted from the model's levels goes at low, and at high to an image model", () => {
    const minimal = (model: string) => ({ ...asked(model, "low"), effort: "minimal" as const });
    expect(thinkingOf("gemini-3-flash", minimal("gemini-3-flash"))).toEqual({
      includeThoughts: true,
      thinkingLevel: "low",
    });
    expect(thinkingOf("gemini-3-pro-image", minimal("gemini-3-pro-image"))).toEqual({
      includeThoughts: true,
      thinkingLevel: "high",
    });
  });

  test("minimal fitted from the model's levels is a low budget before Gemini 3", () => {
    const request = { ...asked("gemini-2.5-flash", "low"), effort: "minimal" as const };
    expect(thinkingOf("gemini-2.5-flash", request)).toEqual({
      includeThoughts: true,
      thinkingBudget: 4096,
    });
  });

  test("asked to think with no effort, a model is told to include its thoughts and nothing more", () => {
    const request = { ...asked("gemini-3-pro-preview", ""), thinking: true };
    expect(thinkingOf("gemini-3-pro-preview", request)).toEqual({ includeThoughts: true });
  });

  test("not asked to think, no thinking config is sent", () => {
    expect(thinkingOf("gemini-2.5-pro", asked("gemini-2.5-pro", ""))).toBeUndefined();
  });

  test("an image model is asked for images too", () => {
    const built = buildGeminiRequest(asked("gemini-3-pro-image", ""), "gemini-3-pro-image");
    expect(built.generationConfig).toEqual({ responseModalities: ["TEXT", "IMAGE"] });
  });
});

/** 中间格式写成的对话（不经各家解析时的修补）。 */
function conversation(messages: Message[], model = "gemini-2.5-pro"): GatewayRequest {
  return { ...parseChatRequest({ model, messages: [{ role: "user", content: "x" }] }), messages };
}

const SKIP = "skip_thought_signature_validator";

describe("tools in a request asked of a Gemini endpoint", () => {
  test("Claude Code's tools go as function declarations with their schema as it is", () => {
    const schema = {
      type: "object",
      properties: { cmd: { type: "string", $schema: "x" } },
      additionalProperties: false,
    };
    const request = parseAnthropicRequest({
      model: "gemini-2.5-pro",
      max_tokens: 100,
      messages: [{ role: "user", content: "list" }],
      tools: [{ name: "bash", description: "run a command", input_schema: schema }],
    });

    const built = buildGeminiRequest(request, "gemini-2.5-pro");

    expect(built.tools).toEqual([
      {
        functionDeclarations: [
          { name: "bash", description: "run a command", parametersJsonSchema: schema },
        ],
      },
    ]);
    expect(built.toolConfig).toEqual({ functionCallingConfig: { mode: "AUTO" } });
  });

  test("a tool with no schema is given an empty object's; tool_choice picks the calling mode", () => {
    const tools = [{ type: "function", function: { name: "now" } }];
    const askedWith = (toolChoice: unknown) =>
      buildGeminiRequest(
        parseChatRequest({
          model: "gemini-2.5-pro",
          messages: [{ role: "user", content: "time?" }],
          tools,
          tool_choice: toolChoice,
        }),
        "gemini-2.5-pro",
      );

    expect(askedWith("auto").tools).toEqual([
      {
        functionDeclarations: [
          { name: "now", parametersJsonSchema: { type: "object", properties: {} } },
        ],
      },
    ]);
    expect(askedWith("required").toolConfig).toEqual({ functionCallingConfig: { mode: "ANY" } });
    expect(askedWith({ type: "function", function: { name: "now" } }).toolConfig).toEqual({
      functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["now"] },
    });
    const none = askedWith("none");
    expect(none).not.toHaveProperty("tools");
    expect(none).not.toHaveProperty("toolConfig");
  });

  test("a call goes back with its id and the skip signature, its result as a functionResponse under the same id", () => {
    const request = parseAnthropicRequest({
      model: "gemini-2.5-pro",
      max_tokens: 100,
      messages: [
        { role: "user", content: "list" },
        {
          role: "assistant",
          content: [
            { type: "text", text: "Looking." },
            { type: "tool_use", id: "toolu_1", name: "bash", input: { cmd: "ls" } },
          ],
        },
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "a.txt" }],
        },
      ],
    });

    expect(buildGeminiRequest(request, "gemini-2.5-pro").contents).toEqual([
      { role: "user", parts: [{ text: "list" }] },
      {
        role: "model",
        parts: [
          { text: "Looking." },
          {
            functionCall: { name: "bash", args: { cmd: "ls" }, id: "toolu_1" },
            thoughtSignature: SKIP,
          },
        ],
      },
      {
        role: "user",
        parts: [
          { functionResponse: { name: "bash", response: { output: "a.txt" }, id: "toolu_1" } },
        ],
      },
    ]);
  });

  test("a call's own signature goes back; in a signed step the calls Gemini didn't sign go with none", () => {
    const request = conversation([
      { role: "user", parts: [{ kind: "text", text: "both" }] },
      {
        role: "assistant",
        parts: [
          { kind: "thinking", text: "I should look", signature: "" },
          { kind: "tool_call", id: "a", name: "ls", args: "{}", signature: "c2ln" },
          { kind: "tool_call", id: "b", name: "pwd", args: "{}" },
        ],
      },
      {
        role: "user",
        parts: [
          { kind: "tool_result", callId: "a", text: "x", isError: false, images: [] },
          { kind: "tool_result", callId: "b", text: "/", isError: true, images: [] },
        ],
      },
    ]);

    const contents = buildGeminiRequest(request, "gemini-3-pro-preview").contents;

    expect(contents).toEqual([
      { role: "user", parts: [{ text: "both" }] },
      {
        role: "model",
        parts: [
          { functionCall: { name: "ls", args: {}, id: "a" }, thoughtSignature: "c2ln" },
          { functionCall: { name: "pwd", args: {}, id: "b" } },
        ],
      },
      {
        role: "user",
        parts: [
          { functionResponse: { name: "ls", response: { output: "x" }, id: "a" } },
          { functionResponse: { name: "pwd", response: { error: "/" }, id: "b" } },
        ],
      },
    ]);
  });

  test("a tool's images follow its response; what the user said goes in a turn of its own after", () => {
    const request = parseAnthropicRequest({
      model: "gemini-2.5-pro",
      max_tokens: 100,
      messages: [
        { role: "user", content: "shoot" },
        {
          role: "assistant",
          content: [{ type: "tool_use", id: "t1", name: "screenshot", input: {} }],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "t1",
              content: [
                { type: "text", text: "done" },
                {
                  type: "image",
                  source: { type: "base64", media_type: "image/png", data: "QUFB" },
                },
              ],
            },
            { type: "text", text: "now fix it" },
          ],
        },
      ],
    });

    const contents = buildGeminiRequest(request, "gemini-2.5-pro").contents as unknown[];

    expect(contents.slice(2)).toEqual([
      {
        role: "user",
        parts: [
          { functionResponse: { name: "screenshot", response: { output: "done" }, id: "t1" } },
          { inlineData: { mimeType: "image/png", data: "QUFB" } },
        ],
      },
      { role: "user", parts: [{ text: "now fix it" }] },
    ]);
  });

  test("an image with its bytes goes inline, one given only by address as fileData", () => {
    const request = conversation([
      {
        role: "user",
        parts: [
          { kind: "text", text: "what are these?" },
          { kind: "image", mediaType: "image/jpeg", data: "/9j/", url: "" },
          { kind: "image", mediaType: "", data: "", url: "https://example.com/cat.png" },
        ],
      },
    ]);

    expect(buildGeminiRequest(request, "gemini-2.5-pro").contents).toEqual([
      {
        role: "user",
        parts: [
          { text: "what are these?" },
          { inlineData: { mimeType: "image/jpeg", data: "/9j/" } },
          { fileData: { mimeType: "", fileUri: "https://example.com/cat.png" } },
        ],
      },
    ]);
  });

  test("a call answered nowhere is answered with the interrupted note; a second answer to one call is left out", () => {
    const request = conversation([
      { role: "user", parts: [{ kind: "text", text: "go" }] },
      {
        role: "assistant",
        parts: [
          { kind: "tool_call", id: "a", name: "ls", args: "{}" },
          { kind: "tool_call", id: "b", name: "cat", args: "{}" },
        ],
      },
      {
        role: "user",
        parts: [
          { kind: "tool_result", callId: "a", text: "first", isError: false, images: [] },
          { kind: "tool_result", callId: "a", text: "again", isError: false, images: [] },
        ],
      },
      { role: "user", parts: [{ kind: "text", text: "stop" }] },
    ]);

    const contents = buildGeminiRequest(request, "gemini-2.5-pro").contents as unknown[];

    expect(contents.slice(2)).toEqual([
      {
        role: "user",
        parts: [
          {
            functionResponse: {
              name: "cat",
              response: { output: INTERRUPTED_TOOL },
              id: "b",
            },
          },
          { functionResponse: { name: "ls", response: { output: "first" }, id: "a" } },
        ],
      },
      { role: "user", parts: [{ text: "stop" }] },
    ]);
  });

  test("a call left unanswered before the user speaks gets a turn of answers of its own", () => {
    const request = conversation([
      { role: "user", parts: [{ kind: "text", text: "go" }] },
      { role: "assistant", parts: [{ kind: "tool_call", id: "a", name: "ls", args: "{}" }] },
      { role: "user", parts: [{ kind: "text", text: "never mind" }] },
    ]);

    const contents = buildGeminiRequest(request, "gemini-2.5-pro").contents as unknown[];

    expect(contents.slice(2)).toEqual([
      {
        role: "user",
        parts: [
          {
            functionResponse: { name: "ls", response: { output: INTERRUPTED_TOOL }, id: "a" },
          },
        ],
      },
      { role: "user", parts: [{ text: "never mind" }] },
    ]);
  });

  test("a history opening with the model is led by a user turn; one ending with it is followed by one", () => {
    const request = conversation([
      { role: "assistant", parts: [{ kind: "text", text: "Summary so far." }] },
      { role: "user", parts: [{ kind: "text", text: "go on" }] },
      { role: "assistant", parts: [{ kind: "text", text: "Half an ans" }] },
    ]);

    expect(buildGeminiRequest(request, "gemini-2.5-pro").contents).toEqual([
      { role: "user", parts: [{ text: "[Continuing from previous AI thoughts...]" }] },
      { role: "model", parts: [{ text: "Summary so far." }] },
      { role: "user", parts: [{ text: "go on" }] },
      { role: "model", parts: [{ text: "Half an ans" }] },
      { role: "user", parts: [{ text: "Continue." }] },
    ]);
  });

  test("a compaction ending with the model is followed by the ask to write the summary", () => {
    const request = {
      ...conversation([
        {
          role: "user",
          parts: [
            {
              kind: "text",
              text: "Your task is to create a detailed summary of the conversation so far",
            },
          ],
        },
        { role: "assistant", parts: [{ kind: "text", text: "Summary:" }] },
      ]),
    };

    expect((buildGeminiRequest(request, "gemini-2.5-pro").contents as unknown[]).at(-1)).toEqual({
      role: "user",
      parts: [
        { text: "Write the summary of the conversation above that the system prompt asks for." },
      ],
    });
  });

  test("thinking is not sent back", () => {
    const request = conversation([
      { role: "user", parts: [{ kind: "text", text: "hi" }] },
      {
        role: "assistant",
        parts: [
          { kind: "thinking", text: "hmm", signature: "anthropic-sig" },
          { kind: "text", text: "hello" },
        ],
      },
      { role: "user", parts: [{ kind: "text", text: "and?" }] },
    ]);

    expect((buildGeminiRequest(request, "gemini-2.5-pro").contents as unknown[])[1]).toEqual({
      role: "model",
      parts: [{ text: "hello" }],
    });
  });

  test("asked to search the web with no other tool, Google's own search is sent", () => {
    const request = {
      ...conversation([{ role: "user", parts: [{ kind: "text", text: "news?" }] }]),
      webSearch: true,
    };

    const built = buildGeminiRequest(request, "gemini-2.5-pro");

    expect(built.tools).toEqual([{ googleSearch: {} }]);
    expect(built).not.toHaveProperty("toolConfig");
  });
});

describe("decoding what a Gemini model thought and called", () => {
  const signatures = () =>
    new GeminiSignatureStore(mkdtempSync(path.join(tmpdir(), "gemini-sigs-")));
  const decodedWith = (store: GeminiSignatureStore, chunks: unknown[]) => {
    const events: StreamEvent[] = [];
    const decoder = new GeminiDecoder({ signatures: store });
    for (const chunk of chunks)
      decoder.decode(JSON.stringify(chunk), (event) => events.push(event));
    decoder.end?.((event) => events.push(event));
    return events;
  };

  test("a thought part streams as thinking, its signature after it", () => {
    const events = decoded([
      { candidates: [{ content: { parts: [{ text: "Let me see", thought: true }] } }] },
      {
        candidates: [
          { content: { parts: [{ text: "", thought: true, thoughtSignature: "dGhvdWdodA==" }] } },
        ],
      },
      { candidates: [{ content: { parts: [{ text: "Done." }] }, finishReason: "STOP" }] },
    ]);

    expect(events.filter((event) => event.kind !== "start")).toEqual([
      { kind: "think", text: "Let me see" },
      { kind: "sig", text: "dGhvdWdodA==" },
      { kind: "text", text: "Done." },
      { kind: "stop", stop: "stop" },
    ]);
  });

  test("a call's signature rides in the id the agent gets, and comes back off it", () => {
    const store = signatures();
    const events = decodedWith(store, [
      {
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: { id: "fc_1", name: "bash", args: { cmd: "ls" } },
                  thoughtSignature: "c2lnbmVk",
                },
              ],
            },
            finishReason: "STOP",
          },
        ],
      },
    ]);

    const start = events.find((event) => event.kind === "tool_start");
    if (start?.kind !== "tool_start") throw new Error("no call");
    expect(start.name).toBe("bash");
    expect(start.id.length).toBeLessThan(40);
    expect(unsignedId({ id: start.id, store })).toEqual({ id: "fc_1", signature: "c2lnbmVk" });
    expect(events.filter((event) => event.kind === "tool_args")).toEqual([
      { kind: "tool_args", text: '{"cmd":"ls"}' },
    ]);
    // 调用了工具又说 STOP：按调用工具结束。
    expect(events.find((event) => event.kind === "stop")).toEqual({ kind: "stop", stop: "tool" });
  });

  test("a call with no id is given one; parallel calls each get their own; Gemini's namespace comes off the name", () => {
    const events = decoded([
      {
        candidates: [
          {
            content: {
              parts: [
                { functionCall: { name: "default_api:read", args: { path: "a" } } },
                { functionCall: { name: "default_api.read", args: { path: "b" } } },
              ],
            },
            finishReason: "STOP",
          },
        ],
      },
    ]);

    const starts = events.filter((event) => event.kind === "tool_start");
    expect(starts.map((event) => (event.kind === "tool_start" ? event.name : ""))).toEqual([
      "read",
      "read",
    ]);
    const ids = starts.map((event) => (event.kind === "tool_start" ? event.id : ""));
    expect(ids[0]).toMatch(/^call_/);
    expect(ids[1]).toMatch(/^call_/);
    expect(ids[0]).not.toBe(ids[1]);
  });

  test("a call written out in the text becomes the call it meant, even split across chunks", () => {
    const events = decoded([
      { candidates: [{ content: { parts: [{ text: "Let's look.call:default_" }] } }] },
      {
        candidates: [
          {
            content: { parts: [{ text: "api:bash{command:<ctrl46>ls -la<ctrl46>}" }] },
            finishReason: "STOP",
          },
        ],
      },
    ]);

    const content = events.filter((event) => event.kind !== "start");
    expect(content[0]).toEqual({ kind: "text", text: "Let's look." });
    expect(content[1]).toMatchObject({ kind: "tool_start", name: "bash" });
    expect(content[2]).toEqual({ kind: "tool_args", text: '{"command":"ls -la"}' });
    expect(content[3]).toEqual({ kind: "stop", stop: "tool" });
  });

  test("text that only looks like the start of a written call is said as it is", () => {
    const events = decoded([
      { candidates: [{ content: { parts: [{ text: "see call:default_api:x and" }] } }] },
      { candidates: [{ content: { parts: [{ text: " more" }] }, finishReason: "STOP" }] },
    ]);

    const text = events.map((event) => (event.kind === "text" ? event.text : "")).join("");
    expect(text).toBe("see call:default_api:x and more");
    expect(events.some((event) => event.kind === "tool_start")).toBe(false);
  });

  test("a picture the model drew comes as an image", () => {
    const events = decoded([
      {
        candidates: [
          {
            content: { parts: [{ inlineData: { mimeType: "image/png", data: "iVBOR" } }] },
            finishReason: "STOP",
          },
        ],
      },
    ]);

    expect(events.filter((event) => event.kind !== "start")).toEqual([
      { kind: "image", mediaType: "image/png", data: "iVBOR" },
      { kind: "stop", stop: "stop" },
    ]);
  });

  test("what Google's search found is read as one web search, by the site's name and Google's address", () => {
    const grounding = {
      webSearchQueries: ["osuna release", "osuna news"],
      groundingChunks: [
        { web: { title: "osuna.dev", uri: "https://vertexaisearch.cloud.google.com/a" } },
        { web: { uri: "https://vertexaisearch.cloud.google.com/b" } },
      ],
    };
    const events = decoded([
      {
        candidates: [{ content: { parts: [{ text: "Found it." }] }, groundingMetadata: grounding }],
      },
      {
        candidates: [
          { content: { parts: [] }, groundingMetadata: grounding, finishReason: "STOP" },
        ],
      },
    ]);

    expect(events.filter((event) => event.kind === "search")).toEqual([
      {
        kind: "search",
        query: "osuna release; osuna news",
        hits: [
          { title: "osuna.dev", url: "https://vertexaisearch.cloud.google.com/a", pageAge: "" },
          {
            title: "https://vertexaisearch.cloud.google.com/b",
            url: "https://vertexaisearch.cloud.google.com/b",
            pageAge: "",
          },
        ],
      },
    ]);
  });
});
