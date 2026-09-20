import { useMemo } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { THEME_OPTIONS } from "@/styles/theme";
import type { BuiltInThemePreference } from "./resolve-theme";

export function getBuiltInThemeLabel(t: TFunction, value: BuiltInThemePreference): string {
  return t(`settings.appearance.theme.options.${value}`);
}

/**
 * 主题选择器里内置主题当前显示的那套文字，"System" 那行也在内 —— 它同样占一行，插件主题
 * 叫这个名字一样分不清。插件主题的撞名判定拿这个集合做对照，所以两边必须是同一条解析
 * 路径：换了语言，菜单文字和判定一起变。
 */
export function collectBuiltInThemeNames(t: TFunction): ReadonlySet<string> {
  return new Set(THEME_OPTIONS.map((option) => getBuiltInThemeLabel(t, option.name)));
}

export function useBuiltInThemeNames(): ReadonlySet<string> {
  const { t } = useTranslation();
  return useMemo(() => collectBuiltInThemeNames(t), [t]);
}
