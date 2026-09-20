# 发现记录（2026-09-17 访谈，2026-09-18 核对）

## 现状事实（2026-09-18 对照代码核实）

- 唯一 token 真源 `packages/app/src/styles/theme.ts`（865 行）：
  - `THEME_OPTIONS :760-811`：light / dark / auto（`group: "primary"`）+ zinc / midnight / claude / ghostty / pureBlack（`group: "variant"`）。每项带 `unistylesName`、`theme`、`swatch`。
  - `LightThemeConfig :206-228`（21 键，含 `primary` / `primaryForeground` / `ring` 必填），`DarkThemeConfig :338-358`（18 键，`foreground` / `ring` / `accentForeground` 可选）。
  - `buildLightSemanticColors :249` / `buildDarkSemanticColors :377`；`buildLightTheme :742` / `buildDarkTheme :680` 分别固定 `lightHighlightColors` / `darkHighlightColors` 与 `lightShadow` / `darkShadow`。
  - 派生表 `THEME_TO_UNISTYLES` / `THEME_SWATCHES` / `REGISTERED_THEMES :845-859` 全部由 `THEME_OPTIONS` 过滤生成；新变体只要进 `THEME_OPTIONS` 即自动注册到 Unistyles（`styles/unistyles.ts`）。
- **终端 ANSI 目前并非按变体派生**：`darkTerminalAnsi :360-376` / `lightTerminalAnsi :232-247` 是两套共享常量，`terminal.*` 里只有 `black` / `brightBlack` 来自 tint（`terminalBlack` / `terminalBrightBlack`），`background` / `foreground` / `cursor` / `cursorAccent` 由 surface0 / foreground 派生，`selectionBackground` 固定 rgba。要让 Dracula / Nord 的终端呈现各自配色，需要给 config 新增 ANSI 覆盖入口。
- 终端桥 `utils/to-xterm-theme.ts` 逐键透传 22 键到 xterm `ITheme`；`terminal/runtime/terminal-contrast.test.ts` 要求每个内置主题的 `background` / `foreground` 能被 `resolveTerminalMinimumContrastRatio` 判为浅色 4.5 / 深色 3，且浅色主题的 `white` / `brightWhite` 对终端底色 ≥ 3:1（`theme.ts:230` 注释：白底上 ANSI white 不能与底同色）。
- 设置：`AppSettings.theme: ThemePreference`（`hooks/use-settings/storage.ts:68`），schema `ThemePreferenceSchema :39-42` 由 `THEME_OPTIONS` 名字 + `"plugin"` 生成，`.catch("auto")`；`storage.test.ts:140` 用 `it.each(THEME_OPTIONS)` 逐项验证持久化。
- 应用：`appearance/provider.tsx:33-51` `applyTheme`——插件主题走 `updateTheme(pluginLight|pluginDark)`；`auto` 走 `setAdaptiveThemes(true)`，即 **Unistyles 自适应只在注册名 `light` / `dark` 两个槽位间切换**，无法直接指定"深色用 X / 浅色用 Y"。系统色彩方案已有 hook `hooks/use-color-scheme.ts`（web 版 hydration 前返回 light）。
- `appearance/apply.ts` 对 `REGISTERED_THEMES` 所有键 `updateTheme` 打字号 / 字体 / 语法色补丁，新变体自动纳入。
- 主题选择 UI `screens/settings/appearance/appearance-section.tsx:93-236`：`ThemeLeading` 对 light / dark / auto 用图标，其余用 `THEME_SWATCHES` 色点；下拉按 `option.group` 变化插分隔线；插件主题追加在末尾。标签 `getThemeLabel` 取 i18n `settings.appearance.theme.options.<name>`，9 个语言文件（en / zh-CN / ja / ko / fr / es / pt-BR / ru / ar，如 `en.ts:2305-2316`）都有该表。
- 快捷键循环 `app/_layout.tsx:472-474` → `getNextThemePreference :861`，当前按 `THEME_OPTIONS` 全表循环；`styles/theme.test.ts:27-41` 锁定表顺序与 `pureBlack → light`。
- 语法高亮主题独立（`packages/highlight/src/themes.ts`，8 套），不联动。
- `docs/design.md` §14：不得新增颜色 token 或写死 hex（主题定义文件本身是调色板，属允许范围）。`.atw/spec/app/frontend/styling.md` §"Theme values that leave the app" 记录终端色一次性快照与对比度规则。
- Orca 源码在本机：`~/Documents/Configuration/dev-environment/demo/源码/orca/src/renderer/src/lib/terminal-themes/`，`TerminalThemeMap = Record<string, ITheme>`，22 键。目标 13 套全部在：
  - `popular-dark-core.ts`：Dracula、One Dark、Nord、Tokyo Night、Gruvbox Dark、Catppuccin Mocha、Solarized Dark
  - `popular-dark-extended.ts`：Rose Pine
  - `popular-light.ts`：Solarized Light、One Light、Catppuccin Latte、GitHub Light、Rose Pine Dawn

