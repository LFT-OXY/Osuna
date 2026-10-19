# 访谈决定

逐轮记下用户的决定。事实依据在同目录的 `codex-wiring.md`、`claude-code-wiring.md`、`web-search.md`；行号形如 `03·A15` 的指总任务 `research/gap-03` 等明细文件的行。

## 第 1、2 轮（Q1–Q22，2026-10-17 提问，用户 10-18 一并回答）

多数回答带「照 magpie 做」。

### 设置文件、提示与起始值

- **Q1 settings.json 带 BOM 或注释（03·A15）**：做，用户答「照 magpie 做」。事实：Claude Code 读 settings.json 先去 BOM 再严格 `JSON.parse`，带注释或尾随逗号的整份跳过，启动时弹 Settings Error（`claude-code-wiring.md` 第 11 题）。助手的建议是 BOM 放行、带注释的照旧拒绝并用中文说明原因；「照 magpie」（magpie 带注释也照改）与此不一致，第 3 轮 Q23 确认。
- **Q2 外部改动提示回到界面（03·A10）**：做，照 magpie。至少有「重新应用」「切回官方」；magpie 五种情况与「保留当前设置」在 Osuna 里怎么对应，第 3 轮 Q28 确认。
- **Q3 关开关前预览（03·A09）**：选 A，照 magpie：关「使用第三方接口」时弹框逐条列出会改回、删除、新建的项，确认后才改。
- **Q4 云厂商开关与托管设置（03·B12, B13）**：选 A，照 magpie：settings.json 里开着的 `CLAUDE_CODE_USE_*` 接管时拿掉、关掉时放回；写在托管设置、`~/.claude.json`、shell 里的只提示；托管设置的 `ANTHROPIC_BASE_URL` 盖过中转站时提示。托管文件路径按 Claude Code 2.1.302（Windows 是 `C:\Program Files\ClaudeCode`，magpie 用的 `C:\ProgramData` 已过时）。
- **Q5 打开时挑起始模型并说明怎么挑的（03·A06）**：照 magpie。
- **Q6 新会话的默认思考档位（03·B06, B07, C05）**：照 magpie：提供方设置页「默认模型」旁加一项，开关开着时写进 CLI 设置、关掉时还原；Osuna 新对话没有记住的上次选择时也用它（助手代定，已告知）。界面名称、`max` 与 Ultra Code 的写法第 3 轮 Q27 确认。
- **Q7 Codex 模型目录写真实能力（03·C04）**：照 magpie：用接口自己的模型清单与 models.dev 的上下文、思考档位、能否看图；查不到的保持现在的写法。
- **Q8**：03·A03（「不在终端 PATH 里」提示）挪到块 24「Agent 管理补齐」；03·A11（经反向代理不算漂移）不做。

### Codex 的接法与对话

- **Q9 Codex 接法（03·C01–C02；总任务 Implementation Decisions 第 9 条）**：选 A，照 magpie：Codex 用 ChatGPT 登录时只写 `openai_base_url` 指向中转站，不写 `model_provider`、`model_catalog_json`；中转站把 ChatGPT 自带模型原样转给 chatgpt.com、第三方模型转给接口，`/models` 合并两边；API key 登录或未登录用独立服务商表。Osuna 不读 `auth.json`，经 app-server 的 `account/read` 判断登录方式（助手代定，已告知）。中转站怎么认调用方（Q24）、同名模型听谁的（Q25）、账号额度用完时怎么办（等 `codex-account-held.md`）在第 3、4 轮问。
- **Q10 关开关后旧对话能续（03·C03）**：照 magpie：独立服务商表写了就保留，关开关后中转站继续接这些对话（要 Osuna 在运行）。推翻 ADR 0007「Official removes the dedicated Codex table」。
- **Q11 提供方会话列表列出全部服务商的对话（03·J12）**：做，每条标出服务商。续不上的怎么办见 Q30。
- **Q12 不做会话迁移（magpie 的 Move）**。第 3 轮 Q30 时用户改判为要做，见下。

