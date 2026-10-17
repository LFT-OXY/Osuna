# 订阅当服务商的封号风险

回答第 3 轮访谈 Q4（`decisions.md`）：magpie 的「订阅当服务商」算不算反代、和 Pi 那种登录官方账号是不是一回事、各家会不会封号，以及 Osuna 现在在哪一级。只写事实和风险分级，不给做不做的建议，也不给实现方案。

## 说明

**日期**：2026-10-16。下文网页按编号 `[W#]` 引用，网址和访问日期在第 9 节，访问日期都是 2026-10-16。源码写 `文件:行号`。

**版本与路径**

- magpie：`M/` = `/Users/oxy/Documents/Configuration/dev-environment/demo/agent客户端源码/magpie/`，HEAD `7597c132`（2026-10-16）。
- Pi：`badlogic/pi-mono` 已迁到 `earendil-works/pi`（克隆时的 origin 就是它，CHANGELOG 里的旧条目仍链到 badlogic/pi-mono）。按 HEAD `4954d760`（2026-10-15）只读浅克隆，记作 `pi@4954d760:路径:行号`。
- OpenCode：`anomalyco/opencode` HEAD `37e3912d`（2026-10-16），只读稀疏克隆，记作 `oc@37e3912d:路径:行号`。
- Osuna：`O/` = 本仓库，HEAD `21a4f721d`。

**标记**

- 【原文】：条款、官方文档、厂商员工公开发言的原话。保留英文，括号里是中文意思。
- 【推测】：我的解读或推断。
- 【线索】：社区自述，无法核实，只当线索。

**联网工具**：按用户全局规定，英文与技术检索用 Exa（`mcporter call 'exa.*'`），中文与实时检索用 grok-search。换过三次工具：

1. grok 搜「Tibo 谈 sub2api」时超时（返回 `grok_timeout`），改用 Exa 找到原帖地址，再用 grok 的 `web_fetch` 读 X 原帖。
2. Exa 读 `unrollnow.com` 和 `x.com` 失败（`CRAWL_HTTP_503`、`SOURCE_NOT_AVAILABLE`），改用 grok `web_fetch`。
3. Exa 读到的 `antigravity.google/docs/faq.md` 是旧版，没有 `agy -p` 那一段。改读 HTML 版 `.../docs/faq/`，Exa 和 grok 各读一次，内容一致。

**没做的事**：没有登录任何账号，没有运行任何 CLI 的登录或认证命令，没有读取或打印任何真实 token、钥匙串内容或 `auth.json` 内容。

---

## 0. 先回答：这算不算反代

- **magpie 的「订阅当服务商」是本机的「订阅转接口」反代。**
  - 本机网关监听 `127.0.0.1:3425`，对外提供 `/v1/chat/completions`、`/v1/responses`、`/v1/messages`、`/v1beta/models/{model}:generateContent` 四种接口（`M/docs/reference.md:1651`、`:1681-1685`）。
  - 登录着的订阅变成 provider，模型以 `claude/…`、`codex/…`、`copilot/…` 出现在其他所有 Agent 的模型列表里（`M/docs/reference.md:1589-1605`）。README 原话：「你登录过的 Agent 背后就是一个带模型的订阅，magpie 把它当成 provider 给其他所有 Agent 用。每个订阅可以加多个账号，magpie 会在它们之间自动切换。」（`M/README.zh-CN.md:139`）
  - Claude 一路的后端是本机真 `claude` 进程，其余各家是 magpie 自己拿 OAuth token 直连厂商私有后端（第 2 节）。
  - 默认只服务本机。打开「Share on local network」后可发 gateway key 给别的客户端，key 能限定到某个订阅账号（例如 `codex/me@example.com`），还能经 Cloudflare Tunnel 对外（`M/docs/reference.md:487-499`、`:586-600`、`:665-675`）。【推测】这样用时，它和 sub2api、CLIProxyAPI 是同一类。
  - 它发给客户端的是 magpie 自己的 gateway key，不是厂商的 API key。
- **Pi 不是反代。** Pi 本身就是 Agent。它拿 OAuth 登录后只给自己发请求，不对外暴露接口（第 3 节）。按第 6 节的分法属于 (c)。
- **厂商把两者分开对待，OpenAI 说得最明白。**
  - 【原文】OpenAI Codex 负责人 Tibo，2026-08-21 [W24]："Converting a subscription into api traffic to then re-serve or share across many users is not something we support and this type of usage gets flagged by our fraud-prevention systems. You are completely fine if you use your subscription through Sign in With ChatGPT, either through the official clients or through one of the many OSS clients (Pi, OpenCode, ...)"（把订阅转成 API 流量再给许多用户用，官方不支持，会被反欺诈系统标记；在官方客户端或 Pi、OpenCode 等开源客户端里用自己的订阅完全没问题。）
  - OpenAI 的「Sign in with ChatGPT」条款还明确要求，接入的应用不得把用户套餐当通用接口给别的工具用（4.2 节）。
  - Anthropic 和 Google 对 (c) 本身就不许（4.1、4.4 节）。

## 1. 风险分级总表

等级是我按条款原文和已知处理事件给的分级，依据见第 4–6 节。

| 做法 | Anthropic | OpenAI | GitHub Copilot | Google（Gemini CLI / Antigravity） | xAI |
|---|---|---|---|---|---|
| (a) 官方 CLI 用自己的登录，由本机应用驱动（Osuna 现在的做法） | 低：法律页写明不妨碍用户在未改动的 Claude Code 里登录自己的订阅 | 低：Codex app-server 文档写明可嵌入自家产品 | 低：Copilot CLI 的 ACP 服务文档给了客户端集成示例 | Antigravity 中：FAQ 写明把 `agy` 包进第三方应用不在消费者套餐支持范围；Gemini CLI 未见官方答复 | 低：Grok Build 写明 ACP 可用于自建编排应用 |
| (b) 后台驱动官方 CLI，替别的 Agent 回答（magpie 的 Claude 做法） | 中高：没有官方许可；11-12 生效的新使用政策禁止「经消费者订阅转发请求」「谎报所用产品或客户端」的服务；有用户自述被封 | 未见说法 | 未见说法 | Antigravity 同上，不支持 | ACP 编排被允许，但未见「当模型接口给别的 Agent 用」的说法 |
| (c) 第三方工具拿 OAuth token 直连私有后端（magpie 其余各家、Pi） | 高：不许第三方提供 Claude.ai 登录；2026-01 封号潮后改成计入额外用量；新政策禁止冒充客户端 | 低：开源客户端如实标识、自用，官方背书；冒充 Codex CLI、给别的工具当通用接口不在背书范围 | 中：官方只认合作方，合作方用各自的 OAuth 应用；借 VS Code 的客户端 ID 不在其列；有停用 Copilot 的邮件 | 很高：文档写明违规、可封号；2026-02 封号潮；二次违规永久封 | 中（信息少）：只有 OpenCode 是官方集成；AUP 禁止未授权的自动化访问 |
| (d) 转成 API 给别人用、多人共享、售卖（sub2api、CLIProxyAPI 号池） | 很高 | 很高：Tibo 原话会被反欺诈系统标记 | 很高 | 很高 | 很高 |
| 同一个人多账号自动轮换 | 加重：条款间接覆盖 | 加重：SIWC 条款点名禁止 | 加重：GitHub 停用邮件点名 | 加重：Antigravity FAQ 点名 | 加重：AUP 禁止规避速率限制 |

---

## 2. magpie 每家订阅的做法（以源码为准）

### 2.1 逐家对照

