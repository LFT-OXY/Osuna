# 访谈决定（子任务 9：多号自动轮换）

起步方式：总任务原定先 `/atw-map`，用户 2026-10-25 改用 `/atw-askme-with-docs` 访谈，定下同样的问题。

## 第 1 轮（2026-10-25）

- **Q1 换号节奏**：照 magpie——启动 1 分钟后看一次，之后每 5 分钟；当前号任一窗口用到 98% 换到下一个还有余量的号；排在前面的号所有窗口回到 90% 以下换回。
- **Q2 终端也跟着换**：换的是 CLI 自己保存的登录，终端里新开的 Codex / Claude Code 也用上新号；不为 Osuna 另建配置目录（会话和配置不分家）。
- **Q3 换号的告知**：只记录、不弹通知。账号列表写「何时从哪个号换到哪个号、因为哪个窗口到了多少」，Agent 的套餐用量卡片显示它登录的号。换号失败（号被登出等）才醒目提示。
- **Q4 每号上限**：每个号的每个窗口可设一个百分比上限，到了就让给下一个号；默认不设，按 98%。
- **Q5 固定一个号**：固定后完全不自动换，用完也不换，直到取消固定。

## 第 2 轮（2026-10-25）

依据：`osuna-current-state.md`、`magpie-rotation.md`、`cli-login-mechanics.md`。

- **Q6 续期**：选 (b) 照 magpie——Osuna 自己续存着的 Codex 号（`POST https://auth.openai.com/oauth/token`，用 Codex 的 client_id），当前登录的号也在到期前 5 分钟或 401 `token_expired` 时由 Osuna 续并写回；24 小时保活。Claude 照 magpie 由 Claude Code 自己续（每号一个私有 `CLAUDE_CONFIG_DIR`）。助手推荐的 (a)「在私有文件夹里起真的 Codex 续」未采用。**这是总任务 Implementation Decisions 第 15 条「登录续期如果必须由 Osuna 代办，在子任务 9 单独决定」的决定**：Codex 续期用 Codex 的 OAuth 客户端身份，写进本任务的 ADR；总任务「身份」验收项要为此加例外。
- **Q7 加号**：用户答「是，两家都这样加，照 magpie」，与助手推荐（Codex 用真的 Codex app-server 登录、Claude 在终端面板跑 `claude auth login`）和 magpie 的做法（Codex 由 magpie 自己跑 OAuth；Claude 跑真的 `claude auth login` 并由 magpie 截下登录地址）都对得上一半，第 3 轮重问。
- **Q8**：打开轮换时 CLI 当前登录的号自动成为第 1 个号。
- **Q9**：这次不做导入（02·B15 不做），只用 Q7 的方式加号。
- **Q10**：第二层照 magpie，默认开：有两个以上开着的 Codex 号时，即使没开「使用第三方接口」也写 `openai_base_url` 让 Codex 经过中转站；提供「只换登录」开关。代价已告知：Osuna 不在运行时终端里的 Codex 连不上。
- **Q11**：第二层的换号条件、粘性、有 credits 时再问一次，全部照 magpie（`fallback.go:1324-1350` 的错误清单、`holdWriter`、`affinity.go` 默认 auto、`bf2e067e`）。
- **Q12**：所有号都用完时照常报错；不做 magpie 为 Codex 桌面应用临时改服务商那一招。
- **Q13**：风险提示记在主机上，Codex、Claude Code 各一次。
- **Q14**：用户先问上游 Paseo 与 magpie 怎么做，第 3 轮带事实重问。

## 第 3 轮（2026-10-25）

- **Q7 加号**：两家都照 magpie。Codex：Osuna 自己跑 PKCE OAuth（Codex 的 client_id、回调 `127.0.0.1:1455`、端口被占时粘贴回调地址）。Claude：后台跑真的 `claude auth login`（新的私有 `CLAUDE_CONFIG_DIR`），Osuna 截下登录地址替用户打开浏览器，不弹终端。同属 Q6 的身份例外。
- **Q14**：用户问哪种更好用，第 4 轮带事实答。事实：上游的浏览器 UA 来自社区贡献 #1278（acea7f3d2，2026-06-20，提交注明与 Claude Sonnet 合写，没写理由），#5465 原样搬进插件；Osuna 加重置卡时用 `Osuna` UA 请求同一主机的 `wham/rate-limit-reset-credits`；magpie 用 Go 默认 `Go-http-client/1.1`；Codex 自己用 `codex_cli_rs/…`。
- **Q15 界面**：Codex、Claude Code 提供方页各加一节「账号」：「多号自动轮换」开关（默认关，第一次打开先弹风险提示）；账号列表（邮箱、套餐、各窗口用量、上限、状态：使用中 / 第一 / 暂时第一 / 恢复后回到第一 / 需要重新登录）；行菜单「立即使用」「设为第一」、上移下移（与 **Endpoint order** 同样的拖动与菜单）、设上限、「移除」；「固定登录到」选一个号；Codex 另有「只换登录」；最近的换号记录。
- **Q16**：第二层只按用户排的顺序（先当前登录的号）；magpie 的 7 种排序模式随块 8 以后再说。
- **Q17**：存着的号放 Osuna 数据目录里的文件，与 `keys.json` 同样处理（0600、原子写、留上一份好的、不加密）。
- **Q18**：「读取 CLI 登录凭证」关掉时两层换号、续期、查额度全停，存着的号保留；关闭确认框加「多号自动轮换会停止」。长时间不续可能失效，未核实。
- **Q19**：Claude 存着的号照 magpie 在其私有目录跑真的 `claude -p /usage` 查额度（顺带由 Claude Code 自己续期）；另加：每 5 分钟的检查也自动查存着的号（magpie 只在用户刷新时查）。没读到过额度的号不换上。

