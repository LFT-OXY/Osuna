# 更多 UI 主题：新增深色与浅色变体

## Problem Statement

Paseo 的外观设置里只有 Light / Dark / System 三个主值和五套深色变体（Zinc、Midnight、Claude、Ghostty、Pure black），没有任何浅色变体。用户在其他终端和编辑器里习惯的 Dracula、Nord、Catppuccin、Solarized 等配色在 Paseo 里选不到，终端面板的 ANSI 色也永远是 Paseo 自己那一套，和用户的 shell 提示符、TUI 工具在别处的观感不一致。跟随系统时，Paseo 只会在默认 Light 与默认 Dark 之间切换，用户即便选了一个变体，一开"跟随系统"就被打回默认。

## Solution

在现有主题目录架构内新增 13 套完整 UI 主题变体：8 套深色（Dracula、Nord、Tokyo Night、Catppuccin Mocha、Gruvbox Dark、Solarized Dark、One Dark、Rosé Pine）与 5 套浅色（Catppuccin Latte、Solarized Light、One Light、Rosé Pine Dawn、GitHub Light）。每套变体带自己的界面表面、前景、强调色与整套终端 ANSI 调色板，来源为 Orca 终端调色板目录。主题下拉按"主值 / 深色变体 / 浅色变体"分三组并带色点。选择 System 时，用户可分别指定"系统为深色时用哪套、为浅色时用哪套"，系统切换时实时生效。主题循环快捷键只在 Light / Dark / System 三个主值之间轮转。

## User Stories

1. As a Paseo user, I want to pick Dracula, Nord, Tokyo Night, Catppuccin Mocha, Gruvbox Dark, Solarized Dark, One Dark or Rosé Pine as my app theme, so that Paseo matches the look I already use in my editor and terminal.
2. As a Paseo user, I want to pick Catppuccin Latte, Solarized Light, One Light, Rosé Pine Dawn or GitHub Light as a light app theme, so that I have light options beyond the single default Light.
3. As a Paseo user, I want every surface of the app (sidebar, workspace area, popovers, inputs, borders, diff backgrounds, status colors) to follow the variant I chose, so that no panel looks like it belongs to a different theme.
4. As a Paseo user, I want the terminal pane's background, foreground, cursor, selection and all 16 ANSI colors to come from the chosen variant's palette, so that my shell prompt and TUI tools render in the colors that palette is known for.
5. As a Paseo user, I want the daemon-side TUI color queries (background, foreground, cursor) to answer with the variant's colors, so that programs that ask the terminal what its colors are get the same palette the pane is drawing.
6. As a Paseo user, I want text in every new variant to stay readable (body text clears 4.5:1 on light, 3:1 on dark), so that a faithful palette never costs me legibility.
7. As a Paseo user, I want ANSI white / bright white on light variants and ANSI black on dark variants to remain visible against the terminal background, so that `ls` output and other ANSI-colored text never disappear.
8. As a Paseo user, I want the theme dropdown grouped as main values, dark variants and light variants with a separator between groups, so that I can find a variant without reading through a flat list of twenty entries.
9. As a Paseo user, I want each variant row in the dropdown to show a color dot in that palette's signature color, so that I can recognize a theme at a glance.
10. As a Paseo user, I want the theme trigger to show the selected variant's color dot and name, so that I can see which theme is active without opening the dropdown.
11. As a Paseo user, I want my existing choice of Zinc, Midnight, Claude, Ghostty or Pure black to keep working exactly as before after updating, so that the update does not change my setup.
12. As a Paseo user who follows the system appearance, I want to choose which dark variant and which light variant Paseo uses when the system is dark or light, so that "System" is not stuck on the two defaults.
13. As a Paseo user who follows the system appearance, I want those two choices to default to Dark and Light, so that "System" behaves as it does today until I change something.
14. As a Paseo user who follows the system appearance, I want the two "when dark / when light" rows to appear only while System is selected, so that they do not clutter the settings page when they have no effect.
15. As a Paseo user who follows the system appearance, I want the switch between my two chosen variants to happen the moment the OS appearance changes, so that I never have to reopen settings after sunset.
16. As a Paseo user, I want picking a variant directly from the dropdown to lock that variant regardless of system appearance, so that direct selection keeps its current meaning.
17. As a Paseo user, I want the "when dark" row to list only dark variants and the "when light" row only light variants, so that I cannot pair System-dark with a light palette by mistake.
18. As a Paseo user, I want the theme-cycle keyboard shortcut to rotate only through Light, Dark and System, so that one keypress never lands me on a random variant.
19. As a Paseo user on a variant, I want the theme-cycle shortcut to take me to Light first, so that the cycle has a predictable entry point.
20. As a Paseo user with a plugin-contributed theme selected, I want everything about plugin themes to work as before, so that this change does not touch plugin theme selection or rendering.
21. As a Paseo user in any of the nine supported languages, I want the new variant names and the two new rows labelled in my language, so that the settings page has no untranslated keys.
22. As a Paseo user whose stored settings mention a theme name that no longer exists or is malformed, I want the app to fall back to System without crashing, so that a bad value never blocks startup.
23. As a Paseo user, I want my syntax highlighting theme to stay whatever I set it to, so that a UI theme change never silently changes my code colors.
24. As a Paseo user on iOS, Android, browser web and Electron desktop, I want all of the above to behave identically, so that the theme catalog is one catalog everywhere.

