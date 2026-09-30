# 02 — 可派发判定与 agentMentions 开关

**What to build:**
- daemon 在会话 create、resume、import、reload 时判定一次当前会话能否调用 `create_agent`：全局 `mcp.enabled && mcp.injectIntoAgents`；该 provider 的 `paseoTools` 策略允许 `create_agent`；工具确实送进了会话（原生通道看会话绑定的工具目录，OpenCode 不看 manifest；MCP 通道看是否注入了内部 paseo 服务器且 `supportsMcpServers`）。
- agent 快照顶层新增可选的 `canCreateAgents: boolean` 与 `createAgentsUnavailableReason: string`（`z.string()`，不用 enum）；v1 原因码 `mcp_disabled`、`tools_not_injected`、`create_agent_not_allowed`、`tools_not_delivered`。
- `server_info.features.agentMentions` 上线。
- 本票只下发字段，app 端显示归 06。

**Blocked by:** None — can start immediately
**Status:** ready-for-agent
**Impl:** ready

- [ ] 进程内 daemon 测试：四种原因各一个配置组合，快照字段与原因码正确；可以派发时 `canCreateAgents` 为 true 且没有原因码。
- [ ] 运行中改全局开关或 provider 策略，已运行会话的字段不变；reload 后更新。
- [ ] `server_info.features.agentMentions` 存在；新字段都是可选的，wire schema 没有 transform。
- [ ] `npm run typecheck`、`npm run lint` 通过。
