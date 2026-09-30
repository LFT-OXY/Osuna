# 设置 → 主机 → Providers 页 UI 取值（1:1 复刻用）

所有路径相对 `packages/app/src/`，除非另注。值均从源码解析到字面量；派生色用源码里同一套算法（`utils/color.ts` 的 `mixHexColor` / `hexColorWithAlpha` / `ensureDistinctRowColor`）重算，并与 `styles/theme.test.ts:281-300` 的断言核对一致。

目标平台假设：Web / Electron 桌面（`md` 断点及以上）。紧凑布局单列在各节末尾。

---

## 0. 全局前提

| 项 | 值 | 来源 |
|---|---|---|
| 默认主题偏好 | `"auto"`（跟随系统；系统暗 → `dark`，系统亮 → `light`） | `hooks/use-settings/storage.ts:48-51` |
| 默认亮色主题 | `lightTheme`（unistyles 名 `light`） | `styles/theme.ts:1387`, `1615-1622` |
| 默认暗色主题 | `darkTheme`（unistyles 名 `dark`） | `styles/theme.ts:999`, `1623-1629` |
| 界面基础字号（Web） | 14（`FONT_SIZE.base`），所以 `typeScale` 取作者值不缩放；原生默认 15 | `hooks/use-settings/storage.ts:57-61` |
| 正文字号（Web） | 15（`FONT_SIZE.content`）；原生 16 | `storage.ts:64-68` |
| 代码字号 | 12 | `storage.ts:93`、`theme.ts:811` |
| 断点 | `xs 0 / sm 576 / md 720 / lg 992 / xl 1200` | `styles/unistyles.ts:6-12` |
| 紧凑判定 | `breakpoint === "xs" \|\| "sm"`，即窗口宽 < 720 | `constants/layout.ts:42-45` |
| 响应式值写法 | `{ xs: 紧凑值, md: 桌面值 }`，≥720 取 `md` | 各组件 |
| 用户改界面字号时 | `typeScale` 与 `fontSize`（除 `content`/`code`）按 `uiBase/14` 等比、四舍五入 | `appearance/apply.ts:27-65` |

---

## 1. 主题 token

### 1.1 颜色（默认亮 / 默认暗）

定义：亮 `styles/theme.ts:533-565`（经 `buildLightSemanticColors` `472-529`），暗 `styles/theme.ts:681-710`（经 `buildDarkSemanticColors` `613-673`）。派生角色 `deriveThemeRoles` `293-372`、`deriveOverlayRoles` `387-405`。

| token | light | dark | 备注 / 来源 |
|---|---|---|---|
| surface0 | `#fcfcfc` | `#0a0a0a` | 538 / 684（设置页底色、ScreenHeader 底色） |
| surface1 | `#fafafa` | `#111111` | 539 / 685 |
| surface2 | `#f4f4f5` | `#171717` | 540 / 686 |
| surface3 | `#e4e4e7` | `#262626` | 541 / 687 |
| surface4 | `#d4d4d8` | `#525252` | 542 / 688 |
| surfaceSidebar | `#fafafa` | `#000000` | 533,544 / 681,690 |
| surfaceCard | `#ffffff` | `#111111` | 545 / 692 |
| surfaceGlass | `rgba(255, 255, 255, 0.8)` | `rgba(17, 17, 17, 0.8)` | surfaceCard × 0.8，`397`、`266` |
| surfaceDialogFooter | `rgba(244, 244, 245, 0.7)` | `rgba(23, 23, 23, 0.7)` | surface2 × 0.7，`398`、`267` |
| surfaceWarning | `rgba(245, 158, 11, 0.1)` | 同左 | amber500 × 0.1，`400`、`268` |
| surfaceSidebarHover | `#f1f1f1` | `#0a0a0a` | mix(侧栏, 黑 3.5%) / mix(黑, 白 4%)，`547` / `694` |
| surfaceSidebarActive（按下） | `#e3e3e3` | `#1a1a1a` | 派生，`311-318` |
| surfaceSidebarSelected | `#eaeaea` | `#131313` | `536,548` / `682,695` |
| borderSidebarSelected | `#dadada` | `#212121` | `549` / `696` |
| border | `#e4e4e7` | `#191919` | 554 / 701 |
| borderAccent | `#d4d4d8` | `#262626` | 555 / 703 |
| borderInput | `#d4d4d8` | `#1e1e1e` | 550 / 697 |
| borderCardRow | `rgba(228, 228, 231, 0.5)` | `rgba(25, 25, 25, 0.5)` | border × 0.5，`358`、`260` |
| foreground | `#27272a` | `#f5f5f5` | 534 / 698 |
| foregroundMuted | `#71717b` | `#818181` | 552 / 699 |
| foregroundExtraMuted | `#a1a1aa` | `#555555` | 553 / 700 |
| accent | `#1b4ed8` | `#346bf1` | 556 / 704 |
| accentBright | `#3160db` | `#51a2ff` | 557 / 705 |
| accentForeground | `#ffffff` | `#ffffff` | 558 / 636（暗色缺省值） |
| destructive | `#c10007` | `#c44a4a` | 561 / 706 |
| destructiveForeground | `#fcfcfc`（= surface0） | `#ffffff` | 496 / 639 |
| interactionHighlight | `rgba(0, 0, 0, 0.06)` | `rgba(255, 255, 255, 0.08)` | 482 / 625 |
| ring | `#1b4ed8` | `#346bf1` | 564 / 709 |
| statusSuccess | `#3e704a` | `#6cb17b` | 150 / 158 |
| statusDanger | `#9d433b` | `#d8847b` | 151 / 159 |
| statusWarning | `#7b5d39` | `#c09664` | 152 / 160 |
| statusMerged | `#7347af` | `#a890d5` | 153 / 161 |
| statusDotSuccess/Danger/Warning/Running | `#299f51` / `#f12e2f` / `#b37824` / `#268ae0` | `#35c264` / `#f7796d` / `#db932e` / `#5caaf6` | 194-197 / 202-205（**Providers 页的状态点不用这组**，用 status*） |
| overlayScrim | `rgba(0, 0, 0, 0.18)` | `rgba(0, 0, 0, 0.35)` | 401 |
| shadowPopover | `rgba(0, 0, 0, 0.35)` | `rgba(0, 0, 0, 0.8)` | 402 |
| shadowDialog | `rgba(0, 0, 0, 0.45)` | `rgba(0, 0, 0, 0.9)` | 403 |
| shadowComposer | `rgba(0, 0, 0, 0.4)` | `transparent` | 367、256 |
| insetHighlight | `transparent` | `rgba(255, 255, 255, 0.04)` | 368、253 |
| borderComposer | `rgba(39, 39, 42, 0.09)` | `rgba(245, 245, 245, 0.09)` | 366 |
| surfaceTabHover / Active | `#f1f1f2` / `#eaeaea` | `#161616` / `#1c1c1c` | 327-336 |

调色板（两主题相同，`theme.ts:6-110`）：`white #ffffff`(8)、`zinc[600] #52525b`(19)、`red[300] #fca5a5`(78)、`amber[500] #f59e0b`(90)、`blue[300] #93c5fd`(51)、`green[500] #22c55e`(66)。

### 1.2 间距 `SPACING`（`theme.ts:793-808`）

`0:0, 0.5:2, 1:4, 1.5:6, 2:8, 3:12, 4:16, 6:24, 8:32, 12:48, 16:64, 20:80, 24:96, 32:128`

### 1.3 圆角

- `radius`（重设计梯度，`theme.ts:884-892`）：`sm 6, md 8, lg 10, xl 14, 2xl 18, 3xl 22, full 9999`
- `borderRadius`（旧梯度，`theme.ts:871-880`）：`none 0, sm 2, base 4, md 6, lg 8, xl 12, 2xl 16, full 9999`
- 注意两套同名键数值不同：`radius.md = 8`，`borderRadius.md = 6`；`radius.xl = 14`，`borderRadius.xl = 12`。

### 1.4 字号 / 字重 / 行高

- `fontSize`（`theme.ts:810-820`）：`code 12, content 15, sm 12, base 14, lg 16, xl 18, 2xl 20, 3xl 22, 4xl 26`
- `fontWeight`（`theme.ts:864-869`）：`normal "normal"(400), medium "500", semibold "600", bold "bold"(700)`
- `lineHeight.diff 22`（`822-824`）
- `typeScale`（`theme.ts:829-840`，无 letterSpacing，所有档位不带字重；字重由调用方给）：

| variant | fontSize | lineHeight |
|---|---|---|
| micro | 11 | 15 |
| caption | 12 | 16 |
| label | 13 | 18 |
| body | 14 | 20 |
| body-lg | 15 | 22 |
| title-sm | 16 | 24 |
| title | 18 | 28 |
| title-lg | 20 | 28 |
| display | 24 | 32 |
| prose | 14 | 22 |

- 未显式给 `lineHeight` 的 RN `<Text>`（如 Button 文字、ScreenTitle、SheetHeader 标题、menu 标签等）：react-native-web 给 Text 设 `font: '14px System'`（`node_modules/react-native-web/dist/exports/Text/index.js:150`），简写会把 line-height 重置为 `normal`，之后只覆盖了 font-size，所以行高是浏览器 `normal`（系统字体约 1.2 倍）。原型里写 `line-height: normal`。

### 1.5 其他尺寸 token

