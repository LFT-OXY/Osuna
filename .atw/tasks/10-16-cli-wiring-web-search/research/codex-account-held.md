# Codex 账号「被扣住」时要不要临时改成服务商模式：事实核对

调研日期 2026-10-18。只查事实，不做取舍、不写推荐。没有运行 `codex`、`claude`，没有读写 `~/.codex`、`~/.claude`、magpie 的数据目录或钥匙串；外部源码只在临时目录里用 grep / sed / cat 读。另用 Exa 读了几篇网页（OpenAI 官方文章、openai/codex 的 GitHub issue）。接法的背景事实见同目录 `codex-wiring.md`，下文按题号引用。

## 读的版本

- Osuna：`main` @ `d8948dad29d9f49385d8990fcc010f8e22b7209b`。
- magpie：`yetone/magpie` @ `7597c13237c6eaecba89b478771f2f1d244108e4`（2026-10-16）。
- Codex：`openai/codex` `main` @ `ce0323f2f2d3b25e82806cd555237da3db4e1897`（2026-10-17 04:02 UTC），`--depth 1` 克隆。第 3 题的 TUI 暂扣、app-server `account/rateLimits/read`、429 映射几处，又对照了最新正式版 tag `rust-v0.163.0` 的同名文件（`tui/src/chatwidget/backend_banners.rs`、`tui/src/chatwidget/input_flow.rs`、`app-server/src/request_processors/account_processor.rs`、`codex-api/src/api_bridge.rs`，从 raw.githubusercontent.com 取到临时目录），机制都在，行号只差几行。
- 桌面 app（ChatGPT.app，原 Codex app）是闭源的，不在 openai/codex 仓库里。关于它的说法只来自 magpie 的源码注释与文档、GitHub issue 里用户的报告。
- 网页（2026-10-18 读）：OpenAI 文章 <https://openai.com/index/chatgpt-for-your-most-ambitious-work/>（2026-07-09）；OpenAI 帮助中心 <https://help.openai.com/en/articles/20001276/>、<https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan-usage-limits-and-troubleshooting>；Codex 定价页 <https://developers.openai.com/codex/pricing/>；openai/codex issue #32631、#48369、#48816、#48650、#43333、#8393。

引用写法同 `codex-wiring.md`：`codex:` 后的路径相对 `codex-rs/`；`magpie:`、`osuna:` 相对各自仓库根；`…/codex-app-server-agent.ts` 指 `osuna:packages/server/src/server/agent/providers/codex-app-server-agent.ts`。

标注：「源码核实」读过源码；「文档所说」来自文档、代码注释、提交说明或 issue 里的报告；「推断，未核实」没有直接证据或没有运行验证。

---

## 1. magpie 说的「Codex app」指什么

结论：指 OpenAI 的 Codex 桌面应用。它在 2026-07-09 并入新版「ChatGPT」桌面应用：macOS 上叫 `ChatGPT.app`，bundle id 仍是 `com.openai.codex`；Windows 上是商店包 `OpenAI.Codex`。不是旧的 ChatGPT 聊天应用（现名 ChatGPT Classic，`com.openai.chat`），也不包括 Codex 命令行（TUI）。`codex app-server` 本身没有这道闸门。桌面 app 自带一个 app-server，闸门在桌面 app 的界面层。

- magpie 认桌面 app 的方式：`"codex": {id: "com.openai.codex", names: ["ChatGPT.app", "Codex.app"], store: "OpenAI.Codex"}`。注释原文："OpenAI's Codex app is ChatGPT.app (com.openai.codex) since it took ChatGPT's name; the bundle id tells it from the ChatGPT chat app (com.openai.chat) of the same name."。`magpie:internal/agent/desktopapp.go:24-27,44`（源码核实）
- 「被扣住」判定函数的注释写的是 "the Codex app (ChatGPT Desktop) holds its composer for the account"，依据是 "the composer's own gate in ChatGPT.app 26.930.61225"，即 ChatGPT.app 里 `app-primary`、`app-initial` 两个前端脚本。`magpie:internal/provider/subscription_usage.go:1033-1056`（文档所说：magpie 注释，说是读了 ChatGPT.app 的前端包）
- magpie 把 Codex 的运行副本分成几种："app"（ChatGPT 或 Codex 桌面 app、它的 app-server 和辅助进程）、"ide"（编辑器扩展）、"daemon"（CLI 留在后台的 app-server）、"cli"。`magpie:internal/agent/connectinfo.go:204-210`（源码核实）。桌面 app 自带的 app-server 是 `ChatGPT.app/…/CodexCLI.app/Contents/MacOS/codex … app-server`。注释说账号换了以后它仍读旧账号的额度，"stops sending in every thread once those are spent"。`magpie:internal/provider/codex_daemon.go:153-158,257-262`（文档所说）
- 命令行不在内。「一直 ChatGPT」一档的说明是 "The Codex app may then send nothing till the account has room; Codex CLI goes on through magpie"。文档也说 "the Codex app may send nothing till the account has room, while Codex CLI's turns still reach magpie by the base URL"。`magpie:internal/agent/codex.go:1481`；`magpie:docs/subsystems/agent-wiring.md:96`（文档所说）
- 独立来源，说法与 magpie 一致：
  - OpenAI 2026-07-09 的文章："the Codex app is merging with the new ChatGPT desktop app … If you already use the Codex app, you can update it as usual and it will become the new ChatGPT desktop app … The existing version of the ChatGPT desktop app will be renamed ChatGPT Classic"。帮助中心 20001276 也这么说。（文档所说）
  - openai/codex issue #32631 贴出合并后 `/Applications/ChatGPT.app` 的 `CFBundleIdentifier = com.openai.codex`、`CFBundleDisplayName = ChatGPT`、`CFBundleAlternateNames = [Codex]`，旧聊天应用为 `ChatGPT Classic.app`（`com.openai.chat`）。（文档所说）
