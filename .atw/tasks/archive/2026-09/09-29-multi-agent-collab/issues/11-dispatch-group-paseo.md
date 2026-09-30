# 11 — 时间线派发组（Paseo 子智能体）

**What to build:**
- 同一段助手输出里连续的 `paseo.create_agent` 调用（产出 Subagent 的）合成派发组，行为以 07 号决策票与原型 `prototype/subagent-card.html?variant=C` 为准：组头"派出 N 个子智能体"加按 track 桶顺序的分段计数，可折叠；每行图标、标题、副行（等待批准时换成"等待批准 · 工具名"）、实时时长、状态；数据与 Subagents track 同源（含 03 的等待批准）。
- 关联按 `paseo.parent-tool-call-id` 标签，父 agentId 与 callId 同时匹配，脱离后仍能找到。
- 点击复用 track 的打开处理。过渡态"启动中"（不可点）；调用完成仍未命中时按标签调一次带 `includeArchived` 的 `fetch_agents`，已归档显示最终状态加"已归档"，还查不到就退回通用卡；已脱离显示"已分离"；取消轮次不影响行。
- 退回通用工具卡：没有关联标签、老 Host（没有 `subagentCallLinks`）、导入会话、不带 workspaceId 的顶层 `create_agent`。
- `mock` provider 加一个脚本化 prompt，往时间线写一条带 callId 的 `paseo.create_agent` 调用。

**Blocked by:** 03, 04
**Status:** ready-for-agent
**Impl:** done

- [x] 浏览器 e2e：连续两个调用合成一组，中间插正文时分成两组；组头计数与行状态随子智能体状态实时变化。
- [x] 浏览器 e2e：点开 Paseo 子智能体打开普通 agent 标签；启动中不可点；已归档、已分离显示正确。
- [x] 浏览器 e2e：子智能体等待批准时，行与组头计数显示等待批准。
- [x] 浏览器 e2e：老 Host 与无标签的调用退回通用工具卡。
- [x] 派发组分组逻辑有单测（关联与切段补进现有 `subagents/select.test.ts`；按连续调用成组在 `tool-calls/detail-level/projection.test.ts`）。
- [x] Electron QA 截图：运行中、等待批准、已完成。
- [x] `npm run typecheck`、`npm run lint` 通过。
