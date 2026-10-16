# 差距清单 · Agent 接入、方案与用量花费额度会话

范围：magpie 支持的 Agent 与接入方式、Claude Code 与 Codex 的接入细节、其他 Agent 的接入、命令行、方案（Profile）、用量与花费、价格、额度、会话、上下文与调参、账单导出限额。
由子代理通读两边源码得出（2026-10-16）：magpie HEAD `7597c132`，Osuna HEAD `21a4f721d`。引用为各自仓库内的 `文件:行号`；文中的「你」指派活的主会话。只记事实，不做取舍。

---

本次只读对照，两边仓库都没改。magpie 取的是 HEAD `7597c132`，Osuna 取的是本 worktree（HEAD `21a4f721d`）。

**路径约定**（后文全部用缩写）
- M: = `/Users/oxy/Documents/Configuration/dev-environment/demo/agent客户端源码/magpie/`
  - ref = M:docs/reference.md，aw = M:docs/subsystems/agent-wiring.md，gs = M:docs/subsystems/gateway-sessions.md
  - ia/ = M:internal/agent/
  - mi18n = M:internal/gui/assets/i18n.js，ui18n = M:internal/gui/assets/plugins/usage/i18n.js，si18n = M:internal/gui/assets/plugins/sessions/i18n.js
- O: = `/Users/oxy/.paseo/worktrees/0x9u2djy/curvy-bullfrog/`
  - ae/ = O:packages/server/src/server/api-endpoints/
  - pm = O:packages/protocol/src/provider-manifest.ts，acp = O:packages/app/src/data/acp-provider-catalog.ts，zh = O:packages/app/src/i18n/resources/zh-CN.ts
- 上一轮任务目录 = O:.atw/tasks/archive/2026-10/10-13-api-endpoint-auto-switch/，下面的 map、prd、T05 依次指其中的 map.md、prd.md、map-issues/05-gateway-surface.md。
- 「没有」项凡写「搜」，范围都是 O:packages/{server,app,protocol,cli}/src、plugins、docs，排除 node_modules、dist、.expo、generated。

**两边形态怎么对应**
- **改模型**：magpie「给 Agent 选模型」的做法是改 CLI 配置文件，所有新会话都生效。Osuna 分两层：
  - Osuna 自己跑的会话，在输入框里按会话选模型、思考档位、模式；
  - 终端里的 CLI，只有打开「使用第三方接口」后，Osuna 才写入中转站地址和默认模型，而且只覆盖 Claude Code 和 Codex。
- **会话**：magpie 的「会话页」对应 Osuna 的三处：会话历史（列出提供方会话、在终端续、导入为 Osuna Agent）、Osuna 自己的 Agent 时间线、用量页里按天列出的会话。

---

## 1. 功能清单

### 1a. magpie 支持的 Agent 清单

代码里内置 62 个（ia/agents.go:89-153）。ref:88-151 的表只有 57 行，少了 Claude Science、Antigravity CLI、Cursor Private Inference、Pencil、Cindy，以代码为准。另外还有三类动态行：omp 的命名 profile、Windows 上的 WSL 副本、插件定义的 Agent。

**Osuna 能运行的（21 个，另有 2 个可能）**

| Agent | magpie 怎么接（文件 · 可设字段） | Osuna 怎么运行 | Osuna 第三方接口 |
|---|---|---|---|
| Claude Code | ~/.claude/settings.json · 模型、推理强度、ultracode、四档、子代理、登录方式（ref:92） | 原生（pm:201） | 已接 |
| Codex | ~/.codex/config.toml · 模型、强度、子代理、子代理强度、记忆、登录方式（ref:94） | 原生（pm:214） | 已接 |
| Copilot CLI | ~/.copilot/settings.json，只能改它自己的模型和强度，Agents 页标「无法接入」（ia/agents.go:1361-1404） | 原生，默认关（pm:227） | 明确不做（map:41） |
| OpenCode | opencode.json(c) · model、small（ref:96） | 原生，默认关（pm:236） | 明确不做（map:41） |
| Pi | ~/.pi/agent/settings.json + models.json · 模型、思考（ref:100） | 原生（pm:252） | 第二期（map:40） |
| omp | ~/.omp/agent/config.yml + models.yml · 模型、思考；每个命名 profile 单独一行（ref:120、aw:23） | 原生（pm:260）；命名 profile 要手写自定义提供方（O:docs/custom-providers.md:407-440） | 第二期（map:40） |
| Antigravity CLI | antigravity-cli/settings.json 里加自定义模型，再给一条带环境变量的启动命令（ia/agy.go:1-14） | 内置插件（O:plugins/antigravity-provider/server/provider.ts:25） | 明确不做（map:41） |
| Muse Code | ~/.config/muse/settings.json 的 endpoint_transport（ref:126） | 内置插件（O:plugins/muse-provider/server/provider.ts:34） | 明确不做（map:41） |
| Gemini CLI | settings.json + .env · 认证、模型（ref:95） | ACP 目录（acp:182） | 明确不做，但上一轮写的理由「Osuna 不支持」与现状不符（map:41） |
| Goose | config.yaml · 模型，Agents 页标「只能用自身 provider」（ref:106、M:internal/gui/assets/app.js:1151-1156） | ACP 目录（acp:214） | 没提到 |
| Cursor CLI | cli-config.json，只能改自身模型，无法接入（ref:107） | ACP 目录（acp:113） | 没提到 |
| Devin | 只能改自身模型，无法接入（ref:121） | ACP 目录（acp:131） | 没提到 |
| Hermes Agent / Kimi Code / Qwen Code / MiniMax Code / Droid / Cline / Qoder / Grok Build / CodeBuddy Code | 各自写一个 magpie provider，把 magpie 的模型放进它们的 /model（ref:122-141） | ACP 目录（acp:233/269/333/278/159/58/324/223/68） | 没提到 |
| OmO / Prime Agent | Pi 系的 settings.json（ref:104-105） | 可能可以：自定义提供方 extends pi（O:docs/custom-providers.md:440 起），未验证 | 没提到 |

**Osuna 不能运行的（39 个）**：Claude Desktop、Claude Science、OpenChamber、MiMo Code、DevEco Code、StepCode、MothX、Aside、Cursor Private Inference、Zed、VS Code Chat、VS Code Insiders、VSCodium Chat、Copilot (JetBrains)、JetBrains Air、Crush、DeepSeek Harness、Reasonix Studio、Command Code、fx、Mister Morph、Empryo、Ante、AstrBot、jcode、Qoder CN、Grok App、ZCode、WorkBuddy、WorkBuddy AI、Pencil、Raycast、T3 Code、OpenHanako、AtomCode、Snow CLI、Alma、Cindy、Lody。
- 写哪些文件见 ref:93-148，以及 ia/claudescience.go、ia/cursorlocal.go、ia/pencil.go、ia/cindy.go。
- 这些都不在 Osuna 内置提供方和 ACP 目录里。其中支持 ACP 的 CLI，理论上可以手动加成通用 ACP 提供方（O:docs/custom-providers.md:495 起），没有逐个核实。
- 上一轮对它们都没提到。

### 1b. 功能明细

#### A. Agent 接入与管理（通用）