## 已定决策（访谈）

- 做 UI 主题变体，不做独立终端调色板，不做 Warp / Ghostty 导入。
- 清单：深色 Dracula、Nord、Tokyo Night、Catppuccin Mocha、Gruvbox Dark、Solarized Dark、One Dark、Rosé Pine；浅色 Catppuccin Latte、Solarized Light、One Light、Rosé Pine Dawn、GitHub Light。现有变体保留。
- 下拉分组：主 / 深色变体 / 浅色变体，带色点。
- 语法高亮不联动。
- 跟随系统配对模型：保留单值 `theme` 下拉；`auto` 选中时新增"深色用 / 浅色用"两行，落到两个新字段（默认 dark / light），仅 auto 生效；直接选变体仍为固定深浅色。老数据无需迁移。
- 主题循环快捷键改为只在 light / dark / auto 三个主值间循环。

## 核对后补充的假设（进入 specify 时按此写 PRD，用户可推翻）

1. **ANSI 按变体派生的落地方式**：`LightThemeConfig` / `DarkThemeConfig` 新增可选 `terminalAnsi`（14 个彩色键）与可选 `terminalSelectionBackground`，未提供时沿用现有共享常量；13 套新变体全部提供，取 Orca 调色板值。现有 6 套主题不改。
2. **对比度优先于调色板原值**：UI `foreground` / `foregroundMuted` 可选调色板中更深 / 更亮的文本档位以满足 surface0 上 ≥ 4.5（浅）/ ≥ 3（深）；例：Solarized Light 原 foreground `#657b83` 对 `#fdf6e3` 约 4.0:1，UI 前景改用 base01 `#586e75`。终端 `foreground` 与 UI 一致；浅色变体的 `white` / `brightWhite` / 深色变体的 `black` 若与底色过近，按现有约定调到 ≥ 3:1，其余 ANSI 照抄。
3. **auto 配对的实现路线**：`auto` 时不再依赖 `setAdaptiveThemes(true)`，改为 `setAdaptiveThemes(false)` + 由 `useColorScheme()` 决定 `setTheme(darkFor | lightFor)`，系统切换实时生效。不采用覆写 `light` / `dark` 槽位内容的做法（会污染直接选 Light / Dark 的结果，且 `applyAppearance` 的 `...t` 补丁会把覆写固化）。
4. **新字段命名**：`autoDarkTheme: DarkThemeName`（默认 `"dark"`）、`autoLightTheme: LightThemeName`（默认 `"light"`），zod `.catch` 回默认；两行下拉只列内置变体，不含插件主题。
5. **下拉顺序**：主组 light / dark / auto；深色组先现有 5 套再按清单顺序 8 套；浅色组按清单顺序 5 套。`group` 从 `"variant"` 拆为 `"dark"` / `"light"`。
6. **快捷键**：当前值不在三主值内时下一项为 `light`。
7. **主题键名**（i18n key 与 `ThemeName`）：`dracula`、`nord`、`tokyoNight`、`catppuccinMocha`、`gruvboxDark`、`solarizedDark`、`oneDark`、`rosePine`、`catppuccinLatte`、`solarizedLight`、`oneLight`、`rosePineDawn`、`githubLight`；9 个语言文件标签用品牌原名（zh-CN 同现有 Zinc / Midnight 惯例）。
8. **色点**：取各调色板标志色（Dracula 紫、Nord 霜蓝、Gruvbox 橙等），在 PRD 里逐个列出。