- Codex 仓库自己把它叫 "the Desktop app"：TUI 的 `/app` 命令说明是 "continue this session in the Desktop app"；Windows 上找 `OpenAI.Codex` 包，macOS 上用 `open` 打开 `codex://` 链接。`codex:tui/src/slash_command.rs:109`；`codex:tui/src/app/history_ui.rs:424-436,470,514-515`（源码核实）
- `codex app-server`：Codex 仓库里的 app-server 不按额度拦发送（见第 3.1 节），桌面 app 的闸门在它的前端（见第 3.4 节）。别的程序起的 `codex app-server`（比如 Osuna）会怎样，magpie 没有单独说。（app-server 不拦：源码核实；magpie 对此没有表态）
- 编辑器扩展（VS Code 的 `openai.chatgpt`）有没有同一道闸门，magpie 没说，也没查到。（未核实）

## 2. magpie 怎么判断「被扣住」，切过去、切回来各写什么

### 2.1 读什么、从哪拿、带什么凭证

- 读的是 ChatGPT 后端的 `GET https://chatgpt.com/backend-api/wham/usage`：`CodexBase` 去掉末尾的 `/codex`，再加 `/wham/usage`。请求头是 `Authorization: Bearer <access token>`、`chatgpt-account-id: <账号 id>`、`Accept: application/json`。`magpie:internal/provider/subscription_usage.go:571-590,961-967`；`magpie:internal/provider/account.go:998`（源码核实）
- 令牌来自 Codex 自己的登录。`readCodexLogin` 按 Codex 的 `cli_auth_credentials_store` 设置，读 `~/.codex/auth.json` 或 macOS 钥匙串里的 "Codex Auth" 条目；`ephemeral` 时读不到。`magpie:internal/provider/codex_store.go:43,510-530`（源码核实）
- 令牌 5 分钟内要过期时，magpie 自己找 OpenAI 换新令牌，再把轮换后的令牌写回 `auth.json` 或钥匙串（注释："so the new ones go back where Codex keeps its sign-in"）。`magpie:internal/provider/account.go:1050-1103`（源码核实）
- 「登录的是 ChatGPT」另有一处判断：`auth.json`（或钥匙串）里有 `tokens.access_token` 就算。`magpie:internal/agent/codex.go:1812-1831`（源码核实）
- 账号发现关掉时（设置项 `NoAccountDiscovery`，或环境变量 `MAGPIE_NO_ACCOUNTS`），上面的读取一律不做，账号列表为空。`magpie:internal/settings/accounts.go:12-25`；`magpie:internal/provider/logins.go:799-802`；`magpie:internal/provider/login_usage.go:78-81`；`magpie:internal/provider/codex_store.go:517-520`（源码核实）

### 2.2 阈值（`codexHeld`）

只看这次 `/wham/usage` 回答里的几个字段，不看窗口百分比。注释原文："A window's percent never says it: a Pro account reads 100% on its week and is not allowed, while its credits carry every turn on"。按顺序判断：

1. `rate_limit.allowed` 缺省或为 true：不算被扣住。
2. `credits.has_credits` 或 `credits.unlimited` 为 true：不算。
3. 工作区套餐（`codexWorkspacePlans` 列出的 free_workspace、team、business、enterprise 等，但去掉「预留实验」覆盖的 `team`、`self_serve_business_prolite`），且 `credits.overage_limit_reached` 明确为 false、`spend_control.reached` 不为 true、`rate_limit_reached_type.type` 缺省或为 `rate_limit_reached`：不算。
4. 其余情况：算被扣住。

注释说这是照 ChatGPT.app 26.930.61225 里发送框的两道判断写的：一道让 credits 放行，再让仍在超额范围内的工作区放行；另一道（`hardBlocked`）让 credits 放行、不认超额，用在预留实验的套餐上。界面看得到而用量接口看不到的情况，一律算被扣住，理由原文："wrongly held costs the app its ChatGPT extras while magpie serves the turn, wrongly not held leaves it sending nothing at all"。`magpie:internal/provider/subscription_usage.go:985-1073`（判断逻辑：源码核实；与 ChatGPT.app 的对应关系：文档所说）

