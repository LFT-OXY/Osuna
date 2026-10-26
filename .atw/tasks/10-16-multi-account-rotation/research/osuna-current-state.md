# Osuna 现状（2026-10-25，main a75587c05）

子代理只读调查。[V] 代码核实，[D] 文档写明，[I] 推断。

## 套餐用量怎么读

- Codex（`plugins/codex-usage-source/`）[V]：读 `$CODEX_HOME/auth.json` 与 `~/.codex/auth.json` 的 `tokens.access_token`、`account_id`、`id_token`（`server/usage.ts:84-105,136-154`），另读 OpenCode / Pi 的 `auth.json`、OMP `agent.db`。不读钥匙串：`cli_auth_credentials_store="keyring"` 的 Codex 看不见。Agent 环境带 `OPENAI_BASE_URL` 时不匹配账号（`usage.ts:114`）。
  - `GET https://chatgpt.com/backend-api/wham/usage`，带 `Authorization: Bearer`、`ChatGPT-Account-Id`；**User-Agent 是浏览器串 `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)`**（`usage.ts:227-236`），与总任务第 15 条「身份如实」可能冲突，待定。401/403 报 rejected；从不刷新、从不写 token。
  - 重置卡：`GET …/wham/rate-limit-reset-credits`、`POST …/consume`，UA `Osuna/<version>`（`resets.ts:7-9,54`）。
  - 解析 primary / secondary 窗口（`used_percent`、`reset_at`、`limit_window_seconds`）、附加额度、credits、重置次数；丢掉 `allowed`、`has_credits`、`spend_control`（`usage.ts:29-55`）。窗口名按长度：18000 s → `five_hour`，604800 s → `weekly`（`packages/plugin/src/server/usage.ts:155-195`）。
- Claude（`plugins/claude-usage-source/server/usage.ts`）[V]：macOS 用 `security find-generic-password` 读服务名 `Claude Code-credentials`，设了 `CLAUDE_CONFIG_DIR` 时加 `-` + 该目录 SHA-256 前 8 位，账号 `$USER`（`:24-26,298-339,406-419`）；文件回退 `$CLAUDE_CONFIG_DIR|~/.claude/.credentials.json` 的 `claudeAiOauth`（`:346-351`）。Bedrock / Vertex / 非 Anthropic `ANTHROPIC_BASE_URL` 时不匹配（`:436-453`）。
  - `GET https://api.anthropic.com/api/oauth/usage`、`/api/oauth/profile`，带 `anthropic-beta: oauth-2025-04-20`，不设 UA（`:537-544,669-676`）；429 按 Retry-After 退避。窗口：`five_hour`、`weekly`、按模型的周额度、Extra usage。
- 轮询 [V]：daemon 无定时器；注册表缓存每份报告 5 分钟、每次取 20 秒限时（`packages/server/src/server/plugins/usage-sources/index.ts:81,103-106`）；客户端 60 秒过期重读（`packages/app/src/usage/queries.ts:38`），输入框条每 5 分钟（`plan-usage/use-strip-usage.ts:14`）。
- Codex app-server：Osuna 只调用 `account/read {refreshToken:false}`，在临时 app-server 里跑（`packages/server/src/server/api-endpoints/codex-sign-in.ts:20-51`）。不用 `account/rateLimits/read`、登录、登出。

## 子任务 8：读取 CLI 登录凭证

- 界面「读取 CLI 登录凭证」，主机设置「隐私」节；配置键 `readCliSignIns`，默认开；`PASEO_NO_CLI_SIGN_INS` 只能临时强制关；`server_info.features.readCliSignIns`。
- 唯一闸门 `CliSignInAccess.allowed()`（`packages/server/src/server/cli-sign-ins.ts:7-19`）。
- 关闭确认 `CliSignInsTurnOffSheet`（`packages/app/src/screens/settings/cli-sign-ins-turn-off-sheet.tsx:53-57`）留了注释「多号自动轮换（子任务 9）在这里加一项」。
- `BanRiskNotice`（`packages/app/src/components/ban-risk-notice.tsx`）是常驻、不可关的提示，没有「只提示一次」的状态；子任务 9 的「第一次打开时提示一次」要新做（每台设备存 AsyncStorage，或主机级存 daemon 配置）。

## 子任务 2：Codex 接法

- ChatGPT 登录时写顶层 `openai_base_url = <gateway>/backend-api/codex`，去掉 `model_provider`、`model_catalog_json`（`codex-config-patch.ts:342-370`，ADR 0010）。
- 打开「使用第三方接口」后，Codex 的 ChatGPT 订阅请求**已经全部经过中转站**：`/responses`、`/responses/compact`、`/alpha/search` 进 `serveChatGptBackend`（`gateway/gateway.ts:259-285,347,354-420`）；不带斜杠的模型名由 `relayToChatGpt` 原样转发，含 ChatGPT token 与 account id（`gateway/chatgpt-backend.ts:21-28,205`）；`<slug>/<model>` 发往第三方接口，不带 token。
- `codex-account-held.md`：只有闭源 ChatGPT 桌面应用在额度用完时拒发；app-server 与 exec 照发，ChatGPT 回 429 `usage_limit_reached`。
- 子任务 2 Q34：额度与 credits 都用完时怎么办，留给本任务。

## CLI 怎么启动

- Codex [V]：每个会话起一个 `codex app-server` 进程（`codex-app-server-agent.ts:3699-3733,7386-7448`），Osuna 不设 `CODEX_HOME`；新会话读新登录。
- Claude Code [V]：Agent SDK `query()`，每次 query 一个 claude 子进程；换模式、模型、思考档位、回退时重建（`claude/agent.ts:3206-3265,3412-3416`）。不注入 `CLAUDE_CONFIG_DIR`。运行中的 claude 会不会重读钥匙串，未核实。

## 规矩与存储

- ADR 0004:17「`~/.codex/auth.json` is never read or written」；:34 否决快照还原，因为 refresh token 只能用一次。ADR 0010：Osuna 不靠读 `auth.json` 认登录。
- `docs/usage.md:334`「Outbound requests」：套餐用量请求只在「读取 CLI 登录凭证」开时发；Claude 的 `oauth/usage` 没单列。
- 密钥存放 [V]：`$PASEO_HOME/api-endpoints/keys.json` 明文 JSON，文件 0600、目录 0700，原子写、带 `.bak`（`api-endpoints/store.ts:40-66`）。Osuna 从不写钥匙串。
- 界面：提供方页 `packages/app/src/provider-detail/index.tsx:258-350`；账号区可挂在 `renderApiEndpoints` 旁 [I]。
- 术语表没有 Account、Subscription、Sign-in 的独立词条；已有 Plan usage、Plan usage source、Report ID、Read CLI sign-ins、Ban risk notice、Resets left。
