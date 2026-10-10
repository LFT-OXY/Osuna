import { describe, expect, test } from "vitest";

import { createPiExtensionHost } from "./extensions/index.js";
import {
  mapToolDetail,
  parseToolArgs,
  parseToolResult,
  type PiToolResult,
  type PiTrackedToolCall,
} from "./tool-call-mapper.js";

// 时间线上的工具名与 agent.ts 的 emitToolCallEvent 同一口径：扩展给了名字用扩展的，否则用解析出的工具名。
function resolveToolCallName(toolCall: PiTrackedToolCall, result: PiToolResult): string {
  const mapping = createPiExtensionHost().mapToolCall({
    callId: "call-1",
    toolName: toolCall.toolName,
    args: toolCall.args,
    status: result ? "completed" : "running",
    result,
  });
  return mapping?.name ?? toolCall.toolName;
}

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

  test("preserves unknown tool input and parsed output", () => {
    const toolCall = parseToolArgs("custom_tool", { value: 42 });
    const result = parseToolResult({ text: "custom result" });

    expect(mapToolDetail(toolCall, result)).toEqual({
      type: "unknown",
      input: { value: 42 },
      output: { text: "custom result" },
    });
  });

  describe("Paseo create_agent calls", () => {
    const createArgs = { title: "Review", provider: "codex/gpt-5.4", initialPrompt: "Review it" };

    test.each([
      ["mcp proxy with a prefixed tool", "mcp", { tool: "paseo_create_agent", args: createArgs }],
      [
        "mcp proxy with JSON string args",
        "mcp",
        { tool: "paseo_create_agent", args: JSON.stringify(createArgs) },
      ],
      [
        "mcp proxy with an explicit server",
        "mcp",
        { server: "paseo", tool: "create_agent", args: createArgs },
      ],
      ["mcp__paseo namespace tool", "mcp__paseo", { tool: "create_agent", args: createArgs }],
      ["server-prefixed direct tool", "paseo_create_agent", createArgs],
      ["mcp-prefixed direct tool", "mcp__paseo_create_agent", createArgs],
    ])("normalizes the %s to paseo.create_agent with flat input", (_shape, toolName, args) => {
      const toolCall = parseToolArgs(toolName, args);

      expect(resolveToolCallName(toolCall, null)).toBe("paseo.create_agent");
      expect(mapToolDetail(toolCall, null)).toEqual({
        type: "unknown",
        input: createArgs,
        output: null,
      });
    });

    test("leaves other Paseo tools behind the mcp proxy unchanged", () => {
      const toolCall = parseToolArgs("mcp", { tool: "paseo_list_agents", args: {} });

      expect(resolveToolCallName(toolCall, null)).toBe("paseo.list_agents");
    });
  });
});
