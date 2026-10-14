import { describe, expect, test } from "vitest";
import { fitAnthropicBody } from "./passthrough.js";

/*
 * 直通给 Anthropic 地址的请求体，按这家的模型改的几处；其余字节原样。
 * DeepSeek 的例子照 magpie（MIT，THIRD_PARTY_NOTICES）的 deepseek_anthropic_thinking_test.go。
 */

describe("a Claude Code request passed through to another vendor's model", () => {
  test("a Claude model gets the body byte for byte", () => {
    const body = `{"model":"claude-sonnet-4-5", "thinking":{"type":"adaptive"},"output_config":{"effort":"high"},"messages":[]}`;
    expect(fitAnthropicBody(body, "claude-sonnet-4-5")).toBe(body);
  });

  test("Claude's adaptive thinking and effort are taken out, the rest left as it was", () => {
    const body = `{"model":"glm-4.6", "max_tokens" : 32000,"thinking":{"type":"adaptive"},"output_config":{"effort":"high"},"messages":[{"role":"user","content":"hi"}]}`;
    expect(fitAnthropicBody(body, "glm-4.6")).toBe(
      `{"model":"glm-4.6", "max_tokens" : 32000,"messages":[{"role":"user","content":"hi"}]}`,
    );
  });

  test("the effort goes and a structured output format beside it stays", () => {
    const body = `{"model":"kimi-k2","thinking":{"type":"adaptive"},"output_config":{"effort":"low","format":{"type":"json_schema","schema":{"type":"object"}}},"messages":[]}`;
    expect(JSON.parse(fitAnthropicBody(body, "kimi-k2"))).toEqual({
      model: "kimi-k2",
      output_config: { format: { type: "json_schema", schema: { type: "object" } } },
      messages: [],
    });
  });

  test("a request that doesn't mention thinking is told thinking is off", () => {
    const body = `{"model":"kimi-k2","max_tokens":512,"messages":[{"role":"user","content":"Title this"}]}`;
    expect(JSON.parse(fitAnthropicBody(body, "kimi-k2"))).toEqual({
      model: "kimi-k2",
      max_tokens: 512,
      messages: [{ role: "user", content: "Title this" }],
      thinking: { type: "disabled" },
    });
  });

  test("thinking with a budget, or turned off, goes as the agent sent it", () => {
    const enabled = `{"model":"kimi-k2","thinking":{"type":"enabled","budget_tokens":4096},"messages":[]}`;
    const disabled = `{"model":"kimi-k2","thinking":{"type":"disabled"},"messages":[]}`;
    expect(fitAnthropicBody(enabled, "kimi-k2")).toBe(enabled);
    expect(fitAnthropicBody(disabled, "kimi-k2")).toBe(disabled);
  });
});

describe("a Claude Code conversation passed through to DeepSeek's Anthropic endpoint", () => {
  // Claude 先答过的对话：一次调用前是封存的思考，一次前是签名的思考，一步没有思考，最后的回答也没有。
  const conversation = (
    model: string,
  ) => `{"model":"${model}","max_tokens":32000,"stream":false,"thinking":{"type":"enabled","budget_tokens":4096},
	"tools":[{"name":"Bash","input_schema":{"type":"object","properties":{"command":{"type":"string"}}}}],
	"messages":[
	{"role":"user","content":"fix the login bug"},
	{"role":"assistant","content":[{"type":"redacted_thinking","data":"EmwKAhgBEgy3va3pzix"},{"type":"tool_use","id":"toolu_1","name":"Bash","input":{"command":"ls"}}]},
	{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_1","content":"main.go"}]},
	{"role":"assistant","content":[{"type":"thinking","thinking":"Read main.go.","signature":"EqQBCkgIBxABGAIiQL"},{"type":"tool_use","id":"toolu_2","name":"Bash","input":{"command":"cat main.go"}}]},
	{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_2","content":"package main"}]},
	{"role":"assistant","content":[{"type":"text","text":"Checking the test."},{"type":"tool_use","id":"toolu_3","name":"Bash","input":{"command":"go test"}}]},
	{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_3","content":"ok"}]},
	{"role":"assistant","content":[{"type":"redacted_thinking","data":"EmwKAhgBEgy3va3pzix"},{"type":"thinking","thinking":"Fine.","signature":"EqQBCkgIBxAB"},{"type":"text","text":"It passes."}]},
	{"role":"user","content":"thanks, now commit"}]}`;

  test("each tool turn goes with a thinking block, Claude's sealed thinking as a space; the rest as it came", () => {
    const sent = JSON.parse(fitAnthropicBody(conversation("deepseek-flash"), "deepseek-flash")) as {
      messages: unknown[];
    };
    const original = JSON.parse(conversation("deepseek-flash")) as { messages: unknown[] };
    const space = { type: "thinking", thinking: " " };
    expect(sent.messages).toEqual([
      original.messages[0],
      {
        role: "assistant",
        content: [
          space,
          { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls" } },
        ],
      },
      original.messages[2],
      original.messages[3],
      original.messages[4],
      {
        role: "assistant",
        content: [
          space,
          { type: "text", text: "Checking the test." },
          { type: "tool_use", id: "toolu_3", name: "Bash", input: { command: "go test" } },
        ],
      },
      original.messages[6],
      {
        role: "assistant",
        content: [
          space,
          { type: "thinking", thinking: "Fine.", signature: "EqQBCkgIBxAB" },
          { type: "text", text: "It passes." },
        ],
      },
      original.messages[8],
    ]);
  });

  test("another vendor's model is sent the conversation as it came", () => {
    expect(fitAnthropicBody(conversation("glm-5.2"), "glm-5.2")).toBe(conversation("glm-5.2"));
  });
});