| 订阅 | 凭据来源与 client_id | 请求发往 | 对厂商自称 | 是否写回 Agent 的登录 | 添加前警告 |
|---|---|---|---|---|---|
| Claude | 由 Claude Code 自己登录（`M/docs/subsystems/providers-accounts.md:38`） | 本机真 `claude` 进程替它发 | 真 Claude Code | 多账号时把已存账号的凭据换进 Claude Code 的存储，被换下的存进 `logins.json`（`providers-accounts.md:37`；写入函数 `M/internal/provider/account.go:635`） | 有 |
| ChatGPT（Codex） | 读 `~/.codex/auth.json` 或 Codex 的钥匙串项（`providers-accounts.md:35`）；client_id 是 Codex CLI 自己的 `app_EMoamEEZ73f0CkXaXp7hrann`（`account.go:982`）；也能在 magpie 里走 Codex 的浏览器登录，带 `originator=codex_cli_rs`（`M/internal/provider/signin.go:351,357,359`） | `https://chatgpt.com/backend-api/codex`（`account.go:998`） | `originator: codex_cli_rs`，加 Codex CLI 的 User-Agent（`M/internal/provider/codex_request.go:42,47,85-95`） | 写回：刷新后把轮换的 token 写回 `auth.json` 或钥匙串（`account.go:1136`；`M/internal/provider/codex_store.go:569-590`；`providers-accounts.md:34`）；切号时改写 Codex 的登录（`codex_store.go:597`） | 无（`M/internal/gui/assets/app.js:11580`） |
| ChatGPT API | OpenAI「Sign in with ChatGPT」开源流程：`client_id=dynamic_agent_client`、`agent_name_hint=magpie`、scope 含 `chatgpt.tokens.use.direct`（`M/internal/provider/chatgpt_api.go:3-17,61-64`） | `https://api.openai.com/v1`（`chatgpt_api.go:51`） | 如实自称 magpie | token 存 magpie 自己的 `logins.json`，可存多个账号并切换（`chatgpt_api.go:101-118`） | 无，只有提示语（`app.js:11582-11583`） |
| Copilot | 读编辑器或 Copilot CLI 的 GitHub 登录（`providers-accounts.md:203`）；magpie 里用设备码登录，client_id `Iv1.b507a08c87ecfe98`，源码注释为 "the OAuth app of Copilot's editors"（`M/internal/provider/copilot_signin.go:31-32`） | 先到 `api.github.com/copilot_internal/v2/token` 换会话 token，再发 `api.githubcopilot.com`（`account.go:1173,1175`） | `Editor-Version: vscode/1.140.0`、`Copilot-Integration-Id: vscode-chat`、`User-Agent: GitHubCopilotChat/0.68.0`（`account.go:1177-1182`）；用 CLI 的登录时自称 `copilot/1.0.88`（`M/internal/provider/copilot_cli.go:32-37`） | 编辑器的登录不动；magpie 自己登录的号存在 magpie | 无（`app.js:11589`） |
| Gemini CLI | 只读 `~/.gemini/oauth_creds.json`，或在 magpie 里用 Gemini CLI 自己的 OAuth 客户端登录，client_id `681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com`（`M/internal/provider/google.go:1-14,70-79`） | Code Assist 后端 `cloudcode-pa.googleapis.com`（`google.go:65`） | `GeminiCLI/0.61.0/<模型> (…; terminal)`（`google.go:382-392`） | 不写 `~/.gemini`，token 在内存里刷新（`google.go:7-9`） | 无（`app.js:11628`） |
| Antigravity | Antigravity 自己的 OAuth 客户端 `1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com`（`google.go:81-88`）；可从 Antigravity Cockpit、Antigravity Manager、CLIProxyAPI 的导出文件导入（`providers-accounts.md:39`） | `daily-cloudcode-pa.googleapis.com`（`google.go:66,99`） | `antigravity/hub/<最新版本号>`，版本号向 Antigravity 的更新服务查（`google.go:384`） | token 存 magpie | 有 |
| Grok（SuperGrok） | 用 Grok Build CLI 自己的 `login`（`M/internal/provider/grok.go:12-16`） | `cli-chat-proxy.grok.com/v1`（`M/internal/provider/grok_usage.go:23`） | `x-xai-token-auth: xai-grok-cli`、`x-grok-client-identifier: grok-shell`、`User-Agent: grok-shell/…`（`grok.go:604-621`） | 已迁到社区插件 `@magpie-community/opencode-grok-auth`（`M/AGENTS.md:38`） | 无（`app.js:11587`） |

为什么冒充 Codex CLI，源码注释给了理由。【原文】`codex_request.go:23-27`："the backend serves Codex's clients, and gates its newest models on a User-Agent that names one"（后端只给 Codex 的客户端服务，按 User-Agent 放行最新模型）。

以上每一家在 magpie 里都会经本机网关给任意 Agent 用（第 0 节第一条）。

### 2.2 Claude 这一路为什么驱动真 `claude`

- **怎么跑**：
  - 启动参数是 `claude -p --output-format stream-json --input-format stream-json … --tools <WebSearch 或空> --strict-mcp-config --mcp-config … --setting-sources "" --dangerously-skip-permissions`（`M/internal/gateway/claude_subscription.go:1839-1859`）。
  - 调用方的工具由 `magpie claude-mcp-helper` 交回网关（`M/internal/claudebridge/mcp.go:1-3`；`M/docs/subsystems/claude-subscription-bridge.md:38-54`）。
  - 调用方的 system prompt 被包进用户消息里的 `<external_system_instructions>`（`claude_subscription.go:2473-2493`）。
- **magpie 自己写的理由**：
  - 【原文】`claude_subscription.go:3-7`："Claude Subscription is driven through the genuine Claude Code binary rather than by replaying its OAuth token over HTTP. Anthropic applies subscription eligibility checks to request content (not just credentials/CCH); prompts generated by Pi, OpenCode and other harnesses can otherwise be routed to Extra Usage."（不重放 OAuth token，改为驱动真 Claude Code；Anthropic 会按请求内容判断算不算订阅用量，Pi、OpenCode 等生成的提示词否则会被算进额外用量。）
  - 【原文】`M/docs/reference.md:1608-1616`："Anthropic classifies another agent's system prompt as third-party traffic even when the OAuth request otherwise looks like Claude Code. … The generated harness stays out of Anthropic's system-prompt classifier while its instructions remain part of the user context."
  - 【推测】这条路的作用，是让别的 Agent 的请求在 Anthropic 看来是 Claude Code 自己的用量。
- **magpie 不拿 Claude 的 token 直接找 Anthropic**：
  - 【原文】`M/internal/provider/account.go:339-341`："magpie never does with a Claude sign-in"。
  - 额度只靠跑 Claude Code 的 `/usage` 读（`M/docs/reference.md:1571-1585`）。
  - 2026-10-01 的提交 `9bf6d435` 去掉了「magpie 自己拿账号 token 定时调 Anthropic 的 `/api/oauth/usage`」。提交说明引用用户原话「不要伪造任何的 Claude 请求，能否通过 claude cli 获取 / 我害怕被封」，同时加上添加 Claude 账号前的封号警告。

### 2.3 多账号、导入、预热（加重因素）

- **多账号**
  - `logins.json` 记住见过的 Codex 和 Claude Code 账号（`providers-accounts.md:37`）。
  - 网关内：一个账号额度用完，同一请求在首字前交给下一个账号（`M/docs/reference.md:1374-1395`）。
  - 网关外：用完就把 Codex 或 Claude Code 登录到下一个账号，原账号恢复后切回（`M/internal/provider/codex_switch.go:3-27,145,218`）。
- **导入**
  - 能导入 CLIProxyAPI、Sub2API、codexbar、Cockpit Tools 的文件。
  - ChatGPT 和 Google 的登录导入前先刷新一次，来源工具因此被登出（`providers-accounts.md:39`；`M/docs/reference.md:1632-1647`）。
  - magpie 文档写明「Each refresh token has exactly one holder」（`providers-accounts.md:194`）。
- **每日预热**：在选定时间或窗口刚重置时，给每个 Claude、ChatGPT 账号发最小请求，启动 5 小时窗口（`M/README.zh-CN.md:146`）。

### 2.4 警告原文与迁出理由原文

**添加前的警告**。带 `risk` 的订阅点添加后先显示警告，按「Sign in anyway」才继续（`app.js:11726-11733`、`:12192-12211`）。

- Claude（`app.js:11578-11579`；CLI 用同一段 `google.go:109-111`）：
  > Anthropic may suspend or ban a Claude account it sees used outside its own apps. magpie sends requests through Claude Code, but Anthropic may still act on them; you use it at your own risk. Use an account you can afford to lose.

  界面中文（`M/internal/gui/assets/i18n.js:1277`）：「Anthropic 可能封禁在其官方应用之外使用的 Claude 账号。magpie 的请求经 Claude Code 发出，但 Anthropic 仍可能采取措施，风险自负。请用丢了也不心疼的账号。」
- Antigravity（`app.js:12199` 的默认文案；`google.go:105-107`）：
  > Google may suspend an Antigravity account it sees used outside Antigravity. Use one you can afford to lose.

  中文（`i18n.js:1593`）：「Google 可能封禁在 Antigravity 之外使用的 Antigravity 账号。请用丢了也不心疼的账号。」标题「{name} 账号可能被封禁」，按钮「仍然登录」（`i18n.js:1592,1594`）。
- Command Code（`app.js:11602-11603`）："A Go plan account is used through Command Code's private interface, which Command Code may treat as a breach of its terms and ban the account for. …" 源码注释说 Command Code 在 X 上表示过从别的工具用可能封号（`app.js:11600-11601`，magpie 转述，我未核实）。
- Qoder 与 Qoder CN（`app.js:11607-11612`）、Zed（`:11616-11617`）、Factory（`:11620-11621`）、Xiaomi MiMo（`:11623-11624`）：都是「magpie 以对方客户端的身份签请求，对方可能当作第三方使用并处理；请用丢了也不心疼的账号」。
- 没有警告的：ChatGPT、ChatGPT API、Cursor、Grok、Copilot、ZCode、WorkBuddy、Devin、Kiro、Gemini CLI（`app.js:11580-11628`）。【推测】Gemini CLI 不加警告，与 Google 文档的说法不一致（4.4 节）。