- Codex 自己的 `/wham/usage` 数据模型里也有这些字段：`rate_limit.allowed`、`rate_limit.limit_reached`、`credits.has_credits`、`credits.unlimited`、`credits.balance`、`spend_control.reached`、`rate_limit_reached_type.type`。`credits.overage_limit_reached` 只出现在 magpie 的结构里，Codex 的模型没有。`codex:codex-backend-openapi-models/src/models/rate_limit_status_payload.rs:16-53`；`…/rate_limit_status_details.rs:17-19`；`…/credit_status_details.rs:15-20`；`…/spend_control_status_details.rs:17`（源码核实）
- 这次读失败、沿用上次读数时：上次因为某个窗口用满而算被扣住的，等那个窗口重置后就不算了；没有窗口用满却算被扣住的，要等下次读成功才变。`magpie:internal/provider/quota_last.go:148-162`；`magpie:docs/subsystems/agent-wiring.md:67`（源码核实）
- 只认 Codex 当前登录的那个账号（`l.Active`），且这次读没出错。读不到或出错，一律当作「不知道」，即没扣住。`magpie:internal/provider/login_usage.go:423-459`（源码核实）
- OpenAI 的说法与此一致：用完套餐内额度后从 credits 扣。定价页原文 "Credits let you continue using Codex after you reach your included usage limits"。openai/codex issue #8393 的回复说，加了 credits 以后 `/status` 仍显示 0% 剩余。（文档所说）

### 2.3 多久查一次，怎么触发改写

- 网关启动时起一个循环 `KeepOnAnAccountWithRoom`：启动 1 分钟后跑第一次，之后每 5 分钟（`loginSwitchEvery`）一次。每次先做多号切换，再跑 `noteCodexUsedUp(CodexUsedUp(ctx))`，每步最多等 1 分钟。`magpie:internal/gateway/gateway.go:542`；`magpie:internal/provider/codex_switch.go:45-46,313-358`（源码核实）
- `CodexUsedUp` 走 `LoginUsage`：一分钟内读过的（包括用量页刚读的）直接用缓存，否则现读。`magpie:internal/provider/login_usage.go:64-71,423-432`（源码核实）
- 结果变了（被扣住与有余量之间切换）才调 `catalog.Touched()`，它调 `catalog.Changed`。`catalog.Changed` 被设成 `agent.SyncCatalog`，后者对每个 agent 跑一遍 `Sync`。`magpie:internal/provider/codex_switch.go:318-328`；`magpie:internal/catalog/live.go:165-183`；`magpie:internal/cli/main.go:258`；`magpie:internal/agent/sync.go:35-66`（源码核实）
- Codex 的 `Sync`，以及用户在 magpie 里选模型时的 `set`，只用 `CodexUsedUpKnown()`：只看手上已有的读数，不联网。注释说保存路由分组时现读曾让保存多等 1.1 秒。目录有任何变化时 `Sync` 也会跑，用的是缓存里最近一次读数。`magpie:internal/agent/codex.go:1731-1742`；`magpie:internal/provider/login_usage.go:434-451`（源码核实）

### 2.4 什么时候切

`out()` 为真的条件：「sign-in」设置不是 `chatgpt`（一直 ChatGPT），且 `codexUsedUp()` 为真。`magpie:internal/agent/codex.go:654-660`（源码核实）

- `Sync` 里，当 config 的 `model` 是 magpie 的模型（带 `/` 且能解析到 magpie 的服务商）、sign-in 不是 `api`、`chatGPT()` 为真时：
  - 正走旁路（`openai_base_url` 指 magpie）、还不是服务商模式、且 `out()`：调 `set(m)`，改成服务商模式。
  - 已是服务商模式、stash 里 `codex.out = "1"`、且 `!out()`：调 `set(m)`，改回旁路。
  `magpie:internal/agent/codex.go:1165-1186`；`magpie:internal/agent/route.go:121-127`（源码核实）
- 用户在 magpie 里给 Codex 选 magpie 模型时（`set`），账号如果已被扣住，直接写服务商模式。`magpie:internal/agent/codex.go:961-1035`（源码核实）
- 不切的情况：
  - config 的 `model` 是 ChatGPT 自带模型。`Sync` 的条件要求 magpie 模型；`Join` 在 `out()` 时直接不接入。
  - sign-in 是 `chatgpt`。
  - sign-in 是 `api`：本来就是服务商模式。
  - `chatGPT()` 为假：没有 ChatGPT 登录，或从别的机器连网关。账号发现关掉时，按 magpie 上次的接法算，不自己改接法。
  `magpie:internal/agent/codex.go:308-329,1091-1093,1177`（源码核实）

### 2.5 改成服务商模式写什么（`set` 的 `chatgpt && out()` 分支）

- magpie 自己的 stash：记 `codex.out = "1"`，删 `codex.beside`。
- `~/.codex/config.toml`：
  - 写整张 `[model_providers.magpie]`：`name = "magpie"`、`base_url = <网关>/v1`、`wire_api = "responses"`、`experimental_bearer_token = <网关 key>`、内联 `http_headers = { x-openai-actor-authorization = "magpie" }`。
  - 顶层写 `model_provider = "magpie"`、`model_catalog_json = <magpie 的目录文件>`、`model = <magpie 模型>`。
  - `openai_base_url` 原来是空的或本来就是 magpie 的，就写成 `<网关>/backend-api/codex`。注释说是为了让在内置 openai 上开的旧线程重开后改选 magpie 模型时，请求也到 magpie。
- 写目录文件 `~/.codex/magpie-models.json`；把 CC Switch 的服务商表也指到 magpie；按模型调整推理强度。
- `magpie:internal/agent/codex.go:389-409,1002-1035`；`magpie:docs/reference.md:1979-1983`（源码核实）
- 不碰登录：文档原文 "Your ChatGPT sign-in is never touched."。`magpie:docs/reference.md:1994-1995`（文档所说；切换代码只写 config.toml、目录文件和 stash：源码核实）

