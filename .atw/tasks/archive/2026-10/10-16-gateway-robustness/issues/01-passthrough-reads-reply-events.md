# 01 — 准备：直通也读懂上游的回复

**What to build:** 直通时，中转站一边把上游的回复逐字节原样转发给 CLI，一边按协议（Anthropic Messages、OpenAI Responses、OpenAI Chat）认出回复的每一段：
- 内容：文字、思考、工具调用；
- 结束标记；
- 错误事件；
- 拒答的结束原因；
- 用量：缓存命中与缓存写入。

翻译路径已有的解码，和直通共用同一套认法。现在直通是用文字扫描从回复里找缓存命中数，改成读这套认法的结果。

这是准备工作，不改任何对外行为：CLI 和上游收到的字节都和现在一样。第 13、14、20 张工单都在它上面做。

**Blocked by:** None
**Status:** ready-for-agent
**Impl:** done

- [x] 直通转发给 CLI 的字节和改动前逐字节一致：现有直通端到端测试全部原样通过，断言不改。
- [x] 三种协议各有纯逻辑用例：给一段上游事件流，认出内容、结束标记、错误、拒答的结束原因、缓存命中与缓存写入。要覆盖：事件被切在两段数据之间、数字跨段，以及 Chat 的 `[DONE]`、Anthropic 的 `ping`、Responses 的 `response.created`。
- [x] 粘住同一家仍读到正确的缓存命中数：现有粘性测试原样通过。
- [x] `npm run typecheck`、`npm run lint` 通过，改到的测试文件本机通过。

参考：prd.md「Implementation Decisions」第 8、33、40 条的前提；research/decisions.md「对现状的核实」。

**实现记录（2026-10-17）：**
- 读法在 `gateway/passthrough.ts` 的 `ReplyTap`：直通转发的字节一个不改，同时把同样的字节交给翻译用的同一个解码器（`protocolOf(format).decoder()`）去认。流式回复按事件读；整份回复（不流式）攒齐了，由解码器新增的 `whole()` 照它流出来时的事件读，最多读 8 MB（magpie `sniff.go` 的上限），再大的不读。`relay()` 里按文字扫描找缓存命中数的 `CacheReadTap` 已删，粘性改读 `ReplyTap` 的用量。
- 中间事件新增两种：`done`（Anthropic 的 `message_stop`、Chat 的 `[DONE]`、Responses 的 `response.completed` 与 `response.incomplete`）和 `other_tool`（中间格式不带的工具项：服务端工具、Codex 自己的 `custom_tool_call` 等，按 magpie `streamPart.said` 的规则认：类型名含 call / tool，或以 mcp_ 开头）。三个编码器与 `ReplyCollector` 收到这两种都不写出任何东西，翻译的输出不变：翻译单元测试与端到端测试原样通过。
- 什么算内容：文字、思考都要非空；签名不算（magpie `anthropicDeltaSays`）；没有摘要文字的推理项不算；工具调用包括 `other_tool`。Codex 自己的调用（`custom_tool_call`、`tool_search_call`）结束原因记为 `tool`。
- `isEventStream` 从 `translated.ts` 挪到 `upstream-call.ts`，直通与翻译共用。
- 和改动前的差别，只影响「下一轮粘在哪家」，不改发给 CLI 和上游的字节：DeepSeek 的 `prompt_cache_hit_tokens` 这类写法现在也读得到（和翻译一致）；回复正文里出现 `"cached_tokens": 数字` 这样的字样不再被误读；超过 8 MB 的整份回复不再读缓存命中数。
- 留给 20 号工单定：prd 第 40 条字面是「Responses 没有 `response.completed`」就算没说完，而 `response.incomplete`（因长度上限或内容过滤收尾）是协议里正常的收尾。本工单照 magpie `lastEvent` 把它算作 `ended`，结束原因分别是 `length`、`filter`，20 号工单可以据此区分。建议照 magpie 算说完了，否则因长度截断的回复会被当成断流去补错误。
- 评审里没改的判断题：`ReplyTap.add` 与 `ReplyCollector.add`、`ReplyTap` 的读流步骤与 `translated.ts` 的 `readStream` 写法相近；20 号工单要同时改两边，届时再看要不要并成一处。
