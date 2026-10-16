# 13 — 开口按第一段内容算（含空回复）

**What to build:** 「开口」改为上游回复里出现第一段真内容：文字、思考或工具调用。直通和翻译都按各自协议来认。

- 在那之前收到的帧（如 `message_start`、`response.created`、`ping`）先扣在中转站，开口时按原来的顺序原样发出。
- 开口前出错或断开，都按换家规则处理；开口后不换家。
- 思考算内容，不扣。

**空回复**指回复已经结束，却没有任何内容，也没有计任何输出 token。开口前收到空回复时：
- 先在同一家再问一次；
- 还是空，就算这家失败，换下一家；
- 全部都空，CLI 收到「empty reply」错误。

CLI 不要流式的请求，按同样的口径判断。

**Blocked by:** 01
**Status:** ready-for-agent
**Impl:** done

- [x] 端到端：第一家先回 `message_start` 再回 `overloaded_error`，第二家正常回答。CLI 只收到第二家的事件流，收不到第一家的任何帧。
- [x] Codex 的同样场景：`response.created` 之后报错。
- [x] 第一家先发了思考再出错：思考已经转给 CLI，不再换家（思考算开口）。
- [x] 空回复：同一家被问两次，然后换到第二家；三家都空时，CLI 收到「empty reply」，用的是 CLI 自己的错误格式。
- [x] 开口后照现状不换家；「开口前断开就换家」等现有用例原样通过。
- [x] 借鉴 magpie 的代码，文件头保留 MIT 声明。
- [x] `npm run typecheck`、`npm run lint` 通过，改到的测试文件本机通过。

参考：prd.md 第 8、12 条；明细 01·C02、B11。

## Comments

### 实现记录（2026-10-17）

- 开口判定在 `upstream-call.ts` 的 `awaitOpening`：边收边用 `ReplyTap` 读（从 `passthrough.ts` 挪到新文件 `reply-tap.ts`，避免循环引用），读到第一段文字、思考或工具调用才开口；之前的字节扣着，开口时一次原样交出。count_tokens 仍是第一个字节就开口。
- 开口前的流内错误按 magpie `streamStatus` 定状态码（`failure.ts`），然后走原有的换家与冷却规则。
- 空回复：按协议说了结束原因、却没有内容、输出 token 为 0（被截断、拒答的不算）。同一家马上再问一次，还空就换下一家，**不冷却**——prd 第 12 条「冷却分类照 magpie」，magpie 对空回复是 failOther、不让账号休息（gateway.go 约 3039 行，#1221）。全部为空时最后一家回 502「an empty reply (the model answered nothing; try again)」。
- 审查后改的：零字节、HTML、`{}` 这类说不出结束原因的 2xx 不算空回复，照旧原样交出，留给工单 18；`FailedAttempt` 的 `timedOut` 改成 `cause: "error" | "timeout" | "empty"`。
- 扣帧不限时：15 秒保活与 5 分钟停保活归工单 17；prd 第 11 条（Codex 方向 4 分钟扣留上限）也留给 17 定。在 17 合入之前，上游只发 ping、迟迟不出内容时，CLI 收不到字节。
- 待用户确认（审查提出）：空回复按 prd 原文只看「输出 token 为 0」；magpie 要求输入、输出、缓存 token 全为 0 才算空，而且 Chat 协议的回复从不算空。按 prd 原文实现，Claude 在工具结果之后正常以空回复结束一轮时，可能被当成空回复重问。