### 2.6 改回旁路写什么（同一个 `set` 的 `chatgpt && !out()` 分支）

- stash：删 `codex.out`，记 `codex.beside = "1"`。
- `config.toml`：
  - 删顶层 `model_provider`、`model_catalog_json`，并删掉 magpie 的目录文件；文件里有用户手加的内容就留着。
  - `[model_providers.magpie]` 重写一遍、留着，给服务商模式期间开的线程用。
  - 写 `openai_base_url = <网关>/backend-api/codex`、`model = <magpie 模型>`。
  - CC Switch 的表照旧指向 magpie。
- `magpie:internal/agent/codex.go:276-290,441-450,969-1000`（源码核实）
- magpie 文档说，桌面 app 只在重启后才离开 ChatGPT 状态；Codex 启动时读模型列表，切换后要重启。`magpie:docs/subsystems/agent-wiring.md:96`；`magpie:docs/reference.md:1996`（文档所说）

### 2.7 「一直 ChatGPT」为什么不切

- 代码注释原文："never with the sign-in kept on ChatGPT (chatgpt), where the user would rather the Codex app wait for the account than leave its ChatGPT state"。`magpie:internal/agent/codex.go:655-659`（文档所说）
- magpie 说切过去的代价：
  - 桌面 app 进入 API 状态，不再是 ChatGPT 登录态，"durable threads" 和 remote control 都没了。
  - 服务商表没有 `requires_openai_auth` 时，Codex 的 `getAuthStatus` 不给令牌，Chrome 控制用不了（#1824）。
  `magpie:internal/agent/codex.go:43-52`；`magpie:docs/subsystems/agent-wiring.md:67,96`（文档所说）
- Codex 源码里能对上的部分：当前服务商 `requires_openai_auth = false` 时，`getAuthStatus` 返回 `auth_method: None`、`requires_openai_auth: false`，`account/read` 不报账号。`codex:app-server/src/request_processors/account_processor.rs:1135-1157`；`codex:model-provider/src/provider.rs:510-511`（源码核实）
- magpie 说不切的代价：桌面 app 在账号有余量前可能什么都不发；Codex CLI 照常经 `openai_base_url` 到 magpie，由 magpie 的路由和其他账号接。`magpie:docs/subsystems/agent-wiring.md:96`；`magpie:internal/agent/codex.go:1481`（文档所说）
- issue #48650 的报告者说他得保留 OpenAI 登录，因为要用桌面 app 的插件，原文 "Switching to an authless workflow does not meet that requirement"。（文档所说：用户报告）

## 3. Codex 客户端会不会在发请求之前自己拦下

结论：Codex 开源的部分（core、app-server、exec）不按额度拦，请求照常发出，由服务端回 429。TUI 是 app-server 的一个客户端，有两处「先把输入扣在队列里」的逻辑。整个发送框被禁用的是闭源的桌面 app。

### 3.1 core / app-server / exec：不拦（源码核实）

- core 只在拿到错误后处理：遇到 `UsageLimitReached` 时更新额度快照，然后返回错误。会话状态里存的 `latest_rate_limits` 只随 TokenCount 事件上报，没有地方拿它决定发不发。`codex:core/src/session/turn.rs:1797-1803`；`codex:core/src/state/session.rs:78,352-361`
- 在 core、codex-api、model-provider、models-manager、login 里 grep `has_credits|ordinary_usage_allowed|\.allowed\b|gpt-reserve|luna_reserve`，只命中测试和 429 的解析，没有按这些值决定是否发送的代码。
- app-server 处理 `turn/start` 的 `turn_processor.rs` 里没有任何额度相关引用。app-server 只提供 `account/rateLimits/read` 请求和 `account/rateLimits/updated` 通知；通知由每次响应带回的额度头触发。`codex:app-server/src/request_processors/account_processor.rs:197-204,1209-1310`；`codex:app-server/src/bespoke_event_handling.rs:1603-1620`
- `exec`（`codex exec`）里没有额度相关代码。

### 3.2 服务端怎么回，Codex 怎么处理（源码核实）

- HTTP 429、body 的 `error.type = "usage_limit_reached"`：变成 `UsageLimitReached`，带 plan_type、resets_at、额度快照、`x-codex-rate-limit-reached-type` 等。`usage_not_included` 变成 `UsageNotIncluded`；`insufficient_quota` 等变成 `QuotaExceeded`。`codex:codex-api/src/api_bridge.rs:185-231`
- 这几种都不重试，对外映射成 `codexErrorInfo: usageLimitExceeded`。提示文字如 "You’ve hit your usage limit. Upgrade to Pro (…), visit https://chatgpt.com/settings/usage to purchase more credits…"，工作区账号有专门的文字。`codex:protocol/src/error.rs:433-437,490-495,705-800`
- 每次响应头里的窗口头（如 `x-codex-primary-used-percent`）、`x-codex-credits-has-credits` / `-unlimited` / `-balance`、`x-codex-rate-limit-reached-type` 会被解析成额度快照。响应头里没有 `allowed`。`codex:codex-api/src/rate_limits.rs:57-100,188-193,218-232`

### 3.3 TUI 的两处暂扣（源码核实；`rust-v0.163.0` 也有）

