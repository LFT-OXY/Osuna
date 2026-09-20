import { describe, expect, it } from "vitest";

import { getOsunaToolLeafName, isOsunaToolName } from "@osuna/protocol/tool-name-normalization";

describe("isOsunaToolName", () => {
  it("detects Claude Code format", () => {
    expect(isOsunaToolName("mcp__paseo__create_agent")).toBe(true);
    expect(isOsunaToolName("mcp__paseo__list_agents")).toBe(true);
  });

  it("detects paseo_voice variant", () => {
    expect(isOsunaToolName("mcp__paseo_voice__create_agent")).toBe(true);
    expect(isOsunaToolName("paseo_voice.create_agent")).toBe(true);
  });

  it("excludes speak tools", () => {
    expect(isOsunaToolName("mcp__paseo_voice__speak")).toBe(false);
    expect(isOsunaToolName("mcp__paseo__speak")).toBe(false);
    expect(isOsunaToolName("paseo.speak")).toBe(false);
  });

  it("detects Codex dot format", () => {
    expect(isOsunaToolName("paseo.create_agent")).toBe(true);
  });

  it("rejects non-paseo tools", () => {
    expect(isOsunaToolName("Bash")).toBe(false);
    expect(isOsunaToolName("Read")).toBe(false);
    expect(isOsunaToolName("mcp__other_server__some_tool")).toBe(false);
  });
});

describe("getOsunaToolLeafName", () => {
  it("extracts leaf from Claude Code format", () => {
    expect(getOsunaToolLeafName("mcp__paseo__create_agent")).toBe("create_agent");
  });

  it("extracts leaf from Codex format", () => {
    expect(getOsunaToolLeafName("paseo.create_agent")).toBe("create_agent");
    expect(getOsunaToolLeafName("paseo.list_agents")).toBe("list_agents");
  });

  it("returns null for non-paseo tools", () => {
    expect(getOsunaToolLeafName("Bash")).toBeNull();
  });
});
