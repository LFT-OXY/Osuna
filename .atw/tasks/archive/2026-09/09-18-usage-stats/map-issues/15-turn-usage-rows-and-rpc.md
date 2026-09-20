# 15 — 每轮用量行的 schema、turnKey 与 `usage.agent.turns.list` 协议

**Type:** interview
**Blocked by:** None
**Status:** resolved

## Question

13 号票定了 turn footer 显示每轮 token 与估算成本、数据源为日志解析时另落每轮行。定：(1) 每轮行 schema——键 `(cli, sessionId, turnKey, model)` 之外还存什么（五列 token、startedAt、endedAt、durationMs？成本仍查询时算）、落在哪个文件（与桶行同目录的 `usage/turns-YYYY-MM.jsonl`？）、是否随 07 的启动压缩一起处理、全量进内存还是按会话懒加载（本机 31 万行日志、外推一年的轮次量级）；(2) 四家的 `turnKey`——Claude 用户行 `promptId`、Codex `turn_id`、Pi/OMP 用 user 条目 `entry.id` 或时间戳，子代理行归父轮还是不计；(3) 客户端 timeline 里的轮（`deriveStreamTurnTiming` 按 user_message 切）如何对齐到每轮行——按 Paseo `turnId`（Codex 有、Claude SDK 无）、按用户消息时间戳最近匹配、还是 daemon 在 `turn_completed` 时记下 `turnId → turnKey` 映射；resume 链与 backing sessions 跨文件时的对齐；(4) `usage.agent.turns.list.request { agentId }` 响应形状（一行一轮：turnKey、startedAt、byModel、totals、estimatedCost、durationMs；是否分页、是否只回最近 N 轮）与 `usage.updated` 到达后的增量拉取；(5) 每轮行的 `durationMs` 与 07/10 已定的桶行 `durationMs` 是同一份增量结算还是各算一份。参考 `research/claude-log-format.md`、`research/codex-rollout-format.md`、`research/pi-omp-log-format.md` 的轮次边界结论。

## Answer

访谈一轮七题，全部按推荐通过（2026-09-18）。前置事实：Paseo 的 `turnId` 四家都是 daemon 自造 UUID（Claude `createTurnId`、Pi `randomUUID`、Codex `createTurnId`），不等于日志轮键；Codex 的 app-server 轮 id 只在 provider 内存的 `userMessageProviderTurnIds` 里，不进 durable timeline 行；timeline 用户消息的 `messageId` = Claude SDK user 行 `uuid`（日志同一行带 `promptId`）/ Pi `entry.id` / OMP 原生 entry id，Codex 为 app-server item id 对不上 rollout；durable timeline 行持久化 `timestamp / turnId / providerMessageId`，provider 历史导入的行无 `turnId`；客户端 `deriveStreamTurnTiming`（`packages/app/src/timeline/turn-time.ts`）有 `turnId` 按它切、否则按 user_message 边界切，footer 按 assistant item id 取时长。

### 1. 每轮行 schema 与落盘（修订 07）

- 术语 **Turn usage**（每轮用量），已进 `docs/glossary.md`。
- 文件 `usage/turns-YYYY-MM.jsonl`，按轮 `startedAt` 所属月分文件，与桶行同目录、同 `UsageStore` 管理；`appendRows` 一批内桶行与每轮行同写，游标随后（与 11 号票"行先游标后"一致）。
- 行 = 一次解析对键 `(cli, backend, sessionId, turnKey, model)` 的增量：五列 token（口径同桶行）、`startedAt`（轮起点，同 10 号票第 4 节）、`lastAt`（本次增量内最后一条消息条目 ts）、`userMessageIds: string[]`、`turnId?: string`。不存成本、耗时、cwd。
- 同键多行启动相加：token 相加、`startedAt` 取最小、`lastAt` 取最大、`turnId` 取非空、`userMessageIds` 并集；压缩规则照抄 07 第 4 条。
- 否决：每轮行不分模型、模型明细塞数组（弹层按模型列，增量行合并数组麻烦）。

### 2. 四家 `turnKey` 与子代理归属

- 主线程：Claude user 行 `promptId`；Codex `turn_id`；Pi/OMP 开轮 user 条目 `entry.id`。
- 子代理 usage **算进父轮**，不产生新轮：Claude 子代理文件首条 user 行 `promptId` = 父轮键；Codex ≥0.153.2 用 `turn_context.root_turn_id`；Codex 旧文件与 Pi/OMP `tasks/` 子会话无键，按时间包含匹配——子文件 header `timestamp` 落在父会话哪一轮的 `[startedAt, lastAt]` 内归哪轮；仍匹配不上的只进桶行、不进每轮行。

### 3. 客户端 timeline 轮与每轮行的对齐

- `userMessageIds`：Claude = 该 promptId 组内全部 user 行 `uuid`（含伴随 meta 行）；Pi/OMP = `[entry.id]`；Codex = 空。
- 11 号票 `turn_completed` 触发的定向解析闭合的那一轮，其增量行带 Paseo `turnId`（一个 agent 同一时刻只有一个前台轮）；Claude/Pi/OMP 再用 `userMessageIds` 与该 `turnId` 下 user_message 行的 `messageId` 交叉校验，不一致以 id 为准。
- Codex 历史轮（daemon 重启前或功能上线前）没有 `turnId` 也没有 id：daemon 组装响应时按 durable timeline 的 user_message `timestamp` 与 `startedAt` 最近匹配（±30 秒内）补 `turnId`；Claude/Pi/OMP 不做时间匹配。
- 客户端匹配顺序：`turnId` 相等 → 本轮首条 user_message 的 `messageId ∈ userMessageIds` → 都不中则不显示用量段（骨架只用于"轮已完成但行未到"）。
- 否决：客户端按时间戳最近匹配（秒级连发会串）；给 `turn_completed` 加 provider 轮 id（改 wire 事件，且 Claude/Pi 本就没有 provider 轮 id）。

### 4. `usage.agent.turns.list`（修订 08）

- 请求 `{ requestId, agentId }`；响应 `{ turns: [{ cli, backend, sessionId, turnKey, turnId: string | null, userMessageIds, startedAt, endedAt, durationMs, byModel: [{ model, 五列, estimatedCost, priced }], totals, estimatedCost, priced }], complete: boolean }`，按 `startedAt` 升序，范围 = 该 agent 全部 Backing sessions（含 resume 链）的每轮行；不分页、不带 `since`；`complete` 语义同 `usage.agent.get`；同一 `features.usage` 门控。
- `usage.updated` 命中 `agentId` 时客户端整份重拉。否决分页 / 只回最近 N 轮 / `since` 增量。

### 5. `durationMs`

每轮行不存耗时：`endedAt = lastAt`，`durationMs = endedAt − startedAt`，查询时派生；桶行的分次结算（10 号票第 4 节）不动，二者按构造相等。

### 6. 内存

随桶行启动全量进内存，服务层建 `(cli, sessionId) → 轮列表` 索引；不按会话懒加载。量级为估算（115 天 1859 会话、按每会话十几轮约 2 万轮，一年约 6 万行、十几 MB），未实际统计。

### 7. 剩余的雾

测试接缝与文档归属留给 `/atw-spec` 写 prd 时一并定，不再开票。地图到此路线清晰。
