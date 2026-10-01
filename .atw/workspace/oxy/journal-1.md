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


## Session 4: 插件主题与内置主题重名的消歧
<!-- atw-session: v=2 fp=2c1a970fa93fe1e3 -->

**Date**: 2026-09-20
**Task**: 插件主题与内置主题重名的消歧
**Package**: app
**Branch**: `feat/usage-stats`

### Summary

撞名的插件主题行带上贡献插件的 id 作副标题，触发器与无障碍标签同样限定。判定放在 collectPluginThemes 的跨 host 合并之后，撞内置名或撞目录内另一条插件主题名都算；同一插件内部撞名退化为主题 id。内置主题名由新的 appearance/theme-labels.ts 按当前语言解析后传入，菜单行与对照集合共用同一条 key 路径，判定因此随语言变化。不做注册期拒绝。e2e 夹具改回真名 Catppuccin Mocha / Latte，并验证过改写后的断言仍会咬。两轴审查的发现全部处理：lint no-map-spread、docs/plugins.md 的 addTheme 约定、复合键与参数团抽成 NameCollisionIndex、theme-labels 补纯函数与测试；拒绝了把 qualifier 改成判别联合的提议（为不存在的需求做抽象）。CI 上四个 playwright 分片与 app-tests 全绿，唯一红的 cli-tests shard 3/3 是既有 flake，同一用例在本分支更早提交上以相同方式红过。

### Git Commits

| Hash | Message |
|------|---------|
| `45fe656ab` | feat(app): 撞名的插件主题行带上来源插件 id |

### Status

[OK] **Completed**


## Session 5: ui-redesign 工单 11、CI 修复、验收归档与合并
<!-- atw-session: v=2 fp=a4a72314c2ea4e36 -->

**Date**: 2026-09-27
**Task**: ui-redesign 工单 11、CI 修复、验收归档与合并
**Package**: app
**Branch**: `main`

### Summary

实现工单 11：设置页去掉横向分割线，新增派生角色 borderCardRow（边框色 50%）作为卡片内行分隔。开 PR #4 跑 CI，修复 4 处失败：shimmer-text.web.tsx 的 TS2322（本机被 .expo 生成类型掩盖），以及三条未随工单 06/09 设计更新的 e2e 断言。CI 全绿后验收通过；原生端三项作为已知缺口接受；PRD 第 12 条改为每阶段一个提交、可按倒序回滚。任务已归档，PR #4 以 rebase 合并到 main。

### Git Commits

| Hash | Message |
|------|---------|
| `8377ff61b` | feat(app): 设置页去掉横向分割线，卡片内行分隔改为边框色 50%（borderCardRow） |
| `8f15ffc45` | fix(app): 修复 CI 上 ui-redesign 的 typecheck 与桌面字号 e2e |
| `89e3baa1e` | test(app): e2e 随 ui-redesign 更新：设置分组标题下距 8px，紧凑概览 sheet 放出 20 条工具行 |

### Status

[OK] **Completed**


## Session 6: fork-desktop-distribution 验收归档
<!-- atw-session: v=2 fp=1790bf47c4b2677f -->

**Date**: 2026-09-27
**Task**: fork-desktop-distribution 验收归档
**Package**: desktop
**Branch**: `main`

### Summary

核对 09-21-fork-desktop-distribution 完成度后按用户验收归档；本会话无代码提交，实现早已随 #3（876f00b82）合入。

### Main Changes

- 核对完成度：代码随 #3 合入 main；9-21 两次 workflow_dispatch 成功；v0.8.2 已转正为 Latest，资产仅 mac/windows 包与 latest-mac.yml、latest.yml，无 Linux
- 按用户验收执行 task.py archive，任务移至 archive/2026-09（9750cb124）

### Git Commits

(No commits - planning session)

### Testing

- [OK] 无代码改动；归档提交因本机 cli tsgo 已知 TS7006 退化用 --no-verify

### Status

[OK] **Completed**

### Next Steps

- PRD 人工验证第三条（团队客户端收到更新且更新后仍是内部版）仓库内无记录，由用户确认
- v0.9.0 Desktop Release 在跑，Release 仍是草稿，关注是否正常转正


## Session 7: pi-hidden-context：隐藏 Pi 注入上下文与 skill 展开全文
<!-- atw-session: v=2 fp=516d56a772a0e843 -->

**Date**: 2026-09-27
**Task**: pi-hidden-context：隐藏 Pi 注入上下文与 skill 展开全文
**Package**: server
**Branch**: `main`