## Implementation Decisions

### 主题目录

- 新变体全部进入既有的主题目录常量（下拉、快捷键、Unistyles 注册、设置 schema、色点表都由它派生），不新增第二个目录。
- 目录项的分组值由 `primary` / `variant` 两值改为 `primary` / `dark` / `light` 三值；分隔线逻辑不变（相邻项分组不同即插分隔线）。
- 目录顺序：主组 Light、Dark、System；深色组先现有五套（Zinc、Midnight、Claude、Ghostty、Pure black）再按清单顺序 Dracula、Nord、Tokyo Night、Catppuccin Mocha、Gruvbox Dark、Solarized Dark、One Dark、Rosé Pine；浅色组按清单顺序 Catppuccin Latte、Solarized Light、One Light、Rosé Pine Dawn、GitHub Light。
- 主题键名（同时作为设置值与 i18n 键）：`dracula`、`nord`、`tokyoNight`、`catppuccinMocha`、`gruvboxDark`、`solarizedDark`、`oneDark`、`rosePine`、`catppuccinLatte`、`solarizedLight`、`oneLight`、`rosePineDawn`、`githubLight`。Unistyles 注册名沿用 `dark<Name>` / `light<Name>` 前缀惯例。
- 从目录派生出两个窄类型：深色主题名集合与浅色主题名集合（按目录项的 `colorScheme` 判定），供"跟随系统"两个字段使用。

### 配色定义

- 现有 `DarkThemeConfig` / `LightThemeConfig` 各新增两个可选字段：`terminalAnsi`（14 个彩色 ANSI 键：red…white、brightRed…brightWhite）与 `terminalSelectionBackground`。未提供时沿用今天的共享常量与 rgba 选区色；13 套新变体全部提供，值取自 Orca 调色板目录对应条目。现有六套主题的定义不改。
- 终端 `background` / `foreground` / `cursor` / `cursorAccent` 继续由 surface0 与 foreground 派生，保持终端桥要求的纯 `#rrggbb`。
- 每套变体的界面表面从该调色板自己的层级取值：surface0 = 调色板 background；surface1–4 与 sidebar 用调色板定义的相邻层级（如 Catppuccin 的 mantle / crust / surface0–2、Nord 的 Polar Night 四阶、Rosé Pine 的 surface / overlay / highlight、Solarized 的 base02 / base01），没有现成层级的按现有变体的明度步进插值。
- 对比度优先于原值：界面 foreground 与 foregroundMuted 取调色板中能在 surface0 上达到 4.5:1（浅）/ 3:1（深）的文本档位；调色板没有达标的 muted 档位时按明度插值（Dracula、Nord 的 foregroundMuted 即插值）。已知需要偏离的：Solarized Light 三个文本档整体下移一档，界面前景用 base02（`#073642`）、muted 用 base01（`#586e75`）、extraMuted 用 base00（`#657b83`）——调色板 foreground base00 在 base3 上只有 4.0:1，若只把前景提到 base01，muted 就没有既 ≥ 4.5:1 又与前景拉开层级的档位。其余 12 套的界面前景与调色板 foreground 一致。
- 浅色变体的 ANSI `white` / `brightWhite` / `black` / `brightBlack` 必须对终端底色 ≥ 3:1，与现有 Light 主题的约定一致（Rosé Pine Dawn、GitHub Light 的 brightBlack 原值只有约 2.6–2.9:1，改用各自调色板的 subtle / muted 档）；调色板原值达不到时改用该调色板最接近的灰阶（例如 Catppuccin Latte 的 white 用 overlay 档位，One Light / GitHub Light 的 brightWhite 用比 white 更亮但仍 ≥ 3:1 的灰）。深色变体的 14 个彩色 ANSI 键全部照抄调色板。
- `black` / `brightBlack` 不在 `terminalAnsi` 里，仍来自 `terminalBlack` / `terminalBrightBlack`：调色板的 ANSI black 常与底色同阶（Gruvbox、One Dark 的 black 就是背景色），照抄会让 ANSI 黑字消失。新增深色变体取调色板中最接近的灰阶，使 black ≥ 1.5:1、brightBlack ≥ 2:1；现有六套深色主题维持原状，测试把它们列为例外，之后新增的深色变体自动受此约束。
- 各变体的 accent / accentBright / 色点（accent 为主强调色，accentBright 为其亮档；色点为下拉里的标志色）：

