# 08 — 用量查询协议与跨 Host 合并

**Type:** interview
**Blocked by:** 07
**Status:** resolved

## Question

定 `usage.*` RPC 集合：查询参数（from/to、客户端时区、粒度 day/hour/month、筛选来源/模型/项目）、响应形状（汇总、按天、按月、按来源→模型、项目 Top 10、热力图、会话行、回填进度）、是否一个 RPC 带 facets 还是多个 RPC；`server_info.features.usage` 门控与旧 daemon 的提示；客户端如何向每个已连接 Host 发同一查询并求和（哪些量可加、哪些不可加如 Top 10、会话数）；离线 Host 的表示。

## Answer

访谈两轮十二题，全部按推荐通过（2026-09-18）。

**原则**：聚合在 daemon 内存里算，客户端只做跨 Host 相加；daemon 之间不互通（沿用 `useAggregatedAgents` 的逐 Host 取数再合并范式）。估算成本在 daemon 查询时按当前价格表算（07 号票），响应里直接带 `estimatedCost`（USD 浮点），token 为整数五列 `input / cachedInput / cacheWrite / output / reasoning`。命名沿用 `provider.usage.list` 的三段式 `usage.<名词>.<动词>.request/response`。

### RPC 集合

1. **`usage.report.get.request`** — 「用量」页首屏一次拿全部区块（Plan usage 继续走 `provider.usage.list`，价格表读写归 09 号票）。
   - 请求：`{ requestId, from: "YYYY-MM-DD" | null, to: "YYYY-MM-DD", timezone: IANA, filters?: { sources?: [{cli, backend}], models?: string[], projects?: string[] /* rootPath */ }, trend?: { granularity?: "hour"|"day"|"month", stackBy: "source"|"model" } }`。`from/to` 是客户端本地日期闭区间，"全部"传 `from: null`；daemon 用 `timezone` 把 UTC 15 分钟桶换算成本地日/小时/月分组。粒度未传时按范围定：≤2 天 → hour，≤92 天 → day，否则 month。
   - 响应 `payload`：
     - `summary: { totals, estimatedCost, sessionCount, last7Days: {totals, estimatedCost}, last30Days: {...} }` —— 近 7/30 天按请求时区的"今天"算，独立于 from/to 始终返回。
     - `sources: [{ cli, backend, totals, estimatedCost, modelCount, share }]`
     - `models: [{ model, cli, backend, totals, estimatedCost, priced: boolean }]` —— **全量**、降序，不截 Top；价格表区块列 `priced=false` 的项。
     - `trend: { granularity, stackBy, points: [{ key: "2026-09-18" | "2026-09-18T14" | "2026-09", groups: Record<string, {totals, estimatedCost}> }] }` —— 切堆叠维度或粒度重发请求。
     - `days: [{ day, totals, estimatedCost, sessionCount, turns }]` —— 热力图（日历格，level 0-4）由客户端从此派生，不单独返回矩阵。
     - `months: [{ month, totals, estimatedCost, sessionCount }]`
     - `projects: [{ rootPath, displayName, kind: "git"|"non_git"|"directory", totals, estimatedCost, cwds: [{ cwd, totals, estimatedCost }] }]` —— **全量**（上限 200 条）降序，Top 10 由客户端在跨 Host 合并后截取。
     - `backfill: { state: "idle"|"running"|"done", filesTotal, filesDone, startedAt }`
     - `error: string | null`
2. **`usage.sessions.list.request`** — 每日明细展开的会话行，按需拉。请求同 1 的 `{ from, to, timezone, filters }`。响应行 = **一行一 (会话, 本地日)**，同一会话跨天多行，token 只算当天：`{ day, cli, backend, sessionId, cwd, project: {rootPath, displayName}, models: [{model, 五列, estimatedCost}], totals, estimatedCost, turns, durationMs, firstAt, lastAt }`，按 `lastAt` 倒序；每天最多 500 行，超出截断并带 `truncated: true`。跳转 Session history 所需的 handle 字段由 10 号票定后作为可选字段追加。
3. **`usage.agent.get.request { agentId }`** — Composer 用量条。daemon 从 agent 记录读 provider session id 列表（Q27）自行求和，客户端不接触 id 列表；响应 `{ byModel: [{model, 五列, estimatedCost}], totals, estimatedCost, turns, durationMs, firstAt, lastAt, complete: boolean }`，`complete=false` 表示旧记录只有最后一个 id、回填不全。求和规则归 10 号票。
4. 广播事件（无 request/response 对）：
   - **`usage.backfill.progress`** —— 字段同 `backfill`，节流 ≥1 秒一次；页面据此刷进度，`done` 时重拉报表。调度归 11 号票。
   - **`usage.updated { cli, sessionId, agentId? }`** —— 增量解析写入新行后发；「用量」页去抖重拉，Composer 条只在 `agentId` 命中自己时重拉。