- `ICON_SIZE`（`theme.ts:857-862`）：`xs 12, sm 14, md 16, lg 20`
- `CONTROL_HEIGHT`（`theme.ts:895-899`）：`sm 24, md 28, lg 32`
- `BORDER_WIDTH`：`0/1/2`（`901-905`）；`OPACITY`：`0, 50:0.5, 100:1`（`907-911`）
- 紧凑触控高度（`components/ui/control-geometry.ts:25-58`）：`tight 28, compact 32, field 44`；`HEADER_CONTROL_HEIGHT 26`（28 行）

### 1.6 阴影（`theme.ts:962-981` 暗、`1352-1371` 亮；RN-web 转为 `box-shadow: 0 {h}px {r}px {color}`）

| | light | dark |
|---|---|---|
| sm | `0 2px 8px rgba(0,0,0,0.02)` | `0 2px 4px rgba(0,0,0,0.25)` |
| md | `0 4px 16px rgba(0,0,0,0.04)` | `0 4px 8px rgba(0,0,0,0.20)` |
| lg | `0 8px 24px rgba(0,0,0,0.08)` | `0 12px 24px rgba(0,0,0,0.40)` |

浮层专用阴影直接写成 CSS `boxShadow`（见 §5.8、§5.9）。

### 1.7 字体栈

- UI（Web/Electron）：`system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`（`theme.ts:916-920`）
- Mono（Web/Electron）：`SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace`（`theme.ts:922-926`）
- 应用方式：注入 `<style id="paseo-ui-font">`，规则 `:is(#root, #overlay-root) *:not([data-pmono]):not([data-pmono] *){font-family:var(--paseo-ui-font);}`，并设 `document.documentElement.style --paseo-ui-font`（`appearance/apply-root-font.web.ts:10-34`）。等宽文本打 `data-pmono=""`（`styles/code-surface.ts` 的 `CODE_SURFACE_DATASET`）并显式设 `fontFamily: theme.fontFamily.mono`。
- 用户自定义字体时放在默认栈前面（`appearance/font-stack.ts:14-26`）。

---

## 2. Web 全局样式

来源：`packages/app/public/index.html`、`styles/install-web-*.web.ts`（由 `app/_layout.tsx:1000-1001` 安装）。

- html/body：`width/height 100%; margin 0; padding 0; overflow hidden; overscroll-behavior none`（`index.html:21-29`）
- 字体平滑：`body { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }`（`index.html:31-34`）
- 启动底色：`html, body { background-color: #fcfcfc }`，`@media (prefers-color-scheme: dark) { #0a0a0a }`（`index.html:36-45`）；`<meta name="theme-color" content="#0a0a0a">`（7）
- `#root`：`display:flex; width/height:100%; flex:1; min-width:0; min-height:0; overflow:hidden`（47-55）
- 焦点环：`*:focus { outline: none }`；`*:focus-visible { outline: 2px solid #1b4ed8; outline-offset: 2px }`；暗色系统 `outline-color: #346bf1`（`index.html:80-91`）
- Electron 拖拽：交互元素 `-webkit-app-region: no-drag !important`（58-75）
- 噪点覆盖层（`styles/install-web-surface-grain.web.ts:1-31`）：
  ```css
  body::after {
    content: ""; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.035'/%3E%3C/svg%3E");
    background-repeat: repeat; background-size: 256px 256px;
  }
  ```
- 滚动条（`styles/install-web-scrollbar-styles.web.ts:16-51`，常量 `styles/web-scrollbar.ts:1-14`）：
  ```css
  * { scrollbar-color: color-mix(in srgb, var(--colors-foreground-extra-muted) 40%, transparent) transparent; scrollbar-width: thin; }
  *::-webkit-scrollbar { width: 8px; height: 8px; background: transparent; }
  *::-webkit-scrollbar-track, *::-webkit-scrollbar-corner { background: transparent; }
  *::-webkit-scrollbar-thumb { border: 2px solid transparent; border-radius: 999px;
    background: color-mix(in srgb, var(--colors-foreground-extra-muted) 40%, transparent); background-clip: content-box; }
  *::-webkit-scrollbar-thumb:hover { background: color-mix(in srgb, var(--colors-foreground-muted) 100%, transparent); background-clip: content-box; }
  ```
  `--colors-foreground-extra-muted` 即 `#a1a1aa` / `#555555`，`--colors-foreground-muted` 即 `#71717b` / `#818181`。
- 控件焦点环（输入框、选择框的 active 态）：`outline: 2px solid accent; outline-offset: 1px`（`control-geometry.ts:34-35, 244-250`）。

---

## 3. 设置页外壳

主文件：`screens/settings-screen.tsx`。

### 3.1 桌面（≥720）整体结构（`settings-screen.tsx:1625-1655`）

```
container (flex:1, bg surface0)                      1673-1676
└ row (flex:1, flex-direction:row)                   1720-1723
  ├ 侧栏 desktopContainer: width 320, border-right 1px border, bg surfaceSidebar   1733-1738
  │   └ inner (flex:1, paddingTop = safe-area top，Web 为 0)                       1048-1051
  │     ├ sidebarDragArea (position:relative)                                       1742-1744
  │     │   ├ TitlebarDragRegion（不可见）
  │     │   ├ WindowChromeSafeArea placement="below"：macOS Electron 为 45px 空白，其余 0
  │     │   └ SidebarHeaderRow「返回」                                                1141-1146
  │     └ ScrollView (flex:1, showsVerticalScrollIndicator=false) → 分组列表        1148-1154
  └ contentPane (flex:1)                                                           1724-1726
      ├ ScreenHeader borderless，left = HeaderIconBadge + ScreenTitle，gap 8        1642-1646, 1727-1729
      └ ScrollView (flex:1) → content: padding 16, paddingTop 24, width 100%, maxWidth 720, alignSelf center   1677-1686
```

- 侧栏宽 `SETTINGS_DESKTOP_SIDEBAR_WIDTH = 320`；详情最小宽 400（`constants/layout.ts:20-23`）。
- 头部固定、内容滚动；侧栏返回行固定、下方列表滚动且隐藏滚动条。
- 窗口控件避让（`utils/desktop-window.tsx:93-129`）：macOS Electron 左上 78×45（红绿灯）；Windows 自绘控件右上 138×36，Linux 108×36（`desktop-window.test.ts:22-31`）。纯浏览器全部为 0。ScreenHeader 所在内容区只认领右上角，所以 macOS 下内容头左右 padding 都是 12。

### 3.2 侧栏各部件

**返回行 SidebarHeaderRow**（`components/sidebar/sidebar-header-row.tsx`）
- 外框：高 36（md；紧凑 56），paddingHorizontal 12，垂直居中（`85-93`）
- 内部 `<Row size="md">`：minHeight 36，paddingVertical 8，paddingHorizontal 8（见 §5.5），图标 `ArrowLeft` 14（`ICON_SIZE.sm`，`52`），静止 foregroundMuted、hover/按下 foreground
- 文案 `settings.backToWorkspace` = 「返回」
- 效果：图标左缘距侧栏左边 12+8 = 20px。

**分组列表 list**（`settings-screen.tsx:1749-1753`）：paddingVertical 8，paddingHorizontal 8，gap 4（子项间距）。App 组和 Host 组各一个 list，所以两组之间是 8+8=16px。

**组标签 groupLabel**（`1061-1068`, `1754-1757`）：`<Text variant="caption" color="foregroundMuted" weight="medium">` → 12px / 16px / 500 / foregroundMuted；padding 4px 8px。文案「应用」「主机」。

**导航行 SettingsNavRow**（`854-877`）= `<Row size="sm">`：
- minHeight 32，paddingVertical 6，paddingHorizontal 8，gap 8，border-radius 8（`radius.md`），`align-items:center`（`row.tsx:206-224`, `185-187`）
- 前置图标 16（`ICON_SIZE.md`）；静止 foregroundMuted，hover/按下/选中 foreground（`856-866`）
- 标题 `Text variant="label"`：13px/18px/400；静止 foregroundMuted，hover/按下/选中 foreground（`row.tsx:128-136`）
- 底色：静止透明；hover `surfaceSidebarHover`（`#f1f1f1` / `#0a0a0a`）；按下 `surfaceSidebarActive`（`#e3e3e3` / `#1a1a1a`）；选中 `surfaceSidebarSelected`（`#eaeaea` / `#131313`）+ `box-shadow: inset 0 0 0 1px borderSidebarSelected`（`#dadada` / `#212121`）。优先级：按下 > 选中 > hover（`row.tsx:27-36`, `188-200`）
- 行内容宽：320 − 1(边框) − 16(list padding) = 303px

**主机选择器 HostPicker**（`944-1009`, `1759-1781`）：位于「主机」组标签下、第一个主机分区上方
- 触发器：row，gap 8，minHeight 32，paddingVertical 6，paddingHorizontal 8，radius 8；hover 底色 `surfaceSidebarHover`；无选中态
- 前置：16×16 框内居中 8×8 圆点（`host-status-dot.tsx:21-34`：在线 statusSuccess，连接中 statusWarning，离线 statusDanger）
- 标签：`Text variant="label"` 13/18，颜色 foreground（Text 默认色），单行省略
- 尾部：`ChevronDown` 14，foregroundMuted，`translateY(1px)`（`components/ui/combobox-trigger.tsx:25-27, 90-95, 114-117`）
- 打开的是 Combobox，desktopMinWidth 240，标题「切换主机」

