import { describe, expect, it } from "vitest";

import { getOsunaToolLeafName, isOsunaToolName } from "@osuna/protocol/tool-name-normalization";

describe("isOsunaToolName", () => {
  it("detects Claude Code format", () => {
    expect(isOsunaToolName("mcp__osuna__create_agent")).toBe(true);
    expect(isOsunaToolName("mcp__osuna__list_agents")).toBe(true);
  });

  it("detects osuna_voice variant", () => {
    expect(isOsunaToolName("mcp__osuna_voice__create_agent")).toBe(true);
    expect(isOsunaToolName("osuna_voice.create_agent")).toBe(true);
  });

  it("excludes speak tools", () => {
    expect(isOsunaToolName("mcp__osuna_voice__speak")).toBe(false);
    expect(isOsunaToolName("mcp__osuna__speak")).toBe(false);
    expect(isOsunaToolName("osuna.speak")).toBe(false);
  });

  it("detects Codex dot format", () => {
    expect(isOsunaToolName("osuna.create_agent")).toBe(true);
  });

  it("rejects non-osuna tools", () => {
    expect(isOsunaToolName("Bash")).toBe(false);
    expect(isOsunaToolName("Read")).toBe(false);
    expect(isOsunaToolName("mcp__other_server__some_tool")).toBe(false);
  });
});

describe("getOsunaToolLeafName", () => {
  it("extracts leaf from Claude Code format", () => {
    expect(getOsunaToolLeafName("mcp__osuna__create_agent")).toBe("create_agent");
  });

  it("extracts leaf from Codex format", () => {
    expect(getOsunaToolLeafName("osuna.create_agent")).toBe("create_agent");
    expect(getOsunaToolLeafName("osuna.list_agents")).toBe("list_agents");
  });

  it("returns null for non-osuna tools", () => {
    expect(getOsunaToolLeafName("Bash")).toBeNull();
  });
});