**迁出内置的理由**。【原文】`M/AGENTS.md:27-29`：

> Some built-in subscriptions are deprecated. Reaching them can break their vendors' terms, so they are moving out of magpie into community OpenCode plugins, which keeps magpie itself from being banned.

（有些内置订阅已弃用：连它们可能违反厂商条款，所以迁到社区 OpenCode 插件，免得 magpie 本身被封。）

- 迁出名单：Command Code、Cursor、Devin、Factory、Grok、Kiro、Xiaomi MiMo、Qoder、WorkBuddy、ZCode、Zed（`M/AGENTS.md:32-44`）。迁移从提交 `3bec6c0e`（2026-09-30）开始，这段说明在提交 `fa9daa69`（2026-10-02）写入。
- Claude、ChatGPT、ChatGPT API、Copilot、Gemini CLI、Antigravity 仍是内置。

---

## 3. Pi 与 OpenCode

### 3.1 Pi 的订阅登录（`pi@4954d760`）

| 厂商 | client_id | 请求发往 | 对厂商自称 | 备注 |
|---|---|---|---|---|
| Anthropic（Claude Pro/Max） | Claude Code 的 `9d1c250a-e61b-44d9-88ed-5944d1962f5e`，源码里 base64 存放（`packages/ai/src/auth/oauth/anthropic.ts:14`）；授权页 `claude.ai/oauth/authorize`，token 到 `platform.claude.com/v1/oauth/token`（`:15-16`） | Anthropic API | `user-agent: claude-cli/2.1.280`、`x-app: cli`（`packages/ai/src/api/anthropic-messages.ts:96,1061-1062`）；beta `claude-code-20250219, oauth-2025-04-20`（`:1142`）；system prompt 第一段固定为 "You are Claude Code, Anthropic's official CLI for Claude."（`:1228-1235`） | 交互模式会提示 "Anthropic subscription auth is active. Third-party harness usage draws from extra usage and is billed per token, not your Claude plan limits."（`packages/coding-agent/src/modes/interactive/interactive-mode.ts:322`） |
| OpenAI：Sign in with ChatGPT | `dynamic_agent_client`，`agent_name_hint` 为 `Pi`（`packages/ai/src/auth/oauth/openai-chatgpt.ts:16-17`） | `api.openai.com/v1`（`:21`），scope 含 `chatgpt.tokens.use.direct`（`:26-27`） | 如实自称 Pi | v0.99.0（2026-09-29）加入（`packages/coding-agent/CHANGELOG.md:374,380`） |
| OpenAI：Codex（legacy） | Codex CLI 的 `app_EMoamEEZ73f0CkXaXp7hrann`（`packages/ai/src/auth/oauth/openai-codex.ts:22`） | `chatgpt.com/backend-api`（`packages/ai/src/providers/openai-codex.ts:11`） | `originator: pi`，User-Agent 为 `pi (…)`（`packages/ai/src/api/openai-codex-responses.ts:1648`；`packages/ai/src/utils/pi-user-agent.ts:17-18`） | 0.99.0 起改名为「OpenAI Codex (legacy)」，由 Sign in with ChatGPT 取代（`packages/ai/CHANGELOG.md:188`） |
| GitHub Copilot | VS Code Copilot 的 `Iv1.b507a08c87ecfe98`，base64 存放（`packages/ai/src/auth/oauth/github-copilot.ts:11`） | `copilot_internal/v2/token` 换 token 后发 Copilot API（`:60`） | `GitHubCopilotChat/0.35.0`、`vscode/1.107.0`、`Copilot-Integration-Id: vscode-chat`（`:13-17`） | — |
| xAI | `b1a00492-073a-47ea-816f-4c329264a828`，scope `grok-cli:access api:access`，设备码登录（`packages/ai/src/auth/oauth/xai.ts:8-10`） | 公开 API `api.x.ai/v1`（`packages/ai/src/providers/xai.ts:11`） | `referrer: "pi"`（`xai.ts:151`） | — |
| Gemini CLI、Antigravity | — | — | — | v0.71.0（2026-04-30）删除："Removed built-in Google Gemini CLI and Google Antigravity support, including provider registration, model metadata, OAuth, and package exports."（`packages/ai/CHANGELOG.md:1166-1170`）。CHANGELOG 没写原因 |

### 3.2 和 magpie 是不是同一种

- **Claude 不同。** Pi 是 (c)：直连，并冒充 Claude Code 的身份，Pi 自己提示会计入额外用量。magpie 是 (b)：驱动真 `claude`。magpie 的理由正是 (c) 会被 Anthropic 归为第三方流量（2.2 节）。
- **ChatGPT 机制相同，差别有两处。** 两边都有「Codex OAuth 直连」和「Sign in with ChatGPT」两条路。
  - 差别一：Pi 走 Codex 那条时如实自称 `pi`，magpie 冒充 `codex_cli_rs`。
  - 差别二：Pi 只给自己用；magpie 经网关给任意 Agent 用，还能多账号轮换。
- **Copilot 相同。** 都借 VS Code Copilot 的客户端 ID，都带 VS Code 的请求头。
- **Gemini CLI、Antigravity 不同。** Pi 2026-04-30 已删掉，magpie 仍内置。
- **xAI 不同。** Pi 走 `auth.x.ai` 设备码加公开 API，与 OpenCode 的官方集成用同一个 client_id（3.3 节）。magpie 用 Grok Build CLI 的登录，冒充 `grok-shell` 打私有代理 `cli-chat-proxy.grok.com`。

### 3.3 OpenCode 的同类功能和官方说法

- **官方文档原话**。【原文】[W57] 的 Anthropic 一节：

  > There are plugins that allow you to use your Claude Pro/Max models with OpenCode. Anthropic explicitly prohibits this. Previous versions of OpenCode came bundled with these plugins but that is no longer the case as of 1.3.0. Other companies support freedom of choice with developer tooling - you can use the following subscriptions in OpenCode with zero setup: ChatGPT Plus, Github Copilot, Gitlab Duo

  （有插件能让你在 OpenCode 里用 Claude Pro/Max，Anthropic 明确禁止；1.3.0 起不再内置这些插件；ChatGPT Plus、GitHub Copilot、GitLab Duo 可以零配置直接用。）
- **删掉 Claude 登录**：
  - 提交 `973715f`（2026-02-19，作者 thdxr），标题 "anthropic legal requests" [W58]。
  - PR #18186（2026-03-19 合并）"Remove anthropic references per legal requests"：删内置插件 `opencode-anthropic-auth`、`claude-code-20250219` beta 头和 Anthropic 风格的系统提示词 [W59]。
- **OpenCode 现在的内置订阅**（全都如实标识自己）：
  - ChatGPT：Codex OAuth，用 Codex CLI 的 client_id，但 `originator: "opencode"`（`oc@37e3912d:packages/core/src/plugin/provider/openai.ts:16,23,272`）；另有 Sign in with ChatGPT（`…/chatgpt.ts:21,26`）。
  - Copilot：OpenCode 自己的 GitHub OAuth 应用 `Ov23li8tweQw6odWQebz`，User-Agent 是 OpenCode 自己的（`…/github-copilot.ts:17,395`）。
  - xAI：client_id 与 Pi 相同，`referrer: "opencode"`（`…/xai.ts:9,12,54`）。
- **三家厂商与 OpenCode 有正式合作**：OpenAI（2026-01，[W22]）、GitHub（2026-01-16，[W37]）、xAI（2026-05-21，[W54]）。
- **Google 只有社区插件**。`opencode-antigravity-auth` 自己的 README 写明：【原文】"Using this plugin (and any proxy for Antigravity) violates Google's Terms of Service. A number of users have reported their Google accounts being banned or shadow-banned"（用这个插件或任何 Antigravity 代理都违反 Google 条款，已有不少用户报告被封或被暗中限制）[W53]。

---

## 4. 各厂商官方态度（原文）

### 4.1 Anthropic

**消费者条款**（2025-10-08 生效，2026-10-16 仍是此版）[W2]

- 【原文】§2："You may not share your Account login information, Anthropic API key, or Account credentials with anyone else. You also may not make your Account available to anyone else."（不得把登录信息、API key 或凭据给别人，不得让别人用你的账号。）
- 【原文】§3 第 7 条，禁止 "Except when you are accessing our Services via an Anthropic API Key or where we otherwise explicitly permit it, to access the Services through automated or non-human means, whether through a bot, script, or otherwise."（除用 API key 或另有明确许可外，不得以机器人、脚本等自动化方式访问服务。）The Register 称这条至少从 2024-02 起就没变过 [W9]。

**Claude Code 文档 Legal and compliance 页**（当前版，[W1]，Exa 与 grok 各读一次，一致）