**App 组条目**（顺序、图标、文案，`settings-screen.tsx:153-184`；`desktopOnly` 仅 Electron 显示，`webOnly` 仅 Web）：

| # | id | lucide 图标 | zh-CN | 可见 |
|---|---|---|---|---|
| 1 | general | `Settings` | 通用 | 全部 |
| 2 | appearance | `Palette` | 外观 | 全部 |
| 3 | layout | `PanelsTopLeft` | Layout | Electron |
| 4 | editor | `Code2` | 编辑器 | Web（含 Electron） |
| 5 | shortcuts | `Keyboard` | 快捷键 | Electron |
| 6 | integrations | `Puzzle` | 集成 | Electron |
| 7 | notifications | `Bell` | 通知 | Electron |
| 8 | permissions | `Shield` | 权限 | Electron |
| 9 | diagnostics | `Stethoscope` | 诊断 | 全部 |
| 10 | about | `Info` | 关于 | 全部 |

**Host 组条目**（`settings-screen.tsx:192-204`，全部显示）：

| # | id | lucide 图标 | zh-CN |
|---|---|---|---|
| 1 | host | `Server` | 概览 |
| 2 | projects | `FolderGit2` | 项目 |
| 3 | connections | `Network` | 连接 |
| 4 | pair-device | `Smartphone` | 配对设备 |
| 5 | agents | `Bot` | Agents |
| 6 | metadata | `Sparkles` | 元数据 |
| 7 | workspaces | `FolderGit2` | Workspaces |
| 8 | **providers** | `Boxes` | **Providers** |
| 9 | usage | `Gauge` | 价格表 |
| 10 | terminals | `SquareTerminal` | Terminals |
| 11 | plugins | `Blocks` | 插件 |

没有主机时 Host 组替换为「添加主机」（`Plus`）和可选的内置 daemon 行（`Server`）（`1108-1125`）。

### 3.3 内容区头部

**ScreenHeader**（`components/headers/screen-header.tsx`）
- 外层 bg surface0（`70-72`）
- 行：height 36（md；紧凑 56），`flex-direction:row; align-items:center; justify-content:space-between`，border-bottom 1px；borderless 时颜色 `transparent`（仍占 1px，RN 为 border-box，所以总高 36）（`74-86`, `100-102`）
- 水平 padding：桌面 12，紧凑 8（`41`），再加窗口控件避让
- 紧凑时 paddingTop 8 + safe-area（`40-45`）
- left 槽：flex 1，row，gap 8（设置页再设 gap 8）（`87-93`）

**HeaderIconBadge**（`components/headers/header-icon-badge.tsx` → `header-toggle-button.tsx:98-100` → `components/ui/icon-button-chrome.ts:67-84`）：26×26（md；紧凑 32×32），radius 8，居中，无底色。里面图标 16，foregroundMuted（`settings-screen.tsx:1167-1170`）。Providers 页即 `Boxes` 16。

**ScreenTitle**（`components/headers/screen-title.tsx:26-36`）：fontSize 14，fontWeight 桌面 `"300"` / 紧凑 `"400"`，color foreground，单行省略，line-height normal。Providers 页标题文案 = `settings.hostSections.providers` =「Providers」。

### 3.4 紧凑布局（< 720）

- 根页（`settings-screen.tsx:1584-1603`）：`BackHeader title="设置" borderless` + ScrollView 包侧栏列表（mobileContainer padding 8/8，`1745-1748`；list 再 padding 8/8 gap 4）。
- 详情页（`1605-1620`）：`BackHeader title={分区名}` + ScrollView → 同一 `content`（padding 16，paddingTop 24，maxWidth 720）。
- **BackHeader**（`components/headers/back-header.tsx`）：ScreenHeader 行高 56 + paddingTop 8 + safe-area；左右 padding 8；返回按钮 `ArrowLeft` 20（`iconSize.lg`）foregroundMuted，按钮 padding 12（紧凑）/ 8（md），borderRadius 8（`borderRadius.lg`）（`62-73`）；后接 ScreenTitle（400 字重），gap 8。
- 紧凑下 Provider 行不显示状态文字、不显示错误文本（见 §6.1）。

---

## 4. settingsStyles（`styles/settings.ts`）

| 键 | 解析后的值 | 行 |
|---|---|---|
| section | margin-bottom 24 | 7-9 |
| sectionHeader | row, center, space-between, margin-bottom 12, margin-left 4（SettingsSection 不用它，见 §5.1） | 10-16 |
| sectionHeaderTitle | color foregroundMuted; 13px / 18px; weight 500 | 17-21 |
| sectionHeaderLink | row, center, gap 4 | 22-26 |
| card | bg surfaceCard（`#ffffff` / `#111111`）; border-radius 14（`radius.xl`）; border 1px border（`#e4e4e7` / `#191919`）; overflow hidden | 27-33 |
| row | row; align-items center; justify-content space-between; gap 16; min-height 56; padding 8px 16px | 34-42（`SETTINGS_ROW_MIN_HEIGHT = 56`，4） |
| rowBorder | border-top 1px borderCardRow（`rgba(228,228,231,0.5)` / `rgba(25,25,25,0.5)`） | 43-46 |
| rowContent | flex 1; min-width 0 | 47-50 |
| rowTitle | color foreground; 14px / 20px | 51-54 |
| rowHint | color foregroundMuted; 12px / 16px; margin-top 2 | 55-59 |
| rowError | color statusDanger; 12px / 16px; margin-top 2 | 60-64 |
| rowValue | color foregroundMuted; 14px / 20px | 65-68 |
| rowIconFrame | 28×28; border-radius 6（`radius.sm`）; bg surface2（`#f4f4f5` / `#171717`）; 居中; flex-shrink 0 | 69-77 |

`SettingsCard`（`components/settings/index.tsx:30-43`）：卡片内第 2 个起每个子项包一层 `rowBorder`。`SettingsRow`（`45-62`）：紧凑时 `flex-wrap: wrap; gap 12`；标签列 `flex: 1 1 160px`。

---

## 5. 通用组件

### 5.1 SettingsSection（`components/settings/headings/settings-section.tsx`）

```
section: margin-bottom 24（settingsStyles.section；flush 时 0；调用方 style 可覆盖）
├ header: row, align center, space-between, gap 8, margin-bottom 8, margin-left 2      63-71
│   ├ titleRow: row, center, gap 8                                                     72-76
│   │   ├ 标题：sectionHeaderTitle（13/18/500/foregroundMuted）
│   │   └ 可选 info：Info 图标 14 foregroundMuted，padding 4，margin-left -4，点开 Tooltip   settings-info-tip.tsx:37,47-51
│   └ trailing 槽（右对齐，任意节点：Providers 安装指引放 SegmentedControl，第三方接口放 ghost「添加」按钮）
└ content: gap 12                                                                        77-79
```

`SettingsGroup`（`settings-group.tsx:50-71`）：group margin-bottom 32；标题 14/20/500/foreground；header margin-bottom 16。Providers 页未使用。

### 5.2 Switch（`components/ui/switch.tsx`，几何 `control-geometry.ts:31-33,73-78`）

| 项 | 值 |
|---|---|
| 外层 Pressable | min-height 32，justify-content center（`control-geometry.ts:170-173`）；hitSlop 8；disabled opacity 0.5 |
| 轨道 | 32×18，radius 9，padding 2，justify center（`123-129`） |
| 拇指 | 14×14，radius 7；阴影 `0 1px 2px rgba(0,0,0,0.25)`（`130-141`） |
| 位移 | translateX 0 → 14（`thumbTravel = 32 − 14 − (18 − 14)`） |
| 关 | 轨道 surface3（`#e4e4e7` / `#262626`），拇指 `#ffffff`（`70-73`） |
| 开 | 轨道 accent（`#1b4ed8` / `#346bf1`），拇指 accentForeground `#ffffff` |
| 动画 | 180ms，`Easing.inOut(Easing.ease)`，颜色插值 + 位移（`28`, `45-54`） |

### 5.3 Button（`components/ui/button.tsx`，几何 `control-geometry.ts:130-212`）

基础（`92-100`）：row，居中，gap 8，border 1px transparent，radius 8（被尺寸覆盖）。文字（`143-147`）：14px（xs 为 12px），400，line-height normal，color foreground。

| size | 桌面 min-height | 紧凑 min-height | padding-x | radius | 图标 |
|---|---|---|---|---|---|
| xs | 24 | 28 | 12 | 6 | 12 |
| sm | 28 | 32 | 12 | 8 | 14 |
| md（默认） | 32 | 44 | 16 | 8 | 16 |
| lg | 32 | 44 | 24 | 10 | 20 |

| variant | 底色 | 边框 | 文字 / 图标 | hover |
|---|---|---|---|---|
| default | accent `#1b4ed8` / `#346bf1` | 同底色 | accentForeground `#ffffff` | 无变化 |
| secondary（默认） | surface3 `#e4e4e7` / `#262626` | 同底色 | foreground | 无变化 |
| outline | transparent | borderAccent `#d4d4d8` / `#262626` | foreground | bg interactionHighlight |
| ghost | transparent | transparent | foregroundMuted | bg interactionHighlight，文字/图标 → foreground |
| destructive | destructive `#c10007` / `#c44a4a` | 同底色 | destructiveForeground `#fcfcfc` / `#ffffff` | 无变化 |

