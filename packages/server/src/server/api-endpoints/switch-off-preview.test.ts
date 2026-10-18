// 用例取自 magpie（https://github.com/yetone/magpie）internal/agent/preview_test.go 的 TestDiffLines 与 TestMask，
// 把 magpie 换成 Osuna 的说法。
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { describe, expect, test } from "vitest";
import { diffLines, maskSecret, switchOffFileChange } from "./switch-off-preview.js";

describe("diffLines", () => {
  test("a line taken out, one put in, a value going back; secrets masked; a big config in between", () => {
    let big = "";
    for (let i = 0; i < 30000; i += 1) big += `[projects."/p/${i}"]\ntrust_level = "trusted"\n`;
    const before = `model = "relay/deepseek/pro"\nmodel_provider = "osuna_api_endpoint"\napi_key = "sk-live-123"\n${big}[model_providers.osuna_api_endpoint]\nname = "Osuna"\n`;
    const after = `model = "gpt-6"\nopenai_key = "sk-live-456"\n${big}`;
    const lines = diffLines(before, after);

    expect(lines).toEqual([
      { op: "restored", text: 'model = "gpt-6"', was: 'model = "relay/deepseek/pro"' },
      { op: "added", text: "openai_key = ••••" },
      { op: "removed", text: 'model_provider = "osuna_api_endpoint"' },
      { op: "removed", text: "api_key = ••••" },
      { op: "removed", text: "[model_providers.osuna_api_endpoint]" },
      { op: "removed", text: 'name = "Osuna"' },
    ]);
  });

  test("a key goes back to the line as deep as it, not one of the same name in a table taken out", () => {
    const lines = diffLines(
      '{\n  "picker": [\n    {"x": 1,\n    "model": "a/b"}\n  ],\n  "model": "a/c",\n}\n',
      '{\n  "model": "opus",\n}\n',
    );

    expect(lines).toEqual([
      { op: "restored", text: '  "model": "opus",', was: '  "model": "a/c",' },
      { op: "removed", text: '  "picker": [' },
      { op: "removed", text: '    {"x": 1,' },
      { op: "removed", text: '    "model": "a/b"}' },
    ]);
  });

  test("the same texts change nothing", () => {
    expect(diffLines("a\nb\n", "a\nb\n")).toEqual([]);
  });

  test("from nothing, a lone brace is left out", () => {
    expect(diffLines("", "x = 1\n}\n")).toEqual([{ op: "added", text: "x = 1" }]);
  });

  test("a block of thousands taken out, past what is compared line by line", () => {
    let table = "";
    const tableLines: { op: string; text: string }[] = [];
    for (let i = 0; i < 7000; i += 1) {
      table += `  "m${i}": {"name": "M ${i}"},\n`;
      tableLines.push({ op: "removed", text: `  "m${i}": {"name": "M ${i}"},` });
    }

    const lines = diffLines(
      `{\n"model": "relay/x",\n"provider": {\n${table}}\n}\n`,
      '{\n"provider": {\n}\n}\n',
    );

    expect(lines).toEqual([{ op: "removed", text: '"model": "relay/x",' }, ...tableLines]);
  });
});

describe("maskSecret", () => {
  const compact = '[{"requestHeaders":{"Authorization":"Bearer x"}}]';
  test.each([
    ['  "ANTHROPIC_API_KEY": "sk-ant-x",', '  "ANTHROPIC_API_KEY": ••••'],
    ['  "ANTHROPIC_AUTH_TOKEN": "gw-123",', '  "ANTHROPIC_AUTH_TOKEN": ••••'],
    ['  "ANTHROPIC_AUTH_TOKEN": "",', '  "ANTHROPIC_AUTH_TOKEN": "",'],
    ["export OPENAI_API_KEY=sk-1", "export OPENAI_API_KEY= ••••"],
    ['env_key = "$KEY"', 'env_key = "$KEY"'],
    ['model = "x"', 'model = "x"'],
    [
      '"CLAUDE_CODE_MAX_CONTEXT_TOKENS": "1000000",',
      '"CLAUDE_CODE_MAX_CONTEXT_TOKENS": "1000000",',
    ],
    ["[auth]", "[auth]"],
    [compact, compact],
  ])("%s", (line, expected) => {
    expect(maskSecret(line)).toBe(expected);
  });
});

describe("switchOffFileChange", () => {
  const where = { path: "/home/me/.codex/config.toml", homeDir: "/home/me" };

  test("an edited file lists its lines under a path from home", () => {
    expect(
      switchOffFileChange({
        ...where,
        before: 'model = "a"\n',
        after: { kind: "write", text: 'model = "b"\n' },
      }),
    ).toEqual({
      path: "~/.codex/config.toml",
      change: "edited",
      lines: [{ op: "restored", text: 'model = "b"', was: 'model = "a"' }],
    });
  });

  test("a file made by switching off lists what it holds", () => {
    expect(
      switchOffFileChange({
        ...where,
        before: null,
        after: { kind: "write", text: 'model = "b"\n' },
      }),
    ).toEqual({
      path: "~/.codex/config.toml",
      change: "created",
      lines: [{ op: "added", text: 'model = "b"' }],
    });
  });

  test("a file switching off deletes has no lines", () => {
    expect(switchOffFileChange({ ...where, before: "x = 1\n", after: { kind: "delete" } })).toEqual(
      {
        path: "~/.codex/config.toml",
        change: "removed",
        lines: [],
      },
    );
  });

  test("a file left alone, or written the same, is no change", () => {
    expect(
      switchOffFileChange({ ...where, before: "x = 1\n", after: { kind: "keep" } }),
    ).toBeNull();
    expect(
      switchOffFileChange({
        ...where,
        before: "x = 1\n",
        after: { kind: "write", text: "x = 1\n" },
      }),
    ).toBeNull();
  });

  test("a path outside home stays as it is", () => {
    expect(
      switchOffFileChange({
        path: "/etc/codex/config.toml",
        homeDir: "/home/me",
        before: null,
        after: { kind: "delete" },
      }),
    ).toBeNull();
    expect(
      switchOffFileChange({
        path: "/etc/codex/config.toml",
        homeDir: "/home/me",
        before: "x = 1\n",
        after: { kind: "delete" },
      }),
    ).toEqual({ path: "/etc/codex/config.toml", change: "removed", lines: [] });
  });
});
