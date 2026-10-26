# Codex 与 Claude Code 怎么存、怎么续登录（2026-10-25）

子代理只读一手来源：openai/codex 源码 `970111f6`（2026-10-23），Claude Code 官方文档与 npm 包 `@anthropic-ai/claude-code-linux-x64@2.1.310` 里抽出的字符串（未运行）。[src] 源码，[doc] 官方文档，[inf] 推断。

## Codex

- `auth.json`（`login/src/auth/storage.rs:49`、`token_data.rs:11`）[src]：`auth_mode`、`OPENAI_API_KEY`、`last_refresh`、`tokens{id_token, access_token, refresh_token, account_id, oauth_provenance, login_owner_id}`；email、`chatgpt_plan_type` 从 `id_token` 解出。
- `cli_auth_credentials_store`（`config/src/types.rs:136`）[src]：`file`（默认）、`keyring`、`auto`、未写进文档的 `ephemeral`。钥匙串服务名 `Codex Auth`、账号 `cli|<sha256(CODEX_HOME) 前 16 位>`，**每个 CODEX_HOME 一项**（`storage.rs:256-269`）。
- 续期 [src]：access token 离过期 ≤5 分钟，或 `last_refresh` 超过 8 天（`manager.rs:214-215,3311-3328`）；`POST https://auth.openai.com/oauth/token`，client_id `app_EMoamEEZ73f0CkXaXp7hrann`。
- **refresh token 只能用一次** [src+doc]：服务端 `refresh_token_reused` 视为永久失败（`manager.rs:1750-1771`）；官方 CI 文档：「Use one `auth.json` per runner… Do not share the same file across concurrent jobs」（https://developers.openai.com/codex/auth/ci-cd-auth/）。
- 同一 CODEX_HOME 两个进程 [src]：无跨进程锁；续前重读，别的进程已续就跳过（`manager.rs:3127-3170`）；`persist_tokens` 发现存的是别的号就不写（`manager.rs:1648-1690`）。
- 运行中的进程 [src]：缓存登录，不看磁盘变化；401 时只在存的 `account_id` 相同时才重读（`manager.rs:1926-1934,2053-2090`）。**换号要新进程**。[inf] 旧进程在换号后若续了旧号的 token，新 token 写不回（存的是别的号），旧号的存档就作废。
- app-server `account/*`（`app-server-protocol/src/protocol/common.rs:1320-1384`、`v2/account.rs`）[src]：`account/read`、`account/login/start`（`chatgpt` 返回 `loginId` + `authUrl`；`chatgptDeviceCode`）、`account/login/cancel`、`account/logout`、`account/rateLimits/read`、`account/usage/read`；通知 `account/login/completed`、`account/updated`、`account/rateLimits/updated`。浏览器登录在 1455 端口起回调，10 分钟超时，存进该 app-server 的 `CODEX_HOME`（`account_processor.rs:595-740`）。**用目标 `CODEX_HOME` 起 app-server 就能把号登进单独的文件夹**；官方测试客户端也这么建议（`app-server-test-client/README.md:26-55`）。
- 额度 [src]：`GET {chatgpt_base_url}/wham/usage`，带 Codex UA、Bearer、`ChatGPT-Account-Id`；回 `ordinary_usage_allowed`、primary / secondary（`used_percent`、`window_minutes`、`resets_at`）、credits、`plan_type`。每次模型回复带 `x-codex-primary-*` / `x-codex-secondary-*` / `x-codex-credits-*` 头，websocket 上是 `codex.rate_limits` 事件。
- 额度用完 [src]：HTTP 429，`{"error":{"type":"usage_limit_reached","resets_at":…}}`，另有 `usage_not_included`、`insufficient_quota`、`credit_balance_exhausted`；Codex 不重试。[inf] 429 在任何输出之前到，中转站可以换号重发而 CLI 看不到半截回复。

## Claude Code

- 存放 [doc+src]：macOS 钥匙串（写失败退回 `~/.claude/.credentials.json`，0600）；Linux / Windows `~/.claude/.credentials.json`。服务名 `Claude Code-credentials`，设了 `CLAUDE_CONFIG_DIR` 时加 `-<sha256(目录) 前 8 位>`；账号 `$USER`。
- 内容 [src]：`claudeAiOauth{accessToken, refreshToken, expiresAt, refreshTokenExpiresAt, scopes, subscriptionType, rateLimitTier, clientId}`；`.claude.json` 的 `oauthAccount` 存邮箱、组织、套餐名等。
- 续期 [src]：离过期 5 分钟内续，返回新 refresh token 就换；`<配置目录>/.oauth_refresh.lock` 跨进程锁，锁内重读，按发出的 refresh token 做比较后写入。[inf] 设计上 refresh token 也是一次性的，未见官方说明。
- 运行中的进程 [src]：401 时清缓存重读存储，存的 token 不同就**直接采用，不核对是不是同一个号**；文件存储在修改时间变化时重读，钥匙串只在当前 token 不能用时、最多 30 秒查一次。[inf] 与 Codex 相反：换掉存的登录后，开着的 Claude Code 可能在下次 401 时悄悄换到新号。
- `claude setup-token` [doc+src]：一年期 token，只能发模型请求（scope `user:inference`），**读不了 `/usage`**（要 `user:profile`）。
- 官方的多号办法 [doc]：`/login`、`/logout`，或每个号一个 `CLAUDE_CONFIG_DIR`。Console 登录（无 API key）不受 `CLAUDE_CONFIG_DIR` 隔离。官方没有给宿主程序代办登录的接口，登录得用真的 `claude`。
- 额度 [src]：`GET https://api.anthropic.com/api/oauth/usage`，需 `user:inference` + `user:profile`；回复头 `anthropic-ratelimit-unified-status`（`allowed` / `allowed_warning` / `rejected`）、`-5h-utilization`、`-7d-utilization`、`-5h-reset`、`-7d-reset`。用完是 429 `rate_limit_error`、status `rejected`。

## 条款（`subscription-ban-risk.md` 没有的）

- Codex 维护者在 issue #20884（2026-05-03）：「You should not be using multiple accounts to circumvent the rate limits of your subscription plan.」员工评论，不是条款（https://github.com/openai/codex/issues/20884）。
- OpenAI 帮助文章「Use multiple accounts with account switching」允许工作 / 个人两个号切换，写明 Codex 桌面应用尚不支持（https://help.openai.com/en/articles/20001068-use-multiple-accounts-with-account-switching）。
- issue #41664、#41615 问多号轮换与代理，无官方回复。Anthropic 没有新说法。
