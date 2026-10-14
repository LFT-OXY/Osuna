# 05 — 中转站的对外样子

Type: interview
Status: resolved
Blocked by: 02

## Question

依据 02 的事实定：

- 挂载路径（例如 `/api-endpoint-gateway/claude/v1/messages`、`/.../codex/v1/responses`）与 Agent 配置文件里写的 base URL；`count_tokens` 路径。
- 口令：每个 Agent 一个随机口令还是全局一个；存哪；泄露时怎么换；配置文件里的写法（Claude 用 `ANTHROPIC_AUTH_TOKEN`，Codex 用现有 `auth.command` 读 0600 文件）。
- 端口变化时重写 Agent 配置的触发点；daemon 未运行时 Agent 的报错体验是否需要额外提示。
- 远程：手机经中继操作时中转站不可达也无妨，确认无需暴露。
- 是否把每次转发的 token 用量记进 Osuna「用量」页（目前是雾，这里拍板进或出）。
- 转发时的超时、流式转发实现（Node fetch + ReadableStream？）、上游错误体是否原样透传给 Agent。

产出：Answer 写定路径表与口令方案；更新 `prd.md`。

## Answer

访谈两轮（2026-10-14）。第一轮给出推荐，用户要求六项"看 magpie 怎么做"；第二轮读了 magpie 源码（`internal/gateway/gateway.go`、`lan.go`、`upstream_transport.go`、`routing.go`，`internal/agent/claude.go`、`codex.go`、`rewire.go`、`gatewaykey.go`，`docs/subsystems/agent-wiring.md`）后逐项给出"magpie 做法 → Osuna 取舍"，用户全部按推荐。

### 网址与路径

- 中转站挂在 daemon 现有 HTTP 服务上，前缀 `/api-endpoint-gateway`。Claude Code 的 `ANTHROPIC_BASE_URL` 写 `http://127.0.0.1:<端口>/api-endpoint-gateway`；Codex 的 `base_url` 写 `http://127.0.0.1:<端口>/api-endpoint-gateway/v1`（magpie 是独立端口 3425 的根路径与 `/v1`，Osuna 的端口上已有网页、`/api/*`、`/ws`，必须加前缀）。主机按 02 票的拼法：`0.0.0.0` → `127.0.0.1`，`::` → `::1`。
- 应答路径：`POST /v1/messages`、`POST /v1/messages/count_tokens`、`POST /v1/responses`、`GET /v1/models`、`/api/hello`（回 200 JSON，Claude Code 的预热探测）。其余回 404。
- 不在网址里区分 Agent，靠口令认人（同 magpie）。
- 路由挂在 daemon 密码中间件与全局 `express.json()` 之前（或加入免检路由表），请求体自行流式读取，不经 100 kb 上限。

### 口令

- 每个 Agent（claude / codex）一个随机口令，daemon 持有「口令 → Agent」对照表，口令同时标明身份（借 magpie 的 `magpie-<agent>` 思路，但 magpie 的口令是公开常量、本机任何口令都收；Osuna 按 Q6 要保密）。
- 两道门：只接受来自本机回环地址的请求（同现有 `/api/terminal-activity` 的判定，不看 daemon 监听什么地址）+ 口令正确；任一不满足回 401。Docker 内 Agent 与 daemon 同容器，仍是本机。
- 持久保存在 `$PASEO_HOME/api-endpoints/` 下的 0600 文件，daemon 重启不变、不重写 CLI 配置。生成时机：某 Agent 从「官方」切到任何一家接口时生成新口令；切回「官方」作废删除。第一版不做「重新生成口令」按钮。
- 中转站收到请求后用该 Agent 的开关、默认模型与 04 票的三条路由规则选接口，把口令替换成该接口的真实 key 后转发。

### Claude Code 配置（`~/.claude/settings.json`）

| 键 | 写法 | 依据 |
|---|---|---|
| `env.ANTHROPIC_BASE_URL` | 中转站网址 | 同 magpie |
| `env.ANTHROPIC_AUTH_TOKEN` | 口令 | 同 magpie |
| `env.ANTHROPIC_API_KEY` | 置空 | 照现在 |
| 顶层 `model` | 该 Agent 的默认模型（光秃秃的名字） | **改动**：跟 magpie，不再写 `env.ANTHROPIC_MODEL`，接管时若存在则删除并记入接管记录（它会盖过 `/model` 的选择，下次新会话跳回去） |
| `env.ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU,FABLE}_MODEL` | **不写**，接管时若存在记入接管记录并删除 | 偏离 magpie：04 票定了档位按各家映射、换家时跟着换，由中转站翻译 |
| `env.ANTHROPIC_SMALL_FAST_MODEL` / `CLAUDE_CODE_SUBAGENT_MODEL` | 不写 | 偏离 magpie：前者已弃用，口令认证下后台任务跟主模型（01 票）；子代理模型由用户自己管 |
| `permissions.deny` 的 `WebSearch` | 照现在 | — |

