# 02 — 用 Gemini 地址文字对话

**What to build:** Claude Code（Anthropic 入口）、Codex（Responses 入口）、Pi / OMP（Chat 入口）选一家接口的 Gemini 模型，内置中转站把请求翻成 Gemini 格式发到这家的 Gemini 地址，把回复翻回 CLI 自己的格式：文字逐字流式回来，CLI 要整份时也能拿到；用量、结束原因正确。一家有几种地址时 Gemini 排最后；「只用这种格式 = Gemini」生效。思考、工具、图片、联网搜索留给 03，判错与冷却留给 04。

**Blocked by:** 01
**Status:** ready-for-agent
**Impl:** done

- [x] 新增 Gemini 协议模块，只做上游：IR 请求 → Gemini 请求，Gemini 流 → IR 事件；整份回复由已有的「读流拼整份」得到。协议接口按实现时的代码决定拆分或让入口方向不可用，不写占位的假实现。
- [x] 上游地址：`{base}/models/{模型}:streamGenerateContent?alt=sse`，模型去 `models/` 前缀后转义；请求体不带 `model`、`stream`；上游一律流式。认证只发 `x-goog-api-key`。
- [x] 请求（照 magpie）：assistant → `model`、其余 `user`；`systemInstruction` 不带 role；相邻同角色合并；`maxOutputTokens`、`temperature`、`topP`、`stopSequences`；要 JSON 时 `responseMimeType` 与 `responseJsonSchema`；不设 safetySettings。
- [x] 回复：用量按 `input = prompt − cached`、`cacheRead = cached`、`output = candidates + thoughts`、`reasoning = thoughts`；第一个 chunk 随开始事件发 prompt 用量；结束原因按 magpie 映射（MAX_TOKENS → length，STOP 等 → stop，其余 → filter）；带 finishReason 的 candidate 才算结束，`usageMetadata` 不算。
- [x] 选路：翻译顺序 Chat → Responses → Anthropic → Gemini；现有直通、Claude 走 Anthropic、「只用这种格式」规则不变；只有 Gemini 地址的接口能用；「只用这种格式 = Gemini」生效。
- [x] 接口的请求头、附加请求体（并进请求体顶层）、上游模型名作用于 Gemini 请求。
- [x] 经过中转站的 Gemini 调用照常记进中转站账本，用量页按接口分开（沿用现有规则）。
- [x] Pi / OMP 配置不改，以 Chat 入口经中转站用 Gemini 模型。
- [x] 测试：daemon 端到端测试加假 Gemini 上游（按路径里的模型与 `:streamGenerateContent?alt=sse` 回 SSE），分别以 Anthropic、Responses、Chat 三个入口发流式与非流式请求，检查上游收到的地址、认证头、请求体，以及 CLI 收到的文字、用量、结束原因；选格式（只有 Gemini、几种都有、只用这种格式）各有用例。翻译套件加 Gemini 翻译的用例（与 Anthropic、Chat、Responses 并列）。
- [x] 文档：ADR 0007 加修改说明（四种格式互译，Gemini 排最后）；ADR 0008 加修改说明（请求头与附加请求体也作用于 Gemini 请求）；照 magpie 写的文件顶上留 MIT 声明，`THIRD_PARTY_NOTICES` 补上对应条目。

参考：prd「翻译层」「选路」，用户故事 20–24、33–36；`research/decisions.md`「翻译细节」的请求与回复部分。

实现时凡本工单没写明的细节，先查 magpie 最新 main 的做法并照做（源码要重新克隆 yetone/magpie 到 `/tmp` 下只读查看；magpie 发给自定义 Gemini 地址的请求借用 Code Assist 构建器，只取非 Antigravity、非 Code Assist 的分支）；比 magpie 少做或更严一律不行，除非 prd 写明。测试绝不连真实中转服务或 Google。

## Comments

- 2026-10-24 实现：协议接口拆成上游两件（`upstreamProtocolOf`，四种格式都有 build 与 decoder）与 Agent 三件（`protocolOf`，Gemini 抛错，不写占位实现）；Gemini 模型放进地址路径（`geminiPath`，照 Go `url.PathEscape`），请求体不带 `model`、`stream`。
- 端到端测试另起 `daemon-e2e/api-endpoint-gateway-gemini.e2e.test.ts`（与 Chat 入口的 `api-endpoint-gateway-chat.e2e.test.ts` 同一先例、同一 npm 脚本）。中转站这几份 e2e 都不在 `test:integration` 清单里，CI 不跑，结果是本机跑的。
- 审查后留着的判断项（未改）：`upstreamUrl` 的 `model` 是可选参数、Gemini 漏传时运行时报错；`=== "gemini"` 分散在 protocols、upstream-call、translated 三处；错误用普通 `Error`（与现有写法一致）。
