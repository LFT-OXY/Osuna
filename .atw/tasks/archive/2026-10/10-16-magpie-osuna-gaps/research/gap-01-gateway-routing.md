# 差距清单 · 中转站与路由

范围：magpie 网关对外接口、协议互译、失败判定与冷却、粘性、同名换家与路由组、并发与额度、可观测、网关扩展点。
由子代理通读两边源码得出（2026-10-16）：magpie HEAD `7597c132`，Osuna HEAD `21a4f721d`。引用为各自仓库内的 `文件:行号`；文中的「你」指派活的主会话。只记事实，不做取舍。

---

这份是 magpie 网关能力与路由的差距清单，范围按你给的三块：对外接口、协议互译、路由与切换。所有结论都来自我实际打开或检索过的代码与文档，两个仓库都没有改动。

几处判断依据先说在前面：

- **magpie 文档与代码不一致时以代码为准。** 例如 `ref` 的接口表（ref:1679-1688）没列 embeddings、rerank、images、videos、systemone、`/v1/magpie/*`、`/mcp`，但代码里都有（gw/gateway.go:615-682）。
- **上一轮 prd 写「不做」、但代码里做了的，以代码为准。** 例如「记住被拒」重发写的是不做，但关思考被拒后重问这一项在代码里实现了（#16）。

**缩写**
- magpie 根 `/Users/oxy/Documents/Configuration/dev-environment/demo/agent客户端源码/magpie`（HEAD 7597c132）：`gw/`=`internal/gateway/`，`prov/`=`internal/provider/`，`set`=`internal/settings/settings.go`，`ref`=`docs/reference.md`，`gr`=`docs/subsystems/gateway-routing.md`，`gm`=`docs/subsystems/gateway-middleware.md`，`pr`=`docs/subsystems/plugin-runtime.md`，`rt/`=`internal/gui/assets/plugins/routing/`，`gp/`=`internal/gui/assets/plugins/gateway/`。
- Osuna 根 `/Users/oxy/.paseo/worktrees/0x9u2djy/curvy-bullfrog`：`gwy/`=`packages/server/src/server/api-endpoints/gateway/`，`tr/`=`gwy/translation/`，`ae/`=`packages/server/src/server/api-endpoints/`，`app/`=`packages/app/src/api-endpoints/`，`boot`=`packages/server/src/server/bootstrap.ts`。
- 上一轮的出处：`prd`、`map`、`dec` 分别是 `.atw/tasks/archive/2026-10/10-13-api-endpoint-auto-switch/` 下的 `prd.md`、`map.md`、`research/decisions.md`；`#NN`=该目录 `issues/NN-*.md`；`ADR7`=`docs/adr/0007-api-endpoints-route-through-daemon-gateway.md`。
- **S 范围**：在 `ae/`、`app/`、`packages/protocol/src/api-endpoint` 里用 `rg -i` 检索，排除 `*.test.ts(x)`。表里写「S 搜 X：无」就是这个范围内没有命中。

## 1. 功能清单表

### A. 对外接口、认证、回复头、端口

