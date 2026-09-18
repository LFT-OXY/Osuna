# Journal - oxy (Part 1)

> AI development session journal
> Started: 2026-09-16

---

## 2026-09-17 工单 01 人工验收通过

- dev 桌面端验证时 Codex 一度没有输入框底色，根因是 `packages/desktop/scripts/dev-runner.mjs` 注入的 `FORCE_COLOR=1` 让 Codex 进入 16 色模式；daemon 应答本身 2.7 ms 内到齐。用 `FORCE_COLOR=3` 启动 dev desktop 后用户确认浅色/深色均正常。
- 待决定的后续项：dev-runner 的 FORCE_COLOR 泄漏是否单开一票；探测应答中的 `ESC[?0u` 来源未查明。

## 2026-09-17 工单 02 人工验收：Codex 不订阅 2031

- 浅色启动 Codex 正常，切深色后输入框仍白底，重启后变深色底。daemon 在深色下对 OSC 11 已回答深色值，推送链路无误。
- 字节检查：Codex 0.154.0、Claude Code 2.1.258 只含 `]11;?`，无 `?2031h`/`?996n`；Pi（`terminalColorSchemeNotificationsEnabled`）与 opencode 1.15.10 含 `?2031h`。
- 用户选择改验收对象为 Pi/opencode，PRD 与工单已改，研究文档补更正。

## 2026-09-17 工单 03 实现：对称内边距与对比度修正

- 内边距与对比度都放在共享 xterm 运行时：`contentInset` 由 web 宿主传 `SPACING[2]`，运行时以 border-box padding 缩进 host，FitAddon 只量 host 所以行列自然按内框算；对比度按主题深浅取 4.5/3，深浅口径与 daemon 的 `?996n` 相同（背景亮度低于前景即深），只在值变化时写入。
- 浅色 ANSI white/brightWhite 改为 `#71717a` / `#8a8a92`（对白底 4.8:1 / 3.4:1）。
- 审查处置：WebView 内边距按 PRD 排除；WebView 会随共享运行时得到对比度修正，已写进 PRD Out of Scope；深浅判定口径写进 PRD 与工单。留白放运行时而非组件是判断题，保留（PRD 把几何测试钉在 runtime 浏览器测试）。
- 环境：本机原缺 Playwright Chromium，已 `npx playwright install chromium`；runtime 浏览器测试不加载 xterm.css，`.xterm-screen` 几何无意义。
- 待人工验收：留白肉眼对称、浅色下 ANSI white 可读、深色高亮无变化。

## 2026-09-18 工单 02 实现：作用域三档、搜索与刷新

- 作用域 store 放在 `session-history/internal/scope-store.ts`（feature 自有偏好，`stores/` 不能反向引 `internal/`）；project 作用域用新选择器 `useProjectWorkspaceDirectories` 按 map 身份记忆。
- 刷新不自写监听：`isVisible = useAppActivelyVisible() && useRetainedPanelActive()` 门控 `enabled`，React Query 重新启用即刷新。
- 渲染型测试必须在 `packages/app` 下跑；从仓库根跑会因 reanimated 未转译报 `SyntaxError: Unexpected token 'typeof'`（HEAD 上工单 01 的测试同样如此）。
- 审查处置：providerErrors 标题用 provider id（显示名需拉 providers snapshot，超出接缝）；目录显示按 PRD 字面（根目录空白、worktree 全路径），daemon 是等价匹配所以 project 作用域几乎不会出现相对路径——交用户决定。

## 2026-09-18 工单 03 实现：Paseo 曾拥有的会话