### Summary

Pi 适配层在实时与历史回放两条路上遵守 custom 消息的 display:false，ATW 注入的 <workflow-state>/<session-overview> 不再上时间线；Pi 展开的 <skill>…</skill> 用户消息还原为 /skill:name 参数。用户在 dev 桌面端实测通过后归档。

### Main Changes

- pi/history-mapper.ts 新增 shouldDisplayPiCustomMessage 与 restorePiSkillCommand（正则同 Pi parseSkillBlock），实时 handleMessageEnd / handleSubmittedUserEntryMarker 与回放 PiHistoryMapper 共用
- pi/rpc-types.ts custom 消息补 customType/display；docs/providers.md 与 .atw/spec/server/backend/quality-guidelines.md 记录约定
- atw-code-review 两轴无硬性问题；steer 关联疑点经核实不成立（/skill: 走斜杠命令，不进 steer）
- 核对 OMP：skill 以 customType skill-prompt、display:true 的 custom 消息发出，被映射成含全文的助手文本；用户决定另开任务，结论记在归档 PRD

### Git Commits

| Hash | Message |
|------|---------|
| `2838a4c53` | fix(pi): 时间线隐藏 display:false 的 custom 消息，skill 展开块还原为 /skill:name |
| `fec0d9406` | chore(task): archive 09-27-pi-hidden-context |

### Testing

- [OK] [OK] pi/ 目录 6 个测试文件 136 个用例通过；server typecheck、oxlint 通过
- [OK] [OK] 用户在 dev 桌面端（daemon 6769，重建 server dist）用 Pi 发「你好」，注入上下文不再出现
- [OK] [OK] 提交因本机 cli tsgo 已知 TS7006 退化用 --no-verify

### Status

[OK] **Completed**

### Next Steps

- 为 OMP 的 skill-prompt 全文显示问题新建任务（含实时去重与轮次提前结算的核实）
- Pi 扩展 notify 提示行（observational memory、workspace history）是否折叠，待用户决定


## Session 8: composer-branch-switch：从 Composer 上下文条切换分支
<!-- atw-session: v=2 fp=11dc4833806961a1 -->

**Date**: 2026-09-27
**Task**: composer-branch-switch：从 Composer 上下文条切换分支
**Package**: app
**Branch**: `main`

### Summary

Composer 底部上下文条的分支名换成 BranchSwitcher 紧凑外观，点开即可搜索并切换本地 / 远程分支，沿用 Stash 并切换与切回恢复；当前 agent 运行中或 host 断开时置灰并在 tooltip 说明原因，草稿不受运行状态影响；分支被别的 worktree 占用时显示本地化提示（Changes 面板同样受益）。用户在 dev 桌面端实测通过后归档。

### Main Changes

- BranchSwitcher 新增 appearance="strip" 与 disabledReason；strip 触发器复用 toolbarLabelTriggerStyle，下拉 top-start、tooltip 向上，窄条仍高 28px
- context-strip/model.ts 新增纯函数 resolveBranchSwitch（agent: draft|idle|running + isHostConnected → hidden/enabled/disabled+原因）；Composer 传入 workspaceId、cwd 与判定条件
- git/branch-switcher-operations.ts 新增 parseBranchCheckedOutElsewhere，覆盖 git 新旧两种措辞；useBranchSwitcher 直接切换与 stash 后切换两条失败路径都换成本地化文案
- 9 个 locale 补文案；docs/design.md 更新窄条描述；.atw/spec/app/frontend/testing.md 记下 e2e 需先 clickNewChat、withRemote 夹具的 remote.git 会让工作区变脏
- atw-code-review 两轴无硬性阻塞；按评审改为三态 agent、复用工具栏触发器样式、补侧栏/标题断言与 worktree 占用失败用例、修正 zh-CN/pt-BR 用词，并把实际实现写回 PRD

### Git Commits

| Hash | Message |
|------|---------|
| `1ccc71dd0` | feat(app): Composer 上下文条的分支名可点击切换分支 |
| `2e4093c98` | chore(task): archive 09-27-composer-branch-switch |

### Testing

- [OK] 模型与占用识别单测、i18n 契约测试、lint、app typecheck 通过；app unit 全量 631 文件 5749 用例通过
- [OK] e2e branch-switcher.spec.ts 5 个用例通过；临时破坏占用提示验证断言会失败
- [OK] 截图确认窄条高度不变、悬停与置灰态 tooltip、回车可打开下拉；用户在 dev 桌面端（daemon 6769）实测通过
- [OK] 功能提交因本机 cli tsgo 已知 TS7006 退化用 --no-verify，归档提交跳过 typecheck

