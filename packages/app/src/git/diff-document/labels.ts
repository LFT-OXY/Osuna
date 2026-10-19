import type { TFunction } from "i18next";
import type { BuildDiffDocumentModelInput } from "./types";

// 千分位与文件头的增删行数一致，固定按 en-US 分组。
const lineCountFormatter = new Intl.NumberFormat("en-US");

/** diff 文档模型里用到的翻译文案；web 与原生 surface 共用。 */
export function diffDocumentLabels(t: TFunction): BuildDiffDocumentModelInput["labels"] {
  return {
    binary: t("workspace.git.diff.binaryFile"),
    tooLarge: t("workspace.git.diff.tooLarge"),
    unmodifiedLines(count) {
      if (count === 1) return t("workspace.git.diff.unmodifiedLine", { count });
      return t("workspace.git.diff.unmodifiedLines", { count });
    },
    linesChanged(count) {
      return t("workspace.git.diff.linesChanged", { lines: lineCountFormatter.format(count) });
    },
  };
}