- 协议只加不改：请求 `includeImported`、descriptor `importedAgentId` + `importedAgentWorkspaceId`、能力位 `sessionHistory`（v0.8.1，COMPAT 到 2027-03-18）。workspaceId 是审查后补的：History 的 `navigateToAgent` 靠它落 workspace tab 并 pin，已归档 agent 不在 session store，缺了它会退到 host 详情路由丢 pin。PRD 已同步。
- daemon 所有者收集顺序：活 agent → 未归档记录 → 已归档记录，首写者胜，`sessionId` 与 `nativeHandle` 都建键；`includeImported` 缺省时过滤分支与取数 limit 原样不动。
- app 门控在 runtime-wired wrapper（`useHostFeature`）里，surface 只收 `isSupported` 与 `onOpenAgent(agentId, workspaceId)` 回调，测试不碰 router。
- 审查处置：两轮共 5 项硬性（对象参数、收紧 `agentId`、命名返回类型与 candidates、workspaceId）已修；判断项采纳合并 owner 循环、去中间层、行模型 `string | null`、COMPAT 标签移到早返回块；未采纳双参数改对象、`as StoredAgentRecord` 沿用既有。
- 坑：client 的 vitest 从 protocol `dist` 解析，加字段后必须 `npm run build:client`；zsh 变量传文件列表不分词，改用 xargs。
- 待人工验收：点击"Paseo"行是否真的打开 tab 取决于前置任务 09-17-history-open-archived-agent。

## 2026-09-18 工单 04 实现：聚焦已有终端与行菜单

- 终端映射是 feature 自有的内存 zustand store（`session-history/internal/resume-terminals.ts`），键为 `serverId:workspaceId` → `providerId:providerHandleId`；点击时先 `listTerminals(cwd, undefined, { workspaceId })` 确认终端还在，不在就 forget 再新建。`onTerminalCreated` 改名 `onOpenTerminal`，因为 reveal 语义对新建与聚焦都成立（`revealTargetInLayout` 会找已有 tab）。
- 行改成 docs/hover.md 的外壳：plain View 管 hover，`ContextMenuTrigger` 当内层按压目标（右键 / 长按开菜单），kebab 固定槽位 opacity 隐藏；两个菜单共用 `row-menu.tsx` 的 items（`surface` 开关），与 sidebar-workspace-menu 同形。
- 导入复用 `importAgent` + `resolveImportTarget`（workspace 作用域视为 scoped listing），导入后同 workspace 走 `navigateToAgent(pin)`、跨 workspace 走 `useNavigateToImportedAgent`；复制走 `copyToClipboard` + 现有 `resumeCommandCopiedLabel` toast，两者都在 view 层。
- 坑一：`SessionHistoryView` 从 `index.tsx` 拆到 `view.tsx`——`copy-to-clipboard`（expo-clipboard）与 `use-import-session`（host-chooser、import-session-sheet）在 unit runner 下无法解析，surface 测试导入入口就整文件挂掉；用探针测试逐模块定位。
- 坑二：菜单引擎在 jsdom 里能真实渲染（bottom-sheet/safe-area 已 alias），但引擎的 9 个共享文件缺 `import React`，按 testing.md 的既定修法补上；不再像旧测试那样 mock dropdown-menu。
- 坑三：oxlint `complexity` 上限 20，surface 抽出 `resolveRowStatus` 与 `ActionErrorAlert` 才过。
- 遗留：index.tsx 第 249 行 `ReadonlyArray<…>` 的 eslint warning 来自工单 02，未动。
- 审查处置：规格轴"跨目录终端不在列表里"经核实为误报（daemon 带 workspaceId 时 `getAllTerminalSessions` 聚合全部目录再过滤），补了会话 cwd 不在 workspace 目录下的用例；本 workspace 导入后用 `navigateToAgent(pin)` 而非 workspace screen 的 `openWorkspaceTabFocused` 属判断项，已写进 PRD。标准轴无硬性违规；采纳 zustand → 模块 Map、去掉 `?? workspaceId` 兜底、测试 helper 去 `as`（改用 `vi.fn<CreateTerminal>` 与完整 capabilities）；未采纳 view.tsx 回并（桩 app 代码违反 testing.md）与 kebab 触发器抽到 components/ui（超出本票）。

## Session 1: 会话历史面板工单 06：Explorer sidebar 默认 tab 与旧布局补齐，任务验收归档

<!-- atw-session: v=2 fp=516188da9ea7e674 -->