按下 opacity 0.85；禁用或 loading opacity 0.5（`137-142`）；loading 时图标位换成 small spinner（20px）。只有图标无文字的 ghost sm 按钮宽 = 12+14+12+2 = 40px，高 28。

### 5.4 SegmentedControl（`components/ui/segmented-control.tsx`，几何 `control-geometry.ts:174-190, 258-272`）

安装指引用 `size="sm"`。

| 项 | sm 桌面 | sm 紧凑 |
|---|---|---|
| 轨道 | min-height 28，padding 2，radius 8，bg surface2，gap 2，row | min-height 32 |
| 分段 | min-height 24，padding-x 8，radius 6，gap 4 | min-height 28 |
| 标签 | 14px，400，foregroundMuted；选中 foreground | 同 |

选中段 bg surface3；hover（非选中）bg interactionHighlight；按下（非选中）surface3；禁用 0.5（`199-230`）。xs：轨道 24、分段 20、radius 6/4、标签 12；md：轨道 32、分段 28、padding-x 12、标签 14。

### 5.5 Row（`components/ui/row.tsx`）

见 §3.2。补充：`md` 尺寸 min-height 36，padding-vertical 8；前置槽 min-height 18（label 行高）；标题行 gap 8；hover 操作槽 `position:absolute; right:0; top:0; bottom:0; radius 6`，隐藏时 opacity 0 并铺同一底色（`155-182`, `251-262`）。

### 5.6 StatusBadge（`components/ui/status-badge.tsx:32-58`）

pill：row，center，gap 6，radius 9999，border 1px border，bg surface3，padding 3px 8px；文字 12px，400，foregroundMuted；success/warning/error 分别 statusSuccess / statusWarning / statusDanger。Providers 页当前未使用。

### 5.7 表单输入

**FormTextInput**（`components/ui/form-field.tsx:159-290`，几何 `control-geometry.ts:130-169`）：外框 bg surface2，border 1px borderInput（hover borderAccent；聚焦 borderAccent + `outline: 2px solid accent, offset 1px`；禁用 0.5）；内部输入 color foreground，padding 0，placeholder foregroundMuted。

| size | 桌面 | 紧凑 |
|---|---|---|
| sm | min-height 28，padding 3px 12px，radius 8，字 14/20 | min-height 32，padding 5px 12px |
| md | min-height 32，padding 5px 16px，radius 8，字 14/20 | min-height 44，padding 11px 16px |

（`fieldLineHeight = round(14×1.4) = 20`；`paddingVertical = (高 − 20 − 2)/2`）

**Field**（`form-field.tsx:35-63, 227-246`）：竖排 gap 8；label 14px/400/foregroundMuted；hint 12px/17px foregroundMuted；error 12px/17px `red[300] #fca5a5`（两主题同色）。

**SearchField**（`components/ui/search-field.tsx:89-122`）：row，gap 8，flex 1，max-width 420，padding 6px 12px，radius 8，bg surface1，border 1px borderInput；聚焦 border borderAccent、bg surface2；`Search` 14 foregroundMuted；输入 height 20，14px，foreground；有值时尾部 `X` 14 清除。总高 34。

**DropdownTrigger**（`components/ui/dropdown-trigger.tsx:55-77`）：同 Button sm 几何（桌面 28 高 / radius 8），padding-left 12，padding-right 8，gap 4，border 1px borderInput，hover/展开 borderAccent，禁用 0.5；尾部 `ChevronDown` 14 foregroundMuted translateY 1。

**SelectField 触发器**（`components/ui/select-field.tsx:353-393`）：row，gap 8，bg surface2，几何同 FormTextInput sm/md，边框状态同 FormTextInput；值文字 foreground，占位 foregroundMuted。

### 5.8 DropdownMenu（`components/ui/menu/*`，样式 `menu-item.tsx:378-541`、`menu-overlay.tsx:527-546`、`styles/floating-surface.ts:42-50`）

- 弹层：`min-width 180`，默认 offset 4，side bottom，align start（`menu-surface.tsx:195-207`）；Providers 行菜单 `align="end" width={220}`
- 表面：bg surfaceGlass + `backdrop-filter: blur(12px) saturate(1.14)`；border 1px border；radius 10（`radius.lg`）；`box-shadow: 0 16px 40px -18px shadowPopover, inset 0 1px 0 insetHighlight`；overflow hidden
- 页：padding-vertical 4，行间距 0
- 菜单项：row，center，min-height 30（桌面）/ 40（紧凑）（`menu-geometry.ts:2`），gap 8，margin 0 4px，padding 4px 8px，border 1px transparent，radius 6；文字 14px / 18px / 400 / foreground；hover/按下/键盘聚焦 bg interactionHighlight；destructive 文字 destructive 色；禁用 0.5
- 前置/勾选槽宽 16；选中勾 `Check` 16 muted；pending 时 spinner 16
- 分组标签：padding 8px 12px 4px，12px foregroundMuted
- 分隔线：高 1，margin 4px 6px，bg border
- 紧凑布局下菜单改为底部 sheet（`docs/menus.md`）

### 5.9 AdaptiveModalSheet（`components/adaptive-modal-sheet.tsx`）

**桌面（≥720）**
- 覆盖层：绝对铺满，居中，padding 24；Web 退出时 opacity 1→0，`transition: opacity 160ms ease`（`84-90`, `576-588`, `243`）
- 遮罩（卡片兄弟节点，点击关闭）：bg overlayScrim（`rgba(0,0,0,0.18)` / `rgba(0,0,0,0.35)`）+ `backdrop-filter: blur(4px)`（`94-97`，`floating-surface.ts:6,28-36`）
- 卡片：width 100%，max-width 520（可由 `desktopMaxWidth` 改），max-height 85%，overflow hidden，bg surfaceGlass + `backdrop-filter: blur(12px) saturate(1.14)`，radius 18（`radius.2xl`），border 1px border，`box-shadow: 0 24px 64px -24px shadowDialog, inset 0 1px 0 insetHighlight`（`98-110`）
- 头部（`111-153`, `309-400`）：border-bottom 1px border；行 padding 16px 24px，row，center，gap 8
  - 可选返回 `ArrowLeft` 18 muted（按下 foreground）
  - 标题组 flex 1，gap 4；标题 14px / 500 / foreground，单行
  - actions 槽 row gap 8
  - 关闭按钮 padding 8，radius 8，`X` 16 muted（按下 foreground）
  - 可选搜索行：row，gap 8，padding 0 24px 12px；`Search` 16 muted；输入 flex 1，padding-vertical 8，14px，foreground，placeholder foregroundMuted，无 outline
- 内容：可滚动（默认）或静态；内容区 padding 24，gap 16（`205-208`）
- 底栏（`230-240`）：padding 12px 24px，border-top 1px border，bg surfaceDialogFooter，row，space-between，gap 8
- 平台：Web 用 portal 挂到 `#overlay-root`（`735`）；`GLASS_SURFACES_ENABLED` Web 为 true（`styles/glass-support.web.ts:2`），原生为 false（改用不透明 surfaceCard）

**紧凑（< 720）**：gorhom 底部 sheet；背景 surfaceCard，上两角 radius 18（`245-259`）；把手颜色 `zinc[600] #52525b`（`536-539`）；背景遮罩 opacity 0.45（`563`）；默认 snap `["65%","90%"]`。

### 5.10 LoadingSpinner（`components/ui/loading-spinner.tsx` → RN-web ActivityIndicator）

`node_modules/react-native-web/dist/exports/ActivityIndicator/index.js`：small 20×20，large 36×36，数字尺寸按数字；SVG `viewBox 0 0 32 32`，两个 `circle cx16 cy16 r14 fill none stroke-width 4`：底圈 opacity 0.2，前圈 `stroke-dasharray 80; stroke-dashoffset 60`；整体 `rotate 0→360deg, 0.75s linear infinite`。颜色由调用方传（Providers 行 loading 用 foregroundMuted，尺寸 10）。

### 5.11 Text（`components/ui/text.tsx`）

默认 `variant="body"`（14/20）、`color="foreground"`、`weight="normal"`。可用颜色：foreground / foregroundMuted / foregroundExtraMuted / statusSuccess / statusDanger / statusWarning / statusMerged / accentBright；字重 normal(400) / medium(500) / semibold(600)。

### 5.12 Alert（`components/ui/alert.tsx`，第三方接口健康提示用）

- 容器：row，align flex-start，gap 12，border 1px border，bg transparent，radius 12（`borderRadius.xl`），padding 12px 16px（`73-83`）
- warning：border transparent，bg surfaceWarning `rgba(245,158,11,0.1)`，radius 8（`radius.md`）；图标 `AlertTriangle` 14 `#f59e0b`；标题色 `#f59e0b`
- error：border destructive；图标 `XCircle` 14 destructive；标题色 destructive
- 图标槽 padding-top 2；body flex 1 gap 4；标题 14px / 500；description 字符串 12px foregroundMuted，节点形式槽 gap 8；actions row gap 8 margin-top 8

### 5.13 Toast（`components/toast-host.tsx:54-55, 105-115, 271-321`）

顶部居中，left/right 16，top = 偏移 + 8（app-shell）；宽 92%，max 480；卡片 row，gap 8，bg surface0，radius 16（`borderRadius.2xl`），border 1px border（error 为 destructive），padding 8px 12px，阴影 `shadow.md`；文字 14px / 400 / foreground。「已复制」toast 用 `CheckCircle2` 18，文案 `已复制 {{label}}`。默认 2200ms，error 3200ms。

