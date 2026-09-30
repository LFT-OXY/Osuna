# 03 — 子智能体"等待批准"的数据来源

**Type:** research
**Blocked by:** None
**Status:** resolved

## Question

PRD 要求时间线卡片和 Subagents track 显示子智能体等待批准。查清：(1) Paseo 子智能体的 pending permission 在父会话所在的 app 视图里能否拿到（agent 快照的 `pendingPermissions`/`requiresAttention` 是否随 agent 列表推给客户端、父侧订阅是否覆盖子智能体）；(2) provider 子智能体（Claude task、Codex collab agent、OpenCode child session、OMP）的权限请求落在父会话还是子会话、能否归属到具体子智能体；(3) track 现在写死 `requiresAttention:false`（`subagents/track-presentation.ts:41-44`），接上需要哪些数据；(4) provider 子智能体只读面板没有权限处理（`provider-subagent-panel.tsx:34`），用户要在哪里批准。产出 `research/subagent-permission-source.md`。

## Answer

- Paseo 子智能体：权限挂在子智能体自己的 agent 上，host 级 `scope: "active"` 订阅已把 `pendingPermissions` 推到 app store，`agent_permission_request` 也全量广播；track 只需给行加 `pendingPermissionCount` 传给 `deriveSidebarStateBucket`（保留 `requiresAttention: false`，不复活"已完成=待查看"），无需协议改动。子智能体权限不触发 attention/推送（`isDelegatedAgent` 短路）。
- provider 子智能体：Claude、Codex、OpenCode、OMP 的权限请求全部落在父 managed agent 的 `pendingPermissions`。只有 Codex 带可归属的 `metadata.threadId`（= 描述符 id）；Claude SDK 给了 `agentID` 但 Paseo 丢弃；OpenCode 丢弃 `sessionID`；OMP 的 `extension_ui_request` 本身不带子智能体 id。
- 接 track/卡片：server 各 adapter 在请求 `metadata` 上补子智能体 id（`metadata` 已是可选 record，老 app 忽略），app 从父 agent 的 `pendingPermissions` 按 id 计数；不要扩 `ProviderSubagentDescriptorPayload.status`。
- 批准位置：provider 子智能体权限卡现在只出现在父面板（可批准）；只读面板传空 Map 且 `AgentStreamView` 按合成 streamId 过滤，接入需按父 agentId + 子智能体 id 重组列表，回应仍走父 agentId。
- 冲突：`agent-prompt.ts:398-409` 的通知正文要求父智能体用 `respond_to_permission` 代批，与 PRD"禁止代批"相反，需 spec 决定。
- 详见 `research/subagent-permission-source.md`（含存疑项：Claude `agentID` 与 task_id 是否同值、Codex 子线程审批与 OMP UI 请求是否真实发生、docs 中 OMP `child_session` 描述已过期）。
