# 子任务 8 访谈决定

早先总任务的决定：Q21 做这个小子任务；Q25 排在子任务 9 之前，因为 9 要用这里的总开关和风险提示做法（见 `../../10-16-magpie-osuna-gaps/research/decisions.md`）。

## 访谈（2026-10-25，`/atw-askme-with-docs`，两轮 Q1–Q15，用户全部采纳推荐）

访谈前核实的现状：

- 读 CLI 登录的套餐用量来源共 10 个，都经 `UsageSourceRegistry`（`packages/server/src/server/plugins/usage-sources/index.ts`）：`plugins/` 下 claude（钥匙串 / `.credentials.json`，另读 Pi、OMP 的登录）、codex（`auth.json`，另读 OpenCode、Pi 的登录）、copilot、cursor（sqlite）、grok、kimi、minimax、zai（环境变量里的 key）、opencode-go，加 `muse-provider` 的来源（问 Muse 进程 `usage/read`）。
- 其余碰登录的两处：`api-endpoints/codex-sign-in.ts` 起临时 Codex app-server 问 `account/read`（ADR 0010）；`api-endpoints/import-apps.ts` 导入时读 OpenCode 的 `auth.json`。
- Pi 诊断（`agent/providers/pi/agent.ts` 的 `getDiagnostic`）只看 `~/.pi/agent/auth.json` 在不在，不读内容。
- magpie（`7597c132`）：`internal/settings/accounts.go`、`internal/provider/discovery.go`、`internal/agent/codex.go:308-327`、`internal/gui/assets/app.js:21130-21167`。设置叫「Subscription accounts」，在 Settings → Privacy，默认开；关前确认并按名列出会停的订阅；关后不读凭据文件与钥匙串、不问 CLI 谁登录；Codex 当成上次接的样子，关开关不改 Codex 配置；`MAGPIE_NO_ACCOUNTS` 只能关不能开；magpie 自己存的登录留着不读不写，打开后回来。

决定：

- **Q1 范围**：关后所有套餐用量来源都不跑，内置与用户安装的插件都算，含从环境变量读 key 的 Z.AI、MiniMax。第三方接口与其余额不受影响。
- **Q2 Codex**：关后不问 `account/read`，Codex 的登录方式按 Osuna 上次的接法算，关开关不改 Codex 配置（照 magpie）。
- **Q3 导入**：关后「从别的软件导入」跳过 OpenCode 的 `auth.json`，导入窗口说明一句「已关闭读取 CLI 登录凭证，OpenCode 没读」；CC Switch、Alma 照常。
- **Q4 开关**：主机级，存在 daemon；Switch；英文「Read CLI sign-ins」、中文「读取 CLI 登录凭证」；默认开，关 = 不读；主机设置页新增一节「Privacy / 隐私」，暂时只有这个开关。
- **Q5 环境变量**：`PASEO_NO_CLI_SIGN_INS=1`（名字暂定，spec 时可改）启动 daemon 时强制关，只能关不能开；界面开关显示「已由环境变量关闭」且不可操作。不加 CLI 子命令。
- **Q6 关前确认**：关时弹确认，按名列出当前显示套餐用量的账号（如「Claude（a@b.com）、Codex（c@d.com）的套餐用量会停止显示」），写明第三方接口照常；开时不弹。子任务 9 往这个框里加「多号自动轮换会停」。
- **Q7 关后**：daemon 立刻丢掉内存里的报告与账号，不落盘；设备上钉住的窗口保留，开回来就回来；套餐用量弹窗和用量页的套餐用量一节显示「已关闭读取 CLI 登录凭证，套餐用量不显示」和去开关的按钮；侧边栏摘要、输入框下的上下文条、上下文详情直接不显示。
- **Q8 Antigravity 提示形式**：Antigravity 提供方页最上方常驻黄色提示，不可关；启用时、选提供方时都不弹。做成可复用的「封号风险提示」（标题、正文、条款链接），子任务 9 沿用。
- **Q9 提示文字**（其余 8 种语言照意思翻译）：
  > **Antigravity 账号可能被封禁**
  > Google 的 Antigravity 常见问题写明：把 Antigravity CLI（`agy`）包进第三方应用使用，不在消费者套餐的支持范围内；用第三方软件访问 Antigravity 违反其服务条款，可能导致账号被暂停或终止。Osuna 正是通过 `agy` 驱动 Antigravity 的。2026 年 2 月那一轮封号还连带封了 Gemini CLI 和 Gemini Code Assist。请用丢了也不心疼的账号。
  > [Antigravity 常见问题 ↗](https://antigravity.google/docs/faq/)

  依据 `../../10-16-magpie-osuna-gaps/research/subscription-ban-risk.md` 的 [W48]、[W45]；「不支持」与「违反条款」是 FAQ 的两句话，分开写，不说 Osuna 的用法就是违规。
- **Q10 英文**：开关「Read CLI sign-ins」，一节「Privacy」，提示标题「{name} account may be suspended」。
- **Q11 开关说明**：「让 Osuna 读取各 CLI 自己保存的登录（登录文件、钥匙串），用来显示套餐用量。关掉后 Osuna 不读这些，套餐用量不显示；CLI 自己照常用自己的登录，第三方接口不受影响。插件里除了套餐用量以外的代码，这个开关管不到。」
- **Q12 权限**：改开关要 `daemon.manage`，看开关状态要 `daemon.read`。
- **Q13 兼容**：挂在 `server_info.features.*` 上。旧客户端（含官方 Paseo 手机 App）看不到开关，关着时套餐用量为空、无说明；新客户端连旧 daemon 不显示「隐私」一节。
- **Q14 Pi 诊断**：关后照常显示 `auth.json` 在不在。
- **Q15 提示何时出现**：不论 `agy` 装没装、Antigravity 启没启用，打开它的提供方页就显示；窄窗口下也显示，排最上面。
- 术语：`docs/glossary.md` 已加 **Read CLI sign-ins**、**Ban risk notice**。不写 ADR：开关可逆，没推翻已有规则。

## 测试接缝（2026-10-25，用户确认）

- daemon 端到端：测试 daemon + 夹具里的内置套餐用量来源与目录插件，经 daemon 配置切换开关；断言关后来源的 discover / fetch 不被调用、新旧两个套餐用量 RPC 都空、环境变量锁住、不问 Codex 登录方式、导入跳过 OpenCode、开回来恢复。
- app 浏览器测试：隐私一节与开关、关前确认列名、套餐用量弹窗与用量页的说明行、Antigravity 页提示；可失败操作测成功与失败。
- 9 种语言靠现有 i18n 测试。
