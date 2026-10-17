# 13 — 开口按第一段内容算（含空回复）

**What to build:** 「开口」改为上游回复里出现第一段真内容：文字、思考或工具调用。直通和翻译都按各自协议来认。

- 在那之前收到的帧（如 `message_start`、`response.created`、`ping`）先扣在中转站，开口时按原来的顺序原样发出。
- 开口前出错或断开，都按换家规则处理；开口后不换家。
- 思考算内容，不扣。

**空回复**照 magpie 认（2026-10-17 用户改定）：上游是 Anthropic 或 Responses 格式，回复已经结束，却没有任何内容，一个 token 也没计（输入、输出、缓存读写全为 0）；被截断、拒答的不算；Chat 格式的回复从不算空。开口前收到空回复时：
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
- [x] 空回复：同一家被问两次，然后换到第二家；都空时，CLI 收到「empty reply」，用的是 CLI 自己的错误格式。计了提示词的回复、Chat 的回复不算空。
- [x] 开口后照现状不换家；「开口前断开就换家」等现有用例原样通过。
- [x] 借鉴 magpie 的代码，文件头保留 MIT 声明。
- [x] `npm run typecheck`、`npm run lint` 通过，改到的测试文件本机通过。

参考：prd.md 第 8、12 条；明细 01·C02、B11。

## Comments

### 实现记录（2026-10-17）

- 开口判定在 `upstream-call.ts` 的 `awaitOpening`：边收边用 `ReplyTap` 读（从 `passthrough.ts` 挪到新文件 `reply-tap.ts`，避免循环引用），读到第一段文字、思考或工具调用才开口；之前的字节扣着，开口时一次原样交出。count_tokens 仍是第一个字节就开口。
- 开口前的流内错误按 magpie `streamStatus` 定状态码（`failure.ts`），然后走原有的换家与冷却规则。
- 空回复：按协议说了结束原因、却没有内容（被截断、拒答的不算）；token 的条件见下面「用户改定」。同一家马上再问一次，还空就换下一家，**不冷却**——prd 第 12 条「冷却分类照 magpie」，magpie 对空回复是 failOther、不让账号休息（gateway.go 约 3039 行，#1221）。全部为空时最后一家回 502「an empty reply (the model answered nothing; try again)」。
- 审查后改的：零字节、HTML、`{}` 这类说不出结束原因的 2xx 不算空回复，照旧原样交出，留给工单 18；`FailedAttempt` 的 `timedOut` 改成 `cause: "error" | "timeout" | "empty"`。
- 扣帧不限时：15 秒保活与 5 分钟停保活归工单 17；prd 第 11 条（Codex 方向 4 分钟扣留上限）也留给 17 定。在 17 合入之前，上游只发 ping、迟迟不出内容时，CLI 收不到字节。
- 用户改定（2026-10-17）：审查提出 prd 原文「只看输出 token 为 0」比 magpie 宽，用户选择照 magpie——只有 Anthropic、Responses 的回复会被判空，而且输入、输出、缓存读写 token 全为 0；Chat 的回复从不算空。prd 第 12 条、工单正文、规范已同步改。magpie 只在翻译路径判空；这里照 prd「直通和翻译都这样认」，两条路都判。
