# 子智能体"等待批准"的数据来源

调研日期 2026-09-29，对应 `map-issues/03-subagent-permission-source.md`。所有结论来自本 worktree 源码（`文件:行号`），Claude SDK 类型来自主 checkout 的 `node_modules/@anthropic-ai/claude-agent-sdk@0.3.246`（本 worktree 未装依赖，版本与 `packages/server/package.json:73` 一致）。

## 结论速览

| 子智能体类型 | 权限请求挂在哪个 agent | 能否归属到具体子智能体 | app 现在能拿到吗 |
| --- | --- | --- | --- |
| Paseo 子智能体（`create_agent`） | 子智能体自己的 managed agent | 天然归属（`agentId` 就是子智能体） | 能：host 级 agent 订阅带全量 `pendingPermissions`，且 `agent_permission_request` 全量广播 |
| Claude task | 父 managed agent | 现在不能；SDK 给了 `agentID`，Paseo 丢弃 | 父 agent 的 `pendingPermissions` 里有，但无子智能体标识 |
| Codex collab agent | 父 managed agent | 能：`request.metadata.threadId` = 子线程 id = 描述符 id | 同上，已带可用标识 |
| OpenCode child session | 父 managed agent | 现在不能；`sessionID` 被读后丢弃 | 同上，无子智能体标识 |
| OMP | 父 managed agent（`extension_ui_request`） | 不能；RPC 事件本身不带子智能体 id | 同上 |

provider 子智能体描述符（`ProviderSubagentDescriptorPayloadSchema`）没有任何权限或注意力字段，状态只有 `running/completed/failed/canceled`。

## (1) Paseo 子智能体：数据已在 app，track 只是没用

### server 端

- 子智能体是普通 `ManagedAgent`，权限事件进它自己的 `pendingPermissions`：`packages/server/src/server/agent/agent-manager.ts:4584-4594`（`onStreamPermissionRequested` → `pendingPermissions.set` → `emitState`）。
- 快照投影带全量 `pendingPermissions` 和 attention：`packages/server/src/server/agent/agent-projections.ts:139`、`:155-161`；协议字段 `packages/protocol/src/messages.ts:925`、`:932-933`。
- 权限请求**不**设置 attention，只调 `broadcastAgentAttention(agent, "permission")`（`agent-manager.ts:4590-4592`），而该函数对带 `paseo.parent-agent-id` 的智能体直接返回（`agent-manager.ts:4956-4962`，`isDelegatedAgent` 见 `packages/protocol/src/agent-labels.ts:23-25`）。所以子智能体等待批准**不会**产生 `agent_attention_required`/推送通知，`requiresAttention` 也不会因权限变 true。判断"等待批准"只能看 `pendingPermissions.length`。
- 每次 `emitState` 走 `agentUpdates.forwardLiveAgent`（`packages/server/src/server/session.ts:1900-1915` 附近），按订阅过滤（`packages/server/src/server/session/agent-updates/agent-updates-service.ts:118-148`）推 `agent_update`。
- 另外 `permission_requested` 流事件被转成 `agent_permission_request` 用 `this.emit` 发给整个会话，不按订阅过滤（`session.ts:1962-1970`）。

### 订阅范围

- app 的 agent 目录订阅不带 filter 时用 `scope: "active"`（`packages/app/src/runtime/directory-sync/index.ts:622`），`subscribe: {}` 在 `:308`、`:563`。server 端 `scope === "active"` 只保留未归档且 workspace 在活跃放置里的智能体（`session.ts:5404-5420`），不按父子过滤。子智能体与父共用 workspace（PRD 已定），因此一定在范围内。
- 结论：订阅是 host 级的，覆盖所有活跃子智能体，不存在"父侧订阅"。

### app 端

