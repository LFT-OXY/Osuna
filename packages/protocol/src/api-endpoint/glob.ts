import { RE2JS } from "re2js";

/*
 * 用户写的 glob（自动勾选规则、已禁用的模型）一律经 re2js 编译：匹配时间随长度线性增长、不回溯，
 * 不会被 `*a*a*a*b` 这样的式子卡住（.atw/spec/server/backend/quality-guidelines.md）。
 */

export interface GlobMatcher {
  // 整个名字都要匹配。
  matches(name: string): boolean;
}

/**
 * glob 编译成整名匹配、不分大小写的匹配器：* 是任意一段字符（斜杠也算），isQuestionMarkAnyOne 时 ? 是任意一个字符
 * （已禁用的模型，照 magpie globMatch），否则照字面（自动勾选规则，照 magpie groupmatch）；其余照字面。
 * DOTALL 让 * 与 ? 也跨过换行；模型名里从没有换行，所以对自动勾选规则的结果没有影响。
 */
export function compileGlob(input: { glob: string; isQuestionMarkAnyOne: boolean }): GlobMatcher {
  const literal = (part: string) => (part === "" ? "" : RE2JS.quote(part));
  const quoted = (part: string) =>
    input.isQuestionMarkAnyOne ? part.split("?").map(literal).join(".") : literal(part);
  const pattern = input.glob.split("*").map(quoted).join(".*");
  return RE2JS.compile(pattern, RE2JS.CASE_INSENSITIVE | RE2JS.DOTALL);
}
