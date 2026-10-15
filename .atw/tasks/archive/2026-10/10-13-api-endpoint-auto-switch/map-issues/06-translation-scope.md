# 06 — 协议转换第一版做到哪一步、代码放哪

Type: interview
Status: resolved
Blocked by: 03

## Question

依据 03 的清单定第一版范围（Q26 已定三种协议互转，Q28 接受 magpie 的限制）：

- 能力清单逐项进/出：流式、工具调用与 tool_choice、thinking/reasoning 及签名（Sealed 原样回传）、图片、文件、web_search（Claude Code 的 WebSearch 现有 deny 规则是否保留）、结构化输出、stop reason、usage 映射、cache_control 自动打标、工具配对修补、count_tokens 本地估算。
- 同协议直通的判定：接口协议与 Agent 协议相同就原样转发（保留客户端 cache_control）。
- 代码位置与分层：`packages/server/src/server/gateway/`？IR 类型放 `packages/protocol` 还是只在 server；与 `docs/coding-standards.md` 的类型规范对齐。
- 测试策略：从 magpie 搬哪些夹具、假上游 e2e 怎么搭；现有 `daemon-e2e/api-endpoint-{claude,codex,models,test-connection}.e2e.test.ts` 四个用例在新模型下哪些保留、哪些重写（04 已定数据模型）。
- 路由与换家规则按 04 票 Answer 的三条实现：`slug/模型名` 直达、光秃秃模型名按创建顺序找开着的接口（档位名走各家映射）、用尽时只换同名模型。

产出：Answer 写定能力表与目录结构；更新 `prd.md`。

## Answer

访谈于 2026-10-14 完成，逐问记录见 `research/decisions.md`「06 票」。magpie 事实均读自其 2026-10-13 源码（`internal/gateway/`）。

### 能力清单（第一版）

| 内容 | 进/出 | 规则 | magpie 出处 |
|---|---|---|---|
| 文字、流式 | 进 | 上游一律流式请求；Agent 没要流式时攒齐后用 `render` 一次性回；上游不回流式按服务器错误处理 | `gateway.go:5190` |
| 工具调用、工具结果、`tool_choice` | 进 | 三协议互转；call id 非 `[A-Za-z0-9_-]` 时双向安全编码 | `anthropicOutID/InID` |
| 工具配对修补 | 进 | Anthropic `pairToolBlocks`、Chat `pairToolMessages`、Responses 原文三件（`joinToolRuns`/`orphanedToolOutputs`/`pairToolItems`）；Responses 的三件在直通前也做 | `anthropic.go:989`、`chat.go:531`、`responses.go:526-760`、`gateway.go:2983-2987` |
| 思考（本轮生成） | 进 | 上游边想边答时实时翻成 Agent 协议的思考块 | `anthropicEncoder.thinking` |
| 思考（历史回传） | 原厂才带 | Anthropic 签名/`redacted_thinking` 只回 Anthropic；Responses `encrypted_content` 只回 Responses；无签名文字丢弃。例外：模型名含 `deepseek` 时按 magpie 补回放（Anthropic 补一个空格的 thinking 块；Chat 写 `reasoning_content`；Responses 写 `reasoning_text`），按**模型名**判断、不按域名 | `anthropic.go:243-275`、`chat.go:238-363`、`responses.go:802-870` |
| `<think>`/`<thought>` 文首标签 | 进 | 解码 Chat 回复时拆成思考块（不看厂商） | `chat.go:843-870` |
| Claude 专有字段 | 剥 | 发给非 Claude 模型时去掉 adaptive thinking / effort（01 票）；请求没提 `thinking` 时补 `{"type":"disabled"}` | `thinkingOffUnlessAsked` `anthropic.go:224` |
| 图片 base64 | 进 | 含工具结果里的图片（`toolOutput`） | `ir.go:643` |
| 图片 URL | 进 | 原样当 URL 转发，不下载；Responses 只给 `file_id` 没 `image_url` 的报 400 | `imageBlock`、`dataURL`、`gateway.go:4812` |
| 文件附件 | 照 magpie | Anthropic `document` 块（顶层与 tool_result 内）**不解析、丢弃**；Chat `file` 部分解析为 File，输出时换占位文字 `[attachment <mime>]`；Responses `input_file` 不解析、丢弃。用户知悉"模型会不知道 PDF 内容"后仍选完全照抄 | `anthropic.go:143-168`、`chat.go:191-205`、`ir.go:93`、`responses.go:782-799` |
| 联网搜索 | 出 | 保留现有"切到接口时 Claude 配置 deny WebSearch"；翻译时服务端工具（有 `type` 无 `input_schema`）从工具表剔除；解码时跳过 `server_tool_use` 块；不代搜 | `anthropic.go:174-180,1072-1098` |
| 结构化输出 | 进 | 三协议字段互转（`output_config.format` / `response_format` / `text.format`）；Anthropic 只收带 schema 的，`json_object` 改写进 system 一句话；上游拒收不重发，错误交 Agent | `format.go`、`anthropic.go:783` |
| stop reason / usage | 进 | 按 03 票映射表 | — |
| `cache_control` | 进 | 翻成 Anthropic 时在最后一条消息末块、system、最后一个工具（无 system 时）三处打 `ephemeral`；直通保留客户端标记 | `anthropic.go:880-948` |
| `count_tokens` | 进 | 非 Anthropic 上游本地估算字节/4（第四轮） | — |
| 回复里的模型名 | 回 Agent 请求的名字 | `render`/`makeEncoder` 用 `r.Model` | `gateway.go:5165-5203` |

