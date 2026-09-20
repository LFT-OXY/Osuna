import { describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import { THEME_OPTIONS } from "@/styles/theme";
import { collectBuiltInThemeNames } from "./theme-labels";

// 撞名判定拿这个集合对照插件主题名，所以它必须就是选择器画出来的那些文字 —— 少一行或多一行，
// 判定都会和用户看到的菜单脱节。
describe("collectBuiltInThemeNames", () => {
  // 未初始化的 i18n 会把 key 原样返回，那样集合里全是 key、谁都撞不上 —— 这是静默失效，要拦住。
  it("resolves every picker row to its own translated label", () => {
    const names = collectBuiltInThemeNames(i18n.t);

    expect(names.size).toBe(THEME_OPTIONS.length);
    expect([...names].filter((name) => name.startsWith("settings."))).toEqual([]);
  });

  it("carries the names a plugin theme can collide with today", () => {
    const names = collectBuiltInThemeNames(i18n.t);

    expect(names.has("Catppuccin Mocha")).toBe(true);
    expect(names.has("Catppuccin Latte")).toBe(true);
    expect(names.has("System")).toBe(true);
  });
});