| 编号 | magpie 功能 | magpie 出处 | Osuna 现状 | Osuna 证据 | 差在哪 | 上一轮的态度 |
|---|---|---|---|---|---|---|
| A01 | 识别并接入 62 种 Agent，外加 omp profile、WSL、插件 Agent 三类动态行 | ia/agents.go:89-153；README.zh-CN.md:73-83 | 部分 | 能运行 21 种（见 1a）；第三方接口只接 claude、codex（ae/store.ts:34） | 其余 19 种能跑的不经中转站；另外 39 种 Osuna 不运行 | Pi/OMP 第二期；Copilot、OpenCode、Antigravity、Muse、Gemini CLI 明确不做（map:40-41、prd:223）；其余没提到 |
| A02 | 自动发现：看配置文件、目录或命令；PATH 会扩到登录 shell 和 nvm、bun、Homebrew 等目录；别的工具共用的目录不算 | aw:104 | 有（形态不同） | 按可执行文件判断装没装，没装显示「未安装」（O:packages/server/src/executable-resolution/executable-resolution.ts、O:packages/app/src/provider-detail/status.ts:45） | 只覆盖 Osuna 自己的提供方 | 没提到 |
| A03 | 找到了 CLI 但终端 PATH 里没有，提示「不在终端的 PATH 里」 | aw:104；mi18n:664 | 没有 | 搜 `terminal's PATH`、`login shell` 于 agent/provider-*.ts 无命中 | 整项缺 | 没提到 |
| A04 | 卸载后只剩配置目录时显示「未找到 CLI」，隐藏它的设置 | aw:105；mi18n:663 | 有（形态不同） | 同 A02，按命令判断 | — | 没提到 |
| A05 | 隐藏不用的 Agent、拖动排序 | mi18n:498,505 | 部分 | 只能开关提供方（O:docs/custom-providers.md:466-485） | 没有排序；关掉就从 App 和 CLI 里整个消失，不是只隐藏一行 | 没提到 |
| A06 | 打开「接入」时自动选起始模型，并说明是怎么选的（保持、回到断开前、沿用原模型、档位别名、默认、第一个）；没有可用模型就拒绝并说原因 | ia/applied.go:484-505；mi18n:624 | 部分 | 总开关打开时没设默认模型，就取最早建的接口的第一个已选模型；关开关时保留已存的默认模型；打不开时说明原因（prd:102 R-A2、zh:2569-2572） | 不看 CLI 当前在用的模型；不告诉用户这次是怎么选的 | 已做（R-A2） |
| A07 | 在一个可搜索的总列表里挑任意 provider 的模型；挑了 magpie 的模型就顺带接入 | ref:43-61；aw:33 | 部分 | Agent 页有「默认模型」下拉（只有光秃秃的模型名）；聊天里的模型选择器按接口分组（prd:142-143 R-E4/E5） | 选模型不会自动打开总开关 | 已做（R-E4/E5） |
| A08 | 断开时把每个键还原成接入前的值，并记住「用户断开过」，之后的同步不会再把它接回去 | aw:21,36 | 有 | ae/claude-settings-patch.ts:263-311；O:docs/adr/0004-api-endpoint-rewrites-cli-config.md:11 | — | 已做（R-B5） |
| A09 | 断开前预览：在临时副本上真跑一遍断开，逐行列出会改回、删除、新建的地方 | ia/preview.go:22-29；mi18n:594 | 没有 | 搜 `dryRun`、`disconnectPreview`，命中只在 Claude rewind 和 hub deploy | Osuna 只在「会回到官方」时弹确认框 | 没提到 |
| A10 | 外部改动检测：配置被别的程序改了时，分五种情况说明原因（不再经过、模型被换、被绕过、地址没人应答、代理不转发），给出「如何修复」「重新应用」「保留当前设置」 | aw:19,35；mi18n:509-520 | 部分 | daemon 会比对自有键，返回 health（modified_externally / config_unparsable / codex_profile_override）（ae/service.ts:182,1248-1281,1651-1661） | 新界面不显示 health（app 里只读 gatewayUnavailable，见 O:packages/app/src/api-endpoints/internal/agent-settings.ts:13-15）；不查地址可达、代理、绕过；没有「保留当前设置」 | 检测已做（R-B5）；健康提示在新界面被去掉（prd:142 R-E4「健康提示去掉」） |
| A11 | Agent 经反向代理或本机带路径的代理到 magpie，不算漂移，同步时保留代理路径；指向另一台机器的地址也保留 | aw:35,41 | 没有 | 每次改写都把 baseUrl 固定写成中转站地址（ae/claude-settings-patch.ts:236-251） | 整项缺 | 没提到 |
| A12 | 端口一变，就把新地址写进所有已接入的 Agent | ia/rewire.go:9-13 | 有 | daemon 启动绑定端口后比对，不一致就重写（ae/service.ts:295-323,631-669） | 两边时机不同，效果等价 | 已做（R-B6、T05:61） |
| A13 | provider 被关掉或删掉后，把还指向它的 Agent 挪到别家的同名模型，或回到自身默认，并列出挪了什么 | ia/reseat.go:11-17 | 有（形态不同） | 默认模型失踪时改成第一个可用模型；一个都不剩就关掉总开关（ae/host-endpoints.ts:95-112） | 挪到的是第一个可用模型，不找同名 | 已做（R-A4） |
| A14 | 模型目录一变（加 provider、插件登录或列出新模型），就同步各 Agent 文件里的模型清单，保留用户在 magpie 那块里加的键 | aw:41-46 | 有（只覆盖 2 个 Agent） | 接口、已选模型或开关一变，就重写 modelPicker 和 Codex 模型目录（O:docs/adr/0007-api-endpoints-route-through-daemon-gateway.md:12-13） | 只有 Claude Code 和 Codex | 已做（R-B3/B4） |
| A15 | 精确改文件：只动一个键；保留注释、顺序、BOM、CRLF；支持 JSON、JSONC、TOML、YAML、env；原子写入；解析不了就不写 | ref:43-46；aw:65-66 | 有（范围窄） | Claude 用 jsonc-parser 改单键（ae/claude-settings-patch.ts:473-485）；Codex 按 TOML 节点拼接并保留 BOM（ae/codex-config-patch.ts:255-258）；写前算 hash、替换前重读（ae/config-file.ts:29-40） | settings.json 用 JSON.parse 解析（ae/claude-settings-patch.ts:392-395），带 BOM 或注释的文件会被拒绝，而不是照常修改 | 已做（R-B5） |
| A16 | 第一次改写前留一份逐字节备份 | aw:21 | 有 | ADR 0004:13 | — | 已做 |
| A17 | 改完后提示要重开谁：哪些 Agent 只在启动时读配置、有几个还在跑旧清单、每个怎么重启 | mi18n:545-560 | 没有 | ADR 0004:37 写明，ADR 0007 之后开关就是一个普通开关，不再显示受影响的会话数 | 整项缺 | 没提到 |
| A18 | 每个 Agent 的常用模型短名单：「显示 5 / 32 个模型」，可按 Agent 隐藏、只显示勾选的、显示 Agent 自带的模型、拖动排序 | ref:72-80；mi18n:458-476 | 没有 | 搜 `hiddenModels`、`visibleModels`、`onlyPicked` 无命中；收藏模型在 v0.3.2 已删掉（O:packages/app/src/agent-profiles/migration/index.ts:38） | 整项缺 | 明确不做：「按 Agent 精简模型（magpie 的隐藏 / 只用挑选的模型）…08 票定为第一版不做」（map:53、prd:230） |
| A19 | 可选 Agent 模型清单里的命名方式（只写模型名，或带 provider 名） | M:internal/settings/settings.go:389-399 | 部分 | modelPicker 固定写法：label 是模型显示名，description 是接口名（prd:112 R-B3） | 不能选 | 已做（固定做法） |
| A20 | 用插件（*.agent.js）新增 Agent：声明配置文件、格式、模型键；可以只接入、不选模型 | aw:26,101 | 没有 | Osuna 插件只能新增「能运行的提供方」（O:docs/providers.md:6-23） | 整项缺 | 明确不做：「中间件/插件系统」（map:42） |
| A21 | 只认环境变量的 Agent：给一条带环境变量的启动命令（Antigravity CLI），或写用户级环境变量（Cursor Private Inference） | aw:27；ia/agy.go:40-46 | 没有 | Osuna 运行 agy 时可以注入 env（O:public-docs/supported-providers.md:46-60），但中转站不讲 Gemini 协议 | 整项缺 | Antigravity 明确不做（map:41）；Gemini 协议第二期（map:40） |
| A22 | Claude Science：带上 ANTHROPIC_BASE_URL 重启它的 daemon，并每分钟守着 | aw:28 | 没有 | Osuna 不运行它 | — | 没提到 |
| A23 | Lody、Cindy 导入链接：打开对方 App 的确认框，把 magpie 加成 provider | aw:136-162；ia/cindy.go | 没有 | 同上 | — | 没提到 |
| A24 | WSL：每个运行中的发行版里的 Agent 单独成一行，按网络模式写地址，停着的发行版不启动 | aw:24,95；M:internal/wslrun/wslrun.go:1-8 | 没有 | 搜 `wsl`，只有 claude/project-dir.ts:41 一处注释 | 整项缺 | 没提到 |
| A25 | Zed 兼容分支：用 MAGPIE_ZED_BIN、MAGPIE_ZED_CONFIG_DIR、MAGPIE_ZED_PROCESS_NAMES 指定程序、配置目录、进程名 | ref:203-227 | 没有 | Osuna 不运行 Zed | — | 没提到 |
| A26 | 个别 Agent 的接入说明（StepCode、MothX、Reasonix、VSCodium 的前置设置和重启要求） | ref:153-201 | 没有 | 同上 | — | 没提到 |
| A27 | 显示 CLI 版本和最新版（Homebrew 装的看 Homebrew，其余看 npm） | ia/cliupdate.go:3-9,36-48 | 部分 | 内置 6 家显示已装版本和最新版，最新版只查 npm（O:packages/server/src/server/agent/provider-version-check.ts:7-12） | 不按 Homebrew 查；插件和 ACP 提供方没有版本对比 | 没提到 |
| A28 | 按当初的安装方式一键更新（自带更新器、npm、bun、pnpm、brew）；Windows 上会提权；可以一次全部更新 | ia/cliupdate.go:3-9；mi18n:645-660 | 部分 | 内置 6 家一键升级：用自带子命令，Codex 按安装方式选，Claude 的 brew cask 用 brew（O:packages/server/src/server/agent/provider-upgrade-command.ts:3-47） | 没有「全部更新」；不认 bun、pnpm；不提权；插件和 ACP 提供方不能升级 | 没提到 |
| A29 | 更新后退出码是 0 但 CLI 跑不起来，就修一次，修不好报失败 | 4f08533e | 部分 | 升级正常退出但版本没变，判为失败（O:.atw/tasks/archive/2026-10/10-08-provider-install-upgrade-guide/prd.md:13） | 不检查能不能跑 | 没提到 |
| A30 | 没装的 Agent 给官方安装命令；本机没有 Node.js 时先用 nvm 或 winget 装 | ia/install.go:3-14；mi18n:662-675 | 部分 | 内置 6 家常驻「安装与升级」区块，按系统分标签、可复制（O:packages/app/src/provider-install-guide/internal/commands.ts）；ACP 目录有安装链接 | 不自动补装 Node；插件提供方没有安装命令 | 没提到 |
| A31 | 同时显示 Agent 桌面 App 的版本 | mi18n:678 | 没有 | — | — | 没提到 |
| A32 | provider 改名后，各 Agent 配置里的引用跟着改 | aw:15,88 | 有（不需要） | 接口标识自动生成并锁定，改名只改显示名（prd R-A1） | — | 已做 |

