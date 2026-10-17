// 什么时候算 Codex 要了联网搜索照 magpie（MIT，THIRD_PARTY_NOTICES）的 internal/gateway/search.go searchAsked
// 与 responses.go 读 tools、tool_choice 的那段（allowed_tools 没列 web_search 时不算）。

import { describe, expect, test } from "vitest";
import { withoutResponsesWebSearch } from "./web-search.js";

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
