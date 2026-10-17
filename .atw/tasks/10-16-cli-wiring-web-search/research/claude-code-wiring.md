# Claude Code / Codex 接入细节：候选事实核实

调研日期 2026-10-17。只记事实，不做取舍、不写推荐。每条事实标注：

- 【源码核实】在下面列出的源码里看到；
- 【文档所说】官方文档或 CHANGELOG 原文这么写，没在源码里逐字核对；
- 【推断，未核实】由源码或文档推出来，没有直接证据。

## 读了哪些来源

| 来源 | 版本 / commit | 引用写法 |
|---|---|---|
| Claude Code | npm `@anthropic-ai/claude-code@2.1.302`（2026-10-17 的 `latest`，`stable` 标签是 2.1.292）。npm 包本身只有安装脚本，真正的程序在平台包 `@anthropic-ai/claude-code-darwin-arm64@2.1.302` 里：Bun 编译的原生二进制，内嵌压缩 JS，`VERSION:"2.1.302"`、`BUILD_TIME:"2026-10-16T15:52:41Z"`、`GIT_SHA:"2ef144e6f98c1c99d082b735e4b38f50e3391e55"`。`@anthropic-ai/claude-agent-sdk@0.3.302` 也只带原生二进制，没有 cli.js，没用它。只用 `strings` 和 Python 正则读二进制，没有运行。 | `CC 2.1.302「能 grep 到的字符串」`。压缩后的函数名每个分块各自命名，只作辅助定位 |
| Claude Code CHANGELOG | `anthropics/claude-code` main 分支 `CHANGELOG.md`（最新一节 2.1.302） | `CHANGELOG 2.1.xxx` |
| Claude Code 官方文档 | `https://code.claude.com/docs/en/<页面>.md` 的线上原文，2026-10-17 取，正文提到的最新版本是 v2.1.300。Exa 返回的是旧缓存（最多到 v2.1.281），没有采用。 | 页面名，如 llm-gateway、settings、env-vars |
| magpie | yetone/magpie @ `7597c132`（`/tmp/magpie-src.kvD6Mk/repo`） | `magpie:路径:行号` |
| Codex | openai/codex @ `ce0323f2f2d3b25e82806cd555237da3db4e1897`（2026-10-17，`git clone --depth 1`）。依赖的行为另读了本机 cargo 缓存里的 reqwest 0.12.28、hyper-util 0.1.21、toml_parser 1.1.3 源码（只读）。Codex 的 Cargo.lock 锁的是 reqwest 0.12.28、hyper-util **0.1.20**、toml_parser 1.1.3。 | `codex:路径:行号`，路径从仓库根算起 |
| Osuna | main @ `d8948dad2` | `Osuna:路径:行号`；`ae/` = `packages/server/src/server/api-endpoints/`，`gwy/` = `ae/gateway/` |

---

## 1. 走中转站时保留 claude.ai 登录

### 1a. 设了 `ANTHROPIC_AUTH_TOKEN`，claude.ai 登录会不会被删、关掉后要不要重新登录

- 不会被删。【源码核实】CC 2.1.302 只在两处删掉存着的 `claudeAiOauth`：`/logout`（日志前缀 `[performLogout]`，`delete i.claudeAiOauth`）和换成 Console 登录（`"Console profile login: could not clear the replaced claude.ai login record"`）。设环境变量不走这两处。
- 但只要 `ANTHROPIC_AUTH_TOKEN` 非空，claude.ai 登录在这个进程里就不用了。【源码核实】
  - 判断「能不能用 Anthropic 账号登录」的函数里有 `w=(s||y)&&!fge()||…; return!(e||w)`，其中 `s` 是 `ANTHROPIC_AUTH_TOKEN`。`fge()` 只在远程会话（`CLAUDE_CODE_REMOTE`）里为真，所以本机终端里一设口令，这个函数就返回假。
  - 「是不是 claude.ai 订阅用户」要先过这个函数（`function kt(){if(!wl())return!1;return lW(Nn()?.scopes)}`），所以订阅相关功能全部按「没登录」处理，见 1c。
  - 请求头走口令：非订阅时 `e.Authorization=\`Bearer ${b}\``，来源标记为 `"ANTHROPIC_AUTH_TOKEN"`。
- 空字符串等于没设。【源码核实】读口令的地方都是真值判断（`if(a.ANTHROPIC_AUTH_TOKEN)`、`s=XS()` 再 `s||y`），`""` 为假。magpie 也是靠这一点保留登录的：`magpie:docs/subsystems/agent-wiring.md:74`「claude.ai writes `ANTHROPIC_AUTH_TOKEN` empty, which Claude Code reads as no key」。
- 去掉口令以后：
  - 存着的 claude.ai 凭证重新生效，不用重新登录。【源码核实】凭证没被删，`Nn()` 照常读。
  - 例外是凭证已经续不上（刷新令牌过期或被吊销）。这时 `/status` 显示 `"Login","Expired — log in again"`，要重新 `/login`。【推断，未核实】口令生效期间 Claude Code 会不会替 OAuth 续期没查；续期失败的提示文案是源码里的。
  - 正在跑的会话也会马上换回 OAuth。【推断，未核实】settings.json 的 `env` 一变，正在跑的会话会「clear auth caches / re-apply env」，见第 8 题。
- magpie 的说法与此一致：`magpie:docs/reference.md:1967-1970`「A key in `ANTHROPIC_AUTH_TOKEN` signs Claude Code out of claude.ai **while it runs through magpie**」。
- 【文档所说】
  - llm-gateway-connect：「Your claude.ai login stays saved and unused while the variable is set; unset the variable and Claude Code goes back to it. With `ANTHROPIC_AUTH_TOKEN`, the variable takes precedence immediately.」
  - gateways：「Setting `ANTHROPIC_AUTH_TOKEN` for a gateway you run … turns off subscription login for that session.」
  - authentication 的优先级：云厂商变量 ＞ `ANTHROPIC_AUTH_TOKEN`（作 `Authorization: Bearer` 发送）＞ `ANTHROPIC_API_KEY` ＞ `apiKeyHelper` ＞ `CLAUDE_CODE_OAUTH_TOKEN` ＞ profile/federation ＞ `/login` 订阅。

### 1b. 设了 `ANTHROPIC_BASE_URL`、不设口令时，OAuth 令牌会不会发给这个地址

会，放在 `Authorization: Bearer <OAuth 访问令牌>` 里，同时带 `anthropic-beta: oauth-2025-04-20`。【源码核实】

- 建 API 客户端时：
  - `rr=GKn({anthropicAuthEnabled:wl(),oauthScopes:Ze?.scopes})`；
  - `g1s` 在订阅用户时返回 `{apiKey:null,authToken:e.oauthAccessToken??null}`；
  - 第一方分支最后是 `{apiKey:jo.apiKey,authToken:jo.authToken,...a.ANTHROPIC_BASE_URL?{baseURL:a.ANTHROPIC_BASE_URL}:!1,...}`。
  - 也就是说，基地址和用哪种凭证是分开定的：设了 `ANTHROPIC_BASE_URL` 就发到那里，订阅用户发 OAuth 令牌。
- 自定义地址仍算第一方提供方：`Pe()` 只看 `CLAUDE_CODE_USE_*` 开关，都没开就是 `"firstParty"`；`Pi()` 只用来区分地址是不是 `api.anthropic.com`。
- Osuna 现在一并写的 `ANTHROPIC_API_KEY: ""` 也按没设处理：API key 来源函数 `Yk()` 对它做真值判断，空串跳过。所以只把口令写空，就会落到 OAuth。【源码核实】
- beta 列表里有 `{beta:Oke,when:()=>kt()||…}`，`Oke=k("oauth_auth",Ep)`、`Ep="oauth-2025-04-20"`。
- 没找到「自定义地址 + 订阅登录」时的提示或拦截（搜 `ANTHROPIC_BASE_URL` 附近的 login/subscription 文案无命中）。
- 【文档所说】
  - llm-gateway：「Setting only that variable [`ANTHROPIC_BASE_URL`], without a gateway credential, doesn't replace the subscription. Requests still route through the gateway, but a saved claude.ai login remains the active credential … must forward the OAuth capability in `anthropic-beta`」。
  - llm-gateway-protocol：「stripping it fails those requests with `401`」。这是对把请求转到 Anthropic 的网关说的。
  - CHANGELOG 2.1.153：「Fixed a regression where a custom API gateway could receive the user's Anthropic OAuth credential instead of the gateway's own token」，说的是设了网关口令的情形。
- 账号类接口不走 `ANTHROPIC_BASE_URL`，直接用 OAuth 令牌找 Anthropic。【源码核实】
  - 已核实的：资料 `\`${ln().BASE_API_URL}/api/oauth/profile\``，fast mode 组织开关 `/api/claude_code_penguin_mode`（`Authorization: Bearer` + `anthropic-beta: oauth-2025-04-20`），云端会话列表 `/v1/code/sessions`。
  - 套餐用量 `/api/oauth/usage` 用的是同一类内部客户端（`zt.get(n,{…refreshOAuth:!0…})`），没追到它的基地址。【推断，未核实】
- Osuna 现状下若把口令写空（【源码核实】）：
  - 中转站只从 `Authorization: Bearer` 或 `x-api-key` 认口令（`Osuna:gwy/gateway.ts:1111-1127`），对不上就回 401「Invalid API endpoint gateway token」（`gwy/gateway.ts:165-172`）。
  - 直通时丢掉 `authorization`、`x-api-key`（`gwy/passthrough.ts:96-110`），但 `anthropic-beta` 原样转发，只对非 Claude 模型去掉自动模式审查的 beta（`gwy/passthrough.ts:607-628`）。所以 `oauth-2025-04-20` 会发到上游。
  - 上游怎么对待这个 beta 未核实。

### 1c. 保留 claude.ai 登录和用口令，Claude Code 里哪些功能不同

下面「OAuth」指保留登录、地址仍是中转站；「口令」指 Osuna 现在的写法。只列在 CC 2.1.302 源码里看到门槛的项。

| 功能 | 门槛 | OAuth | 口令 | 依据 |
|---|---|---|---|---|
| 语音 | 要能用 Anthropic 账号登录 | 能用（还有录音等其他检查） | 不能，提示 `"Voice mode requires a Claude.ai account. Please run /login to sign in."` | 【源码核实】`if(!wl())return{… "Voice mode requires a Claude.ai account…"}` |
| claude.ai 连接器（MCP） | 提供方是第一方，且是订阅用户 | 加载（自定义地址仍算第一方） | 不加载 | 【源码核实】`[claudeai-mcp] Disabled on third-party provider` 前是 `if(!Xn())`，随后 `if(!kt())` |
| `/usage` 的套餐限额 | 订阅用户且有 `user:profile` 范围 | 有 | 没有 | 【源码核实】`qm`：`s&&kt()&&Jp()`；请求 `/api/oauth/usage` |
| `/status` | — | 显示 `Login method: <套餐> account` | 显示 `Auth token: ANTHROPIC_AUTH_TOKEN` | 【源码核实】`label:"Login method"`、`label:"Auth token"` |
| Remote Control | 第一方、地址是 `api.anthropic.com`、claude.ai 登录 | 不能：`"…ANTHROPIC_BASE_URL is set and does not point at api.anthropic.com…"` | 不能，并提示 `"ANTHROPIC_AUTH_TOKEN is set, so this session is using API-key auth"` | 【源码核实】`var u="Remote Control is only available when using Claude via api.anthropic.com."` |
| 云端会话（/teleport 等） | claude.ai 登录、第一方提供方 | 可用 | 不行 | 【源码核实】文案 `"Cloud sessions use your claude.ai login."`、`"Cloud sessions need a claude.ai sign-in."`；另有一处判定在来源是口令时返回 `"blocked_auth_token_env"`，所在功能没细查。【文档所说】只靠 `ANTHROPIC_BASE_URL` 的网关不算第三方提供方，但仍要 `claude auth login` |
| 自动模式审查的计费提示 | Pro/Max/Team 订阅不提示 | 不出现 | 可能出现（第 6 题） | 【源码核实】`$Dn()` 在订阅类型为 pro、max、team，或类型未知但 `kt()` 为真时返回假 |
| fast mode | 提供方是第一方；组织开关检查要 OAuth 或 API key | 可能可用（订阅用户要 usage credits）。开了以后发给中转站什么【推断，未核实】 | 按组织禁用处理 | 门槛【源码核实】：`function $o(){if(Pe()!=="firstParty")return!1;…}`；检查凭证是 `R?.accessToken&&Yd()?{accessToken}:s?{apiKey:s}:null`，两者都没有时报 `"No auth available"`。口令一列【文档所说】fast-mode：「A session that authenticates with `ANTHROPIC_AUTH_TOKEN` alone skips the check … treats fast mode as disabled by your organization」；可用性检查「doesn't follow `ANTHROPIC_BASE_URL`」 |
| 网关模型发现（读 `ANTHROPIC_BASE_URL/v1/models`） | 要口令、apiKeyHelper 或 API key；只收 id 含 claude/anthropic 的；需显式打开 | 跳过（`skipped: no credential (ANTHROPIC_AUTH_TOKEN, apiKeyHelper, or API key)`） | 可用 | 【源码核实】；开关名 `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY` 只看到片段，【推断】它是开启条件 |
| ultrareview（`/code-review ultra`） | 文档：要 claude.ai 账号；magpie：只在 Anthropic 自己的地址上有（2.1.290） | 文档没说经网关能不能用；magpie 说不能 | 不能 | 【文档所说】ultrareview：「requires authentication with a claude.ai account」，按 usage credits 计费。【未核实】CC 2.1.302 里 `/ultrareview` 是 `/code-review ultra` 的旧名，没找到它对地址的门槛 |

