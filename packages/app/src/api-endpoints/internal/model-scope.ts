import type {
  ApiEndpoint,
  ApiEndpointModelScope,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";

/*
 * 服务范围与自动勾选规则的纯计算。daemon 定下在服务的模型（models）；这里只读范围、检查用户打的规则。
 * 规则照 daemon（magpie autolist.go）：有 * 的 glob，或 `re:` 开头的正则；没有 * 的是模型名，不是规则。
 * 正则读不读得懂由 daemon 说。
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
  | { kind: "notRule"; text: string };

/** 规则框里打的：去掉首尾空白；空的、已有的不加；不是规则的说明原因。 */
export function typedRuleOf(text: string, rules: readonly string[]): TypedRule {
  const rule = text.trim();
  if (rule === "") return { kind: "empty" };
  if (rules.includes(rule)) return { kind: "duplicate" };
  if (!rule.startsWith("re:") && !rule.includes("*")) return { kind: "notRule", text: rule };
  return { kind: "rule", rule };
}