- 快照 → `Agent.pendingPermissions`：`packages/app/src/utils/agent-snapshots.ts:120`；`parentAgentId` 从标签解析：`:101`、`:135`。
- 会话级 `pendingPermissions` Map（按 agentId 归属）由快照（`packages/app/src/runtime/directory-sync/internal/agent-store.ts:138`、`:143-151`）和 `agent_permission_request` 事件（`packages/app/src/contexts/session-context.tsx:585-596`）两路维护。
- track 行已经带 `requiresAttention`（`packages/app/src/subagents/select.ts:19`、`:65`），但没有带 `pendingPermissions`。
- 子智能体标签页是普通 agent 面板，权限卡按 `perm.agentId === agentId` 过滤（`packages/app/src/agent-stream/view.tsx:959-962`），在子会话里批准已可用。

## (2) provider 子智能体：全部落在父会话

四个 provider 的子智能体都跑在父智能体的同一个 provider runtime 里，权限回调都由父 adapter 收到，`permission_requested` 以父 agentId 进入 `AgentManager`。差别只在请求上有没有子智能体标识。

### Claude task

- `canUseTool` 统一由 `handlePermissionRequest` 处理（`packages/server/src/server/agent/providers/claude/agent.ts:3299`、`:4640-4686`），只把 `options.toolUseID` 放进 `metadata.toolUseId`（`:4650-4652`），然后 `pushEvent({ type: "permission_requested" })` 到父 agent。
- SDK 的 `CanUseTool` options 带 `agentID?: string`——"If running within the context of a sub-agent, the sub-agent's ID"（`claude-agent-sdk/sdk.d.ts:209` 起的类型定义）。Paseo 没读它。
- 归属可行路径：
  - `agentID` → `ClaudeTaskProtocolSource.subagentIdByTaskId`（`claude/subagents/live-source.ts:154`）→ 描述符 id。hook 的 `agent_id` 已按同一张表路由（`live-source.ts:469-479`），docs 也写明 hook `agent_id` 等于 `task_started.task_id`（`docs/agent-lifecycle.md` "Effort is only reachable through hooks"）。`canUseTool.agentID` 是否与 `task_id` 同值**未在线上验证**。
  - 备选：`toolUseID` → `ownerSubagentIdByToolUseId`（`live-source.ts:158`、`:490-499`，由子链 assistant 帧里的 `tool_use` 建表），已有 `resolveTaskOwner` 用同一张表（`:237-242`）。前提是 assistant 帧先于 `canUseTool` 到达，**未验证时序**。
- 子智能体内部的工具调用走 sidechain 进 provider 子时间线，不进父时间线，所以父面板上的权限卡没有对应的工具卡上下文。

### Codex collab agent

- 四类审批（`item/commandExecution/requestApproval`、`item/fileChange/requestApproval`、`item/tool/requestUserInput`、`mcpServer/elicitation/request`）在同一 app-server client 上注册（`packages/server/src/server/agent/providers/codex-app-server-agent.ts:3781-3799`），处理函数都不按线程过滤，请求的 `metadata.threadId` 原样带上（命令审批 `:6790-6840`；文件改动 `:6841-6877`；工具输入 `:6878-6928`；MCP elicitation `:6929` 起）。
- provider 子智能体描述符 id 就是子线程 id（`emitProviderSubagentUpsert`，`:5703-5731`，`id: childThreadId`）。所以 `request.metadata.threadId !== 父 currentThreadId` 时，它就是那个描述符的 id，可直接归属。
- 例外：异步提问 `receiveAsyncQuestion` 对非当前线程直接丢弃（`:6338-6343`），子线程的提问不会出现。
- 子线程是否真的会发审批取决于 Codex 的审批策略继承，**未在线上验证**。

### OpenCode child session