文档补充【文档所说】：

- CHANGELOG 2.1.139：Remote Control、`/schedule`、claude.ai 连接器「are now disabled when `ANTHROPIC_API_KEY` / `apiKeyHelper` / `ANTHROPIC_AUTH_TOKEN` is set, even if a Claude.ai login also exists」。
- feature-availability：
  - 需 claude.ai 登录、用 Console key 或第三方提供方时用不了的：Cloud sessions、Routines（`/schedule`）、Ultrareview、Remote Control、Voice dictation 等。
  - 「Whenever `ANTHROPIC_BASE_URL` points at a host other than `api.anthropic.com`, Claude Code turns off features such as Remote Control and server-managed settings」（v2.1.196 起）。
- llm-gateway-connect：用语音要去掉网关凭据；用 Remote Control 要去掉凭据和 `ANTHROPIC_BASE_URL`。
- claude-code-on-the-web：只靠 `ANTHROPIC_BASE_URL` 配的网关不算第三方提供方，但 `/teleport` 仍要 `claude auth login`。
- fast mode：
  - 可用性检查「doesn't follow `ANTHROPIC_BASE_URL`」；
  - 「A session that authenticates with `ANTHROPIC_AUTH_TOKEN` alone skips the check … treats fast mode as disabled by your organization」；
  - 订阅用户要用 usage credits。
- `/usage`：
  - 订阅用户看套餐用量条，API 用户看 token 用量；
  - 经网关时，套餐用量靠响应头 `anthropic-ratelimit-unified-*`（llm-gateway-protocol：「Claude Code reads them … to show usage against plan limits to developers signed in with claude.ai」）。
  - 【推断】经 Osuna 转到第三方时没有这些头。

magpie 对两种登录方式的界面说明见 `magpie:internal/agent/claude.go:2048-2053`：

- 用 magpie 的 key：「claude.ai's plan limits in /usage, its connectors, voice and /teleport are off」。
- 保留 claude.ai 登录：「Remote Control and ultrareview stay off: Claude Code has them only on Anthropic's own address」。

上表除 ultrareview 外都和它一致。

### 1d. `ANTHROPIC_CUSTOM_HEADERS`

- 格式与发送范围【源码核实】
  - 每行一个 `Name: Value`，按 `\r?\n` 分行，以第一个冒号切开，名字两头去空格：`function Mke(e=a.ANTHROPIC_CUSTOM_HEADERS??""){… e.split(/\r?\n/) … n.indexOf(":") …}`。
  - 这些头放进 API 客户端的 defaultHeaders（`be={...Wl(),...ee,...}`，`ee=tNt()`），订阅分支也带（`eu={...be,...$l(le,be)}`）。所以和 OAuth 的 `Authorization` 一起发。
  - 组织禁用实验 beta 时，自定义的 `anthropic-beta` 会被丢掉（`tNt`）。
  - 自定义 `Authorization` 有特殊处理：`ANTHROPIC_AUTH_TOKEN` 优先，没有口令才取自定义的 `Authorization`（`M0e()`）。
- 格式【文档所说】
  - env-vars：「Custom headers to add to requests (`Name: Value` format, newline-separated for multiple headers)」。
  - llm-gateway-connect：写在 settings 的 `env` 里时用 `\n` 分隔。
- 版本【文档所说】
  - CHANGELOG 里没有「新增」条目，最早提到它的是 2.1.101（修 Bedrock SigV4 与它设的 Authorization 冲突）。
  - env-vars 表里有一句「Requires Claude Code v2.1.227 or later」，紧跟在非法字符校验之后，看不出是指变量本身还是指校验。
  - 2.1.251：「Changed `ANTHROPIC_CUSTOM_HEADERS` from managed or project settings to require approval when it sets a credential, org/tenant, routing, or API-behavior header (e.g. `Authorization`, `Host`)」，没提用户设置。
- 文档没提它能不能和 claude.ai 登录一起用。llm-gateway-protocol 说只靠它提供凭据时，Claude Code 跳过模型发现。
- 能不能用它让中转站认出调用方、又不占 `Authorization`：
  - Claude Code 这一侧可以。它会把自定义头和 OAuth 的 `Authorization` 一起发。【源码核实】
  - Osuna 这一侧现在不行（【源码核实】）：
    - `authenticate()` 只看 `Authorization` 和 `x-api-key`（`Osuna:gwy/gateway.ts:1111-1127`）；
    - 直通时请求头除逐跳头、`authorization`、`x-api-key` 等以外都会转发（`gwy/passthrough.ts:96-110`、`607-628`），所以新加的头会发到上游，除非也加进丢弃名单。
  - magpie 没用这个办法，见 1e。

### 1e. magpie 怎么认调用方、怎么处理上游 401/403

- 认调用方【源码核实】
  - 回环上不验 key。`magpie:internal/gateway/gateway.go:49-51`「The gateway only listens on loopback and accepts anything, but agents insist on one」，`const Token = "magpie"`；`magpie:internal/gateway/lan.go:499-500`「Loopback takes any token」。
  - 先看 key 是不是 `magpie-<agent>`（`TokenFor`，`gateway.go:56`），否则看 User-Agent（`agentOf`，`gateway.go:60-80`）。Claude Code 的 UA 关键词是 `claude-cli`、`claude-code`（`internal/agent/claude.go` 里 Agent 的 `UA` 字段）。
- 什么时候能选「保留 claude.ai 登录」【源码核实】
  - 只在网关收任意 key 的地方提供：`signInHere := func() bool { return at.gwKey() == gateway.Token }`（`magpie:internal/agent/claude.go:604-623`）。
  - 从局域网另一台机器、NAT 下的 WSL 共享访问时，只收共享 key（`magpie:internal/agent/gatewaykey.go:8-21`），这个选项不出现。
  - 选了就把 `ANTHROPIC_AUTH_TOKEN` 写空（`wiredKey`），选择存在 stash 里，断开和换端口都保留（`agent-wiring.md:74`）。
  - `Check` 会报两种情况（`claude.go:1985-2023`）：口令被手填回去；或者没选这个选项、口令却空了，此时 Claude Code 会把 claude.ai 登录发给 magpie。
- 网关怎么处理（【源码核实】`magpie:internal/gateway/claude_signin.go:1-130`）
  - `claudeSignIn`：`Authorization: Bearer sk-ant-oat…` 就是 claude.ai 登录。magpie 从不把它转给上游，转发时换成 provider 自己的凭证。
  - `keepsSignIn` 包在 `/v1/messages`、`/messages`、`/v1/messages/count_tokens` 外面（`gateway.go:647-653`）：
    - 上游 401，或 403 且正文含 `OAuth token has been revoked`，改成 502，`{"type":"error","error":{"type":"api_error","message":"<provider> refused magpie's credential (HTTP 401): …"}}`；
    - 其他错误保持状态码，只把正文里的 `x-api-key` 换成 `API key`，流开始后的 `event: error` 也换。
  - `askedBetas` 丢掉 `anthropic-beta` 里 `oauth-` 开头的 beta（`magpie:internal/gateway/betas.go:36-49`）。
  - 用量日志、Recent calls 里保留上游原始状态（`docs/subsystems/gateway-routing.md:105`）。
- 为什么这么做，Claude Code 那边【源码核实】
  - `ine()`：403 且含 `"OAuth token has been revoked"`，或 401 且含 `"OAuth access token has been revoked"`，判为令牌被吊销。
  - `i2t()`：错误消息含 `x-api-key` 一律判为认证失败，提示 `"Invalid API key"` 或 `"Not logged in · Please run /login"`（`rXt="Not logged in · Please run /login"`）。
  - 「401 时每次重试前都先续登录、共十次后要求 /login」是 magpie 注释所说（`claude_signin.go:13-24`，针对 2.1.293），没在 2.1.302 里核对次数。
- Osuna 现状：上游 401 原样回 401（差距清单 01·A38 记为 `gwy/passthrough.ts:328-351`），没有 502 改写。

---

## 2. 子代理与后台小模型

### 2a. Claude Code 现在用什么决定这两类模型

- 后台小任务（起标题、WebFetch 读页面这类「side query」）用 `VE()` 选模型。【源码核实】
  - 有 `ANTHROPIC_SMALL_FAST_MODEL` 就用它，排第一。
  - 否则判断「该不该用 haiku 档」：`lht()` = 设了 `ANTHROPIC_SMALL_FAST_MODEL` 或 `ANTHROPIC_DEFAULT_HAIKU_MODEL`，或 `dht()`（第一方且地址是 `api.anthropic.com`，或带真正的 Anthropic API key；或 Anthropic 自家云），或 Cloud gateway 认得 haiku 档。
  - 不该用时，返回主模型 `et()`。Bedrock、Vertex 另有特例。
  - 该用时，有 `ANTHROPIC_DEFAULT_HAIKU_MODEL` 就用它，否则用内置 haiku 档 id。
  - 【文档所说】CHANGELOG 2.1.141：「Fixed background side-queries sending an unavailable Haiku model ID on Bedrock/Vertex/Foundry/gateway when no `ANTHROPIC_SMALL_FAST_MODEL` override is set — now falls back to the main-loop model」。
- `ANTHROPIC_SMALL_FAST_MODEL`：文档标为弃用，代码里仍按最高优先级读。
  - 【源码核实】它仍排第一位读；二进制里搜不到它和 deprecated 连在一起的文案；3P 模型升级里 haiku 档的环境变量顺序是 `["ANTHROPIC_SMALL_FAST_MODEL","ANTHROPIC_DEFAULT_HAIKU_MODEL"]`。
  - 【文档所说】model-config：「Note: `ANTHROPIC_SMALL_FAST_MODEL` is deprecated in favor of `ANTHROPIC_DEFAULT_HAIKU_MODEL`.」没写从哪个版本起。
- 【文档所说】llm-gateway-protocol 的表里，`ANTHROPIC_BASE_URL` 网关下后台任务的模型是：「The main model, or the default Haiku model when `ANTHROPIC_API_KEY` or `apiKeyHelper` supplies an Anthropic Console key and `ANTHROPIC_AUTH_TOKEN` is unset」（未用 `ANTHROPIC_DEFAULT_HAIKU_MODEL` 指定时）。与源码一致。
- 【文档所说】sub-agents：
  - 子代理模型的解析顺序：「1. per-invocation `model` 2. frontmatter `model` (`inherit` …) 3. `CLAUDE_CODE_SUBAGENT_MODEL` 4. The main conversation's model」；
  - 「Setting `CLAUDE_CODE_SUBAGENT_MODEL` by itself doesn't change the model the built-in Explore and Plan subagents run on」；
  - 强度可以用 frontmatter 的 `effort`，或按次传入的 `effort`（v2.1.292+）。
- 子代理【源码核实】
  - `gse()` 取 `CLAUDE_CODE_SUBAGENT_MODEL`，没设或为 `inherit` 就跟主模型。
  - Agent 定义里的 `model:` 和派生时显式给的模型优先于它。【文档所说】CHANGELOG 2.1.251；SDK 字段说明原文：「If omitted, uses the default subagent model when one is configured, else the parent's model」。
  - `CLAUDE_CODE_SUBAGENT_MODEL_FORCE`（CHANGELOG 2.1.257）让所有子代理都用它。
  - 另有 `CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL`、`CLAUDE_CODE_AUTO_MODE_MODEL`（2.1.302 新增，客户端自动模式分类器用的模型）、`CLAUDE_CODE_BG_CLASSIFIER_MODEL`，只看到名字。
- 内置 Agent 的模型（【源码核实】2.1.302）：
  - Explore：`model:"inherit"`。主模型的系列高于 opus 时上限压到 opus，第三方提供方或设了 `CLAUDE_CODE_DISABLE_EXPLORE_INHERIT_CAP` 时不压。magpie 注释里「Explore 用 Haiku」是旧版行为。【文档所说】sub-agents：「Model: the main conversation's model. When the main conversation runs Fable … With a Claude subscription, an Anthropic Console account, or an LLM gateway … Explore runs on the Opus model」。
  - Plan：`inherit`。
  - general-purpose：不指定。
  - statusline-setup：`"sonnet"`。
- 强度
  - 派生子代理时可以带 `effort`，取值是 `"lower"`、`"higher"` 或各档名。【源码核实】
  - Claude Code 不认 `模型:强度` 这种写法。【推断，未核实】没找到解析它的代码。
  - magpie 的「子代理可带强度」是它自己的约定：写成 `<model>:<level>`，由 magpie 网关替它改强度（`magpie:internal/agent/claude.go:514-520` 注释、`1741-1838`）。

### 2b. 都不设时经过 Osuna 中转站会发什么模型名，Osuna 怎么处理

- Osuna 接管时删掉 `ANTHROPIC_SMALL_FAST_MODEL` 和四个 `ANTHROPIC_DEFAULT_*_MODEL`（`Osuna:ae/claude-settings-patch.ts:27-31,247-249`），并写入自定义地址和口令。【源码核实】
- 于是在 Claude Code 里（【源码核实】由 2a 推出）：
  - `lht()` 为假，后台小任务用主模型，也就是 Osuna 写的顶层 `model`（裸模型 id，可能带 `[1m]`），或用户后来在 `/model` 里选的（列表里是 `slug/模型`）；
  - 子代理默认跟主模型；
  - 只有指定档位名的地方才发内置的 Claude id：statusline-setup Agent（`sonnet`），用户自定义 Agent 写 `model: haiku/opus/…`，`/model opus` 这类别名。
