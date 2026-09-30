# 02 — `create_agent` 调用与所产子智能体的关联手段

**Type:** research
**Blocked by:** None
**Status:** resolved

## Question

时间线里父智能体的 `create_agent` 工具调用条目，要能在 Claude、Codex、OpenCode、OMP、Pi 各 provider 下稳定找到它产出的子智能体 id，才能渲染实时卡片。现状：只有 Codex 保留 structuredContent；Claude/OpenCode 只剩带 `availableModes_count=` 前缀的文本（`paseo-tool-serialization.ts:50-63`）；OpenCode 工具名 `paseo_create_agent` 不被 `getPaseoToolLeafName` 识别。调研并比较候选方案：(1) MCP `tools/call` 请求里是否带 provider 侧 tool call id（如 Claude Code 的 `_meta` 字段、Codex/OpenCode/OMP 的等价物），daemon 据此把 callId 记到子智能体上（标签或记录字段）；(2) 让 `create_agent` 的文本输出可解析出 agentId，app 从工具结果里读；(3) app 按父子关系、创建时间、initialPrompt 匹配；(4) 其它。每个方案给出各 provider 可行性、实时与历史回放（重载、导入会话）下是否成立、协议改动与兼容影响。产出 `research/create-agent-child-link.md`，给出推荐方案。

## Answer

- 五个 provider 都能提供等于父时间线 `callId` 的 provider 侧 tool call id：Claude `_meta["claudecode/toolUseId"]`（2.1.280 已验证）；Codex `_meta.callId`（≥ 0.148.0）；Pi `_meta["pi-mcp-adapter/toolCallId"]`（adapter ≥ 3.0.0）；OpenCode 插件运行时的 `context.callID`（1.15.10 已验证，但不在公开类型里）；OMP `host_tool_call.toolCallId`。daemon 现在把这些 id 全部丢掉了（`mcp-server.ts:47`、`bridge-plugin.mjs:38-45`、`omp/host-tools.ts:196`），但 MCP SDK 的 `extra._meta` 是能读到的。
- **推荐方案 (1)**：daemon 读出 id，经 `PaseoToolExecutionContext` 传给 `create_agent`，作为 daemon 自有标签（例如 `paseo.parent-tool-call-id`，要覆盖模型传入的同名键）写到子智能体上；app 用 (parentAgentId, callId) 在 agent store 里关联，和 Subagents track 同源。wire schema 不用改，只加一个 `server_info.features.*` 开关。实时场景下，子智能体一创建就能关联；重载后标签持久、provider 历史里的 callId 不变，所以仍然成立；导入会话会换新的父 id，v1 在这种情况下退回通用卡。
- 方案 (2)（从工具结果解析 agentId）：文本里已经有 agentId，只是带 `availableModes_count=` 前缀。建议只把它作为 daemon 内部补位，用在拿不到 id 的调用上，不当作 app 的解析契约。方案 (3)（按时间、prompt 启发式匹配）不采用。
- 仍存疑：CC 从哪个版本开始带 `toolUseId`；OpenCode `callID` 未文档化；Pi adapter 3.0.0 才开始带 id；没有端到端抓包实测；已归档的子智能体是否在 app store 里。
- 详见 `research/create-agent-child-link.md`。