| 变体             | accent    | accentBright | 色点      |
| ---------------- | --------- | ------------ | --------- |
| Dracula          | `#bd93f9` | `#d6acff`    | `#bd93f9` |
| Nord             | `#81a1c1` | `#88c0d0`    | `#88c0d0` |
| Tokyo Night      | `#7aa2f7` | `#7dcfff`    | `#7aa2f7` |
| Catppuccin Mocha | `#cba6f7` | `#b4befe`    | `#cba6f7` |
| Gruvbox Dark     | `#d79921` | `#fabd2f`    | `#fe8019` |
| Solarized Dark   | `#268bd2` | `#2aa198`    | `#268bd2` |
| One Dark         | `#61afef` | `#56b6c2`    | `#61afef` |
| Rosé Pine        | `#c4a7e7` | `#ebbcba`    | `#ebbcba` |
| Catppuccin Latte | `#8839ef` | `#7287fd`    | `#8839ef` |
| Solarized Light  | `#268bd2` | `#2aa198`    | `#cb4b16` |
| One Light        | `#4078f2` | `#0184bc`    | `#4078f2` |
| Rosé Pine Dawn   | `#907aa9` | `#d7827e`    | `#d7827e` |
| GitHub Light     | `#0366d6` | `#005cc5`    | `#0366d6` |

- accentForeground 按亮度选深浅文字色，与现有 Zinc 的处理一致；destructive 取调色板 red 的 UI 档。语法高亮色与阴影沿用 buildDarkTheme / buildLightTheme 固定值，不随变体变化。

### 跟随系统

- `AppSettings` 新增 `autoDarkTheme`（深色主题名，默认 `dark`）与 `autoLightTheme`（浅色主题名，默认 `light`）。设置 schema 用目录派生的枚举校验，非法值 catch 回默认；老数据无需迁移。
- 外观 provider 里的应用逻辑改为：插件主题路径不变；`theme` 为 System 时不再打开 Unistyles 自适应，而是关闭自适应并按系统色彩方案（复用现有 `useColorScheme` hook）在两个字段之间选一个具体主题 `setTheme`；`theme` 为具体主题时行为不变。系统色彩方案变化触发重新应用。
- "选哪个具体主题"抽成一个纯函数：输入 preference、autoDarkTheme、autoLightTheme、系统色彩方案，输出 Unistyles 主题名或"插件主题"。provider 只负责调用它并同步到运行时。
- 不采用"覆写 light / dark 两个注册槽位内容"的做法：会污染直接选 Light / Dark 的结果，且字号补丁会把覆写固化。
- Web 端 `useColorScheme` 在 hydration 前返回 light；provider 的应用 effect 在挂载后运行，因此首帧后会以真实值再应用一次，可接受。

### 设置页

- 主题行下拉不变形态；选中 System 时在其下方紧邻出现两行："系统为深色时"（只列深色变体，含 Dark）与"系统为浅色时"（只列浅色变体，含 Light），使用同一套下拉、色点与标签组件。选中非 System 时两行不渲染。"选中 System"按 app 实际渲染的偏好判定：存储值为插件主题但该插件已卸载时，主题行显示 System，两行同样出现。
- 两行的主题标签复用现有 `settings.appearance.theme.options.<name>`；两行的标题新增 i18n 键 `settings.appearance.theme.autoDark.title` 与 `settings.appearance.theme.autoLight.title`。
- 九个语言文件（en、zh-CN、ja、ko、fr、es、pt-BR、ru、ar）都补 13 个变体标签与 2 个行标题；变体标签用品牌原名（Dracula、Nord、Tokyo Night、Catppuccin Mocha、Gruvbox Dark、Solarized Dark、One Dark、Rosé Pine、Catppuccin Latte、Solarized Light、One Light、Rosé Pine Dawn、GitHub Light），行标题按语言翻译。