切回官方时顶层 `model` 与各 env 键一样按接管记录还原。

### Codex 配置（`~/.codex/config.toml`）

- 专用表 `[model_providers.osuna_api_endpoint]`：`name`、`base_url`（中转站 `/v1`）、`wire_api = "responses"`、`experimental_bearer_token = <口令>`（**改动**：跟 magpie 明文写口令，去掉 `auth.command` 与 `codex-api-key` 文件及 Codex 最低版本检查；字段名带 experimental，Codex 改名时要跟）。不写 magpie 的 `http_headers.x-openai-actor-authorization`（只为它的画图工具）。
- 顶层 `model_provider`、`model`（光秃秃的默认模型名）照现在。
- 新增顶层 `model_catalog_json`，指向 `$PASEO_HOME/api-endpoints/codex-models.json`（magpie 放 `~/.codex/magpie-models.json`，Osuna 放自己目录）。内容按 04 票：去重后的光秃秃模型名（可见）+ 各家 `slug/模型名`（隐藏）；接口、勾选模型或开关一变就重新生成，切回官方时删除并从接管记录还原该键。字段按 01 票 `research/slash-model-ids.md` 的 `ModelInfo`。
- magpie「Codex 已登录 ChatGPT 时只写 `openai_base_url`」属于订阅账号范围，图外不做。

### 端口变化、socket 模式、daemon 未运行

- daemon 每次启动绑定端口后：若任一 Agent 开着接口，比对接管记录里写入的中转站网址与当前绑定网址，不一致就重写该 Agent 的配置文件（magpie 的 `Rewire` 在改端口的那一刻做；Osuna 端口只在重启时变，所以放在启动）。接管记录里要记下写入的网址。
- 非 TCP 监听（unix socket / 命名管道）生成不出网址：拒绝打开任何接口开关，RPC 返回错误、界面提示「daemon 以 socket 方式监听，中转站需要 TCP 端口」（文案归 08）。
- daemon 未运行时 Agent 连接被拒：同 magpie 不做处理，文档写一句。

### 转发

- 流式：上游响应边收边发；首字（第一段内容）之前出错可换家（Q16），之后原样续传。
- 超时：等上游响应头最长 10 分钟（magpie `ResponseHeaderTimeout`），超时按服务器错误冷却并换家；开口后不限时，交给 CLI 自己的超时。不做单独的首字超时（magpie 只在路由组里有，图外）。
- 报错（换不了家、或全在冷却中）：状态码照抄上游；错误文字改为「<接口名>: <上游错误原文>」，按 Agent 的协议格式包装（Anthropic 的 `{"type":"error",...}` / OpenAI 的 `{"error":{...}}`）；上游说了重置时间就以文字附在后面（即「几点前不会再问它」），`Retry-After` 与含 `ratelimit`+`reset` 的响应头原样带回。上游错误体最多读 1 MB。
- 每个响应加 `x-osuna-api-endpoint: <slug>` 响应头，只供排查。
- `count_tokens`：上游是 Anthropic Messages 协议就转发，否则本地按字节/4 估算（第四轮已定）。

### 用量页

不另记中转站的用量；用量页照旧读 CLI 会话记录。价格匹配 `usage/pricing/matcher.ts` 本来就剥掉最后一个斜杠前的前缀，`kimi/kimi-k2.5` 能按 `kimi-k2.5` 计价。从「尚未明确」移到「图外」。

### 对其它票的影响

- **06**：路由选家、口令替换、流式转发与包装式报错属于发动机实现；`count_tokens` 本地估算在转换范围内。
- **07**：换不了家时 Agent 收到的报错文字格式已定（接口名 + 原文 + 重置时间），时间线提示不必重复这些信息。
- **08**：socket 模式下开关禁用的提示文案；口令、网址、目录文件均不在界面显示。
- ADR 草稿（终点要求）：中转站挂 daemon HTTP、口令代替真实 key、顶层 `model` 取代 `ANTHROPIC_MODEL`、Codex 口令明文取代 `auth.command`，这四点部分取代 ADR 0004，等 06/07/08 定完后合写。

## 修订（08 票，2026-10-14）

本票部分结论被 08 票修订（Agent 总开关 + 接口全局开关取代每 Agent 每家开关；「暂停」并入接口开关；一家接口最多三个格式地址 + 自动检测；迁移与老 App 投影相应调整）。以 `map-issues/08-ui-prototype.md` 的 Answer「数据模型修订」与「对其它票的影响」为准。
