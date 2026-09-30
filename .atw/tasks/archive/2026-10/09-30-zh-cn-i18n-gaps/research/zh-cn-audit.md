# zh-CN 翻译缺口排查（2026-09-30）

## 两类缺口

1. **资源漏翻**：组件已走 `t()`，但 `packages/app/src/i18n/resources/zh-CN.ts` 里的值是英文。
   - 与 en 完全相同且含字母的值 228 条（含应保留英文的主题名/品牌/占位示例）。
   - 直接引用 en 的整块：`sections.layout` / `layout`（:2091、:2100）、`...en.settings.host.skills`（:2508）、`desktop.daemon.lifecycle`（:1347）、`importSession.chooseHostTitle`（:441）。
   - `resources/plugin-settings.ts` 的 `shared.logs` 对所有语言都是英文。
   - 大块集中处：设置侧栏 hostSections（:2124–2129）、终端配置（:2606–2627）、守护进程更新（:2691–2712）、诊断（:2228–2240）、提供方（:2765–2793）、提及默认值（:2642–2651）、项目脚本（:2962–2970）。
   - 其他语言同样存在：fr 236、es 228、ar 178、pt-BR 175、ja 108、ko 88、ru 72。
   - 现有防线 `resources.test.ts` 的回退比例阈值为 25%，所以没拦住。

2. **硬编码英文**（未走 `t()`，约 100 处）：
   - 设置：`screens/settings/host-page.tsx`（合并 PR 后自动归档工作区、终端 Agent hooks、"Terminal agents" 分区）、`browser-tools-config.ts` / `browser-tools-card.tsx`、`daemon-lifecycle.ts` 的客户端错误文案、`plugins-page.tsx:219`、`keyboard/keyboard-shortcuts.ts:372,383` "Pin chat" 缺 `SHORTCUT_HELP_LABEL_KEYS`。
   - 添加项目流程 `components/add-project-flow.tsx` + `add-project-flow/options.ts`：约 45 处，完全无 i18n。
   - 主机选择器 `components/hosts/*`、`hosts/host-chooser.tsx`：约 12 处。
   - 新建工作区 `screens/new-workspace-screen.tsx`：约 11 处。
   - 工作区/面板/终端：`panels/terminal-panel.tsx`、`workspace-tab-presentation.tsx`、`workspace-route-state.ts`、`terminal-pane.tsx`、`terminal-copy-paste-actions.tsx`、`terminal-emulator-native-grid.native.tsx`、`import-session-sheet.tsx`、`desktop/browser/pane/index.electron.tsx`：约 12 处。
   - PR 面板 `git/pull-request-panel/pane.tsx`：5 处。插件 `plugins/surface-screen.tsx`、`plugins/workspace-panels/panel.tsx`：8 处。
   - 会话页 `screens/sessions-screen.tsx:60,187`；侧栏 `left-sidebar.tsx:770` 及三处标记已读/未读失败 toast。
   - 已确认无需处理：`keyboard-shortcuts.ts` 的 `layout: "Layout"` 只作 React key；命令中心、rewind 菜单默认值、诊断报告正文、快捷键键名。

## 已定决策（访谈结论）

- 语言范围：只修 zh-CN。迁移硬编码文案新增的键，其他 7 种非英语语言填英文原文，后续另开任务补齐。
- 译法原则：按 Git / VS Code 官方中文惯例，见 `zh-cn-terminology-practice.md`。
  - 翻中文：提交、拉取、推送、合并、变基、压缩合并、差异、提示词、工作树、守护进程、主机、提供方、工作区、终端、布局、中继、插件、拉取请求 / 合并请求（全称）、初始化 / 清理（Setup / Teardown 标签）、浅色 / 深色、稳定版 / 测试版。
  - 保留英文：Agent、Subagent（现有「智能体」「子智能体」全部统一回英文，glossary 已同步为「提及 Agent」「提及 Agent 默认值」）；缩写与协议名 PR、MR、MCP、API、API key、Base URL、CLI、PID、URL、Shell、token；提供方自定义功能名 Skills、Hooks；具名主题、品牌 / 产品名、占位示例值、语言选项 "English"、纯插值。
- 已有中文译法与原则一致的保持不动；与原则冲突的（如 "Agent Provider"、"Worktree"、"Daemon"、"Diff"、"Prompt" 等英文残留）改为中文。
- 硬编码英文：全部约 100 处迁移到翻译键，按界面拆工单。
- 客户端自写的错误包装文案（如 `daemon-lifecycle.ts`）翻译；daemon / 服务端原始错误不翻。
- 防回归：`resources.test.ts` 加断言，zh-CN 与 en 相同的值必须在显式白名单内。
- `docs/glossary.md` 已补各词条 `zh-CN UI`（Workspace、Agent、Daemon、Host、Worktree、Terminal、Subagent、Agent mention、Mention defaults）。