- 内置档位名指向的 id 来自 2.1.302 的内置目录。【源码核实】片段：
  - `aliases:{opus:{default:"claude-opus-5-5",…},sonnet:{default:"claude-sonnet-5-5",…},haiku:{default:"claude-haiku-5-5",…},fable:{default:"claude-fable-5-1",…}}`；
  - 另一处 `provider_alias_targets` 里 haiku 是 `claude-haiku-4-5-20251001`；
  - haiku 档函数的兜底是 `e.haiku45`。
  - 具体发哪个没逐步追。
- Osuna 中转站按这个顺序找（`Osuna:gwy/routing.ts:12-22,113-146`）：【源码核实】
  1. `slug/模型名` 直达；
  2. 整个名字是某家已选的模型；
  3. 斜杠后的裸名；
  4. `sameModel` 归一后同名；
  5. 只对 claude：名字里独立出现 `opus|sonnet|haiku|fable`（`claudeTierOf`，`routing.ts:33-41`），就用第一家开着且配了该档映射（`modelMapping[tier]`）的接口；
  6. 都不中就回 404：`No enabled API endpoint offers the model "…"; did you mean …?`（`routing.ts:148-153`；`gateway.ts:270-272`）。
  - 所以接口都没配档位映射时，带档位的内置 id 会报模型不存在，除非某家恰好选了同名模型。
- 和文档不一致处：ADR 0007 的 Consequences 写「an endpoint without a mapping gets the tier name as the model id」，与现行代码（返回 404）不符。【源码核实】

### 2c. Codex 侧（03·C06–C10）

**`[agents]` 段：默认子代理模型与强度**

- 键有（`codex:codex-rs/config/src/config_toml.rs:758-805`）【源码核实】：
  - `enabled`；
  - `max_concurrent_threads_per_session`（别名 `max_threads`）；
  - `max_depth`（「Ignored by V2」）；
  - `default_subagent_model`、`default_subagent_reasoning_effort`，注释是「when the spawn call does not select one」；
  - `interrupt_message`；
  - `job_max_runtime_seconds`（已不起作用）；
  - `[agents.<角色>]` 角色表。
  - 默认值：`enabled` 为 true，`max_depth` 为 1，V1 线程上限 6（`codex-rs/core/src/config/mod.rs:4013-4045`）。
- 两个 default 都没设时，子代理继承主代理当前这一步的模型和有效强度（`codex-rs/core/src/agent/child_config.rs:110-122`）。有效强度 = 已选强度，否则用模型的 `default_reasoning_level`（`session/step_settings.rs:85-89`）。【源码核实】
- 优先级（`child_config.rs`）【源码核实】：
  - spawn 参数 ＞ `[agents]` 默认 ＞ 继承（`:212-214`）；
  - 只给模型不给强度时，用该模型自己的默认档，不用父代理的（`:244-246`）；
  - 强度要过校验（`:353-373`），失败报「Reasoning effort `{x}` is not supported for model `{m}`…」；
  - 角色的 `config_file` 还能再覆盖（`:71-83,291-324`）。
- 主代理能不能自己给子代理指定模型和强度：能。【源码核实】
  - `spawn_agent` 有 `model`、`reasoning_effort` 参数（`codex-rs/core/src/tools/handlers/multi_agents_spec.rs:633-645`（V1）、`670-682`（V2））。
  - 描述写的是「Do not set the `model` field unless the user explicitly asks for a different model.」（`:736`）。
  - V2 下是否暴露这两个参数由 `[features.multi_agent_v2] expose_spawn_agent_model_overrides` 控制，默认 true（`config/mod.rs:1410`）。

**`spawn_agent` 只告诉主代理前 5 个模型**【源码核实】

- `MAX_SPAWN_AGENT_MODEL_OVERRIDES = 5`（`child_config.rs:21`）只限制三处「列出来」的数量：
  1. 工具描述「Available model overrides (optional; inherited parent model is preferred):」只列前 5 个 `show_in_picker` 的模型（`multi_agents_spec.rs:822-831,884-886`）；
  2. 开了 `model_catalog_in_context` 时，上下文里的模型目录也只放 5 个，另有 1000 字节上限（`context/world_state/model_catalog.rs:23,35-46`）；
  3. 找不到模型时，报错里列的可选模型。
- 实际接受的范围更大：`find_spawn_agent_model_name` 在整个模型目录里按名字精确匹配，隐藏的模型也收（`child_config.rs:326-337`；`codex-rs/protocol/src/openai_models.rs:982,1025-1030`）。目录外的名字报「Unknown model `{x}` for spawn_agent. Available models: …」。
- `default_subagent_model` 走同一套校验。所以填了不在目录里的模型，每次没指定模型的 spawn 都会失败。【推断，未核实】

**magpie 的写法**【源码核实】`magpie:internal/agent/codex.go`

- 写顶层 `[agents]`，不写 profile：
  - `default_subagent_model`（`:1362-1370`）；
  - `default_subagent_reasoning_effort`（`:1412-1417`）；
  - 换模型时删掉新模型不支持的子代理强度（`:735-744`）；
  - 断开时，值是 magpie 的模型就删（`:703-719`）。
- 「subagent model」（统一模型）不写 Codex 配置，由网关把子代理请求改到指定模型（`:1374-1403`；`docs/subsystems/agent-wiring.md:82`）。
- 网关补全 `spawn_agent` 的模型列表（`magpie:internal/gateway/codex_spawn_models.go`）：
  - 只处理同时含 `spawn_agent` 和「Available model overrides」的请求体（`:47`）；
  - 在 `tools`（含 namespace 内层）和 `tool_search_output.tools` 里找这个工具（`:69-121`）；
  - 在 Codex 自己那段列表后面补一段「More models that may be set as `model`:」，最多 200 个（`:38,167-190`）；
  - V2 且由 ChatGPT 后端应答的主代理，只给 ChatGPT 账号的模型（`:194-242`）。

**`[memories]` 段：记忆提炼与整理的模型**

- 键有：`version`、`dual_write`、`disable_on_external_context`（别名 `no_memories_if_mcp_or_web_search`）、`generate_memories`、`use_memories`、`dedicated_tools`、一组上限值、`extract_model`（「Model used for thread summarisation.」）、`consolidation_model`（「Model used for memory consolidation.」）（`codex-rs/config/src/types.rs:320-355`）。【源码核实】
- 默认值【源码核实】：
  - `extract_model` = `gpt-5.6-luna`，强度 low；`consolidation_model` = `gpt-5.6-terra`，强度 medium。
  - 出处：`codex-rs/model-provider/src/provider.rs:97,101`；`codex-rs/memories/write/src/phase1.rs:162-167`、`phase2.rs:344-351`、`lib.rs:81-82,105-106`。
- 要 `[features] memories = true` 才运行，默认关（`codex-rs/features/src/lib.rs:1291-1296`）；临时会话、非根代理跳过（`memories/write/src/start.rs:33-38`）。【源码核实】
- 记忆请求走会话的 `model_provider`（`runtime.rs:146-147`）。【源码核实】
- 所以第三方 provider 下不设这两个键时，会把 `gpt-5.6-luna/terra` 这两个名字发给第三方（经 Osuna 就是发给中转站）。【推断，未核实】
- magpie 把两个键写成同一个值（`codex.go:1438-1442`），选默认时两个都删（`:1432-1434`），不碰 feature 开关。【源码核实】

**`multi_agent_v2` 压住设置时只提示**

- 它是什么【源码核实】
  - `[features]` 下的开关，可写布尔值或 `[features.multi_agent_v2]` 表（要写 `enabled`），默认关（`features/src/lib.rs:1487-1492`）。
  - 打开后新线程一律用 V2（`core/config/mod.rs:1641-1649,1661-1668`）。它盖过模型目录条目里的 `multi_agent_version`，也盖过 `[agents] enabled = false`。每个线程定下后不再变（`session/mod.rs:4416-4428`）。
- 「压住」的具体含义：magpie 的「子代理可用任意模型」靠把模型目录里的条目写成 `multi_agent_version = "v1"` 来生效，V2 开关一开就不起作用。【源码核实】
- V2 下的其他影响【源码核实】
  - `max_depth` 被忽略；
  - `default_subagent_*` 照样生效（`thread_spawn.rs:85-95`）；
  - 标了 disabled 的模型不能当子代理模型；
  - message 参数标了 encrypted（`multi_agents_spec.rs:651-657`）。
  - magpie 注释说 V2 任务被 OpenAI 服务端「封存」，非 ChatGPT 模型的子代理读不到（`magpie:internal/settings/settings.go:404-414`）。只是 magpie 所说，Codex 源码里只看到 encrypted 标记。
