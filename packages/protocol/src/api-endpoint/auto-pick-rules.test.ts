// 用例取自 magpie（MIT，THIRD_PARTY_NOTICES）：https://github.com/yetone/magpie 的 internal/provider/groupmatch_test.go 的做法（区分大小写、RE2 编译不过的写法）。
import { describe, expect, it } from "vitest";
import { autoPickRuleProblem, compileAutoPickRule } from "./auto-pick-rules";

// 会让回溯引擎卡住几秒以上的规则与输入：RE2 线性时间，要在 100 ms 内答出。
function timedMatch(rule: string, modelId: string): { matched: boolean; ms: number } {
  const started = performance.now();
  expect(autoPickRuleProblem(rule)).toBeNull();
  const matched = compileAutoPickRule(rule).matches(modelId);
  return { matched, ms: performance.now() - started };
}

describe("auto-pick rules", () => {
  it("takes globs in any case and whole-name regular expressions as written", () => {
    expect(compileAutoPickRule("GPT-*").matches("gpt-5-mini")).toBe(true);
    expect(compileAutoPickRule("gpt-*").matches("o3")).toBe(false);
    expect(compileAutoPickRule("openrouter/*:free").matches("openrouter/llama:free")).toBe(true);
    expect(compileAutoPickRule("gpt-5.*").matches("gpt-5x1")).toBe(false);
    expect(compileAutoPickRule("re:m3\\d").matches("m30")).toBe(true);
    expect(compileAutoPickRule("re:m3\\d").matches("xm30")).toBe(false);
    // re: 照 magpie 区分大小写，要不分就写 (?i)。
    expect(compileAutoPickRule("re:gpt-5").matches("GPT-5")).toBe(false);
    expect(compileAutoPickRule("re:(?i)gpt-5").matches("GPT-5")).toBe(true);
  });

  it("turns away a model name, an empty expression, and one RE2 cannot read", () => {
    expect(autoPickRuleProblem("gpt-5")).toBe("not_rule");
    expect(autoPickRuleProblem("re: ")).toBe("empty_regex");
    expect(autoPickRuleProblem("re:(")).toBe("invalid_regex");
    // RE2 不支持反向引用与环视，和 magpie 一样编译不过。
    expect(autoPickRuleProblem("re:(a)\\1")).toBe("invalid_regex");
    expect(autoPickRuleProblem("re:gpt(?=-5)")).toBe("invalid_regex");
    expect(autoPickRuleProblem("re:(?<!x)gpt.*")).toBe("invalid_regex");
  });

  it("answers in linear time where a backtracking engine hangs", () => {
    const as = "a".repeat(40);
    const cases: [string, string, boolean][] = [
      [`re:${"[a]+".repeat(12)}`, `${as}b`, false],
      [`re:${".*".repeat(12)}z`, `${as}b`, false],
      [`re:${"(a|a)".repeat(30)}`, "a".repeat(29), false],
      ["*a*a*a*a*a*a*a*a*a*a*b", as, false],
      ["*a*a*a*a*a*a*a*a*a*a*b", `${as}b`, true],
      ["re:(a+)+b", `${as}c`, false],
      ["re:(a|aa)*b", `${as}b`, true],
      ["re:((ab)*c)+", "abcabc", true],
    ];
    for (const [rule, modelId, expected] of cases) {
      const { matched, ms } = timedMatch(rule, modelId);
      expect(matched, rule).toBe(expected);
      expect(ms, rule).toBeLessThan(100);
    }
  });
});