### Claude Code 与 Codex 的接入细节

- **Q13 在 CLI 里换模型，Osuna 跟着（03·A10 的「模型被换」）**：照 magpie：换成接口提供的另一个模型就是新的默认模型、不提示；换成哪家都没有的模型才提示（重新应用 / 保留当前设置）；Osuna 重写配置时不再悄悄改回。默认模型能不能是「某一家的模型」第 3 轮 Q26 确认。
- **Q14 Subagent 与后台小任务的模型（03·B04, B05, C06–C10；01·F08）**：选 A，照 magpie 全做。范围的理解第 3 轮 Q29 确认。
- **Q15 走中转站时保留 claude.ai 登录（03·B08；01·A38）**：照 magpie：Claude Code 设置页加一个选项，默认关（助手代定，已告知）；开了就不写口令，中转站从不转发 claude.ai 的令牌、去掉 `oauth-` 开头的 beta、上游 401/403 改报 502。中转站怎么认 Claude Code 与 Codex 一起在 Q24 问。
- **Q16 四个小修正（03·B14, B11, B10；档位兜底）**：照 magpie：带点的 Claude 版本写进 Claude Code 前改成连字符；经中转站能到的模型都不会被 Anthropic 审查时写 `CLAUDE_CODE_AUTO_MODE_SERVER=0`；能到 max、没有 xhigh 的模型也报 xhigh；档位名（opus / sonnet / haiku / fable）没配映射时改用默认模型，不再回 404（ADR 0007 Consequences 写的「档位名当模型名发出」与代码不符，一并改）。
- **Q17 改完设置后正在运行的会话（03·A17, C14）**：照 magpie：改完显示哪些会话要重开、怎么重开；Codex 共享的后台 app-server 没人连着时由 Osuna 自动重启，有人连着只提示命令；关开关时口令不作废，正在运行的会话继续经中转站，直到重开。
- **Q18 Codex 经代理连不上中转站（03·C13）**：选 B：照 magpie 检测并提示；另外 Osuna 自己起的 Codex 进程带 `NO_PROXY=127.0.0.1`（magpie 没有，助手提出）。

### 联网搜索（02·A26）

- **Q19 只对开了开关的那家生效**：选 B，偏离 magpie 三处，理由都已核实：
  1. 至少一家开着的接口打开了「自己能联网搜索」，才从 settings.json 去掉 `WebSearch` 禁止规则，否则照旧禁止；
  2. Claude Code 的搜索子请求只交给同一模型、开了开关的接口，哪怕这段对话本身走的是别家；
  3. 这个模型一家开了开关的接口都没有时回明确的错误，不去掉搜索工具让模型凭记忆冒充结果。

  依据：Claude Code 把只有文字的子请求回复当成搜索结果交给主模型（`web-search.md` 第 1 题）；magpie 选候选不看开关（第 5 题）。用户自己写的 `WebSearch` 禁止规则 Osuna 不动。
- **Q20 Codex 也归这个开关管**：选 A，照 magpie：开了开关的接口原样收到 Codex 的 `web_search`，没开的去掉。
- **Q21 开关的位置与名字**：照 magpie：接口页上，只在这家有 Anthropic 或 OpenAI Responses 地址时显示；默认关，不自动探测；用 Switch；名字「自己能联网搜索」（英文 "Searches the web by itself"），所在行叫「联网搜索」，下面一行说明。已写进 `docs/glossary.md`。
- **Q22 WebFetch 域名预检（`skipWebFetchPreflight`）**：这次不做。magpie 也不给 Claude Code 写这一项。

### 助手照 magpie 补的细节（随第 3 轮告知）

