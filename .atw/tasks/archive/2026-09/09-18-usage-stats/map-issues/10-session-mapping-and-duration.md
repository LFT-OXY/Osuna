# 10 — Paseo 会话到日志的映射与每轮耗时规则

**Type:** interview
**Blocked by:** 01, 02, 03
**Status:** resolved

## Question

定：agent 记录新增的 provider session id 列表字段名、写入点（Claude 每次 resume 追加，Pi/OMP 用 nativeHandle 路径，Codex 用 thread id）与旧记录的回填边界；Composer 工具条本会话用量的求和规则；每轮耗时在四种日志里的统一推导规则（轮次边界的判定、工具调用等待是否计入、异常中断的轮次如何算）。耗时已由 07 定为落在用量行的 `durationMs`（轮按开始时间归桶），本票只定推导规则。另定：每日明细展开的会话行如何把 handle 交给 Session history 打开/导入——行里有 `(cli, sessionId, cwd)`，Pi/OMP 的文件路径从 07 定的 `usage/scan-state.json` 反查，Codex 用 thread id；跨 Host 时 handle 归属已由 08 号票定（会话行来自哪个 Host 就归哪个 Host），本票不再讨论。另定 `usage.agent.get` 响应里 `complete` 的判定规则。

## Answer

访谈一轮十二题，全部按推荐通过（2026-09-18）。

### 1. Backing sessions：agent 记录的 provider session id 列表

- `STORED_AGENT_SCHEMA` 新增顶层可选字段 `providerSessionIds: string[]`，按首次出现顺序去重。不放 `persistence.metadata`（provider 自留地），不只靠日志反推（日志被删或目录未纳入时无从查起）。
- 唯一写入点 `refreshSessionPersistence`（`agent-manager.ts:4315`）：handle 的 `sessionId` 与列表末项不同就追加；创建/导入时初始化为 `[sessionId]`。这一处同时覆盖 `thread_started` 与 runtimeInfo 两条换 id 路径。四家都维护，Codex（thread id）、Pi/OMP（文件路径为 nativeHandle，resume 不换）通常长度 1；只有 Claude SDK 入口每次 resume 换 id。
- 旧记录：读时缺失即视为 `[persistence.sessionId]`，不做迁移写盘。Claude 再沿 scan-state 里记的 `forkedFromSessionId` 父链向前补全，所以旧记录也能拿到完整历史；"回填不全"只剩日志已删一种情形。
- 术语进 `docs/glossary.md`：**Backing sessions**。
- 假设：Paseo 的 Fork 是新 agent、自带新列表，不与源 agent 关联；Codex `forked_from_id`、Pi/OMP `parentSession` 由 CLI 自己的分支产生，Paseo 不触发，不纳入链。

### 2. scan-state 游标条目新增字段（修订 07）

每个游标条目在 `{ path, inode, size, mtimeMs, offset }` 之外再存：

- `forkedFromSessionId: string | null`（仅 Claude，取首个带 `forkedFrom` 的行）
- `firstAt` / `lastAt`：该文件首末消息条目的精确时间戳（会话级取同 sessionId 所有游标的 min/max）
- `openTurn: { startedAt, recordedEndAt } | null`：未结算轮的状态，见第 4 节

### 3. `usage.agent.get` 求和与 `complete`

- 求和范围 = 列表（含反推链）内每个 `(cli, sessionId)` 的全部行，跨 cwd 一并算，含已归父会话的子代理行；按 model 分组，`turns`/`durationMs` 直加；`firstAt`/`lastAt` 来自游标条目，不用桶起点（15 分钟精度不够 tooltip 用）。
- `complete = 回填不处于 running 且列表内每个 sessionId 都在 scan-state 有游标`。找不到文件 → false。08 里"旧记录只有最后一个 id"的定义作废。
- 运行中的一轮：Composer 条显示已结算之和 + 本地秒表实时叠加（与 turn-footer 同口径），`turn_completed` 后收到 `usage.updated` 重拉替换。

### 4. 每轮耗时的统一推导规则

- **起点** = 用户提交时刻：Claude 用户行 ts、Codex `task_started` ts（含上下文/MCP 准备，比 `turn_context` 早数秒）、Pi/OMP user 条目 ts。
- **终点** = 本轮最后一条消息条目（assistant 或 tool_result）的 ts；中断/异常同样取最后一条，不区分。与客户端 `deriveStreamTurnTiming` 同口径。
- **等待全部计入**：工具执行、权限等待、用户在弹窗上停留都算墙钟耗时；不做纯模型耗时。
- **增量结算**：`turns` 在本轮首条 assistant 出现时 +1 记入起点桶；`durationMs` 分次追加 `当前终点 − recordedEndAt`，触发条件：终止标记（Claude assistant `stop_reason≠tool_use`、Codex `task_complete`/`turn_aborted`、Pi/OMP assistant `stopReason≠toolUse`）、下一条用户提交、或文件 mtime 静止超过 10 分钟（由 11 号票的兜底扫描触发）。终止后同轮再出现 assistant（stop hook 续跑）→ 再追加一段。token 行不受结算影响，逐条 assistant 立即写。
- **子代理/子线程不计轮**：Claude `subagents/`、Pi/OMP `tasks/` 与嵌套目录、Codex `session_meta.source.subagent` 文件一律只计 usage，`turns=0`、不计耗时。

否决：不结算未终止轮、游标停在轮起点前（token 会跟着延迟，Composer 在 `turn_completed` 后仍看不到数）；Codex 用 `turn_context` 作起点（系统性少算）。

### 5. 会话行 → Session history 的 handle（修订 08）

- `usage.sessions.list` 行追加可选字段：`handle: { providerId, providerHandleId } | null`（Claude/Codex = sessionId；Pi/OMP = scan-state 反查的文件路径，查不到为 null）、`importedAgentId?`、`importedAgentWorkspaceId?`。字段与 `RecentProviderSessionDescriptorPayload` 同名，客户端复用 session-history 的打开/导入 mutation。
- "已导入"匹配扩展到 Backing sessions 任一 id（`listByProviderSession` 同时查列表）。
- 点击行为沿用 Session history：已导入 → 打开 agent，否则终端 resume；是否给「导入」动作归 12 号原型票。
- **Claude resume 链合并为一行**：链归到最新 id，handle 用最新 id；`summary.sessionCount` 把一条链算 1 个会话（08 的"(cli, sessionId) 去重"口径改为按链）。

## Comments

- 2026-09-18，由 13 号票修订：第 3 节 "Composer 条" 的求和与 `complete` 规则不变，呈现位置改为上下文环形表弹层的「本会话合计」；每轮 token 归属需要每轮行与客户端 timeline 轮次对齐，归 15 号票。见 `map-issues/13-composer-usage-strip-prototype.md`。

- 2026-09-18，由 15 号票补充：子代理 usage 归入父轮的每轮行（Claude 用首条 user 行 promptId、Codex 用 `root_turn_id`、无键者按时间包含），仍不计轮；每轮行的耗时按 `lastAt − startedAt` 派生，不做第二份结算。见 `map-issues/15-turn-usage-rows-and-rpc.md` 第 2、5 节。