TUI 用 `input_queue.rate_limit_recovery_pending` 决定提交现在发不发：为真时，新提交和排队的提交都只进队列，不发 `turn/start`。`codex:tui/src/chatwidget/input_flow.rs:63-67,178-182,243-250`；`codex:tui/src/chatwidget/startup_submission.rs:55`；`codex:tui/src/chatwidget/input_queue.rs:53-54`

(1) 出错后的短暂扣住

- 触发有两种。一是本轮收到额度错误，且 `has_chatgpt_account`，TUI 发一次 Recovery 读取（`codex:tui/src/chatwidget/turn_runtime.rs:511-515`）。二是 `account/rateLimits/updated` 通知里是工作区硬停（credits 用完、工作区用量上限、spend control），且 `has_chatgpt_account`（`codex:tui/src/app/app_server_events.rs:347-368`）。
- 发 Recovery 读取时置为扣住。读到结果后放开，并把队列里的发出去；成功、失败都放开，读取 15 秒超时。`codex:tui/src/app/background_requests.rs:37-38,107-139`；`codex:tui/src/app/event_dispatch.rs:1971-1978`；`codex:tui/src/chatwidget/rate_limits.rs:220-231`
- 测试 `backend_banner_rolling_only_recovery_holds_new_input`：收到硬停通知后按回车只进队列，读取完成后照常发出。`codex:tui/src/app/tests/backend_banner_recovery_tests.rs:297-345`

(2) Luna Reserve 实验

- TUI 读额度时带 `supports_luna_reserve: true`。app-server 只在 ChatGPT 登录（`AuthMode::Chatgpt`）且不是 FedRAMP 账号时，给 `/wham/usage` 加请求头 `x-openai-codex-luna-reserve: 1`。`codex:tui/src/app/background_requests.rs:815-826`；`codex:app-server/src/request_processors/account_processor.rs:1233-1241`；`codex:backend-client/src/client/rate_limit_resets.rs:29-32,70-78`
- 后端回 `rate_limit_upsell.banner_type = "luna_reserve"` 时，只要当前模型不是 `gpt-reserve`，`waiting_for_luna_reserve()` 就为真，TUI 一直扣住提交。注释说："The backend emits this banner only after ordinary usage is exhausted and Reserve is available"。app-server 只在回答里的账号 id、用户 id 与当前登录一致时才把横幅转给客户端。`codex:tui/src/chatwidget/backend_banners.rs:73-80,144-145,312-363`；`codex:tui/src/model_catalog.rs:7`；`codex:app-server/src/request_processors/account_processor.rs:1286-1300`
- TUI 会试着把这条线程自动换到 `gpt-reserve`，条件是 `has_chatgpt_account && requires_openai_auth`、`gpt-reserve` 在模型目录里。换成了就发；换不了就弹出恢复选项，选项是后端给的按钮（加 credits 等）。`codex:tui/src/chatwidget/backend_banners.rs:82-171`；`codex:tui/src/app/backend_banner_fallback.rs:46-118`
- 下一次读数说普通额度恢复（`ordinary_usage_allowed = true` 或有 credits，且没有 upsell、没有 spend control、没有 reached type）后，自动换回原模型。`codex:tui/src/chatwidget/backend_banners.rs:312-331`

TUI 的条件里有什么、没有什么：

- 有：ChatGPT 登录（`has_chatgpt_account`）。开机预取和定时读取还要求 `requires_openai_auth`，即当前服务商要求 OpenAI 登录：内置 openai 加 `openai_base_url` 时为真；`model_provider` 指向一张没有 `requires_openai_auth` 的表时为假。`codex:tui/src/app/startup.rs:1153-1166`；`codex:tui/src/chatwidget/rate_limits.rs:419-421`；`codex:tui/src/lib.rs:1349-1352`
- 没有：`openai_base_url` 指向哪里。额度读取走 `chatgpt_base_url`，与 `openai_base_url` 无关（`codex-wiring.md` 第 3 题）。也没有「当前模型是不是 ChatGPT 自带模型」：`waiting_for_luna_reserve` 只比较是不是 `gpt-reserve`，Recovery 暂扣不看模型。
- 所以：(1) 只是短暂排队，至多 15 秒，之后第三方模型照常发。(2) 如果后端把这个号放进 Reserve 实验，选第三方模型也会被扣住，或被换成 `gpt-reserve`。（两段代码路径：源码核实；某个号会不会收到 `luna_reserve`、实际界面怎么走：由后端决定，未核实）

### 3.4 桌面 app（闭源）的发送闸门

- magpie：桌面 app 对被扣住的账号 "sends nothing at all … whichever model the turn is on"。`Sync` 的注释："the Codex app then sends nothing, a magpie model's turn included, in a new thread or an old one (#540)"。`magpie:internal/provider/subscription_usage.go:1033-1043`；`magpie:internal/agent/codex.go:1170-1176`（文档所说）
- openai/codex issue #48816（open；标签 bug、rate-limits、custom-model、app；桌面 app 26.924.22138，自带 app-server `codex-cli 0.158.0-alpha.2.1`）：
  - 报告者用 `openai_base_url` + `model_catalog_json` 接本机路由。Plus 额度用完后发送按钮变灰，提示 "Messages limit reached"；同一份配置在 CLI 里能正常发。
  - 他从 `app.asar` 的 `/webview/assets/app-primary-*.js` 摘出闸门：发送框的 `submitDisabled` 里有一个「ChatGPT 订阅被限」的判断，条件是 `authMethod === 'chatgpt'`、`/wham/usage` 回答的账号 id / 用户 id / 套餐与当前登录一致、`rate_limit.allowed === false`，再排除两个判断（看起来是 credits 与工作区超额）；另外还有一道 `hardBlocked`。
  - 他说这个判断只看 ChatGPT 的 `/wham/usage`，不看 `openai_base_url`、服务商或模型目录；改用 API key 登录（`authMethod` 不是 chatgpt）就不拦。
  （文档所说：用户逆向，未核实；与 magpie `codexHeld` 的描述吻合）
