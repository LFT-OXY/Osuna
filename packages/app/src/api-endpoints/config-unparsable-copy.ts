import type { TFunction } from "i18next";
import { shortenPath } from "@/utils/shorten-path";

/*
 * 「读不懂的配置文件」用界面语言说明原因：主机给了结构化的 reason（Claude Code 的 settings.json）就翻译它，
 * 没有（Codex 的 config.toml、老主机）就照旧显示文件与解析器原文。提示区和打开开关失败时共用。
 */
export function describeUnparsableFile(t: TFunction, params: Record<string, string>): string {
  const { detail, reason, line, column, key } = params;
  // 主目录缩写成 ~，路径短一些。
  const file = shortenPath(params.file);
  switch (reason) {
    case "syntax":
      return t("settings.apiEndpoints.agent.issues.unparsableSyntax", { file, line, column });
    case "root_not_object":
      return t("settings.apiEndpoints.agent.issues.unparsableRootNotObject", { file });
    case "key_not_object":
      return t("settings.apiEndpoints.agent.issues.unparsableKeyNotObject", { file, key });
    case "key_not_array":
      return t("settings.apiEndpoints.agent.issues.unparsableKeyNotArray", { file, key });
    default:
      return t("settings.apiEndpoints.agent.issues.configUnparsableDetail", { file, detail });
  }
}
