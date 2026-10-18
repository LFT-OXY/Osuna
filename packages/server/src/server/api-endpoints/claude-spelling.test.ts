// 例子照 magpie（MIT，THIRD_PARTY_NOTICES）internal/provider/claudedash.go 的注释与 claudedash_test.go。

import { describe, expect, test } from "vitest";
import { claudeSpelled } from "./claude-spelling.js";

describe("claudeSpelled", () => {
  test("a dotted Claude version is written with hyphens when that comes back to this one id", () => {
    const served = ["claude-opus-4.6", "glm-4.6"];
    expect(claudeSpelled({ model: "claude-opus-4.6", served })).toBe("claude-opus-4-6");
  });

  test("keeps [1m] and the endpoint prefix", () => {
    const served = ["relay/claude-opus-4.6-us"];
    expect(claudeSpelled({ model: "relay/claude-opus-4.6-us[1m]", served })).toBe(
      "relay/claude-opus-4-6-us[1m]",
    );
  });

  test("keeps a level fixed on the model (the Subagent model's `:high`)", () => {
    const served = ["claude-sonnet-4.6"];
    expect(claudeSpelled({ model: "claude-sonnet-4.6:high", served })).toBe(
      "claude-sonnet-4-6:high",
    );
  });

  test("covers every Claude family Claude Code reads by substring, Mythos too", () => {
    for (const [model, dashed] of [
      ["claude-sonnet-4.6", "claude-sonnet-4-6"],
      ["claude-haiku-4.5", "claude-haiku-4-5"],
      ["claude-fable-5.1", "claude-fable-5-1"],
      ["claude-mythos-5.1", "claude-mythos-5-1"],
    ]) {
      expect(claudeSpelled({ model, served: [model] })).toBe(dashed);
    }
  });

  test("other vendors' ids stay as they are", () => {
    expect(claudeSpelled({ model: "glm-4.6", served: ["glm-4.6"] })).toBe("glm-4.6");
    expect(claudeSpelled({ model: "gpt-5.5", served: ["gpt-5.5"] })).toBe("gpt-5.5");
  });

  test("stays dotted when the hyphenated id is itself served", () => {
    const served = ["claude-opus-4.6", "claude-opus-4-6"];
    expect(claudeSpelled({ model: "claude-opus-4.6", served })).toBe("claude-opus-4.6");
  });

  test("stays dotted when two served ids would be hyphenated alike", () => {
    const twins = ["claude-opus-4.6.1", "claude-opus-4.6-1"];
    expect(claudeSpelled({ model: "claude-opus-4.6.1", served: twins })).toBe("claude-opus-4.6.1");
  });
});