## 第 4 轮（2026-10-25）

- **Q14**：选 (a)，查 Codex 额度保持上游的浏览器 UA（`Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)`），存着的号的额度读取走同一处代码；助手推荐的 (b) `Osuna/版本号` 未采用。理由：合并上游少冲突，三种写法用起来没有已知区别。与 Q6、Q7 同记为总任务第 15 条「身份如实」的例外。
- **Q20**：Claude Code 开着「使用第三方接口」时轮换照常转（订阅号此时用不上，中转站不转发 claude.ai 登录，ADR 0012），账号一节顶上加一行说明。
- **Q21**：中转站账本给经过第二层的请求记上答话的号（「官方 · 邮箱」），用量页分组不改。
- **Q22**：「移除」当前登录的号只删 Osuna 存的那份，不登出 CLI；轮换开着时下次检查按规则换到排第一、有余量的号。

## 第 5 轮（2026-10-25）

- **Q23 叫法**：照助手拟的表，已写进 `docs/glossary.md` 的 **Account**、**Rotate accounts**、**Limit**、**Keep signed in to**、**Only switch the sign-in**。
- **Q24 风险提示**：Codex 引 OpenAI SIWC 条款 §4「Creating multiple accounts, splitting usage, rotating accounts, or otherwise bypassing usage limits」，加 Codex 维护者在 openai/codex#20884 的话并注明是员工说法、不是条款；Claude Code 引 Anthropic 使用政策「为规避检测或产品限制而建多个账号」属平台滥用，并写明公布的额度以正常个人使用为前提；都写「可能被限制或封号」；按钮「我知道了，打开」「取消」。出处见总任务 `subscription-ban-risk.md` [W26]、[W3]、[W1] 与本任务 `cli-login-mechanics.md`。
- **Q25 汇总确认**：用户回「对」。助手照 magpie 默认、已告知的：支持 Codex 钥匙串存储、Linux / Windows 上 Claude 的文件存储；开着的 Claude Code 会话可能在登录过期时跟着换到新号；旧 Codex 会话续期可能让旧号「需要重新登录」，只写进说明不专门防。discover 结束，进入 specify。

## 第 6 轮（2026-10-25，`/atw-spec`）

- **Q26 测试接缝**：用户回「可以」。主接缝是 daemon 端到端测试（真实 daemon；登录存放处换成临时目录与假钥匙串；本机假 OpenAI 登录 / 续期服务、假 ChatGPT 后端；假 `claude` 程序只答 `/usage` 与登录；可拨的时钟）；界面用 app 浏览器测试（真实测试 daemon + 假数据），截图用无头 Chromium + 假数据，不在用户的 Osuna 里拍；已有纯逻辑套件按需加用例；真实账号由用户验收。
- 写 `prd.md` 时助手新定、在确认 `prd.md` 时告知用户的：
  - 差距明细逐行标「做 / 不做」，访谈没涉及的 B19（暂停在用的号）、B21（号只服务某些模型）、B22（别名）、B23（每号代理）、B28（只在我要时读）、B29（按号选要不要花 credits 的开关）、B33（记每号上次答话时间、菜单栏）都标不做。
  - 每个号没有单独的开关（magpie 的 `On`），不想用就移除。
  - 换号记录每个提供方保留最近 50 条，重启不丢。
  - 当前登录的 Claude 号额度沿用现有套餐用量来源的读法；存着的号用 `/usage`（Q19）。
  - 远程设备（手机、别的电脑上的网页）加号：给出登录链接，登录完把浏览器最后跳到的地址（Codex）或页面上的代码（Claude）粘回来；主机上的桌面端直接打开浏览器。
  - 风险提示在 Q24 的基础上各多引一句：Codex 引 SIWC §1「Do not impersonate OpenAI, another application…」（Osuna 加号与续期用 Codex 的身份，正是这一条）；Claude 引法律页「developers may not collect, store, or intermediate Claude.ai credentials or session tokens」（Osuna 存着别的号的登录，正是这一条）。
- **Q27 确认 prd.md（第 ② 个确认点）**：用户回「确认」，含第 6 轮助手新定的各处。进入 slice。