| 编号 | magpie 功能 | magpie 出处 | Osuna 现状 | Osuna 证据 | 差在哪 | 上一轮的态度 |
|---|---|---|---|---|---|---|
| A01 | 网关独立监听本机端口（默认 127.0.0.1:3425，可用 MAGPIE_ADDR 或设置改），`magpie serve` 可以只跑网关 | gw/gateway.go:45-47；ref:1651-1653 | 部分 | gwy/gateway.ts:46 固定前缀 `/api-endpoint-gateway`；boot:818-828 挂在 daemon 监听上；boot:282-291 非 TCP 监听时没有地址 | 没有自己的端口或地址设置，随 daemon 监听 | 已做（有意不同）：ADR7「A separate port for the gateway. Rejected」 |
| A02 | 运行中改端口：先占新端口再放旧端口，进行中的请求做完，并重写所有已接入 Agent 的配置 | gw/lan.go:198-238 Relisten；internal/agent/rewire.go:30-39；internal/gui/port.go:126 | 部分 | ae/service.ts:301-324 attachGateway；boot:1733-1739 | 只在 daemon 启动绑定端口后对账，运行中不会换端口 | 已做：R-B6「daemon 启动绑定端口后比对接管记录里的中转站网址，不一致则重写 CLI 配置」 |
| A03 | 探活：`GET /`、`GET /v1` 返回名字、版本、模型数、API 清单；`GET /api/hello`；`magpie healthcheck` 命令 | gw/gateway.go:615-628、703-706；internal/cli/main.go:116 | 部分 | gwy/gateway.ts:97-111 只有 `/api/hello`（GET/HEAD，要口令），回 `{ok:true}` | 没有信息页，不报版本 | 已做 `/api/hello`：R-B1 |
| A04 | OpenAI Chat 入口 `POST /v1/chat/completions` | gw/gateway.go:641-642；ref:1681 | 没有 | gwy/gateway.ts:65-68 只认 `/v1/messages`、`/v1/responses`，其余路径 117-126 回 404；tr/chat.ts:49 的 Chat 解析器只用于上游 | 不收 Chat 客户端 | 没提到（R-B1 只列了五条路径） |
| A05 | Responses 入口 `POST /v1/responses`（SSE） | gw/gateway.go:643-644 | 有 | gwy/gateway.ts:65-68、127-129 | — | 已做：R-B1 |
| A06 | Messages 入口 `POST /v1/messages` | gw/gateway.go:647-648 | 有 | gwy/gateway.ts:66 | — | 已做：R-B1 |
| A07 | `POST /v1/messages/count_tokens` | gw/gateway.go:653、1174 | 有 | gwy/gateway.ts:118、195-261 | — | 已做：R-B1、R-B11 |
| A08 | 不带 `/v1` 的别名路径（`/messages`、`/responses`、`/chat/completions`、`/models`） | gw/gateway.go:621、642、644、648 | 没有 | gwy/gateway.ts:672-674 只认带 `/v1` 的路径 | — | 没提到 |
| A09 | Responses 走 WebSocket 升级时回 426，普通 GET 回 405 | gw/gateway.go:645-646、688-701；ref:1682 | 没有 | gwy/gateway.ts:117-126 GET 一律回 404；S 搜 `websocket`：只命中逐跳头表 passthrough.ts:45 | — | 没提到 |
| A10 | `GET /v1/models` 每条带推理标记、推理档位、上下文窗口、输入/回复上限、模态、原生端点、服务档 | gw/gateway.go:985-1092；ref:1690-1702；gr:168 | 部分 | gwy/gateway.ts:112-116、735-752 只给 id/display_name/created/owned_by；ae/host-endpoints.ts:53-62 | 缺所有能力字段。ae/model-facts.ts 已有窗口、上限、档位数据，但网关没用 | 列表已做：R-B1；字段没提到 |
| A11 | `GET /v1/models/{id}` 查单个模型 | gw/gateway.go:622、1094 | 没有 | gwy/gateway.ts:112 只匹配 `/v1/models` | — | 没提到 |
| A12 | 模型列表按发请求的 Agent 只列它可见的模型（Agent 页可隐藏、可只用挑选的） | gw/gateway.go:987 catalogFor | 没有 | gwy/gateway.ts:735 modelList 不区分 Agent | — | 明确不做：map「按 Agent 精简模型（magpie 的隐藏 / 只用挑选的模型）…08 票定为第一版不做」 |
| A13 | Gemini 入口：`/v1beta/models` 与 `:generateContent`、`:streamGenerateContent`、`:countTokens` | gw/gateway.go:680-681；ref:1684 | 没有 | S 搜 `v1beta`、`generateContent`：无 | — | 明确不做：prd「Gemini 协议（第二期）」 |
| A14 | `GET /v1/codex/models`：给另一台电脑的 Codex 读模型目录，超过 1 MiB 截断，并用 X-Magpie-Left-Out 说少了几个 | gw/codex_catalog.go:32-64；ref:632-659 | 不适用 | 本机 Codex 读 Osuna 写的 model_catalog_json 文件（ae/codex-model-catalog.ts） | 这个功能以「远程 Codex」为前提 | 明确不做：map「局域网共享」 |
| A15 | ChatGPT 后端路径 `/backend-api/codex/*`：已登录 ChatGPT 的 Codex 经网关走自己的订阅，并在多个账号间切换 | gw/gateway.go:678；ref:1556-1569 | 没有 | S 搜 `backend-api`：无 | — | 明确不做：map「订阅账号轮换…ADR 0004 明确不碰 `auth.json`」 |
| A16 | Codex 的 web.run 搜索 `POST /v1/alpha/search` | gw/gateway.go:651-652；gr:31 | 没有 | S 搜 `alpha/search`：无 | — | 明确不做：map「代替厂商联网搜索」 |
| A17 | 画图 `/v1/images/generations`、`/edits`：Codex 原生画图工具先问这一轮回答它的那家；路由组里按成员换家 | gw/gateway.go:654-657；gw/drawing_route.go:10-30；ref:1599-1605；gr:37 | 没有 | S 搜 `images/generations`：无 | — | 没提到 |
| A18 | 检索：`/v1/embeddings`、`/v1/rerank` | gw/gateway.go:658-661 | 没有 | S 搜 `embeddings`、`rerank`：无 | — | 没提到 |
| A19 | 语音转文字 `/v1/audio/transcriptions`、`/translations`（multipart 原样转发，只换模型名） | gw/gateway.go:663-666；ref:1713-1721 | 没有 | S 搜 `audio/transcriptions`：无 | — | 没提到 |
| A20 | 视频：`/v1/videos`、`/{id}`、`/{id}/content` | gw/gateway.go:667-672 | 没有 | S 搜 `videos`：无 | — | 没提到 |
| A21 | 决策模型 `POST /v1/systemone`（Jev 等；同一家多个 key 按顺序换） | gw/gateway.go:649；gw/decide.go；ref:1302-1314 | 没有 | S 搜 `systemone`：无 | — | 没提到 |
| A22 | 网关上挂的 MCP：`/mcp/{name}`、`/mcp/magpie/web-search`、`/vision`、`/tools` | gw/gateway.go:673-677 | 没有 | S 搜 `/mcp`：无（daemon 另有 `/mcp/agents`，boot:270-279，和第三方接口无关） | — | 没提到（搜索、识图服务本身归别处） |
| A23 | Muse Code 专用模型列表 `/muse-code/models` | gw/gateway.go:623 | 不适用 | Osuna 第三方接口只接 Claude Code 和 Codex | — | 明确不做：prd「Copilot、OpenCode、Antigravity、Muse」 |
| A24 | 余量查询 `/v1/magpie/quotas`（含 history、cards、refresh、`?kept=1`、最近回答者 lastServedAt） | gw/gateway.go:629-635、703-760；ref:1768-1781 | 没有 | S 搜 `quota`：只命中判错词表与冷却（gwy/failure.ts、cooldown.ts） | — | 明确不做：prd「主动读套餐用量提前切换（第二期）」 |
| A25 | 用量查询与上报：`/v1/magpie/usage`、`/usage/requests`（GET 查、POST 报外部调用） | gw/gateway.go:630-632；ref:1842-1880 | 没有 | S 搜 `usage/requests`：无 | — | 明确不做：map「中转站另记转发用量…05 票定为不做」；ADR7「Record the gateway's own usage. Rejected」 |
| A26 | `/v1/magpie/route?session=`：查某个会话这一轮正发给谁、试过哪几家，可用 after+wait 长轮询（最多 60 秒）；`magpie statusline` 建在它上面 | gw/session_route.go:1-40；ref:1739-1766、1783-1800 | 没有 | S 搜 `session=`：无 | — | 明确不做：prd「对用户无感：不提示、不加时间线、不加小横条；换家与冷却只写 daemon 日志」 |
| A27 | `/v1/magpie/concurrency`：进行中的请求数、排队数，以及每个请求的 Agent、模型、所处阶段 | gw/gateway.go:637；gw/phase.go；ref:1828-1841 | 没有 | S 搜 `concurrency`：无 | — | 明确不做（相关）：map「并发与频率上限」 |
| A28 | 本机鉴权：回环来的请求带任何 token 都收；`magpie-<agent>` 这种 token 用来认是哪个 Agent，token 说不出时按 User-Agent 认 | gw/gateway.go:49-80；ref:619、1704-1706 | 有 | gwy/gateway.ts:97-105、693-709：只收 Bearer 或 x-api-key 里和 gateway-tokens.json 对得上的口令，口令同时说明是哪个 Agent；错口令或没口令回 401 | 做法不同：Osuna 要正确口令，不按 UA 认 | 已做（有意不同）：dec G2「magpie 的口令是公开常量、本机任何口令都收，因 Q6 决定保密，未跟。」 |
| A29 | 非本机请求：不共享时回 403；共享或对外监听时要求网关 key，key 可放在 Bearer、x-api-key、x-goog-api-key、`?key=` 里（这里只记网关怎么认 key） | ref:615-631 | 部分 | gwy/gateway.ts:89-96、683-690 非回环一律 403 | 没有共享模式；口令只认两种位置 | 明确不做：map「局域网共享」 |
| A30 | 经本机代理或隧道转来的请求按外来请求处理：认 Forwarded、X-Forwarded-For、X-Real-IP、Cf-Connecting-IP、True-Client-IP、Tailscale-User-Login 六个头；MAGPIE_TRUST_PROXY=1 可信任代理 | ref:661-676 | 部分 | gwy/gateway.ts:56 只看前三个头 | 少后三个头，也没有信任开关 | 前三个已做：R-B2「非回环或带 Forwarded / X-Forwarded-For / X-Real-IP（经代理转来）回 403」 |
| A31 | 浏览器网页防护：别站网页一律 403、拦 DNS 重绑定、`Origin: null` 和 `*.localhost` 子域要 key、CORS 白名单 | gr:31；gw/cors.go | 不适用 | Osuna 网关必须带随机口令（gwy/gateway.ts:693-709），网页拿不到 | magpie 需要这套防护，是因为它本机任何 token 都收 | 没提到 |
| A32 | 允许地址名单、内置 HTTPS、MAGPIE_PUBLIC_URL、远端认证失败限速 | ref:679-707、1653-1660；gw/allow.go、tls.go、auththrottle.go | 不适用 | Osuna 网关只收回环 | 这些以对外提供服务为前提 | 明确不做：map「局域网共享」 |
| A33 | 请求体处理：先按 Content-Encoding 解压 zstd/gzip（注释说 Codex 对自定义提供方的 `/v1/responses` 也发 zstd，#1223），其他编码回 415；上限 512 MB（按解压后算），413 写明是网关的上限并建议 `/compact` | gw/request_bounds.go:17-30、75-100；gr:75 | 部分 | gwy/gateway.ts:51、170-174、755-772 原样读入、上限 64 MB、超了回 413（类型 request_too_large，见 agent-errors.ts:29-30）；S 搜 `zstd`、`gzip`：无 | 不解压请求体；413 的文字不告诉用户怎么办 | 64 MB 已做：R-B1；解压没提到 |
| A34 | 回复头 X-Magpie-Provider（哪家）和 X-Magpie-Model（provider/model） | gw/member.go:31-56；ref:1722-1723 | 部分 | gwy/upstream-call.ts:15 只有 `x-osuna-api-endpoint`=接口标识（passthrough.ts:112-115、translated.ts:133-137、gateway.ts:309、666） | 没有「实际用的模型名」头 | 已做：R-B12 |
| A35 | 其他请求/回复头：X-Magpie-Session（客户端指定会话）、X-Magpie-Account（钉死某个账号）、X-Magpie-Response-Model（回复体里写成员名还是厂商名）、X-Magpie-Limit-Reset、X-Magpie-Archive-Id、X-Magpie-Agent/Via | gw/gateway.go:5962-5972；gw/member.go:33、59-75；gw/remote_magpie.go:28-29；gw/archive.go:47 | 没有 | S 搜 `x-magpie`：无 | 其中账号、远端、限额、归档几项对 Osuna 不适用 | 没提到 |
| A36 | 发给上游的 User-Agent：默认 `magpie/<版本>`，可设「把 Agent 自己的 UA 发出去」，用户自设的头优先 | gr:141；ref:279-289；gw/user_agent.go | 部分 | 直通时把 Agent 的请求头（含 UA）原样转发（gwy/passthrough.ts:49-61、290-306）；翻译时只发 content-type、accept、认证头（translated.ts:58-75）；S 搜 `user-agent`：无 | 翻译出去的请求不带 UA，两条路不一致；没有开关 | 没提到 |
| A37 | 每家可自定义请求头；anthropic-beta 会合并，被拒过的 beta 以后不再发，claude.ai 登录带的 oauth beta 永不转发 | ref:267-277；gw/betas.go:1-10 | 没有 | S 搜 `anthropic-beta`、`betas`：无；直通时原样转发 | — | 没提到（「被拒后记住」那部分属于 prd 写的「「记住被拒」重发」不做） |
| A38 | Claude Code 以 claude.ai 账号登录时仍能走网关并保留登录：token 写空，网关收下 Claude 的 OAuth 但从不转发；上游的 401、403 和提到 x-api-key 的错误改报 502，免得 Claude Code 要求重新 /login | gr:105；ref:1964-1976 | 没有 | Osuna 写的是 ANTHROPIC_AUTH_TOKEN=口令（ADR7），网关只认口令（gwy/gateway.ts:693-709）；上游 401 原样回 401（passthrough.ts:328-351） | — | 没提到 |
| A39 | 退出与交接：关闭时等 2 秒（升级交接时等 15 分钟）让请求做完；新旧版本抢同一端口时可以「退出旧版并接管」 | gw/gateway.go:581-593；gw/listen.go:13；gp/client.js「Quit magpie {v} and take over」 | 不适用 | Osuna 网关是 daemon 的一部分，跟 daemon 一起启停 | — | 没提到 |
| A40 | 每次用到时重读配置，改动立刻生效 | 上一轮调研 magpie.md:127 | 有 | gwy/gateway.ts:37、181、699 | — | 已做 |

### B. 协议互译

