# 10 — 新建会话首条消息的 mention

**What to build:**
- `create_agent_request`、`agent.create.request`、`workspace.create.request` 的首条消息带 Agent mention 时同样附加 Routing block；daemon 建好会话后按实际判定结果决定附不附。
- provider 快照的每个 provider 条目加预测字段（与 agent 快照同形的 `canCreateAgents` 与原因码），新建界面据此置灰智能体分组（OpenCode 偏保守，已接受）。

**Blocked by:** 05, 06
**Status:** ready-for-agent
**Impl:** ready

- [ ] daemon 测试：三种新建请求的首条消息带 mention 时，provider 收到 Routing block；会话实际不能派发时不附。
- [ ] daemon 测试：provider 快照带预测字段，与各种配置组合一致。
- [ ] 浏览器 e2e：新建界面按所选 provider 的预测字段置灰或可用。
- [ ] `npm run typecheck`、`npm run lint` 通过。
