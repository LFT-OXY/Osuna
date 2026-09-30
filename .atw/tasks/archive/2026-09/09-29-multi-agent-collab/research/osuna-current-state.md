# Osuna 现状：与多智能体协作相关的已有能力

调研日期 2026-09-29。

## 已有

- **父子关系**：标签 `paseo.parent-agent-id`（`packages/protocol/src/agent-labels.ts`），打标签在 `packages/server/src/server/agent/create-agent/intent.ts:30-45`。归档级联与 detach 语义见 `docs/agent-lifecycle.md`。
- **`create_agent` MCP 工具**（`packages/server/src/server/agent/tools/paseo-tools.ts:1407`）：智能体调用时一律异步、带父级；`provider` 必须是 `provider/model` 形式，描述要求"不确定就先 list_providers / list_models"；`notifyOnFinish` 默认 true。
- **完成通知**：子智能体完成、出错或请求权限时，往父会话注入 `<paseo-system>` 提示（`packages/server/src/server/agent/agent-prompt.ts:210-220`）。只有 MCP 路径挂通知（`create-agent/create.ts:209`）；app 直接创建带父级的子智能体不会回报父会话。
- **其它委派工具**：`send_agent_prompt`、`get_agent_status`、`get_agent_activity`、`cancel_agent`、`list_pending_permissions`/`respond_to_permission`、`list_providers`/`list_models`/`list_profiles`。没有 `wait_for_agent`。
- **Paseo 工具注入**：默认对所有 provider 开启，可按 provider 或单个工具关掉（`packages/server/src/server/agent/paseo-tool-policy.ts`，注入在 `agent-manager.ts` 的 `prepareSessionConfig` / `buildLaunchContext`）。
- **provider 子智能体**：统一事件 `provider_subagent`，协议 `agent.provider_subagents.*`。Claude（task 协议）、Codex（`collabAgentToolCall`）、OpenCode（childSessionId）、OMP 已接；Pi 只有静态 `sub_agent` 卡。
- **Subagents track**：`packages/app/src/subagents/track.tsx`，合并 Paseo 子智能体与 provider 子智能体；点开 provider 子智能体是只读面板 `panels/provider-subagent-panel.tsx`。
- **能力开关**：`server_info.features.*`，app 用 `useHostFeature`（`packages/app/src/runtime/host-features.ts:33`）。现有 `providerSubagents`、`providerSubagentNesting`、`projectedSubagentTimeline`、`agentForkContext`。

## 缺口

- **@ 已被文件引用占用**：`packages/app/src/utils/file-mention-autocomplete.ts:20-41`（取光标前最后一个 `@`，不要求前导空白），`hooks/use-agent-autocomplete.ts:292-300` 里 file 模式优先。可参照 skill chip（`packages/app/src/composer/skill-chips.ts`）做智能体 chip。
- **时间线子智能体卡片**：`SubAgentDetailSection`（`packages/app/src/components/tool-call-details.tsx:372`）只显示日志，不能跳到子会话，与 track 数据分离。
- **`create_agent` 工具调用**在时间线里没有专门渲染，是通用 MCP 工具卡。
- **时间线条目类型**是普通 `z.union`（`packages/protocol/src/messages.ts:762-814`），新增类型会让旧 app 整条解析失败；优先扩展 `sub_agent` 工具详情的可选字段。
- **Grok** 不是一等 provider。