### 快捷键

- 主题循环函数只在 Light → Dark → System → Light 间轮转；当前值不在三者之内（任何变体或插件主题）时返回 Light。

### 文档

- `.atw/spec/app/frontend/styling.md` 中"浅色调色板 white / brightWhite 需 ≥ 3:1"的说明扩展为覆盖全部浅色变体，并记录 `terminalAnsi` 覆盖入口的存在与"未提供即共享常量"的规则。

## Testing Decisions

- 好的测试只断言外部可观察行为：目录顺序与分组、每个变体产出的终端调色板与对比度、设置值的持久化与回退、给定输入下应用到运行时的主题名。不断言 hex 的具体来源，不 mock Unistyles 之外的内部模块。
- 测试缝（seam）自高到低，全部复用既有测试文件与既有 Node 运行方式：
  1. **主题目录**（`styles/theme.test.ts` 既有套件）：目录顺序与三组分组；13 套新变体的 `colorScheme` 与分组一致；提供了 `terminalAnsi` 的变体其终端 14 色等于所提供值，未提供的变体仍等于共享常量；快捷键循环的三值轮转与"变体 → Light"。
  2. **终端对比度**（`terminal/runtime/terminal-contrast.test.ts` 既有套件，已遍历整个目录）：扩展为对每个浅色主题断言 white / brightWhite / black / brightBlack ≥ 3:1，对现有六套之外的每个深色主题断言 black ≥ 1.5:1、brightBlack ≥ 2:1，对每个主题断言 foreground 与 foregroundMuted 对 surface0 的最低比值（浅 4.5 / 深 3），断言终端 background / foreground / cursor 为纯 `#rrggbb`。
  3. **设置存储**（`hooks/use-settings/storage.test.ts` 既有套件，已 `it.each` 目录）：新字段的默认值、持久化往返、非法值回退；`theme` 存入任一新变体名可正确加载。
  4. **主题解析纯函数**（新增，放在外观模块旁，随 provider 一起）：System + 深色系统 → autoDarkTheme 的注册名；System + 浅色系统 → autoLightTheme 的注册名；具体主题 → 其注册名；插件主题 → 插件路径。这是本任务唯一新增的缝，选在 provider 与 Unistyles 运行时之间，使 provider 本身无需渲染测试。
- 先例：`styles/theme.test.ts` 的 "Theme catalog" 与 "Pure black theme" 描述块；`terminal-contrast.test.ts` 的 "matches the ratio every built-in theme resolves to"；`storage.test.ts` 的 "loads the persisted $name theme"。
- 设置页两行的显隐与列表过滤不写渲染测试，按 `docs/qa.md` 在 dev 桌面端手测并留证据（2026-09-18 已用 Playwright 连 Electron 远程调试端口走完：三组分隔与色点、选 System 出现两行、深色行只列深色、浅色行只列浅色、直接选 Nord 整站换色）；终端 ANSI 观感用 Pi / opencode 的 TUI 验收（Codex / Claude Code 不订阅色彩查询，见记忆），本次未做。

## Out of Scope

- 独立于 UI 主题的终端调色板选择；Warp / Ghostty / iTerm 配色文件导入。
- 语法高亮主题与 UI 主题联动。
- Orca 目录里清单之外的调色板（Monokai、Kanagawa、Everforest、Gruvbox Light、Tokyo Night Light 等）。
- 插件主题体系的任何改动（配对槽位、贡献 schema、选择逻辑）。
- 旧设置数据迁移；主题相关协议或 daemon 改动。
- 自定义 / 用户编辑主题。

## Further Notes

- 调色板来源为本机 Orca 源码 `src/renderer/src/lib/terminal-themes/popular-dark-core.ts`、`popular-dark-extended.ts`、`popular-light.ts`（Record<string, xterm ITheme>，22 键），已在 `research/discovery.md` 记录路径与核实结论。
- 现有 `Theme` 类型是目录中所有主题对象的联合；新增 13 套后联合变大，但各主题对象结构相同（配置值均为 `string`），预期不影响 typecheck 时长。若出现异常，优先收窄联合而不是复制类型。
- `docs/design.md` §14 禁止的是在组件里写死 hex，主题定义文件本身是调色板，属允许范围。
- 由于外观 provider 改为手动 `setTheme`，Unistyles 配置里的 `adaptiveThemes: true` 初始值只影响首帧到 provider 生效前的短暂窗口；实现时保留该初始值以避免首帧闪白，provider 生效后由其接管。