- 【原文】"OAuth authentication is intended exclusively for purchasers of Claude Free, Pro, Max, Team, and Enterprise subscription plans and is designed to support ordinary use of Claude Code and other native Anthropic applications."（OAuth 只给订阅用户、用于正常使用 Claude Code 等 Anthropic 自家应用。）
- 【原文】"Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials on behalf of their users. Moreover, developers may not collect, store, or intermediate Claude.ai credentials or session tokens — sign-in to a Claude account must complete through Anthropic's own flow."（不许第三方开发者在自己的应用里提供 Claude.ai 登录，不许替他们的用户经订阅凭据转发请求；开发者不得收集、存储或中转 Claude.ai 凭据或会话 token。）
- 【原文】"Nor does it prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription, including where a platform hosts Claude Code"（这些限制不妨碍用户在未改动的 Claude Code 里登录自己的订阅，包括平台托管 Claude Code 的情况。）
- 【原文】"Advertised usage limits for Pro and Max plans assume ordinary, individual usage of Claude Code and the Agent SDK."（Pro、Max 公布的额度以正常的个人使用 Claude Code 和 Agent SDK 为前提。）
- 【原文】"Anthropic reserves the right to take measures to enforce these restrictions and may do so without prior notice."
- 2026-02 这页的写法更严。The Register [W9] 和 Yep Anywhere [W14] 都引用了同一句：【原文】"Using OAuth tokens obtained through Claude Free, Pro, or Max accounts in any other product, tool, or service — including the Agent SDK— is not permitted and constitutes a violation of the Consumer Terms of Service." 现在的版本已改写，改写日期没查到。
- 【原文】Claude Code 认证文档写明可以用 `claude setup-token` 生成长期 OAuth token，"Use this for CI pipelines and scripts where browser login isn't available."[W19]

**新版使用政策**（2026-10-08 发布，11-12 生效，[W4]）

当前页 [W3] 的「Do Not Abuse Our Platform」一节有两条，2026-06 的存档版（2025-09-15 生效，[W5]）里没有或更窄：

- 【原文】新增："Resell, proxy, or otherwise provide access to Claude through unauthorized means, including services that route requests through consumer subscriptions or misrepresent the product or client being used"（不得以未授权方式转售、代理或提供 Claude 访问，包括经消费者订阅转发请求的服务、谎报所用产品或客户端的服务。）
- 【原文】改为 "Coordinate malicious activity across multiple accounts, or create multiple accounts, to avoid detection, circumvent product guardrails, …"。旧版没有 "or create multiple accounts"。
- 当前页没写生效日期。它已经包含 [W4] 列出的新增内容（例如虐待模型那一条），所以推断它就是 10-08 发布、11-12 生效的新版（推测）。

**2026 年时间线**

| 时间 | 事件 | 来源 |
|---|---|---|
| 2026-01-05 | OpenCode 用户报告：用 Anthropic OAuth，升级到 Max 20 后被封 | [W15] |
| 2026-01-09 | Thariq Shihipar（Claude Code 团队）：【原文】"Yesterday we tightened our safeguards against spoofing the Claude Code harness after accounts were banned for triggering abuse filters from third-party harnesses using Claude subscriptions. Third-party harnesses using Claude subscriptions create problems for users and are prohibited by our Terms of Service. … We've lifted all bans we're aware of that were caused by this issue"（收紧了防冒充措施；第三方 harness 用订阅违反条款；因此误封的已解封）。第三方工具开始收到 "This credential is only authorized for use with Claude Code and cannot be used for other API requests." | [W8]、[W9]、[W12]、[W16] |
| 2026-02-18～20 | 法律页加上「OAuth token 不得用于任何其他产品，包括 Agent SDK」。Thariq 随后称这是文档整理："Nothing is changing about how you can use the Agent SDK and MAX subscriptions!"（Yep Anywhere 转引，没找到 X 原帖） | [W9]、[W14] |
| 2026-02-19 至 03-19 | OpenCode 以 "anthropic legal requests" 删掉 Claude Pro/Max 登录 | [W58]、[W59] |
| 2026-04-04 | 订阅额度不再覆盖第三方 harness，从 OpenClaw 开始，改走额外用量。邮件原文："you'll no longer be able to use your Claude subscription limits for third-party harnesses including OpenClaw … this policy applies to all third-party harnesses and will be rolled out to more shortly"；"Your subscription usage still covers all Claude products, including Claude Code and Claude Cowork"。Boris Cherny（Claude Code 负责人）："our subscriptions weren't built for the usage patterns of these third-party tools" | [W10]、[W11]、[W20] |
| 2026-05-13 | 宣布给订阅加单独的「Agent SDK 额度」，`claude -p`、第三方工具等程序化用法计入这份额度，6-15 生效 | [W13] |
| 2026-06-15 | 暂停上一条：【原文】"Claude Agent SDK, `claude -p`, and third-party app usage still draw from your subscription limits." | [W6] |
| 2026-10-07 | Max、Team 附送月度 API 额度；【原文】"You can still use the Claude Agent SDK, `claude -p`, and third-party apps with your subscription limits." 额度 FAQ："When you're signed in with your Claude plan instead, `claude -p` and Agent SDK usage still draw from your plan's usage limits" | [W6]、[W7] |
| 2026-10-08 发布，11-12 生效 | 使用政策新增「经消费者订阅转发请求」「谎报客户端」一条 | [W3]、[W4]、[W5] |

### 4.2 OpenAI

- **使用条款**（2026-01-01 生效，[W21]）：
  - 【原文】"You may not share your account credentials or make your account available to anyone else"（不得共享账号凭据或让别人用你的账号。）
  - 禁止 "circumvent any rate limits or restrictions or bypass any protective measures"（禁止规避速率限制或绕过保护措施。）
- **Tibo 的公开表态**：
  - 2026-01-09：【原文】"We are working with OpenCode to allow Codex users to use their Codex subscriptions and usage limits in OpenCode directly."（正在和 OpenCode 合作，让 Codex 用户直接在 OpenCode 里用订阅额度。）[W22]
  - 2026-01-10：【原文】"Over the coming days we are prioritizing working with open source coding agents and tools to support them in the same way as OpenCode … We are already talking with OpenHands, RooCode and Pi."（接下来优先以同样方式支持开源编程 Agent，已在和 OpenHands、RooCode、Pi 谈。）[W23]
  - 2026-08-21：见第 0 节引文。IT之家同日报道内容一致 [W25]。
- **Sign in with ChatGPT（SIWC）**：
  - 上线：2026-09-29 DevDay 加上「用你的 ChatGPT 套餐」权限。官方回顾："Use your allowance across 16 partners including Cognition's Devin, Notion, Vercel, T3, OpenClaw, and Dactyl"[W30]。OpenAI 员工 Brian Landsman 的帖子列出开源集成为 OpenClaw、OpenCode、Pi、T3 Code [W31]。第三方报道日期一致 [W67]。
  - 【原文】自助接入的范围："At launch, ChatGPT plan usage is available to open-source projects, personal projects that run locally, and selected private apps."；付费或远程托管的应用要排队申请 [W28]。
  - 开源客户端的流程是动态注册：`client_id=dynamic_agent_client`、`ext_agent_host_id`、`agent_name_hint` 填应用真名，不需要 client secret [W29]。
  - 用户这边，每个应用的额度在 ChatGPT 设置里可设上限 [W27]。
- **SIWC 条款**（2026-09-29，[W26]，Exa 与 grok 各读一次，一致）：
  - 【原文】§1："Use your app's own name during sign-in and activation. Do not impersonate OpenAI, another application, or another open-source project."（用自己的名字，不得冒充 OpenAI、别的应用或别的开源项目。）
  - 【原文】§1："Any persistent storage of Authentication Tokens must be local and under the user's control, not in a remote or managed environment."
  - 【原文】§2："Connected application only. Use the user's plan only for the application they connected. Do not provide general-purpose API access for other tools or unrelated requests."（只能给用户连接的这个应用用，不得给别的工具提供通用 API 访问。）
  - 【原文】§2："Requests must be for the authenticated user … Another user's activity must not trigger requests to the authenticated user's account."
  - 【原文】§4，不得促成或鼓励："Creating multiple accounts, splitting usage, rotating accounts, or otherwise bypassing usage limits."；"Pooling, transferring, reselling, gifting, or sharing ChatGPT plan usage or Authentication Tokens"；"Using one user's subscription to fulfill another user's requests."
  - 【原文】§6："We may suspend or disable your application's access to SIWC if it violates these Terms"。
- **Codex 本身可以嵌入别的产品**：【原文】"Codex app-server is the interface Codex uses to power rich clients … Use it when you want a deep integration inside your own product"[W32]。
- 【推测】SIWC 条款约束的是接入 SIWC 的应用。magpie 的「ChatGPT API」用的正是 SIWC token，并经网关给别的 Agent 用，和 §2「不得给别的工具提供通用 API 访问」正面相对，账号轮换也对上 §4。magpie 的「ChatGPT（Codex）」走的是 Codex 的 OAuth，SIWC 条款不直接适用。这条路上 OpenAI 没有成文规则，只有 Tibo 的发言；官方合作方 OpenCode 在这条路上如实写 `originator: "opencode"`，magpie 写的是 `codex_cli_rs`。