### 5.14 确认框

`utils/confirm-dialog.ts`：Electron 走系统原生对话框（`kind: warning`/`info`），原生走 `Alert.alert`。不是应用内自绘组件，原型里可用普通对话框示意。

---

## 6. 当前 Providers 页

入口 `screens/settings/host-page.tsx:320-332` → `<ProvidersSection>`（`screens/settings/providers-section.tsx`）。页面位于内容列（max-width 720，padding 16，顶部 24）里。

### 6.1 结构与样式

```
SettingsSection 「Providers」 style marginBottom 16（覆盖默认 24）            447-451, 518-520
├ 未连接 / 加载中：card + emptyCard(padding 16, align center)，文字 14/20 foregroundMuted   452-461, 524-531
└ card
   └ ProviderRow × N（第 2 个起 rowBorder）
SettingsSection 「添加 Provider」 style marginTop 16（加上默认 marginBottom 24）      501-511, 521-523
└ ProviderCatalogList
```

两个 section 间：卡片底 → 16 + 16 → 下一个标题。

**ProviderRow**（`182-312`）= 整行 Pressable，样式 `settingsStyles.row`（min-height 56，padding 8/16，gap 16）
- hover bg surface2（`#f4f4f5` / `#171717`），按下 bg surface3（`#e4e4e7` / `#262626`）（`532-537`），被卡片圆角裁切
- 左侧 rowContent：row，center，gap 12，flex 1（`538-544`）
  - rowIconFrame 28×28 radius 6 bg surface2，内放单色 provider 图标 16，颜色 foreground（`255-257`）
  - 文字列（settingsStyles.rowContent）：
    - 标题：rowTitle 14/20 foreground，单行（label 来自 daemon：Claude / Codex / Copilot / OpenCode / Pi / Oh My Pi）
    - 错误（仅启用且 status=error 且非紧凑）：12/16，color `red[300] #fca5a5`，margin-top 2，最多 3 行（`262-266`, `562-566`）
    - 否则模型数：rowHint（12/16 muted，margin-top 2）「1 个 Model」/「{{count}} 个 Model」
    - 继承接口提示（自定义提供方继承 claude 且 Claude 启用了第三方接口）：rowHint，最多 2 行
- 右侧 trailingControls：row，center，gap 8（`567-571`），顺序：
  1. StatusIndicator：row，gap 6；圆点 6×6 radius 3；非紧凑时跟标签 12/16 foregroundMuted（`314-325`, `545-558`）。loading 时圆点换 10px spinner（muted）

     | 状态 | 圆点色 | 标签 |
     |---|---|---|
     | 已禁用 | foregroundMuted | 已禁用 |
     | loading | （spinner） | 正在加载 |
     | error | statusDanger | 错误 |
     | ready | statusSuccess | 可用 |
     | 其他（未装） | statusWarning | 未安装 |

     或 InstallEntry（有安装指引 + 已启用 + unavailable）：warning 圆点 + `Text variant="caption"`（12/16，颜色 foreground）下划线「如何安装」，点击打开详情（`327-349`, `559-561`）
  2. Switch（启用开关）
  3. menuSlot 28×28，总是占位；仅自定义提供方（且主机支持 providerRemoval）放「…」菜单：按钮 28×28 radius 8，hover/展开 bg surface2，按下 surface3，`MoreHorizontal` 14 muted→foreground；菜单 width 220 align end，一项 destructive「Remove provider」+ `Trash2` 16 statusDanger（`121-180`, `572-588`）
  4. `ChevronRight` 14，行 hover 时 foreground，否则 foregroundMuted
- 点击整行打开详情 sheet（`useProviderSettingsStore.open` → `components/provider-settings-host.tsx`）。

### 6.2 ProviderCatalogList（`components/provider-catalog-list.tsx`）

- 搜索框（`148-163`, `187-208`）：row，center，gap 8，bg surface2，radius 8，border 1px borderInput，padding-x 12，margin-bottom 12；图标位宽 18 居中，`Search` 16 muted；输入 flex 1，padding-vertical 8，14/20，foreground，placeholder foregroundMuted，无 outline。高度 = 20 + 16 + 2 = 38。占位「搜索 providers」
- 空：stateBox min-height 96，radius 14，border 1px border，bg surfaceCard，居中，padding 16，文字 14/20 muted「未找到 providers」（`250-264`）
- 列表：settingsStyles.card，CatalogRow × N（第 2 个起 rowBorder）
- CatalogRow（`55-121`）= settingsStyles.row（gap 16）：
  - rowIconFrame（28，radius 6，surface2）：有远程 SVG 时 20×20（`ICON_SIZE.lg`）用 foreground 着色；否则 `PackagePlus` 16 foreground
  - 文字列 flex 1：
    - 标题行 row gap 8：名称 14/20 foreground（可收缩，单行）+ 版本 12/16 muted
    - 描述 12/16 muted，margin-top 2，单行（无描述时显示 id）
    - 「安装说明」链接：row gap 4，margin-top 2，文字 12/16 muted + `ExternalLink` 12 muted
  - 按钮：Button default sm，固定宽 92，文案「添加」/「正在添加」（loading 时带 spinner）

### 6.3 详情 sheet：ProviderDiagnosticSheet（`components/provider-diagnostic-sheet.tsx`）

AdaptiveModalSheet，桌面 max-width 520（默认），紧凑 snap `["65%","92%"]`（896）。

- 头部（`687-697`）：标题 = provider label；带搜索行，占位「搜索 Models」
- 内容（SheetContent padding 24 gap 16），依次：
  1. 安装指引（仅 status=unavailable 且有指引，§6.4）
  2. 第三方接口（仅 claude / codex 且主机支持 apiEndpoints，§6.5）
  3. 模型区 ProviderModalBody（`486-573`）：
     - 空/加载/错误/无匹配：emptyState padding-vertical 32，居中，gap 12；文字 14 muted；错误态带 `AlertTriangle` 16 muted 和 default sm「重试」
     - 「已发现」区与「自定义 Models」区，各为 section（margin-bottom 16）：
       - SectionHeader（`130-145`, `809-821`）：row，space-between，gap 8，margin-bottom 8，margin-left 4；左标题 + 右 meta（数量），都用 sectionHeaderTitle（13/18/500/muted），meta gap 4，数量与 hint 间用「·」
       - settingsStyles.card 包 modelRow × N
     - modelRow（`822-838`）：row，center，padding 8px 16px，gap 12，**每一行都有** border-top 1px borderCardRow（含第一行）；名称 14 foreground（不收缩）；id 用 mono 12 muted（`data-pmono`，不收缩）；DiscoveredModelRow 再跟描述 12 muted flex 1 单行
     - CustomModelRow：id 后接 filler(flex 1) + 删除按钮 28×28 radius 9999，hover/按下 bg surface2，`Trash2` 14 destructive，删除中 opacity 0.5（`788-805`）
- 底栏（`427-484`, `844-873`）：
  - 桌面：row，space-between，gap 8；左 meta 12 muted flex 1「已更新 {{time}}」（无时间时空串占位）；右 actions row gap 8：secondary sm `Plus`「添加 Model」、secondary sm `FileText`「诊断」、default sm `RotateCw`「刷新」（刷新中无图标、文案「正在刷新...」、禁用）
  - 紧凑：纵向 gap 8，按钮 `align-self: stretch`；meta 仅有时间时显示
- 子 sheet「添加自定义 Model」（`147-241`）：max-width 420；formGroup gap 12；label 14/500/foreground「Model ID」；输入 bg surface2，radius 8（`borderRadius.lg`），padding 12px 16px，border 1px border，14px，占位「例如 openai/gpt-5」；错误 12 destructive；按钮行右对齐 gap 8：secondary sm「取消」、default sm「添加」/「正在添加...」。紧凑 snap `["40%"]`
- 子 sheet「诊断」（`243-400`）：不滚动；头部 actions（row gap 4）：复制 `Copy` 14 muted、刷新 `RotateCw` 14 muted（刷新中 spinner 14），按钮 28×28 round hover surface2，禁用 0.5；内容：`ScrollableCodeSurface` max-height 480（mono 12/18 foreground，padding 12px 16px，bg surface1，radius 8 border 1px border，`white-space: pre`）（`components/ui/scrollable-code-surface.tsx:164-202`），加载/无内容时 SurfaceCard 内 row padding 16 gap 8 + 14 muted 文字。紧凑 snap `["50%","85%"]`

### 6.4 安装指引（`provider-install-guide/index.tsx`，数据 `internal/commands.ts`）

- SettingsSection 标题「安装 {{name}}」，trailing = SegmentedControl sm：`macOS` / `Linux` / `Windows`（不翻译，`30-34`）。默认选中主机系统（darwin→macOS、linux→Linux、win32→Windows），未知时不选中（`internal/model.ts:24-47`）
- card：
  - 命令行 InstallCommandRow（settingsStyles.row，第 2 个起 rowBorder）（`47-90`）：左 rowContent：可选小标签 caption 12/16 muted margin-bottom 2（如「PowerShell」「CMD」「npm」）+ 命令 caption 12/16 foreground，mono（`data-pmono`），可选中；右 Button ghost sm `Copy`「复制」
  - 未选系统时一行 caption muted「选择 Host 的操作系统」
  - 末行（rowBorder）：左 caption muted flex 1「在运行 Osuna daemon 的机器上执行」；右 row gap 4：caption muted「官方文档」+ `ExternalLink` 12 muted（`148-165`, `171-187`）
