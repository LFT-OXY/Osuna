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
**Impl:** ready

- [ ] 端到端（时间缩短）：上游迟迟不开口时，Claude Code 先收到 200 和 `text/event-stream`，再按间隔收到 `ping`；开口后收到上游的内容，顺序正确。
- [ ] Codex 的同样场景，收到带数据的 `response.in_progress` 事件。
- [ ] 保活开始后全部候选失败：Claude Code 收到 `api_error` 事件，Codex 收到 `response.failed` 加 `server_error`，消息里有接口名。
- [ ] 在 15 秒（缩短后的值）之内失败：照现状回真实状态码和 Retry-After。
- [ ] 上游毫无动静超过 5 分钟（缩短后的值），停止保活。
- [ ] 不流式的请求不发保活。
- [ ] 实现记录写明「4 分钟上限」的结论。
- [ ] 借鉴 magpie 的代码，文件头保留 MIT 声明。
- [ ] `npm run typecheck`、`npm run lint` 通过，改到的测试文件本机通过。

参考：prd.md 第 9–11 条；明细 01·C03；research/decisions.md「两个 CLI 的行为」。
