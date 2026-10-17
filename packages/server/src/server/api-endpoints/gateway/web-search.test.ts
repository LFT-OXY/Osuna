// 什么时候算 Codex 要了联网搜索照 magpie（MIT，THIRD_PARTY_NOTICES）的 internal/gateway/search.go searchAsked
// 与 responses.go 读 tools、tool_choice 的那段（allowed_tools 没列 web_search 时不算）。

import { describe, expect, test } from "vitest";
import { parseAnthropicRequest } from "./translation/anthropic.js";
import { parseResponsesRequest } from "./translation/responses.js";
import { formatsToSearchOn, withWebSearchFor, withoutResponsesWebSearch } from "./web-search.js";

const WEB_SEARCH = { type: "web_search", external_web_access: false };
const EXEC = { type: "function", name: "exec_command", parameters: { type: "object" } };
const ASKED = { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] };
const SEARCHED = { id: "ws_1", type: "web_search_call", status: "completed" };
const ANSWERED = {
  type: "message",
  role: "assistant",
  content: [{ type: "output_text", text: "ok" }],
};

describe("a Responses request for an endpoint that doesn't search the web", () => {
  test("loses the web_search tool and keeps the others and tool_choice auto", () => {
    const body = { model: "m", tools: [EXEC, WEB_SEARCH], tool_choice: "auto" };

    expect(withoutResponsesWebSearch(body)).toEqual({
      model: "m",
      tools: [EXEC],
      tool_choice: "auto",
    });
  });

  test("loses a tool_choice that names web_search", () => {
    const body = { tools: [EXEC, WEB_SEARCH], tool_choice: { type: "web_search" } };

    expect(withoutResponsesWebSearch(body)).toEqual({ tools: [EXEC] });
  });

  test("loses web_search from allowed_tools and keeps the rest of it", () => {
    const body = {
      tools: [EXEC, WEB_SEARCH],
      tool_choice: {
        type: "allowed_tools",
        mode: "auto",
        tools: [{ type: "function", name: "exec_command" }, { type: "web_search" }],
      },
    };

    expect(withoutResponsesWebSearch(body)).toEqual({
      tools: [EXEC],
      tool_choice: {
        type: "allowed_tools",
        mode: "auto",
        tools: [{ type: "function", name: "exec_command" }],
      },
    });
  });

  test("loses tool_choice when allowed_tools listed only web_search", () => {
    const body = {
      tools: [EXEC, WEB_SEARCH],
      tool_choice: { type: "allowed_tools", mode: "required", tools: [{ type: "web_search" }] },
    };

    expect(withoutResponsesWebSearch(body)).toEqual({ tools: [EXEC] });
  });

  test("loses tools and tool_choice when web_search was the only tool", () => {
    const body = { model: "m", tools: [WEB_SEARCH], tool_choice: "auto" };

    expect(withoutResponsesWebSearch(body)).toEqual({ model: "m" });
  });

  test("loses the web_search_call items of its history when it offers web_search", () => {
    const body = { tools: [EXEC, WEB_SEARCH], input: [ASKED, SEARCHED, ANSWERED] };

    expect(withoutResponsesWebSearch(body)).toEqual({
      tools: [EXEC],
      input: [ASKED, ANSWERED],
    });
  });

  test("is left as it came, history and all, when it doesn't offer web_search", () => {
    const body = { tools: [EXEC], tool_choice: "auto", input: [ASKED, SEARCHED, ANSWERED] };

    expect(withoutResponsesWebSearch(body)).toBe(body);
  });

  test("is left as it came when allowed_tools leaves web_search out", () => {
    const body = {
      tools: [EXEC, WEB_SEARCH],
      tool_choice: {
        type: "allowed_tools",
        mode: "auto",
        tools: [{ type: "function", name: "exec_command" }],
      },
      input: [ASKED, SEARCHED, ANSWERED],
    };

    expect(withoutResponsesWebSearch(body)).toBe(body);
  });
});

/*
 * 翻译出去的请求只对在目标格式上自己会搜的接口带搜索（工单 06）：照 magpie gateway.go translated 里
 * 「an API on which the provider searches by itself comes first」与 searchesFor。
 */
describe("a translated request and the endpoint's web search", () => {
  const CLAUDE_SEARCH = parseAnthropicRequest({
    model: "gpt-5",
    messages: [{ role: "user", content: "Perform a web search for the query: osuna" }],
    tool_choice: { type: "tool", name: "web_search" },
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 8 }],
  });
  const CODEX_TURN = parseResponsesRequest({
    model: "kimi-k2",
    input: "hi",
    tools: [EXEC, WEB_SEARCH],
    tool_choice: "auto",
  });

  test("keeps the search for an endpoint that searches on the format it goes out on", () => {
    expect(withWebSearchFor(CODEX_TURN, true)).toBe(CODEX_TURN);
    expect(CODEX_TURN.webSearch).toBe(true);
  });

  test("drops it, with a choice naming it, for one that doesn't", () => {
    expect(withWebSearchFor(CODEX_TURN, false)).toMatchObject({
      webSearch: false,
      toolChoice: "auto",
    });
    expect(withWebSearchFor(CLAUDE_SEARCH, false)).toMatchObject({
      webSearch: false,
      toolChoice: "",
    });
  });

  test("asking for a search, the formats the endpoint searches on are the ones to choose from when it has any", () => {
    const endpoint = {
      searchesWeb: true,
      baseUrls: [
        { format: "openai_chat" as const, url: "https://relay.example/v1" },
        { format: "anthropic_messages" as const, url: "https://relay.example" },
      ],
    };
    const formats = ["openai_chat", "anthropic_messages"] as const;

    expect(formatsToSearchOn({ endpoint, formats, asked: true })).toEqual(["anthropic_messages"]);
    expect(formatsToSearchOn({ endpoint, formats, asked: false })).toEqual(formats);
    const off = { ...endpoint, searchesWeb: false };
    expect(formatsToSearchOn({ endpoint: off, formats, asked: true })).toEqual(formats);
  });
});
