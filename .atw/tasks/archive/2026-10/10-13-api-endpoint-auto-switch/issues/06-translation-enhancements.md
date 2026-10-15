# 06 — 协议转换增强：思考、图片、附件、结构化输出与例外

**What to build:** 在 05 的基础上补齐：本轮思考实时翻译；历史思考只回原厂（Anthropic 签名块只回 Anthropic、无签名文字丢弃）；解码 Chat 回复时文首 `<think>` / `<thought>` 拆成思考块；模型名含 `deepseek` 时按 magpie 补思考回放；base64 与 URL 图片（URL 原样转发不下载）；文件附件照 magpie（Anthropic `document` 丢弃，Chat `file` 换成 `[attachment <mime>]` 占位）；结构化输出字段互转（Anthropic 无 schema 的改写进 system）；翻成 Anthropic 时三处自动 `cache_control`；发给非 Claude 模型的 Anthropic 请求剥掉 adaptive thinking / effort、未提 `thinking` 时补 disabled；翻译时剔除服务端工具、解码时跳过 `server_tool_use`，保留 Claude 配置的 WebSearch deny。对应 prd R-C2（其余部分）、R-C3、R-C4。

05 票已带上（见其实现记录）：Chat 推理实时译成 thinking 块、带签名的历史思考只回 Anthropic、剔除服务端工具与跳过 `server_tool_use`；本票补它们的测试，并补 Anthropic 构建侧的思考、三处 `cache_control`、图片、附件，以及 magpie `upstream_bodies/chat-to-anthropic.json` 夹具。

**Blocked by:** 05
**Status:** ready-for-agent
**Impl:** done

- [x] magpie 夹具中思考块、`<think>` 拆解、图片、文件占位、结构化输出、`cache_control`、DeepSeek 回放各组全部通过。（单元）
- [x] 本轮思考在流式回复中实时翻成 Anthropic thinking 事件；带签名的历史思考发给 Chat 上游时被丢弃，发给 Anthropic 上游时原样保留。（单元 + e2e）
- [x] URL 图片在翻译后仍是 URL、未被下载；base64 图片格式与 media type 正确。（单元）
- [x] Anthropic `document` 块发往 Chat 上游时丢弃、Chat `file` 发往 Anthropic 上游时变成占位文字。（单元）
- [x] 发给非 Claude 模型的 Anthropic 请求不含 adaptive thinking / effort 字段，未提 `thinking` 时含 disabled。（单元）
- [x] 带 Anthropic 服务端联网搜索工具的请求翻译后不含该工具；上游回复里的 `server_tool_use` 被跳过。（单元）

**实现记录：**
- 代码：`translation/ir.ts`（`ImagePart`、`FilePart`、`ToolResultPart.images`、`Format`、`toolOutput`、`budgetOf`、`replaysThinking`）、`anthropic.ts`（三处 `cache_control`、思考构建、图片 / 附件 / 结构化输出、`thinkingOnToolTurns`、`isAnthropicModel`）、`chat.ts`（图片与文件解析、工具图片放进随后的 user 消息、`response_format`、DeepSeek `reasoning_content` 回放、文首 `<think>` / `<thought>` 拆解与 `end` 收尾）、`passthrough.ts`（`fitAnthropicBody`，只对 `/v1/messages`）、`translated.ts`（流结束调用 `decoder.end`）。
- 用户决定：直通发给非 Claude 模型时去掉 adaptive thinking 与 effort 后交给模型默认，只有原请求根本没提 `thinking` 才补 disabled（不是去掉后一律关思考）。prd R-C3 已改写。
- 照 magpie：翻译成 Anthropic 的请求不补 disabled（magpie 只在直通里补）；DeepSeek 回放直通与翻译两条路都做（prd R-C5 已注明例外）；发给 DeepSeek 的 Chat 请求会把 Claude 签名思考的文字作为 `reasoning_content` 回放，签名本身不发。
- 自定：Chat 文件段的 MIME 用 `chat.ts` 里的扩展名表（23 种），不加依赖；magpie 用系统类型表。MiniMax 按域名把思考写回 `<think>` 属于「其余厂商例外」，没做。
- 现有 e2e 预期随之更新：发给 `deepseek-v3` 的工具轮带 `reasoning_content: " "`；直通逐字节用例的请求体带 `thinking: enabled`；档位映射到 GLM 的用例多出 `thinking: disabled`。
- magpie 夹具 `chat-to-anthropic.json`、`format_test.go`、`minimax_think_test.go`、`reasoning_replay_test.go`、`deepseek_anthropic_thinking_test.go`、`anthropic_image_source_test.go`、`attachments_test.go` 的样例已搬入单测，按值比对；`THIRD_PARTY_NOTICES` 已补。