**Date**: 2026-09-18
**Task**: 会话历史面板工单 06：Explorer sidebar 默认 tab 与旧布局补齐，任务验收归档
**Package**: app
**Branch**: `main`

### Summary

实现工单 06：session_history 加入 Explorer 种子并保持 Changes 为初始视图；持久化新增 explorerSidebarSeededTabKindsByWorkspace 标记，merge 时对旧布局补一次、用户关掉后不再出现；v1 迁移用 isDefaultExplorerSidebarTabKind 统一判定默认 kind。两轴审查 3 处硬违规已修（as 强转、readonly string[] 改字面量联合、文档表格与段落不一致）。规范回填 state-management.md 新增 Making a tab an Explorer default。dev 桌面端手测通过后完成 12 条验收（第 6 条归档 agent 分支由前置任务 09-17-history-open-archived-agent 承接），任务归档。

### Git Commits

| Hash        | Message                                                                           |
| ----------- | --------------------------------------------------------------------------------- |
| `00a6b9a39` | feat(session-history): 会话历史成为 Explorer sidebar 默认 tab，旧布局加载时补一次 |

### Status

[OK] **Completed**

## Session 2: 实现并归档 more-ui-themes：13 套深浅色主题变体、终端 ANSI 随主题、跟随系统配对

<!-- atw-session: v=2 fp=76beaa9bf2d0fa47 -->

**Date**: 2026-09-18
**Task**: 实现并归档 more-ui-themes：13 套深浅色主题变体、终端 ANSI 随主题、跟随系统配对
**Package**: app
**Branch**: `main`

### Summary

按 PRD 实现 13 套 UI 主题变体（8 深 5 浅），THEME_OPTIONS 分组改为 primary/dark/light；主题配置新增可选 terminalAnsi/terminalSelectionBackground；AppSettings 新增 autoDarkTheme/autoLightTheme，外观 provider 改为纯函数 resolveActiveTheme + useColorScheme 显式 setTheme；设置页 System 下出现深浅色配对两行，九语言补标签；快捷键只在三主值轮转。双维度审查两轮，裁决：深色 14 彩色键照抄、black/brightBlack 来自 tint 并要求 1.5/2:1；Solarized Light 文本三档下移一档；浅色 brightBlack 纳入 3:1。Playwright 接 Electron CDP 留设置页截图证据；TUI 观感未验收。styling.md 与 PRD 已同步。

### Git Commits

| Hash        | Message                                                                                       |
| ----------- | --------------------------------------------------------------------------------------------- |
| `8eadc588b` | feat(theme): 新增 13 套深浅色 UI 主题变体，终端 ANSI 随主题派生，跟随系统可分别配对深浅色主题 |

### Status

[OK] **Completed**

## Session 3: 计划（Schedules）功能面文案接入 i18n，补齐 9 种语言

<!-- atw-session: v=2 fp=c186bddcf88843d2 -->

**Date**: 2026-09-18
**Task**: 计划（Schedules）功能面文案接入 i18n，补齐 9 种语言
**Package**: app
**Branch**: `main`

### Summary

计划列表页、新建/编辑表单、列表行、删除确认、频率预设与 cron 派生描述全部改为 t() 取值；schedule-format 纯函数改为返回 ScheduleDescription（翻译键+参数/原文）由组件层渲染；新增顶层 schedules 命名空间，9 种语言键集一致，en 与原硬编码逐字相同；Schedule=计划、Heartbeat=心跳 记入 glossary；模式写入 .atw/spec component-guidelines Copy 小节。验证：typecheck/lint、84 个单测、e2e schedules-project-target 4/4、dev 桌面端 zh-CN 截图。教训：不要跑全仓 npm run format；task.py archive 自动提交会被 task.json 缺尾换行挡住。

### Git Commits

| Hash        | Message                                                 |
| ----------- | ------------------------------------------------------- |
| `f994fdea9` | feat(schedules): 计划功能面文案接入 i18n，补齐 9 种语言 |

### Status

[OK] **Completed**