#### B. Claude Code

| 编号 | magpie 功能 | 出处 | Osuna 现状 | Osuna 证据 | 差在哪 | 上一轮的态度 |
|---|---|---|---|---|---|---|
| B01 | 写 ANTHROPIC_BASE_URL 和 ANTHROPIC_AUTH_TOKEN（按 Agent 区分，用于记用量） | ia/claude.go:33-38,1481-1486 | 有 | 写中转站地址、随机口令，并把 ANTHROPIC_API_KEY 置空（ae/claude-settings-patch.ts:236-251） | Osuna 的口令保密、只认本机，比 magpie 严 | 已做（R-B3） |
| B02 | 起始模型写在顶层 model；接入时取走 ANTHROPIC_MODEL，断开时放回 | ia/claude.go:28-31,1470-1475 | 有 | ae/claude-settings-patch.ts:27-31,134-138 | — | 已做 |
| B03 | 四档（opus/sonnet/haiku/fable）按 Agent 各设一个模型，可带推理强度，默认跟随主模型 | ia/claude.go:148,1695-1740；aw:69-70 | 有（形态不同） | 档位按每家接口映射，由中转站翻译；接管时删掉 ANTHROPIC_DEFAULT_*_MODEL（ADR 0007:11；prd:141 R-E3） | 不能按 Agent 设；不能带强度 | 已做（04 票） |
| B04 | 后台小任务模型（ANTHROPIC_SMALL_FAST_MODEL 跟 haiku 档） | ia/claude.go:1485 | 没有 | 接管时删掉（ae/claude-settings-patch.ts:27-31） | — | 明确不做：「Claude Code 后台小任务…第一版不分流」（prd:231） |
| B05 | 子代理模型（CLAUDE_CODE_SUBAGENT_MODEL，可带强度） | ia/claude.go:1741-1838 | 没有 | 搜 `CLAUDE_CODE_SUBAGENT_MODEL`，只在 daemon-e2e/real-provider-test-config.ts:107 | — | 明确不做：「子代理模型由用户自己管」（T05:47） |
| B06 | 新会话推理强度（effortLevel、modelSettings 里的；max 写 CLAUDE_CODE_EFFORT_LEVEL） | ia/claude.go:1584-1660 | 部分 | Osuna 会话里按会话选思考档位（O:packages/server/src/server/agent/providers/claude/model-manifest.ts:13-46） | 终端新会话的起始强度不管 | 没提到 |
| B07 | Ultracode 开关（只对支持 xhigh 的模型） | ia/claude.go:1661-1694 | 部分 | 「Ultra Code」是 Osuna 会话里的一个思考选项（同上 :35,214） | 不写进 settings.json | 没提到 |
| B08 | 登录方式：用 magpie 的 key，或保留 claude.ai 登录（token 置空，magpie 不转发） | aw:74；ia/claude.go:1839-1869 | 没有 | 一律写口令（ae/claude-settings-patch.ts:240-247） | 没有保留 claude.ai 登录的选项 | 没提到 |
| B09 | 终端 /model 列出 magpie 的模型；用户自己写的 modelPicker 不碰；靠「via magpie」认出自己写的那份 | aw:79；ia/claude.go:916-970 | 有 | ae/claude-settings-patch.ts:20-21,212-233 | 接管记录丢了，就把现有 picker 当成用户的、不再更新，没有指纹认回 | 已做（17 票） |
| B10 | 告诉 Claude Code 未知模型的能力：1M 模型加 [1m]，写上下文、回复上限、档位三个变量；到 max 但没有 xhigh 的模型也报 xhigh | aw:76-77；d1c485f7 | 部分 | ae/claude-model-hints.ts:11-74,101-108 | 没有 xhigh 这条规则 | 已做（18 票）；xhigh 规则是 10-14 新加的 |
| B11 | 接入期间关掉自动模式的服务端审查（CLAUDE_CODE_AUTO_MODE_SERVER=0） | aw:75；ia/claude.go:283-292,1020-1053 | 没有 | 搜 `AUTO_MODE_SERVER` 无命中 | — | 没提到 |
| B12 | 云厂商开关（Bedrock/Vertex/Foundry 等）会绕过网关：接入时拿掉，断开时放回；写在 managed settings、~/.claude.json 或 shell 里的就提示 | aw:73；ia/claude.go:72-145,1259 | 没有 | 搜 `CLAUDE_CODE_USE_BEDROCK`、`USE_VERTEX` 无命中 | — | 没提到 |
| B13 | 管理员的 managed-settings.json 里的 ANTHROPIC_BASE_URL 会盖过 magpie，提示出来 | ia/claude.go:1979-1990 | 没有 | 搜 `managed-settings` 无命中 | — | 没提到 |
| B14 | 带点的版本号（claude-opus-4.6）写进去时改成连字符，免得 Claude Code 认错 | aw:80；M:internal/provider/claudedash.go:87 | 没有 | 在 ae/ 搜 `dotted`、`respell` 无命中 | — | 没提到 |
| B15 | 用户自己端点的档位和主模型变量，接入时暂存、断开时放回 | aw:72 | 有 | ae/claude-settings-patch.ts:128-132,263-277 | — | 已做 |
| B16 | Claude Desktop：第三方网关模式、档位、子代理模型和强度、Explore 继承上限 | ref:93；aw:71,83-84 | 没有 | Osuna 不运行 Desktop | — | 没提到 |

