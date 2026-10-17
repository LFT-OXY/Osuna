# 20 — 断流：不再假装说完，流尾补错误

**What to build:**

**怎么算回复没说完**：
- Anthropic 没有 `stop_reason` 或 `message_stop`；
- Responses 没有 `response.completed`；
- Chat 不带 `[DONE]` 也可能是完整的，不算没说完。

翻译时，不再替上游补结尾。

**开口后上游断了**（连接中断，或没说完就结束）：直通和翻译都这样处理：
1. 在流的末尾先补一个空行；
2. 再补一个协议内的错误事件，写明接口名和原因，文字后面加「(<状态码>: you can retry your request)」。Claude Code 收到的是 `api_error`，Codex 收到的是 `response.failed`；
3. 然后正常结束响应，不再直接掐断连接。

这家照现有规则冷却。CLI 不要流式时，翻译的回复断了，照现状回 502 并附上原因。

**Blocked by:** 17
**Status:** ready-for-agent
**Impl:** done

- [x] 端到端（翻译）：Anthropic 上游发了一半文字后干净断开。Claude Code 收到的流里没有 `message_stop`，而是一个空行加 `api_error` 事件，消息里有接口名、原因和「可以重试」字样。
- [x] Codex 的同样场景，收到 `response.failed`。
- [x] 直通断流（连接中断）：CLI 收到的是错误事件，而不是连接被掐断。
- [x] Chat 上游没有 `[DONE]` 但已经说完：照常算完整。
- [x] 不流式的请求断流：回 502 并附上原因。
- [x] 现有「开口后断流就交给 Agent 并冷却」的用例，按新行为改写，不删除。
- [x] 借鉴 magpie 的代码，文件头保留 MIT 声明。
- [x] `npm run typecheck`、`npm run lint` 通过，改到的测试文件本机通过。

参考：prd.md 第 40、42、43 条；明细 01·B10、B12、C26。

## Comments

### 核对记录（2026-10-17）

逐条对照代码与测试核过；改到的测试文件在 packages/server 下逐个单跑全部通过；`npm run typecheck`、`npm run lint` 在 HEAD 5e5287609 上通过。

- 第 1 条：Claude Code + Anthropic 上游必走直通，字面上的「翻译」场景造不出来；由直通用例（ended short of message_stop gets an error event after a blank line）加翻译用例（Responses 上游 ended short gets api_error）合起来覆盖。
