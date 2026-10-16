# 访谈决定

逐轮记下用户的决定；差距清单见同目录下的其他文件。

## 第 1～2 轮（2026-10-16）

- **范围**：用户原话「记住我说的是magpie的所有功能」——对照 magpie 的全部功能，不只第三方接口相关的；按 magpie HEAD `7597c132`（2026-10-16）比对，上次调研（10-13）之后的 647 个提交一并算进来。
- **规矩**：沿用上一轮三条——官方 Paseo 手机 App 不改；TypeScript 自己重写、不托管 magpie；不读写 CLI 登录文件。碰到的功能在清单里单独标出，由用户决定是否破例。（助手代定，已告知用户。）
- **Q1 建 ATW 任务**：建，即本任务 `10-16-magpie-osuna-gaps`。
- **Q2 做法**：本任务不用 `/atw-map`，靠访谈完成「差距清单 → 用户挑选 → 分组成子任务」；子任务各自 `--parent` 本任务，能单独验收上线。又大又复杂、做法看不清的子任务在子任务里用 `/atw-map`，小而清楚的直接写需求。理由：差距多半是几十个能各自上线的功能，塞进一张地图会变成一份需求一起验收；地图一次对话只解决一张票，挑选在访谈里更快。

## 第 3 轮（2026-10-16，块编号见 `gap-summary.md`）

- **Q3 范围**：这一轮只从块 1–16 里挑；块 17–25（与第三方接口无关）记在总表里，第三方接口这批做完再挑。
- **Q4 订阅账号（块 12）**：未定。用户要先弄清封号风险——这算不算「反代」（把订阅转成 API key），和 Pi 那种直接登录官方 ChatGPT 账号是不是一回事；用户倾向「有人需要就做，给用户警告即可」。已派调研，见 `subscription-ban-risk.md`。
- **Q5 插件与中间件（块 13）**：不做。
- **Q6 对外开放（块 11）**：不做，中转站继续只服务本机。**块 10（多开入口）要考虑**，不随块 11 一起排除。
- **Q7 中转站稳健性补齐（块 1）**：做，排第一个子任务。「被拒后改写法重发」「按厂商专属改写」两类到子任务里再问。
- **Q8 Claude Code / Codex 接入细节（块 2）**：做；具体条目进子任务再定。
- **Q9 接口管理好用性（块 3）**：做，条目进子任务再挑；**块 4（一家多把 key）不做**，用「复制这家接口」代替。
- **Q10 余额与套餐额度（块 5）**：只做显示，不做按额度提前换家。用户关心 new-api、sub2api 这类中转服务能不能查余额。
- **Q11 联网搜索（块 6）**：先做「这家自己会联网搜索」的按接口开关，能否按家生效进子任务核实；代搜以后再说。
- **Q12 看得见中转站（块 7）**：做轻量版——接口页列最近的换家、失败、冷却记录，只存内存；不做完整路由页、请求账本，不统计每家花费。
- **Q13 更多 Agent（块 9）**：做 Pi 和 OMP，其他 Agent 不做。
- **Q14**：路由组（块 8）、隐私打码（块 14）不做。**Gemini 格式（块 15）要做**，目的是让 Claude Code、Codex、Pi、OMP 能用中转服务的 Gemini 模型；用户说明大家不用 Gemini CLI。

## 第 4 轮（2026-10-16）

用词：下文「中转服务」指 new-api、sub2api 一类第三方服务；「内置中转站」指 Osuna 自己的 Gateway（glossary 的 zh-CN 用词）。

- **Q15 Gemini（块 15）**：只做上游——接口可多填一个 Gemini 格式地址，内置中转站把 Claude Code、Codex、Pi、OMP 的请求翻成 Gemini 格式发出。不做 Gemini 入口（给 Gemini CLI 用的），不做 Vertex、Code Assist。
- **Q16 余额（块 5）**：照 magpie 全做，「能查的话不需要省」：官方服务按地址自动认；new-api / one-api、sub2api 的「这把 key」查询和「整个账户」查询（另填系统访问令牌 + 用户 ID，或登录令牌）；OpenAI 旧式 credit_grants；自定义余额地址与取值表达式；套餐 key 的额度窗口（02·A70–A74）。中转服务是否由 Osuna 自动试探余额地址（magpie 不试探、要用户填）在子任务里定。依据：magpie `internal/provider/balance.go:42-145`。
- **Q17 入口（块 10）**：只加 OpenAI Chat 入口，随 Pi / OMP 子任务一起做；画图、语音、向量、视频、Gemini 入口不做。依据：magpie 给 Pi / OMP 写的服务商默认 `api: "openai-completions"`，个别模型改走 `openai-responses` / `anthropic-messages`（`internal/agent/pi_api_test.go:14-67`、`omp_api_test.go:17-71`）。
- **Q18 用量（块 16）**：未定。用户担心与现有用量页（读 CLI 会话记录）冲突，希望融合进用量页、官方账号与各家中转服务分开显示，请助手分析。分析见本轮回复与下一轮问题。