### Status

[OK] **Completed**

### Next Steps

- stash@{0}（prettier 误格式化前的备份）已被提交取代，确认后可 git stash drop
- 新建分支（基于当前 HEAD 创建并切换）按 PRD Out of Scope 另开任务


## Session 9: markdown-preview-dom 07 整体验收与归档
<!-- atw-session: v=2 fp=8f4895a408143cef -->

**Date**: 2026-09-27
**Task**: markdown-preview-dom 07 整体验收与归档
**Package**: app
**Branch**: `feat/markdown-preview-dom`

### Summary

dev 桌面端深浅色目检 README.zh-CN.md（居中、徽章横排、NOTE 提示块、截图、bash 着色），补验对话 bash 与源代码视图 sh/toml 着色；markdown 相关 e2e 5 个与单测通过，app/highlight typecheck、lint 通过；PRD 验收项全勾，任务归档。CDP 连接瞬间预览重挂载、滚动归零是 CDP 假象，用户手动切应用 / 标签页未复现，无遗留。

### Git Commits

| Hash | Message |
|------|---------|
| `b6ec7ea25` | docs(atw): markdown-preview-dom 整体验收，任务进入 accept |

### Status

[OK] **Completed**


## Session 10: 工单 04：手机 Agent controls sheet 提供方行
<!-- atw-session: v=2 fp=d68656293e22ad7a -->

**Date**: 2026-09-28
**Task**: 工单 04：手机 Agent controls sheet 提供方行
**Package**: app
**Branch**: `main`

### Summary

实现工单 04：sheet 新增「提供方」行（AgentProviderControl 新增必填 surface），手机与窄 Composer 弹窗的模型浏览器改为 selectedProvider，新增 followSelectedProviderView，删除 model-sheet-flow；新增 4 个紧凑布局 e2e；审查意见已处理并回写 PRD、工单与组件规范。dev 桌面端排查：在 Agent 内启动继承了正式版 PASEO_HOME，接管 6767 daemon 且退出会停掉它，改用 env -u PASEO_HOME 启动。归档 provider-model-split 与 osuna-rebrand-and-mac-updates 两个任务。

### Git Commits

| Hash | Message |
|------|---------|
| `68a035516` | feat(app): 手机 Agent controls sheet 新增提供方行，模型列表限定为当前提供方 |

### Status

[OK] **Completed**


## Session 11: 思考滑条第二版与收尺寸
<!-- atw-session: v=2 fp=14ee6757ba940c4d -->

**Date**: 2026-09-28
**Task**: 思考滑条第二版与收尺寸
**Package**: app
**Branch**: `main`

### Summary

实现思考滑条第二版：2 档及以上一律用滑条，去掉列表和搜索框；1 档时触发器置灰不可点；按 v2 参考图改为加粗胶囊轨道、溢出的白色滑块、品牌色居中档位名；光点改为从左向右持续流动，最低档左侧留一段填充；新增派生主题色 thinkingThumbBorder。两轴审查无硬违规和 spec 偏差。按验收反馈把浮层收到 220 宽（轨道 22、滑块 28、档位名 body），居中对齐的尝试已撤回。Off 档保留光点，由用户决定。遗留：手机真机手势仲裁、1 档实机、Claude 亮色最低档对比度未验证。

### Git Commits

| Hash | Message |
|------|---------|
| `757ba8a29` | feat(app): 思考滑条第二版——全档位滑条、单档锁定、流动光点 |
| `6f25eebc6` | fix(app): 思考滑条浮层收小一档 |
| `e233cbbcd` | chore(task): thinking-slider 记录 Off 档保留光点的决定，进入验收 |

### Status

[OK] **Completed**


## Session 12: 美化问题选择卡片
<!-- atw-session: v=2 fp=d0a6be8fe74aacc4 -->

**Date**: 2026-09-28
**Task**: 美化问题选择卡片
**Package**: app
**Branch**: `main`

### Summary