- 点复制 → toast「已复制 命令」
- 命令原文：

| provider | macOS / Linux | Windows | 文档 |
|---|---|---|---|
| claude | `curl -fsSL https://claude.ai/install.sh \| bash` | PowerShell: `irm https://claude.ai/install.ps1 \| iex`；CMD: `curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd` | https://code.claude.com/docs/en/setup |
| codex | `curl -fsSL https://chatgpt.com/codex/install.sh \| sh` | `powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 \| iex"` | https://learn.chatgpt.com/docs/codex/cli |
| pi | `curl -fsSL https://pi.dev/install.sh \| sh` | npm: `npm install -g --ignore-scripts @earendil-works/pi-coding-agent` | https://pi.dev/docs/latest/quickstart |
| omp | `curl -fsSL https://omp.sh/install \| sh` | `irm https://omp.sh/install.ps1 \| iex` | https://omp.sh/docs/quickstart |

copilot、opencode 没有安装指引。

### 6.5 第三方接口区 ApiEndpointsView（`api-endpoints/view.tsx` → `api-endpoints/index.tsx`）

仅 `claude`、`codex`（`index.tsx:43-47`），且主机声明 `apiEndpoints`（`provider-diagnostic-sheet.tsx:609-611`）。

```
SettingsSection 「第三方接口」 trailing = Button ghost sm Plus「添加」（非 ready 或 busy 时禁用）   83-105
├ 可选 HealthAlert（Alert warning 或 error，§5.12）                                               106-114, 195-265
│   标题 = 第一条问题的译文；描述槽里：第一条的 daemon 原文（caption muted），其余每条 {译文 caption, 原文 caption muted}，gap 2
│   有「已被外部修改」且有启用中接口时 actions：outline sm「重新应用」、outline sm「切回官方」
└ card
   ├ 可选 actionError 行（settingsStyles.row）：caption statusDanger flex 1 可选中 + ghost sm「关闭」      116-125
   ├ loading 行：caption muted「正在加载第三方接口…」
   ├ error 行：body「无法加载第三方接口」+ caption statusDanger 原因
   └ ready：
      ├ 官方行（有 actionError 时带 rowBorder）                                                       145-175
      │   左 rowContent：body 14/20「官方」；caption muted「沿用 {{name}} 自身的配置，通常是订阅登录」；
      │                  官方启用且 CLI 指向其它地址时再加 caption muted「当前 {{provider}} 自身配置指向 {{url}}」
      │   右 UseControl
      └ ApiEndpointRow × N（每行都带 rowBorder）                                                      275-352
          左 rowContent：body 单行 名称；meta 行 row center gap 8 margin-top 2：
               baseUrl caption muted mono（data-pmono）可收缩单行 + 「{{count}} 个模型」caption muted 不收缩
          右 actions row center gap 4 不收缩：ghost sm 仅图标 Pencil、ghost sm 仅图标 Trash2、UseControl
```

- UseControl（`354-392`）：启用中 → Text caption（12/16）statusSuccess「使用中」，padding-x 12；否则 Button outline sm「使用」（busy 时禁用）
- 样式（`394-424`）：meta gap 8 / margin-top 2；url flexShrink 1 mono；actions gap 4；inUse padding-x 12；issue gap 2
- 切换 / 删除 / 保存启用中接口前走系统确认框（§5.14），正文含受影响会话数（i18n `apiEndpoints.impact.*`）
- 健康提示变体：只有 `codex_profile_override` 时为 warning，其余为 error（`internal/section-state.ts:83-117`）

**新建/编辑表单 ApiEndpointFormSheet**（`api-endpoints/form-sheet.tsx`）：AdaptiveModalSheet max-width 520，紧凑 snap `["85%"]`；标题「新建第三方接口」/「编辑第三方接口」；无底栏（按钮在内容末尾）。

- form 竖排 gap 16；每项是 Field（label 14 muted + 子项，gap 8）；字段尺寸桌面 `sm`、紧凑 `md`
- 字段顺序：
  1. 名称：FormTextInput，占位「OpenRouter」
  2. Base URL：占位 `https://openrouter.ai/api`，非法时 error「请输入以 http:// 或 https:// 开头的地址」
  3. API key：secure，占位「粘贴 API key」/ 已保存「已设置，留空则保留」
  4. 模型（hint「从这个接口拉取模型列表，勾选要用的模型。」）：outline sm「拉取模型」/「重新拉取」（loading），拉取中另有 ghost sm「取消」；失败 caption statusDanger；成功后 SearchField（占位「搜索模型（共 {{count}} 个）」）+ 可勾选列表
  5. 使用的模型（无模型时 error「至少勾选或添加一个模型」）：已选列表 + 行 [FormTextInput 占位「手动添加模型 ID」 flex 1][outline sm「添加」]，gap 8
  6. 模型映射（可选，仅 `showMapping`）：Opus / Sonnet / Haiku / Fable 四行，每行 caption 标签宽 56 + SelectField flex 1，gap 12；列表 gap 8；选项首项「不映射」
  7. 测试连接（hint 长文）：DropdownTrigger「选择模型并测试」/「正在测试...」，菜单 width 280 align start，标签「用这个模型测试」，项为模型 id；测试中另有 ghost sm「取消」；结果：caption 500 statusSuccess/statusDanger「连接成功 · HTTP 200 · 123 ms · model」，失败原因 caption muted
  8. 提交错误：caption statusDanger
  9. 按钮行右对齐 gap 8：secondary sm「取消」、default sm「保存」/「正在保存…」（loading）
- 列表样式（`658-739`）：modelList radius 10（`radius.lg`）border 1px border overflow hidden；modelRow row center gap 8，padding 4px 4px 4px 12px，border-top 1px borderCardRow，margin-top -1（第一行的上边被裁掉）；modelId flex 1 mono caption；已选行右侧「默认」caption muted padding-x 12 或 ghost sm「设为默认」，再 ghost sm 仅图标 `Trash2`；拉取结果行 fetchedRow padding 8px 12px 8px 12px，hover/按下 bg interactionHighlight，前置 `Square` 16 muted / `SquareCheck` 16 foreground，label caption muted max-width 40%
- 测试耗时格式：<1000ms `"{n} ms"`，否则 `"{x.x} s"`（`internal/section-state.ts:160-163`）

---

## 7. Provider 图标

来源 `components/provider-icons.ts`、`components/icons/*.tsx`。Providers 设置页（行图标、目录行）一律用**单色**版本 `getProviderIcon`，颜色 foreground（`providers-section.tsx:199-200, 256`）。彩色版本与品牌色只在 `tone: "brand"` 时使用（Composer 工具栏与模型列表，`provider-icons.ts:106-122`）。

解析顺序（`provider-icon-name.ts:30-47`）：内置 id → daemon 快照里的 `iconSvg`（自定义提供方可带）→ ACP 目录已知 id → 兜底 lucide `Bot`。**继承 claude 的自定义提供方如果快照没给 iconSvg，显示 `Bot`，不是 Claude 图标。**

以下 SVG 均为 `fill={color}`（currentColor），宽高 = size。

**Claude**（`icons/claude-icon.tsx:10-11`）`viewBox="0 0 24 24" fill-rule="evenodd"`（以下 path 由脚本从源码逐字提取）
```
M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z
```

**Codex**（`icons/codex-icon.tsx:10-11`）`viewBox="0 0 24 24" fill-rule="evenodd"`
```
M21.55 10.004a5.416 5.416 0 00-.478-4.501c-1.217-2.09-3.662-3.166-6.05-2.66A5.59 5.59 0 0010.831 1C8.39.995 6.224 2.546 5.473 4.838A5.553 5.553 0 001.76 7.496a5.487 5.487 0 00.691 6.5 5.416 5.416 0 00.477 4.502c1.217 2.09 3.662 3.165 6.05 2.66A5.586 5.586 0 0013.168 23c2.443.006 4.61-1.546 5.361-3.84a5.553 5.553 0 003.715-2.66 5.488 5.488 0 00-.693-6.497v.001zm-8.381 11.558a4.199 4.199 0 01-2.675-.954c.034-.018.093-.05.132-.074l4.44-2.53a.71.71 0 00.364-.623v-6.176l1.877 1.069c.02.01.033.029.036.05v5.115c-.003 2.274-1.87 4.118-4.174 4.123zM4.192 17.78a4.059 4.059 0 01-.498-2.763c.032.02.09.055.131.078l4.44 2.53c.225.13.504.13.73 0l5.42-3.088v2.138a.068.068 0 01-.027.057L9.9 19.288c-1.999 1.136-4.552.46-5.707-1.51h-.001zM3.023 8.216A4.15 4.15 0 015.198 6.41l-.002.151v5.06a.711.711 0 00.364.624l5.42 3.087-1.876 1.07a.067.067 0 01-.063.005l-4.489-2.559c-1.995-1.14-2.679-3.658-1.53-5.63h.001zm15.417 3.54l-5.42-3.088L14.896 7.6a.067.067 0 01.063-.006l4.489 2.557c1.998 1.14 2.683 3.662 1.529 5.633a4.163 4.163 0 01-2.174 1.807V12.38a.71.71 0 00-.363-.623zm1.867-2.773a6.04 6.04 0 00-.132-.078l-4.44-2.53a.731.731 0 00-.729 0l-5.42 3.088V7.325a.068.068 0 01.027-.057L14.1 4.713c2-1.137 4.555-.46 5.707 1.513.487.833.664 1.809.499 2.757h.001zm-11.741 3.81l-1.877-1.068a.065.065 0 01-.036-.051V6.559c.001-2.277 1.873-4.122 4.181-4.12.976 0 1.92.338 2.671.954-.034.018-.092.05-.131.073l-4.44 2.53a.71.71 0 00-.365.623l-.003 6.173v.002zm1.02-2.168L12 9.25l2.414 1.375v2.75L12 14.75l-2.415-1.375v-2.75z
```