### 项目归属

行只有 `cwd`。归属顺序：**项目注册表**（cwd 在某 `projectRootPath` 之下）→ 向上找 **git 根**（按 cwd 缓存）→ **cwd 本身**（目录已不存在时也落这里）。

### 跨 Host 合并（客户端）

- 向每个已连接且 `features.usage=true` 的 Host 发同一请求，Host 筛选决定发给谁，**不进协议**。
- 可加：`summary` 的 token / 成本 / 会话数（`(cli, sessionId)` 在各 Host 内已去重，跨 Host 直接相加）、`days` / `months` / `trend` 按 key 相加、`sources` / `models` 按 key 合并后重排。
- **项目不跨 Host 合并**：每行带 `serverId`，同名项目在两台 Host 上是两行，多 Host 时显示 Host 徽标，合并后再截 Top 10。
- 会话行合并时每行带 `serverId`，handle 归属即该 Host（回答 10 号票的"跨 Host 时 handle 归属哪个 Host"）。

### 门控与离线

- 一个 flag `server_info.features.usage`，带 COMPAT 标签注明添加版本。侧栏「用量」项在**任一**已连接 Host 支持时出现。
- Host 筛选列表里：`useHostFeatureAvailabilityMap` 为 `false` 的 Host 标"需要更新主机"，为 `null`（未连接）的标"未计入"，二者都不计入合计。呈现形态归 12 号原型票。

### 否决的替代方案

每区块一个 RPC 或 `facets` 参数；客户端传 UTC 区间或自行归日；响应同时带两份堆叠序列；daemon 只返回 Top 10；项目按目录名或 git 远端跨 Host 合并；两个 feature flag；轮询代替广播；客户端传 provider session id 列表；会话行一会话一行。

## Comments

- 2026-09-18，由 10 号票修订：`usage.sessions.list` 行追加 `handle` / `importedAgentId` / `importedAgentWorkspaceId`；Claude resume 链合并为一行且 `summary.sessionCount` 按链计数；`usage.agent.get` 的 `complete` 改为"回填非 running 且每个 backing session 都有游标"。见 `map-issues/10-session-mapping-and-duration.md` 第 3、5 节。

## Comments

- 2026-09-18，由 11 号票补充：`backfill.state` 三态的判定（启动轮 = 回填）、`usage.backfill.progress` 与 `usage.updated` 的发送时机、`agentId` 反查规则，见 `map-issues/11-refresh-and-backfill.md` 第 4、7 节。

- 2026-09-18，由 12 号票修订：响应新增 `heatmapDays: [{ day, totals }]`，固定返回请求时区下最近 182 天（26 周），独立于 from/to；热力图不再从 `days` 派生。Host 筛选与"需要更新主机"/"未计入"的呈现见 `map-issues/12-usage-page-prototype.md` 跨切面一节。

- 2026-09-18，由 13 号票修订：`usage.agent.get` 的消费方从 "Composer 用量条" 改为上下文环形表弹层的「本会话合计」段；新增 `usage.agent.turns.list.request { agentId }` 供 turn footer 取每轮用量，形状归 15 号票；`usage.updated` 命中 `agentId` 时两处都重拉。见 `map-issues/13-composer-usage-strip-prototype.md` 第 2、3 节。

- 2026-09-18，由 15 号票定稿：`usage.agent.turns.list.request { agentId }` 响应为全部 Backing sessions 的每轮行（不分页），每行带 `turnKey` / `turnId | null` / `userMessageIds` / `startedAt` / `endedAt` / `durationMs` / `byModel` / `totals` / `estimatedCost` / `priced`，外层 `complete`。见 `map-issues/15-turn-usage-rows-and-rpc.md` 第 4 节。