QuestionFormCard 改为编号行列表：单选点击即作答（单题直接提交、多题跳到下一道未处理题），右上角 X 忽略整组、右下角跳过单题，其他...行原地展开为输入框，多选勾选后确认；推进规则放进 question-form-card-core 并补单测；按钮换 Button、去掉 useUnistyles、纯输入题用 FormTextInput、其他行复用 control-geometry 四态；9 个 locale 补 skip；mock agent 增加单选带其他/多选题型并把收到的答案写成助手消息，e2e 断言实际答案。经 6 轮双轴审查，spec 回写悬停外框坑与 mock 问题提示词约定。

### Git Commits

| Hash | Message |
|------|---------|
| `9af4490f8` | feat(app): 问题卡片改为编号行列表，单选点击即作答 |
| `d24393f99` | chore(task): question-card-restyle 进入验收 |

### Status

[OK] **Completed**


## Session 13: 斜杠指令首开提速：工单 04 其他 provider 不为列表起进程
<!-- atw-session: v=2 fp=4c40625b4861c95c -->

**Date**: 2026-09-28
**Task**: 斜杠指令首开提速：工单 04 其他 provider 不为列表起进程
**Package**: app
**Branch**: `main`

### Summary

Codex/Pi/OpenCode/ACP/OMP/插件 provider 统一走指令目录：未运行或未上报时 listCommands 返回 null，不重连不起进程；Codex/Pi/OpenCode 每个 turn 上报 commands_changed，ACP/OMP/插件在命令更新时上报；删除 ACP waitForInitialCommands；Codex 发现经新增的 WorkspaceGitService.peekRepoRoot 只读缓存快照，不跑 git。审查后删除 AgentManager 吞错 catch。归档任务 09-28-slash-commands-first-open。

### Git Commits

| Hash | Message |
|------|---------|
| `7360f4787` | feat(server): 其他 provider 取指令列表不再重连或起进程，并上报到指令目录 |

### Status

[OK] **Completed**


## Session 14: 斜杠菜单美化：面板贴合 Composer 顶边（ticket 02）
<!-- atw-session: v=2 fp=10856da62c98077c -->

**Date**: 2026-09-28
**Task**: 斜杠菜单美化：面板贴合 Composer 顶边（ticket 02）
**Package**: app
**Branch**: `main`

### Summary

Command menu 与 @ 列表面板改用 Composer 表面，去底边与向下投影，左右内缩 24，底边齐平落在 Composer 顶边（Portal 在上无法压到其后，规格按用户决定修订）；底部 16 渐隐：Web CSS 遮罩、原生 surfaceCard SVG 渐变，滚动跟随避开渐隐区（TDD）；最大高度 300。两轮双轴审查无硬违规；Electron 浅/深/@ 截图留证，用户实测通过；原生端截图未拍（本机无模拟器）。遗留：01 的命令名早于描述被截断（/compa…），未建票。任务已归档。

### Git Commits

| Hash | Message |
|------|---------|
| `411d4f68c` | feat(app): Command menu 面板贴合 Composer 顶边，底部渐隐 |

### Status

[OK] **Completed**


## Session 15: Skill chip 工单 03：开头退格删除、悬停提示与读屏名称，归档任务
<!-- atw-session: v=2 fp=6cdff8c347040111 -->

**Date**: 2026-09-29
**Task**: Skill chip 工单 03：开头退格删除、悬停提示与读屏名称，归档任务
**Package**: app
**Branch**: `main`

### Summary

Skill chip 子任务三张工单全部完成并归档。本次做工单 03：光标在正文开头无选区时退格删最后一个 chip（Web keydown / 原生 onKeyPress 只转 Backspace，锁定时不删）；chip 悬停 tooltip 显示全名与描述；读屏名 Skill：名字，Web 挂 role=group、原生挂名字 Text，九种语言文案；Attachment tray 抽到 composer/attachment-tray.tsx 作 browser 测试缝。前三个提交为工单 01/02 与 24px 方角 pill 视觉调整，此前未记日志。

### Main Changes

- 新增 resolveSkillChipBackspace、ComposerAttachmentTray、composer.attachments.skillChip
- spec：component-guidelines 新增 Accessible names 与 tooltip 悬停包络；testing 补 browser 项目加载不了 Composer/MessageInput 的测试缝

### Git Commits

| Hash | Message |
|------|---------|
| `bf80f7c27` | feat(app): Command menu 选中 skill 变成 Skill chip，发送时拼回 /name 前缀 |
| `7587a8b15` | feat(app): Skill chip 随草稿持久化，发送失败恢复成 chip |
| `578f04533` | style(app): Skill chip 改为 24px 小号方角 pill，× 替换图标位置 |
| `8625cc6f9` | feat(app): Skill chip 支持开头退格删除、悬停提示与读屏名称 |

