# 03 — 子智能体权限交给用户：通知、提醒、工作区状态、track

**What to build:**
- 完成通知的 needs permission 段全局改写：用户会在子智能体会话里批准，不要用 `respond_to_permission` 回应，除非用户明确让你管理这个子智能体的权限；`<permission-request>` 载荷照附。对所有 `notifyOnFinish` 的 `create_agent` 与 `send_agent_prompt` 生效。
- attention 广播对带父标签的智能体只放行 `permission`（推送与系统通知，焦点目标是子智能体，沿用现有通知计划的压制规则）；`finished` 与 `error` 仍然跳过。
- 同工作区子智能体有待批准权限时，给祖先所在工作区贡献"需要批准"档；`error` 与 attention 仍只留在 track。
- Subagents track 的 Paseo 子智能体行把待批准计数交给状态分桶，出现"等待批准"；`requiresAttention` 保持 false。
- 改写 `docs/agent-lifecycle.md` 完成通知里"调用方可回应权限"的描述，以及 Workspace activity 一节。

**Blocked by:** None — can start immediately
**Status:** ready-for-agent
**Impl:** ready

- [ ] daemon 测试：子智能体请求权限时，父智能体收到的通知正文是新文案且带载荷。
- [ ] daemon 测试：客户端收到子智能体的 `agent_attention_required`（reason 为 permission）；子智能体完成或出错时没有。
- [ ] daemon 测试：同工作区子智能体等待批准时，工作区状态为"需要批准"；批准后恢复。
- [ ] 浏览器 e2e：track 行在子智能体等待批准时显示等待批准；推送载荷的 agentId 是子智能体。
- [ ] `docs/agent-lifecycle.md` 已更新。
- [ ] `npm run typecheck`、`npm run lint` 通过。