- issue #48369（open，同样的标签，桌面 app 26.917.62051 到 26.1007.x）及 #48650、#43333：
  - 用户报告 OpenAI 额度用完后，选第三方模型（`model_provider` 指自定义表，或 `openai_base_url` + `model_catalog_json`），新旧任务都发不出去。
  - 多人说 CLI 不受影响（"The CLI is unaffected"、"命令行版本可以用"）。报告者称 26.917.62051 之前切到第三方服务商还能发，这是回归。
  - 其中一条评论（hgocmenes，26.924.22138，Windows）说服务商设了 `requires_openai_auth = false` 并重启 app 后，仍报额度错误、不执行。这与 magpie「改成服务商模式 app 就能发」的说法冲突。
  （文档所说：用户报告，未核实）

### 3.5 汇总

| 客户端 | 额度和 credits 都用完时，发请求前拦不拦 | `openai_base_url` 指别处时 | 选非 ChatGPT 模型时 | 依据 |
| --- | --- | --- | --- | --- |
| core / `codex app-server`（Osuna 用的就是它）/ `codex exec` | 不拦，照发；ChatGPT 后端回 429 `usage_limit_reached` | 照发到那个地址，由那边回答 | 照发 | 源码核实 |
| TUI | 出错后排队至多 15 秒再发；后端给 `luna_reserve` 时一直扣住，或换到 `gpt-reserve` | 一样（额度读取不走 `openai_base_url`） | 一样（条件不看模型） | 源码核实；Reserve 由后端决定 |
| 桌面 app（ChatGPT.app） | 发送框禁用 | 一样拦（报告） | 一样拦（报告） | magpie 文档与 issue，未核实 |

## 4. Osuna 现在怎么拿 Codex 的套餐用量

- 来源是内置插件 `plugins/codex-usage-source`，随上游 Paseo v0.11 带来（ADR 0006），在 daemon 里注册为 `id: "codex"` 的套餐用量来源。`osuna:plugins/codex-usage-source/index.server.ts:5-15`；`osuna:docs/adr/0006-usage-in-code-is-upstream-plan-usage.md:3`（源码核实）
- 读凭证：直接读 Codex 的 `auth.json`（`$CODEX_HOME/auth.json` 和 `~/.codex/auth.json`），取 `tokens.access_token`、`tokens.account_id`、`tokens.id_token`；另外读 OpenCode、Pi、OMP 存的 OpenAI 登录。不读 macOS 钥匙串，所以 Codex 设了 `cli_auth_credentials_store = "keyring"` 时找不到账号。`osuna:plugins/codex-usage-source/server/usage.ts:18-26,81-102,133-151`；`codex:config/src/types.rs:136-146`（源码核实）
- 按 Agent 找账号时：Codex Agent 的启动环境里有 `OPENAI_BASE_URL` 环境变量就不认账号。看的是环境变量，不是 config.toml 的 `openai_base_url`。`osuna:plugins/codex-usage-source/server/usage.ts:104-117`（源码核实）
- 发请求：插件自己 `GET https://chatgpt.com/backend-api/wham/usage`，带 `Authorization: Bearer <access_token>`、`ChatGPT-Account-Id`、`Accept: application/json` 和一个浏览器 UA，15 秒超时。401/403 记为 "rejected"，提示运行 codex 去刷新；插件不自己换令牌，也不写回。`osuna:plugins/codex-usage-source/server/usage.ts:187-213`（源码核实）
- 解析：只取 `plan_type`、`email`、`rate_limit.primary_window` / `secondary_window`（`used_percent`、`reset_at`、`limit_window_seconds`）、`additional_rate_limits`、`code_review_rate_limit`、`credits.balance`。zod 对象默认丢掉没声明的字段，所以 `rate_limit.allowed`、`rate_limit.limit_reached`、`credits.has_credits`、`credits.unlimited`、`credits.overage_limit_reached`、`spend_control`、`rate_limit_reached_type` 都没留下。`osuna:plugins/codex-usage-source/server/usage.ts:27-52,214-253`（源码核实）
- 不经 app-server：Osuna server 里没有任何地方调 `account/rateLimits/read` 或 `account/read`，也不处理 `account/rateLimits/updated` 通知。Codex 轮次失败时只按 `turn.error.message` 发 `turn_failed`。`…/codex-app-server-agent.ts:2713-2720,6169-6190`（源码核实：grep `rateLimits`、`"account/` 无结果）
- 什么时候拉：按需。客户端打开相关界面时请求（React Query 的 staleTime 60 秒，手动刷新强制重拉）；daemon 侧每个账号缓存 5 分钟，单次 20 秒截止。daemon 侧没有定时轮询。`osuna:packages/server/src/server/plugins/usage-sources/index.ts:52-67,236-272`；`osuna:packages/app/src/usage/queries.ts:36,116-121`（源码核实）
- 术语表对套餐用量的定义是 "Fetched from the provider's account API with the CLI's stored login"。`osuna:docs/glossary.md:71`（文档所说）。ADR 0004 的 "`~/.codex/auth.json` is never read or written" 写在第三方接口改写 CLI 配置那一节里；套餐用量插件是另一条读取路径。`osuna:docs/adr/0004-api-endpoint-rewrites-cli-config.md:17`（ADR：文档所说；插件读 auth.json：源码核实）