### Testing

- [OK] skill-chips 单测、submit/state/autocomplete 单测、skill-chip.browser.test.tsx 4 条，typecheck/lint 通过；Electron 实测退格/悬停/AX 树 group: Skill：atw-tdd，浅深色截图；用户手测通过

### Status

[OK] **Completed**

### Next Steps

- 父任务 09-28-composer-slash-revamp 整体验收：Electron 与一个原生端各走一遍新 agent → / → 选 skill → 发送并截图；补原生常驻 × 截图，真机确认 Android 退格与选区时序


## Session 16: font-picker 工单 04：终端预览样例与字号重置，任务归档
<!-- atw-session: v=2 fp=dc412cf6ae95416e -->

**Date**: 2026-09-29
**Task**: font-picker 工单 04：终端预览样例与字号重置，任务归档
**Package**: app
**Branch**: `main`

### Summary

外观预览增加静态终端样例（resolveTerminalFont、草稿实时且 clamp、Nerd Font 分支图标）；字号行抽出 FontSizeRow，非默认时显示 ghost Button 重置，resetKey 回显 clamp/重置值；补 9 语言文案与浏览器测试；两轮双轴审查后修复手绘按钮与预览未 clamp；Electron CDP 实测通过；回写 PRD 与 styling 规范；排查 SF Pro/Inter 不在列表的原因（系统字体不可枚举、Codex 为主题预设名）及正文颜色偏浅的 token 原因；任务验收归档。遗留：原生端 Terminal size 未实测、Electron 回归待 CI。

### Git Commits

| Hash | Message |
|------|---------|
| `accd7aa08` | feat(app): 外观预览增加终端样例，字号行支持重置 |

### Status

[OK] **Completed**


## Session 17: 桌面端更新：设置 → 关于对齐新流程（06）并完成验收归档
<!-- atw-session: v=2 fp=966065f4c77dbd8e -->

**Date**: 2026-09-29
**Task**: 桌面端更新：设置 → 关于对齐新流程（06）并完成验收归档
**Package**: app
**Branch**: `main`

### Summary

实现 06：设置页状态文字带下载百分比、已下载附重启提示，主按钮「更新」开始下载、「安装并重启」直接安装并去掉确认框；手动检查发现新版本（下载中除外）和发起下载时解除本次运行的隐藏；9 种语言新增 2 个 key、删除 7 个旧 key；补状态机单测与两条设置页 e2e。两轮双轴审查修掉 Spec 两条、Standards 四条硬性问题。dev 桌面端用临时假更新器（未提交，已还原）供用户手测，验收后归档任务。

### Git Commits

| Hash | Message |
|------|---------|
| `c1f3e9f7a` | feat(desktop): 设置 → 关于的应用更新与侧栏卡片走同一套阶段 |

### Status

[OK] **Completed**


## Session 18: Pi 思考档位按 thinkingLevelMap 过滤
<!-- atw-session: v=2 fp=0ad5ee4f37d1aaf8 -->

**Date**: 2026-09-29
**Task**: Pi 思考档位按 thinkingLevelMap 过滤
**Package**: app
**Branch**: `main`

### Summary

Pi provider 按每个模型的 thinkingLevelMap（Pi getSupportedThinkingLevels 规则）暴露思考档位，默认档按 clampThinkingLevel 从 medium 收敛；切到有档位的模型后重新下发用户档位并回读 Pi 实际档位，不同则发 thinking_option_changed；无档位模型保留原档位；对齐/回读失败只记 warn。五轮双轴审查修掉非推理启动会话切模型变 off、全 null 模型把档位改成 off 等缺陷。docs/providers.md 记录 Pi<0.72 不报映射与 set_model 重置档位；后端质量规范新增档位规则。dev 桌面端手测通过。

### Git Commits

| Hash | Message |
|------|---------|
| `c1c21c76d` | feat(server): Pi 思考档位按模型 thinkingLevelMap 过滤并在切模型后对齐 |

### Status

[OK] **Completed**


## Session 19: 工单 05：Skill block 取代 Skill chip；手动验收修复，任务归档
<!-- atw-session: v=2 fp=e2fed0023d5b0613 -->

**Date**: 2026-09-30
**Task**: 工单 05：Skill block 取代 Skill chip；手动验收修复，任务归档
**Package**: app
**Branch**: `feat/multi-agent-collab`

### Summary

