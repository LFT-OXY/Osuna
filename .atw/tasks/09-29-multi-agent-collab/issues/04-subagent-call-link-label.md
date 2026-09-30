# 04 — 子智能体关联标签与工具名规范化

**What to build:**
- daemon 读出 provider 侧的 tool call id，经工具执行上下文传给 `create_agent`，作为 daemon 自有标签 `paseo.parent-tool-call-id` 写到子智能体上，覆盖模型传入的同名键。来源：Claude `_meta["claudecode/toolUseId"]`、Codex `_meta.callId`、Pi `_meta["pi-mcp-adapter/toolCallId"]`、OpenCode 插件 `context.callID`、OMP `toolCallId`。拿不到 id 就不写，不从工具结果里补。
- OpenCode、Pi、OMP adapter 往时间线写条目时，把工具名规范成 `paseo.create_agent`、入参平铺（Pi 拆掉 `{tool, args}`）。
- `server_info.features.subagentCallLinks` 上线。
- `docs/providers.md` 写明新 provider 要提供 tool call id 与规范化的工具名。

**Blocked by:** None — can start immediately
**Status:** ready-for-agent
**Impl:** done

- [x] daemon 测试：带 `_meta` tool call id 调 `/mcp/agents?callerAgentId=<父>` 的 `create_agent`，子智能体带 `paseo.parent-tool-call-id`；模型在 labels 里传同名键时被覆盖；不带 id 时没有该标签。
- [x] adapter 单测：五个来源各自取到 id；OpenCode、Pi、OMP 的时间线工具名为 `paseo.create_agent`，入参平铺。
- [x] `server_info.features.subagentCallLinks` 存在。
- [x] `docs/providers.md` 已更新。
- [x] `npm run typecheck`、`npm run lint` 通过。
