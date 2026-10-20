import { RE2JS, RE2JSSyntaxException } from "re2js";
import { compileGlob, type GlobMatcher } from "./glob.js";

/*
 * 自动勾选规则（Auto-pick rules）的读法，daemon 校验与匹配、app 当场提示共用一份（照 magpie groupmatch.go）。
 * 规则是有 * 的 glob（* 任意一段字符，其余照字面、不分大小写），或 `re:` 开头、要整名匹配的正则（区分大小写，
 * 可写 (?i)）。两种都用 re2js 编译与匹配：和 magpie 的 Go regexp 是同一个 RE2，匹配时间随长度线性增长、不回溯，
 * 反向引用、环视这类 RE2 不支持的写法编译不过，和 magpie 一样当作读不懂。
 */

export const AUTO_PICK_REGEX_PREFIX = "re:";

export type AutoPickRuleProblem = "not_rule" | "empty_regex" | "invalid_regex";

export type AutoPickRuleMatcher = GlobMatcher;

/** 规则（已去掉首尾空白）有什么问题；能用时为 null。 */
export function autoPickRuleProblem(rule: string): AutoPickRuleProblem | null {
  if (!rule.startsWith(AUTO_PICK_REGEX_PREFIX)) return rule.includes("*") ? null : "not_rule";
  if (rule.slice(AUTO_PICK_REGEX_PREFIX.length).trim() === "") return "empty_regex";
  try {
    compileAutoPickRule(rule);
    return null;
  } catch (error) {
    if (error instanceof RE2JSSyntaxException) return "invalid_regex";
    throw error;
  }
}

/** 规则编译成匹配器；读不懂的 `re:` 抛 RE2JSSyntaxException，调用方先用 autoPickRuleProblem 确认过。 */
export function compileAutoPickRule(rule: string): AutoPickRuleMatcher {
  if (rule.startsWith(AUTO_PICK_REGEX_PREFIX)) {
    return RE2JS.compile(rule.slice(AUTO_PICK_REGEX_PREFIX.length));
  }
  // glob：* 之间的照字面，整名匹配、不分大小写（magpie 的 "(?i)^" + … + "$"）。
  return compileGlob({ glob: rule, isQuestionMarkAnyOne: false });
}