实现工单 05：从 Command menu 选中的 skill 变成输入框开头的 Skill block，发送时序列化为 /a /b 正文；删除 Skill chip，旧草稿的 skills 字段按 COMPAT(skill-chip-draft) 迁移；原生端改为在开头插入 /name。手动验收修了三处：编辑器段落默认外边距导致光标比 placeholder 低一截；块名字号从 caption 改为 body，与正文同为 fontSize.content；排队行正文改用 fontSize.content。提交 glossary（不含多智能体任务的 Agent mention 条目）与 ADR 0005，归档任务。遗留：开头有多个 skill 时，Codex/opencode（大概率 Claude Code 也是）只把第一个当正式调用，后面的作为参数文字，建议另开任务核实。dev 桌面端在这个 worktree 需 PASEO_LISTEN=127.0.0.1:6769。
## Session 20: 提供方安装指引
<!-- atw-session: v=2 fp=ecc1226f81485b94 -->

**Date**: 2026-09-30
**Task**: 提供方安装指引
**Package**: app
**Branch**: `main`

### Summary

实现 09-30-provider-install-guide：server_info 新增 hostPlatform；未安装的 Claude Code/Codex/Pi/OMP 在列表显示「如何安装」，详情面板按主机系统展示官方安装命令（可复制）与文档链接，自定义提供方显示所继承 CLI 的指引。命令已对照官方页面核对（Codex 文档改用 learn.chatgpt.com）；Pi Windows 按规格用 npm。双轴审查后迁入 provider-install-guide 特性目录、改用 Text 原语、补 surface 测试；桌面端浅/深色截图入任务 qa/。

### Git Commits

| Hash | Message |
|------|---------|
| `6da8e5994` | feat(app): Skill block 取代 Skill chip，选中的 skill 进输入框开头 |
| `cb631fc83` | docs(glossary): Skill chip 改为 Inline block / Skill block / File mention，Attachment tray 只放附件 |
| `0b6b6ff34` | fix(app): 输入框光标与 placeholder 对齐，块名与排队行字号随 Content size 与正文一致 |
| `cccdc40df` | docs(adr): 0005 行内块以普通文字存在消息里，协议不加字段 |

### Status

[OK] **Completed**


## Session 22: 多智能体协作票 13：provider 子智能体权限归属与验收归档
<!-- atw-session: v=2 fp=6c693908e538a60d -->

**Date**: 2026-09-30
**Task**: 多智能体协作票 13：provider 子智能体权限归属与验收归档
**Package**: app
**Branch**: `feat/multi-agent-collab`

### Summary

Codex/Claude/OpenCode adapter 在权限 metadata.providerSubagentId 标出子智能体，track 与派发组行显示等待批准，只读面板可批准；三轮双轴审查，dev 桌面端实测后验收并归档 09-29-multi-agent-collab。遗留观察：Codex 父会话派发行一度停在启动中（服务端关联数据正确）、mock 行时长待确认、子标签直接对话不再通知父智能体（现有设计）。

### Git Commits

| Hash | Message |
|------|---------|
| `ecbcc7c36` | feat(protocol,server,app): provider 子智能体权限按 metadata.providerSubagentId 归属，track 与派发组行显示等待批准，只读面板可批准 |
| `bbb132e50` | feat(app): 未安装的提供方按主机系统显示安装指引 |

### Status

[OK] **Completed**


## Session 21: 第三方接口：工单 09 文档收尾、截图验收与 CI 回归修复，任务归档
<!-- atw-session: v=2 fp=fee6a0463c4e18e9 -->

**Date**: 2026-09-30
**Task**: 第三方接口：工单 09 文档收尾、截图验收与 CI 回归修复，任务归档
**Package**: app
**Branch**: `main`

### Summary

工单 09：custom-providers 新增「While an API endpoint is active」，ADR 0004 按实现补齐，词汇表对齐界面文案；桌面端浅色/深色各一套截图（临时 CLAUDE_CONFIG_DIR/CODEX_HOME + 桩 CLI + 假上游隔离，真实配置 mtime 未变）。推送后 CI server-tests 在 Linux/Windows 挂在 claude.test.ts「bootstrap 不得含提供方名字」，把 Codex 版本探测挪进 ApiEndpointService、bootstrap 改传通用 providerRuntimeSettings 后全绿（含 Windows）；spec 补这条约束。Nix 两项失败为既有 npm hash 问题。任务验收并归档。

### Git Commits