| 编号 | magpie 功能 | magpie 出处 | Osuna 现状 | Osuna 证据 | 差在哪 | 上一轮的态度 |
|---|---|---|---|---|---|---|
| B01 | 统一中间格式 + 四种协议各一套「解析请求/构建请求/解码流/编码流/渲染整份回复」（Chat、Responses、Anthropic、Gemini） | ref:1703-1704；gw/ir.go、anthropic.go、chat.go、responses.go、gemini.go | 部分 | tr/protocols.ts:54-76 只有三种 | 缺 Gemini | 三种已做：R-C1；Gemini 明确不做（第二期） |
| B02 | 同协议直通，只换模型名和认证（另做少数修补） | gr:39；gw/gateway.go:3886 | 有 | gwy/passthrough.ts:63-121、181-207 | — | 已做：R-C5 |
| B03 | Claude 模型只要这家有 Anthropic 地址就一律走 Messages，保住缓存断点 | gr:39 | 有 | gwy/routing.ts:112-123 | — | 已做：R-B11 |
| B04 | OpenAI 官方主机上的 OpenAI 模型优先走 Responses；ModelScope 一律走 Responses | gr:39 | 没有 | gwy/routing.ts:93-97 固定 Chat→Responses→Anthropic | — | 明确不做：dec U5「magpie 的「只对 OpenAI 官方主机 Responses 优先」与「被拒后记住换格式重发」（fits/unfit）不做」 |
| B05 | 某种格式回答「这里不提供这个模型」时记住，换另一种格式重问；全被拒时按用户指定的格式或各个地址再问 | gr:39 | 没有 | — | — | 明确不做：prd「被拒后换格式重发（08 票）」 |
| B06 | 按模型指定走哪种格式（ModelAPIs） | gr:39；set:623-628 | 没有 | — | — | 明确不做：map「按模型指定走哪种格式：08 票定为第一版不做」 |
| B07 | 向上游一律流式请求；Agent 不要流式时攒齐整份再回 | gr:39 | 有 | gwy/translated.ts:76-81、97-99、160-201 | — | 已做：R-C1 |
| B08 | 上游无视 stream:true、回了整份 JSON 时，把它转成 Agent 要的流；类型不明但看起来像流的按流读；不是本协议回复的 200 当 502 换家 | gr:108；gw/whole_stream.go:17 | 部分 | 翻译：gwy/translated.ts:88-96 不是事件流就按 502 换家并冷却；直通：原样转发（passthrough.ts:110-120） | 整份 JSON 不会被转成流，一律当失败 | 已做 502：R-B11「翻译上游回了 2xx 却不是事件流时按开口前 502 换家并冷却」 |
| B09 | 2xx 却不是 API 回复（HTML 登录页、Cloudflare 挑战页、空体、不以 JSON 开头）时当 502 换家并冷却，原因里写页面标题 | gr:106；gw/notapi.go:29 | 部分 | 翻译路径同 B08；直通：passthrough.ts:116-119 空体也算「答完」，HTML 照样转给 Agent | 直通路径不识别 | 没提到 |
| B10 | 翻译回复时上游流没说结束就断了（Anthropic 没有 stop_reason/message_stop，Responses 没有 response.completed）：报「the reply ended before it was complete」，非流式客户端回 502 | gr:108；gw/continuation.go:65 | 没有 | gwy/translated.ts:146-156 流一结束就 finish；tr/anthropic.ts:901-910 不管上游有没有说结束，都补上 message_delta 和 message_stop | 被截断的回复会被当成完整的交给 Agent | 没提到 |
| B11 | 翻译回复什么都没说、一个 token 都没计（空回复）：原地再问一次，还空就报 empty reply | gr:108（#2086、#667）；gw/gateway.go:5555 | 没有 | gwy/translated.ts:180-183 只在「出错且一句没说」时报错；S 搜 `empty reply`：无 | 空回复照常算完成 | 没提到 |
| B12 | 流里的上游错误：保留厂商的 type/code/param；Responses 流里的 invalid_request_error 读成 400；已开始的流里出错时在文字后补「(<状态码>: you can retry your request)」；只靠 `event:` 行命名、形状读不懂的错误也判为失败 | gr:109-110；提交 320af985 | 部分 | tr/anthropic.ts:851-861、tr/responses.ts:882-890、929-931 能转成错误事件；tr/sse.ts:32-38 只读 data 行 | 不补状态码和「可重试」；整份回复里出错一律回 502（translated.ts:184-191）；只靠 `event:` 行命名的事件读不出来 | 没提到 |
| B13 | 工具定义、工具调用、tool_choice（auto/none/required/指名）、并行调用互译 | gw/ir.go | 有 | tr/ir.ts:85；tr/anthropic.ts:142-155、566-577；tr/chat.ts:220-226 | — | 已做：R-C2 |
| B14 | 工具调用配对修补：发往 Messages 的、发往 Chat 的，以及直通 Responses 前的三步修补 | gr:133-134 | 部分 | tr/anthropic.ts:582-625；tr/chat.ts:413-470；gwy/gateway.ts:389-394 | 缺三项：① 从别的协议翻成 Responses 的请求不做修补（magpie f348025c）；② 发往 Responses 时，同一个调用的第二个答复不去掉（919c8b93）；③ 一批调用中间夹的模型文字不挪到第一个调用前（9f8ad6ed），tr/responses.ts:76-79 仍是「留在原处」 | 三协议修补已做：R-C2 |
| B15 | 被拆成两条的并行调用合并；Responses 里相邻同角色的项并成一条 | gw/ir.go joinSplitCalls、responses.go mergeTurns | 有 | tr/ir.ts:317-333（chat.ts:298 使用）；tr/anthropic.ts:262-283 合并同角色；tr/responses.ts:416 | — | 已做 |
| B16 | 别家的工具调用 id 安全编码后再进 Anthropic | gw/anthropic.go anthropicOutID | 有 | tr/anthropic.ts:637-649 | — | 已做（#05 实现记录） |
| B17 | 本轮推理实时互译 | gr:113 | 有 | tr/chat.ts:601；tr/responses.ts:868-869；tr/anthropic.ts:876-880 | Chat 上游只认 reasoning_content 和 reasoning 两种写法，不认 reasoning_details 和 Vertex 的 extra_content.google.thought | 已做：R-C2 |
| B18 | 历史思考只回给原厂；同协议经翻译时，上游封存的推理逐字节保留 | gr:136 | 有 | tr/anthropic.ts:301-307；tr/responses.ts:42-52（Responses 到 Responses 一律直通） | Osuna 不在同协议之间翻译，用不到封存通道 | 已做：R-C3 |
| B19 | 翻给 Codex 的推理项是网关自造的（rs_ 开头的 id），以后直通给 OpenAI/Azure 时要去掉，否则 400「Item not found」；中转站拒收时去掉重问并记住 | gr:137（#1008、#1044） | 没有 | tr/responses.ts:1082、1284 会造 rs_ 项；gwy/passthrough.ts:202-205 直通时只为 DeepSeek 改请求 | 换家后可能被拒（推测，见第 4 节） | 没提到（「重问」属「记住被拒」，不做） |
| B20 | DeepSeek 推理回放：Chat、Responses、Messages 三条路都补 | gr:142、146、147 | 有 | tr/chat.ts:288-313；tr/responses.ts:698-762；gwy/passthrough.ts:244-288；tr/anthropic.ts:521-563 | 只看模型名，magpie 还看域名 | 已做：R-C3 |
| B21 | Chat 回复开头的 `<think>`/`<thought>` 拆成思考块 | gw/chat.go thoughtTags | 有 | tr/chat.ts:542-547、620-666 | — | 已做：R-C3 |
| B22 | 各厂商专属处理：Kimi 把 reasoning_details 改成 reasoning_content；MiniMax 把思考写回 `<think>`；还有 Mistral、Azure、Copilot、Bedrock、Grok、智谱 200 信封、ModelScope、Command Code、Cline、WorkBuddy、OpenCode Zen/Go、Kiro 等 | gr:107、143、148；#06 | 没有 | S 搜 `reasoning_details`：无 | 只做了 DeepSeek 和 Claude 关思考两类 | 明确不做：map「magpie 按厂商名的特殊改写（DeepSeek/Mistral/Kimi/MiniMax/Azure/xAI/Copilot/Bedrock/OpenAI）…06 票定为不做」 |
| B23 | 图片：base64 与 URL 都支持（URL 原样转发不下载）；Responses 最新一轮只给 file_id 时报 400；工具结果里的图片放到对的位置 | gr:151 | 有 | tr/ir.ts:212-233、266-283；tr/responses.ts:403-413；tr/chat.ts:368-385 | — | 已做：R-C2 |
| B24 | 纯文字模型收到图片时，由识图模型代为描述（网关这一层的接入点） | gr:87；gw/vision.go | 没有 | S 搜 `vision`：无 | — | 没提到 |
| B25 | 网关自己下载调用方给的图片 URL 时，只下载公网地址 | gr:700 前后；gw/image_fetch_guard.go | 不适用 | Osuna 从不下载图片（tr/ir.ts:41） | — | 已做（不下载）：dec T2 |
| B26 | 文件附件：Anthropic 的 document、Responses 的 input_file 丢掉，Chat 的 file 换成占位文字 | 照 magpie（#06） | 有 | tr/ir.ts:49-56、235-240；tr/chat.ts:185-202；tr/responses.ts:378-400 | — | 已做：R-C4 |
| B27 | 联网搜索（网关这一层）：翻译时去掉服务端工具，解码时跳过 server_tool_use | gr:39 | 有 | tr/anthropic.ts:123-140、748；tr/responses.ts:446-480 | — | 已做：R-C4 |
| B28 | 发给不会自己搜的家时，带 web_search 的请求改走翻译、由 magpie 代搜；搜索尽量留在客户端自己的协议上 | gr:39 | 没有 | — | — | 明确不做：prd「代替厂商联网搜索」 |
| B29 | 翻成 Responses 的回复里写入 web_search_call 项（带查询词和来源） | gr:293-318；提交 3aa22f9d | 没有 | S 搜 `web_search_call`：无；tr/ir.ts:143-155 没有搜索事件 | — | 明确不做（随代搜一起不做） |
| B30 | 结构化输出在四种协议之间互转 | gr:150 | 有 | tr/ir.ts:89-100、352-373；tr/anthropic.ts:157-171、203-207；tr/chat.ts:254-261；tr/responses.ts:651-658 | — | 已做：R-C2 |
| B31 | 结构化输出被拒：先改成 json_object 并把 schema 写进 system（#2126），再退到只用文字说明，并记住这家这个模型 | gr:150；提交 3ec45e71 | 没有 | — | — | 明确不做：dec T5「拒收不重发（magpie 会记住后重发）」 |
| B32 | 客户端要了 JSON、模型却包了 ``` 代码块时剥掉代码块（流式和整份都处理） | gr:150；gw/format_fence.go；提交 244a21d4 | 没有 | S 搜 `fence`：无 | — | 没提到 |
| B33 | 翻成 Anthropic 时自动加三处 cache_control；直通时保留客户端自己的标记 | 上一轮清单 4.5 | 有 | tr/anthropic.ts:222-237、247-259 | — | 已做：R-C2 |
| B34 | Codex 的 prompt_cache_key、include、client_metadata、text.verbosity 一并转给上游 | gw/ir.go Request（CacheKey 等字段） | 没有 | S 搜 `prompt_cache_key`：无；tr/ir.ts:102-128 中间格式里没有这些字段 | 翻译时丢掉 | 没提到 |
| B35 | count_tokens：转给有 Anthropic 地址的候选；上游不支持或没地址时本地按字节数/4 估算；不换家、不冷却 | gw/gateway.go:1174 起 | 有 | gwy/gateway.ts:195-261；tr/ir.ts:428-442 | — | 已做：R-B11 |
| B36 | 发给非 Claude 模型的 Anthropic 请求，去掉 adaptive 思考和 effort；没提思考的补 disabled | gw/anthropic.go | 有 | gwy/passthrough.ts:244-266 | — | 已做：R-C3 |
| B37 | 关思考按 Claude 型号换成它收的写法（含 classifierRoom 预留，老 Claude 的 between_tools 改 disabled） | gr:158 | 有 | tr/anthropic.ts:381-460；gwy/passthrough.ts:213-223 | — | 已做：#16 |
| B38 | effort none 被拒时同一家改 low 重问并记住；「不能关思考」时打开思考、用最低档重问并记住 | gr:156、158-159 | 有 | gwy/refusals.ts:17-107；passthrough.ts:97-109；translated.ts:83-85、104-114 | 只覆盖这两种被拒 | 已做：#16，是 ADR7 里写明的唯一例外 |
| B39 | 4.6 起只认 adaptive 的 Claude：从不发思考预算；从别的协议翻过去时用 adaptive + display:summarized；Opus/Sonnet 4.6 的 xhigh 改问 max；直通时客户端的 enabled+预算也改成 adaptive | gr:157 | 部分 | tr/anthropic.ts:319-345、370-379（翻译路径） | 直通路径不改写 | 翻译路径已做（#06） |
| B40 | 中转站拒收 display 字段或自动模式的 safeguards 字段时，去掉重问并记住 | gr:157 | 没有 | S 搜 `safeguard`：无 | — | 明确不做：prd「按厂商名的特殊改写与「记住被拒」重发」 |
| B41 | 按模型已知的推理档位适配 effort；可把某个模型设成「不发任何推理字段」 | gr:154、160；prov/models.go:1566-1575 | 部分 | tr/ir.ts:376-398 固定把 xhigh/max 降到 high | 不按模型真实档位适配，也没有这个开关；ae/model-facts.ts 有档位数据但网关没用 | 没提到 |
| B42 | 采样参数：已知不收 temperature/top_p 的模型不发；新版 Claude 去掉 temperature/top_p/top_k；被拒说「deprecated」时去掉重问一次 | gr:161；prov/models.go:1553-1564；gw/chat.go:453；gw/responses.go:1161 | 没有 | tr/anthropic.ts:331-335、tr/chat.ts:244-245、tr/responses.ts:578-579 有就照发；直通原样转发 | — | 没提到 |
| B43 | 请求没给 max_tokens 而要翻成 Messages（Messages 必填）时，按模型公布的回复上限填，不知道才用 16384；用户给模型设的 Max output 会压低请求 | gr:168-169；gw/maxoutput.go；提交 b9c589eb | 部分 | tr/anthropic.ts:44、322-324 固定默认 16384 | 不按模型上限填 | 没提到 |
| B44 | Claude Code 自动模式的审查字段（dangerous-tool-use beta、safeguards、safeguard_results）只发给 Claude 路由，别家去掉 | gr:162；gw/automode.go | 没有 | S 搜 `safeguard`：无 | — | 没提到 |
| B45 | Claude Code 的计费行（x-anthropic-billing-header 系统块）只发给 Claude 模型，其他地方去掉，否则对方的前缀缓存每轮都失效 | gr:163；gw/billing_line.go | 没有 | S 搜 `billing-header`：无；tr/anthropic.ts:46-72 把 system 原样读入，翻译后照发 | — | 没提到 |
| B46 | Claude Code 的 advisor 服务端工具：同一家的 Claude 时改成上游的模型名，否则连同说明和 tool_addition 一起去掉 | gr:164 | 没有 | S 搜 `advisor`：无 | — | 没提到 |
| B47 | Claude Code 的延后加载工具块（tool_addition/tool_removal/tool_reference）：Kimi、DeepSeek 不发；被拒时去掉重问并记住；只有 tool_reference 的工具结果补一句文字 | gr:144-145 | 部分 | 翻译：tr/anthropic.ts:85-121 只认已知块，tr/ir.ts:305-308 把 tool_reference 写成文字；直通原样转发 | 直通路径不处理 | 明确不做：map「按厂商名的特殊改写…与「记住被拒」重发机制」 |
| B48 | 对话以 assistant 消息结尾（prefill）被拒时，补一个 user 轮重问并记住 | gr:166 | 没有 | S 搜 `prefill`：无 | — | 明确不做：prd「「记住被拒」重发」 |
| B49 | 工具的 strict 被拒时去掉重问并记住 | gr:167 | 没有 | tr/responses.ts:660-680 一律写 strict | — | 同上 |
| B50 | Codex 的画图工具 image_gen 被裸 400 拒时去掉重问并记住 | gr:131；gw/image_tool.go:11-40 | 没有 | — | — | 同上 |
| B51 | 工具参数 schema 的根是 anyOf/oneOf/allOf 时包成 object；另有 DeepSeek/Kimi/Grok 各自的 schema 修补 | gw/object_root.go、deepseek_schema.go、kimi_schema.go、grok_schema.go | 没有 | S 搜 `anyOf`、`oneOf`：无；tr/anthropic.ts:226-230 只在没有 schema 时补一个空 object | — | 没提到（根修补是通用的；厂商修补属明确不做） |
| B52 | 模型写在文字里的工具调用（Hermes、DSML、GLM 的 arg_key 写法）转成真调用 | gr:149；gw/textcalls.go | 没有 | S 搜 `<tool_call>`、`DSML`、`arg_key`：无 | — | 没提到 |
| B53 | Codex 专属：命名空间工具摊平、自由文本工具、agent_message、回答之后的 developer 消息写成 system-reminder、去掉 schema 的 encrypted 标记、allowed_tools | #07 照 magpie | 有 | tr/responses.ts:446-560 | — | 已做：#07 |
| B54 | Codex 的 tool_search、Responses Lite（additional_tools）、service_tier（Fast/Ultrafast 快速档） | gr:139；gw/toolsearch.go、additional_tools.go | 没有 | tr/responses.ts:51 注释写明「没做」 | — | 明确不做：#07「没做：Codex 的 tool_search 与 Responses Lite…service_tier（快速档）不带」 |
| B55 | 翻译出的 Responses 回复里，assistant 消息标上 phase（过程话 commentary / 最终答复 final_answer），Codex 才会把过程折叠起来 | gw/phase.go；提交 55d6ea4f | 没有 | S 搜 `phase`：只命中 ae/codex-base-instructions.ts | — | 没提到 |
| B56 | Codex 中途改 effort 时，以 configuration_update 项发给 Responses，保住缓存 | gw/effort_update.go | 没有 | S 搜 `configuration_update`：无 | — | 没提到 |
| B57 | Codex 压缩：网关自造摘要、原生压缩、摘要失败换家、连续失败就暂停 | gr:137-138 | 不适用（推测） | Osuna 写给 Codex 的提供方表名是 "Osuna"（ae/codex-config-patch.ts:22）；magpie 文档说远程压缩只对名为 "OpenAI" 的表 | — | 没提到 |
| B58 | Codex 发给自定义 Responses 提供方的请求，按非 OpenAI 后端适配；可设「照 Codex 原样发」 | gr:139 | 部分 | gwy/passthrough.ts:181-207 直通只换模型名（DeepSeek 例外） | 没有非 OpenAI 后端适配 | 没提到 |
| B59 | Pi 在对话中途加的工具提升到请求顶层 | gr:140 | 不适用 | Osuna 网关只接 Claude Code 和 Codex | — | 明确不做：prd「Pi、OMP（第二期，先补接线）」 |
| B60 | Gemini、Code Assist、Vertex 出站：自定义提供方的 Gemini 地址、Google 登录的 Code Assist、Vertex（思考档、思考签名存盘、skip_thought_signature_validator） | gr:39、42、132、136、156 | 没有 | S 搜 `generateContent`、`thoughtSignature`：无 | — | 明确不做：prd「Gemini 协议（第二期）」 |
| B61 | 流中断后接着写（续写） | gr:108；gw/continuation.go | 没有 | — | — | 明确不做：map「流中断续写（magpie `continuation.go`）：Q16 已定流中断的错误原样交给 Agent。」 |
| B62 | 回复 id 规范化，结束原因与用量映射（含 1 小时缓存写入、DeepSeek/Moonshot 的缓存字段、Anthropic 风格中转站） | 上一轮清单 4.3-4.4 | 有 | tr/anthropic.ts:651-713、977-980；tr/chat.ts:486-532；tr/responses.ts:765-814 | 不带 stop_details（#1768） | 已做：R-C2 |
| B63 | 回复体里的 model 可改成实际回答的成员（由设置或请求头控制，Claude/Codex 除外） | gw/member.go:35-75 | 没有 | 翻译时一律写 Agent 请求的名字 | — | 已做（固定写请求名）：R-C1「回复里的模型名回 Agent 请求时写的名字」 |

### C. 失败判定、冷却、换家

| 编号 | magpie 功能 | magpie 出处 | Osuna 现状 | Osuna 证据 | 差在哪 | 上一轮的态度 |
|---|---|---|---|---|---|---|
| C01 | 只在回复开口之前换家，Agent 不会收到两家拼起来的回复 | gr:100 | 有 | gwy/gateway.ts:453-474；upstream-call.ts:116-125 | 「开口」的口径不同，见 C02 | 已做：R-B8 |
| C02 | 「开口」指真正的内容；在那之前的 message_start、response.created、ping 等帧仍然扣着，随后来的错误（如 server_is_overloaded）还能换家，最多扣 4 分钟 | gr:108；gw/fallback.go:2477、2810-2843 | 部分 | gwy/upstream-call.ts:145-166 收到第一段数据就算开口 | 只发了这些帧、之后才报错的，不能再换家 | 按「第一段」已做：R-B8「2xx 响应头到了但第一段前断开也换家」 |
| C03 | 扣着时给 Agent 保活：15 秒后先发 200 和 SSE 注释，之后每 15 秒一条，5 分钟没消息就停；Codex 只认事件，4 分钟内必须放行 | gr:108；gw/gateway.go:5732；gw/fallback.go:1828-1853、1969、1992 | 没有 | S 搜 `keepalive`、`: ping`：无（只有逐跳头表 passthrough.ts:38） | 最长 10 分钟等上游开口，期间 CLI 收不到任何字节 | 没提到 |
| C04 | Claude/GPT/Gemini 的推理先扣住（最多 4 分钟），推理之后被拒还能换家；最后一家不扣 | gr:111 | 没有 | 同 C02 | — | 没提到 |
| C05 | 安全过滤拒答：开口前被拒谁都不冷却，按设置换别家再问（默认问遍所有剩下的，可设 0～3 家）；没人可问时，Anthropic 客户端收到原样的 stop_reason: refusal（Claude Code 会换用自己的备用模型），Codex/Chat 客户端收到 400；「considered high risk」这种错误也算拒答 | ref:1517-1528；gr:95、101；gw/fallback.go:2214-2220、2907；set:224-230 | 没有 | 开口后不换家（gwy/gateway.ts:453-474）；S 搜 `safety`、`stop_details`：无 | — | 没提到 |
| C06 | 失败分类：欠费、额度用完、限流、其他、代理没连上 | gw/routing.go:284-327 | 有 | gwy/failure.ts:12-66、112-127 | — | 已做：R-B9 |
| C07 | 「需要检查」：key 被拒的 401/403（额度、模型下线、套餐不含、地区原因的除外）不会自动恢复，编辑这家接口才解除。magpie 对 key 的 401 是普通退避 | magpie gw/routing.go:284-327 没有这一类 | 有 | gwy/failure.ts:133-138；cooldown.ts:299-302、347-349 | Osuna 独有 | 已做：R-B9 |
| C08 | 订阅、厂商、路由组专属的分类：restricted（冷却 2 小时）、verify、auth、foreign、floor、update、effort、slow、loop、prompt | gw/routing.go:183-230 | 没有 | gwy/failure.ts:71 只有六类 | — | 明确不做：R-B9「订阅账号、厂商专属与路由组用的 13 种不搬」 |
| C09 | 402 只说用量上限、没提钱时算「额度用完」（可只冷却该模型），不算欠费 | gw/routing.go:300-306；gr:130；提交 af39ee4b | 没有 | gwy/failure.ts:103-108 402 一律算欠费（冷却 30 分钟） | — | 没提到 |
| C10 | 重置时间的读法：Claude Code 的「limit reached + unix 时间」、ChatGPT 的 resets_at、带时区的文字日期、智谱 1308/1310 无时区按北京时间、「resets in 0h 19min」这类文字、Retry-After 与 *ratelimit*reset* 响应头 | gw/routing.go:564；gr:126、130 | 部分 | gwy/cooldown.ts:110-180 | 缺智谱无时区（ad312dfe）和「resets in」文字两种 | 前几种已做：R-B9 |
| C11 | 冷却常量：欠费 30 分钟；额度 15 分钟或按重置时间、最长 8 天；限流 1 分钟起翻倍、最长 30 分钟、30 分钟内再被限流才翻倍；其他错误 1 分钟起翻倍、最长 10 分钟；Retry-After 最多信 1 小时；文字写的日期最多信 7 天 | gw/routing.go:92-125；gw/fallback.go:36 | 有 | gwy/cooldown.ts:25-46、233-245、368-396 | — | 已做：R-B9 |
| C12 | 每家可设自己的冷却封顶（rest-cap；设 off 表示不明原因的失败不冷却）和额度冷却时长（quota-rest 6h，或 until 08:00 这样冷却到每天几点） | ref:1494-1516；prov/provider.go:178-191；gr:95、116 | 没有 | S 搜 `rest-cap`、`quotaRest`：无，只有全局常量 cooldown.ts:25-46 | — | 没提到 |
| C13 | 只冷却该模型（这把 key 不提供它、模型已退役、厂商说「切换其他模型」、付费模型没额度但免费模型照常），这家的其他模型照常用；模型自己的失败次数和整家分开计（#2241） | gr:95、126、129；gw/fallback.go:992-1050 | 部分 | gwy/cooldown.ts:276-283 不提供该模型和「切换其他模型」时只冷却模型；失败次数按冷却键计（303-307） | 没有模型自己的失败计数，不区分付费/免费模型；列表不显示模型级冷却（ae/service.ts:1314-1322） | 模型级冷却已做：R-B9 |
| C14 | 退役模型记住一周（retired.json）：从 /v1/models、各 Agent 列表、自动组里拿掉；有一次答成功就加回来 | ref:261-265；gr:95 | 部分 | gwy/failure.ts:153-158 退役算可以换家 | 不记住，也不从列表里拿掉 | 没提到 |
| C15 | 值不值得换下一家：401/402/403/404/408/429/5xx 换；上下文超长不换；400/422 按词表判断（含 Command Code 不说原因的 400）；被厂商防火墙挡也换 | gw/fallback.go:1156-1180 | 部分 | gwy/failure.ts:141-150 | 缺「防火墙挡了」和「不说原因的 400」两条 | 已做：R-B8 |
| C16 | 请求本身被拒（形状读不懂、拒收这个客户端、地区不支持）：换下一家问，但谁都不冷却 | gr:95 | 有 | gwy/failure.ts:172-177；cooldown.ts:275 | — | 已做（#04） |
| C17 | 上下文超长：不换家，直接告诉 Agent 去压缩；组里有更大窗口的成员就换过去；没说原因、但按估算已超过窗口 1.2 倍的，也按超长告诉 Agent；中转站自己的单次输入上限也算超长（#2445） | gr:95、117；gw/fallback.go:1195-1250、1296 | 部分 | gwy/failure.ts:91-100、143 | 只有「不换家」这一条 | 基本部分已做：R-B8「上下文超长等请求本身的错误不换家直接交给 Agent」 |
| C18 | 发出之前就跳过已知装不下这次请求的候选 | gr:117；gw/fallback.go:1331 | 没有 | — | 同名模型在不同家的窗口也可能不同 | 没提到 |
| C19 | 冷却中的候选排最后，而且只问最早恢复的那一家；只剩一家时照样问 | gr:116；gw/fallback.go:766-830 | 有 | gwy/gateway.ts:404-436 | — | 已做：R-B8 |
| C20 | 剩下的全是 key、且都因额度用完或欠费在冷却：不再问上游，复述记着的厂商原话，附「几点前不再问」（带时区）和 Retry-After | gr:116；gw/fallback.go:855-895；gw/routing.go:601 | 有 | gwy/gateway.ts:418-425、649-670；cooldown.ts:215-231 | 用 daemon 本地时间、不带时区；复述最后一家的原话，magpie 复述第一个 | 已做：R-B9 |
| C21 | 429 没带 Retry-After 时，补上最早恢复的时刻 | gr:116 | 有 | gwy/gateway.ts:637-647 | 按这一家冷却结束的时刻补 | 已做：R-B12 |
| C22 | 最后一家原地重试：服务器忙最多两次、短时限流最多三次，等待超过 8 秒就不等；等待期间 Agent 走了就回 499、不冷却 | gr:96；gw/fallback.go:1255-1295 | 有 | gwy/gateway.ts:523-554；cooldown.ts:186-209 | — | 已做：R-B8 |
| C23 | 后面剩下的候选全因额度在冷却时，把当前这家当作最后一家原地重试 | gw/fallback.go:896 | 没有 | gwy/gateway.ts:453-455 只看它是不是计划里的最后一个 | 明知后面那家没额度也会问一次 | 没提到 |
| C24 | 答成功就清掉这家的冷却和失败次数 | gr:95 | 有 | gwy/gateway.ts:459-465；cooldown.ts:339-344 | — | 已做 |
| C25 | 开口后断流：错误交给 Agent，这家照样冷却（超长、拒收、保护机制、空回复不算这家的错） | gw/fallback.go:1185-1192 | 有 | gwy/gateway.ts:466-472；failure.ts:180-182 | 少「空回复」这一项 | 已做：R-B8 |
| C26 | 断流时在流尾追加一个协议内的错误事件（前面空一行）；收到 `data: [DONE]` 就算结束 | gr:108；提交 7e4336e7、a19ecdea | 部分 | Osuna 断流时直接断开 Agent 的连接（passthrough.ts:150-152；translated.ts:148-151） | CLI 看到的是自己的网络错误，不是协议内的错误事件 | 已做（用断开实现）：R-B8「首字后不再换家，流中断的错误原样交给 Agent 且那家照样冷却」 |
| C27 | 等上游响应头最长 10 分钟，超时按服务器错误冷却并换家 | gw/upstream_transport.go:24 | 有 | gwy/gateway.ts:49；upstream-call.ts:89-95 | — | 已做：R-B12 |
| C28 | 复用的长连接被代理或厂商悄悄关掉（EOF、broken pipe）时，立刻在新连接上重发，不算失败 | 提交 9a0d723d | 没有 | gwy/upstream-call.ts:168-179 用 Node 默认连接池，连不上一律算 502 | — | 没提到 |
| C29 | 出站请求可以走每家、每个账号或全局的代理；可以只对自家主机跳过证书校验 | gr:39；prov/provider.go:280、287 | 没有 | gwy/upstream-call.ts:175-179 直接调 http/https.request；S 搜 `HTTPS_PROXY`、`undici`：无 | — | 没提到 |
| C30 | 报错格式：「<接口名>: <上游原文>」+ 恢复时间 + Retry-After 和 ratelimit-reset 头，按 Agent 自己的协议包装；保留厂商的 code/param | gr:109 | 有 | gwy/passthrough.ts:316-351；agent-errors.ts:40-54 | OpenAI 形状里的 param 恒为 null | 已做：R-B12 |
| C31 | 换家和冷却写日志；MAGPIE_DEBUG=1 时每个调用打到终端 | ref:1961-1963 | 有 | gwy/gateway.ts:476-503；cooldown.ts:324-333、418-427 | — | 已做：prd「换家与冷却只写 daemon 日志」 |
| C32 | Sink：有额度却被 429 限流的 key/账号，排到所有「此后没被限流的」后面（只在内存里；嵌套组各用自己的设置） | gw/sink.go:41-60；prov/provider.go:118-124；gr:36 | 没有 | S 搜 `sink`：无 | Osuna 冷却结束后回到原位（创建顺序） | 没提到 |
| C33 | 手动解除冷却：路由页和 key 列表里的「Try now」，只结束冷却、不清失败次数 | gr:95；internal/gui/trace.go:296；rt/client.js:2824 | 有 | app/use-host-endpoints.ts:157-160；ae/service.ts:531；cooldown.ts:352-359 | Osuna 的「立刻恢复」连失败次数一起清 | 已做：R-B9 |
| C34 | 冷却只记在内存里 | gr:36 | 有 | gwy/cooldown.ts:17-21 | — | 已做：prd「冷却状态持久化（只记内存，daemon 重启清零）」（不做持久化） |
| C35 | Agent 中途断开时取消上游请求，谁都不冷却 | gr:96 | 有 | gwy/upstream-call.ts:186-191；gateway.ts:456、552 | — | 已做 |
| C36 | 错误原文和日志里不出现真实 key | ref（key 不进记录） | 有 | gwy/upstream-call.ts:98、110 | — | 已做：R-B2 |

### D. 粘性与对话识别

| 编号 | magpie 功能 | magpie 出处 | Osuna 现状 | Osuna 证据 | 差在哪 | 上一轮的态度 |
|---|---|---|---|---|---|---|
| D01 | auto 模式：同一轮内留在接手那家；新一轮只在上次缓存命中 ≥1024 token 且 5 分钟内才留；冷却中的不粘 | gw/affinity.go:46-63、391-498 | 有 | gwy/affinity.ts:17-26、62-75、287-317 | 见 D02～D04 | 已做：R-B10 |
| D02 | 缓存「写入」也算：第一轮写入整份 prompt，第二轮留下来读 | 提交 7f968b95；gw/affinity.go:12-20 | 没有 | gwy/passthrough.ts:164-175 只读 cache_read_input_tokens 和 cached_tokens；affinity.ts:265-270 只记命中数 | 第二轮会回到用户选的那家，刚建好的缓存白丢 | 没提到 |
| D03 | 厂商悄悄缓存但不报数（OpenAI 自动前缀缓存、Gemini）时，把这一轮发出的 prompt 当作写入 | 提交 7c5bfd7a；gw/affinity.go:16-21 | 没有 | 同 D02 | — | 没提到 |
| D04 | 写过 1 小时缓存的，5 分钟后仍按 1 小时算「热」 | 提交 ef490114；gw/affinity.go:53-120 | 没有 | tr/ir.ts:138-140 有 cacheWrite1h 字段，但粘性没用 | — | 没提到 |
| D05 | 其他粘性模式：session（整段对话）、turn（只限同一轮）、off、strict（永远只问上次那家，冷却、用完、封顶都照问，错误直接给 Agent） | gr:118-119；ref:1285-1288 | 部分 | gwy/affinity.ts:28-29、62-75 判定表照抄齐全，但 303-313 固定用 auto | 没有设置入口 | auto 已做：R-B10「粘性照 magpie auto 模式」；其他模式没提到 |
| D06 | 粘性记录落盘（affinity.json），daemon 重启后对话仍回到有缓存的那家 | gw/affinity.go:22-27；gr:38 | 没有 | gwy/affinity.ts:277-328 是内存里的 Map | — | 已做（只记内存）：R-B10「粘性按「Agent + 请求的模型名 + 会话」记在内存，最多 512 段、24 小时」 |
| D07 | 找上次回答者时依次匹配：账号+模型+推理档 → 账号+模型 → 账号 | gw/affinity.go:405-418 | 部分 | gwy/affinity.ts:297-302 依次匹配接口+模型 → 接口 | 没有推理档这一维 | 已做 |
| D08 | 用量 ≥98% 就不粘；用到 90% 的账号在新对话里排后 | ref:1396-1410；gr:114 | 没有 | gwy/affinity.ts:52-54 注释「Osuna 不读，恒为 false」 | — | 明确不做（随读额度一起）：prd「主动读套餐用量提前切换（第二期）」 |
| D09 | rotate 模式下，新对话给最近 30 分钟里被占用最少的那家 | gr:120；gw/affinity.go:499 | 没有 | — | — | 明确不做：map「六种排序策略」 |
| D10 | 对话识别：先读会话头（x-opencode-session、x-session-affinity、x-session-id、session_id、session-id、x-claude-code-session-id、x-conversation-id），都没有就取第一条 user 消息的 sha256 | gw/gateway.go:5953-5960、6020-6061 | 有 | gwy/affinity.ts:78-109（x-claude-code-session-id、thread-id、thread_id、session-id、session_id、x-client-request-id） | 会话头名单只按两个 CLI 取 | 已做：R-B10 |
| D11 | 轮次判定：用户真说了话才开新一轮；Agent 代写的提醒、上下文延续当前轮 | gw/affinity.go:270；gw/prompt.go:667；gr:88 | 有 | gwy/affinity.ts:111-263 | — | 已做 |
| D12 | 子代理：路由组规则的对话键里加上用户第一句话（firstWords）；Claude Code 子代理的 x-claude-code-agent-id 记进路由记录 | gw/rules.go:120-150；gr:86 | 没有 | S 搜 `x-claude-code-agent-id`：无 | — | 没提到 |
| D13 | 客户端可用 X-Magpie-Session 头指定会话 | gw/gateway.go:5962-5980 | 没有 | S 搜 `x-magpie-session`：无 | — | 没提到 |

### E. 同名换家、兜底名单、路由组、排序策略、意图路由

| 编号 | magpie 功能 | magpie 出处 | Osuna 现状 | Osuna 证据 | 差在哪 | 上一轮的态度 |
|---|---|---|---|---|---|---|
| E01 | 不带接口名的模型名几家都有时自动成组（auto-<slug>），按提供方顺序问，失败换下一家；可以关掉自动成组 | ref:1709-1712；prov/group.go:571-612；gr:32 | 有 | gwy/routing.ts:40-58 | 没有关闭开关，也没有组 id | 已做：R-B7、R-B8 |
| E02 | 判断「同名」时先归一：去掉厂商前缀、版本里的点改连字符（含 Fireworks 用的 p）、下划线改连字符、去掉快照日期 | prov/group.go:607-652 | 没有 | gwy/routing.ts:54 要求名字完全相同 | 例如 `claude-opus-4.6` 和 `claude-opus-4-6` 不会互为备份 | 没提到 |
| E03 | 用户声明「这个模型就是那个」（ModelSameAs），让不同名的模型并成一组 | set:629-636 | 没有 | S 搜 `sameAs`：无 | — | 明确不做：prd「用尽时换到不同名的模型」 |
| E04 | 每家配一份有序的兜底名单（provider/model，只展开一层），退过去时用名单里写的模型名 | prov/provider.go:100-104；gw/fallback.go:335-381 | 没有 | — | — | 明确不做：map「按接口配置的有序兜底名单（magpie 做法，Q24）：04 票改为自动同名换家、没有同名就报错」 |
| E05 | 提供方顺序可以拖动（决定自动组的先后、不带接口名的模型名归谁） | prov/provider_order.go:8-31 | 没有 | gwy/routing.ts:17 按创建顺序；S 搜 `reorder`、`drag`：只命中推理项重排 | — | 没提到 |
| E06 | 自定义路由组 group/<id>：成员有序（可带 :effort 档位）、可嵌套、可复制、成员和组都能单独关、可设「只列出本组」、组的推理档位、组的上下文窗口、成员快速模式、按通配/正则自动收成员、组排序、分享为文字与粘贴导入、移除和恢复自动组 | ref:1247-1300；prov/group.go:140-240；rt/i18n.js | 没有 | S 搜 `routing group`：无 | — | 明确不做：map「magpie 的六种排序策略、路由组、中间件/插件系统、局域网共享、代替厂商联网搜索、并发与频率上限、OTLP 导出。」 |
| E07 | 排序策略：smart、order、rotate、usage、pace、weight、Manual；JS 插件可以加自己的策略 | ref:1267-1284、1415-1470；internal/routes/strategies.go:57-216；gm:33-40 | 没有 | S 搜 `rotate`、`weight`：只命中照抄来的判定参数 gwy/affinity.ts:47、71 | — | 同上（map「六种排序策略」） |
| E08 | 一家多个 key 或多个账号轮换（每个 key 可单独开关、指定协议、设权重），以及 Make first 调账号顺序 | ref:1470-1484；prov/keys.go | 没有 | — | — | 明确不做：map「同一接口多个 key：用户澄清切换单位是整家接口。」 |
| E09 | 意图路由与规则：按对话长度、是否带图、推理档、哪个 Agent、意图（分类模型判断，超时 8 秒，判不出就沿用上一轮）、是不是压缩请求、时段和星期、工作目录在或不在某文件夹，把这一轮先发给某个成员；每轮开始判一次；规则选中的成员失败时先在它内部换家 | prov/grouprule.go:41-96；gw/classify.go:1-40；gw/rules.go；gr:88-92 | 没有 | S 搜 `intent`、`classifier`：只命中 tr/anthropic.ts:408 的一句注释 | — | 明确不做（属于路由组）：同 E06 |
| E10 | 暂停规则：按时段、星期、Agent、文件夹把某个模型暂时移出组 | gr:93；prov/grouprule.go:78-84 | 没有 | — | — | 同上 |
| E11 | effort=auto：分类模型判断这一轮有多难，按难度给推理档 | prov/group.go:194-199 | 没有 | — | — | 同上 |
| E12 | 组的「迟迟不出字」：成员在设定秒数内没出第一个内容就换下一个 | prov/group.go:164-169 | 没有 | — | — | 同上 |
| E13 | 组的「成员全都忙」：所有成员都因忙或短时限流失败时，暂停后轮流重问（默认等 60 秒，最多 240 秒，期间保活） | gr:96；gw/patience.go:32-73；prov/group.go:124-125 | 没有 | — | Osuna 只有最后一家原地重试（C22） | 同上 |
| E14 | 上下文窗口作为路由依据：对话用到窗口 95% 时，在组内换到窗口更大的成员 | ref:1163-1166 | 没有 | — | — | 同上 |
| E15 | 决策模型组；路由组也用于画图和视频 | ref:1302-1314；gr:37 | 没有 | — | — | 没提到 |

### F. 并发、额度、替身、改名

| 编号 | magpie 功能 | magpie 出处 | Osuna 现状 | Osuna 证据 | 差在哪 | 上一轮的态度 |
|---|---|---|---|---|---|---|
| F01 | 每个 key/账号的并发上限、排队上限和最长等待，超了回 429；排队期间保活 | gr:35；gw/concurrency.go:81；prov/provider.go:154-167 | 没有 | S 搜 `concurrency`：无 | — | 明确不做：map「并发与频率上限」 |
| F02 | 每分钟请求数上限（按滚动 60 秒算） | gr:35；gw/rpm.go:149；prov/provider.go:173 | 没有 | S 搜 `rpm`：只命中测试里的词表 | — | 同上 |
| F03 | 按额度排序、提前切换：读订阅和套餐的额度窗口（Kimi Code、GLM、sub2api 的余量），按 90%/98% 分档，用完前就切；窗口恢复时提前解除冷却 | ref:1374-1470、1563-1586；gr:114、124、127 | 没有 | — | — | 明确不做：prd「主动读套餐用量提前切换（第二期）」 |
| F04 | 账号用量封顶、Codex「不用积分」 | gr:94、121 | 不适用 | Osuna 没有订阅账号 | — | 明确不做：map「订阅账号轮换」 |
| F05 | Claude 档位替身：Claude Code 发来的完整 Claude id（如 claude-haiku-4-5-20251001，按家族正则认），一律换成该 Agent 配置的那个档位的模型，哪怕某家正好提供这个 id；继承了 Claude Code 地址和口令的脚本发来的也算 | gw/gateway.go:140-200 | 部分 | gwy/routing.ts:30-38、82-88：只对 claude，而且要所有开着的接口都没选这个名字，才取第一家映射了该档位的接口 | 有接口正好选了同名 id 时，Osuna 走那家；档位映射按接口配，不按 Agent 配 | 已做（有意按接口配）：ADR7「tier mapping is per endpoint and has to follow the endpoint the gateway chose」 |
| F06 | 通用替身：Agent 请求了网关不认识的名字时，改用它配置里的模型（如 Codex config.toml 里的 model） | gw/gateway.go:130-139；internal/agent/claude.go:2404 | 没有 | gwy/routing.ts:45-48 找不到就回 404 | — | 已做（不替身）：R-B7「都找不到回 404、按 Agent 协议包装」 |
| F07 | Codex 的记忆整理调用和 auto-review（模型名 codex-auto-review，或带 x-openai-subagent: guardian 头）没有对应模型时，发给这段对话上一轮用的模型 | gw/codex_memory.go:12-80 | 没有 | S 搜 `auto-review`、`guardian`：无 | — | 没提到 |
| F08 | Codex 子代理单独指定模型；Claude Desktop 子代理单独指定模型和推理档 | gr:83-85 | 没有 | — | — | 明确不做（相近）：prd「Claude Code 后台小任务（起标题、压缩上下文）单独指定便宜模型…第一版不分流（10 票）」 |
| F09 | 上游改名（modelWires）：按单个模型或整家（relay/* 换成 vendor/*）设定发给厂商时用的名字 | ref:1181-1246；set:614-622；gw/gateway.go:105-128 | 没有 | S 搜 `modelWire`、`upstreamName`：无；已选模型的 id 就是发出去的名字（gwy/routing.ts:76、80） | 唯一的改名就是档位映射 | 没提到 |
| F10 | 模型名容错：用 `~` 代替斜杠（MiniMax Code 这样写）；Claude 版本号里的点改成连字符（Claude Code 会把带点的版本读成 Opus 4） | gr:32；prov/flat.go:23；prov/claudedash.go:56 | 没有 | — | — | 没提到 |
| F11 | 找不到模型时，404 说明原因，并给出最接近的三个 id 和正确的命名方式 | gr:32；gw/unknown_model.go:15；prov/closest.go:53 | 部分 | gwy/routing.ts:47 | 不给相近建议 | 已做：R-B7 |
| F12 | 禁用模型黑名单（支持通配，任何调用都回 403） | gr:623-663；gw/disabled.go | 有 | 只有「已选模型」会被路由（gwy/routing.ts:67-69） | 做法不同：Osuna 用已选模型白名单 | 已做：R-B7 |
| F13 | /v1/models 同时列出不带接口名的模型 id | gr:664-700；提交 7d6358ff | 有 | gwy/gateway.ts:735-752 | Osuna 只列不带接口名的 | 已做 |

### G. 可观测：路由页、请求记录、网关页

| 编号 | magpie 功能 | magpie 出处 | Osuna 现状 | Osuna 证据 | 差在哪 | 上一轮的态度 |
|---|---|---|---|---|---|---|
| G01 | 路由页实时视图：每个请求谁排第一、为什么，每次尝试的结果和冷却原因，用时与 token，从哪家改道过来 | plugins/routing/routing.go；rt/i18n.js「实时 · 网关正在做的决定」；gw/trace.go | 没有 | S 搜 `trace`：无 | 只有 daemon 日志 | 明确不做：prd「对用户无感：不提示、不加时间线、不加小横条；换家与冷却只写 daemon 日志」 |
| G02 | 路由历史落盘（保留 30 天、200 MB），可按天回放（可调倍速、跳过空闲） | gw/history.go:1-25；rt/client.js:1088、1821 | 没有 | 同 G01 | — | 同上 |
| G03 | 「按请求」和「按会话」两种视图：显示会话名、估算花费，起标题的请求并进原对话 | ref:1316-1335；rt/client.js:173 | 没有 | — | — | 同上 |
| G04 | 每次尝试的时间花在哪（magpie / 网络 / 厂商）、首 token 时间、请求的模型和实际回答的模型、聚合商背后真正的提供方 | gw/nettrace.go、ttft.go、upstream.go；提交 6f928153 | 没有 | S 搜 `ttft`：无 | — | 同上 |
| G05 | 打开某个请求查看请求体和回复体（内存里保留最近 10 个，已打码） | 提交 af601541；gw/capture.go:13-17；gr:41 | 没有 | — | — | 同上 |
| G06 | 路由记录里带 Agent 的工作目录、可按调用用途筛选、子代理有标签 | gr:40、86；提交 2fbbd169 | 没有 | — | — | 同上 |
| G07 | 网关页：一键复制网关地址、各 API 的 shell/curl/Python/Node 示例、模型 id 列表、最近调用 | plugins/gateway/gateway.go:1-30；gp/client.js | 不适用 | Osuna 自动把网关地址写进 CLI 配置，用户不需要手动接 | 「最近调用」这一块按「没有」算 | 没提到 |
| G08 | `magpie statusline`：给 Claude Code 状态栏打印这一轮走的模型和各账号的窗口 | ref:1783-1800 | 没有 | S 搜 `statusline`：只命中 UI 组件名 | — | 没提到 |
| G09 | 一轮结束提醒（根据网关看到的流判断这一轮结束了） | gr:115 | 不适用 | Osuna 由 daemon 自己管 Agent 状态 | — | 没提到 |

### H. 网关扩展点与状态文件

| 编号 | magpie 功能 | magpie 出处 | Osuna 现状 | Osuna 证据 | 差在哪 | 上一轮的态度 |
|---|---|---|---|---|---|---|
| H01 | JS 网关中间件：onRequest/onEvent/onResponse 钩子、ctx.reject 拒掉请求、可配选项、钩子超时就放行原样、社区现成中间件 | ref:944-1002；gm 全文；internal/gwmw/gwmw.go | 没有 | S 搜 `middleware`：无 | — | 明确不做：map「中间件/插件系统」 |
| H02 | 隐私打码：发给厂商前把敏感值换成占位符，回复里再换回来；设置要求打码但打码器不在时回 503、什么都不发 | gr:76-78；pr:208-220 | 没有 | S 搜 `redact`、`mask`：只命中 key 打码（ae/upstream-models.ts:62） | — | 没提到 |
| H03 | 观察者扩展点（OTLP 导出） | pr:161-176 | 没有 | S 搜 `otlp`：无 | — | 明确不做：map「OTLP 导出」 |
| H04 | 工具扩展点（web_search 替身、搜索 MCP、Codex 搜索） | pr:221-235；internal/gwtool/gwtool.go | 没有 | — | — | 明确不做：map「代替厂商联网搜索」 |
| H05 | 预算扩展点（网关 key 限额） | pr:236-249 | 不适用 | Osuna 没有网关 key | — | 明确不做：map「局域网共享」 |
| H06 | 内置插件可单独开关：rotation、groups、middleware、redact、search、budget、otel，关掉后网关按「列表顺序 / 不服务路由组 / 原样转发」回退 | ref:1459-1468；pr:178-207；plugins/rotation、plugins/groups | 没有 | — | — | 明确不做：map「中间件/插件系统」 |
| H07 | 状态文件写坏的处理：写入前把好的那份存成 .bak，坏的另存为 .bad-<时间>；读到坏文件时改读 .bak | internal/lastgood/lastgood.go:1-12；提交 58651568 | 部分 | ae/store.ts:165-194 读不了就报错、不写不删；gwy/gateway.ts:711-731 网关回 500 | 不会自动用上一份好的继续服务 | 已做（不写不删）：R-A3「解析失败报错，不写不删」 |
| H08 | Windows 上文件正被替换时，读文件和改名会重试（最多 0.5 秒） | internal/steady/steady.go:1-35 | 没有 | ae/store.ts 读文件不重试 | 推测 Windows 上并发写入时可能偶发一次 500 | 没提到 |

## 2. 10-13 之后 magpie 新加或大改的功能

在你给的目录里运行 `git log --since=2026-10-13`，共 199 个提交；去掉纯测试、其他页面和非网关的提交后，按功能归并如下。日期都是提交日期（commit date）。

| 功能 | 提交 | Osuna |
|---|---|---|
| 402 只说用量上限时算额度用完（可只冷却该模型） | af39ee4b（10-13） | 没有 |
| 工具 strict 被拒去掉重问并记住 | d46fb1e5（10-13） | 没有 |
| 安全拒答后再问几家可设置；Claude Code 收到原样的 refusal | 419ef302（10-13） | 没有 |
| 上游错误形状读不懂时判为失败（让 Codex 重试） | 320af985（10-13） | 部分 |
| 路由组按权重轮转；规则选中的成员失败时先在它内部换家 | eba71873、f2b0780f（10-13） | 没有 |
| /v1/models 同时列不带接口名的 id | 7d6358ff（10-13） | 有 |
| 模型列表写出服务档（Fast 等） | b515538a（10-13） | 没有 |
| 翻译的空回复再问一次，还空就报错 | 353464f1（10-14） | 没有 |
| 缓存写入也算粘性依据 | 7f968b95（10-14） | 没有 |
| 复用连接被掐时立刻在新连接上重发 | 9a0d723d（10-14） | 没有 |
| 每家自己的冷却封顶、rest-cap off、额度冷却到每天几点 | bf258427、22512cde、064cffdb（10-14） | 没有 |
| 一批调用中间的文字挪到第一个调用前 | 9f8ad6ed（10-14） | 没有 |
| 只有 tool_reference 的工具结果被拒时补一句文字 | 3e812ebd（10-14） | 部分（翻译路径有，直通没有） |
| json_schema 被拒时先改 json_object + schema 写 system | 3ec45e71（10-14） | 没有 |
| 用户设的 Max output 压低请求；没勾任何档位的模型不发推理字段 | b9c589eb、f074996d（10-14） | 没有 |
| 翻译出的 Responses 回复保留跑过的搜索 | 3aa22f9d（10-14） | 没有 |
| advisor 改成上游模型名，或连说明一起去掉 | 79f64f02（10-14）、b6fae8ef（10-15） | 没有 |
| Kimi Code、DeepSeek 不发延后加载工具块 | c9af654b（10-14）、7faf5577（10-15） | 没有 |
| /v1/magpie/concurrency；statusline | 3b6ca055、8f03b780（10-14）、27a0458d（10-15） | 没有 |
| 路由历史记录工作目录 | 2fbbd169（10-14） | 没有 |
| 语音转文字接口；画图请求在组内换成员 | ccffdadb、ea3ea117（10-14） | 没有 |
| 内置 HTTPS | d9ca84a2（10-14） | 不适用 |
| 1 小时缓存粘一小时；厂商悄悄缓存时也粘 | ef490114、7c5bfd7a（10-15） | 没有 |
| 模型自己的冷却梯子（和整家分开计） | 1ad60446（10-15） | 部分 |
| 翻成 Responses 时给被中断的调用补结果；同一调用的第二个答复去掉 | f348025c、919c8b93（10-15） | 没有 |
| 结构化输出剥掉代码块 | 244a21d4（10-15） | 没有 |
| 以错误形式出现的拒答立刻结束这次尝试；「high risk」算拒答 | d98e1780（10-15） | 没有 |
| 已开始的流里出错时补「状态码 + 可重试」 | 3d63fc9c（10-15） | 没有 |
| 装不下请求的成员不问；Command Code 不说原因的 400 换成员 | 0f398c48、75035fa2（10-15） | 没有 |
| 智谱重置时间按北京时间读；Cline 免费额度只冷却该模型 | ad312dfe、ff2e6e23（10-15） | 没有 |
| Codex 原生压缩；压缩摘要失败换家 | 82f48f09、4ad929fd、51d5b8d0（10-15） | 不适用（推测） |
| 嵌套组用自己的 Sink、首字超时和规则顺序 | 7a3fed6b、91c4705e、abc90068、fa725d47（10-15）、43fef069（10-16） | 没有 |
| 网关能力插件化：rotation、groups、middleware+redact、search、budget、otel、JS 策略与 onUsage、MCP 工具点 | af9bd6c3、b1d02fa6、4ac4d9ba、9d97fd07、a1f7b8c1、9916a946、3f913b3d、6ac7032b（10-15） | 没有（明确不做） |
| 状态文件写坏时另存、不覆盖 | 58651568（10-15） | 部分 |
| `Origin: null` 和 localhost 子域的网页也要 key | c20bb76c、d182294b（10-15） | 不适用 |
| 中转站单次输入上限算超长，组内换成员 | 7fefbc61（10-16） | 没有 |
| 往断掉的流里追加事件前空一行 | 7e4336e7（10-16） | 不适用（Osuna 直接断开） |
| 413 在 OpenAI 路由也写 request_too_large | 97f264c7（10-16） | 有（gwy/agent-errors.ts:29-30 不分协议） |
| Responses 回复里的 assistant 消息标 phase | 55d6ea4f（10-16） | 没有 |
| 直通回复的推理陷入循环时再问一次 | a0a4d55e（10-16） | 没有 |
| 每次尝试的时间去向；可打开请求看请求体和回复体 | 6f928153、af601541（10-16） | 没有 |
| Gemini：思考签名存盘、兼容流补 finish_reason、Gemini 4 的思考档 | 682e4253、a6f908ba（10-16）、52be997b（10-14） | 没有（Gemini 第二期） |
| Codex 网页搜索能答、排队时保活 | 9b52fb50（10-13）、6f6b7d40（10-15） | 没有 |

## 3. 需要用户拍板的取舍点

1. **订阅账号当提供方。** 包括 Claude/ChatGPT 账号轮换、Codex 走 ChatGPT 后端（A15、E08、F04）。这要读写 `~/.codex/auth.json`，而且在厂商条款边缘，和 map「订阅账号轮换…ADR 0004 明确不碰 `auth.json`」冲突。
2. **Claude Code 保持 claude.ai 登录的同时走网关（A38）。** 网关要接受 Claude 的 OAuth 令牌当身份，这会推翻 ADR7「口令兼身份」的鉴权设计，也牵涉 Anthropic 登录的使用条款。
3. **安全拒答后换别家再问（C05）。** 等于把一家安全过滤拒掉的内容转给其他厂商，可能被看作绕过安全策略（magpie 出处 ref:1517-1528）。
4. **路由组、排序策略、意图路由、暂停规则、并发/RPM 上限（E06～E14、F01、F02）。** 上一轮在 map 里明确不做。要做就得加新界面（只在桌面端）和协议新字段；意图分类还会额外调用模型、产生费用。
5. **兜底名单、不同名模型换家、ModelSameAs（E03、E04）。** 和 dec D8「只换同名、没有同名就报错」冲突。
6. **路由页、请求记录、查看请求和回复体（G01～G06、A26）。** 和 prd「对用户无感…只写 daemon 日志」冲突；保存请求体还多一个隐私面。
7. **「记住被拒」重发与厂商专属改写（B40、B42、B47～B52 等）。** magpie 10-13 之后新增的修补大多属于这一类。和 ADR7「A rejected request is never re-sent to the same endpoint in a changed shape」冲突，ADR7 目前只给关思考开了例外。
8. **改「开口」的口径（C02、C04）。** 帧不算开口、推理先扣住最多 4 分钟，会推迟用户看到思考的时间，并改变 R-B8「第一段」的定义。
9. **改动模型输出本身。** 循环截断、把文字里的工具调用改成真调用、剥 JSON 代码块（B32、B52、C 组循环相关）。
10. **粘性或冷却落盘（D06、C34）。** prd 写明冷却不持久化，R-B10 定的是粘性只记内存。
11. **按额度提前切换（F03）。** 第二期的范围；对中转站要配额度地址，对订阅要读登录凭据。
12. **网关对任意本机工具开放。** 比如 Chat 入口、/v1/images 等（A04、A17～A21）。口令现在只发给 Claude Code 和 Codex，开放就要改口令的发放方式。另外任何新增的管理字段都必须可选、并按能力标记门控，官方 Paseo 手机 App 不改（prd「修改官方 Paseo 手机 App」不做）。
13. **出站代理、证书跳过（C29）。** 要在接口设置里加字段，和另一位助手负责的提供方配置有重叠。
14. **「需要检查」和 magpie 的退避（C07）。** 这是 Osuna 有意的不同（R-B9）。如果改成像 magpie 那样自动恢复，就推翻了上一轮的决定。

## 4. 拿不准的地方

1. **Codex 会不会给 Osuna 发 zstd 压缩的请求体（A33）。** magpie 的注释（gw/request_bounds.go:75-78，#1223）说会，但 Osuna 14 票的真实验收通过了。可能取决于 Codex 版本或登录方式。这是推测，没有看 codex-rs 源码。
2. **Codex 原生画图会不会对 Osuna 的提供方调 `/v1/images/generations`（A17）。** magpie gw/image_tool.go:11-17 说，Codex 只给它「读作 OpenAI 一方」的提供方开画图工具。推测。
3. **Codex 的远程压缩（B57）。** 依据的是 magpie 文档 gr:137 的说法，没看 codex-rs。推测 Osuna 不受影响。
4. **Claude Code 实际会经网关发出 temperature、safeguards、计费行、advisor、延后工具块（B42、B44～B47）。** 依据是 magpie 文档里对 Claude Code 2.1.29x～2.1.300 的观察，没有用 Osuna 的真实流量验证。推测。
5. **自造的 `rs_` 推理项在换家后直通给 OpenAI 官方会被拒（B19）。** 由 magpie #1008 和 Osuna 代码（tr/responses.ts:1082、gwy/passthrough.ts:202-205）推出来的，没有实测。
6. **复用连接被掐（C28）、Windows 上改名竞争（H08）。** 都是推测：Node 19 起全局连接池默认开 keepAlive，Windows 上文件替换有短暂的占用窗口。
7. **「10-13 之后」用的是提交日期。** 不少提交的提交日期是 10-15 23:08（批量提交），作者日期更早，所以有些功能上一轮调研时可能已经在仓库里了（例如 af39ee4b 的作者日期是 10-13 18:11）。代码内容本身看过、已确认。
8. **文档和代码不一致的地方。** gr:88 说 firstWords 用在「粘性范围」里；代码里只在路由组那一支给范围加上 firstWords（gw/gateway.go 中 `scope += "|" + words` 那一段）。我以代码为准：普通提供方的粘性键是「provider/model + 会话头或第一条 user 消息的摘要」，和 Osuna 一致（D10）。
9. **只读了文档、没逐行核对实现的部分。** 包括 roomy、patience、Sink、规则、意图分类的具体行为与数字，以及 GUI 文字。只核对了入口和常量的行号。
10. **Osuna 网关里有 Chat 解析器但入口不收 Chat（A04）。** 这一条看过源码确认。
