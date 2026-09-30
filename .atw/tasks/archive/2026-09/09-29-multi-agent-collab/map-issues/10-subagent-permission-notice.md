# 10 — 子智能体请求权限时的父会话通知与用户提醒

**Type:** interview
**Blocked by:** None
**Status:** resolved

## Question

PRD 定了"子智能体权限请求交给用户，父智能体不得用 `respond_to_permission` 代批"。但现有通知 `agent-prompt.ts:398-409` 在子智能体 needs permission 时，明确要求父智能体用 `respond_to_permission` 代批，而且对所有 `notifyOnFinish` 的 `create_agent` 子智能体都生效，不限于 mention 派出的。另外，daemon 对带父标签的智能体跳过 attention 与推送（`isDelegatedAgent` 短路，见 `research/subagent-permission-source.md`），用户可能根本不知道要去批准。要定：(1) 通知正文怎么改：改成"等待用户批准，勿代批"，还是不再发 needs permission 通知，或者只对 mention 派出的子智能体改（那样就需要能区分来源）；(2) 改动是否影响现有依赖代批的编排用法（如用户明确让父智能体自主管理子智能体）；(3) 子智能体等待批准时是否提醒用户（侧边栏、推送），提醒指向子会话还是父会话。

## Answer

访谈 2026-09-30，四条均按推荐定。

1. **通知正文全局改，不区分来源。** `formatFinishNotificationBody`（`packages/server/src/server/agent/agent-prompt.ts:395`）的 needs permission 段改为：用户会在子智能体的会话里批准，不要用 `respond_to_permission` 回应，除非用户明确让你管理这个子智能体的权限。`<permission-request>` 载荷照常附上（父智能体可向用户转述；用户授权自主编排时仍可代批）。对所有 `notifyOnFinish` 的 `create_agent` 与 `send_agent_prompt` 生效，不加 mention 来源标记。路由提示 v2 的严格禁令不变（mention 场景用户未授权代批）。仍发通知，不取消：父智能体需要知道子智能体卡在批准上。
2. **子智能体的权限请求打开用户提醒。** `broadcastAgentAttention`（`agent-manager.ts:4959`）的 `isDelegatedAgent` 短路只保留给 `finished`/`error`，`permission` 放行，走现有推送与系统通知链路；是否压掉推送沿用现有 `computeNotificationPlan`，焦点目标为子智能体，不为"正在看父会话"加特例。改动的是上游 #1293 的降噪行为，只放开可操作的这一种原因。
3. **待批准向上汇总到工作区状态。** 同工作区子智能体目前只给祖先贡献 `running`（`workspace-directory.ts:376-386`、app `workspace-agent-activity.ts`、`subagents/workspace-root-policy.ts`）；改为有待批准时贡献"需要批准"档，`error`/attention 仍只留在 track。`docs/agent-lifecycle.md` 的 Workspace activity 一节与 :77-78 的"caller can respond"描述随之改写（归 `/atw-spec` 的文档清单）。
4. **提醒跳转。** Paseo 子智能体的提醒指向子会话（在那里批准）。provider 子智能体保持现状：权限挂在父 agent 上，推送跳父会话，父面板可直接批准；不做到只读面板的深链。
