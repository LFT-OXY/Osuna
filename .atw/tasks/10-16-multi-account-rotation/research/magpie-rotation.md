# magpie 的多号轮换（HEAD `d5805372`，2026-10-25）

子代理只读源码，未构建、未运行。路径相对 magpie 仓库根。总任务对照基准是 `7597c132`，其后与账号相关的改动见文末。

## 账号存放

- `logins.json`（与 `providers.json` 同目录）明文 JSON，0600 / 目录 0700，原子写，先留上一份好的（`internal/provider/logins.go:177,271,310-321`）；跨进程文件锁 `logins.json.lock`，续期另有 `.renew.lock`、`.codex.lock`。
- 每个号（`savedLogin`，`logins.go:69-130`）：`ID`、`Order`、`Agent`、`User`、`Plan`、`On`；`Auth` 是 CLI 的整份登录（Codex `auth.json` 或 Claude 凭证 JSON，含 refresh token）；Claude 另存 `Profile`（`oauthAccount`）；状态 `Renewed`、`Lapsed`、`Refused`、`Paused`、`Held`、`Home`。
- 每号每窗口上限在 `providers.json`：`AccountCaps`（1–99）、`AccountWindowCaps`（`account_caps.go:1-60`）。
- 规则：**一个 refresh token 只有一个持有者**（`logins.go:3-9`）；存着的号的 token 只在 `logins.json`，不抄进 CLI 的存储。
- 「换回」记录在 `login-returns.json`（`codex_switch.go:255-313`）。

## Codex 第一层：换登录

- `KeepOnAnAccountWithRoom`（`codex_switch.go:336-373`）：启动 1 分钟后、之后每 5 分钟（`:46`），对 codex 与 claude 都跑。
- 98% 换走（按顺序模式 100%）；第一个号所有窗口低于 90% 换回（`:51-79,194-198`）。到上限、`Held`（Codex 应用不让发：不允许且无 credits）、窗口重置时间已过但读数没更新，也算用完。
- 目标（`NextLogin`，`:145-213`）：按 `Order` 第一个有余量的号；必须开着、没失效、不在别的 CODEX_HOME、**有已知且无错的读数**、低于阈值与上限。
- 排序模式：Smart（默认）、order、rotate、usage、pace、weight、free（`routing.go:23-35`）；换登录只用 Smart 的「用完」判定。
- 固定：`KeepLogin`（固定第一个）、`KeepLoginAs`（固定选中的）；中转站仍在各号间分请求。
- 换法（`switchSavedLogin`，`logins.go:1171-1265`）：上锁 → 把 CLI 里当前的登录（最新一份）存回 `logins.json` → 把目标号写进 CLI 的存储（`codex_store.go:597-635`，按 `cli_auth_credentials_store`：`file` 写 `~/.codex/auth.json`；`keyring`/`auto` 在 macOS 写钥匙串 `Codex Auth`、账号 `cli|<sha256(CODEX_HOME)[:16]>`；`ephemeral` 或读不了就拒绝）→ 记下已开着的 app-server / Codex 应用还在旧号上。开着的会话不换。
- 续期：**magpie 自己续 Codex 的 token**，`POST https://auth.openai.com/oauth/token`，用 Codex 的 OAuth client_id `app_EMoamEEZ73f0CkXaXp7hrann`（`account.go:941-945,1118`）；当前号到期前 5 分钟或 401 `token_expired` 时续，写回 `auth.json` / 钥匙串；存着的号用时续，另有 24 小时保活（`keepalive.go:26,40-75`）。与 Codex 本体没有共享锁，只靠续前重读。

## 读 Codex 额度

- `GET https://chatgpt.com/backend-api/wham/usage`，只带 Bearer、Accept、`chatgpt-account-id`，UA 是 Go 默认（`subscription_usage.go:948-975`）。模型请求则自称 `codex_cli_rs`（`codex_request.go:31-95`）。
- 读回 primary / secondary 窗口、`allowed`、credits、`spend_control`、`rate_limit_reached_type`、重置卡。
- 存着的号：先在 `logins.json` 里续 token 再读（`login_usage.go:286-370`），各号并行，缓存 1 分钟。
- 回复里的 `x-codex-primary-*` / `x-codex-secondary-*` 头与 `codex.rate_limits` 事件也按号记下。

## Codex 第二层：经过中转站