- 父翻译器对已知子会话的 `permission.asked` 也照收（`isOpenCodeSessionTrackedByParent`，`packages/server/src/server/agent/providers/opencode-agent.ts:2371-2380`；`appendOpenCodePermissionAsked`，`:2961-3001`），产出的 request 没有 metadata，`sessionID` 被丢弃。单测明确断言了这个形状（`opencode/event-translator.test.ts:594-658`，`sessionID: "child-session-1"` 输出里无子会话 id）。
- 子会话的 `question.asked` 由子翻译器产出后原样上抛给父（`opencode-agent.ts:5190-5195`），`metadata` 只有 `source: "opencode_question"` 和 `tool`（`:3036-3050`），也不带子会话 id。
- 权限落父 adapter 的 `pendingPermissions`（`:5272-5284`），目录按 `childSessionCwds` 选但不记录归属。
- 归属可行路径：在 `appendOpenCodePermissionAsked` / 子提问上补 `metadata.childSessionId = event.properties.sessionID`（当它不等于父 `sessionId` 时）；描述符 id 就是 `childSessionId`（`:2495-2500`、`:5144-5150`）。

### OMP

- OMP 子智能体走 `provider_subagent`（`packages/server/src/server/agent/providers/omp/subagent-index.ts:23-60`、`:104-121`），不是 docs 里写的 `child_session` 导入 managed agent——代码中已无 `child_session`（全仓 grep 为空），`docs/agent-lifecycle.md` "Provider-managed child agents" 一节已过期。
- 权限来自 `extension_ui_request`（`omp/agent.ts:1519-1564`），事件 schema 只有 `id/method/title/message/...`（`omp/rpc-types.ts:441-452`），不带子智能体 id，无法归属。OMP 子智能体是否会发 UI 请求**未验证**。

### 附带发现：父智能体被明确要求代批

`notifyOnFinish` 的权限通知文本写的是 "Respond with `respond_to_permission` using the `agentId` and `requestId` below."（`packages/server/src/server/agent/agent-prompt.ts:398-409`，触发点 `:533-545`）。PRD 已定"路由提示禁止父智能体用 `respond_to_permission` 代批"，但现有通知正文在教它代批，两者冲突，需要在 spec 里决定是否改这段文案（它对所有 `create_agent` 子智能体生效，不只 @ 派发的）。

## (3) track 接上需要哪些数据

- 写死处：`packages/app/src/subagents/track-presentation.ts:41-44` 调 `deriveSidebarStateBucket({ status, requiresAttention: false })`。这是有意的：提交 `3eda7dd15`（"Bucket finished subagents as `done` instead of `attention`"）为了不让已完成子智能体亮"待查看"而关掉 attention。
- `deriveAgentStateBucket` 的 `needs_input` 只看 `pendingPermissionCount > 0` 或 `attentionReason === "permission"`（`packages/protocol/src/agent-state-bucket.ts:22-25`），与 `requiresAttention` 无关。所以只需给行加一个 `pendingPermissionCount` 并传进去，保留 `requiresAttention: false`，不会复活"已完成=待查看"。
- 渲染已就绪：pill 的 `needs_input` 段和文案 `subagents.pillLabelNeedsInputOne/Many` 已存在（`track-presentation.ts:103-106`），按 `STATUS_BUCKET_ORDER` 排第一（`packages/app/src/utils/sidebar-agent-state.ts:36-42`）；注释 `track-presentation.ts:75-77` 里"只有三种状态"的前提要改。
- Paseo 行：`toSubagentRow`（`select.ts:55-68`）加 `pendingPermissionCount: agent.pendingPermissions.length`。数据已在 store，不需要协议改动。
- provider 行：`selectProviderSubagentsForParent`（`select.ts:100-133`）需要按 `parentAgentId` 从父 agent 的 `pendingPermissions`（或会话级 Map 中 `agentId === parentAgentId` 的项）里数出归属到该 `subagentId` 的请求。归属键需要 server 先补齐（见下），app 端不能从现有字段可靠推出（Claude 只有 `toolUseId`，OpenCode/OMP 什么都没有）。
- 另一个缺口：同 workspace 的子智能体在工作区状态里只贡献 `running`（server `packages/server/src/server/workspace-directory.ts:376-386`，app `packages/app/src/utils/workspace-agent-activity.ts:24-26` + `packages/app/src/subagents/workspace-root-policy.ts:6-17`）。docs 声称"permission ... stay in the parent's subagents track"（`docs/agent-lifecycle.md` Workspace activity 一节），但 track 目前并不显示，所以子智能体等待批准在 UI 上完全不可见，只有进子会话才看得到。