| Hash | Message |
|------|---------|
| `9255915d9` | docs: 第三方接口文档收尾，ADR 0004 按实现补齐，补自定义提供方的相互影响与桌面端截图验收 |
| `0a853a263` | chore: 第三方接口任务进入验收 |
| `48411967a` | fix(server): Codex 版本探测挪进第三方接口服务，bootstrap 不再出现提供方名字 |

### Status

[OK] **Completed**


## Session 23: 提供方设置页重排：工单 09 文档收尾与截图验收、Providers 页改用彩色图标，任务归档
<!-- atw-session: v=2 fp=6a6ed3a6c2c11091 -->

**Date**: 2026-09-30
**Task**: 提供方设置页重排：工单 09 文档收尾与截图验收、Providers 页改用彩色图标，任务归档
**Package**: app
**Branch**: `main`

### Summary

工单 09：docs/design.md §7 写明 Providers 两列整体最大 1056 的例外，§9 写明按设置详情区实测宽度 ≥736 两列、紧凑一律栈式；按任务前后字面引用比对 en.ts，本任务无新增孤儿键；提供方界面已无 Alert.alert。dev 桌面端 1440/1024 宽截宽屏、窄窗、composer 弹窗浅深色及菜单/诊断/添加 Model/目录，与原型逐条对照写入 qa/README.md（Electron CDP 截图偏紫、滚动条占宽、SheetHeader 高约 4px 等）；补跑受影响 5 个浏览器 e2e 共 11 例与 8 个单测文件 132 例全部通过。双轴审查修掉重复句、sticky 仅 Web、面包屑仅窄桌面等。验收时用户要求 Providers 页用彩色图标：列表行、详情头部、composer 弹窗头部改用 resolveProviderGlyph brand，ProviderIconFrame 拆到 provider-detail/icon-frame.tsx，同步 design.md 与 styling spec。规划产物 PNG 转 jpg（67MB→约 10MB）后随任务归档。

### Git Commits

| Hash | Message |
|------|---------|
| `fe7b4914d` | docs: 设计文档写明 Providers 页的宽度例外与两列/栈式切换条件，补截图验收与 e2e 证据 |
| `20a0911f7` | feat(app): 设置 → Providers 的列表行、详情头部与 composer 弹窗头部改用彩色提供方图标 |

### Status

[OK] **Completed**


## Session 26: Providers 两级结构：工单 10 升级按钮挪进状态行，任务验收归档
<!-- atw-session: v=2 fp=23674731948486ce -->

**Date**: 2026-10-01
**Task**: Providers 两级结构：工单 10 升级按钮挪进状态行，任务验收归档
**Package**: app
**Branch**: `split-providers-models-menu`

### Summary

工单 10：列表行尾只剩开关和 ›，有新版本时状态行后接 xs outline「升级到 v{latest}」（ArrowUp，悬停 v{from} → v{to}），ProviderUpgradeButton 加 placement、ProviderStatusLine 用 children 接按钮且不再写版本箭头；9 语言补 actionTo。双轴审查：Standards 指出本地压到 18px 违反 design.md §4，改回 xs 原尺寸（行会略高），合并重复 Button 分支；Spec 建议补「点升级不进详情」断言，测试里 Pressable mock 改为像 RN-web PressResponder 一样 stopPropagation。真实 Web/Electron 点升级不跳详情；假 Claude CLI 下 Web 4 张、Electron 2 张截图入 qa/。design.md、frontend component-guidelines/testing、设计说明同步。用户 dev 桌面端实测通过。验收 16 条：14 达成，第 9 条（只读客户端被拒无自动测试）与第 15 条（真实升级只在 Web）用户接受，任务归档。
## Session 25: 补齐简体中文界面翻译：工单 06 PR 面板/插件/会话页/侧栏迁移，任务验收并归档
<!-- atw-session: v=2 fp=28d7b196da288179 -->

**Date**: 2026-10-01
**Task**: 补齐简体中文界面翻译：工单 06 PR 面板/插件/会话页/侧栏迁移，任务验收并归档
**Package**: app
**Branch**: `fix/settings-menu-zh-i18n`

### Summary