#### C. Codex

| 编号 | magpie 功能 | 出处 | Osuna 现状 | Osuna 证据 | 差在哪 | 上一轮的态度 |
|---|---|---|---|---|---|---|
| C01 | 已登录 ChatGPT 时只写 openai_base_url：Codex 自带的模型、线程列表、App 菜单都不变，magpie 的模型并进 /model；没登录才写 magpie 专用表 | ia/codex.go:25-47 | 部分 | 只有专用表写法：osuna_api_endpoint 表 + model_provider + model_catalog_json（ae/codex-config-patch.ts:4-21） | 开关打开后，ChatGPT 自带模型不在列表里（目录以 Osuna 文件为准，ae/codex-model-catalog.ts:6-8） | 明确不做：「magpie『Codex 已登录 ChatGPT 时只写 openai_base_url』属于订阅账号范围，图外不做」（T05:57） |
| C02 | 登录方式三选一：ChatGPT / 一直 ChatGPT / magpie API | ia/codex.go:1450-1474 | 没有 | — | — | 同上 |
| C03 | 专用表写过就一直留着，用它开过的线程以后还能打开 | ia/codex.go:49-56 | 相反 | 切回官方时删掉专用表（ADR 0007:15；ae/codex-config-patch.ts:129-161） | 关掉开关后，经中转站开的 Codex 线程在官方模式下续不了（推断） | 已做，做法与 magpie 相反（prd:113 R-B4） |
| C04 | 模型目录里每个模型有真实的推理档位、上下文窗口、图片输入，放在 ~/.codex | M:internal/codexcat/codexcat.go:120-160 | 部分 | ae/codex-model-catalog.ts:24-37,80-107 | 四档固定、窗口固定 272000、没有 input_modalities | 已做（R-B4） |
| C05 | 新会话推理强度（model_reasoning_effort） | ia/codex.go:1323-1345 | 部分 | 只读不写（ae/codex-config-patch.ts:182） | 终端的起始强度在 Osuna 里设不了 | 没提到 |
| C06 | 子代理默认模型和子代理强度（[agents] 段） | ia/codex.go:1346-1428；aw:81 | 没有 | 搜 `default_subagent_model` 无命中 | — | 没提到 |
| C07 | 子代理统一模型：网关把所有子代理请求改到指定模型 | aw:82 | 没有 | — | — | 没提到 |
| C08 | 记忆整理用的模型（[memories] 段） | ia/codex.go:1429-1449 | 没有 | 搜 `extract_model`、`consolidation_model` 无命中 | — | 没提到 |
| C09 | spawn_agent 只把前 5 个模型告诉主代理，网关把其余模型补进去 | aw:85 | 没有 | 搜 `spawn_agent` 只命中参数翻译的注释 | — | 没提到 |
| C10 | Codex 自己的 multi_agent_v2 压住 magpie 时，只提示不改 | 81b7016e | 没有 | 搜 `multi_agent_v2` 无命中 | — | 没提到 |
| C11 | ChatGPT 多账号自动切换（未接入也写 openai_base_url） | aw:97 | 没有 | — | — | 明确不做：订阅账号轮换（map:38） |
| C12 | CC Switch 写的 provider 表和镜像一起改到 magpie，断开放回 | aw:98 | 没有 | ADR 0004:38 认定这类工具会互相打架，外部改动检测是唯一防线 | — | ADR 0004 已知取舍 |
| C13 | Codex 走的代理不转发本机请求时，标为「proxied」并给修复办法 | aw:94 | 没有 | 搜 `HTTP_PROXY`、`NO_PROXY` 无命中 | — | 没提到 |
| C14 | 后台 app-server 还读着旧地址时，提示重启或自动重启 | aw:97 | 拿不准 | Osuna 自己启动 app-server；改完配置后会不会重启，没核实 | — | 没提到 |

#### D. 其他 Agent 的接入