## (4) provider 子智能体只读面板里在哪批准

- 面板传的是空 Map（`packages/app/src/panels/provider-subagent-panel.tsx:34`、`:264`），且 `AgentStreamView` 按 `perm.agentId === agentId` 过滤，而面板的 `agentId` 是合成的 `provider:<parent>:<subagent>` streamId（`:115`），即使传会话级 Map 也会被全部滤掉。
- 权限卡 `PermissionRequestCard` 用 `permission.agentId` 回应（`packages/app/src/agent-stream/view.tsx:1534-1543` → `respondToPermissionAndWait`），`readOnly` 不屏蔽权限卡（`view.tsx:959-969` 无 readOnly 判断）。
- 所以现状：provider 子智能体的权限卡只出现在**父智能体面板**，没有子智能体标识；在父面板批准就能生效。
- 在子面板批准的可行做法：面板从会话级 Map 取 `agentId === target.parentAgentId` 且归属到 `target.subagentId` 的项，重新组一个 Map 传给 `AgentStreamView`，并让过滤条件不再依赖 `agentId`（或给 `AgentStreamView` 直接传已过滤列表）。卡片内的 `permission.agentId` 保持父 agentId，回应路径不用改。只读面板仍无输入框，但批准不是"写入会话"，与只读语义不冲突——这点要在 spec 里明确。

## 对卡片 / track 显示"等待批准"的可行路径

1. **Paseo 子智能体（纯 app，无协议改动）**：`SubagentRow` 加 `pendingPermissionCount`，presentation 传入 `deriveSidebarStateBucket`；时间线卡片按 `create_agent` 结果里的子 agentId 从 store 读 `pendingPermissions.length`。点开是普通子会话标签，已能批准。
2. **provider 子智能体（server 补归属 + app 过滤）**：
   - server：各 adapter 在 `AgentPermissionRequest` 上补子智能体 id。首选在 `metadata` 放一个约定键（如 `providerSubagentId`），`metadata` 是 `z.record` 已存在的可选字段（`packages/protocol/src/messages.ts:574-587`），老 app 忽略即可；也可以加一个可选顶层字段并按 `docs/protocol-compatibility.md` 走能力开关。Codex 直接由 `metadata.threadId` 映射；Claude 用 `agentID`（或 `toolUseID` 反查）经 `live-source` 表映射到描述符 id；OpenCode 用 `event.properties.sessionID`；OMP 暂无来源。
   - app：track 行和卡片从父 agent 的 `pendingPermissions` 按该 id 计数；只读面板按上一节接权限卡。
   - 父面板的权限卡可顺带标出来自哪个子智能体（描述符 title/description）。
3. 不建议把"等待批准"塞进 `ProviderSubagentDescriptorPayload.status`：状态枚举是协议面，新增值会让老 app 解析失败；权限本就在父 agent 快照里，派生即可，还能随 `agent_permission_resolved` 自动消失。

## 仍存疑

- Claude `canUseTool` 的 `agentID` 是否等于 `task_started.task_id`；`toolUseID` 反查依赖的帧时序；后台（backgrounded）子智能体发权限请求时的行为。
- Codex 子线程是否会发审批（取决于审批策略继承），以及子线程异步提问被丢弃是否要一并修。
- OMP 子智能体能否触发 `extension_ui_request`；若能，OMP RPC 需要上游带子智能体 id 才能归属。
- `agent-prompt.ts:398-409` 教父智能体代批，与 PRD 的"禁止代批"冲突，需在 spec 定改法。
- `docs/agent-lifecycle.md` 里 OMP `child_session` 的描述、"provider 子智能体只有 Claude/Codex/OpenCode"的描述、"permission 状态留在 track"的描述均与代码不符，留给 `/atw-spec` 决定文档归属。
