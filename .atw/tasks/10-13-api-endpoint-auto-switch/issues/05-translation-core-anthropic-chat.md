# 05 — 协议转换核心：Anthropic ↔ OpenAI Chat

**What to build:** server 内部建立三协议共用的中间格式，Anthropic Messages 与 OpenAI Chat 各一个文件负责解析请求、构建请求、解码流、编码流、渲染整份回复。支持文字、系统提示、多轮历史、工具定义与 `tool_choice`、工具调用与结果、三协议工具配对修补、结束原因与用量映射；上游一律流式请求，Agent 未要流式时攒齐再回；回复里的模型名回 Agent 请求时写的名字。每次请求挑格式：这家有 Agent 自己格式的地址就直通；Claude 模型且有 Anthropic 地址时一律走 Anthropic；否则翻译到第一个可用格式（Claude 模型 Anthropic 优先，其余 Chat → Responses → Anthropic）。`count_tokens` 对非 Anthropic 上游本地估算（字节 / 4）。借鉴 magpie 的代码照 04 票的声明方式标注。对应 prd R-C1、R-C2（文字 / 工具 / 配对 / 映射部分）、R-B11。

**Blocked by:** 02
**Status:** ready-for-agent
**Impl:** done

- [x] Claude Code 格式请求到只有 Chat 地址的接口：假 Chat 上游收到正确翻译的请求（system、多轮、工具定义、tool_choice），流式回复被翻回 Anthropic 事件流，工具调用与参数完整、stop_reason 与 usage 正确、模型名为请求里的名字；非流式请求攒齐一次返回。（e2e）
- [x] 从 magpie 搬来的 Anthropic ↔ Chat JSON 夹具（请求、流式回复、工具配对、stop / usage 映射）全部通过。（单元）
- [x] 工具配对修补：缺结果的工具调用、孤立的工具结果，三协议各有用例被修补成合法序列。（单元）
- [x] 挑格式四种情形各有用例：直通、Claude 模型强走 Anthropic、翻译到 Chat、按 Chat → Responses → Anthropic 顺序取第一个可用。（单元）
- [x] `/v1/messages/count_tokens` 对 Anthropic 上游透传，对非 Anthropic 上游返回本地估算。（e2e）
- [x] 中间格式类型只在 server 包内，`packages/protocol` 无新增此类类型。

**实现记录：**
- 代码在 `packages/server/src/server/api-endpoints/gateway/translation/`（ir / anthropic / chat / responses / sse / protocols），翻译尝试在 `translated.ts`，直通与翻译共用的「发请求、等开口」挪到 `upstream-call.ts`；挑格式 `chooseRequestFormat` 在 `routing.ts`。
- 挑格式按 decisions U5 读：Claude 模型且有 Anthropic 地址时优先于直通（prd R-B11 已改写措辞）。只在当前能翻的格式里挑，所以 Codex 到只有 Anthropic / Chat 地址的接口仍回 502，等 07 票。
- 自定的做法（prd R-B11 已记）：OpenAI 地址以 `/v1` 结尾、Chat 拼 `/chat/completions`；`count_tokens` 在 Anthropic 上游报错或连不上时也改为本地估算，不透传错误、不换家不冷却；翻译上游回 2xx 却不是事件流时按开口前 502 换家并冷却；Chat 的 `reasoning_effort` 把 xhigh / max 降为 high。
- 照 magpie 一并带上、但验收属 06 票的：Chat 流里的推理实时译成 Anthropic thinking 块、带签名的历史思考只回 Anthropic、剔除服务端工具与跳过 `server_tool_use`、Devin 式调用 id 编码。06 票需补测试与 thinking 发往 Anthropic 的翻译、`cache_control`、图片、附件等。
- Responses 直通前的三件修补（joinToolRuns → orphanedToolOutputs → pairToolItems）已接上并有 e2e；07 票的同名验收项可直接核对。
- magpie 的 `chat-to-anthropic` 请求体夹具含图片、`cache_control`、思考预算，留给 06 票。