- Q9 A 下 Codex 的 `web.run`（`POST /alpha/search`）：ChatGPT 自带模型转给 chatgpt.com；第三方模型回 200 加一段「不能联网搜索」的文字（magpie 没配代搜时的做法），不回 404，因为 404 会让 Codex 结束这一轮。
- Q10、Q17：口令在开关开关之间保持不变；daemon 启动时即使开关关着，也要按新端口改写保留下来的独立服务商表。
- Q6：Osuna 自己的 Claude 会话没选 Ultra Code 时要显式传 `ultracode: false`，否则 settings.json 里的默认值会盖到这些会话上（`agent.ts:3475-3493` 现在只在选了时才传）。

## 第 3 轮（Q23–Q30，用户 10-18 回答）

- **Q23 带注释的 settings.json**：选 B，照 magpie：照改并保留注释（推翻助手的建议 A）。用户知道的代价：Claude Code 自己读不了带注释的文件，整份跳过，开关显示开着却不生效。新发现的后果在第 4 轮 Q31 问。
- **Q24 中转站怎么认出调用方**：选 A，照 magpie：本机回环来的请求一律收，口令只用来认是哪个 Agent，认不出时按路径与 User-Agent 认（magpie `gateway.go:56-80`）。推翻 ADR 0007「The token is the gateway's authentication」，写新 ADR。随之：Q15 不用自定义请求头，Q17「关开关时口令不作废」不再需要单独做。助手照 magpie 补：带 `Origin` 头的网页请求、带转发头的请求照旧拒收（magpie 的 corsGuard / callerGuard），第 4 轮告知。
- **Q25 ChatGPT 自带模型与接口模型同名**：选 A，照 magpie：用 ChatGPT 登录的 Codex 里，接口的模型写成「接口标识/模型名」，不带标识的一律指 ChatGPT 自带的。
- **Q26 默认模型可以指定某一家**：选 A，照 magpie：默认模型就是用户选的那个，可以带接口标识（先用那家，不行再自动切换到提供同名模型的别家）；设置页显示成「模型名（接口名）」，也能直接选某一家的。术语表「默认模型」已改。
- **Q27 默认思考档位**：界面名「默认思考档位」（英文 Default thinking）；max 选 A，照 magpie：Claude Code 写进 `env.CLAUDE_CODE_EFFORT_LEVEL`，开着时所有会话锁在 max、`/effort` 调不低；Ultra Code 照 magpie，只给支持 xhigh 的模型写。术语表已加「默认思考档位」。助手补：实现时验证 Osuna 对话里每次选的思考档位是否也被锁住；锁住的话在 Osuna 对话的思考档位旁写明原因（第 4 轮告知）。
- **Q28 「被改过」提示的五种情况**：照助手的对应做：不再经过中转站（含云平台开关、托管设置）做，「保留当前设置」= 关掉开关但不改回文件、不再提示；模型被换按 Q13，「保留当前设置」= 不再提示、开关照开；被绕过做，对比 CLI 会话记录与中转站收到的请求；地址没人应答不做（只会因地址被改而出现，归第一种）；代理不转发按 Q18。
- **Q29 Q14 的范围**：确认：Claude Code 的「后台小任务模型」「Subagent 模型」及其思考档位（中转站代设）；Codex 的「默认 Subagent 模型」及思考档位、「强制 Subagent 模型」（中转站改）、派 Subagent 时的模型清单补全、记忆功能的模型、「Codex Subagent 可用任意模型」开关及 multi_agent_v2 盖过它时的提示。界面上 Subagent 保留英文（术语表）。
- **Q30 → Q12 改判**：用户改为照 magpie **做会话迁移**：可以把 Codex 对话挪到另一个服务商名下（magpie `internal/sessions/codex_provider.go`：先备份到回收目录，改 rollout 的 `session_meta` 与 `state_*.sqlite` 的 `threads.model_provider`，一分钟内写过的不动，挪回原服务商即撤销）。这要写 Codex 自己的对话文件与数据库，超出 ADR 0004 的范围，写新 ADR。已知局限照 magpie 记下：rollout 里 `ThreadSettingsApplied` 带的旧服务商不改，Codex 若从对话记录重建数据库，挪动可能失效（推断，未核实；实现时用临时 `CODEX_HOME` 里的真 Codex 验证）。续不上时怎么办与入口在第 4 轮 Q32 确认。

