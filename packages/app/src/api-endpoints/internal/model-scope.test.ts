import { describe, expect, it } from "vitest";
import { modelScopeOf, typedRuleOf } from "./model-scope";

describe("model scope", () => {
  it("reads a missing or unknown scope as picked only", () => {
    expect(modelScopeOf({ modelScope: "vendor" })).toBe("vendor");
    expect(modelScopeOf({ modelScope: "picked" })).toBe("picked");
    expect(modelScopeOf({})).toBe("picked");
    expect(modelScopeOf({ modelScope: "usage" })).toBe("picked");
  });

  it("takes a glob or a re: rule, and turns away a blank, a repeat and a bare model name", () => {
    expect(typedRuleOf("  gpt-* ", [])).toEqual({ kind: "rule", rule: "gpt-*" });
    expect(typedRuleOf("re:claude-\\d", [])).toEqual({ kind: "rule", rule: "re:claude-\\d" });
    expect(typedRuleOf("   ", [])).toEqual({ kind: "empty" });
    expect(typedRuleOf("gpt-*", ["gpt-*"])).toEqual({ kind: "duplicate" });
    expect(typedRuleOf(" gpt-5 ", [])).toEqual({
      kind: "problem",
      text: "gpt-5",
      problem: "not_rule",
    });
    expect(typedRuleOf("re:(a)\\1", [])).toEqual({
      kind: "problem",
      text: "re:(a)\\1",
      problem: "invalid_regex",
    });
  });
});
