# 代码追踪（2026-09-17，未复现，三条候选根因）

## 链路

History 行点击 `components/agent-list.tsx:358-376`（`pin:true`，agent 来自 `fetchAgentHistory`，不入 session store）→ `utils/navigate-to-agent/index.ts:8-22`（store 里查不到）→ `resolve.ts:24-43`（无 workspaceId 则走深链路 `/h/:serverId/agent/:agentId`，`pin` 丢失）→ `stores/navigation-active-workspace-store/navigation.ts:85-128`（layout 未 hydrate 时改为 `?open=agent:<id>` 路由）→ `app/h/[serverId]/workspace/[workspaceId]/index.tsx:114-183`（消费 open intent）→ `stores/workspace-layout-store.ts:659-732`（pin 写入 `pinnedAgentIdsByWorkspace` 并清 hidden）。

归档过滤唯一源头：`workspace-tabs/agent-visibility.ts:39`（`archivedAt` 非空不进 `activeAgentIds`；`agentDetails` 只用于找 parent）。据此关 tab：`stores/workspace-layout-actions.ts:2325-2357` `collapseStaleEntityTabs`。pin 豁免：`:2429-2450`；`applyPinnedAndHidden :2288-2299` 先并 pinned 再减 hidden（hidden 优先）。

## 候选根因

A. 深链路二次跳转丢 `pin`：`app/h/[serverId]/agent/[agentId].tsx:109` 重新 `navigateToAgent` 不带 `pin` → `prepare-workspace-tab.ts:45` 得 `pin:false` → tab 建出即被 `collapseStaleEntityTabs` 关闭。命中条件：History 项 `workspaceId` 为空（导入的会话很可能如此，`utils/agent-snapshots.ts:65`）。
B. `?open=agent:` intent 被饿死：`index.tsx:119-121` 要求 `hasHydratedWorkspaces && workspaceExists`，`selectWorkspaceExists`（`stores/session-store-hooks/selectors.ts:120-126`）只做精确查找无别名回退；不满足时 `:139-141` 直接 return，无重试无超时；`:144-152` 同 key 第二次进入只清参数不再 openTab（重复点击静默失败）。
C. workspaceKey 分桶不一致：`navigation.ts:99` 用 `input.workspaceId` 建 key，attention 分支用 `resolvedWorkspaceId`；若与 `workspace-screen.tsx:1612-1619` 的 `persistenceKey` 不同形，pin/unhide 写错桶。

## 验证方法（不改代码）

1. 在 `agent-list.tsx:368` 观察被点 History 项的 `agent.workspaceId` 是否为空（空 → A）。
2. 点击后查 `useWorkspaceLayoutStore.getState().pinnedAgentIdsByWorkspace` 是否有 `serverId:workspaceId` 键（有键无 tab → C；无键 → A/B）。
3. 查路由 URL 是否残留 `?open=agent:`（残留 → B）。

## 测试缺口

- `navigation.test.ts` 无"非延迟 + agent + pin:true → openTab 收到 pin"用例；`resolve.test.ts:43-100` 不校验 pin；深链路路由与 open-intent 消费无测试；无 History→归档 agent 集成测试。
- `agent-visibility.ts:95-107` `shouldPruneWorkspaceAgentTab` 生产代码无调用者。
