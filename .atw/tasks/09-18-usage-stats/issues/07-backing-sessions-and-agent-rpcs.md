# 07 — Backing sessions、定向解析与 agent 用量 RPC

**What to build:** Paseo 自己的 agent 一轮结束后几秒内，其用量就能通过 `usage.agent.get`（本会话合计）与 `usage.agent.turns.list`（每轮明细，带 Paseo `turnId`）查到；agent 记录记住它用过的全部 provider session id（Claude 每次 resume 追加），旧记录读时补全；每批落盘后按会话广播 `usage.updated { cli, sessionId, agentId? }`。

**Status:** ready-for-agent
**Impl:** doing

**Blocked by:** 05, 06

依据：spec 实现决策第 5 节（定向解析、广播）、第 6 节、第 7 节的两个 agent RPC；10、11、15 号决策票。

范围内：`providerSessionIds` 字段与唯一写入点、旧记录默认 `[persistence.sessionId]` + 沿 `forkedFromSessionId` 链补全、「已导入」判定扩展到任一 id；服务全局订阅 `turn_completed / turn_failed / turn_canceled` 做定向解析（文件定位四家规则、EOF 未闭合 2 秒 / 10 秒重试）、定向队列优先与提升；闭合那轮的每轮行打 `turnId`；Codex 历史轮按 durable timeline 的 user_message 时间戳 ±30 秒补 `turnId`；`usage.updated` 发送规则（启动轮期间不发、`agentId` 反查）；两个 RPC 与 `complete` 判定；运行中的一轮不在响应里做特殊处理（客户端秒表叠加）。

- [ ] 接缝 1：用假 agent client 创建 agent，其 persistence sessionId 指向某个 Claude 夹具会话；假 client 发出 `turn_completed` 后，收到带该 `agentId` 的 `usage.updated`，`usage.agent.turns.list` 最后一轮 `turnId` 等于该轮的 Paseo turnId，`usage.agent.get` 为该会话全部行之和、`complete=true`。
- [ ] 接缝 1：假 client 模拟 resume 换 sessionId，agent 记录 `providerSessionIds` 变成两项；两个夹具文件（新文件带 `forkedFrom`）的用量在 `usage.agent.get` 里只计一次；手工写一条无 `providerSessionIds` 的旧记录，读取后列表为 `[sessionId]` 并沿 `forkedFromSessionId` 补全为两项。
- [ ] 接缝 1：列表里有一个 id 在游标里不存在 → `complete=false`；回填 `running` 期间 → `complete=false`。
- [ ] 接缝 1：定向解析时文件尚未写完（先写半轮再补写），2 秒重试后轮闭合并打上 `turnId`。
- [ ] 接缝 2：Codex 历史轮 `turnId` 时间匹配函数——±30 秒内最近一条命中、超出不命中、Claude/Pi/OMP 行不参与。
- [ ] `docs/data-model.md` agent 记录一节加 `providerSessionIds`。
- [ ] `npm run typecheck`、`npm run lint`，改动的测试文件通过。