**Copilot**（`icons/copilot-icon.tsx:10-16`）`viewBox="0 0 512 416"`，两条 path：
```
<path fill-rule="nonzero" d="M181.33 266.143c0-11.497 9.32-20.818 20.818-20.818 11.498 0 20.819 9.321 20.819 20.818v38.373c0 11.497-9.321 20.818-20.819 20.818-11.497 0-20.818-9.32-20.818-20.818v-38.373zM308.807 245.325c-11.477 0-20.798 9.321-20.798 20.818v38.373c0 11.497 9.32 20.818 20.798 20.818 11.497 0 20.818-9.32 20.818-20.818v-38.373c0-11.497-9.32-20.818-20.818-20.818z"/>
<path d="M512.002 246.393v57.384c-.02 7.411-3.696 14.638-9.67 19.011C431.767 374.444 344.695 416 256 416c-98.138 0-196.379-56.542-246.33-93.21-5.975-4.374-9.65-11.6-9.671-19.012v-57.384a35.347 35.347 0 016.857-20.922l15.583-21.085c8.336-11.312 20.757-14.31 33.98-14.31 4.988-56.953 16.794-97.604 45.024-127.354C155.194 5.77 226.56 0 256 0c29.441 0 100.807 5.77 154.557 62.722 28.19 29.75 40.036 70.401 45.025 127.354 13.263 0 25.602 2.936 33.958 14.31l15.583 21.127c4.476 6.077 6.878 13.345 6.878 20.88zm-97.666-26.075c-.677-13.058-11.292-18.19-22.338-21.824-11.64 7.309-25.848 10.183-39.46 10.183-14.454 0-41.432-3.47-63.872-25.869-5.667-5.625-9.527-14.454-12.155-24.247a212.902 212.902 0 00-20.469-1.088c-6.098 0-13.099.349-20.551 1.088-2.628 9.793-6.509 18.622-12.155 24.247-22.4 22.4-49.418 25.87-63.872 25.87-13.612 0-27.86-2.855-39.501-10.184-11.005 3.613-21.558 8.828-22.277 21.824-1.17 24.555-1.272 49.11-1.375 73.645-.041 12.318-.082 24.658-.288 36.976.062 7.166 4.374 13.818 10.882 16.774 52.97 24.124 103.045 36.278 149.137 36.278 46.01 0 96.085-12.154 149.014-36.278 6.508-2.956 10.84-9.608 10.881-16.774.637-36.832.124-73.809-1.642-110.62h.041zM107.521 168.97c8.643 8.623 24.966 14.392 42.56 14.392 13.448 0 39.03-2.874 60.156-24.329 9.28-8.951 15.05-31.35 14.413-54.079-.657-18.231-5.769-33.28-13.448-39.665-8.315-7.371-27.203-10.574-48.33-8.644-22.399 2.238-41.267 9.588-50.875 19.833-20.798 22.728-16.323 80.317-4.476 92.492zm130.556-56.008c.637 3.51.965 7.35 1.273 11.517 0 2.875 0 5.77-.308 8.952 6.406-.636 11.847-.636 16.959-.636s10.553 0 16.959.636c-.329-3.182-.329-6.077-.329-8.952.329-4.167.657-8.007 1.294-11.517-6.735-.637-12.812-.965-17.924-.965s-11.21.328-17.924.965zm49.275-8.008c-.637 22.728 5.133 45.128 14.413 54.08 21.105 21.454 46.708 24.328 60.155 24.328 17.596 0 33.918-5.769 42.561-14.392 11.847-12.175 16.322-69.764-4.476-92.492-9.608-10.245-28.476-17.595-50.875-19.833-21.127-1.93-40.015 1.273-48.33 8.644-7.679 6.385-12.791 21.434-13.448 39.665z"/>
```

**OpenCode**（`icons/opencode-icon.tsx:10-17`）`viewBox="96 64 288 384"`
```
<path d="M320 224V352H192V224H320Z" opacity="0.4"/>
<path fill-rule="evenodd" clip-rule="evenodd" d="M384 416H128V96H384V416ZM320 160H192V352H320V160Z"/>
```

**Pi**（`icons/pi-icon.tsx:10-17`）`viewBox="100 100 600 600"`
```
<path fill-rule="evenodd" d="M165.29 165.29 H517.36 V400 H400 V517.36 H282.65 V634.72 H165.29 Z M282.65 282.65 V400 H400 V282.65 Z"/>
<path d="M517.36 400 H634.72 V634.72 H517.36 Z"/>
```

**Oh My Pi（omp）**（`icons/omp-icon.tsx:10-12`）`viewBox="4 4 56 56"`
```
<path d="M10 14h44v9H43v33h-9V23h-9v22h-9V23H10z"/>
```

**兜底 / 自定义提供方：lucide `Bot`**（lucide-react-native 0.546.0，`node_modules/lucide-react-native/dist/esm/icons/bot.js`）。lucide 默认属性：`viewBox 0 0 24 24; fill none; stroke currentColor; stroke-width 2; stroke-linecap round; stroke-linejoin round`。
```
<path d="M12 8V4H8"/>
<rect width="16" height="12" x="4" y="8" rx="2"/>
<path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>
```
ACP 目录无 SVG 时用 lucide `PackagePlus`（`package-plus.js`）：`M16 16h6`、`M19 13v6`、`M21 10V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l2-1.14`、`m7.5 4.27 9 5.15`、`polyline 3.29 7 12 12 20.71 7`、`line 12,22 → 12,12`。

**品牌色 PROVIDER_BRAND_COLORS**（`provider-icons.ts:48-56`，不随主题）：`claude #d97757`、`codex #3941ff`、`gemini #207cfe`、`kimi #1783ff`、`kiro #9046ff`、`minimax #e73562`、`omp #9b4dff`。copilot / opencode / pi 没有品牌色。

**彩色 SVG**（`assets/provider-color-icons.ts`）：codex、gemini、kimi、kiro、minimax、omp 有；claude 没有（brand 时用单色 Claude + `#d97757`）。omp 彩色版：`viewBox 0 0 64 64`，`rect 64×64 rx12 fill #0f0a14` + 渐变 `#ed4abf → #9b4dff → #5ad8e6` 的 `M14 16h36v8H40v32h-8V24h-6v22h-8V24h-4z`（第 13 行）。

**本页用到的其它 lucide 图标（仅名称）**：`Boxes`（页头）、`ChevronRight`、`MoreHorizontal`、`Trash2`、`Search`、`ExternalLink`、`PackagePlus`、`Plus`、`FileText`、`RotateCw`、`Copy`、`AlertTriangle`、`XCircle`、`CheckCircle2`、`X`、`ArrowLeft`、`Pencil`、`Square`、`SquareCheck`、`Check`、`ChevronDown`、`Info`。

---

## 8. zh-CN 文案

文件 `i18n/resources/zh-CN.ts`（`settings.sections` 在 2061 行起，`settings.hostSections` 2094，`settings.providers` 2706，`apiEndpoints` 2782，`providerCatalog` 1635）。未翻译的键原样保留英文，照抄即可。

### 8.1 外壳

| key | zh-CN |
|---|---|
| settings.title | 设置 |
| settings.backToWorkspace | 返回 |
| settings.groups.app | 应用 |
| settings.groups.host | 主机 |
| settings.hostPicker.switchHost | 切换主机 |
| settings.hostPicker.local | 本机 |
| settings.addHost | 添加主机 |
| settings.groupInfo | 关于 {{title}} |
| settings.sections.general / appearance / layout / editor / shortcuts / integrations / notifications / permissions / diagnostics / about | 通用 / 外观 / Layout / 编辑器 / 快捷键 / 集成 / 通知 / 权限 / 诊断 / 关于 |
| settings.hostSections.host / projects / connections / agents / metadata / workspaces / providers / usage / terminals / plugins | 概览 / 项目 / 连接 / Agents / 元数据 / Workspaces / Providers / 价格表 / Terminals / 插件 |
| openProject.tiles.pairDevice.title | 配对设备 |
| common.actions.back / cancel / close / copy / dismiss / retry / search | 返回 / 取消 / 关闭 / 复制 / 关闭 / 重试 / 搜索 |
| common.states.copied / copiedLabel | 已复制 / 已复制 {{label}} |

### 8.2 settings.providers.*