- 提交 `81b7016e`「codex: warn, not write, when Codex's own multi_agent_v2 holds off magpie's V1 (#1028)」【源码核实】
  - 什么时候检查：magpie 的 V1 设置开着、且 Codex 经 magpie 路由时（`codex.go:162-174`）。
  - 怎么判断：读整份 config.toml，看顶层 `[features] multi_agent_v2 = true` 或 `[features.multi_agent_v2] enabled = true`，表、内联、点号三种写法都认（`:100-155`）；旧式 `profile` 的 features 会覆盖顶层。
  - 从不写 Codex 配置（`:83-86`）。
- 提示原文（`codex.go:88-89`；`i18n.js:1006-1007`）：

| 情况 | 英文 | 中文 |
|---|---|---|
| V2 开着 | Codex's own multi_agent_v2 is on in the config magpie routes, which takes over the multi-agent V1 magpie's models ask for; turn it off in Codex's config to run subagents on magpie's models. | Codex 自身的 multi_agent_v2 在 magpie 接管的配置里开着，会盖过 magpie 模型所需的 multi-agent V1；请在 Codex 的配置里把它关掉，才能让子代理跑在 magpie 的模型上。 |
| 读不到配置 | Codex's multi-agent V1 is on, but magpie couldn't read Codex's config to check its own multi_agent_v2. | Codex 的 multi-agent V1 已开启，但 magpie 读不到 Codex 的配置，无法确认它自己的 multi_agent_v2。 |

  - 提示出现在三处：Agent 行的 Notice、设置页、设置行下方的红字。切换开关时还会弹一条 9 秒的警告。

**Osuna**：`ae/` 里搜 `default_subagent_model`、`extract_model`、`consolidation_model`、`multi_agent_v2` 都无命中（差距清单 03·C06–C10）。

---

## 3. 新会话的推理强度

### Claude Code 2.1.302

【源码核实】

- `effortLevel`（settings.json）
  - 只收 `low|medium|high|xhigh`（`function _ve(e){if(e==="low"||…||e==="xhigh")return e;return}`），`max` 存不进去。
  - 用户设置顶层的 `effortLevel` 是「旧写法」：只对一份较早的 Claude 模型名单生效（到 `claude-opus-5`、`claude-fable-5`、`claude-fable-5-1`、`claude-mythos-5`、`claude-mythos-5-1` 为止），以及 Claude Code 不认识的模型。经中转站的第三方模型属于后者。
  - 较新的 Claude 模型只读 `modelSettings.<规范化模型 id>.effortLevel`。
  - 项目、本地、托管设置里的 `effortLevel` 对所有模型生效。
- `/effort <档位>` 默认存成默认值
  - `P(e,t,o=!0,…)` 把 `asDefault` 默认设为真，`jX` 写 `On("userSettings",{modelSettings:{[模型]:{effortLevel}}})`；只有模型 id 撞上 Object 原型属性时才写顶层。
  - 提示文案 `" (saved as your default for new sessions)"` / `" (this session only)"`。`max` 只对本会话。
  - `/model` 选模型时顺带选的强度，随「存为默认」一起存。
- `CLAUDE_CODE_EFFORT_LEVEL`
  - 收 `low|medium|high|xhigh|max` 或数字，`auto`/`unset` 等于没设（`Cx()`）。
  - 盖过设置文件和 `/effort`：`"CLAUDE_CODE_EFFORT_LEVEL=${x} overrides this session"`。
- ultracode
  - 设置键是 `ultracode: true`（`ut().ultracode===!0`）。【文档所说】CHANGELOG 2.1.284 改成 `/effort` 里的独立开关，不再强制 xhigh。
  - 能否打开取决于两点：要开着 dynamic workflows；模型要支持 xhigh，否则提示 `"Ultracode isn't available on ${model}"`。详见第 7 题。
- 【文档所说】
  - settings-reference：用户设置里的顶层 `effortLevel`，「Opus 5.5 and models released after it ignore it」。
  - model-config：「`max` isn't accepted as a level in either key, and `ultracode` has its own `ultracode` key」；「Unless you set it through the `CLAUDE_CODE_EFFORT_LEVEL` environment variable, Claude Code applies `max` to the current session only.」
  - settings-reference 的 `ultracode`：「Claude Code reads this key but never writes it」。
  - 有 `maxEffortLevel` 设置可以封顶（CHANGELOG 2.1.267）。

### magpie

【源码核实】

- 强度字段（`magpie:internal/agent/claude.go:1584-1660`）
  - 同时写顶层 `effortLevel` 和 `modelSettings.<claudeName>.effortLevel`（后者只对 Claude 模型）。
  - `max` 写进 `env.CLAUDE_CODE_EFFORT_LEVEL`。
  - 改了以后给正在跑的会话一句提示：「an open Claude Code session keeps the effort it started with — restart it to use this.」（`claude.go:2478`）。
- ultracode 字段（`claude.go:1661-1694`）：只在模型支持 xhigh 时写 `ultracode: true`。
- 四个档位和子代理各自的强度是 magpie 自己的约定，由网关执行（见 2a）。
- Codex 的写法见下面「Codex」。

### Codex

【源码核实】

- `model_reasoning_effort` 是顶层键（`codex:codex-rs/config/src/config_toml.rs:398-402`）。
  - 取值 none / minimal / low / medium / high / xhigh / max / ultra / persistent；其他非空字符串当自定义值收下，空串报错（`codex-rs/protocol/src/openai_models.rs:62-75,143-160`）。
  - 没设时用模型的 `default_reasoning_level`（`session/step_settings.rs:85-89`）。
  - 换模型时，当前档位新模型不支持的话，改成它支持列表里中间那档（`session/turn_context.rs:770-800`）。
  - 相关的独立键：`plan_mode_reasoning_effort`（Plan 模式单独的强度）、`model_reasoning_summary`、`model_verbosity`。
- profile：现在 config.toml 里的旧式 profile 已不再支持。
  - 顶层 `profile = "x"` 直接报错：「legacy `profile = "{profile}"` config is no longer supported; use `--profile {profile}` with `{profile}.config.toml` instead」（`core/config/mod.rs:3473-3480`）。
  - 新 profile 是 `$CODEX_HOME/<name>.config.toml`，用 `--profile` 叠加在 config.toml 上（`config/src/loader/mod.rs:131,290-338`）。
- magpie（`magpie:internal/agent/codex.go:1323-1347`）：
  - 写顶层（`:1337`），选默认就删（`:1335`）；
  - 换模型后，档位不被支持时改到最近一档（`settle`，`:370-387`）；
  - 接管时存原值，断开时写回（`:966-967,918-920`）。
- Osuna：
  - `readCodexReasoningEffort` 只读顶层值（`ae/codex-config-patch.ts:181-188`）。唯一调用方是生成模型目录（`ae/service.ts:1080-1091`），把每个条目的 `default_reasoning_level` 设成 low/medium/high/xhigh 里最近的一档：一样近取高，认不出的取 medium（`ae/codex-model-catalog.ts:39-79`）。
  - Osuna 自己的 Codex 会话经 app-server 的 `config/read` 读这个键，当作默认思考档，也只读（`packages/server/src/server/agent/providers/codex-app-server-agent.ts:3199-3237`）。

### Osuna

【源码核实】

- Claude Code 这三项都不写：`ae/` 里搜 `effortLevel`、`EFFORT_LEVEL`、`ultracode` 只命中网关拒绝判定的正则。
- Codex 只读顶层 `model_reasoning_effort`（`Osuna:ae/codex-config-patch.ts:181-188`），用来定模型目录里每个模型的默认档（`ae/service.ts:1080-1091`），不写。
- Osuna 自己跑的会话在输入框里按会话选思考档位，与终端新会话的起始强度无关（差距清单 03·B06）。

---

## 4. 云厂商开关与 managed-settings

### 会不会绕过 `ANTHROPIC_BASE_URL`

会。【源码核实】

- 提供方：`Pe()` 是 `gateway`（Cloud gateway）＞ `CLAUDE_CODE_USE_BEDROCK` ＞ `_FOUNDRY` ＞ `_ANTHROPIC_AWS` ＞ `_ANTHROPIC_GOOGLE_CLOUD` ＞ `_MANTLE` ＞ `_VERTEX` ＞ `firstParty`。
- 每家云有自己的地址变量：`ANTHROPIC_BEDROCK_BASE_URL`、`ANTHROPIC_VERTEX_BASE_URL`、`ANTHROPIC_FOUNDRY_BASE_URL`、`ANTHROPIC_AWS_BASE_URL`、`ANTHROPIC_GOOGLE_CLOUD_BASE_URL`、`ANTHROPIC_BEDROCK_MANTLE_BASE_URL`。
- 只有 `firstParty` 才用 `ANTHROPIC_BASE_URL`：`case"firstParty":return process.env.ANTHROPIC_BASE_URL||ln().BASE_API_URL`。
- 开关值的解析：Claude Code 里有 `n==="1"||n==="true"||n==="yes"||n==="on"` 这样的布尔解析函数（`an()`）；magpie 记 2.1.300 认 1/true/yes/on（`magpie:internal/agent/claude.go:82-95`）。开关具体是不是走这个函数【推断，未核实】。

### 写在不同地方时谁优先

`applyConfigEnvironmentVariables()` 依次把下面几层赋给 `process.env`，后面的盖前面的。【源码核实】

1. 启动时的进程环境（shell）；
2. `~/.claude.json` 的 `env`：`appliedGlobalConfigEnv=this.filterSettingsEnv(this.getLegacyEnvMap(),"globalConfig")`；
3. 各设置来源，按 `Ps=["userSettings","projectSettings","localSettings","flagSettings","policySettings"]`。

结果：托管 ＞ `--settings` ＞ 本地 ＞ 项目 ＞ 用户 settings.json ＞ `~/.claude.json` ＞ shell。

- 工作区信任之前走 `applySafeConfigEnvironmentVariables`，项目和本地层另有规则；`filterSettingsEnv` 会过滤个别键。这两点没细读。
- magpie 的描述一致：`magpie:internal/agent/claude.go:105-112`「Claude Code puts the env of .claude.json, then of the user's settings, then of an administrator's managed settings over the environment it was started in」。
- 【文档所说】
  - env-vars：「When the same variable is set in both your shell and a settings file `env` block, the settings file value applies in most sessions.」例外是 Claude Desktop 或自托管 runner 启动的会话，以启动环境为准（settings-reference）。
  - 「a managed settings entry overrides the same variable in user or project settings」；llm-gateway-rollout：「A managed `ANTHROPIC_BASE_URL` is enforced and cannot be overridden by a developer's shell export」。
  - 托管来源之间：服务器下发 ＞ MDM（plist/HKLM）＞ 文件 ＞ HKCU；托管的 `env` 跨来源按变量合并（v2.1.223+）。
- 文档与源码的分歧：`~/.claude.json` 的 `env`。
  - 文档只说「`permissions`, `hooks`, and `env` belong in `~/.claude/settings.json`」（debug-your-config），没明说 `~/.claude.json` 里的 `env` 被忽略。
  - 2.1.302 源码仍在应用它，变量名叫 legacy（`legacyEnvMapAtLaunch??={...ue().env}`）。【源码核实】
- 【文档所说】env-vars 的 `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST`：由嵌入 Claude Code 的宿主设置，「ignores provider-selection, endpoint, and authentication variables such as `CLAUDE_CODE_USE_BEDROCK`, `ANTHROPIC_BASE_URL`, and `ANTHROPIC_API_KEY` in settings files」。
- 【文档所说】云厂商开关与 `ANTHROPIC_BASE_URL`：
  - llm-gateway-connect：各家用「a provider-specific base URL variable in place of `ANTHROPIC_BASE_URL`」；
  - 设了任何 `CLAUDE_CODE_USE_*` 时，即使也设了 `ANTHROPIC_BASE_URL`，也不做模型发现；
  - 文档没明说此时 `ANTHROPIC_BASE_URL` 被忽略，这一点由源码证实（见上）。
- 托管设置里的 `env.ANTHROPIC_BASE_URL` 盖过用户 settings.json，因为托管层最后应用。【源码核实】
- 托管文件解析不了时：`"Managed settings document could not be parsed as a JSON object; none of its settings are in effect. Fix or remove it."`（不可由用户改的文件标 `startupFatal`）。【源码核实】

### managed-settings 的路径（CC 2.1.302）

【源码核实】`KE()`；文件是 `managed-settings.json`，另有同目录下的 drop-in 目录 `managed-settings.d/`。

| 系统 | 目录 |
|---|---|
| macOS | `/Library/Application Support/ClaudeCode` |
| Windows | `C:\Program Files\ClaudeCode` |
| Linux / WSL | `/etc/claude-code` |

- 二进制里还有 MDM 配置描述文件、Windows HKLM 注册表、服务器下发的托管设置（都算 policySettings），这些只看到名字和文案。
- 文档写的三个目录与源码一致（managed-settings 页面原文：「`/Library/Application Support/ClaudeCode/` on macOS, `/etc/claude-code/` on Linux and WSL, and `C:\Program Files\ClaudeCode\` on Windows」）。【文档所说】
- magpie 在 Windows 上用 `C:\ProgramData\ClaudeCode\managed-settings.json`（`magpie:internal/agent/claude.go:2389-2397`），和 2.1.302 的 `C:\Program Files\ClaudeCode` 不同。2.1.302 二进制里搜不到 `ProgramData\ClaudeCode`。

### magpie 怎么处理

【源码核实】

- 接入时拿掉开着的开关，断开时放回（`magpie:internal/agent/claude.go:1250-1289`，`dropClouds` / `putClouds`）。
  - 只处理 settings.json 里**开着**的开关，原样存进 stash（字符串或 JSON 的 true）。
  - 断开时放回，用户之后又自己设了的除外。
  - 云的其他变量（`AWS_*`、`ANTHROPIC_VERTEX_PROJECT_ID`…）不动；关着的开关不动。
  - 每次写接入（`writeTiers`）和每次 `Sync` 都会做（`claude.go:1468`、`1914`）；断开时 `unroute` 里放回（`1313`）。
- 写不到的地方只提示（`claudeCloud`，`claude.go:105-145`）。
  - 依次看托管设置、用户 settings.json、`~/.claude.json`，再看登录 shell 的环境（WSL 发行版里不看）。项目的 `.claude/settings.json` 不看。
  - 提示原文（`claude.go:2484-2485`）：
    - 「{file} sets {var}, so Claude Code sends its requests to {cloud}, not to magpie: take it out there to go through magpie.」
    - 「{var} is set in your shell's environment, so Claude Code started there sends its requests to {cloud}, not to magpie: take it out of your shell's profile to go through magpie.」
- 托管设置里的地址（`Check`，`claude.go:1985-1994`）：托管的 `env.ANTHROPIC_BASE_URL` 不是 magpie、也不通向 magpie（`reachesMagpie`）时报「Claude Code's managed settings (…) set ANTHROPIC_BASE_URL to …, which wins over magpie's」。
- Claude Desktop 的 Code 页带 `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST` 运行，magpie 说这时 Claude Code 不理设置文件里的开关（`agent-wiring.md:73`）。【未核实】

### Osuna

`ae/`、`app/api-endpoints` 里搜 `CLAUDE_CODE_USE_`、`managed-settings` 无命中。【源码核实】

---

## 5. 带点的版本号

### Claude Code 怎么认错

【源码核实】CC 2.1.302 的规范化模型名函数（调用链 `Fb()` → `HL()`）分三步：

1. 查内置目录的 provider id。
2. 结构化解析 `yc()`。它要求版本号后面的部分以 `-` 或 `@` 开头（`if(o!==""&&!/^[-@]/.test(o))return null`），所以 `claude-opus-4.6` 解析失败。
3. 按子串依次比较：`includes("claude-opus-4-6")` 对不上，接着 `/claude-opus-4(?!-\d(?!\d))/` 命中，结果是 `claude-opus-4-0`，即 Opus 4。

同理（【源码核实】）：

| 写法 | 被认成 |
|---|---|
| `claude-sonnet-4.6` | `claude-sonnet-4-0` |
| `claude-opus-5.5` | `claude-opus-5` |
| `claude-fable-5.1` | `claude-fable-5` |
| `claude-mythos-5.1` | `claude-mythos-5` |
| `claude-haiku-4.5` | 什么都不是，按未知模型处理 |

被认成 Opus 4 的后果，看内置目录两条记录的差别。【源码核实】

| 项 | `claude-opus-4-0`（Opus 4） | `claude-opus-4-6` |
|---|---|---|
| 上下文 | 200000 | 200000，可带 `[1m]` |
| 回复上限（default/upper） | 32000 / 32000 | 64000 / 128000 |
| 价格档 | `tier_15_75` | `tier_5_25` |
| 能力 | 只有 `context_management`，没有 effort、max_effort、自适应思考 | `effort,max_effort,adaptive_thinking,context_management` |
| 显示名 | 「Opus 4」 | 「Opus 4.6」 |

- 判断 xhigh 支持的函数对 `claude-opus-4-0` 直接返回假，所以 Ultracode 也不可用。
- magpie 记的现象：「a retired warning, budget thinking, 32000 output tokens, no effort」（`magpie:internal/provider/claudedash.go:9-19`，2.1.296；`docs/subsystems/agent-wiring.md:80`）。其中 32000 和没有档位与上表一致；「budget thinking」与目录里没有 `adaptive_thinking` 相符；「退役警告」没逐字核对。CHANGELOG 2.1.68 写过「Removed Opus 4 and 4.1 from Claude Code on the first-party API」。
- 用 `opus` 这类别名、经 `ANTHROPIC_DEFAULT_OPUS_MODEL` 指到带点的 id 也一样，magpie 是这么说的；规范化函数对任何来源的 id 都一样处理。

### Osuna 写进去的名字会不会带点

会，按接口列出的原样写，不改写。【源码核实】

- 顶层 `model` = 默认模型 id 原样，已知百万上下文时加 `[1m]`（`Osuna:ae/service.ts:708-735`、`ae/claude-model-hints.ts:37-39`）。
- `modelPicker` 每行是 `<slug>/<模型 id>`（`ae/host-endpoints.ts:79-95`）。
- 接口列的是带点的 id 时，就原样写进去。哪些上游会用带点的 id（例如 OpenRouter 风格的 `anthropic/claude-opus-4.6`）没逐家核实。【推断】
- 能力提示不管 Claude 名字的模型：`CLAUDE_CODE_MODEL_CAPABILITIES` 等跳过以 `claude` 开头的模型（`ae/claude-model-hints.ts:60,109-112`）。
  - 另外，Claude Code 查能力时先看这个环境变量再看目录（`N_(e,t,r){return y_t(t,e)??epn(e,t,r)}`），能覆盖 effort 一类能力；回复上限和上下文窗口另有变量。【源码核实】
- Osuna 中转站已经能把连字符写法认回带点写法：`sameModel` 把数字之间的点改成连字符再比较，`listedAs` 发给上游时换回这家自己的写法（`Osuna:gwy/routing.ts:66-84,103-111`）。【源码核实】

### magpie

【源码核实】`magpie:internal/provider/claudedash.go:21-130`。

- `ClaudeSpelled`：只有连字符写法能唯一对回一个在售 id 时，才把带点的 Claude 版本写成连字符。覆盖 `model`、四档变量、`ANTHROPIC_SMALL_FAST_MODEL`、`CLAUDE_CODE_SUBAGENT_MODEL`、`modelPicker`。
- `ClaudeRead`：读回时还原。`ClaudeUndashed`：网关把连字符写法换回在售 id。
- 别家的 id 一律不改；用户自己的值存起来原样放回。

---

## 6. `CLAUDE_CODE_AUTO_MODE_SERVER=0`

### 它是什么

自动模式（auto mode）每个动作都要经分类器判断。这个变量决定要不要请 API 端（Anthropic 服务器）来做这个审查。【源码核实】

- 读法：没设为 `null`，设了按布尔读（`KWe()`）。
- 什么算「第三方」（`b8()`）：
  - 第一方提供方但地址不是 `api.anthropic.com` → `thirdParty`；
  - Bedrock、Vertex、Foundry、Anthropic AWS/Google Cloud、Mantle、Cloud gateway 也都是 `thirdParty`。
  - 所以经 Osuna 中转站属于第三方。
- 第三方时（`Rv()`）：
  - `eHt()` 为真就是 `"arbiterWithLocalFallback"`（先请服务器审查，拿不到结论再在本地分类）；否则 `"off"`（只在本地分类）。
  - `eHt()` = `KWe() ?? !(CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS && !CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST)`，默认为真。
  - 设成 `0` 就是 `"off"`。
- 直连 Anthropic 时 `0` 退出、`1` 加入。【文档所说】CHANGELOG：
  - 2.1.273：Bedrock/Vertex/Foundry 默认本地，`=1` 加入；
  - 2.1.278：「Changed auto mode for Claude API and Enterprise users, and on Bedrock, Vertex, Foundry and gateways, to default to the server-side classifier, which does not charge for classifier overhead (`CLAUDE_CODE_AUTO_MODE_SERVER=0` opts out on Bedrock, Vertex, Foundry and gateways); warns on billed fallback」；
  - 2.1.281：直连 API 也认 `0` / `1`。
- 服务器审查怎么请求：请求带 `dangerous-tool-use-…` beta 和请求体里的 `safeguards` 字段，回复里带 `safeguard_results`（`magpie:internal/gateway/automode.go:12-35`）。Osuna 也认得这个 beta 前缀（`Osuna:gwy/claude-code-fields.ts:25-26`）。
- 【文档所说】
  - env-vars：「Controls whether Claude Code asks the server to review auto mode actions. Set to `0` to use Claude Code's own classifier requests instead … Requires Claude Code v2.1.271 or later」。
  - permission-modes：指向 LLM 网关或代理时默认请服务器审查（v2.1.278+）。
  - auto-mode-classifier-billing：
    - 网关要做到「forwarding request headers and body fields as they are, including … the `safeguards` request field, and returning responses and streaming events without dropping keys such as the `safeguard_results` field or rewriting tool-use IDs」；
    - 「If you already know that your gateway can't provide the server's checks … setting `CLAUDE_CODE_AUTO_MODE_SERVER` to `0`」；
    - 「Pro, Max, and Team plans never show the notice.」；
    - 「`CLAUDE_CODE_AUTO_MODE_SERVER` is a temporary setting and may be removed in a later release.」；
    - `/status` 有「Auto mode server」一行。

### 不写会怎样（经中转站、模型不是 Claude）

1. 服务器审查拿不到结论。Osuna 直通给非 Claude 模型时去掉审查 beta 和 `safeguards`（`gwy/passthrough.ts:142,497,607-628`，`gwy/refused-fields.ts:141-143`），上游不会回 `safeguard_results`。【源码核实】翻译到别的协议时这两样本来就带不过去。【推断】
2. 于是转回本地分类，并设置「第三方服务器分类被拒」的标记。这个标记加上 `$Dn()` 为真时，会弹出提示。【源码核实】提示原文：
   - 标题：「We're changing auto mode to no longer charge for classifier requests in Claude Code.」
   - 「However, this session isn't eligible because your requests go through `<host>`, which isn't compatible with this update.」
   - 「Nothing breaks: auto mode keeps working, and its classifier requests are billed as before.」
   - 「To fix it and access the new version of auto mode, ask your gateway to implement: https://code.claude.com/docs/en/auto-mode-classifier-billing」
3. 谁看得到提示（`$Dn()`）：Pro/Max/Team 订阅不弹；能识别出网关主机时，确认后 24 小时（`L6r=86400000`）再弹。【源码核实】
4. 本地分类器的请求用会话的模型（2.1.302 起可用 `CLAUDE_CODE_AUTO_MODE_MODEL` 另选），经中转站发给接口，由接口计费。【源码核实（变量）+ 推断（计费归属）】

设成 0 时（【源码核实】）：

- 第三方模式直接是 `"off"`，不请求服务器审查，不会设上面的标记，也就不弹提示。
- 请求里不再带审查 beta 和 `safeguards`。这一点据 magpie 注释（`automode.go:12-30`：「Behind a gateway, its first requests ask the API to do it」），没在 CC 源码里核对请求体。

### magpie 为什么写

【源码核实】

- 规则（`magpie:internal/agent/claude.go:283-292` 注释，`1020-1053` 代码）：只要经 magpie 能到的模型里没有一个会被 Anthropic 审查，就写 `"0"`。「能到的模型」包括 Claude Code 列表里的、路由组成员、provider 的兜底、当前设的；只要有一个会被审查就不写。
- 「会被审查」的判断（`AutoModeReviewed`，`magpie:internal/gateway/automode.go:77-79`）：magpie 里的 Claude 订阅账号，或模型名是 Claude 的，或 provider 地址是 `api.anthropic.com`。
- 理由（`agent-wiring.md:75`）：「Off, it classifies locally from the start, as it does anyway behind a gateway that doesn't answer, without the "isn't eligible because your requests go through 127.0.0.1:3425" notice」。
- 每次设模型和 `Sync` 都重算；用户自己写的不碰；从 magpie 断开时删掉。

### Osuna

不写（`ae/` 搜 `AUTO_MODE_SERVER` 无命中）。【源码核实】

---

## 7. magpie 提交 `d1c485f7` 与 Osuna 的档位报法

### d1c485f7 解决什么

提交日期 2026-10-14，标题「agent: a model at max without xhigh tells Claude Code it has xhigh, so Ultracode shows on GLM, DeepSeek and Kimi in Claude Desktop」。【源码核实】

- 问题：GLM-5.3（low/high/max）、DeepSeek V4（high/max）、Kimi K3 这类模型能到 max 却没有 xhigh，被写成 `effort,max_effort`。Claude Code 2.1.299 在这样的模型上拒绝 Ultracode：「Ultracode isn't available on `<model>`」。Desktop 只在强度选项里有 xhigh 时才显示 Ultracode。
- 改法（`magpie:internal/agent/claude.go:372-378`）：Claude Code 不认识、强度能到 max 的模型，也写上 `xhigh_effort`。
  - magpie 网关本来就会把 xhigh 按 max 发给这种模型（`fitEffort`，平局取高），所以不会发出模型不收的档位。
  - Claude Code 认识的 Claude 模型不变（Opus、Sonnet 4.6 仍不报 xhigh）。
- 提交说明里的实测：Claude Code 2.1.299 网关模式下 `-p '/effort ultracode'`，新值输出「Ultracode on…」，旧值输出「Ultracode isn't available on v/glm-5.3」。

### 在 CC 2.1.302 里核对

【源码核实】

- Ultracode 门槛：`function P0(e){return Wg()&&(e===void 0||ke(e))}`，`ke` 即 xhigh 支持判断 `tmt()`。
- `tmt()` 的顺序：先看 `CLAUDE_CODE_MODEL_CAPABILITIES` 里的 `xhigh_effort`，再看目录；对 `claude-opus-4-0/4-1/4-5/4-6`、`claude-sonnet-4-0/4-5/4-6`、`claude-haiku-4-5` 明确返回假。
- 环境变量的解析（`I$o`）：
  - 格式 `模式=能力,能力;…`；
  - 模式末尾 `*` 表示前缀匹配；
  - 能力前加 `-` 表示否定；
  - 先去掉模型名的 `[1m]` 再匹配。
- `CLAUDE_CODE_MODEL_CAPABILITIES` 在官方文档和 CHANGELOG 里都没有，是未写进文档的变量。【文档所说（不存在）】
- 文档有的是 `ANTHROPIC_DEFAULT_*_MODEL_SUPPORTED_CAPABILITIES`。llm-gateway-protocol 说它们「have no effect behind an `ANTHROPIC_BASE_URL` gateway」。【文档所说】

### Osuna 现在怎么报

`Osuna:ae/claude-model-hints.ts:97-103`。【源码核实】

- 有任何已知档位就报 `effort`；
- 档位里**有** xhigh 才报 `xhigh_effort`；
- 有 max 才报 `max_effort`；
- 没有「到 max 无 xhigh 也报 xhigh」这一条；
- 以 `claude` 开头的模型整个不报（`60`、`109-112`）。

Osuna 中转站翻译时用 `nearestEffort` 取模型自己的档位里最近的一档，一样近取高（`Osuna:gwy/translation/ir.ts:486-527`）。所以 xhigh 发给 low/high/max 的模型会变成 max。【源码核实】直通（不翻译）时会不会这样改没核实。

---

## 8. 代理检测、app-server 重启，以及 settings.json 改动何时生效

### Codex 侧：代理不转发本机请求

**Codex 怎么选代理**

【源码核实】Codex + reqwest 0.12.28 + hyper-util 0.1.21 源码。

- 模型请求的客户端在默认策略下保持 reqwest 默认行为（`codex:codex-rs/core/src/client.rs:1264-1286`、`login/src/auth/default_client.rs:293-298,425-431`）。
- 默认策略下，代理按下面的顺序取：
  1. `HTTP_PROXY` / `HTTPS_PROXY`（大写优先）；
  2. 环境变量没设时，用 macOS 的「网页代理 / 安全网页代理」或 Windows 的 ProxyServer；
  3. `ALL_PROXY`。
- 绕过代理只看 `NO_PROXY`：macOS 的「忽略这些主机与域」不读；Windows 上 `NO_PROXY` 为空时才用 ProxyOverride。
- `NO_PROXY` 对 IP 主机只认精确 IP 或 CIDR（hyper-util `src/client/proxy/matcher.rs:445-479,510-536`）：

| `NO_PROXY` 写法 | 能不能让 `http://127.0.0.1` 绕过代理 |
|---|---|
| `127.0.0.1`、`127.0.0.0/8` | 能 |
| `localhost` | 不能，它只匹配主机名 localhost |
| `127.*`、单独的 `*` | 不能，对 IP 都无效 |

- Windows 例外：hyper-util 0.1.21 会把 `127.*` 换成 CIDR（`matcher.rs:660-693`）。Codex 锁的是 0.1.20，没核对；这一点与 magpie 说的「127.* 对 Codex 不够」矛盾。
- `[features] respect_system_proxy` 打开时（UnderDevelopment，默认关，`features/src/lib.rs:1469-1480`）：
  - 先问系统：macOS 走 CFNetwork（支持 PAC），Windows 走 WinHTTP；
  - 系统给不出结果才用环境变量，都没有就直连（`http-client/src/outbound_proxy.rs:1-5,364-402`）。
- SOCKS：reqwest 0.12.28 的 `socks` 特性没开时，socks 代理按 HTTP 代理处理（`src/connect.rs:783-792`）。
- Osuna 写进 Codex 的中转站地址是 IP 主机（0.0.0.0 换成 127.0.0.1，:: 换成 ::1；`Osuna:packages/server/src/server/bootstrap.ts:262-270,301-309`）。Osuna 没有任何 `NO_PROXY`、`HTTP_PROXY` 的处理。【源码核实】

**magpie 怎么检测**

【源码核实】`magpie:internal/agent/codex_proxy.go`，`docs/subsystems/agent-wiring.md:94`。

- 环境：先取登录 shell 的 `*_PROXY`，没有再用 magpie 自己进程的（`:53-66`）。系统代理在 macOS 上用 `scutil --proxy` 读，并缓存。
- 算出 Codex 会走哪个代理（`codexProxyFor`，`:72-140`）：照 reqwest、hyper-util 的规则；config.toml 里开了 `respect_system_proxy` 时照 Codex 那条路径。
- 探测：经这个代理 `GET <网关根>/`，3 秒超时，必须回 200 且 JSON 里 `name == "magpie"`（`:215-231`；`reach.go:62-68`）。结果缓存 20 秒。
- 只有「直连网关能通、经代理不通」时才报 `proxied`（`reach.go:298-315`）；这时也不写账号故障转移，之前写过的撤掉（`codex.go:765-775`）。
- 提示原文（`codex_proxy.go:255-268`）：「Codex sends its requests for magpie (HOST) through the proxy at PROXY, set in FROM, and that proxy doesn't pass them on to magpie: every turn fails, with 502 Bad Gateway, whichever model it is on. Have the proxy send 127.0.0.1 direct (a DIRECT rule for 127.0.0.0/8, or rule mode rather than global), 〈下面三句之一〉then quit and reopen Codex. Until then, Disconnect from magpie puts Codex's config back as it was.」三句是：
  - 代理来自环境变量：「or add 127.0.0.1 to NO_PROXY where FROM is set (your shell profile, such as ~/.zshrc, if it's there), 」
  - Windows：「or add 127.0.0.1 to "Don't use the proxy server for addresses beginning with" in Windows' proxy settings (127.* there is not enough for Codex), 」
  - 其他：「or add export NO_PROXY=127.0.0.1 to your shell profile (~/.zshrc): Codex in a terminal and the ChatGPT app's Codex both read it, 」
- 界面标题：「{agent} reaches magpie through a proxy that doesn't pass its requests on」/「{agent} 经代理连 magpie，但这个代理没把它的请求转给 magpie」（`i18n.js:517`）。正文在 i18n 里没有中文，会原样显示英文。【推断】

### Codex 侧：后台 app-server 还读着旧地址

**Codex 本身**

【源码核实】

- app-server 不监视 config.toml，只监视技能目录和客户端发起的 fs/watch。
- 每次 `thread/start`、`thread/resume`、`config/read` 都从磁盘重新加载配置（`codex:codex-rs/app-server/src/request_processors/thread_processor.rs:1355-1358,4183-4187`；`codex-rs/app-server/src/config_manager.rs:463-506`；ConfigManager 不缓存，`:44-57`）。所以新线程用的是改写后的 provider、模型、强度。
- 启动时就固定、进程内不变的：
  - 共享的模型管理器（模型列表）；
  - `model_catalog_json`，注释「applied on startup only. Per-thread `config` overrides are accepted but do not reapply this (no-ops).」（`config/src/config_toml.rs:404-406`）；
  - `model/list` 只在账号登录或登出后重建。
- 已在跑的线程保留建线程时的配置，provider 在建会话时就定了（`core/src/session/mod.rs:915-918`）。
  - 只有经 app-server 写配置、且带 `reloadUserConfig` 时才部分重载，范围是 MCP、插件、部分 features，不换 model 和 provider。
  - 外部直接改文件不触发任何刷新。
- TUI 默认连共享的守护进程（`daemon_auto_start` 默认开），可用 `codex app-server daemon restart` 重启（`cli/src/main.rs:661`）。

**magpie**

【源码核实】`magpie:internal/provider/codex_daemon.go:363-391`、`internal/agent/connectinfo.go:114-192`、`internal/agent/codex_daemon.go:76-127`；`agent-wiring.md:97`。

- 判断守护进程落后：
  - 记下 magpie 最后一次改动「Codex 启动时会读的内容」的时间。这些内容是 config.toml 顶层的 `model_provider`、`model_catalog_json`、`openai_base_url`，`[model_providers.magpie]` 表，以及 magpie-models.json 全文；取摘要比较，Codex 自己写文件不算改动。
  - 和守护进程的 pid 文件（`$CODEX_HOME/app-server-daemon/app-server.pid`）修改时间比，早 1 秒以上就算落后。
- 处理：
  - 没有 TUI、exec、resume、`app-server proxy` 这类客户端连着时，自动执行 `codex app-server daemon restart`；桌面 App、编辑器扩展不算客户端。
  - 有客户端连着就只提示。
- 检查时机：每 15 秒一次；读 Agent 行的 Notice 时；magpie 退出、撤掉故障转移时（`EndCodexFailover`）。也可以手动 `POST /api/codex/daemon/restart`。
- 文案：

| 情况 | 英文 | 中文 |
|---|---|---|
| 自动重启后 | magpie restarted the app-server codex sessions share, which none was on, so new codex sessions have this; restart the Codex app, if it is open, to see it there. | magpie 已重启 codex 会话共用的 app-server（当时没有会话连着它），新的 codex 会话已生效；如果 Codex 应用开着，需重启它才能看到。（`i18n.js:3615`） |
| 有会话连着 | Codex builds its model list at start-up, and the app-server open codex sessions share started before this: restart it (Restart on magpie's Agents page, or {command}) and the Codex app to see this. | Codex 启动时生成模型列表，而已打开的 codex 会话共用的 app-server 在这次改动之前就已启动：需重启它（magpie Agent 页上的“重启”，或 {command}）和 Codex 应用才能看到。（`i18n.js:3579`） |
| 没找到落后的守护进程、但有 codex 在跑 | Codex builds its model list at start-up — restart the Codex app, open codex sessions and the app-server they share ({command}) to see this. | Codex 启动时生成模型列表，需重启 Codex 应用、已打开的 codex 会话以及它们共用的 app-server（{command}）才能看到。（`i18n.js:3578`） |

- 对照 Codex 源码：守护进程的模型列表确实停在启动时；但新线程每次重读 config.toml，所以「守护进程一直读着旧 base URL」对新线程的请求地址不完全成立。【推断】

**Osuna 自己起的 Codex app-server**

【源码核实】`Osuna:packages/server/src/server/agent/providers/codex-app-server-agent.ts`。

- 进程怎么起：
  - 每个 Codex 会话在 `connect()` 时自己 spawn 一个 `codex app-server` 子进程，stdio 通信，不带 `--profile`（`:7288-7313`）；
  - 连接流程是 spawn → initialize → model/list → config/read → … （`:3639-3697`）；
  - 会话存续期间一直用它。进程意外退出后，下次操作会重新 spawn，并 `thread/resume` 原线程（`:3731-3747,4083-4124,4392`）。
  - 列模型、列可导入会话、归档、读历史另起短命进程（`:7389,7480-7529,7541,3989-3999`）。
- 切换「使用第三方接口」时：
  - 只改 config.toml 和模型目录文件，然后通知刷新提供方的模型快照（`ae/service.ts:579-620`；`bootstrap.ts:1010-1016`）；
  - 没有重启或关闭正在运行的 Codex 会话、进程的逻辑，也不碰 Codex 的共享守护进程。
- 结果：
  - 新会话 spawn 新进程，读到新配置；
  - 已在跑的会话保持原进程和原线程配置。【推断，由上面 Codex 源码推出】
- 关掉开关时，这个提供方的网关口令作废，再打开时换新口令（`ae/service.ts:1381-1399`，`nextGatewayTokens`）。【源码核实】
  - 已在跑的 Codex 线程仍带旧口令发到中转站地址，大概会收到 401「Invalid API endpoint gateway token」。【推断，未核实】
  - 这和 ADR 0007:42「关开关后会话回到官方地址，再请求接口模型会得到 model not found」对不上。
- 进程重启后 resume 一个记在 `osuna_api_endpoint` 名下的线程，而这张表已被删掉时，会报「Model provider `osuna_api_endpoint` not found」（`codex:codex-rs/core/src/config/mod.rs:3954-3968`）。【源码核实（报错）+ 推断（触发条件）】
- 协议里有 `runningSessionCount`，注释说给 App 写进确认框；服务端只在列表返回里给出，`packages/app` 里没有使用处。【源码核实】

### Claude Code 侧

【源码核实】除标注外均出自 CC 2.1.302。

- `env` 会重新应用到正在跑的会话。
  - 应用状态变化的处理函数里：`if(e.settings!==i.settings){try{if(_ht(),_le(),bht(),P$t(),e.settings.env!==i.settings.env)k()}catch(n){t(\`Failed to apply settings change (clear auth caches / re-apply env): …\`)}}`。
  - 其中 `function k(){if(!Hs())return;cR(),Plr()}`：工作区已受信任时重新执行 `applyConfigEnvironmentVariables()`。
  - 设置文件被监视，改动后发出变化（日志 `"Watching for changes in setting files …"`；内部事件 `"Settings changed from ${n}, updating app state"`）。
  - 所以 ADR 0004「Claude Code re-applies `settings.json` `env` to sessions that are already running」成立，前提是工作区已受信任。
  - 新地址、新口令下一次请求就生效。
    - 【源码核实】主请求每次都现建 API 客户端：埋点 `"query_client_creation_start"` 之后调 `JU({…})`，`JU` 每次从 `process.env` 读 `ANTHROPIC_BASE_URL` 和凭证。
    - 【推断】凭证缓存会在 `env` 变化时一起清掉（`clear auth caches`），所以口令也跟着换。
- 但删掉的变量不会从跑着的会话里消失。
  - 【源码核实】重新应用只做 `Object.assign(process.env, …)`，只加和改，不删。
  - 【文档所说】env-vars：「A running session applies new and changed values to its environment when you save the file … Removing a variable from the file doesn't unset it in a running session」。
  - 对 Osuna 的影响【推断，未核实】：切回官方时，如果接管前没有 `ANTHROPIC_BASE_URL`、`ANTHROPIC_AUTH_TOKEN`，恢复就是删掉它们，跑着的会话会继续用中转站地址和口令；接管前有值的会被改回原值，能生效。
- 权限也实时生效：同一流程里按新设置重算 `toolPermissionContext`（权限规则、`additionalDirectories`）。【源码核实】
  - 【文档所说】CHANGELOG 1.0.90：「Settings file changes take effect immediately - no restart required」；2.1.98：`permissions.additionalDirectories` 改动会在会话中生效。
- 顶层 `model`：文档说只在会话启动时读。
  - 【文档所说】settings：「Claude Code reads some keys only once, at session start … `model` … `effortLevel` and `modelSettings`」；运行中要用 `/model`、`/effort` 改。
  - 【源码核实（部分）】
    - 会话里显示和使用的模型取自应用状态：`Ot(state.mainLoopModelForSession ?? state.mainLoopModel ?? YS())`，例如 `/effort current` 和 SDK 的 `initialModel`。
    - 设置变化的处理函数（`"Settings changed from ${n}, updating app state"`）只更新 `settings` 快照和权限，不改 `mainLoopModel`。这与文档一致。
    - `mainLoopModel` 启动时怎么从设置的 `model` 算出来没追；`my()` 在没有明确选择时会读 `ANTHROPIC_MODEL` 和设置里的 `model`。
  - 【文档所说】settings：「Claude Code watches your settings files and reloads them when they change, so it applies most edits to the running session without a restart, including edits to `permissions`, `hooks`, and credential helpers such as `apiKeyHelper`.」
- magpie 的说法：「a session takes a new CLAUDE_CODE_EFFORT_LEVEL on its next request, but settings.json's effort and ultracode, and the env's level taken away, only when started again」（`magpie:internal/agent/claude.go:2027-2030` 注释）。

---

## 9. magpie 的三个界面功能

### 断开前预览

【源码核实】`magpie:internal/agent/preview.go:21-31,70-90`。

- 做法：不另写一套「断开会做什么」的描述，而是把 Agent 的配置目录和 magpie 自己的文件拷到临时 home，在子进程里（`DryRunArg = "agent-disconnect-dry-run"`）真跑一遍断开，再逐文件比较。
- 结果结构：`FileChange{Path, Removed, Created, Lines []LineDiff}`，`LineDiff.Op` 为 `-`（删）、`+`（加）、`~`（改回，带 `Was`）。
- 拿不到预览的情况：WSL、便携版、文件不在 home 下。这时对话框改用文字说明。
- 文案（`magpie:internal/gui/assets/i18n.js`，英文 → 中文）：

| 行 | 英文 | 中文 |
|---|---|---|
| 594 | Disconnect and restore | 断开并还原 |
| 592 / 593 | View / Hide changes | 查看 / 收起 |
| 595 | Changed | 改动了 |
| 596 | Deleted | 删除 |
| 597 | Created | 新建 |
| 598 | value before connecting | 接入前的值 |
| 599 | Now: {line} | 现在：{line} |
| 600 | {n} more lines | 还有 {n} 行 |
| 601 | {agent} goes back to how it was before it was connected; these are the places put back. | {agent} 将恢复接入前的设置，以下为要改回的项。 |
| 602 | Reading what changes… | 正在读取要改回的地方… |
| 603 | magpie's provider table stays, so sessions opened on magpie's models still open | 保留 magpie 供应商表，用 magpie 模型开过的会话还能打开 |
| 524 | Disconnect {agent} from magpie? | 断开 {agent} 和 magpie？ |
| 525 | magpie takes out everything it wrote into {agent}'s config — its endpoint, key, models and effort — and puts back the settings {agent} had before. magpie's providers and accounts stay as they are. | 移除 magpie 写入 {agent} 配置的所有内容（接口地址、密钥、模型和推理强度），还原 {agent} 之前的设置。magpie 的供应商和账号不受影响。 |

### 改完提示要重开谁

【源码核实】

- 判断哪些副本还在用旧配置（`magpie:internal/agent/connectinfo.go:200-280`，`StaleCopies`）：列出启动时间早于配置最后修改时间的进程。Codex 再细分为桌面 App、编辑器扩展、后台 daemon（app-server）、CLI、别的 App 内嵌，以及不用重开的 helper。Windows 上只查 Codex 的 daemon。
- 改了只在启动时读的设置时，Agent 自己的 `Notice` 给出提示（`agent-wiring.md:34`）；Claude Code 的提示见第 3 题。
- 文案（`i18n.js`）：

| 行 | 英文 | 中文 |
|---|---|---|
| 543 | Connected · new sessions take it | 已接入 · 新开的会话生效 |
| 544 | Connected · takes effect once {agent} is reopened | 已接入 · 重开 {agent} 后生效 |
| 545 | Connected · quit and reopen the {agent} app | 已接入 · 退出并重开 {agent} 应用后生效 |
| 546 | Connected · reload the editor's window | 已接入 · 重新加载编辑器窗口后生效 |
| 547 | Connected · restart {agent}'s app-server | 已接入 · 重启 {agent} 的后台 app-server 后生效 |
| 548 | Connected · reopen {app} | 已接入 · 重开 {app} 后生效 |
| 549 | Connected · restart {agent} in the terminal | 已接入 · 重启终端里的 {agent} 后生效 |
| 550 | Connected · {n} copies of {agent} to reopen | 已接入 · {n} 个运行中的 {agent} 待重开 |
| 551 | Connected · {n} models · {new} show in new {agent} sessions | 已接入 · {n} 个模型 · {new}在新的 {agent} 会话里可见 |
| 553 | Connected · switch the opus · sonnet · haiku tiers in /model | 已接入 · 在 /model 里切换 opus · sonnet · haiku 档位 |
| 554 | Connected · {n} models in {agent}'s {cmd} | 已接入 · {agent} 的 {cmd} 里有 {n} 个模型 |
| 560 | New sessions take it; switch the tiers in {cmd}. | 新开的会话生效，在 {cmd} 里切换档位。 |
| 561 | Reopen {agent}, then pick any model in {cmd}. | 重开 {agent} 后，在 {cmd} 里选任何一个模型。 |
| 563 | 1 running {agent} still has the old list | 1 个正在运行的 {agent} 还是旧列表 |
| 564 | {n} running {agent} still have the old list | {n} 个正在运行的 {agent} 还是旧列表 |
| 565 | The {agent} app, started {when}: closing its window keeps it running. Quit it with {cmd} and open it again. | {when}启动的 {agent} 应用：关掉窗口它仍在运行。用 {cmd} 退出后再打开。 |
| 566 | {agent} in an editor (VS Code, Cursor…), started {when}: reload that editor's window. | {when}启动的编辑器（VS Code、Cursor…）里的 {agent}：重新加载那个编辑器的窗口。 |
| 567 | {agent}'s background app-server, started {when}: restart it with {cmd}. | {when}启动的 {agent} 后台 app-server：用 {cmd} 重启它。 |
| 568 | {app}'s own {agent}, started {when}: quit {app} and open it again. | {when}启动的 {app} 自带的 {agent}：完全退出 {app} 再打开。 |
| 569 | A {agent} in a terminal, started {when}: quit it and start it again. | {when}在终端里启动的 {agent}：退出后重新启动。 |
| 604 | Running {agent} copies take it once reopened | 正在运行的 {agent} 重开后生效 |

### 外部改动的五种情况

【源码核实】`magpie:internal/agent/applied.go:122-240`（`Drift`）、`356-405`（`Reapply`、`Keep`）；`docs/subsystems/agent-wiring.md:19,35`。

| 情况 | 什么时候算 | 按钮文案（英 / 中，`i18n.js`） |
|---|---|---|
| `unwired`（不再经过） | `Check` 发现配置不再经 magpie：地址或 key 被改；或 Claude Code 的托管设置、云开关（第 4 题）。经反向代理到 magpie 的不算，见第 10 题 | 513「{agent} no longer goes through magpie — its config was changed」/「{agent} 已不经过 magpie：配置已变更」 |
| `replaced`（模型被换） | magpie 设成自家模型的字段，现在是 Agent 自己的模型。从一个 magpie 模型换到另一个不算，详见第 12 题 | 514「{agent} was switched off {model} outside magpie」/「{agent} 已在 magpie 之外换掉 {model}」 |
| `bypassed`（被绕过） | 配置是对的，但 Agent 最近的请求没到网关：日志显示发去了别处，或用过却没有请求到达。原因是旧进程还在用旧配置，或配置之外的东西盖过了它 | 515「{agent} was used without going through magpie — restart it after applying」/「{agent} 最近绕过了 magpie，重新应用后请重启」 |
| `unreachable`（地址没人应答） | 配置指向回环以外的地址，那里不应答，而回环上的网关在应答（`agent-wiring.md:35`） | 516「{agent} is set up, but nothing answers at the address it reaches magpie by」/「{agent} 已设好，但它连 magpie 用的地址没有回应」 |
| `proxied`（代理不转发） | Codex 走的代理不把请求转给网关（`codex_proxy.go`，见第 8 题） | 517「{agent} reaches magpie through a proxy that doesn't pass its requests on」/「{agent} 经代理连 magpie，但这个代理没把它的请求转给 magpie」 |

其他按钮和提示：

| 行 | 英文 | 中文 |
|---|---|---|
| 518 | How to fix | 如何修复 |
| 511 | Apply again | 重新应用 |
| 512 | Keep current settings | 保留当前设置 |
| 519 | {agent} goes through magpie again | {agent} 已重新经过 magpie |

- 「重新应用」对应 `Reapply`：
  - `replaced` 把被换掉的字段和其余 magpie 设过的字段写回；
  - `unreachable` 可移到 WSL 的新地址；
  - 其余情况按当前值重写。
  - 都会刷新记录，之前的使用不再算。
- 「保留当前设置」对应 `Keep`：删掉 `applied.json` 里这个 Agent 的记录，以后不再报改动。
- 界面怎么摆（`magpie:internal/gui/assets/app.js:980-1005`，`driftFix`）：
  - 漂移的 Agent 名字后面有一枚琥珀色小标，鼠标悬停显示原因和详情。
  - `unreachable`、`proxied` 的小标写「How to fix」，点开说明要让什么在那个地址上监听，或怎么让代理放行（`explainDrift`）。WSL 已换地址时，改成「Use {url}」直接改过去。
  - 其余三种的小标写「Apply again」，点了直接重写。
  - 「保留当前设置」放在这一行的菜单里。

---

## 10. 自动选起始模型；经代理到 magpie 不算漂移

### 打开接入时自动选起始模型并说明怎么选的

【源码核实】`magpie:internal/agent/applied.go:484-505`（`Connection`）、`511-519`（`ConnectHow`）、`549` 起（`connect`）。

- 返回 `Connection{How, Field, Value}`，`How` 有八种：

| How | 含义 |
|---|---|
| `kept` | 已接入，原样不动 |
| `again` | 断开时用的模型放回 |
| `joined` | 保留它自己的模型，magpie 的模型并进列表（Codex 用 ChatGPT 登录时） |
| `magpie` | 唯一设置是「用 magpie 做 provider」的 App |
| `same` | 现在用的模型，改经 magpie |
| `alike` | 别名（如 opus）指向的模型，经 magpie |
| `default` | 原来没设模型，取它自己列表的第一个；Claude Code 取最新的 |
| `first` | magpie 没有它原来的模型：取它登录的账号上的第一个，否则订阅里的，否则第一个 |

- 打开时把当前值存进 stash（`<id>.connect.was`），断开时用来还原。
- 没有模型可给时返回带代码的错误：
  - `NoModelsError`（`no_models`）：「Add a provider or subscription in magpie first, then connect {agent}」；
  - `AllHiddenError`（`all_hidden`）：模型都被从这个 Agent 的列表里拿掉了。
- 文案（`i18n.js:623-628`）：

| 英文 | 中文 |
|---|---|
| {agent} is connected to magpie | {agent} 已接入 magpie |
| …· back on {model}, what it was on when it was switched off | …· 回到上次断开前用的 {model} |
| …· on {model} through magpie, the model it was on | …· 经 magpie 继续用它原来的模型 {model} |
| …· on {model} through magpie: it had no model set, so the first of its own | …· 原先未设模型，改用它自己列表中的第一个：{model} |
| …· on {model} through magpie: magpie doesn't serve the model it was on | …· magpie 没有它原来的模型，改用 {model} |
| …· it stays on its own last pick; magpie's models join its {cmd} | …· 仍用它上次选的模型，magpie 的模型已加入 {cmd} |

### 经反向代理或本机带路径的代理到 magpie 不算漂移

【源码核实】`magpie:docs/subsystems/agent-wiring.md:35,41`；`internal/agent/reach.go:60-140`。

- 怎么认：配置里的地址和 magpie 写的地址不同时，去掉 magpie 的路径后缀（如 `/v1`），剩下的部分若是下面两种之一，就去探测（`proxyBase`）：
  - 另一台机器上的 http(s) 地址（如公司的 `https://ai.corp.example/magpie`）；
  - 本机回环上带自己路径的地址（如合规代理 `http://127.0.0.1:8788/claude-code-anthropic/<route>`，`loopbackWithPath`）。
- 探测：`GET <剩下的部分>/` 要像网关自己的 `GET /` 那样回 `{"name":"magpie"}`（`answersAsMagpie`）。后台探，最多 20 秒一次，从不等待。
- 判定：
  - 还没探出结果时不算漂移（`reachesMagpie`）；
  - 探到 magpie 才保留这个地址（`surelyMagpie`）；
  - 探到别的东西（例如 CC Switch 插进来的中转）算 `unwired`；
  - 回环上不带路径的地址是 magpie 旧端口，不探，直接算 `unwired`。
- 同步时（`agent-wiring.md:41`，`edit.Filtered` / `kept.away`）：用户指向别处的 magpie（NAS、本机局域网地址）或带路径前缀的代理，地址和路径前缀、连同那里用的 key 一起保留，不改回 `gateway.URL()`。
- Claude Code 在 `/model` 里选模型时也保留代理地址，前提是 magpie 已在那里应答过（`claude.go` 里的 `routed`、`gwAt`）。
- 端口变动（`OnGateway` / `Rewire`）只重写 `unwired` 的 Agent。

---

## 11. Claude Code 自己怎么读 settings.json（追加）

### 解析器与容错

【源码核实】CC 2.1.302。

- 设置文件走 `Pw()`，调用 `ft(text,!1)`。`ft` 用 `se()` 解析：`function se(e,i){try{return{ok:!0,value:JSON.parse(Bo(e))}}catch(r){…return{ok:!1}}}`，其中 `function Bo(e){return e.startsWith("\uFEFF")?e.slice(1):e}`。也就是严格的 `JSON.parse`，先去掉开头的 BOM。
- 二进制里另有一个 JSONC 解析器（`zMe`：`"Failed to parse JSONC"`），但设置文件不用它。

| 文件内容 | 结果 |
|---|---|
| 开头有 UTF-8 BOM | 去掉后正常读 |
| `//` 或 `/* */` 注释 | `JSON.parse` 失败 |
| 尾随逗号 | `JSON.parse` 失败 |
| 空文件或只有空白 | 当空设置 `{}` |

### 读不了时

- 整份文件跳过，不是只跳过出错的那几项。【源码核实】
  - 解析失败时 `ft` 返回 `null`，随后 schema 校验失败，返回 `{settings:null, errors:[…]}`。
  - 启动时弹「设置有错」对话框，选项是「Fix with Claude」「Exit and fix manually」「Continue without these settings」，说明是「Files with errors are skipped entirely, not just the invalid settings.」。
  - `claude doctor` 也会列出这些错误（`"Settings errors are currently blocking … run \`claude doctor\` to list them"`）。
- Claude Code 自己往一份坏文件里写（`/model`、`/effort` 等）会拒绝：`"Invalid JSON syntax in settings file at ${r}"`。【源码核实】
- 托管设置解析不了时，见第 4 题。
- 【文档所说】settings：
  - 「Settings files are strict JSON: a `//` comment or a trailing comma is a syntax error, and Claude Code reports the file as a Settings Error at the next start.」
  - 交互模式弹「Settings Error」对话框，可让 Claude 修、退出或不带这份文件继续；只是个别条目出错时报 Warning、跳过那一条。
  - 「A `-p` run shows no dialog. Unless a managed settings document can't be parsed, Claude Code skips the broken file or values and continues」。
  - 托管设置文档解析失败时，即使别的来源有效也以退出码 1 拒绝启动（errors 页）。
  - 文档没提 BOM。

### magpie 的 JSONC 精确改写对 Claude Code 的 settings.json 适用到什么程度

- magpie 的做法（【源码核实】）：
  - 读：用 `tidwall/jsonc` 去掉注释和尾随逗号（`magpie:internal/edit/json.go:10,25,109`）；
  - 写：保留注释、顺序、缩进，原子写入；
  - BOM：`edit.Read` 去掉，`keepBOM` 写回（`internal/edit/file.go:30-56,108`；`agent-wiring.md:65-66`）。
- 对 Claude Code 的 settings.json：
  - BOM：Claude Code 能读带 BOM 的文件（上面已核实），所以容忍 BOM 改的是 Osuna 的拒写。
    - 现状：Osuna 用 `JSON.parse(text)` 直接解析（`Osuna:ae/claude-settings-patch.ts:392-395`），`Buffer.toString("utf8")` 不去 BOM，于是判为解析不了、什么都不写（`ae/service.ts:1110-1112`）；Codex 那边已经先摘 BOM（`ae/codex-config-patch.ts:255-258`）。【源码核实】
  - 注释、尾随逗号：Claude Code 自己就读不了这样的文件，整份跳过。【源码核实】所以即使 Osuna 能在保留注释的前提下写进去，Claude Code 也不会用这份文件里的任何设置。【推断，由上两条推出】

### 顺带：Codex 读 config.toml

- 能读带 BOM 的文件。【源码核实】
  - 不是 Codex 自己处理的：读文件只做 UTF-8 解码再 `toml::from_str`（`codex:codex-rs/config/src/loader/layer_io.rs:149-176`）。
  - 是 toml_parser 的词法器在开头遇到 BOM 时跳过（toml_parser 1.1.3 `src/lexer/mod.rs:32-44,74`，与 Codex 锁定的版本相同）。
- 解析失败时【源码核实】：
  - TUI 打印「Error loading config.toml」后以退出码 1 退出；
  - app-server 启动时（非 strict）改用默认配置，并警告「Invalid configuration; using defaults.」；
  - 之后的请求返回「failed to load configuration: …」（`codex-rs/app-server/src/request_processors/config_errors.rs:16-36`）。
- Codex 自己回写（`/model` 等）时经 toml_edit 重新输出，BOM 大概率不保留。【推断，未核实】本机没有 Codex 用的 toml_edit 0.24.0 源码。

---

## 12. CLI 自己会不会把模型、强度写回设置文件（追加）

### Claude Code

【源码核实】CC 2.1.302。

- `/model` 默认写回 `~/.claude/settings.json` 的 `model`。
  - 选模型界面的说明是「Switch between Claude models. Your pick becomes the default for new sessions.」。
  - 按回车时先调 `onSetDefault`（存为默认）再选中；写入是 `On("userSettings",{model:e??void 0})`。提示「Set model to X and saved as your default for new sessions」。
  - 想只改本会话，按 `modelPicker:thisSessionOnly` 键，提示「… for this session only」。【文档所说】CHANGELOG 2.1.153：「If you customized the `modelPicker:setAsDefault` keybinding, rename it to `modelPicker:thisSessionOnly` … (the `d` action was replaced by `s`)」，即这一版起默认存、按 `s` 只用于本会话。
  - 在 `/model` 里顺带选的强度，同时存为默认（见第 3 题）。
- `/effort <档位>` 默认写回 `modelSettings.<模型>.effortLevel`，不写顶层 `effortLevel`（模型 id 撞上 Object 原型属性时例外）。`max` 不存。
- 【文档所说】
  - model-config：「`/model` saves your choice as the default for new sessions by writing the `model` field in your user settings.」；「`s`: switch model for this session only」。
  - `-p` 下不保存；Enterprise 计划用 claude.ai 账号存默认时还会记到账号上（v2.1.280+）。
  - settings-reference 的 `effortLevel`：「Claude Code saves the level for the active model under `modelSettings` rather than writing this key. Before v2.1.251, `/effort` wrote this key.」
  - 其他会回写的命令：`/autocompact` 写 `modelSettings.<模型>.autoCompactWindow`（v2.1.288+），`/fast` 写 `fastMode`，思考开关写 `alwaysThinkingEnabled`，`/config` 多数写 `~/.claude/settings.json`。
- 其他会改 `model` 的地方（源码里看到的）：
  - 启动迁移，值是特定旧写法时才改，多数要求 `Pe()==="firstParty"`（自定义地址也算）：
    - 模型别名迁移表；
    - `claude-fable-5` → `fable`；
    - 旧 Opus id → `opus`；
    - `opus` → `opus[1m]`。
  - 组织默认模型在服务器端更新后，清掉用户设置里的 `model`（`On("userSettings",{model:void 0})`）。前提是能拿到组织默认，经 Osuna 中转站时会不会走到这一步没查。
  - 这些会不会碰到 Osuna 写的值没逐个核对；Osuna 写的是接口模型 id，一般不在迁移表里。【推断】
- 对 Osuna 的影响（【源码核实】）：
  - `model` 是 Osuna 负责的键，和上次写入值不同就算「被外部修改」（`Osuna:ae/claude-settings-patch.ts:360`、`ae/service.ts:1283-1295,1689-1698`）。所以用户在终端 `/model` 里按回车换一次模型（哪怕换成列表里的另一个接口模型），就会出现 `modified_externally`。这时的改动是 Claude Code 自己按设计回写的，不是别的程序改的。另外，选列表里的同一个模型时写进去的是 `slug/模型[1m]` 这种列表写法，和 Osuna 写的裸 id 不同，也会被算成改动。【推断，由列表写法推出】
  - 健康状态非空时，模型资料更新不再自动重写提示和 `/model` 列表（`ae/service.ts:763-767`）。
  - 下一次因为接口或开关变化重写配置时，`model` 会被改回 Osuna 的默认模型：`applyClaudeApiEndpoint` 总是写 `model`（`ae/claude-settings-patch.ts:134-138`），`writeClaudeEndpoint` 不看健康状态（`ae/service.ts:1101-1138`）。
  - `/effort` 写的 `modelSettings` 不是 Osuna 负责的键，不触发。
  - Osuna 现在的界面不显示健康状态（差距清单 03·A10；`packages/app/src/api-endpoints` 里非测试代码搜 `health` 无命中）。

### Codex

【源码核实】除标注外均出自 `codex:codex-rs/`。

- TUI 的 `/model` 默认写回 config.toml。
  - 在选单里按回车（提示为 default）会依次发出 `UpdateModel`、`UpdateReasoningEffort`、`PersistModelSelection`（`tui/src/chatwidget/model_popups.rs:323-333`）。
  - 由 `tui/src/app/event_dispatch.rs:2560-2595` 和 `tui/src/config_update.rs:87-104` 写 `model`。`model_reasoning_effort` 有值就替换，选「默认」就删。
  - 写入不是 TUI 直接改文件，而是走 app-server 的 `config/batchWrite`：`ConfigBatchWriteParams { edits, file_path: None, expected_version: None, reload_user_config: true }`（`config_update.rs:155-172`）。
  - 写到用户配置文件的**顶层**：默认 `$CODEX_HOME/config.toml`；以 `--profile x` 启动时是 `x.config.toml`。不会写 `[profiles.x]`（`config/src/state.rs:104-112`；`tui/.../startup_orchestration.rs:136-139`）。
  - 被更高优先级的层盖住时，提示「Saved {setting}, but a higher-priority configuration layer overrides the saved value.」（`tui/src/app/model_defaults.rs:121-134`）。
- 只改本会话的方法：按 `s`（提示为 session，`tui/src/chatwidget/session_model_selection.rs:53-98`），或用 `/model <参数>`（`model_command.rs:147-174`）。提示带「for this session only」。
- Plan 模式下先问范围：选「仅 Plan」只写 `plan_mode_reasoning_effort`，选「全部模式」两个都写（`model_popups.rs:411-446`）。
- app-server 的接口：
  - 没有 `setDefaultModel`。
  - `config/value/write`、`config/batchWrite` 能写任意键，但只能写用户配置文件（「Only writes to the user config are allowed」），并拒绝 `profile` 和 `profiles.*`：「`profiles` contains legacy config profile tables and can no longer be written; use `--profile <name>` with `<name>.config.toml` instead」（`app-server/src/config_manager_service.rs:219-239,283-299`）。
  - 修改用 toml_edit 原位进行、原子写入（`:437-443`）。
  - 一批修改只涉及 `model`、`model_reasoning_effort`、`plan_mode_reasoning_effort`、`service_tier`、`personality` 时，不重载正在运行的线程（`app-server/src/request_processors/config_processor.rs:165-189`）。
  - `thread/start`、`thread/settings/update` 里的 model 和 effort 只作用于线程，不落盘（`thread_processor.rs:1214-1227`；字段注释「Override the model for subsequent turns」）。
- TUI 还会回写的其他键（都走 batchWrite，除非注明）：
  - `/fast` 一类服务档命令写 `service_tier`；
  - `/permissions` 写 `approvals_reviewer`；
  - `/experimental` 写 `features.<key>`；
  - `/memories` 写 `memories.use_memories`、`memories.generate_memories`；
  - 应用开关写 `apps."<id>".enabled`；
  - 用量提醒写 `[notice] hide_rate_limit_model_nudge`，这一项直接写文件；
  - 目录信任写 `projects."<路径>".trust_level`；
  - app-server 处理 `thread/start` 时也可能把 cwd 写成 trusted（`thread_processor.rs:1377-1392`）。
- 对 Osuna 的影响（【源码核实】Osuna；结论是【推断】）：
  - Osuna 负责 Codex 顶层的 `model_provider`、`model`、`model_catalog_json`（`ae/codex-config-patch.ts:20`），不等于上次写入值就报 `modified_externally`（`:207-211`）。
  - 所以用户在 Codex TUI 里按回车换模型，同样会被报成外部修改，也是 CLI 自己回写的。
  - `model_reasoning_effort` 不是 Osuna 负责的键，不触发。
  - Osuna 自己的 Codex 会话经 app-server 换模型时，走不走 `config/batchWrite` 没查。

### magpie 怎么处理「模型被换」

【源码核实】`magpie:internal/agent/applied.go:150-205`。

- 只有在 magpie 设成自家模型的字段，现在变成 Agent **自己的**模型（非 magpie 模型）时，才报 `replaced`。
- 注释原文：「A field moved from one magpie model to another (the agent's own picker) isn't drift; one moved off magpie is.」
- 以下都不算：
  - Codex 用 ChatGPT 登录时，在它自己的 `/model` 里选了不是 magpie 的模型（`Joined`、`Beside`，#2424）；
  - 跟随主模型的空字段（Claude Code 的档位和子代理），在主模型被 `/model` 换到 magpie 给该字段设的模型时（#1050）；
  - 同一路由组里换成员（`sameGroup`）。
- Claude Code 有 `Follow` 钩子（`magpie:internal/agent/claude.go:1965-1983`）：在 `/model` 里选的 magpie 模型就当成新的主模型，跟随它的档位和子代理一起换过去，并清掉旧版写的 `ANTHROPIC_MODEL`。
- 换成非 magpie 模型时，报 `replaced`，提供「重新应用」（`Reapply` 写回原模型和其余字段）和「保留当前设置」（`Keep`，忘掉记录、不再报）。

---

## 没能核实的地方

**Claude Code**

- 口令生效期间，Claude Code 会不会替存着的 OAuth 续期；去掉口令后需不需要重新登录，取决于刷新令牌是否还有效（1a）。
- 套餐用量接口 `/api/oauth/usage` 的基地址没追到；上游第三方怎么对待 `anthropic-beta: oauth-2025-04-20`（1b）。
- 经中转站、保留 OAuth 时 fast mode 的实际表现；ultrareview 在 2.1.302 里对地址的门槛；`blocked_auth_token_env` 属于哪个功能（1c）。
- 「401 时续登录、重试约十次后要求 /login」的次数，只有 magpie 注释（针对 2.1.293）（1e）。
- Claude Code 不认 `模型:强度` 写法：没找到解析代码，只是没看到（2a）。经中转站时内置档位名最终发哪个 id，没逐步追（2b）。
- 云厂商开关的值是不是走 1/true/yes/on 那个布尔解析；`filterSettingsEnv` 和工作区信任前的规则；`~/.claude.json` 的 `env` 文档没写、源码仍按「legacy」应用（4）。
- 带点版本号的「退役警告」文案；哪些上游会列带点的 id（5）。
- `CLAUDE_CODE_AUTO_MODE_SERVER=0` 时请求不再带审查字段，只有 magpie 注释；本地分类器调用由接口计费是推断（6）。
- Osuna 直通（不翻译）时是否也把 xhigh 改成 max（7）。
- `mainLoopModel` 启动时怎么从 `model` 算出来；关开关后正在跑的 Claude Code 会话会继续用中转站地址和已作废的口令（删掉的 `env` 不会从进程里消失、口令作废），这是由文档和源码两条事实推出的，没实测（8）。
- 启动迁移、组织默认模型重置会不会碰到 Osuna 写的 `model`（12）。
- `CLAUDE_CODE_MODEL_CAPABILITIES` 不在官方文档和 CHANGELOG 里，是未写进文档的变量，以后可能变。

**Codex**

- hyper-util：Codex 锁 0.1.20，本机只有 0.1.21 源码。Windows 上 `127.*` 是否被换算成 CIDR 取决于 0.1.20，这一点和 magpie 的说法冲突。
- reqwest 的 socks 特性有没有被某个传递依赖打开，Cargo.lock 看不出。
- macOS 在 `respect_system_proxy` 下系统例外列表是否生效，依赖 Apple API 的行为，没实测。
- Codex 回写 config.toml 用的 toml_edit 0.24.0 对 BOM 的处理没有源码可看。
- 以 `--profile` 启动、连着共享守护进程的 TUI，`/model` 最终写到哪个文件，没追到底。
- 「V2 任务被 OpenAI 服务端封存」只来自 magpie 注释。
- Osuna 关开关后已在跑的 Codex 会话的实际表现（旧口令 401、与 ADR 0007 的出入），以及 Osuna 自己的 Codex 会话换模型时走不走 `config/batchWrite`。

**通用**

- 所有「行为」结论都来自读源码和文档，没有运行任何 `claude`、`codex` 可执行文件做实测。