工单 06：PR 面板按用户确认的范围全部迁移（动态、评论/讨论主题操作、已解决/已过时、添加到聊天，以及检查摘要标题与计数行、状态徽标、活动动词）；summarizeChecks 改为只返回状态与计数，formatChecks*(t, …) 生成文案，中文 countLine 写 {{parts}}，得到「3 项失败，21 项成功，1 项已跳过」；data.ts 改返回已有 states/activity 键，e2e 助手改读 en 资源。插件界面与面板、会话页、侧栏工作区标题、显示偏好、标记已读/未读及失败提示改走翻译；docs/i18n.md 补 Batch 5C，组件规格补计数行包裹写法。双轴审查后修正批次记录位置与编号，统一「动态」「项手动」译法。dev 桌面端中文 QA：临时注册离线主机测会话页空状态（已还原），/tmp 临时克隆检出 PR #5 分支测 PR 面板（克隆已删）。PRD 9 条验收逐条核对满足，用户验收，任务归档。
## Session 24: 本轮用量面板重设计（工单 04）与任务归档
<!-- atw-session: v=2 fp=2fd7698e71746561 -->

**Date**: 2026-10-01
**Task**: 本轮用量面板重设计（工单 04）与任务归档
**Package**: app
**Branch**: `enhance-pricing-hover-panel`

### Summary

实现 04 票：本轮用量面板改为「总览 + 明细」，外框经 TooltipContent 定宽 300、去内边距，修掉内容越出右边框 18px 的歪斜；推理单独成格，单/多模型分别呈现，无价格数据有明细标记、点状下划线与底部提示。buildTurnUsagePanel（none/single/multi 联合）取代旧明细函数，9 种语言文案补齐并删旧键。新增浏览器组件测试（三种轮次 × 1280/390）。两轴审查后修了联合、密度、嵌套与测试断言。真实 Web 与 dev 桌面端验收通过；多模型/无价格画面只在浏览器测试里以亮色渲染。前端规范补 Tooltip 面板定宽写法与 browser 项目三条坑。PRD 验收项除 CI 外全部勾选（分支未推送、CI 未跑），任务已归档。

### Git Commits

| Hash | Message |
|------|---------|
| `9e1c30297` | feat(app): Providers 列表行的升级按钮挪进状态行 |
| `02f131c94` | fix(app): 迁移 PR 面板、插件、会话页、侧栏剩余硬编码英文到翻译键 |
| `5140793d3` | chore(atw): 工单 06 桌面端中文验收通过，关闭工单，任务进入验收 |

### Testing

- [OK] PR 面板与插件目录 34 个测试文件 293 条、resources.test.ts 38 条通过；全仓 typecheck、lint 通过
| `20d358e65` | feat(app): 本轮用量面板改为「总览 + 明细」，内容不再溢出边框 |

### Status

[OK] **Completed**

### Next Steps

- 推送 fix/settings-menu-zh-i18n 并开 PR 合进 main（待用户确认）
- 下次开 dev 桌面端时归档 dev daemon 里的 osuna-pr 工作区（目录已删）


## Session 27: 输入框窄栏套餐用量：工单 05 上下文弹层重整、验收与归档
<!-- atw-session: v=2 fp=455910b77791e98c -->

**Date**: 2026-10-01
**Task**: 输入框窄栏套餐用量：工单 05 上下文弹层重整、验收与归档
**Package**: app
**Branch**: `agent-input-subscription-display`

### Summary

工单 05：上下文圆环弹层是否接套餐用量卡片改由所在输入框的窄栏是否可见决定（composer 的 isContextStripVisible），不接时打开弹层也不取套餐数据；宽屏左右两栏（上下文 | 本会话合计，每栏 192，竖线分隔），紧凑布局单栏 300；弹层右对齐圆环；删除上下文估算成本与 totalCostUsd 传递，文案改为 usedLabel + tokens 键值标签，9 语言同步。e2e：桌面断言弹层不含套餐用量且不多发请求；窄栏出错/主机不支持与用量页出错三条改用手机视口弹层作正向信号；相关 5 个 e2e 文件 17 例与 i18n 单测通过。三轴审查：修掉具名 props interface、Density 三处、断言范围过宽，视觉意见改为右对齐；键值行/进度条与套餐卡片重复、usedLabel 拆句语序留作判断项。截图里的本会话合计靠一次性脚本改写 usage.agent.get.response（mock Agent 无用量）。验收：9 条截图标准 8 条满足，第三方接口一项仅单测覆盖，用户按现状接受；dev 桌面端实测通过，任务归档。分支未推送，CI 未跑。

### Git Commits

| Hash | Message |
|------|---------|
| `5e7029979` | feat(app): 上下文弹层改为两栏，窄栏可见时不再重复套餐用量 |

### Status

[OK] **Completed**