### 4.3 GitHub Copilot

- **适用条款**：个人用户的 Copilot 受 GitHub 服务条款 J 节约束 [W36]。
- **GitHub 服务条款** [W34]：
  - 【原文】B.3："Your login may only be used by one person — i.e., a single login may not be shared by multiple people."
  - 【原文】B.3："One person or legal entity may maintain no more than one free Account"。
  - 【原文】H 节："Abuse or excessively frequent requests to GitHub via the API may result in the temporary or permanent suspension of your Account's access to the API. … You may not share API tokens to exceed GitHub's rate limitations."
- **可接受使用政策** [W35]：
  - 【原文】§4 禁止 "using our servers for any form of excessive automated bulk activity, to place undue burden on our servers through automated means"。
  - 【原文】§6："You will not reproduce, duplicate, copy, sell, resell or exploit any portion of the Service, use of the Service, or access to the Service without our express written permission."
- **官方认可的第三方客户端**：
  - OpenCode（2026-01-16，【原文】"GitHub is officially supporting using your Copilot Pro, Pro+, Business, or Enterprise subscription with OpenCode … through a formal partnership"）[W37]。
  - Zed（2026-02-19，同样措辞）[W38]。
  - Copilot CLI 的 ACP 服务，文档示例就是 "a client application that uses Copilot by interacting with GitHub Copilot CLI's ACP server"[W39]。
- **停用邮件**。2025 年 copilot-api（把 Copilot 反代成 OpenAI、Anthropic 接口的项目）的用户贴出 GitHub Security 邮件 [W40]：
  - 【原文】"This activity may have included use of Copilot via scripted interactions, an otherwise deliberately unusual or strenuous nature, or use of multiple accounts to circumvent usage limits. Due to this, we have suspended your access to Copilot."
  - 恢复后的邮件：【原文】"We kindly ask that you use Copilot strictly within our supported extensions … Please note that scripting against our API, including automated or excessive usage and programmatic token generation, is prohibited."
  - 项目维护者说自己 2025-03 也收到过警告，并把警告写回了 README [W40]、[W41]。
- 【推测】magpie 和 Pi 用的是 VS Code Copilot 的客户端 ID，带 VS Code 的请求头。官方合作方 OpenCode 用自己的 OAuth 应用（3.3 节），所以前者不属于「supported extensions」。

### 4.4 Google（Gemini CLI、Antigravity）

- **Gemini CLI 条款页**（2026-04-10 更新，[W42]）：
  - 【原文】"Directly accessing the services powering Gemini CLI (for example, the Gemini Code Assist service) using third-party software, tools, or services (for example, using OpenClaw with Gemini CLI OAuth) is a violation of applicable terms and policies. Such actions may be grounds for suspension or termination of your account."（用第三方软件直连 Gemini CLI 背后的服务，例如在 OpenClaw 里用 Gemini CLI 的 OAuth，违反条款，可能被停用或终止账号。）
  - 这段由 PR #20488 加入，约 2026-02-26 [W44]。
  - 页首写明：免费层和 Google One 用户的 Gemini CLI 已于 2026-06-18 换成 Antigravity CLI。
- **Gemini CLI FAQ**：【原文】"Using third-party software, tools, or services to harvest or piggyback on Gemini CLI's OAuth authentication to access our backend services is a direct violation … If you would like to use a third-party coding agent with Gemini, the supported and secure method is to use a Vertex AI or Google AI Studio API key."[W43]
- **解封与新流程**（2026-02-27，[W45]）：
  - 【原文】"a series of Antigravity bans rolled out to address violations of the Antigravity Terms of Service (ToS), specifically the use of 3rd party tools or proxies to access Antigravity resources and quotas. Because of the backend layer where abuse prevention occurs, bans for Antigravity usage also blocked access to Gemini CLI and Gemini Code Assist."
  - 先统一自动解封。以后被标记要填表，【原文】"acknowledging that bypassing system measures or circumventing usage limits is prohibited"。
  - 【原文】"If an account is flagged for a second violation of ToS, it will be permanently banned."（第二次违规永久封。）
- **加强检测**（2026-03-18，[W46]）：【原文】"We're implementing more robust detection for policy-violating use cases (e.g. using Gemini CLI oAuth with third-party software)."
- **Antigravity FAQ**（当前 HTML 版，[W48]，两个工具各读一次）：
  - 【原文】"Using third-party software, tools, or services to access Antigravity is a violation of our Terms of Service … Such actions can result in suspension or termination of your account."
  - 【原文】"Antigravity CLI headless mode (`agy -p`) is intended for direct scripting and CI workflows. Wrapping `agy` inside third-party coding agents or applications, or automating account rotation, is not supported under consumer plans."（headless 模式用于直接写脚本和 CI；把 `agy` 包进第三方编程 Agent 或应用、自动轮换账号，消费者套餐不支持。）
- **包装官方 CLI 的问题没有答复**：有人问通过本地适配器以编程方式驱动 Gemini CLI 是否违规，官方只回复暂无计划处理 [W47]。

### 4.5 xAI

- **OpenCode 官方集成**（2026-05-21，[W54]）：【原文】"Use your SuperGrok or X Premium subscription inside OpenCode. … More open-source agents and integrations are coming soon."
- **Grok Build**（2026-05-25，[W55]）：【原文】"Headless mode (`-p`) allows easily running agents inside scripts and automations. Grok Build also provides full ACP support to build your own bots and agent orchestration apps."（可以用 ACP 自建机器人和 Agent 编排应用。）
- **可接受使用政策**（2026-08-14 生效，[W56]）禁止：
  - "using bots to access … our Service"；
  - "circumventing any rate limits or restrictions"；
  - "Accessing the Services through unauthorized automated or non-human means"；
  - "reselling"。

---

## 5. 有据可查的封号与限制事件

| 时间 | 厂商 | 谁、什么做法 | 结果 | 厂商给的原因 | 来源 |
|---|---|---|---|---|---|
| 2025-03、2025-08 | GitHub | copilot-api 的维护者和用户（把 Copilot 反代成 API） | 警告；用户被停用 Copilot，申诉后恢复 | 脚本化使用、异常强度、多账号规避限额（4.3 节原文） | [W40]、[W41] |
| 2026-01-05～09 | Anthropic | OpenCode 用户用 Claude OAuth，有人在升级到 Max 后被封 | 封号；Anthropic 称已解除已知的这类封禁 | 触发滥用过滤；第三方 harness 违反条款 | [W15]、[W8] |
| 2026-01-09 起 | Anthropic | OpenCode、OpenClaw 等冒充 Claude Code 的请求 | 服务端拒绝："This credential is only authorized for use with Claude Code…" | 防冒充 | [W16]、[W12] |
| 2026-02-12～23 | Google | 在 OpenClaw、OpenCode 里用 Antigravity OAuth，含每月 250 美元的 AI Ultra 用户 | "This service has been disabled in this account for violation of Terms of Service"，连带 Gemini CLI、Code Assist；02-27 统一自动解封 | Varun Mohan：【原文】"massive increase in malicious usage of the Antigravity backend"；"It is not intended to use the Antigravity backend as a proxy for other products" | [W49]、[W50]、[W51]、[W45] |
| 2026-02-19 至 03-19 | Anthropic 对 OpenCode | 工具层面，不是封用户 | OpenCode 删除 Claude Pro/Max 登录 | "anthropic legal requests" | [W58]、[W59] |
| 2026-03-12 | Google | 论坛用户用 OpenCode 加 Antigravity OAuth | 封号，申诉后恢复，额度未重置 | ToS | [W52] |
| 2026-04-04 | Anthropic | 第三方 harness 用订阅 | 不封号，改收额外用量 | 订阅不是按这类用法设计的 | [W10]、[W11] |
| 2026-04-14 | Anthropic | 自建中转（Claude Relay Service）、机房 IP、礼品卡订阅的新号 | 当天被封【线索】 | 未说明；变量很多 | [W62] |
| 2026-05～07 | Anthropic | 用 sub2api、CLIProxyAPI 反代自用 | 有封有不封；新号常一天内被封【线索】 | 未说明 | [W63] |
| 2026-08-21 | OpenAI | sub2api 用户 | 被反欺诈系统标记，后果未公开 | 把订阅转成 API 流量再分给许多用户 | [W24]、[W25] |
| 2026-09-23～10-14 | Anthropic | pi-claude-bridge（给 Pi 用的 Agent SDK 桥，magpie 的 Claude 桥照它做，见 `M/internal/gateway/claude_subscription.go:12-13`）：新开的 Max 号几小时内被封，申诉被拒；另一人用自写的、冒充 Claude Code 的代理被封；10-14 有人贴出 Anthropic 客服回复截图，称这类桥是允许的【线索】 | 封号 | 未说明 | [W17] |
| 2026-10-14 | OpenAI | 经 sub2api 分叉，把 Codex 请求冒充成「ChatGPT for Excel」接口（BPS） | 403 "This request was blocked by our usage policy."，作者另报疑似降智【线索】 | usage policy | [W64] |