| 编号 | magpie 功能 | 出处 | Osuna 现状 | Osuna 证据 | 差在哪 | 上一轮的态度 |
|---|---|---|---|---|---|---|
| D01 | Pi：写 provider 和默认模型，补 enabledModels，打开会话亲和头 | ref:100；aw:88-89；gs:11-17 | 没有（能运行，没接） | pm:252；ae/store.ts:34 | 不经中转站 | 第二期（map:40） |
| D02 | omp：config.yml 和 models.yml，enabledModels 加 magpie/**，命名 profile 各自接入 | aw:23,87 | 没有 | pm:260 | 同上 | 第二期 |
| D03 | OpenCode 一类（还有 OpenChamber、MiMo、DevEco、Air）：provider.magpie 加 model、small；生成 <档>-fast 变体 | ref:96-99；aw:44-45 | 没有 | pm:236 | 同上 | 明确不做（map:41） |
| D04 | Gemini CLI：设认证和模型；先关 Google 登录，断开时恢复 | ref:95；mi18n:532 | 没有 | acp:182 | 中转站没有 Gemini 协议 | 明确不做（map:41）；Gemini 协议第二期 |
| D05 | Antigravity CLI、Muse Code 接网关 | ia/agy.go；ia/muse.go:70-100 | 没有 | 内置插件 | 同上 | 明确不做（map:41） |
| D06 | Copilot CLI、Cursor CLI、Devin、Goose：只改它们自己的模型 | ia/agents.go:1325-1404 | 有（形态不同） | Osuna 运行它们，按会话选模型（pm:227、acp） | 不写它们的配置文件 | Copilot 明确不做，其余没提到 |
| D07 | Kimi、Qwen、Droid、Cline、Qoder、Grok Build、CodeBuddy、Hermes、MiniMax 接网关 | ref:122-141 | 没有 | ACP 目录 | 不经中转站 | 没提到 |
| D08 | 那 39 个 Osuna 不运行的 Agent 接网关 | 1a | 没有 | — | — | 没提到 |

#### E. 命令行与终端界面

| 编号 | magpie 功能 | 出处 | Osuna 现状 | Osuna 证据 | 差在哪 | 上一轮的态度 |
|---|---|---|---|---|---|---|
| E01 | `magpie ls`（各 Agent 当前设置）、`magpie agents` | M:internal/cli/main.go:329-334 | 部分 | `paseo provider ls`（O:packages/cli/src/commands/provider/index.ts:9-26） | 看不到配置里的模型和开关 | 没提到 |
| E02 | `magpie <agent> <model>`、`<agent> <字段> <值>`、只给字段名就读值、Agent 名可用前缀（cc、oc、gem） | ref:2328-2338 | 没有 | 只有 `paseo run --provider --model --thinking`，是启动 Agent，不改配置（O:packages/cli/src/commands/agent/run.ts:37-44） | 命令行开不了第三方接口、设不了默认模型 | 没提到 |
| E03 | `magpie visible <agent> --only-picked/--show-new` | ref:79 | 没有 | — | — | 明确不做（同 A18） |
| E04 | `magpie sync`：刷新 models.dev 和所有在线模型清单 | ref:2345 | 部分 | 只在 Claude 开着第三方接口时每天自动下一次（O:docs/usage.md:133-144） | 没有手动入口 | 已做（自动部分） |
| E05 | `magpie tui`（按 s 存方案、p 用方案、S 同步） | ref:2372-2383 | 没有 | — | — | 没提到 |

#### F. 方案（Profile）

| 编号 | magpie 功能 | 出处 | Osuna 现状 | Osuna 证据 | 差在哪 | 上一轮的态度 |
|---|---|---|---|---|---|---|
| F01 | 存方案：把所有检测到的 Agent 的全部字段（含「跟随主模型」）、各自的模型短名单、资料库分配存成一个名字 | M:internal/profile/profile.go:20-34,158-189；README.zh-CN.md:105 | 没有 | Osuna 的「Agent 配置」只是单个提供方的启动组合：提供方、模型、模式、思考、功能值、备注（O:packages/protocol/src/agent-profile.ts:3-28；O:docs/glossary.md:40） | 没有整机快照 | 没提到 |
| F02 | 一键应用：只写本机装了的 Agent；顺序是 provider、模型、其余；provider 改了名照样应用；报告改了几项 | profile.go:221-299；mi18n:1234-1235 | 没有 | 应用 Agent 配置只是把值填进当前 Agent 控件（glossary:40） | — | 没提到 |
| F03 | 「在用」打勾：应用后不会改动任何东西的方案打勾，手改一项就不算在用 | ref:81-84；profile.go:307-354 | 没有 | glossary:40 写明「没有选中的配置、没有默认配置、不跟踪漂移」 | 和 Osuna 现有设计相反 | 没提到 |
| F04 | 应用前看详情：每个 Agent 会设成什么，像 key 的值不显示 | M:internal/profile/details.go:12-60；mi18n:1225-1231 | 没有 | — | — | 没提到 |
| F05 | 用当前配置覆盖方案、删除方案（再点一次确认） | mi18n:1218-1230 | 没有 | Agent 配置能编辑和删除（O:packages/app/src/agent-profiles/settings/agent-profiles-section.tsx），但不是整机方案 | — | 没提到 |
| F06 | `magpie save/use/profiles/rm` | ref:2340-2343；main.go:344 | 没有 | CLI 里没有；Agent 配置只通过 MCP 的 list_profiles 给编排 Agent 看（glossary:40） | — | 没提到 |
| F07 | 方案随备份、同步带到别的机器 | ref:2388-2425 | 没有 | — | — | 没提到 |

#### G. 用量与花费

| 编号 | magpie 功能 | 出处 | Osuna 现状 | Osuna 证据 | 差在哪 | 上一轮的态度 |
|---|---|---|---|---|---|---|
| G01 | 用量来源：网关记下每次请求，再读 Agent 自己的会话文件（Claude、Codex、OpenCode、ZCode、dsh、WorkBuddy、CodeBuddy、MiniMax、Kimi、Pi、omp、agy），去掉重复 | gs:239-252,273-305 | 部分 | 只读 claude、codex、pi、omp 四个 CLI 的日志（O:packages/protocol/src/usage/types.ts:3-5；O:docs/usage.md:12-37） | 不记中转站用量；不读 OpenCode、Copilot、ACP、插件 Agent | 明确不做：「中转站另记转发用量…05 票定为不做」（map:49） |
| G02 | token 明细：输入、输出、缓存读、缓存写（分 5 分钟和 1 小时）、推理、调用次数 | README.zh-CN.md:234 | 部分 | 五列加会话数和轮次（types.ts:11-17,103-118） | 缓存写不分时长；没有调用次数 | 没提到 |
| G03 | 合计可选「含缓存 / 不含缓存」 | ui18n:16-22 | 没有 | 固定含缓存（O:packages/app/src/usage-stats/totals.ts:7-9） | — | 没提到 |
| G04 | 时间段：今天、7 天、30 天、全部、自选日期 | M:internal/gui/assets/plugins/usage/page.js:4,30-60 | 有 | 日、周、月、总计、自定义，可前后翻（O:packages/app/src/screens/usage-screen.tsx:48-85；zh:3686） | — | 没提到 |
| G05 | 按 Agent、模型、provider、账号、网关 key、电脑分组 | ref:401-410,722-727 | 部分 | 按来源（Pi/OMP 再分后端）、模型、项目、主机（types.ts:26-31,68-86） | 没有按账号、按接口、按 key | 没提到 |
| G06 | 53 周热力图、活跃天数、最长连续、最忙一天、按时段、每日和每周趋势 | ui18n:112-135 | 部分 | 26 周热力图、活跃天数、首次使用、7/30 天、日均（O:packages/app/src/usage-stats/heatmap.ts:6-7；stats.ts:20-28） | 少最长连续、最忙一天、按时段、趋势图 | 没提到 |
| G07 | 会话形态：消息数、工作分钟、每条提示的工具调用数；常用 Skills、最耗会话、最近会话 | ui18n:116-135 | 没有 | — | — | 没提到 |
| G08 | 「请求」账本：逐条请求，多种筛选，分页，导出 CSV；每条可看协议转换、首字时间、速度、失败的尝试、stop reason、service tier | ui18n:39；mi18n:3234 | 部分 | 只有 Osuna 自己的会话每轮有用量面板（耗时、成本、各列 token、按模型）（O:packages/app/src/agent-stream/turn-usage-panel.tsx；turn-usage.ts:128） | 没有请求级账本、筛选、CSV、首字和速度 | 明确不做（map:49） |
| G09 | 每次请求的用途分类（审批检查、审查、压缩、记忆、起标题等） | M:internal/usage/purpose.go:13-27 | 没有 | — | — | 没提到 |
| G10 | 速度排行（生成速度、首字等待） | ref:386-399 | 没有 | 搜 `ttft`、`tokens.?per.?sec` 无命中 | — | 没提到 |
| G11 | 把不认识的客户端计入某个 Agent，或从列表隐藏 | ui18n:169 | 不适用 | 中转站只认每个 Agent 的口令，不会有不认识的客户端 | — | — |
| G12 | 别的应用可以自报用量（POST /v1/magpie/usage/requests） | gs:323-370 | 没有 | — | — | 没提到 |
| G13 | 给别的程序读用量（GET /v1/magpie/usage） | ref:1815-1830 | 部分 | 只有 Osuna 客户端用的 WebSocket RPC `usage.report.get`（O:docs/adr/0006-usage-in-code-is-upstream-plan-usage.md:5） | 没有 HTTP 读口 | 没提到 |
| G14 | 多台电脑的用量合并 | M:internal/usage/shared.go:3-8 | 有（形态不同） | App 连多台主机，按主机筛选合并（zh:3704；usage-stats/use-usage-hosts.ts） | — | 没提到 |
| G15 | `magpie usage`（--csv、--account、--days、--last） | M:internal/cli/usage_cli.go:40-53 | 没有 | packages/cli 里没有用量命令 | — | 没提到 |
| G16 | 按周期自动刷新 | page.js | 有（形态不同） | daemon 推送用量事件，页面自动重新读取（O:packages/app/src/hooks/use-usage-report.ts:97,129-160） | — | — |
| G17 | 中文界面用「万 / 亿」显示大数 | M:internal/settings/settings.go:56-62 | 没有 | 固定用 K/M/B（O:packages/app/src/usage-stats/format.ts:1-22） | — | 没提到 |
| G18 | 子代理的用量标出子代理和父代理 | gs:372-385 | 部分 | Claude 子代理记录按父会话的轮次归并（O:docs/usage.md:47-49,84-86） | 不单列 | 没提到 |
| G19 | Codex 线程按「模型 + 推理强度」汇总，标出主线程、子线程、压缩调用 | gs:470-500 | 没有 | — | — | 没提到 |

#### H. 价格

| 编号 | magpie 功能 | 出处 | Osuna 现状 | Osuna 证据 | 差在哪 | 上一轮的态度 |
|---|---|---|---|---|---|---|
| H01 | 找价顺序：本模型自定义价 → `<provider>/*` → provider 自己的目录价 → models.dev → 「Same as」 | ref:1088-1105 | 部分 | 先看按模型 id 精确匹配的自定义价，再查 LiteLLM 表（O:docs/usage.md:165-182） | 没有 provider 通配、provider 目录价、Same as | 没提到 |
| H02 | 价格按「provider + 模型」算，同一模型经两家中转站可以各有一个价 | ref:1106-1113 | 部分 | 查表时去掉 `slug/` 前缀，各接口同名模型共用一个价（docs/usage.md:177-180；T05:75） | 不能按接口设不同价 | 没提到（map:51 只记录了「能剥掉前缀」） |
| H03 | 自定义价四个数（0 表示免费），有 CLI，也能在 App 里填 | ref:1030-1055 | 有 | 设置 › 价格表（O:packages/app/src/price-table/；docs/usage.md:165-182） | 没有 CLI | 没提到 |
| H04 | 第五个数：1 小时缓存写入价 | ref:1075-1088 | 没有 | docs/usage.md:115-120 写明四列表达不了 | — | 没提到 |
| H05 | 长上下文分档价（如超过 272K 整次按高档） | ref:1090-1104 | 没有 | 同上 | — | 没提到 |
| H06 | 没有价时，按回复里实际回答的模型名找价 | ref:1057-1062 | 没有 | docs/usage.md:176-180 | — | 没提到 |
| H07 | 「Same as」：把私有模型名指定为某个已知模型来计价 | ref:1098-1105 | 没有 | — | — | 没提到 |
| H08 | 能查到价格是从哪来的 | ref:1063-1064 | 部分 | 价格表分「自定义价格 / LiteLLM 价格」两组（price-table/view.ts） | 没有 CLI | 没提到 |
| H09 | 没有价格的调用不算进总价，标「3 次调用未计价」 | ref:1065-1073 | 有 | 「N 个模型无价格数据」（zh:3678-3680） | 按模型数计，不按调用数 | 没提到 |
| H10 | 改价后历史花费一起重算 | ref:1114-1118 | 有 | docs/usage.md:107-113 | — | — |
| H11 | 美元或人民币（实时汇率） | M:internal/settings/settings.go:50-55；M:internal/fx/fx.go:1-7 | 没有 | `$` 固定（format.ts:1-5）；搜 `cny`、`currency`、`人民币` 无相关命中 | — | 没提到 |
| H12 | Kimi Code 会员模型按对应的 API 模型计价 | ref:1074-1080 | 没有 | — | — | 没提到 |
| H13 | 自己填上下文窗口和回复上限，并写进各 Agent 的模型清单 | ref:1140-1180 | 没有 | 只用接口自带的列表和 models.dev（ae/model-facts.ts:1-16） | — | 没提到 |

#### I. 额度

| 编号 | magpie 功能 | 出处 | Osuna 现状 | Osuna 证据 | 差在哪 | 上一轮的态度 |
|---|---|---|---|---|---|---|
| I01 | 额度卡：订阅账号、套餐，以及每个 key 的余额（含中转站 new-api、sub2api 的余额地址） | README.zh-CN.md:235；ref:1278-1285；M:internal/provider/balance.go:3-50 | 部分 | 9 个用量源插件：Claude、Codex、Copilot、Cursor、Grok、Kimi、MiniMax、OpenCode Go、Z.ai（O:plugins/*-usage-source；O:docs/plugins.md:494-498） | 不读第三方接口 key 的余额 | 主动读额度用于切换：第二期（map:40）；只显示余额没提到 |
| I02 | 各窗口已用百分比、重置时间、按当前速度会不会提前用完 | M:internal/provider/window_pace.go:5-12 | 有 | O:packages/protocol/src/messages.ts:6398-6414；输入框窄栏显示「X后用完」（zh:3777） | — | — |
| I03 | 整窗估算：推算整个窗口能装多少 token、多少钱，估不了说原因 | ref:1764-1772 | 没有 | — | — | 没提到 |
| I04 | 通知：窗口用到 X%、余额低于 Y、快重置但还剩很多 | M:internal/provider/quota_alert.go:3-10；settings.go:374-383 | 没有 | 搜 `usageAlert`、`quotaAlert`、`resetReminder` 无命中 | — | 没提到 |
| I05 | 额度历史（45 天） | M:internal/cli/quota_cli.go:46-52 | 没有 | — | — | 没提到 |
| I06 | `magpie quota`（--json、refresh、history、alert） | quota_cli.go:6-14 | 没有 | CLI 里没有 | — | 没提到 |
| I07 | `magpie quota wait`：等到有额度再返回，给脚本续跑用 | quota_cli.go:37-45 | 没有 | — | — | 没提到 |
| I08 | Codex 的额度重置次数：手动花、自动花；关掉「用 credits」 | quota_cli.go:15-36 | 没有 | — | — | 没提到 |
| I09 | Claude Code 状态栏一行（`magpie statusline`） | M:internal/cli/statusline_cli.go:3-11 | 部分 | Osuna 自己的会话有窄栏（O:packages/app/src/plan-usage/strip.ts） | 终端里的 Claude Code 没有 | 没提到 |
| I10 | 额度卡排序、隐藏 | mi18n:479-486 | 部分 | 能固定、选已用或剩余、显示在侧边栏（zh:3745-3749） | 不能排序 | 没提到 |

#### J. 会话

| 编号 | magpie 功能 | 出处 | Osuna 现状 | Osuna 证据 | 差在哪 | 上一轮的态度 |
|---|---|---|---|---|---|---|
| J01 | 会话页：本机各 Agent 的会话按目录列出（含 WSL）；Claude、Codex、Hermes、OpenCode、Pi 能续 | si18n:22-27；M:internal/sessions/sessions.go:121 | 有（覆盖不同） | 「会话历史」按工作区、项目、主机列出（O:packages/app/src/session-history/internal/model.ts:12）；能列的有 Claude、Codex、OpenCode、Pi、OMP，以及支持 session/list 的 ACP 和插件提供方（acp-agent.ts:1198-1205） | 没有 WSL | 没提到 |
| J02 | 每个会话显示花费和标题 | README.zh-CN.md:236；sessions.go:124-135 | 部分 | 会话历史有标题、没花费（model.ts:95-110）；用量页的会话行有花费，但显示项目名，没有标题（types.ts:233-251；usage-session-list.tsx:122） | 两处没合在一起 | 没提到 |
| J03 | 一键在终端重开（可选用哪个终端 App），或复制续会话命令 | ref:2365-2370；si18n:21-23 | 有（形态不同） | 在 Osuna 自己的终端标签页续、复制恢复命令、导入为 Osuna Agent（zh:2242-2243；model.ts:184-210） | 开不了外部终端；要先在那个目录有工作区（zh:3813） | 没提到 |
| J04 | 换一个 Agent 接着聊（`omp --fork` 读 Pi 的会话） | M:internal/sessions/carry.go:3-13 | 没有 | — | — | 没提到 |
| J05 | 看会话全文，每条回复标出所用模型 | gs:150-165 | 部分 | 导入成 Osuna Agent 后有时间线 | 不导入就看不了 | 没提到 |
| J06 | 按对话内容跨会话搜索，片段高亮 | gs:180-210 | 部分 | 会话历史只搜标题和提示预览（model.ts:107-109）；聊天内搜索只在单个 Agent 里（O:packages/server/src/server/agent/chat-search/index.ts） | 不能跨会话搜全文 | 没提到 |
| J07 | 子代理折叠在会话下，能打开；Codex 子线程挂在父线程下 | gs:430-470 | 部分 | Osuna 自己的 Agent 有子代理轨道（O:docs/agent-lifecycle.md） | 历史列表是平的 | 没提到 |
| J08 | 删会话进回收站，可恢复、可彻底删；一分钟内有写入的不删 | M:internal/sessions/manage.go:18-35,488-541；si18n:32 | 没有 | 搜 `trash`，命中都是图标 | — | 没提到 |
| J09 | 导出 Markdown | gs:167-178 | 没有 | 搜 `exportTranscript` 等无命中 | — | 没提到 |
| J10 | 记录网关对话（默认关，只存本机 7 天、256 MiB） | gs:102-148 | 部分（形态不同） | Osuna 自己的会话本来就有完整时间线（O:packages/server/src/server/agent/agent-timeline-store.ts） | 终端会话经中转站的内容不记 | 没提到 |
| J11 | Claude Code 项目改名或搬走后迁移会话（预览、确认、备份） | O 外：M:docs/session-relocation.md:1-59 | 没有 | 搜 `relocat` 无相关命中 | — | 没提到 |
| J12 | Codex 会话换 provider：Codex 只列当前 provider 的会话，这里可以迁过去（先备份，可撤销） | M:internal/sessions/codex_provider.go:27-35；si18n:47-52 | 没有 | Osuna 列 Codex 会话也只问当前 provider（O:packages/server/src/server/agent/providers/codex-app-server-agent.ts:7407-7414） | 开关前后开的线程互相看不到、续不了（推断） | 没提到 |
| J13 | `magpie sessions`（--days、--model、--folder、--json） | M:internal/cli/sessions_cli.go:18-22 | 部分 | `paseo agent import`（O:packages/cli/src/commands/agent/import.ts:10） | 没有列表和花费命令 | 没提到 |

#### K. 上下文与调参

| 编号 | magpie 功能 | 出处 | Osuna 现状 | Osuna 证据 | 差在哪 | 上一轮的态度 |
|---|---|---|---|---|---|---|
| K01 | 每个请求的上下文卡：用了多满、多少来自缓存、按内容着色（系统、工具、记忆、文件、工具结果、对话） | M:internal/gui/assets/context.js:2-22 | 部分 | 输入框圆环显示当前 Agent 的百分比和已用/上限（O:packages/app/src/components/context-window-details.tsx:40-80） | 没有缓存占比，看不出被什么占着，也不是逐请求 | 没提到 |
| K02 | 「用量 › 上下文」：给每个 Agent 的窗口使用打分、打标签 | context.js:5-8 | 没有 | — | — | 没提到 |
| K03 | 「为你调好」：用自己的会话重放，算出最省 token 的压缩窗口和缓存时长，一键写入、可撤销 | aw:25,100；M:internal/tune/tune.go:1-12 | 没有 | 搜 `autoCompactWindow`、`promptCacheTtl` 无命中 | — | 没提到 |

#### L. 账单、导出、限额、统计

| 编号 | magpie 功能 | 出处 | Osuna 现状 | Osuna 证据 | 差在哪 | 上一轮的态度 |
|---|---|---|---|---|---|---|
| L01 | 按实际回答的账号统计 | ref:401-410 | 没有 | — | — | 没提到 |
| L02 | 按上游 key、按网关 key 统计 | ref:722-727 | 没有 | ADR 0007:34 否决了「中转站自己记用量」 | 不能按第三方接口出账 | 明确不做（map:49） |
| L03 | OTLP 导出（含 Langfuse） | ref:2498-2669 | 没有 | 搜 `otlp`、`langfuse`、`otel` 无相关命中 | — | 明确不做（map:42） |
| L04 | 网关 key 限额（日、周、月、每 N 小时，可多条同时生效；用完回 429） | ref:487-580 | 没有 | 搜 `budget`、`spendLimit` 无相关命中 | — | 前提「局域网共享…并发与频率上限」明确不做（map:42） |
| L05 | internal/stats：每天向 PostHog 报一次「在用」 | M:internal/stats/stats.go:1-10 | 不适用 | O:docs/product.md:46 写明「No Paseo telemetry」 | 这是 magpie 自己的使用统计上报，不是用量功能 | — |

---

## 2. 10-13 之后 magpie 新加或大改的（我负责范围内共 153 个提交）

| 功能 | 提交 | Osuna |
|---|---|---|
| Claude Code 云厂商开关接入时拿掉、断开放回 | 79fec406（10-15） | 没有 |
| 断开时放回用户自己的 ANTHROPIC_MODEL | bc470c6b（10-15） | 有 |
| 档位设了自己的模型，主模型换过去也保留；fable 档在别家模型上不设 | e740ee7c、01940494 | 不适用 |
| 到 max 没 xhigh 的模型也报 xhigh | d1c485f7（10-14） | 没有 |
| /model 列表丢了标记靠指纹认回；命名跟随设置 | 59a8aec5、36ca5432、250bdd5c | 没有 / 部分 |
| 经反向代理或本机代理不算漂移 | ffd07786、a0dc89e5 | 没有 |
| 卸载后显示「未找到 CLI」 | d0fcb8bc、22622211 | 有（形态不同） |
| 新增 Agent：Claude Science、Raycast、MothX、Lody、DeepSeek Harness Desktop | 0c1e9b79、d8d52c6e、5c0049a3、c6bd4e97、2a1637f4 | 没有 |
| 插件 Agent 可以只接入不选模型；插件变动时同步各 Agent | dbf33121、49639cd1 | 没有 |
| 没有可用模型时说明原因 | c1e35424、b7a2e737、94942f9f | 有（zh:2569） |
| Claude Desktop 子代理的模型和强度 | 20350daf、b476dc5a、96aca14a | 没有 |
| Codex 和 ChatGPT 登录并存相关的几处修正 | b0303173、69d7ee33、0506f011、d6fd9b3a | 不适用 |
| Pi 系和 omp 的 enabledModels 维护 | cb003877、579de3ba、4447b068 | 没有（第二期） |
| OpenCode 的 -fast 变体 | 6ea3b78d、8d36b60c | 没有 |
| 更新：brew、bun、OmO 的 npm、更新后跑不起来修一次 | 2d06210f、7a3029db、924f62e9、27956002、4f08533e | 部分 |
| Claude Code 项目改名后迁移会话 | c984adfb（10-13） | 没有 |
| 会话页子代理嵌套；Codex 子线程挂父线程 | 3a0b6127、c516841e | 部分 |
| Codex 线程关系、按模型加强度的用量、spawn 任务名、压缩标记 | 644f4316、019199e0、3c4b4dc9、84f14e55 | 没有 |
| Kimi Code 会话能列、能看全文 | 4921e5e2、2d8f2a86、407595b2 | 拿不准 |
| 每条回复标出所用模型 | 5618ade1 | 拿不准 |
| 读不懂的状态文件先挪开，不覆盖 | 58651568、94e3b3f5、a786c51c | 部分（endpoints.json 解析失败不写不删，prd R-A3） |
| Pi 和 omp 自己的调用进用量 | 110b2043 | 有（只限本机） |
| Antigravity CLI 的调用进用量 | c8c3ce9a | 没有 |
| 概览列表可折叠；合计可以含缓存 | d6b045a7 | 没有 |
| 「Same as」计价；Grok fast 价格 | 357ffac7、ba0bd421 | 没有 |
| 请求行显示 stop reason、service tier | 5e30d58f、30869e35 | 没有 |
| `magpie usage --last/--days` | 62378c5f | 没有 |
| 整窗估算进 JSON；过去周期、用了 credits、数据不够三种情况的处理 | 0c066512、b00da386、e10b7f92、722abfbb | 没有 |
| 插件读额度失败时在卡片上写原因 | 2944e7e0 | 有（zh:3753） |
| 自定义余额地址可以用 POST | dc8dcc85 | 没有 |
| 调参建议算上等待时间；Codex 窗口按模型或 1M 算 | e1dcd1e1、035c259a | 没有 |
| OTel 改成内置插件；Codex 每个回复单独导出 | 9916a946、c8ed37e1 | 没有（明确不做） |
| 网关 key 限额改成插件，可多条、可每 N 小时 | a1f7b8c1、f299faef、f70c0525 | 没有 |

---

## 3. 需要你拍板的地方

1. **要不要给 Osuna 能跑的其他 Agent 也接中转站。** Pi/OMP 定为第二期，OpenCode、Copilot、Antigravity、Muse、Gemini CLI 定为不做（map:40-41）；ACP 目录里的 13 个 Agent 上一轮没提到。另外，「Gemini CLI（Osuna 不支持）」这个前提已经不对：ACP 目录里有它（acp:182）。Antigravity 和 Gemini CLI 都还要先有 Gemini 协议。
2. **要不要接 Osuna 不运行的 39 个 Agent**（编辑器、桌面 App 等）。这超出了 Osuna 的产品定位。
3. **Codex 和 ChatGPT 登录并存（openai_base_url）。** 上一轮定为不做（T05:57）。不做的后果是：开关一开，ChatGPT 自带的模型就从 Codex 里消失。
4. **Codex 线程被按 provider 分成两组。** magpie 的做法是专用表一直留着，再在会话页把线程迁到当前 provider。迁移要改 Codex 的 rollout 文件和 state 数据库；保留专用表又和 R-B4（prd:113）冲突。
5. **Claude Code 会话迁移。** 要移动和改写 ~/.claude/projects 下的文件。
6. **方案（Profile）。** 名字和设计都冲突：glossary 禁止单用「Profile」（glossary:39,43），而且 Agent 配置明确「不跟踪漂移」（glossary:40）。方案还要一次改写多个 CLI 的配置。
7. **上一轮已明确不做、本次又出现的几项：** 按 Agent 精简模型（map:53）、后台小模型（prd:231）、子代理模型（T05:47）。
8. **扩大「自有键」范围。** 云厂商开关、自动模式审查、推理强度、子代理、记忆、调参写回，都要写或删用户 settings.json / config.toml 里现在不属于 Osuna 的键。ADR 0004 目前只碰自有键。
9. **请求级账本、按接口或按 key 统计、首字时间、CSV、按接口定价。** 都要推翻「不另记用量」（map:49、ADR 0007:34）。
10. **读第三方接口 key 的余额。** 要拿 key 主动去请求中转站。
11. **额度提醒走通知。** 手机端是官方 Paseo App，不能改（map:51）；协议上只能加可选字段。
12. **改账号状态的额度操作**（花 Codex 的重置次数、关 credits）。涉及厂商条款，和订阅账号轮换（map:38）是一类事。
13. **其他已明确不做的：** OTLP 导出、网关 key 限额（map:42）。
14. **人民币显示。** 需要新增一个出站请求查汇率，而 docs/usage.md:122-128 只列了两个出站请求；format.ts 也是刻意固定用 `$`。
15. **记录网关对话。** 隐私取舍。
16. **外部改动提示要不要回到界面上。** R-E4 去掉了它，而 magpie 有「重新应用」和「保留当前设置」。

---

## 4. 拿不准的地方

- **ACP 目录里的 Agent 能不能在会话历史里列出**（Kimi、Qwen 等）：取决于各 CLI 有没有 session/list 能力。我只看了机制（acp-agent.ts:1198-1205），没逐个核实。是推测。
- **OmO、Prime Agent 能不能用 extends pi 跑**：推测，没验证它们是否保留了 Pi 的 rpc 模式。
- **「开关前后开的 Codex 线程互相看不到」**：依据两边源码注释推断（codex-app-server-agent.ts:7407-7409、codex_provider.go:27-35），没有实际运行。
- **自定义价能不能对 `slug/模型名` 单独生效**：推测 Osuna 会话的日志里记的是 `slug/模型名`，终端会话记的是光秃名，没验证。
- **Codex app-server 改完配置后会不会重读**：没核实。
- **Goose 能不能接入**：magpie 代码里有 custom provider 同步，但 GUI 标「无法接入」。两处都是代码，我按 GUI 记了。
- **10-13 当天的提交，上一轮调研有没有看到**：调研文件没写具体时刻，research/magpie.md 也没提到这些功能。表 2 一律按 `--since=2026-10-13` 列出。
- **官方手机 App 会不会显示 health**：没核实。
- **其余都看过源码确认**，引用的文件和行号是这次实际打开或搜到的。
