# 12 — provider 子智能体进派发组

**What to build:**
- Claude、Codex、OpenCode、OMP 的 provider 子智能体调用按派发组的行形态显示：标题取 description，副行用描述符的 subtitle；点开 `provider_subagent` 只读标签。provider 子智能体的活动日志不再在组里展开。
- app 保留描述符已有的 `toolCallId`，按父 agentId 加 `toolCallId` 关联。
- 修正 `docs/agent-lifecycle.md` 的过期描述（OMP 已不是 `child_session`，provider 子智能体清单补上 OMP），并说明派发组与 `paseo.parent-tool-call-id`。

**Blocked by:** 11
**Status:** ready-for-agent
**Impl:** ready

- [ ] provider 子智能体调用显示为派发组的行，状态实时更新，点开是只读面板。
- [ ] app 保留 `toolCallId` 并用它关联，有单测。
- [ ] `docs/agent-lifecycle.md` 已更新。
- [ ] `npm run typecheck`、`npm run lint` 通过。
