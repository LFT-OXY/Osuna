# 参考：orca 左侧栏 + Osuna 左侧栏数据对照

`O` = `/Users/oxy/Documents/Configuration/dev-environment/demo/源码/orca/src/renderer/src`；`A` = `packages/app/src`（Osuna）

## orca 左侧栏

- 栈：Electron + React 19 + Tailwind v4 + shadcn（radix）+ lucide；入口 `O/components/sidebar/index.tsx:151-241`。
- 结构（上 → 下）：36px 标题栏（属于侧栏列，macOS 留 80px 红绿灯，含侧栏开关与前进后退，`O/app-shell/TitlebarLeftControls.tsx`）→ 导航区（Search 伪输入 + Tasks 等，`SidebarNav.tsx`）→ 32px 分区标题 + 图标按钮（`SidebarHeader.tsx:49-133`）→ 虚拟化工作区列表 / Activity 视图 → 底部 `border-t` 工具栏（`SidebarToolbar.tsx:73-121`）。
- 宽度 280（220–500），12px 拖拽把手 hover 显示 1px `ring/50` 线；收起为 0，标题栏变浮层。
- 分组头 28px，13px semibold，可折叠，吸顶，右侧操作 hover 浮出且绝对定位不占宽（`worktree-list/rows/SectionHeader.tsx`、`ProjectHeaderActions.tsx:9-17`）。
- 卡片（`worktree-card-surface.tsx:47-86`）：`rounded-lg`、1px 透明边框；单行约 38，两行约 52，卡片间距 6；含内嵌 agent 行默认约 116。
  - 行 1：20px 状态槽 + 项目图标（16，仅非按项目分组时）+ 标题 13/20（未读 semibold）+ 徽章 + hover 删除。
  - 行 2：分支 11px muted、主机 / 冲突徽章、issue / PR / 端口图标（`worktree-card-meta-row.tsx`）。
  - 行 3+：内嵌 agent 行 24px、11px：状态点、agent 图标、"prompt – 最新消息"、模型（10px mono）、+N 子 agent、相对时间（`worktree-card-compact-agent-row.tsx`）。
  - 卡片属性可开关（`shared/worktree/card-properties.ts:13-25`），有 Detailed / Compact 两种布局。
  - 无 diff 统计。
- 状态样式（`O/assets/main.css:1239-1290`）：hover 前景 4%；选中 前景 8% 底 + border 40% 边 + `0 1px 2px` 阴影（暗色 前景 10% / 边 前景 18%）。
- 状态表达：working 黄色 `steps()` 同相位旋转环；permission 橙色问号；interrupted 红点；done 绿点；未读 琥珀点 + 标题加粗（`StatusIndicator.tsx`、`AgentStateDot.tsx`、`WorktreeCardStatusSlot.tsx`）。
- token：侧栏 亮 #f5f5f5 / 暗 #2a2a2a，主区 #fff / #0a0a0a —— **暗色侧栏比主区亮**（让侧栏"浮起"，`main.css:310-312`）；sidebar-accent #eaeaea / #353535；可叠自定义色调。
- 截图：`orca/docs/assets/readme-hero.jpg`、`orca/docs/site/public/docs/ways-to-run-local-sidebar.png`。

## Osuna 左侧栏现状

- 结构 `A/components/left-sidebar.tsx:562-744`：36px chrome → `SidebarNavRows`（New workspace / History / Search / Schedules / Usage）→ "Workspaces" 列表头 → 列表 → Callout → 底部图标栏（28px 按钮）。
- 宽度 320（200–600），主区至少 400（`A/stores/panel-store/state.ts:24-26`）。
- 分组：project（项目 → 工作区）或 status（Needs input / Failed / Ready to review / Working / Done）；置顶；主机仅作筛选。
- 行（`A/components/sidebar-workspace-list.tsx:2492` 起，`A/components/sidebar/sidebar-workspace-row-content.tsx:139-256`）：最小高 36；16px 状态槽 + 标题 14/20 + 右侧 `DiffStat` +N −M（可改为时间）；第 2 行 `WorkspaceMetaRow` 12/16（分支、项目、主机、PR、CI、服务、标签，默认只开主机 / PR / 服务 / 标签），有则约 52。
- 暗色侧栏比主区暗（paseo 主题 #141716 vs #181B1A）。

## 多行卡片的数据可用性（`A/hooks/sidebar-workspaces-view-model.ts:38-55,146-185`）

- **已有**：`projectName`、项目图标、`name` / `title`、`currentBranch`、`diffStat`、`statusBucket`、`statusEnteredAt`、`prHint`（number / state / checks / review / forge）、`labels`、`scripts`、`pinnedAt`、`workspaceKind`、主机。
- **缺**：
  - agent 标题：`Agent.title` 在 `A/stores/session-store.ts:72-103`，行数据只带 `{agentId, status, enteredAt}`，需按 agentId 查 session store；无"最新消息"文本。
  - 每工作区 agent 列表（provider、model、数量、lastActivityAt）—— orca 式内嵌 agent 行需要新增。
  - ahead / behind：协议有 `gitRuntime.aheadBehind`（`packages/protocol/src/messages.ts:3994-4011`），行数据未映射。
  - 独立未读位、工作区 createdAt。

## 三方对比

| 维度 | orca | t3code | Osuna 现状 |
|---|---|---|---|
| 列的对象 | worktree 卡片 + 内嵌 agent 行 | 线程 | 项目 → 工作区 |
| 行高 | 38 / 52 / 约 116 | 78（紧凑 36） | 36 / 约 52 |
| diff 统计 | 无 | 有 | 有 |
| 暗色侧栏 vs 主区 | 更亮 | 更暗（纯黑） | 更暗 |
| 宽度 | 280（220–500） | 256（208–） | 320（200–600） |
