# Osuna UI 现状（2026-09-26 只读统计，grep 估算 ±10%）

## 结论

token 化程度高，换皮便宜；但没有 Text / Row / Card 等排版 primitive，排版样式分散在 278 个组件文件各自的 `StyleSheet.create`（约 1.5 万行），改组件外观成本陡增。

## token 与主题

- 全部在 `packages/app/src/styles/theme.ts`（1558 行）：`baseColors` :5；语义色 `buildLightSemanticColors` :272 / `buildDarkSemanticColors` :403（约 36 key：surface0-4、sidebar、foreground 三级、border、accent、destructive、popover、input、ring…，内嵌终端 ANSI）；`SPACING` :572；`FONT_SIZE` :589；`LINE_HEIGHT` :601（只有 diff）；`ICON_SIZE` :605；`FONT_WEIGHT` :612；`BORDER_RADIUS` :619；阴影 `darkShadow` :685 / `lightShadow` :1075。
- 20 套主题（14 暗 6 亮）全部经 `buildDarkTheme` :706 / `buildLightTheme` :1096 两个 builder；目录 `THEME_OPTIONS` :1338，注册表 `REGISTERED_THEMES` :1546；插件主题 `plugins/themes/index.ts`。
- 部分色阶是生成的，受 `styles/theme.test.ts`、`terminal/runtime/terminal-contrast.test.ts` 对比度约束。
- 其他样式文件：`styles/markdown-styles.ts`、`styles/settings.ts`、`styles/usage-palette.ts`、`styles/identity-colors.ts`、`components/ui/control-geometry.ts`；断点 `styles/unistyles.ts`（sm 576 / md 720 / lg 992 / xl 1200）。
- 约定文档：`docs/design.md`、`docs/unistyles.md`。

## 硬编码

- hex 40 处 / 16 文件（多为终端、品牌色）；rgba 34 处；直接用 `colors.palette.*` 71 处 / 38 文件。
- 魔法数字集中在 `components/usage/*`。
- icon `size={N}` 硬编码 311 处（token 仅 51 处）。
- `useUnistyles()` 存量 94 处 / 56 文件（规范禁用）。

## 组件层

- primitive：`components/ui/`（49 个，含 Button、DropdownMenu、ContextMenu、menu 引擎、Combobox、Tooltip、text-input、form-field、isolated-bottom-sheet-modal…）、`components/headers/`、`components/adaptive-modal-sheet.tsx`。
- 交互控件约七成走 primitive；`<Text>` 直接用 1004 处 / 217 文件，`<View>` 1749 处。

## 规模与结构

- 非测试 tsx 494 个（约 136k 行）；路由 23 页（`packages/app/src/app/`）。
- 巨型文件：`screens/workspace/workspace-screen.tsx` 4425、`components/message.tsx` 3242、`components/sidebar-workspace-list.tsx` 2802、`composer/index.tsx` 2707、`screens/new-workspace-screen.tsx` 2616。
- 平台分叉 tsx 43 个；`useIsCompactFormFactor` 87 处 / 75 文件。
- 桌面布局：左侧栏（项目 → 工作区）｜ workspace 头 + 多 tab 分屏（agent / 终端 / 文件 / diff）｜ 右侧 Explorer（Files / Changes / Session history，Cmd+E），见 `docs/explorer-sidebar.md`、`docs/design.md` §9。

## 测试影响

- 无视觉回归基线。e2e 208 个 spec：`getByTestId` 1724、`getByRole` 840、`getByText` 478；`toHaveCSS` / getComputedStyle 约 24 文件，几何断言 56 文件（换皮时先断）。
- 换皮基本只打破 CSS 断言 spec 与 theme 单测；保持 testID 与英文文案不变可大幅减少 e2e 改动。

## 外围

- `packages/website/src/styles.css:662-736` 手抄了 theme.ts 色值；`src/components/mockup/`（约 3.2k 行）仿写 app 界面。
- `packages/desktop/src/window/window-manager.ts:47` 窗口背景硬编码 `#181B1A` / `#ffffff`。

## 分层成本估算

| 层级 | 波及文件 |
|---|---|
| 换皮（token / 主题） | 约 10–60 |
| 组件外观 | 约 150–280（先补 Typography / Row primitive） |
| 布局 / 信息架构 | 大部分 tsx（本任务已决定不做） |
