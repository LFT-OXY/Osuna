import { describe, expect, it } from "vitest";
import { autoPickRuleProblem, autoPickRuleRegExp } from "./auto-pick-rules";

describe("auto-pick rules", () => {
  it("takes globs and whole-name regular expressions", () => {
    expect(autoPickRuleProblem("gpt-*")).toBeNull();
    expect(autoPickRuleProblem("re:claude-(opus|sonnet)-\\d+")).toBeNull();
    expect(autoPickRuleProblem("re:gpt-5(-mini)?")).toBeNull();
    expect(autoPickRuleRegExp("GPT-*").test("gpt-5-mini")).toBe(true);
    expect(autoPickRuleRegExp("re:m3\\d").test("m30")).toBe(true);
    expect(autoPickRuleRegExp("re:m3\\d").test("xm30")).toBe(false);
  });

  it("turns away a model name, an empty or unreadable expression, and one too long", () => {
    expect(autoPickRuleProblem("gpt-5")).toBe("not_rule");
    expect(autoPickRuleProblem("re: ")).toBe("empty_regex");
    expect(autoPickRuleProblem("re:(")).toBe("invalid_regex");
    expect(autoPickRuleProblem(`${"a".repeat(200)}*`)).toBe("too_long");
  });

  it("turns away what backtracks without bound, which RE2 in magpie never does", () => {
    expect(autoPickRuleProblem("re:(a+)+b")).toBe("nested_quantifier");
    expect(autoPickRuleProblem("re:(a|aa)*b")).toBe("nested_quantifier");
    expect(autoPickRuleProblem("re:((ab)*c)+")).toBe("nested_quantifier");
    expect(autoPickRuleProblem("re:(a)\\1")).toBe("backreference");
    expect(autoPickRuleProblem("re:(?<n>a)\\k<n>")).toBe("backreference");
    expect(autoPickRuleProblem("re:gpt(?=-5)")).toBe("lookaround");
    expect(autoPickRuleProblem("re:(?<!x)gpt.*")).toBe("lookaround");
    // 字符类里的符号照字面。
    expect(autoPickRuleProblem("re:[(+)]+x")).toBeNull();
  });

  it("collapses a run of * in a glob into one", () => {
    expect(autoPickRuleRegExp("gpt-***mini").source).toBe("^gpt-.*mini$");
  });
});