| key | zh-CN |
|---|---|
| title | Providers |
| addProvider | 添加 Provider |
| providerDetails | {{name}} Provider 详情 |
| enableProvider | 启用 {{name}} |
| unavailable | 连接到这个 Host 以查看 Providers |
| loading | 正在加载... |
| addErrorTitle | 无法添加 Provider |
| updateErrorTitle | 无法更新 Provider |
| actions.menu | {{name}} actions |
| actions.remove | Remove provider |
| actions.removing | Removing... |
| remove.confirmTitle | Remove {{name}}? |
| remove.confirmMessage | This deletes the provider entry from config.json. It cannot be undone. |
| remove.confirm | Remove |
| remove.errorTitle | Unable to remove provider |
| statuses.disabled / loading / error / available / notInstalled | 已禁用 / 正在加载 / 错误 / 可用 / 未安装 |
| models.one / many | 1 个 Model / {{count}} 个 Model |
| models.addModel | 添加 Model |
| models.addCustomTitle | 添加自定义 Model |
| models.modelId | Model ID |
| models.modelIdPlaceholder | 例如 openai/gpt-5 |
| models.add / adding | 添加 / 正在添加... |
| models.failedToSave | 保存 Model 失败 |
| models.removeModel | 移除 {{id}} |
| models.searchPlaceholder | 搜索 Models |
| models.loading | 正在加载 Models... |
| models.retry / retrying | 重试 / 正在重试... |
| models.noSearchMatches | 没有匹配搜索的 Model |
| models.noneDetected | 未检测到 Model |
| models.discovered | 已发现 |
| models.custom | 自定义 Models |
| models.updated | 已更新 {{time}} |
| diagnostic.title / button | 诊断 / 诊断 |
| diagnostic.refresh / refreshing | 刷新 / 正在刷新... |
| diagnostic.copyLabel | 诊断 |
| diagnostic.copyAccessibility | 复制诊断 |
| diagnostic.copyFailed | 复制诊断失败 |
| diagnostic.refreshAccessibility / refreshingAccessibility | 刷新诊断 / 正在刷新诊断 |
| diagnostic.running | 正在运行诊断... |
| diagnostic.none | 没有可用诊断 |
| diagnostic.failedToFetch | 获取诊断失败 |
| diagnostic.unknownError | 未知错误 |
| install.howTo / howToFor | 如何安装 / 如何安装 {{name}} |
| install.title | 安装 {{name}} |
| install.hostHint | 在运行 Osuna daemon 的机器上执行 |
| install.choosePlatform | 选择 Host 的操作系统 |
| install.copy | 复制 |
| install.copyAccessibility | 复制 {{command}} |
| install.copyLabel | 命令 |
| install.copyFailed | 复制命令失败 |
| install.docs / docsFor | 官方文档 / {{name}} 官方文档 |

### 8.3 settings.providers.apiEndpoints.*

| key | zh-CN |
|---|---|
| title | 第三方接口 |
| add / addAccessibility | 添加 / 添加第三方接口 |
| loading | 正在加载第三方接口… |
| loadFailed | 无法加载第三方接口 |
| official | 官方 |
| officialHint | 沿用 {{name}} 自身的配置，通常是订阅登录 |
| inUse / use / useAccessibility | 使用中 / 使用 / 使用 {{name}} |
| editAccessibility / deleteAccessibility | 编辑 {{name}} / 删除 {{name}} |
| modelCount_one / modelCount_other | {{count}} 个模型 / {{count}} 个模型 |
| switchTitle | 将 {{provider}} 切换到 {{name}}？ |
| switchOfficialTitle | 将 {{provider}} 切回官方？ |
| switchMessage | 这会改写 {{provider}} 自身的配置文件。 |
| switchConfirm | 切换 |
| delete / deleteTitle | 删除 / 删除 {{name}}？ |
| deleteMessage | 此主机上保存的地址、API key 和模型都会被移除。 |
| deleteActiveMessage | 它正在使用中，{{provider}} 会先切回官方，然后再删除。 |
| saveActiveTitle | 保存对 {{name}} 的修改？ |
| saveActiveMessage | 它正在使用中，保存后会立即按新配置改写 {{provider}} 自身的配置文件。 |
| saveActiveConfirm | 保存 |
| impact.sessions | {{count}} 个正在运行的 {{provider}} 会话会立即改用新配置。 |
| impact.sessionsMaybe | {{count}} 个正在运行的 {{provider}} 会话可能受影响。 |
| impact.noSessions | 当前没有正在运行的 {{provider}} 会话。 |
| impact.terminal | 终端里的 {{provider}} 也会跟着切换。 |
| codexVersionUnsupported | 请先把 Codex 升级到 0.118.0 或更高版本，才能使用第三方接口。 |
| configUnparsable | 无法解析 {{provider}} 的配置文件，未做任何改动。 |
| configConflict | 写入期间 {{provider}} 的配置文件一直在被改动，未做任何改动。请重试。 |
| health.modifiedExternally | {{provider}} 的配置文件已被外部修改 |
| health.unparsable | 无法解析 {{provider}} 的配置文件。修好之前，Osuna 不会写入它。 |
| health.codexProfileOverride | 有一个 Codex profile 覆盖了第三方接口，切换可能不生效。请从该 profile 中删除 model_provider 和 model，或不再选用它。 |
| health.officialTarget | 当前 {{provider}} 自身配置指向 {{url}} |
| health.reapply / switchToOfficial | 重新应用 / 切回官方 |
| health.reapplyTitle | 重新将 {{name}} 应用到 {{provider}}？ |
| health.reapplyMessage | 这会把接口重新写入 {{provider}} 自身的配置文件，覆盖外部对 Osuna 所管理的键的改动。 |
| inheritedNote | 也会走 Claude Code 启用的第三方接口 {{name}}：Claude 的 settings.json 里的 env 优先于这个提供方的环境变量。 |
| form.createTitle / editTitle | 新建第三方接口 / 编辑第三方接口 |
| form.name / namePlaceholder | 名称 / OpenRouter |
| form.baseUrl / baseUrlInvalid | Base URL / 请输入以 http:// 或 https:// 开头的地址 |
| form.apiKey / apiKeyPlaceholder / apiKeySavedPlaceholder | API key / 粘贴 API key / 已设置，留空则保留 |
| form.models / modelsHint | 模型 / 从这个接口拉取模型列表，勾选要用的模型。 |
| form.fetchModels / refetchModels | 拉取模型 / 重新拉取 |
| form.searchModels / clearSearch | 搜索模型（共 {{count}} 个） / 清除搜索 |
| form.noUpstreamModels | 接口没有返回模型，请在下方手动添加模型 ID。 |
| form.noMatchingModels | 没有匹配的模型 |
| form.moreModelsHidden | 另有 {{count}} 个未显示，输入关键词缩小范围。 |
| form.modelsUnsupported | 这个接口不支持列出模型，请在下方手动添加模型 ID。 |
| form.fetchTimeout | 接口没有及时响应。 |
| form.testConnection | 测试连接 |
| form.testHint | 从这台主机用选中的模型发一条简短消息。它只验证接口本身：CLI 这一侧的问题（比如 Claude 的登录冲突）要到第一次真实对话时才会暴露，遇到时可以在终端里试试 /logout。 |
| form.testPick / testing | 选择模型并测试 / 正在测试... |
| form.testMenuTitle | 用这个模型测试 |
| form.testSucceeded / testFailed | 连接成功 / 连接失败 |
| form.testProtocolUnsupported | 这个地址没有 {{provider}} 需要的 {{protocol}} 协议。请检查 Base URL，或换一个支持它的接口。 |
| form.selectedModels | 使用的模型 |
| form.modelIdPlaceholder | 手动添加模型 ID |
| form.addModel | 添加 |
| form.noModels | 至少勾选或添加一个模型 |
| form.default / makeDefault | 默认 / 设为默认 |
| form.removeModel | 移除 {{id}} |
| form.mapping / mappingHint | 模型映射（可选） / 终端里 /model opus 这类别名和后台任务会改用映射的模型；未映射的档位不写入。 |
| form.mappingTitle / unmapped | {{tier}} 映射到 / 不映射 |
| form.save / saving | 保存 / 正在保存… |

相关的其它键：`usage.planUsage.apiEndpointNote` = 当前使用第三方接口 {{name}}，此额度不代表实际消耗。`agentStream.apiEndpointMode.*`（会话模式不一致提示，5 条）不在设置页。

### 8.4 providerCatalog.*

| key | zh-CN |
|---|---|
| title | 添加 provider |
| search | 搜索 providers |
| noProviders | 未找到 providers |
| actions.add / adding | 添加 / 正在添加 |
| actions.installed | 已安装 |
| actions.cancel | 取消 |
| actions.installInstructions | 安装说明 |
| actions.installInstructionsFor | {{provider}} 安装说明 |
| errors.unableToInstall | 无法安装 provider |

---

## 9. 未能解析或需注意的点

- 无显式 `lineHeight` 的文字（Button、ScreenTitle、sheet 标题、菜单外的 RN Text 等）行高是浏览器 `normal`，精确像素取决于系统字体，源码里没有数值。
- lucide 图标的完整 path 只列了 `Bot` 与 `PackagePlus`；其余按名称从 lucide 0.546.0 取（与 `lucide-react-native` 版本一致）。
- Claude / Codex / Copilot 的 path 已由脚本从源码逐字提取。
- ACP 目录条目的远程图标（`data/acp-provider-catalog`、`assets/acp-provider-icons`）未逐个提取。
- Tooltip（仅 `info` 用）、Combobox 弹层、菜单打开动画未在本页展开。
- 主机 label（HostPicker 显示值）来自用户的主机配置，不是固定文案。