- 开着的 Codex 号多于一个、没关成只换登录时，写 `openai_base_url = http://127.0.0.1:3425/backend-api/codex`（`internal/agent/codex.go:861-925`）。
- 候选：登录的号加勾选的号，按排序模式排，被限流的排后（`codex_backend.go:712-750`）。
- 换下一个号的错误（`fallback.go:1324-1350`）：401、402、403、404、408、429、全部 5xx、模型下线、边缘拦截，以及文字像额度 / 不支持模型 / 拒绝的 400 / 422。对话太长不重试。
- 回复第一个字前：`holdWriter`（`fallback.go:1615-1700`）扣住错误回复与流的开头，什么都还没发给 CLI 时才换。
- 粘性（`affinity.go:1-50`）：默认一轮内不换；读写过 ≥1024 缓存 token 且上次回复在 5 分钟内，跨轮也不换。
- 「只换 Codex 的登录」（`SwitchOnly`，`routing.go:95-120`）关掉第二层。

## Claude Code

- 换法（`putClaudeLogin`，`logins.go:1268-1310`）：macOS 用 `security add-generic-password -U` 写钥匙串 `Claude Code-credentials`（账号 `$USER`），其他系统写 `~/.claude/.credentials.json`；把存着的 `Profile` 换进 `~/.claude.json` 的 `oauthAccount`；号的代理同步到 `settings.json`。登录不可用的号拒绝换上。
- **magpie 从不续 Claude 的 token，也不连 Anthropic**，由 Claude Code 自己续：存着的号各在自己的 `CLAUDE_CONFIG_DIR`（`claude-accounts/<sha16>`，钥匙串 `Claude Code-credentials-<sha8>`），续出的新 token 抄回（`claude_dirs.go:1-60`）。
- 读额度：跑 `claude -p /usage --output-format json --tools "" --strict-mcp-config --setting-sources "" --no-session-persistence`，解析 `Current session: 13% used · resets …`（`internal/gateway/claude_warmup.go:85-125`、`claude_usage_cli.go:61`）。当前号：启动一次、用户刷新（≥30 秒间隔）、否则 5–15 分钟随机且仅当会话记录有变化。
- 从没读到过额度的存着的号**永不换上**。阈值同 Codex。Claude 订阅不经过中转站。

## 加号、导入、重新登录

- Codex：magpie 自己跑 PKCE OAuth，用 Codex 的 client_id，回调 `127.0.0.1:1455`，带 `originator=codex_cli_rs`（`signin.go:40-45,340-366`）。
- Claude：在全新配置目录里跑真的 `claude auth login`，magpie 充当「浏览器」截下登录地址（`claude_signin.go:1-50`）。
- 导入（02·B15，`login_import.go`）：ChatGPT 从 Codex `auth.json`、CLIProxyAPI、Cockpit Tools、Sub2API、codexbar、裸 refresh token；**导入时先续一次，会把来源工具登出**，界面与 CLI 都警告。Claude 从 CLIProxyAPI、Sub2API，不续。没有 refresh token 的拒收。
- 续期被拒 → `Lapsed`；401 `token_revoked` / `invalid_grant` / `refresh_token_reused` → `Refused`。界面显示「需要登录」和「重新登录」。

## 全部用完、与第三方接口

- 第一层：没有有余量的号就不动。
- 中转站：歇着的号仍排最后试；全部到上限时报「usage cap/limit reached … until <time>」；允许用重置卡的号会自动用一张（本任务不做）；有 credits 的号 429 后再问一次。
- Codex 桌面应用的号用完时灰掉发送：magpie 临时把 Codex 改成 `model_provider = "magpie"`，有余量后改回（`agent/codex.go:1081-1117`）。只影响闭源桌面应用。

## 界面

- 每个号：开关点、套餐、各窗口用量条、上限、状态（「第一」「使用中」「暂时第一」「有余量后恢复第一」「需要登录」+「重新登录」）、操作（使用 / 设为第一 / 移除 / 登出）、「固定登录到…」与「只换 Codex 的登录」开关。
- **没有换号通知，也不存换号历史**，只写日志（`codex_switch.go:232-247`）。

## 7597c132 之后与账号相关的改动

`73d17f90` 别的 CODEX_HOME 里的号不当目标；`ef37b6fb` 号用完时自带模型的一轮经过 magpie；`4683a038` 当前号的存档在 Codex 自己的存储里续；`85cde4a4` 跨进程续期锁；`3b8bcc36` 401 `token_expired` 时续一次；`bf2e067e` 有 credits 的号再问一次；`7b1faf99` 处理写到一半的 `auth.json`。阈值、上限、顺序、固定、保活未变。
