/*
 * 自动勾选规则（Auto-pick rules）的读法，daemon 校验与匹配、app 当场提示共用一份（照 magpie groupmatch.go）。
 * 规则是有 * 的 glob（* 任意一段字符，其余照字面、不分大小写），或 `re:` 开头、要整名匹配的正则。
 * magpie 用 Go 的 RE2，匹配时间随长度线性增长；JS 正则会回溯，所以这里在保存前拒收会回溯爆炸的写法：
 * 反向引用、环视、被量词修饰的组里还有量词或 |，以及超过长度上限的规则。
 */

export const AUTO_PICK_REGEX_PREFIX = "re:";
export const AUTO_PICK_RULE_MAX_LENGTH = 200;

export type AutoPickRuleProblem =
  | "not_rule"
  | "too_long"
  | "empty_regex"
  | "invalid_regex"
  | "backreference"
  | "lookaround"
  | "nested_quantifier";

/** 规则（已去掉首尾空白）有什么问题；能用时为 null。 */
export function autoPickRuleProblem(rule: string): AutoPickRuleProblem | null {
  if (rule.length > AUTO_PICK_RULE_MAX_LENGTH) return "too_long";
  if (!rule.startsWith(AUTO_PICK_REGEX_PREFIX)) return rule.includes("*") ? null : "not_rule";
  const source = rule.slice(AUTO_PICK_REGEX_PREFIX.length);
  if (source.trim() === "") return "empty_regex";
  const unsafe = backtrackingProblem(source);
  if (unsafe) return unsafe;
  return readsAsRegExp(source) ? null : "invalid_regex";
}

function readsAsRegExp(source: string): boolean {
  try {
    return new RegExp(source) instanceof RegExp;
  } catch (error) {
    if (error instanceof SyntaxError) return false;
    throw error;
  }
}

/** 能用的规则读成正则；调用方先用 autoPickRuleProblem 确认过。 */
export function autoPickRuleRegExp(rule: string): RegExp {
  if (rule.startsWith(AUTO_PICK_REGEX_PREFIX)) {
    return new RegExp(`^(?:${rule.slice(AUTO_PICK_REGEX_PREFIX.length)})$`);
  }
  // 连着的 * 并成一个，免得 .*.* 回溯。
  const parts = rule
    .replace(/\*+/g, "*")
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^${parts.join(".*")}$`, "i");
}

interface GroupScan {
  hasQuantifier: boolean;
  hasAlternation: boolean;
}

interface ScanState {
  groups: GroupScan[];
  // 刚关上的组：紧跟量词时看它里面有没有量词或 |。
  closed: GroupScan | null;
  inClass: boolean;
}

/** 扫一遍正则源码，找会让回溯爆炸的写法；字符类与转义里的符号不算。 */
function backtrackingProblem(source: string): AutoPickRuleProblem | null {
  const state: ScanState = {
    groups: [{ hasQuantifier: false, hasAlternation: false }],
    closed: null,
    inClass: false,
  };
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] ?? "";
    if (char === "\\") {
      const next = source[index + 1] ?? "";
      if (!state.inClass && (/[1-9]/.test(next) || next === "k")) return "backreference";
      index += 1;
      state.closed = null;
      continue;
    }
    if (state.inClass) {
      if (char === "]") state.inClass = false;
      continue;
    }
    const problem = scanChar({ state, char, rest: source.slice(index + 1) });
    if (problem) return problem;
  }
  return null;
}

function scanChar(input: {
  state: ScanState;
  char: string;
  rest: string;
}): AutoPickRuleProblem | null {
  const { state, char } = input;
  const current = state.groups[state.groups.length - 1];
  if (!current) return "invalid_regex";
  switch (char) {
    case "[":
      state.inClass = true;
      break;
    case "(":
      if (/^\?(=|!|<=|<!)/.test(input.rest)) return "lookaround";
      state.groups.push({ hasQuantifier: false, hasAlternation: false });
      break;
    case ")":
      return closeGroup(state);
    case "|":
      current.hasAlternation = true;
      break;
    case "*":
    case "+":
    case "{": {
      const closed = state.closed;
      if (closed && (closed.hasQuantifier || closed.hasAlternation)) return "nested_quantifier";
      current.hasQuantifier = true;
      break;
    }
    default:
      break;
  }
  state.closed = null;
  return null;
}

function closeGroup(state: ScanState): AutoPickRuleProblem | null {
  const group = state.groups.pop();
  const parent = state.groups[state.groups.length - 1];
  if (!group || !parent) return "invalid_regex";
  if (group.hasQuantifier) parent.hasQuantifier = true;
  state.closed = group;
  return null;
}
