# 17 — 保活，以及开头发出后出错怎么交给 CLI

**What to build:**

- **保活**：CLI 要流式的请求，从进来开始等满 15 秒还没开口，就先给 CLI 回 200 和事件流的响应头，之后每 15 秒发一个保活事件：
  - Claude Code 用 `ping`；
  - Codex 用 `response.in_progress`，必须是带数据的事件，因为 Codex 不认注释行。
- **停止保活**：上游 5 分钟毫无动静，就停。
- **保活开始之后才失败**（包括全部失败、全部在冷却、空回复）：改在流里发错误。消息仍是「<接口名>: <上游原文>」。
  - Claude Code 收到 `error` 事件，类型是 `api_error`；
  - Codex 收到 `response.failed`，code 是 `server_error`。
- **15 秒内就失败**：照现状回真实状态码和 Retry-After。
- **测试**：15 秒和 5 分钟沿用现有中转站测试参数覆盖项的做法，测试里可以缩短。
- **待定**：Codex 方向要不要 magpie 的「累计最多扣 4 分钟」，对照 magpie 代码再定，结论写进实现记录。

**Blocked by:** 13
**Status:** ready-for-agent
**Impl:** done

- [x] 端到端（时间缩短）：上游迟迟不开口时，Claude Code 先收到 200 和 `text/event-stream`，再按间隔收到 `ping`；开口后收到上游的内容，顺序正确。
- [x] Codex 的同样场景，收到带数据的 `response.in_progress` 事件。
- [x] 保活开始后全部候选失败：Claude Code 收到 `api_error` 事件，Codex 收到 `response.failed` 加 `server_error`，消息里有接口名。
- [x] 在 15 秒（缩短后的值）之内失败：照现状回真实状态码和 Retry-After。
- [x] 上游毫无动静超过 5 分钟（缩短后的值），停止保活。
- [x] 不流式的请求不发保活。
- [x] 实现记录写明「4 分钟上限」的结论。
- [x] 借鉴 magpie 的代码，文件头保留 MIT 声明。
- [x] `npm run typecheck`、`npm run lint` 通过，改到的测试文件本机通过。

参考：prd.md 第 9–11 条；明细 01·C03；research/decisions.md「两个 CLI 的行为」。

## Comments

### 实现记录（2026-10-17）

- 保活在新文件 `keepalive.ts`（`AgentKeepAlive`）：每个要流式的 Agent 请求一个，`handleAgentRequest` 从请求进来时计时；满 15 秒还没开口就回 200、`text/event-stream`，之后每 15 秒发一次 Claude Code 的 `ping` 或 Codex 的 `response.in_progress`（带 `response` 对象的真事件，没有注释行）。上游（发出请求、开口前收到字节都算）5 分钟毫无动静时不再发；换到下一家、原地重试再发请求后又会恢复。开口时（直通 `attemptEndpoint`、翻译 `attemptTranslated`）先停保活，响应头已经发出就不再 `writeHead`，回复接在保活后面写。count_tokens 和不流式的请求不保活。
- 保活开始之后再失败：`sendAgentError` 看到响应头已经发出，就改发流里的错误并结束（magpie `streamFailure`）：Claude Code 收到 `error` 加 `api_error`，Codex 收到 `response.failed` 加 `server_error`，消息仍是「<接口名>: <上游原文>」。全部失败、全部在冷却、空回复都走这条路。这时 Retry-After 一类响应头已经发不出去了。
- 测试参数覆盖项：`gatewayKeepAliveMs`（15 秒）、`gatewayKeepAliveQuietMs`（5 分钟）。
- **4 分钟上限的结论：不照搬。** magpie 的 `agentQuietMost`（`fallback.go` 约 1983 行）存在，是因为 magpie 等开口时用 SSE 注释行保活，Codex 不把注释算作事件，接连几次扣住加上中间的暂停会超过 Codex 的 300 秒。这里每 15 秒发一次真事件 `response.in_progress`，每次都重置 Codex 的计时（research/decisions.md 已核实），原地重试暂停时也照发，所以不需要这个上限。代价照 Q10：上游 5 分钟毫无动静、保活停下以后，Codex 会在 300 秒后断开，整轮最多重问 5 次。
- 留给工单 18：直通时上游无视流式要求、回了一整份 JSON，如果这时保活已经开始，这份 JSON 会被写进事件流，CLI 读不懂。18 负责「整份 JSON 转成 CLI 要的流」。翻译路径原本就会把这种回复当作失败换家。
- 保活发出响应头以后，回复里就没有 `x-osuna-api-endpoint` 头了（这个头只用于排查）。
- 审查后改的：在 THIRD_PARTY_NOTICES 里登记 `keepalive.ts`、`agent-errors.ts`；SSE 事件改用 `translation/sse.ts` 的 `sseEvent`；删掉没人用的 getter；计时改为从请求进来开始；补了「保活后空回复」的端到端用例。
