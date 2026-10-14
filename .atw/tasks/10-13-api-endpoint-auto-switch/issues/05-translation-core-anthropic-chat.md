# 05 — 协议转换核心：Anthropic ↔ OpenAI Chat

**What to build:** server 内部建立三协议共用的中间格式，Anthropic Messages 与 OpenAI Chat 各一个文件负责解析请求、构建请求、解码流、编码流、渲染整份回复。支持文字、系统提示、多轮历史、工具定义与 `tool_choice`、工具调用与结果、三协议工具配对修补、结束原因与用量映射；上游一律流式请求，Agent 未要流式时攒齐再回；回复里的模型名回 Agent 请求时写的名字。每次请求挑格式：这家有 Agent 自己格式的地址就直通；Claude 模型且有 Anthropic 地址时一律走 Anthropic；否则翻译到第一个可用格式（Claude 模型 Anthropic 优先，其余 Chat → Responses → Anthropic）。`count_tokens` 对非 Anthropic 上游本地估算（字节 / 4）。借鉴 magpie 的代码照 04 票的声明方式标注。对应 prd R-C1、R-C2（文字 / 工具 / 配对 / 映射部分）、R-B11。

**Blocked by:** 02
**Status:** ready-for-agent
**Impl:** ready

- [ ] Claude Code 格式请求到只有 Chat 地址的接口：假 Chat 上游收到正确翻译的请求（system、多轮、工具定义、tool_choice），流式回复被翻回 Anthropic 事件流，工具调用与参数完整、stop_reason 与 usage 正确、模型名为请求里的名字；非流式请求攒齐一次返回。（e2e）
- [ ] 从 magpie 搬来的 Anthropic ↔ Chat JSON 夹具（请求、流式回复、工具配对、stop / usage 映射）全部通过。（单元）
- [ ] 工具配对修补：缺结果的工具调用、孤立的工具结果，三协议各有用例被修补成合法序列。（单元）
- [ ] 挑格式四种情形各有用例：直通、Claude 模型强走 Anthropic、翻译到 Chat、按 Chat → Responses → Anthropic 顺序取第一个可用。（单元）
- [ ] `/v1/messages/count_tokens` 对 Anthropic 上游透传，对非 Anthropic 上游返回本地估算。（e2e）
- [ ] 中间格式类型只在 server 包内，`packages/protocol` 无新增此类类型。
