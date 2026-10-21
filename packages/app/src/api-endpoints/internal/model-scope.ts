import {
  autoPickRuleProblem,
  type AutoPickRuleProblem,
} from "@getpaseo/protocol/api-endpoint/auto-pick-rules";
import type {
  ApiEndpoint,
  ApiEndpointModelScope,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";

/*
 * 服务范围与自动勾选规则的纯计算。daemon 定下在服务的模型（models）；这里只读范围、检查用户打的规则。
 * 规则和 daemon 用同一份检查（protocol 的 auto-pick-rules.ts）：有 * 的 glob，或 `re:` 开头、RE2 读得懂的正则。
 */

// 「跟随接口清单」在服务的上限（daemon model-scope.ts 的 SERVED_LIST_LIMIT，照 magpie manyModels）。
export const SERVED_LIST_LIMIT = 24;

/** 没有或不认识的范围都当「只用挑选的」，和 daemon 一样。 */
export function modelScopeOf(endpoint: Pick<ApiEndpoint, "modelScope">): ApiEndpointModelScope {
  return endpoint.modelScope === "vendor" ? "vendor" : "picked";
}

export type TypedRule =
  | { kind: "rule"; rule: string }
  | { kind: "empty" }
  | { kind: "duplicate" }
  | { kind: "problem"; text: string; problem: AutoPickRuleProblem };

/** 规则问题的文案键，在 settings.apiEndpoints.modelScope.rules.problem 下。 */
export const RULE_PROBLEM_KEYS: Record<AutoPickRuleProblem, string> = {
  not_rule: "notRule",
  empty_regex: "emptyRegex",
  invalid_regex: "invalidRegex",
};

/** 规则框里打的：去掉首尾空白；空的、已有的不加；不能用的说明原因。 */
export function typedRuleOf(text: string, rules: readonly string[]): TypedRule {
  const rule = text.trim();
  if (rule === "") return { kind: "empty" };
  if (rules.includes(rule)) return { kind: "duplicate" };
  const problem = autoPickRuleProblem(rule);
  if (problem !== null) return { kind: "problem", text: rule, problem };
  return { kind: "rule", rule };
}
