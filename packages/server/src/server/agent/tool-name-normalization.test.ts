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

// COMPAT(paseoDataMigration): added in v1.0.0, remove after 2027-10-09 or in 2.0.0, whichever first
const LEGACY_TOOL_NAMES = {
  claude: "mcp__paseo__create_agent",
  voice: "mcp__paseo_voice__list_agents",
  codex: "paseo.create_agent",
  speak: "mcp__paseo__speak",
};

describe("tool calls recorded by 0.14.x", () => {
  it("are still recognized as Osuna tools in an old timeline", () => {
    expect(isOsunaToolName(LEGACY_TOOL_NAMES.claude)).toBe(true);
    expect(isOsunaToolName(LEGACY_TOOL_NAMES.voice)).toBe(true);
    expect(isOsunaToolName(LEGACY_TOOL_NAMES.codex)).toBe(true);
    expect(isOsunaToolName(LEGACY_TOOL_NAMES.speak)).toBe(false);
  });

  it("resolve to the same leaf tool as their renamed counterparts", () => {
    expect(getOsunaToolLeafName(LEGACY_TOOL_NAMES.claude)).toBe("create_agent");
    expect(getOsunaToolLeafName(LEGACY_TOOL_NAMES.voice)).toBe("list_agents");
    expect(getOsunaToolLeafName(LEGACY_TOOL_NAMES.codex)).toBe("create_agent");
  });
});