### 同协议直通

不做格式翻译，只做：换模型名、换认证、顺路读用量与错误用于判错；Responses 请求先做三件配对修补；Anthropic 请求发给非 Claude 模型时剥专有字段并默认关思考；客户端 `cache_control` 原样保留。magpie 直通里按厂商名的改写（DeepSeek/Mistral/Kimi/MiniMax/Azure/xAI/Copilot/Bedrock/OpenAI 共十余处）与「记住被拒」机制（`s.unfit`，8 类字段，内存）**均不做**；上游 400 把错误交 Agent。Codex 发给非 "OpenAI" 名字的提供方时自己就不带 OpenAI 专有字段（magpie `codex_backend.go:1729` 注释引 Codex `client.rs`，未读 Codex 源码核实），故 `forVendor` 不需要。

### 代码位置

`packages/server/src/server/api-endpoints/gateway/`：
- `protocol/`：`ir.ts`（中间格式，按 03 票 4.1 的 TS 草稿）+ `anthropic.ts`、`chat.ts`、`responses.ts`（各自 parse / build / decoder / encoder / render 五件）+ `fixtures/`。
- `routing/`：判错词表（中英文一并照搬）、失败分类、冷却与退避、换家、粘性。
- 入口 `http.ts`（或同级少数文件）：挂 `/api-endpoint-gateway` 前缀、本机来源与口令校验、流式读写（05 票）。

中间格式类型只在 server，不进 `packages/protocol`。借鉴文件头写 MIT 短式；根目录新增 `THIRD_PARTY_NOTICES` 放完整声明。

### 测试

- 单元：翻译、配对修补、判错正则、冷却公式；夹具从 03 票第 5 节「可直接搬」的约 20 个 Go 测试搬 JSON，放 `protocol/fixtures/`、`routing/fixtures/`；不起服务。
- 端到端：测试 daemon + 本机假上游（三协议、可按要求回 429 / 中途断流 / 不回流式），覆盖跨协议互转、用尽换家、全部冷却报错、口令错拒绝、同协议直通保留 `cache_control`。
- 现有四个 `daemon-e2e/api-endpoint-*.e2e.test.ts`：`models`、`test-connection` 保留并加「按 `protocol` 走」用例；`claude`、`codex` 按 05 票的新配置写法重写，保留全部「用户手写配置一字节不丢」断言。

## 修订（08 票，2026-10-14）

一家接口最多三个格式地址后，「同协议直通」的条件改为「这家有 Agent 自己格式的地址」，Claude 模型有 Anthropic 地址时一律走 Anthropic。以 `map-issues/08-ui-prototype.md` 的 Answer 为准。