没有找到下面两类的封号记录：

- (a)：官方 CLI 由本机应用驱动；
- Osuna 这类只读额度查询：只见到限流报告，`/api/oauth/usage` 很快返回 429 [W18]。

## 6. 按做法分级的依据

### (a) 官方 CLI 自己登录、在官方 CLI 里用：低

- **Anthropic**：法律页写明不妨碍用户在未改动的 Claude Code 里登录自己的订阅 [W1]。2026-10-07 官方仍写 Agent SDK、`claude -p` 计入订阅额度 [W6]、[W7]。前提是「正常的个人使用」[W1]。
- **OpenAI、GitHub、xAI**：各自有文档说明可以把官方 CLI 嵌进别的程序 [W32]、[W39]、[W55]。
- **例外是 Google Antigravity**：把 `agy` 包进第三方应用「不在消费者套餐支持范围」[W48]。原话是「不支持」，没说「违规」；后果没写，我定为中。

### (b) 后台驱动官方 CLI，替别的 Agent 干活：中高（Anthropic）

对 Anthropic 不利的依据：

- 法律页不许开发者 "route requests through Free, Pro, or Max plan credentials on behalf of their users"[W1]。
- 11-12 生效的新政策禁止 "services that route requests through consumer subscriptions or misrepresent the product or client being used"[W3]。
- magpie 自述这条路是为了让别的 Agent 的提示词躲开 Anthropic 的第三方分类（2.2 节）。
- magpie 还在 `logins.json` 存 Claude 账号凭据并切号（2.3 节），对上「不得收集、存储或中转凭据」。
- 有同类工具的用户被封的自述 [W17]。

对它有利的依据：

- 进程是未改动的 Claude Code，登录走 Anthropic 自己的流程；
- 用户自己登录时 `claude -p` 官方写明计入订阅额度 [W7]；
- 有人贴出客服截图说这类桥可以 [W17]，我看不到截图内容。

【推测】「替别的 Agent 回答」算不算新政策说的「经消费者订阅转发请求的服务」，条款没给例子。magpie 刻意改写提示词以避开分类，这一点更接近「谎报客户端」。

### (c) 第三方工具拿订阅的 OAuth token 直连私有后端：按厂商分

| 厂商 | 等级 | 依据 |
|---|---|---|
| Google | 很高 | 两份文档都写明违规、可停用或终止账号 [W42]、[W48]；2026-02 大规模停用 [W49]–[W51]；以后二次违规永久封 [W45] |
| Anthropic | 高 | 法律页不许第三方提供 Claude.ai 登录 [W1]；2026-01 封号潮、服务端拦截 [W8]、[W16]；04-04 起第三方 harness 改收额外用量 [W10]；新政策禁止谎报客户端 [W3]，Pi 的 system prompt 就写成 Claude Code（3.1 节） |
| GitHub | 中 | 官方只认合作方和 Copilot CLI [W37]–[W39]；GitHub Security 要求只在支持的扩展里用、不得脚本化调用 API [W40] |
| xAI | 中（信息少） | 只有 OpenCode 是官方集成 [W54]；AUP 禁止未授权的自动化访问 [W56]；magpie 冒充 `grok-shell` 打私有代理，并以「可能违反条款」为由迁出内置 [`M/AGENTS.md:27-38`] |
| OpenAI | 低至中 | 低：开源客户端以自己的名字、给自己用，有官方背书 [W22]–[W24]、[W26]–[W31]。中：冒充 Codex CLI、给别的工具当通用接口、账号轮换，这些在 SIWC 条款里明令禁止（§1、§2、§4，[W26]）；Codex OAuth 那条路没有成文规则（推测） |

### (d) 把订阅转成接口给别人用、共享或售卖：很高（各家）

- Anthropic：新政策禁止转售、代理 [W3]；消费者条款不许让别人用你的账号 [W2]；法律页不许转售或中转 [W1]。
- OpenAI：Tibo 说会被反欺诈系统标记 [W24]；SIWC §4 禁止共享、转售 [W26]；使用条款不许共享凭据 [W21]。
- GitHub：一个登录只能一个人用、不得转售访问 [W34]、[W35]。
- Google：Varun Mohan 说「不是让你把 Antigravity 后端当别的产品的代理」[W49]。
- xAI：AUP 禁止转售 [W56]。
- 这类项目自己也写了免责：sub2api 的定位是「支持拼车共享」，README 写明可能违反 Anthropic 等上游条款、作者不对封号负责，赞助商里还有「降低关联风控概率」的住宅 IP [W60]。CLIProxyAPI 写明可接入多个 CLI 账号 [W61]。

### 同一个人多账号自动轮换：会额外加重，有依据

- **点名禁止或不支持的**：
  - OpenAI SIWC 条款 §4："Creating multiple accounts, splitting usage, rotating accounts, or otherwise bypassing usage limits" [W26]。
  - Antigravity FAQ："automating account rotation, is not supported under consumer plans" [W48]。
  - GitHub 停用邮件把 "use of multiple accounts to circumvent usage limits" 列为原因之一 [W40]。
  - Google 复核要用户承认 "circumventing usage limits is prohibited" [W45]。
- **间接覆盖的**：
  - OpenAI 使用条款、xAI AUP 禁止规避速率限制 [W21]、[W56]；
  - Anthropic 新政策把「为规避检测或产品限制而建多个账号」列为平台滥用 [W3]，公布的额度以「正常的个人使用」为前提 [W1]。Anthropic 没有专门写「轮换」，这里是推测。
- **操作风险**：
  - refresh token 每次刷新会轮换，只能有一个持有者 [`providers-accounts.md:194`]；
  - magpie 导入时先刷新一次，来源工具因此被登出 [`M/docs/reference.md:1638-1641`]；
  - 每日预热按时替用户发请求 [`M/README.zh-CN.md:146`]，【推测】属于条款里的自动化访问。
- **边界没写清**：多账号本身有官方用法。Claude Code 文档有「Log in with multiple accounts」一节，用 `CLAUDE_CONFIG_DIR` 给每个账号一个配置目录 [W19]；Codex 的登录存在 `CODEX_HOME` 下 [W33]，换目录就是另一份登录。手工在自己的几个号之间选用，和「额度用完自动换号」是两回事，条款只点名后者（推测）。

## 7. Osuna 现在在哪一级

### 7.1 运行 Agent：Claude Code、Codex、Copilot 属于 (a)，Antigravity 单列

| Agent | Osuna 的跑法 | 等级 |
|---|---|---|
| Claude Code | `@anthropic-ai/claude-agent-sdk` 0.3.246（`O/packages/server/package.json:109`）驱动本机 `claude`；system prompt 用 `claude_code` 预设加追加内容（`O/packages/server/src/server/agent/providers/claude/agent.ts:3425-3428`）；登录是 Claude Code 自己的 | (a)，依据 [W1]、[W6] |
| Codex | `codex app-server`（`O/packages/server/src/server/agent/providers/codex-app-server-agent.ts:7293`） | (a)，依据 [W32] |
| Copilot | `copilot --acp`（`O/packages/server/src/server/agent/providers/copilot-acp-agent.ts:92`） | (a)，依据 [W39] |
| Antigravity | `agy --input-format stream-json --output-format stream-json --add-dir <cwd> --disable-slash-commands --dangerously-skip-permissions`（`O/plugins/antigravity-provider/server/internal/process.ts:34-50`；`provider.ts:28`）。代码来自上游 Paseo | 形式是 (a)，但 Google 写明把 `agy` 包进第三方应用不在消费者套餐支持范围 [W48]，单列 |

Cursor、Kimi、OpenCode、Pi、OMP 等其他 ACP Agent 的条款没有逐个核对。

### 7.2 套餐用量插件：机制属于 (c)，但只读、不推理

已打开文件核实：

