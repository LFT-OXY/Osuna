import { describe, expect, test } from "vitest";

import {
  mapToolDetail,
  parseToolArgs,
  parseToolResult,
  resolveToolCallName,
} from "./tool-call-mapper.js";

describe("Pi tool call mapper", () => {
  test("maps bash args and result to shell detail", () => {
    const toolCall = parseToolArgs("bash", { command: "echo hello" });
    const result = parseToolResult({ output: "hello\n", exitCode: 0 });

    expect(mapToolDetail(toolCall, result)).toEqual({
      type: "shell",
      command: "echo hello",
      output: "hello\n",
      exitCode: 0,
    });
  });

  test("maps legacy edit args to edit detail with diff", () => {
    const toolCall = parseToolArgs("edit", {
      path: "app.ts",
      old_string: "before",
      new_string: "after",
    });
    const result = parseToolResult({ details: { diff: "-before\n+after" } });

    expect(mapToolDetail(toolCall, result)).toEqual({
      type: "edit",
      filePath: "app.ts",
      oldString: "before",
      newString: "after",
      unifiedDiff: "-before\n+after",
    });
  });

  test("preserves ordinary writes as write details", () => {
    const toolCall = parseToolArgs("write", {
      path: "notes.txt",
      content: "unchanged\n",
    });

    expect(mapToolDetail(toolCall, parseToolResult({ text: "Wrote notes.txt" }))).toEqual({
      type: "write",
      filePath: "notes.txt",
      content: "unchanged\n",
    });
  });

  test("maps executed xdev writes to their wrapped tool detail", () => {
    const toolCall = parseToolArgs("write", {
      path: "xd://browser",
      content: "{}",
    });
    const result = parseToolResult({
      content: [{ type: "text", text: "Opened Example Domain" }],
      details: {
        xdev: {
          tool: "browser",
          mode: "execute",
          args: { action: "open", url: "https://example.com" },
          inner: { title: "Example Domain" },
        },
      },
    });

    expect(mapToolDetail(toolCall, result)).toEqual({
      type: "unknown",
      input: { action: "open", url: "https://example.com" },
      output: {
        content: [{ type: "text", text: "Opened Example Domain" }],
        details: { title: "Example Domain" },
      },
    });
    expect(resolveToolCallName(toolCall, result)).toBe("browser");
  });

  test("does not treat xdev help metadata as an executed inner tool", () => {
    const toolCall = parseToolArgs("write", {
      path: "xd://browser",
      content: "",
    });
    const result = parseToolResult({
      details: {
        xdev: {
          tool: "browser",
          mode: "help",
          inner: "Browser help",
        },
      },
    });

    expect(mapToolDetail(toolCall, result)).toEqual({
      type: "unknown",
      input: { path: "xd://browser", content: "" },
      output: result,
    });
    expect(resolveToolCallName(toolCall, result)).toBe("write");
  });

  test("does not treat malformed xdev metadata as an executed inner tool", () => {
    const toolCall = parseToolArgs("write", {
      path: "xd://browser",
      content: "{}",
    });
    const result = parseToolResult({
      details: {
        xdev: {
          tool: "",
          mode: "execute",
          args: { action: "open" },
          inner: { title: "must not surface" },
        },
      },
    });

    expect(mapToolDetail(toolCall, result)).toEqual({
      type: "unknown",
      input: { path: "xd://browser", content: "{}" },
      output: result,
    });
    expect(resolveToolCallName(toolCall, result)).toBe("write");
  });

  test("preserves unknown tool input and parsed output", () => {
    const toolCall = parseToolArgs("custom_tool", { value: 42 });
    const result = parseToolResult({ text: "custom result" });

    expect(mapToolDetail(toolCall, result)).toEqual({
      type: "unknown",
      input: { value: 42 },
      output: { text: "custom result" },
    });
  });

  test("maps task calls to sub-agent detail while running", () => {
    const toolCall = parseToolArgs("task", {
      agent: "explore",
      task: "Trace the Pi provider tool mapper",
    });

    expect(mapToolDetail(toolCall, null)).toEqual({
      type: "sub_agent",
      subAgentType: "explore",
      description: "Trace the Pi provider tool mapper",
      log: "",
    });
  });

  test("maps completed subagent calls with task input to sub-agent detail", () => {
    const toolCall = parseToolArgs("subagent", {
      agent: "reviewer",
      task: "Review the Pi mapper change",
    });
    const result = parseToolResult({
      content: [{ type: "text", text: "The mapper change preserves provider status." }],
    });

    expect(mapToolDetail(toolCall, result)).toEqual({
      type: "sub_agent",
      subAgentType: "reviewer",
      description: "Review the Pi mapper change",
      log: "The mapper change preserves provider status.",
    });
  });

  test("normalizes Pi MCP proxy calls from requested tool args while running", () => {
    const toolCall = parseToolArgs("mcp", {
      tool: "osuna_list_models",
      args: '{"provider":"pi"}',
    });

    expect(resolveToolCallName(toolCall, null)).toBe("osuna.list_models");
  });

  test("normalizes Pi MCP proxy calls from result details when completed", () => {
    const toolCall = parseToolArgs("mcp", {
      tool: "osuna_list_models",
      args: '{"provider":"pi"}',
    });
    const result = parseToolResult({
      content: [{ type: "text", text: "(empty result)" }],
      details: {
        mode: "call",
        server: "osuna",
        tool: "list_models",
      },
    });

    expect(resolveToolCallName(toolCall, result)).toBe("osuna.list_models");
  });

  describe("Osuna create_agent calls", () => {
    const createArgs = { title: "Review", provider: "codex/gpt-5.4", initialPrompt: "Review it" };

    test.each([
      ["mcp proxy with a prefixed tool", "mcp", { tool: "osuna_create_agent", args: createArgs }],
      [
        "mcp proxy with JSON string args",
        "mcp",
        { tool: "osuna_create_agent", args: JSON.stringify(createArgs) },
      ],
      [
        "mcp proxy with an explicit server",
        "mcp",
        { server: "osuna", tool: "create_agent", args: createArgs },
      ],
      ["mcp__osuna namespace tool", "mcp__osuna", { tool: "create_agent", args: createArgs }],
      ["server-prefixed direct tool", "osuna_create_agent", createArgs],
      ["mcp-prefixed direct tool", "mcp__osuna_create_agent", createArgs],
    ])("normalizes the %s to osuna.create_agent with flat input", (_shape, toolName, args) => {
      const toolCall = parseToolArgs(toolName, args);

      expect(resolveToolCallName(toolCall, null)).toBe("osuna.create_agent");
      expect(mapToolDetail(toolCall, null)).toEqual({
        type: "unknown",
        input: createArgs,
        output: null,
      });
    });

    test("leaves other Osuna tools behind the mcp proxy unchanged", () => {
      const toolCall = parseToolArgs("mcp", { tool: "osuna_list_agents", args: {} });

      expect(resolveToolCallName(toolCall, null)).toBe("osuna.list_agents");
    });
  });
});