能不能据此判断「额度窗口和 credits 都用完」：

- 照现有解析不能照 magpie 的标准判断。现有数据只有窗口百分比和 `credits.balance`；magpie 和 Codex 都明确说百分比不能说明被扣住。
  - `magpie:internal/provider/subscription_usage.go:1039-1041`
  - TUI 注释 "Percentages are rounded by the protocol; 100% alone does not prove a hard stop"，`codex:tui/src/chatwidget/usage_notice.rs:39`
  - 协议注释 "clients must not infer recovery from percentages or reset times"，`codex:app-server-protocol/src/protocol/v2/account.rs:333`
  （源码核实）
- 插件拿到的同一个回答里就有需要的字段（`allowed`、`has_credits`、`unlimited` 等，见第 2.2 节），多解析几个字段就能拿到。`overage_limit_reached` 是否每次都有，只有 magpie 的说法。（字段存在：magpie 与 Codex 两边源码；是否总出现：未核实）
- 另一条路是 Codex app-server 的 `account/rateLimits/read`：
  - 由 Codex 进程用自己存的登录去请求 `{chatgpt_base_url}/wham/usage`。
  - 返回 `ordinaryUsageAllowed`（即 `rate_limit.allowed`；账号 id 或用户 id 对不上时为 null）、`rateLimits.credits.{hasCredits, unlimited, balance}`、`spendControlReached`、`rateLimitReachedType`、`planType`。没有 `overage_limit_reached`。
  - 只要求 Codex 是 ChatGPT 一类登录，不看当前服务商。
  - 调用时 Codex 可能按自己的规则顺手刷新令牌，写的是它自己的登录存储。
  `codex:app-server/src/request_processors/account_processor.rs:1209-1310`；`codex:backend-client/src/client/rate_limit_resets.rs:34-67,124-129`；`codex:app-server-protocol/src/protocol/v2/account.rs:311-345,660-680,770-778`；`codex:login/src/auth/manager.rs:2397-2411,3030-3048`（源码核实）

## 5. 综合（只列事实和后果）

### 5.1 照 magpie 做，要读哪些数据

| 要知道的 | magpie 怎么拿 | Osuna 现有或可用的来源 | 谁接触登录凭证 |
| --- | --- | --- | --- |
| Codex 是不是 ChatGPT 登录 | 读 auth.json 或钥匙串，看有没有 access token | ① 套餐用量插件同样读 auth.json；② app-server `account/read`，只在当前服务商要求 OpenAI 登录时报账号，服务商模式下报不出；③ `account/rateLimits/read` 不是 ChatGPT 登录时报错 | ① Osuna 读文件；②③ Osuna 不读文件，Codex 进程读 |
| 账号是否被扣住 | 读 auth.json 或钥匙串的令牌，自己请求 `/wham/usage`，按 `codexHeld` 判 | ① 插件已请求同一接口，但丢了所需字段；② `account/rateLimits/read`，缺 overage 字段；③ 中转站转发 ChatGPT 自带模型时，能看到响应里的额度头和 429 `usage_limit_reached`，但没有 `allowed`，且只有用户正在用 ChatGPT 模型时才有 | ① Osuna 拿着令牌发请求；② Codex 拿着令牌发请求；③ 中转站经手请求里的 ChatGPT 令牌（`codex-wiring.md` 第 3、8 题） |
| 多久查一次 | 每 5 分钟，启动后 1 分钟开始 | Osuna 现在没有定时读，套餐用量只按需拉、缓存 5 分钟 | — |

magpie 与 Osuna 的现状、Codex app-server 的行为：源码核实。第 ③ 项的中转站部分是推断：Osuna 中转站现在还不服务 `/backend-api/codex`（`codex-wiring.md` 第 12 题）。

### 5.2 改写本身碰不碰登录

- magpie 的切换只写 `config.toml`（`model_provider`、`model_catalog_json`、`model`、`openai_base_url`、服务商表）、目录文件和自己的 stash，不写 `auth.json`。（源码核实，第 2.5、2.6 节）
- 碰登录的是「判断」这一步：magpie 读令牌，令牌快过期时自己刷新，并把新令牌写回 `auth.json` 或钥匙串。（源码核实，第 2.1 节）
- 总任务的规矩：只有子任务 9 改写 CLI 登录信息；子任务 8 的总开关管住所有读取，关掉后所有读 CLI 登录的功能（套餐用量来源、多号自动轮换）都停；其余子任务不碰登录。`osuna:.atw/tasks/10-16-magpie-osuna-gaps/prd.md:162,199,206,251`（文档所说）
- magpie 在账号发现关掉时判不出被扣住（账号列表为空，一律当作没扣住），所以不会切；`chatGPT()` 按上次的接法算，不自己改接法。（源码核实，第 2.1、2.4 节）
- 新增定时请求：总任务要求新增的每一类对外请求写进 `docs/usage.md` 的 Outbound requests 一节。`osuna:.atw/tasks/10-16-magpie-osuna-gaps/prd.md:193`（文档所说）