## 第 4 轮（Q31–Q33，用户 10-18 回答）

助手随本轮告知、用户未反对的两处：Q24 照 magpie 保留两道拦截（带 `Origin` 头的网页请求、带转发头的请求拒收）；Q27 实现时验证 Osuna 对话的思考档位是否被 max 锁住，锁住就在思考档位旁写明原因。

- **Q31 带注释的 settings.json 照改后要提示**：做（magpie 没有，助手提出）。依据：Claude Code 文档说不弹窗的运行方式遇到读不了的设置文件直接跳过、不报错，Osuna 用 SDK 开的 Claude 对话就是这种方式，于是会不经中转站走官方（推断，未实测）。Claude Code 设置页「使用第三方接口」下提示：设置文件有注释，Claude Code 读不了；终端会弹错误，Osuna 里的 Claude 对话会直接走官方；删掉注释后恢复。
- **Q32 挪对话的入口**：照 magpie：会话历史里 Codex 对话的行菜单加「挪到另一个 Codex 服务商」，并支持一次选几条（会话历史要新加多选）；先备份到 Osuna 自己的文件夹，一分钟内写过的不挪，挪回原服务商即撤销。助手补：续对话因 Codex 服务商不在了而失败时，报错里直接给同一个按钮（Q30 的处理随之定为：照常按原服务商续，续不上时说明原因并给出这个按钮）。
- **Q33 名称**：Codex 设置里决定请求发往哪里的那一项叫「Codex 服务商」（英文 Codex model provider），与「提供方」（Provider）分开。已写进术语表。

## 第 5 轮（Q34–Q36，用户 10-18 回答）

- **Q34 ChatGPT 账号额度和余额都用完**：选 B，本任务不做，留给子任务 9，已记进它的 `prd.md`。依据（`codex-account-held.md`）：完全发不出的只有闭源的 Codex 桌面应用；Osuna 用的 app-server 和终端 TUI 照常发出，第三方模型照常能用（源码核实）。照 magpie 做要定时读登录凭证（受子任务 8 总开关管），只对桌面应用有用且要重开，改过去期间新开的对话会记在独立服务商名下，GitHub 上还有一条与 magpie 说法冲突的用户报告。
- **Q35 CC Switch 的 OpenAI 镜像表**：选 A，照 magpie：开关开着时把这种表（`name = "OpenAI"`、`requires_openai_auth`、没有 `base_url`）的地址也指向中转站，关掉时改回；按 ADR 0004 记原值、算负责的键，被外部改了走「被改过」提示（`codex-wiring.md` 第 10 题，magpie `docs/subsystems/agent-wiring.md:98`）。
- **Q36 任务的组织方式**：选 A：一份 `prd.md`，`/atw-spec` 后用 `/atw-tickets` 切成一组工单，一起验收、一起合并上线（同子任务 1）。

第 5 轮后设计树问完，等用户确认理解一致，再由用户 `/atw-spec`。

## 切工单（2026-10-18）

用户 `/atw-tickets`，全部照助手推荐：

- 31 张工单（`issues/01–31`），先后关系照助手拟的；ADR 先写（01），收尾三张照子任务 1 的做法（29 文案与视觉、30 文档、31 用户真实 CLI 验收）。
- 截图的同意方式：每张带界面的工单用无头浏览器在临时文件夹里截图，不碰真实的 CLI 配置、不跑真 CLI，用户一次同意，之后不再逐张问；29 号工单用 Electron 桌面应用截图前另外问。
- 写工单时助手加的一条先后关系（已告知用户）：19 号（默认模型挑法）要等 09 号，因为 ChatGPT 登录的 Codex 那一种挑法（joined）要用 09 号的登录方式判断。
