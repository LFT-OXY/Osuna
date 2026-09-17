# 发现记录（2026-09-17 访谈）

## 现状事实

- 唯一 token 真源 `packages/app/src/styles/theme.ts`：`THEME_OPTIONS :760-811`（light/dark/auto + zinc/midnight/claude/ghostty/pureBlack），`DarkThemeConfig :340-358`（18 键），`LightThemeConfig :208-230`，终端色 `colors.terminal` 随主题派生（`to-xterm-theme.ts`），终端主题桥要求 foreground/background/cursor 为纯 `#rrggbb`。
- 设置：`AppSettings.theme: ThemePreference`（`hooks/use-settings/storage.ts:68`），应用 `appearance/provider.tsx:33-51`（auto → `setAdaptiveThemes(true)`）。插件主题已有 `pluginLight/pluginDark` 配对槽位。
- 语法高亮主题独立（`packages/highlight/src/themes.ts`，8 套）。
- `docs/design.md` §14：不得新增颜色 token 或写死 hex。
- Orca：UI 仅 system/dark/light；30 套终端调色板在 `src/renderer/src/lib/terminal-themes/*.ts`（22 键：background/foreground/cursor/cursorAccent/selection\* + ANSI 16）。

## 已定决策

- 做 UI 主题变体，不做独立终端调色板，不做 Warp/Ghostty 导入。
- 清单：深色 Dracula、Nord、Tokyo Night、Catppuccin Mocha、Gruvbox Dark、Solarized Dark、One Dark、Rosé Pine；浅色 Catppuccin Latte、Solarized Light、One Light、Rosé Pine Dawn、GitHub Light。现有变体保留。
- 下拉分组：主 / 深色变体 / 浅色变体，带色点。
- 语法高亮不联动。
- 跟随系统时应在用户指定的深色主题与浅色主题之间切换（待定模型，见访谈第三轮）。
- 跟随系统配对模型：保留单值 `theme` 下拉；`auto` 选中时新增"深色用 / 浅色用"两行，落到两个新字段（默认 dark / light），仅 auto 生效；直接选变体仍为固定深浅色。老数据无需迁移。
- 主题循环快捷键（`_layout.tsx:472` → `getNextThemePreference`）改为只在 light / dark / auto 三个主值间循环。