| 插件 | 读什么 | 发到哪 | 请求头 |
|---|---|---|---|
| Claude | 钥匙串 `Claude Code-credentials`（`O/plugins/claude-usage-source/server/usage.ts:26,304-313`，`:306` 调 `security`），或 `~/.claude/.credentials.json`；另读 Pi 的 `auth.json` 和 OMP 的数据库（`:428-434`） | `https://api.anthropic.com/api/oauth/usage`（`:537`）和 `/api/oauth/profile`（`:669`） | `Authorization: Bearer <token>`、`anthropic-beta: oauth-2025-04-20`（`:25,539-543`），没有冒充 User-Agent |
| Codex | `$CODEX_HOME/auth.json`、`~/.codex/auth.json`（`O/plugins/codex-usage-source/server/usage.ts:85-86`），另读 OpenCode、Pi 的 `auth.json` 和 OMP（`:92-99`） | `https://chatgpt.com/backend-api/wham/usage`（`:207`） | 浏览器 User-Agent `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)`（`:204`） |
| Copilot | 环境变量 `COPILOT_TOKEN`、`GITHUB_TOKEN`、`GITHUB_PAT`，或 GitHub CLI 的 `~/.config/gh/hosts.yml`（`O/plugins/copilot-usage-source/server/usage.ts:27,34-42`） | `api.github.com/copilot_internal/user`（`:54`） | 冒充 VS Code Copilot Chat：`Editor-Version: vscode/1.96.2`、`User-Agent: GitHubCopilotChat/0.26.7`（`:59-61`） |
| Grok | `~/.grok/auth.json`（`O/plugins/grok-usage-source/server/usage.ts:165`） | `cli-chat-proxy.grok.com/v1/billing`（`:124`） | `X-XAI-Token-Auth: xai-grok-cli`（`:128`） |

共同点：

- 不刷新 token，也不写回。源码注释 "the harness owns token refresh"（`O/plugins/claude-usage-source/server/usage.ts:459`），插件规则 "Never redeem refresh tokens or write credential stores"（`O/public-docs/plugins/reference.md:452-453`）。
- 结果缓存 5 分钟（`reference.md:508`）。
- 内置插件不受 `pluginsEnabled` 开关影响（`O/docs/plugins.md:105-106`）；gap-02 的 B25 记录了 Osuna 没有关掉读取凭据的开关。
- 这些代码来自上游 Paseo 的 #1278（提交 `acea7f3d2`，2026-06-20），不是 Osuna 新加的。

分级：

- 机制上是 (c)：第三方程序拿 CLI 的 OAuth token 调厂商没公开文档的后端。
- 但它只读，不发推理请求，只发给厂商自己的域名，不转给第三方。
- 请求头方面：Copilot 插件冒充 VS Code Copilot Chat；Grok 插件带 `X-XAI-Token-Auth: xai-grok-cli`；Codex 插件带浏览器 User-Agent。

对照：

- magpie 刻意不这样读 Claude：不拿 Claude 的 token 找 Anthropic，改跑 `claude -p /usage`，理由是用户担心封号（`M/internal/provider/account.go:339-341`；提交 `9bf6d435`）。
- OpenClaw 对原生 Claude CLI 登录不查额度接口，说的理由是刷新控制权归 Claude Code [W65]。Osuna 不刷新，这个理由对它不完全适用。
- CodexBar（steipete）默认先走同一个 OAuth 接口 [W66]。
- Anthropic 这个接口没有公开文档，限流很紧，社区只报过 429，没有封号报告 [W18]。

条款对照（推测）：

- 法律页 "developers may not collect, store, or intermediate Claude.ai credentials or session tokens"[W1]。Osuna 读出 Claude Code 的 token，不存，也不转给第三方，算不算「collect」拿不准。
- 消费者条款 §3 第 7 条禁止未明确许可的自动化访问 [W2]。后台定时查额度属于自动化访问。

### 7.3 Osuna 没有的

- **没有订阅转接口、多账号自动轮换、对外分享**：`gap-02` 的 B01–B33 里这些都是「没有」，多账号只有手工（B13）；`decisions.md` Q6 定了中转站只服务本机。
- **多个 Claude 账号要手工建**：在 config.json 里建多个 `extends` 条目，新建 Agent 时手选，文档示例用的是 API key（`O/docs/custom-providers.md:299-334`）。

## 8. 拿不准的地方

1. **Anthropic 现在到底怎么对待直连 OAuth 的第三方 harness。** 几处说法互相打架：
   - 10-07 的说明写「第三方应用仍计入订阅额度」[W6]；
   - Pi 10 月的提示仍说第三方 harness 走额外用量（3.1 节）；
   - 法律页又写不许第三方提供 Claude.ai 登录 [W1]；
   - pi-claude-bridge 维护者以为 4 月那套收费已经取消 [W17]。

   「third-party apps」是只指基于 Agent SDK 或 `claude -p` 的应用，还是也包括直连的 harness，我没找到官方定义。4 月邮件里的 "read more" 链接没找到对应的帮助文章。
2. **法律页何时从 2 月的写法（「包括 Agent SDK 都不许」）改成现在的写法**，没查到日期。
3. **新使用政策的生效日期是推断的**：当前页不写日期（4.1 节）。「经消费者订阅转发请求的服务」是否覆盖 magpie 这种本机、单人的桥，条款没给例子。
4. **Osuna 读 Claude token 查额度，算不算法律页说的「收集凭据」**，是解读问题。没见到执行记录。
5. **Antigravity 的「不支持」后果不明**：FAQ 说包 `agy` 不在消费者套餐支持范围，没说算违规，也没说会怎样。Gemini CLI 被包装时怎么算，官方没答复 [W47]。
6. **Tibo 8-21 说的 "Sign in With ChatGPT" 指什么不确定**：那时 SIWC 的「用套餐」权限还没正式上线（09-29），他说的可能包括 Pi、OpenCode 当时用的 Codex OAuth。
7. **社区封号报告都是自述**：注册方式、支付方式、IP、新号老号这些变量没有对照。pi-claude-bridge 那张客服截图我读不到内容。
8. **部分 X 帖子没读到原帖**：
   - Boris Cherny 的帖子是从 The Verge 的引文和 Threads 镜像读的；
   - Thariq 1 月的长帖是 threadreaderapp 的展开版；
   - Thariq 2 月「文档整理」那句只找到 Yep Anywhere 的转引。
9. **xAI 对 Pi 这类非合作方用同一个 client_id 的态度不明**：没有成文说法，只知道官方说「更多开源 Agent 即将接入」[W54]。
10. **没做的部分**：
    - Cursor、Devin、Kiro、Qoder 等在 magpie 里的做法没逐个核对条款；
    - magpie 的社区插件不在本地，没读源码；
    - Osuna 的其他 ACP Agent 也没核对。
11. **GitHub 是否把「借用 VS Code 客户端 ID」明确列为违规**，没找到成文规定。这条是从「只认合作方」和停用邮件推出来的。

## 9. 来源清单（访问日期均为 2026-10-16）

**Anthropic**

- [W1] Claude Code Docs, Legal and compliance — https://code.claude.com/docs/en/legal-and-compliance （2026-10-16 访问）
- [W2] Anthropic Consumer Terms of Service（2025-10-08 生效）— https://www.anthropic.com/legal/consumer-terms （2026-10-16 访问）
- [W3] Anthropic Usage Policy（当前页）— https://www.anthropic.com/legal/aup （2026-10-16 访问）
- [W4] Anthropic, 2026 Usage Policy update（2026-10-08）— https://www.anthropic.com/news/2026-usage-policy-update （2026-10-16 访问）
- [W5] Usage Policy 存档（2026-06，2025-09-15 生效版）— https://web.archive.org/web/20260627000000id_/https://www.anthropic.com/legal/aup （2026-10-16 访问）
- [W6] Claude Help Center, Use the Claude Agent SDK with your Claude plan — https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan （2026-10-16 访问）
- [W7] Claude Help Center, Monthly API credits for Max and Team plans — https://support.claude.com/en/articles/17154008-monthly-api-credits-for-max-and-team-plans （2026-10-16 访问）
- [W8] Thariq Shihipar 2026-01-09 长帖（展开版）— https://threadreaderapp.com/thread/2009689809875591565.html ，原帖 https://x.com/trq212/status/2009689809875591565 （2026-10-16 访问）
- [W9] The Register, Anthropic clarifies ban on third-party tool access to Claude（2026-02-20）— https://www.theregister.com/2026/02/20/anthropic_clarifies_ban_third_party_claude_access/ （2026-10-16 访问）
- [W10] The Verge, Anthropic essentially bans OpenClaw from Claude by making subscribers pay extra（2026-04-03）— https://www.theverge.com/ai-artificial-intelligence/907074/anthropic-openclaw-claude-subscription-ban （2026-10-16 访问）
- [W11] TechCrunch, Anthropic says Claude Code subscribers will need to pay extra for OpenClaw usage（2026-04-04）— https://techcrunch.com/2026/04/04/anthropic-says-claude-code-subscribers-will-need-to-pay-extra-for-openclaw-support/ （2026-10-16 访问）
- [W12] VentureBeat, Anthropic cracks down on unauthorized Claude usage by third-party harnesses（2026-01-09）— https://venturebeat.com/technology/anthropic-cracks-down-on-unauthorized-claude-usage-by-third-party-harnesses （2026-10-16 访问）
- [W13] VentureBeat, Anthropic reinstates OpenClaw and third-party agent usage on Claude subscriptions — with a catch（2026-05-13）— https://venturebeat.com/technology/anthropic-reinstates-openclaw-and-third-party-agent-usage-on-claude-subscriptions-with-a-catch （2026-10-16 访问）
- [W14] Yep Anywhere, The Agent SDK Auth Scare（2026-02-19）— https://yepanywhere.com/sdk-auth-clarification （2026-10-16 访问）
- [W15] anomalyco/opencode issue #6930（2026-01-05）— https://github.com/anomalyco/opencode/issues/6930 （2026-10-16 访问）
- [W16] anomalyco/opencode issue #7456（2026-01-09）— https://github.com/anomalyco/opencode/issues/7456 （2026-10-16 访问）
- [W17] elidickinson/pi-claude-bridge issue #118（2026-09～10）— https://github.com/elidickinson/pi-claude-bridge/issues/118 （2026-10-16 访问）
- [W18] anthropics/claude-code issue #31637（/api/oauth/usage 限流）— https://github.com/anthropics/claude-code/issues/31637 （2026-10-16 访问）
- [W19] Claude Code Docs, Authentication — https://code.claude.com/docs/en/authentication （2026-10-16 访问）
- [W20] Hacker News，2026-04 Anthropic 邮件全文 — https://news.ycombinator.com/item?id=47633568 （2026-10-16 访问）