## 第 5 轮（2026-10-16）

- **Q18 用量融合**：用**办法二（照搬 magpie）**——内置中转站自己记一本完整的账（含 token），经过中转站的调用以这本账为准；读 CLI 会话记录时跳过对得上的（Claude Code 按回复的 `message.id`，Codex 按 `token_usage_record` 的 `response_id`，Pi / OMP 按会话记录里的 provider），官方与每家接口在用量页分开。助手推荐的办法一（只记「谁答的」、不记 token）未采用。**推翻 ADR 0007 的否决项「Record the gateway's own usage」**，在对应子任务里补决策记录；Q12「不统计每家花费」随之作废。依据：magpie `docs/subsystems/gateway-sessions.md` 的 “Calls read from the agents' own files”、`internal/usage/codex_identity.go:42-51`；Osuna `usage/claude-parser.ts:172`、`usage/codex-parser.ts:174`、`usage/pi-like-parser.ts:176`。
- **Q19**：人民币显示（汇率每天自动取一次，取不到用上次的）与中文「万 / 亿」照做；`docs/usage.md` 的出站请求规则跟着改。
- **Q20 订阅账号（块 12）**：不做。依据 `subscription-ban-risk.md`：四家条款都不允许「订阅给别的 Agent 用」，Anthropic 新使用政策 11-12 起点名禁止，Google 二次违规永久封号。想用 ChatGPT 套餐跑别的 Agent 的用户，在 Osuna 里改用 Pi，由 Pi 自己登录。
- **Q21**：做一个小子任务「登录凭证开关与风险提示」，排最后：照 magpie 加「不读登录凭证」总开关（关后套餐用量不显示）；Antigravity 提供方页加风险提示（依据 Antigravity FAQ「把 `agy` 包进第三方应用，消费者套餐不支持」）。

## 第 6 轮（2026-10-16）

- **Q22（推翻 Q20）**：要做订阅账号（块 12）的两样——「同一个 Agent 里多号自动轮换」和「订阅给任何 Agent 用」，在界面上提示用户可能被封号。用户的理由：每个号一个配置目录的手工做法，会话和配置都不能共用。随之要改的规矩：ADR 0004「auth.json is never read or written」与上一轮「不读写 CLI 登录文件」，在对应子任务里补决策记录。
- **助手的边界（已告知用户）**：magpie 多数订阅的做法是冒充别的软件（对 OpenAI 自称 `codex_cli_rs`、对 GitHub 用 VS Code 的 client_id 与请求头、对 Google 用 Gemini CLI / Antigravity 的 OAuth 客户端、对 xAI 自称 `grok-shell`），Claude 一路把调用方的 system prompt 包进用户消息以避开 Anthropic 的分类器（`subscription-ban-risk.md` 2.1、2.2 节）。冒充别的产品身份、躲避厂商识别的部分助手不实现；只做如实自报身份的做法。范围影响见第 7 轮问题。
- **Q23**：每家接口加「价格倍率」，花费按官方价 × 倍率算；用户给模型单独设的价格优先（照 magpie `PriceRate`，`internal/provider/provider.go:193-198`）。
- **Q24**：用量页从账本做三样——按接口分组、出字速度与首字等待统计、逐条请求列表（可导出 CSV，推翻 Q12「不做请求账本」）；接口页「最近换家、失败、冷却」改读账本，重启不丢（推翻 Q12「只存内存」）。账本不存对话内容。
- **Q25 分组与顺序**：未答，第 7 轮重问。

## 第 7 轮（2026-10-16）

- **Q25**：拆成 9 个子任务，顺序：1 中转站稳健性补齐 → 2 Claude Code / Codex 接入细节 + 联网搜索放行 → 3 接口管理好用性 → 4 余额与套餐额度显示 → 5 中转站记账与用量页融合 → 6 Pi / OMP + Chat 入口 → 7 Gemini 上游格式 → 8 登录凭证开关与风险提示 → 9 订阅账号。5、7、9 在各自子任务里先用 `/atw-map`。
- **Q26**：订阅账号只做 **Codex 与 Claude Code 的多号自动轮换**；「订阅给别的 Agent 用」整块不做（含 ChatGPT）。用户指出助手描述的换号做法不是 magpie 的那套——助手只讲了 magpie 两层里的「换登录」一层，漏了 Codex「经过网关换号」一层，见第 8 轮 Q28。
- **Q27**：风险提示只在用户打开多号自动轮换时提示一次，不按号逐个提醒。助手假定 Codex、Claude Code 各自第一次打开时各提示一次（两家条款不同），已告知用户。

