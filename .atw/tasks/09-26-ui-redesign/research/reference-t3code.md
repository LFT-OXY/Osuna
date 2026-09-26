# 参考：t3code（主参考）

根目录 `T3/` = `/Users/oxy/Documents/Configuration/dev-environment/demo/源码/t3code`

## 为什么是主参考

同为 AI 编码 agent GUI，与 Osuna 可比性最高；自带 Expo/RN 客户端（`T3/apps/mobile`，Uniwind），web 与 RN 共享一份不透明 hex 色板 `T3/packages/shared/src/themePalettes.ts`（57 个语义角色，角色清单 :47-105，默认主题 :131-249，5 套品牌主题 :251-886）。

## 技术栈

- Web（Desktop 共用）：React 19 + Vite + TanStack Router；Tailwind v4 + CSS 变量 + cva；shadcn 风格但底层 Base UI（`components.json` style `base-mira`，baseColor zinc）；lucide；全局 token `T3/apps/web/src/index.css`（2219 行）。
- Mobile：Uniwind、tabler 图标 / SF Symbols、reanimated 4、`@legendapp/list`。

## 关键 token（默认主题）

| 角色 | Light | Dark |
|---|---|---|
| canvas / chrome | #fcfcfc | #0a0a0a |
| surface（card / popover） | #ffffff | #111111 |
| text | #27272a | #f5f5f5 |
| textMuted | #71717b | #818181 |
| border | #e4e4e7 | #191919 |
| input | #d4d4d8 | #1e1e1e |
| accent / focus / 发送 | #1b4ed8 | #346bf1 |
| messageSurface（用户气泡） | #f4f4f5 | #141414 |
| sidebar | #fafafa | #000000 |
| sidebarRow hover / active / selected | #fcfcfc / #fff / #fff | #131313 / #1a1b1b / #111111 |
| error / warning | #fb2c36 / #fe9a00 | #fb414a / #fe9a00 |

- 暗色表面多为 white 3–6% 叠在近黑上（`index.css:1094-1114`）。
- 字号：Tailwind 默认 + `text-2xs` 11 / `text-3xs` 10（`index.css:166-169`）；正文与消息 14px relaxed。Mobile 阶梯 `T3/apps/mobile/src/lib/typography.ts`（11/14、12/16、13/17、14/19、16/23、18/23、21/28、26/32、30/36）。
- 字重基本 400 / 500，markdown 标题 600。
- 圆角 base 10：sm 6 / md 8 / lg 10 / xl 14 / 2xl 18 / 3xl 22；控件 8（`index.css:92,259-264`）。composer `rounded-3xl`，用户气泡与对话框 `rounded-2xl`，菜单与代码块 `rounded-lg`。
- 阴影极轻；composer `0 12px 28px -18px rgb(0 0 0/40%)`；暗色多去阴影改 `inset 0 1px white/4%`。
- 毛玻璃 `surface-glass` / `dropdown-glass` / `dialog-glass`：blur 12（暗 16）、背景 80%、saturate 1.14（`index.css:107-109,316-400`）；全局噪点 0.035（`:1619-1636`）。
- 语义间距：sidebar inset 8、行内 10、workspace gutter 12 / 20、顶栏 52（`index.css:93-129`）。
- 字体：系统字体栈（`index.css:155-159`）。

## 视觉特征

高密度（sidebar 行 32、按钮 32 / xs 24、右面板 tab 24）；分层靠底色明度与淡边框；几乎不卡片化（助手回复纯文本 80% foreground，工具调用单行）；hover `bg-accent`，按下 `scale-[0.97]`，焦点 `ring-2`；图标 16，元数据 12–14，muted 60%；进行中用 `steps()` 低频扫光并在不可见时暂停；滚动条 6px + 边缘渐隐；面板动画默认 0ms。

## 关键组件位置

- 外壳 `T3/apps/web/src/components/AppSidebarLayout.tsx:287-327`；sidebar 宽 256（208–，主区至少留 640）`threadSidebarWidth.ts`。
- Sidebar 线程行 `T3/apps/web/src/components/Sidebar.tsx:957-1983`：富版 78px 三行（:1757），紧凑 36px（:1596），状态色 :1125-1175，Settled 折叠组 :638-700。
- Tab `RightPanelTabs.tsx:1108-1230`（24px、`rounded-md`、text-xs、hover 显示关闭）。
- 用户消息 `chat/MessagesTimeline.tsx:2088`（`max-w-[80%] rounded-2xl bg-message p-3`）；工具调用 :3318-3350，展开 :4437-4438；思考 :2681-2872；Working 状态行 :2507-2540。
- Changed files `chat/ChangedFilesTree.tsx:52-113`；代码块 `ChatMarkdown.tsx:1009-1060`。
- Composer `chat/ComposerSurface.tsx`、`chat/ChatComposer.tsx:6944-7052`、`ComposerControl.tsx:17-26`、发送 / 停止 `ComposerPrimaryActions.tsx:217-247`。
- Diff `diffs/StyledDiffCodeView.tsx`、`DiffPanel.tsx:839-975`；终端浮动按钮组 `ThreadTerminalDrawer.tsx:1445-1490`。
- 菜单 `ui/menu.tsx:51,88`；命令面板 `ui/command.tsx`；对话框 `ui/dialog-styles.ts:8-14`；toast `ui/toast.tsx:532-570`。
- 设置：`settings/SettingsSidebarNav.tsx`、`SettingsGroup.tsx:15-28`（`rounded-xl border-border/60 bg-card/40`）、`settingsLayout.tsx:424-455`。
- 规范来源：`T3/.macroscope/check-run-agents/ui-consistency.md`、`T3/AGENTS.md` Taste 节（调用处禁止 restyle primitive）。

## 迁移到 RN + unistyles

- 可直接映射：色板 hex、字号阶梯、圆角 / 控件高 / 布局尺寸、`@legendapp/list`、简单盒模型组件。
- web-only 需替代：hover（RN Web 用 Pressable hovered，原生常显）、毛玻璃（原生降级）、`color-mix` / CSS 变量级联（预计算 rgba 或 JS 函数，参考 `T3/apps/mobile/src/lib/mobileThemeVariables.ts`）、composer `clip-path` 不规则轮廓（简化）、container query（onLayout / 断点）、Base UI 行为。

## 截图

- 完整桌面（暗）：`T3/apps/marketing/src/assets/app-desktop.webp`
- 概念图：`T3/apps/marketing/public/95/t3-code-concepts/`
