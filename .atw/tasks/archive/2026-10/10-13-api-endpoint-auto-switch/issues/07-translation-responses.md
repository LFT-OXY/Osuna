# 07 — 协议转换：OpenAI Responses 两向

**What to build:** 补 OpenAI Responses 协议文件：Anthropic ↔ Responses、Chat ↔ Responses 两向互转，含 Responses 加密推理只回 Responses、Responses `input_file` 丢弃、只给 `file_id` 的图片回 400、Responses 直通前也做工具配对修补。做完后 Codex 能跑只有 Anthropic 或只有 Chat 地址的接口，Claude Code 能跑只有 Responses 地址的接口。对应 prd R-C1～R-C5 中 Responses 相关部分。

**Blocked by:** 05
**Status:** ready-for-agent
**Impl:** done

- [x] Codex 格式请求到只有 Anthropic 地址的接口、到只有 Chat 地址的接口：假上游收到正确翻译的请求，流式回复翻回 Responses 事件流，工具调用、stop、usage、模型名正确。（e2e）
- [x] Claude Code 格式请求到只有 Responses 地址的接口：同上。（e2e）
- [x] magpie 夹具中 Responses 相关各组（请求、流、配对、推理、附件）全部通过。（单元）
- [x] Responses 直通请求在转发前完成工具配对修补，其余字段不变。（单元）
- [x] Responses 加密推理发给非 Responses 上游时丢弃；Responses 请求只给 `file_id` 的图片返回 400 并按 Agent 协议包装。（单元）

**实现记录：**

- 代码：`translation/responses.ts`（`parseResponsesRequest`、`buildResponsesRequest`、`ResponsesDecoder`、`ResponsesEncoder`、`renderResponses`、`usageFromResponses` / `usageToResponses`、`replayedReasoningInput`）、`protocols.ts`（登记 Responses；三种格式都齐了，删掉 `translatable`，`render` 改成对象参数并带上 Agent 的请求）、`ir.ts`（`Tool.strict`、`NamedTool` 与 `GatewayRequest.named`、`openAIEffort` 从 `chat.ts` 挪来）、`gateway.ts`（翻译读修补过的请求体；`askableCandidates` / `readTranslated`）、`passthrough.ts`（`fitResponsesBody`）、`translated.ts`（编码与渲染传入请求）。
- 加密推理：Responses 到 Responses 一律直通，所以中间格式不带封存推理，解析时就丢掉 `encrypted_content`；摘要文字作为无签名思考，只回放给 DeepSeek。
- 自定（实现者决定，用户可推翻）：读不懂或翻不过去的请求（只给 `file_id` 的图片、`allowed_tools` 的 mode 不对等）只跳过要翻译的候选，能直通的候选照问，一家都不剩才回 400。magpie 是轮到要翻译的那家时就回 400；差别只出现在同时有直通与翻译候选的少见情形。prd R-C2 已注明。
- 为让 Codex 真能跑起来，照 magpie 一并带上（prd 没单列）：命名空间工具摊平成 `命名空间__名字`（超 64 字符截短接哈希）、调用写回时还原并带 `encrypted_function_args: []`；自由文本工具（custom）当作只有 `input` 参数的函数，写回为 `custom_tool_call`；`agent_message` 当 user 一轮；回答开始后才出现的 developer 消息留在原处写成 `<system-reminder>`（保住系统提示与缓存前缀）；去掉参数 schema 里的 `encrypted` 标记；`allowed_tools`；Responses 工具一律写明 `strict`（Chat 客户端的 `strict` 也读进来）。
- 没做：Codex 的 `tool_search` 与 Responses Lite（`additional_tools`），Osuna 的 Codex 模型目录两样都不开；`service_tier`（快速档）不带，Osuna 没有快速模式，所以 magpie `responses-to-chat` 夹具比对时去掉了这个字段；magpie 两个只存哈希的大对话夹具（`large-responses*.sha256`）没搬，它们校验的是 Go 读 JSON 的字节稳定性，不是转换规则。
- DeepSeek：直通给 DeepSeek 的 Responses 请求补推理文字、每一步以推理开头（`fitResponsesBody`）；只补文字时只改那几项的 `content`，要挪项时才整个换掉 `input`（R-C5「只用 jsonc 改这几处」在挪项时做不到逐处改）。翻译到 DeepSeek 的 Responses 请求同样以推理开头。
- 和 magpie 一致、未改：上游中途出错时编码器先发 `response.failed`，结束时仍发 `response.completed`。
- 原「Codex 只能翻译过去的接口回 502」e2e 改成三条翻译 e2e（Codex → 只有 Anthropic、Codex → 只有 Chat 含整份回复、Claude Code → 只有 Responses）与 file_id 400。