## 第 8 轮（2026-10-16）

- **Q28**：多号自动轮换照 magpie 的两层做。
  - Codex 两层：①换登录——定时看 Codex 当前登录的号用了多少，快用完或到了用户给这个号设的上限，就让 Codex 换登到下一个还有余量的号，原来的号回落后换回；②经过内置中转站换号——在 Codex 配置里写 `openai_base_url`，Codex 保留自带的 OpenAI 服务商和登录，请求经过内置中转站，当前号接不了的请求在回复第一个字之前交给别的号。第二层可以关掉，改成只换登录。
  - Claude Code 只做换登录；Claude 订阅的请求不经过内置中转站。
  - 进子任务 9 再定：具体数字（magpie：每 5 分钟看一次、用到 98% 换走、所有窗口回到 90% 以下换回）、号的顺序与每号上限、怎么读 Claude 号的额度（magpie 只靠 Claude Code 自己的 `/usage`）、与「使用第三方接口」怎么同时存在（magpie 让第三方模型和 ChatGPT 自带模型同时出现在 Codex 的 `/model` 列表；上次任务 `10-13-api-endpoint-auto-switch` 把「Codex 与 ChatGPT 登录并存」定为不做，这里重新打开）。
  - 依据：magpie `internal/provider/codex_switch.go:15-79`、`internal/agent/codex.go:30-36`、`internal/cli/accounts_cli.go:843-846`、`docs/reference.md:1374-1400,1529-1575`。
- **Q27 补记**：用户回答 Q28 时没有反对「各自提示一次」，按此执行。
- **跨子任务的依赖（助手整理，待用户在汇总里确认）**：
  - 子任务 2 与 9 都会改 Codex 经过内置中转站的接法；2 先定接法，9 的第二层在它上面做。magpie 在 Codex 用 ChatGPT 登录时只写 `openai_base_url`、不另建服务商，对话仍记在 OpenAI 名下，可能也能解决子任务 2 的「开关前后 Codex 对话互相看不见」（仅对 ChatGPT 登录有效，未核实）。
  - 子任务 9 服从子任务 8 的总开关：magpie 的「账号发现」关掉后不读任何登录凭证（`gap-02` B25），换号也就停了。
- **加号做法与 magpie 不同（助手按边界定，待用户确认）**：magpie 自己跑 ChatGPT 登录，用 Codex CLI 的 OAuth 客户端（`internal/provider/account.go:982` `codexClientID`，回调 `internal/provider/signin.go:42-43` 的 `127.0.0.1:1455`）。Osuna 改为让真的 Codex、Claude Code 完成登录，再把结果收进 Osuna；登录过期后怎么续，按「尽量让 CLI 自己续」进子任务 9 定。
- **块 12 其余部分这次不做**：订阅给别的 Agent 用、每日预热（B31）、签到（B32）、自动用掉 Codex 重置卡（B30）。从别的工具的文件导入账号（B15）算加号的一种办法，进子任务 9 再定。

## 第 9 轮（2026-10-16）

- **Q29 汇总确认**：用户回「对」。上面各轮的决定，连同第 8 轮助手整理的跨子任务依赖、加号做法、块 12 不做的部分，都按汇总执行。discover 结束，进入 specify。

## 第 10 轮（2026-10-16，`/atw-spec`）

- 写 `prd.md` 时助手新定、已告知用户的四处：块 16 没选的条目写成「以后再说」；块 7 没选的部分写进「不做」；补两条先后（5 在 6 前，7 在 1 和 6 后）；1、2、3、4、6、8 先 `/atw-askme-with-docs` 再 `/atw-spec`，5、7、9 先 `/atw-map`。
- **Q30 测试接缝**：照做——主要靠 daemon 端到端测试（真实 daemon + 本机假上游 + fetch 扮演 CLI）和 app 浏览器测试（真实 daemon + 假中转服务 + 临时 CLI 配置目录）；已有纯逻辑套件继续加用例；登录相关只用假数据，真实账号由用户验收。
- **Q31 第 ② 个确认点**：用户确认 `prd.md`。总任务不切工单、不 `task.py start`，下一步建 9 个子任务。