**OpenAI**

- [W21] OpenAI Terms of Use（2026-01-01 生效）— https://openai.com/policies/terms-of-use/ （2026-10-16 访问）
- [W22] Tibo（@thsottiaux）2026-01-09 — https://x.com/thsottiaux/status/2009742187484065881 （2026-10-16 访问）
- [W23] Tibo 2026-01-10 — https://x.com/thsottiaux/status/2010064438033104966 （2026-10-16 访问）
- [W24] Tibo 2026-08-21 — https://x.com/thsottiaux/status/2090675027670978569 （2026-10-16 访问）
- [W25] IT之家，OpenAI 回应 Codex 使用限制：sub2api 转售共享会触发风控（2026-08-21）— https://www.ithome.com/0/992/767.htm （2026-10-16 访问）
- [W26] OpenAI, Sign in with ChatGPT Terms（2026-09-29）— https://openai.com/policies/sign-in-with-chatgpt-terms/ （2026-10-16 访问）
- [W27] OpenAI Help Center, Using your ChatGPT plan in other apps and sites — https://help.openai.com/en/articles/20001542-using-your-chatgpt-plan-in-other-apps-and-sites （2026-10-16 访问）
- [W28] OpenAI Cookbook, Integrating Sign in with ChatGPT in your Opensource App — https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt （2026-10-16 访问）
- [W29] OpenAI Developers, Registration and sign-in（SIWC 开源）— https://developers.openai.com/siwc/token-sharing-open-source/sign-in （2026-10-16 访问）
- [W30] OpenAI, DevDay 2026 Recap — https://openai.com/index/devday-2026-recap/ （2026-10-16 访问）
- [W31] Brian Landsman（OpenAI）2026-09-29 — https://x.com/brlands/status/2105015182582059472 （2026-10-16 访问）
- [W32] OpenAI Developers, Codex App Server — https://developers.openai.com/codex/app-server （2026-10-16 访问）
- [W33] OpenAI Developers, Codex Authentication — https://developers.openai.com/codex/auth （2026-10-16 访问）
- [W67] Flavio Copes, How to use your ChatGPT subscription in other apps（2026-10-02，上线日期与合作方名单的第二来源）— https://flaviocopes.com/sign-in-with-chatgpt/ （2026-10-16 访问）

**GitHub**

- [W34] GitHub Terms of Service — https://docs.github.com/en/site-policy/github-terms/github-terms-of-service （2026-10-16 访问）
- [W35] GitHub Acceptable Use Policies — https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies （2026-10-16 访问）
- [W36] GitHub Terms for Additional Products and Features — https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features （2026-10-16 访问）
- [W37] GitHub Changelog, GitHub Copilot now supports OpenCode（2026-01-16）— https://github.blog/changelog/2026-01-16-github-copilot-now-supports-opencode/ （2026-10-16 访问）
- [W38] GitHub Changelog, GitHub Copilot support in Zed generally available（2026-02-19）— https://github.blog/changelog/2026-02-19-github-copilot-support-in-zed-generally-available/ （2026-10-16 访问）
- [W39] GitHub Docs, Copilot CLI ACP server — https://docs.github.com/en/copilot/reference/copilot-cli-reference/acp-server （2026-10-16 访问）
- [W40] ericc-ch/copilot-api issue #84（2025-08）— https://github.com/ericc-ch/copilot-api/issues/84 （2026-10-16 访问）
- [W41] ericc-ch/copilot-api README — https://github.com/ericc-ch/copilot-api （2026-10-16 访问）

**Google**

- [W42] Gemini CLI, License, Terms of Service, and Privacy Notices（2026-04-10 更新）— https://geminicli.com/docs/resources/tos-privacy/ （2026-10-16 访问）
- [W43] Gemini CLI FAQ — https://geminicli.com/docs/resources/faq/ （2026-10-16 访问）
- [W44] google-gemini/gemini-cli PR #20488（约 2026-02-26）— https://github.com/google-gemini/gemini-cli/pull/20488 （2026-10-16 访问）
- [W45] google-gemini/gemini-cli Discussion #20632, Addressing Antigravity Bans & Reinstating Access（2026-02-27）— https://github.com/google-gemini/gemini-cli/discussions/20632 （2026-10-16 访问）
- [W46] google-gemini/gemini-cli Discussion #22970, Service update（2026-03-18）— https://github.com/google-gemini/gemini-cli/discussions/22970 （2026-10-16 访问）
- [W47] google-gemini/gemini-cli issue #24011（包装 Gemini CLI 是否违规）— https://github.com/google-gemini/gemini-cli/issues/24011 （2026-10-16 访问）
- [W48] Google Antigravity Docs, FAQ（HTML 版）— https://antigravity.google/docs/faq/ （2026-10-16 访问）
- [W49] Varun Mohan（@_mohansolo）2026-02-23 — https://x.com/_mohansolo/status/2025857873096626673 （2026-10-16 访问）
- [W50] The Register, Google Antigravity falls to Earth under compute burden（2026-02-23）— https://www.theregister.com/2026/02/23/google_antigravity_compute_burden/ （2026-10-16 访问）
- [W51] VentureBeat, Google clamps down on Antigravity 'malicious usage'（2026-02-23）— https://venturebeat.com/orchestration/google-clamps-down-on-antigravity-malicious-usage-cutting-off-openclaw-users （2026-10-16 访问）
- [W52] Google AI Developers Forum, Got banned from Antigravity for using OpenCode（2026-03-12）— https://discuss.ai.google.dev/t/got-banned-from-antigravity-for-using-opencode-submitted-appeal-but-still-locked-out/131169 （2026-10-16 访问）
- [W53] NoeFabris/opencode-antigravity-auth README — https://github.com/NoeFabris/opencode-antigravity-auth （2026-10-16 访问）

**xAI**

- [W54] xAI, Use Grok in OpenCode（2026-05-21）— https://x.ai/news/grok-opencode （2026-10-16 访问）
- [W55] xAI, Introducing Grok Build（2026-05-25）— https://x.ai/news/grok-build-cli （2026-10-16 访问）
- [W56] xAI Acceptable Use Policy（2026-08-14 生效）— https://x.ai/legal/acceptable-use-policy （2026-10-16 访问）

**OpenCode**

- [W57] OpenCode Docs, Providers — https://opencode.ai/docs/providers/ （2026-10-16 访问）
- [W58] anomalyco/opencode 提交 973715f, anthropic legal requests（2026-02-19）— https://github.com/anomalyco/opencode/commit/973715f3da1839ef2eba62d4140fe7441d539411 （2026-10-16 访问）
- [W59] anomalyco/opencode PR #18186（2026-03-19 合并）— https://github.com/anomalyco/opencode/pull/18186 （2026-10-16 访问）

**反代项目与社区线索**

- [W60] Wei-Shaw/sub2api README — https://github.com/Wei-Shaw/sub2api （2026-10-16 访问）
- [W61] router-for-me/CLIProxyAPI README — https://github.com/router-for-me/CLIProxyAPI （2026-10-16 访问）
- [W62] V2EX，自建中转封号问题（2026-04-14）— https://www.v2ex.com/t/1205805 （2026-10-16 访问）
- [W63] LINUX DO，使用 sub2api 反代 claude pro 自用会被封号吗（2026-05-19 起）— https://linux.do/t/topic/2206214 （2026-10-16 访问）
- [W64] VilaBlog，别把 ChatGPT 订阅交给反代（2026-10-14）— https://blog.vilavpn.com/chatgpt-subscription-relay-silent-nerf-warning/ （2026-10-16 访问）

**其他工具的做法**

- [W65] OpenClaw Docs, Anthropic provider — https://docs.openclaw.ai/providers/anthropic （2026-10-16 访问）
- [W66] steipete/CodexBar docs/claude.md — https://github.com/steipete/CodexBar/blob/main/docs/claude.md （2026-10-16 访问）