### 5.3 做的话的后果

- 这个切换只改变桌面 app 能不能发。Osuna 自己起的 app-server 不拦发送；终端 TUI 只有第 3.3 节的两处暂扣，没有「额度用完就整个不发」的闸门。受影响的是和 Osuna 共用 `~/.codex/config.toml` 的桌面 app 用户。（源码核实）
- 切换要等桌面 app 重启才生效：magpie 文档说 app 只在重启后离开 ChatGPT 状态，Codex 启动时读模型列表。（文档所说）
- 服务商模式期间，桌面 app 没有 ChatGPT 状态下的功能（durable threads、remote control、Chrome 控制等），这是 magpie 设「一直 ChatGPT」一档的理由。（文档所说）
- 服务商模式下 `requires_openai_auth` 为假，TUI 不做开机预取和定时读取，也就不会进入 Luna Reserve 暂扣。（源码核实，第 3.3 节）
- 服务商模式期间新开的 Codex 线程（Osuna、终端、桌面 app 都一样）记在独立服务商名下。Codex 按服务商分组列线程，按线程记的服务商恢复，表删了就报 "Model provider … not found"（`codex-wiring.md` 第 1、2 题）。所以切回旁路后，这些线程和 openai 名下的线程分开列，独立服务商表也得一直留着。本任务想用 `openai_base_url` 解决的「开关前后对话互相看不见」，在这段时间开的线程上会再出现。（推断，依据已核实的 Codex 行为）
- issue #48369 有一条用户报告说，服务商设 `requires_openai_auth = false` 并重启后桌面 app 仍不能发，与 magpie 的说法冲突。切过去是否真能解开桌面 app，没核实。（文档所说）
- 需要一个后台定时读额度的新请求，以及读取登录（第 5.1 节），受子任务 8 的总开关管。magpie 的做法是开关关掉就不切。

### 5.4 不做的话，额度和 credits 都用完时用户看到什么

- Osuna 里的 Codex Agent：Osuna 不读额度，也不拦发送（`…/codex-app-server-agent.ts` 里没有额度相关代码，源码核实）。
  - 选第三方模型：请求经 `openai_base_url` 到 Osuna 中转站，由第三方接口回答，照常能用。（推断：前提是中转站服务 `/backend-api/codex/responses` 上的第三方模型请求，这是本任务待做的部分）
  - 选 ChatGPT 自带模型：中转站转给 chatgpt.com，回 429 `usage_limit_reached`；Codex 不重试，这一轮失败，Osuna 显示 `turn_failed`，文字是 Codex 的 "You’ve hit your usage limit…"。（Codex 与 Osuna 两段：源码核实；中转站原样透传 429：推断）总任务 PRD 里，子任务 9 第二层（换号）要在这里接手。（文档所说）
- 终端 TUI：同上。收到额度错误后，新输入先排队至多 15 秒再发。如果后端把这个号放进 Luna Reserve 实验，TUI 会扣住输入，或把线程换到 `gpt-reserve`，选第三方模型时也一样。（源码核实；是否触发由后端决定）
- 桌面 app（与 Osuna 共用同一份 config.toml）：发送框禁用（"Messages limit reached" / "Codex and Work usage exhausted"），第三方模型也发不出，新旧任务都一样。直到账号恢复、买了 credits，或改用 API key 登录（issue #48816 说的绕法）。magpie 的「一直 ChatGPT」一档接受的就是这个结果。（文档所说：magpie 文档与 GitHub issue，未核实）

---

## 没能核实的地方

- 桌面 app（ChatGPT.app / Codex app）闭源。它的发送闸门条件、会不会随 `model_provider` / `requires_openai_auth` 解开、要不要重启，全部来自 magpie 的注释和 GitHub issue 里用户的逆向与报告。没有自己读它的前端包，也没运行。issue #48369 的一条评论与 magpie 的说法冲突。
- 编辑器扩展（VS Code 的 `openai.chatgpt`）有没有同一道闸门。
- TUI 的 Luna Reserve：哪些账号、什么时候会收到 `luna_reserve` 横幅，由后端决定。`gpt-reserve` 会不会出现在经中转站合并的模型目录里、TUI 会不会把第三方模型换成它，没验证。
- magpie `codexHeld` 与桌面 app 26.930.61225 的对应关系，以及 `overage_limit_reached` 是否每次都在 `/wham/usage` 里，只有 magpie 的说法；Codex 的 `/wham/usage` 模型没有这个字段。
- 账号被扣住时，chatgpt.com 对经 `openai_base_url` 转来的 ChatGPT 自带模型请求具体回什么（是不是总是 429 `usage_limit_reached`），是按 Codex 的解析代码推断的，没实测。
- Osuna 中转站现在还不服务 `/backend-api/codex/…`（`codex-wiring.md` 第 12 题）。第 5.4 节里第三方模型「照常能用」的前提，是本任务把这部分做出来。
- 没有在真实 Codex 上跑过任何一条路径（按禁令不运行 codex）。
