# Claude Code / Codex 接入细节与联网搜索放行

来源：总任务 [`10-16-magpie-osuna-gaps`](../10-16-magpie-osuna-gaps/prd.md) 的第 2 个子任务。访谈分 5 轮（Q1–Q36），2026-10-17～18 用户逐题回答；全部决定与依据见 [`research/decisions.md`](research/decisions.md)，核实过的事实见同目录 `codex-wiring.md`、`claude-code-wiring.md`、`web-search.md`、`codex-account-held.md`。总任务的 Constraints、Implementation Decisions、Testing Decisions 对本任务全部适用，下面只写本任务特有的。本任务改动了总任务的两条：第 2 条「凭每个提供方的中转站口令」改为本文第 15 条；第 8 条「解析不了就不写」对带注释的 `settings.json` 改为本文第 24 条。

## Problem Statement

用户靠多家中转服务在 Claude Code、Codex 里干活，由内置中转站（**Gateway**）在它们之间自动切换（**Failover**）。打开「使用第三方接口」（**Use API endpoints**）以后，两个 CLI 的接入还有这些问题：

1. Codex 的对话被开关分成两组。Codex 把每段对话记在开它时用的 Codex 服务商（**Codex model provider**）名下，只列当前那一个的对话，所以开关前后开的对话互相看不见；关掉开关时 Osuna 删掉自己的 Codex 服务商，开着时开的对话再也续不上（``Model provider `osuna_api_endpoint` not found``）；打开开关后续一段之前开的对话，请求直接发给 OpenAI，不经过中转站。
2. 开关开着时，Codex 的 `/model` 里只有第三方接口的模型，ChatGPT 自带模型不见了。
3. 走第三方接口时，Claude Code 一律不能联网搜索，哪怕那家中转服务自己会搜；Codex 每轮带的搜索工具，有的接口原样收到、有的被悄悄拿掉，用户管不了。
4. `settings.json` 开头带 BOM 或写了注释，Osuna 就当它读不懂，开关打不开，只报一行英文错误。
5. 用户在 CLI 里用 `/model` 换了模型，Osuna 当成「被别的程序改过」，下次改配置时又悄悄改回去。Osuna 能查出设置被改过、读不懂、被 Codex profile 盖过，但设置页一条都不显示。
6. Claude Code 开着云平台开关（Bedrock、Vertex、Foundry 等），或管理员下发的设置写了自己的地址时，请求根本不经过中转站，开关却显示开着。
7. Claude Code 把带点的 Claude 版本（`claude-opus-4.6`）错认成老模型；经第三方地址时自动模式先请 Anthropic 审查、退回后还弹计费提示；能到 max 却没有 xhigh 档的模型开不了 Ultra Code；接口没配档位映射时，请求档位名的地方报「模型不存在」。
8. 后台小任务和 Subagent 一律跟主模型跑，花一样多的钱，用户改不了；Codex 的记忆功能打开后发 OpenAI 自家的模型名，第三方接口没有。
9. 终端里新开的会话从什么思考档位起步，Osuna 设不了。
10. Osuna 写给 Codex 的模型清单里，每个模型都写成同样的档位和上下文，与真实能力不符。
11. 开关开着时 Claude Code 处于「未登录 claude.ai」状态：语音、claude.ai 连接器、`/usage` 的套餐额度、云端会话都用不了。
12. 关开关前看不到会改回什么；改完设置，正在运行的会话还用着旧设置却没人提醒；关掉开关时口令作废，正在运行的会话开始报错；终端里的 Codex 共用一个后台进程，改完后新会话还是旧的模型清单。
13. 电脑开着 HTTP 代理时，Codex 发给本机中转站的请求也交给代理，代理不转回本机时每一轮都 502，用户找不到原因。
14. 打开开关时默认模型怎么挑的不说明，也不看 CLI 当前在用哪个模型。

## Solution

做完后，用户看到的是：

- 有 Anthropic 或 OpenAI Responses 地址的接口多一个「自己能联网搜索」开关（**Searches the web by itself**）。开着它的接口，Claude Code 的 WebSearch 和 Codex 的搜索原样交给它；没有任何这样的接口时，模型明确知道「这里不能联网搜索」。
- 用 ChatGPT 登录的 Codex 打开开关后仍保留自己的登录和 OpenAI 服务商：开关前后的对话是同一组，`/model` 里 ChatGPT 自带模型和接口模型都在；接口模型写成「接口标识/模型名」。
- Codex 对话：关掉开关后，经中转站开的旧对话照样能续；会话历史列出所有 Codex 服务商名下的对话并标明；可以把对话挪到另一个 Codex 服务商，先备份、可挪回。
- Claude Code 的设置文件带 BOM、带注释都照改并原样保留，带注释时提示 Claude Code 自己读不了。
- 云平台开关接管时拿掉、关掉时放回，改不了的地方给提示；带点的模型名、自动模式审查、Ultra Code、档位名都按 magpie 修正。
- 在 CLI 里换模型、换思考档位，Osuna 跟着变；默认模型可以指定某一家；新增「默认思考档位」（**Default thinking**）、Claude Code 的「后台小任务模型」「Subagent 模型」、Codex 的「默认 Subagent 模型」「强制 Subagent 模型」「记忆模型」「Codex Subagent 可用任意模型」。
- Codex 的模型清单写上每个模型真实的档位、上下文和能否看图。
- Claude Code 可以选择保留 claude.ai 登录。
- 设置页显示「设置被改过」的几种情况和处理按钮；关开关前列出会改回什么；改完提示哪些会话要重开，Codex 的共享后台进程没人用时自动重启；关掉开关后正在运行的会话继续能用，直到重开。
- Codex 经代理连不上中转站时提示怎么改；Osuna 自己开的 Codex 直接绕开代理。

## User Stories

### 联网搜索

1. 作为用会联网搜索的中转服务的用户，我希望给这家接口打开「自己能联网搜索」，以便 Claude Code 用这家的模型时能真的搜网页。
2. 作为用户，我希望 Claude Code 的搜索只交给同一个模型下开了开关的接口，哪怕这段对话本身走的是别家，以便同一个模型有一家会搜就能搜到。
3. 作为用户，我希望用的模型没有任何开了开关的接口时，Claude Code 收到明确的「不能联网搜索」，以便模型不会把凭记忆写的话当成搜索结果。
4. 作为没有任何会搜的接口的用户，我希望 Claude Code 照旧不提供联网搜索，以便模型不去调用一个用不了的工具。
5. 作为自己在 `settings.json` 里禁了 WebSearch 的用户，我希望 Osuna 不动我的规则，以便我的选择优先。
6. 作为 Codex 用户，我希望 Codex 自带的搜索只发给开了开关的接口，以便不支持搜索的中转服务不因为这个工具拒收请求。
7. 作为只填了 OpenAI Responses 地址的中转服务的用户，我希望 Claude Code 的搜索也能交给它，以便它会搜就能用。
8. 作为用户，我希望这个开关只在能原样转发搜索的接口上出现，默认关、Osuna 不擅自打开，以便我只对确认会搜的那家打开。
9. 作为用 ChatGPT 登录的 Codex 用户，我希望 Codex 的独立搜索在 ChatGPT 自带模型上照常工作，在第三方模型上得到一句「不能联网搜索」而不是让这一轮失败。

### Codex 的接法

10. 作为用 ChatGPT 登录的 Codex 用户，我希望打开「使用第三方接口」后 Codex 仍用自己的 OpenAI 服务商和登录，以便开关前后的对话是同一组、都能续。
11. 作为这样的用户，我希望 `/model` 里同时有 ChatGPT 自带模型和第三方接口的模型，以便在一个列表里随时换。
12. 作为这样的用户，我希望接口的模型写成「接口标识/模型名」，不带标识的一律是 ChatGPT 自带的，以便同名时不会选错。
13. 作为这样的用户，我希望用 ChatGPT 自带模型时请求经中转站原样转给 OpenAI，以便和不经过中转站时一样。
14. 作为用户，我希望我的 ChatGPT 登录令牌从不发给任何第三方接口，以便登录只用在 OpenAI。
15. 作为用 API key 登录或没有登录的 Codex 用户，我希望照旧用 Osuna 自己的 Codex 服务商，以便接口模型出现在 `/model` 里。
16. 作为用户，我希望 Osuna 判断我是哪种登录时只问 Codex 自己，不读登录文件，以便 Osuna 不碰我的登录凭证。
17. 作为用户，我希望我登录或登出 ChatGPT 以后，Osuna 下次检查时换成对应的接法，以便不用手动重开开关。
18. 作为用过 CC Switch 的用户，我希望它加的「假 OpenAI」服务商在开关开着时也指向中转站、关掉时改回，以便记在它名下的对话也能用接口模型。
19. 作为用户，我希望 Codex 的模型清单写上每个模型真实的推理档位、上下文和能否看图，以便 Codex 按真实能力压缩对话、调档位。
20. 作为用户，我希望切换后 Codex 尽快拿到新的模型清单，以便不用等缓存过期。

### Codex 对话

21. 作为 Codex 用户，我希望关掉开关后，经中转站开的旧对话仍能续上，以便历史对话不作废。
22. 作为用户，我希望 Osuna 的会话历史列出 Codex 所有服务商名下的对话，并标出每条属于哪个 Codex 服务商，以便一处找到全部对话。
23. 作为用户，我希望把一段 Codex 对话挪到另一个 Codex 服务商名下，以便它出现在终端 `codex resume` 的列表里、用那个服务商续。
24. 作为用户，我希望一次选几段对话一起挪，以便整理很多旧对话时不用一条条操作。
25. 作为用户，我希望挪之前 Osuna 先备份，挪回原来的服务商就等于撤销，以便放心操作。
26. 作为用户，我希望正在用的对话（最近一分钟写过）不被挪动，并告诉我为什么，以便不弄坏正在进行的对话。
27. 作为用户，我希望续对话因为它的 Codex 服务商不在了而失败时，看到中文说明和一个「挪到另一个 Codex 服务商」按钮，以便当场修好。

### Claude Code 设置文件

28. 作为用户，我希望 `settings.json` 开头带 BOM 时 Osuna 照常改、保留 BOM，以便 Windows 编辑器存过的文件也能用。
29. 作为用户，我希望 `settings.json` 带注释时 Osuna 照常改、保留注释，以便我写的说明不丢。
30. 作为用户，我希望设置文件带注释时看到提示：Claude Code 读不了这份文件，终端会弹错，Osuna 里的 Claude 对话会直接走官方，以便知道该删掉注释。
31. 作为用 Bedrock、Vertex 等云平台开关的用户，我希望打开「使用第三方接口」时这些开关先被拿掉、关掉时放回，以便请求真的经过中转站。
32. 作为公司电脑上的用户，我希望云平台开关或地址写在管理员设置、`~/.claude.json` 或终端启动脚本里时看到提示，以便知道请求为什么没走第三方接口。
33. 作为用户，我希望带点的 Claude 版本写进 Claude Code 前改成连字符，以便 Claude Code 按正确的模型给回复上限、档位和价格。
34. 作为用户，我希望经中转站能到的模型都不会被 Anthropic 审查时，Claude Code 的自动模式一开始就在本机判断，以便不弹「不符合条件、照旧计费」的提示。
35. 作为用 GLM、DeepSeek 这类模型的用户，我希望能到 max 档的模型也能开 Ultra Code，以便用上加强思考。
36. 作为写了 `model: haiku` 的 Subagent 的用户，我希望接口没配档位映射时改用默认模型，以便不报「模型不存在」。

### 保留 claude.ai 登录

37. 作为用 claude.ai 登录的 Claude Code 用户，我希望可以选择走中转站时保留登录，以便语音、claude.ai 连接器、`/usage` 的套餐额度和云端会话照常能用。
38. 作为这样的用户，我希望中转站从不把我的 claude.ai 令牌转给任何接口，以便登录只用在 Anthropic。
39. 作为这样的用户，我希望某家接口回「未授权」时，Claude Code 不会以为我的 claude.ai 登录失效、要我重新登录，以便不被误导。
40. 作为用户，我希望打开这个选项前看到哪些功能能用、哪些仍不能用（Remote Control、ultrareview），以便自己决定。

### 模型与思考档位

41. 作为用户，我希望打开开关时，只要有接口提供 CLI 当前在用的模型就沿用它，以便打开开关不换掉我的模型。
42. 作为用户，我希望打开开关后看到默认模型是怎么挑的（沿用原模型、回到上次关掉前的、取第一个……），以便心里有数。
43. 作为用户，我希望默认模型可以指定某一家接口的模型，设置页显示成「模型名（接口名）」，以便新会话先用我信得过的那家。
44. 作为用户，我希望在 Claude Code 或 Codex 里用 `/model` 存成默认的模型，如果是接口提供的，Osuna 的默认模型跟着变、不报「被改过」，以便两边不打架。
45. 作为用户，我希望在 CLI 里换成哪家接口都没有的模型时，看到「模型被换掉」的提示，可以「重新应用」或「保留当前设置」，以便我决定。
46. 作为用户，我希望 Osuna 以后改配置时不再把我在 CLI 里选的模型改回去，以便我的选择不丢。
47. 作为用户，我希望在设置页设「默认思考档位」，终端新会话从这一档起步，以便不用每开一个会话再调。
48. 作为用户，我希望默认思考档位可以选 max，并知道选 max 后所有会话都锁在 max、会话里调不低，以便自己权衡。
49. 作为用户，我希望默认思考档位只在模型支持时提供 Ultra Code，以便不选到用不了的档位。
50. 作为用户，我希望在 CLI 里改了思考档位并存成默认后，Osuna 的默认思考档位跟着变，以便两边一致。
51. 作为在 Osuna 里开 Claude 对话的用户，我希望没选 Ultra Code 的对话不被设置文件里的默认 Ultra Code 盖过，以便输入框里显示的就是实际用的。
52. 作为用户，我希望 Osuna 里的新对话在没有记住的上次选择时用默认模型和默认思考档位，以便和终端一致。

### Subagent 与后台小任务

53. 作为 Claude Code 用户，我希望给后台小任务（起标题、读网页等）选一个便宜的模型，以便省钱。
54. 作为 Claude Code 用户，我希望给 Subagent 选模型和思考档位，以便 Subagent 用合适的模型干活。
55. 作为 Codex 用户，我希望设默认 Subagent 模型和思考档位，以便主对话没指定时 Subagent 用它。
56. 作为 Codex 用户，我希望设一个强制 Subagent 模型，不管主对话指定什么都改成它，以便统一管住花费。
57. 作为 Codex 用户，我希望主对话派 Subagent 时能看到全部可选模型，而不是只有 5 个，以便它能选到接口的模型。
58. 作为打开了 Codex 记忆功能的用户，我希望给记忆整理选一个接口里有的模型，以便它不向第三方接口要 OpenAI 自家的模型。
59. 作为 Codex 用户，我希望打开「Codex Subagent 可用任意模型」后，GPT 主对话也能在接口的模型上开 Subagent，以便混用不同厂商的模型。
60. 作为这样的用户，我希望 Codex 自己的 `multi_agent_v2` 盖过这个设置时看到提示，以便知道为什么没生效。

### 提示、预览与重开

61. 作为用户，我希望 Claude Code、Codex 的设置页显示「设置被改过」的情况：不再经过中转站、模型被换掉、被绕过、代理不转发、设置文件带注释、Codex profile 盖过开关、读不懂，以便知道发生了什么。
62. 作为用户，我希望设置不再经过中转站时可以「重新应用」「切回官方」或「保留当前设置」，以便按我的意思处理。
63. 作为用户，我希望「保留当前设置」在设置被别的程序改走时，等于关掉开关但不改回文件，以便别的工具的设置原样留着。
64. 作为用户，我希望 CLI 最近用过、请求却没到中转站时看到「被绕过」的提示，以便发现旧进程还在用旧设置之类的问题。
65. 作为用户，我希望关掉「使用第三方接口」之前，弹框逐条列出会改回、删除、新建的设置，确认后才改，以便放心关掉。
66. 作为用户，我希望改完设置后看到哪些正在运行的会话要重开、各自怎么重开，以便新设置真正生效。
67. 作为用户，我希望 Codex 共用的后台进程没人在用时，Osuna 自动重启它并告诉我；有人在用时给我重启命令，以便终端里的 Codex 拿到新的模型清单。
68. 作为用户，我希望关掉开关后正在运行的会话继续能用，直到我重开它们，以便关开关不打断手上的工作。

### 代理

69. 作为开着 HTTP 代理的用户，我希望 Codex 经代理连不上中转站时看到原因和改法，以便自己修好。
70. 作为这样的用户，我希望 Osuna 自己开的 Codex 对话直接绕开代理连中转站，以便它们不受代理影响。

### 跨子任务

71. 作为在手机上用官方 Paseo App 的用户，我希望这次改动后手机照常能用，以便不受影响。
72. 作为用别的界面语言的用户，我希望新界面在 9 种语言里都有文字，中文界面全是中文，以便看得懂。
73. 作为维护者，我希望被推翻的 ADR 0004、0007 规则有新 ADR 说明原因和取舍，以便以后的人知道为什么这样做。

## Implementation Decisions

### 规则与边界

1. 改动范围：daemon（CLI 配置改写、内置中转站、Codex 对话文件）、协议、客户端与 app 界面。
2. 协议遵守 `docs/protocol-compatibility.md`：
   - 新字段一律可选；新 RPC 用带点命名空间加 `.request` / `.response`，第三方接口相关的放在现有的 `provider.api_endpoint.*` 下，挪对话另起 Codex 会话的命名空间（按 `docs/rpc-namespacing.md`）。
   - 新功能挂一个新的 `server_info.features` 能力位，带 `COMPAT(...)` 标记；app 只在主机声明它时显示新界面，否则请用户更新主机，不做兼容分支。
   - 旧客户端（含官方 Paseo 手机 App）看不到新功能，但照常工作；ADR 0007 给旧客户端的「单个启用接口」投影不变。
3. 写新 ADR（编号写时取下一个），并在 ADR 0004、0007 里标出被哪篇取代：
   - **联网搜索**（第 7–11 条）：取代 ADR 0004 的 WebSearch 禁止规则那一条，写明 Q19 偏离 magpie 的三处与依据。
   - **Codex 的接法与中转站认人**（第 12–19 条）：取代 ADR 0007 的「Codex gets `base_url` … and `experimental_bearer_token`」「The token is the gateway's authentication」「Official removes the dedicated Codex table」三处，以及 Consequences 里「关开关后会话回到官方地址」那句。
   - **挪对话**（第 22 条）：Osuna 改写 Codex 自己的对话文件与状态库，这是 ADR 0004 以外的新范围。
   - **CLI 配置改写的新规矩**（第 24–33 条）：`settings.json` 按 JSONC 读写、带注释也照改；CLI 自己存下的模型与思考档位跟着走、不算被改过；被改过的几种情况与「保留当前设置」；新增的负责的键；保留 claude.ai 登录。取代 ADR 0004 的「If a file does not parse, write nothing」（对带注释的 `settings.json`）、「If the owned keys no longer hold what the daemon wrote … Never overwrite silently」（对 CLI 自己存下的选择）、Claude 一律写口令那一条。
   - ADR 0007 Consequences「an endpoint without a mapping gets the tier name as the model id」改为第 26 条第 4 项。
4. 借鉴 magpie 设计的新文件，文件头保留 MIT 声明，`THIRD_PARTY_NOTICES` 覆盖这些文件。
5. 身份如实：CLI 自己发出、经过中转站的请求保持 CLI 的样子；转给 ChatGPT 的请求原样带着 CLI 自己的请求头，不改不加；Osuna 自己发出的请求（第 38 条的代理探测）用 Osuna 自己的身份。
6. 不读不写 `auth.json` 与钥匙串。读写登录凭证归子任务 8、9。

### 联网搜索

7. 接口多一个可选布尔字段「自己能联网搜索」，随接口一起保存，旧的 `endpoints.json` 没有它即为关。只在这家有 Anthropic 或 OpenAI Responses 地址时算数，界面也只在这时显示；默认关，Osuna 不自动探测、不按厂商自动打开。
8. Claude Code 的 `settings.json`：
   - 至少一家开着的接口打开了这个开关时，Osuna 不写、并拿掉自己写的 `WebSearch` 禁止规则；一家都没有时照旧写。条件变了就重写 `settings.json`（指纹包含这个条件）。
   - 用户自己写的 `WebSearch` 禁止规则不动，这时这个开关对 Claude Code 不起作用。
   - 加上或拿掉这条规则，正在运行的会话下一次请求就跟着变，这一次的提示缓存失效；界面说明里写明这一点。
9. 中转站认出 Claude Code 的搜索子请求（请求里带 `web_search_*` 服务端工具）：
   - 候选只取同一个模型下、开着、打开了这个开关、有 Anthropic 或 Responses 地址的接口，在它们之间照常自动切换；对话本身走哪家不影响。Subagent 里的搜索按 Subagent 的模型找。
   - 这家有 Anthropic 地址就原样直通；只有 Responses 地址时，照 magpie 把搜索工具写成 Responses 的原生 `web_search`，回复里的搜索结果再写回 Claude Code 认得的 `server_tool_use` 与 `web_search_tool_result`（结果项要有 title、url）。
   - 一家这样的接口都没有时，回 Anthropic 格式的 400 `invalid_request_error`，文字说明这个模型没有开着「自己能联网搜索」的接口。不用 401、403（会让 Claude Code 要求重新登录），不用 429、5xx（会让它重试）。不剔掉工具后照发。
10. Codex 的搜索：
    - Codex 每轮带的 `web_search` 工具：轮到打开了开关的接口时原样转（只有 Anthropic 地址的写成 `web_search_20250305`，结果写回 `web_search_call`）；轮到没打开的接口时拿掉这个工具（点名它的 `tool_choice` 一并拿掉）。历史里的 `web_search_call` 项照 magpie 处理。
    - 用 ChatGPT 登录的 Codex 的独立搜索（`/alpha/search`）：ChatGPT 自带模型转给 ChatGPT；第三方模型回 200，`output` 是一句「不能联网搜索」的说明，不回 404（404 会让 Codex 结束这一轮）。
11. 不做代搜：Osuna 不用自己的搜索服务、也不用别家接口替不会搜的接口去搜。

### Codex 的接法

12. 判断登录方式：Osuna 不读 `auth.json`，起一个临时的 Codex app-server（覆盖成内置 openai 服务商）调 `account/read`。打开开关时、daemon 启动时、读状态时都判断一次；登录方式变了（用户登录或登出 ChatGPT）就按新方式重写。
13. 两种接法：
    - **ChatGPT 登录**：写顶层 `openai_base_url`，指向中转站的 ChatGPT 后端地址（以 `/backend-api/codex` 结尾，Codex 才继续把它当 ChatGPT 后端）；拿掉 Osuna 写过的顶层 `model_provider`、`model_catalog_json`；顶层 `model` 写默认模型；同时照旧写 Osuna 自己的 Codex 服务商表（给记在它名下的对话用，见第 19 条）。照 magpie 把 Codex 的模型缓存标成过期，让它尽快重新拉清单。用户自己写的 `openai_base_url` 怎么处理，实现时对照 magpie 定，按 ADR 0004 记原值、关掉时还原。
    - **API key 登录或未登录**：照旧写 Osuna 自己的 Codex 服务商表、顶层 `model_provider` 与 `model_catalog_json`。
14. 中转站新增 ChatGPT 后端那一组路径（挂在中转站现有的入口下）：
    - 对话请求：模型名带接口标识（`接口标识/模型名`）的按现有规则选接口、自动切换；不带标识的是 ChatGPT 自带模型，原样转给 `https://chatgpt.com/backend-api/codex` 加原路径与查询串，除逐跳头、`Host` 外的请求头全部原样带上。
    - 转给第三方接口时，用户的 ChatGPT 令牌、账号 id 一律不带，只带 Codex 表明身份的那些头（User-Agent、originator、会话与线程 id、`x-codex-*` 中 magpie 转发的那些）。
    - WebSocket 握手回 426，让 Codex 立刻改用 HTTP。
    - `/responses/compact`：ChatGPT 自带模型转给 ChatGPT；接口模型照 magpie 拒绝。
    - 模型清单：把 Codex 的清单请求原样转给 ChatGPT（等 3 秒），拿不到就用上次的结果；ChatGPT 的 401、403 原样回给 Codex；后面接上接口的模型（`接口标识/模型名`，带第 23 条的真实能力），按 Codex 的格式返回。
    - 其余 ChatGPT 后端路径原样转。请求体 zstd 子任务 1 已能解。
15. 中转站认调用方（取代 ADR 0007 的口令认证）：
    - 本机回环来的、不带转发头的请求一律收；照 magpie 拒收网页发来的请求（跨站、DNS 重绑定）。
    - 是哪个 Agent：口令对得上就按口令；对不上（例如 ChatGPT 令牌、claude.ai 令牌、空值）就按路径（ChatGPT 后端路径是 Codex）和 User-Agent 认，规则照 magpie。
    - 口令照旧写进 CLI 配置（CLI 要一个值），开关开开关关保持不变，不再作废。
16. 用 ChatGPT 登录的 Codex，接口的模型在 `/model` 里写成「接口标识/模型名」；不带标识的名字一律指 ChatGPT 自带的。API key 登录或未登录时，模型清单与现在一样。
17. CC Switch 一类工具写的「OpenAI 镜像」Codex 服务商（名字是 OpenAI、要求 OpenAI 登录、没有 `base_url`）：ChatGPT 登录接法下，开关开着时把它的 `base_url` 也指向中转站的 ChatGPT 后端地址；按 ADR 0004 记原值、算负责的键、关掉时还原、被外部改了走第 34 条的提示。
18. ChatGPT 账号额度和余额都用完时不做特别处理（子任务 9）。这时 Osuna 里的 Codex 与终端 Codex 照常发出请求，ChatGPT 自带模型那一轮由 ChatGPT 回额度用完，第三方模型照常能用。

### Codex 对话

19. Osuna 自己的 Codex 服务商表写了就保留，关掉开关也不删；中转站继续接这些对话（要 daemon 在运行）。daemon 启动时即使开关关着，也按新端口改写这张表。
20. 提供方会话列表：列 Codex 对话时请 Codex 列出所有服务商名下的，每条带上它的 Codex 服务商（新的可选字段）；会话历史在 Codex 的行上显示它。
21. 续对话时照常按它记的 Codex 服务商续；因为那个服务商已不在 Codex 设置里而失败时，错误说明原因，并给出「挪到另一个 Codex 服务商」。
22. 挪对话（新 RPC，照 magpie）：
    - 输入一组对话和目标 Codex 服务商；目标可选 Codex 设置里现有的服务商、内置 `openai`、Osuna 自己的服务商。
    - 对话文件一分钟内写过的不挪，结果里说明。
    - 先把每个对话文件（含压缩过的孪生文件）复制到 Osuna 自己的备份目录，并写一份挪动记录（对话 id、原服务商、目标服务商、时间、文件对照）。
    - 改每个文件里每一条带服务商的 `session_meta`：只改服务商，其余字节不动；压缩的照样压回；写到旁边的临时文件、落盘、保留修改时间、改名替换。再把每个 `state_*.sqlite` 里这条对话的服务商改掉。
    - 中途失败就用备份把已改的文件改回去。
    - 撤销就是挪回原服务商。
    - 已知局限照 magpie：对话文件里设置快照事件带的旧服务商不改；Codex 若从对话文件重建状态库，挪动可能被改回（推断，见 Testing Decisions 的一次性核实）。
23. Codex 的模型清单写真实能力：上下文、回复上限、推理档位与默认档、能否看图，取接口自己的模型清单，其次 models.dev；查不到的保持现在的写法。用在 Osuna 写的模型目录文件与第 14 条合并的清单。models.dev 的拉取改为 Claude Code 或 Codex 任一打开开关时都允许。

### Claude Code 设置文件与修正

24. `settings.json` 按 JSONC 读写：
    - 开头的 BOM 读时去掉、写回时保留；注释、尾随逗号照样认；改动只动负责的键，注释与排版原样。
    - 文件带注释或尾随逗号（Claude Code 自己读不了）时照改，并在设置页提示（第 34 条）。
    - 连 JSONC 都读不懂的文件照旧拒绝，说明原因用用户的界面语言。
25. 云平台开关：
    - 接管时拿掉 `settings.json` 的 `env` 里开着的 `CLAUDE_CODE_USE_BEDROCK`、`_VERTEX`、`_FOUNDRY`、`_ANTHROPIC_AWS`、`_ANTHROPIC_GOOGLE_CLOUD`、`_MANTLE`，原值记下，关掉时放回（用户之后又自己设了的除外）；关着的开关和云平台的其他变量不动。
    - 写在托管设置（macOS `/Library/Application Support/ClaudeCode`、Linux `/etc/claude-code`、Windows `C:\Program Files\ClaudeCode`，含 `managed-settings.d/`）、`~/.claude.json` 的 `env`、登录 shell 的环境里的，只提示。
    - 托管设置的 `env.ANTHROPIC_BASE_URL` 不指向中转站时提示。
26. 四个修正（照 magpie）：
    1. 带点的 Claude 版本：写进 `model`、`modelPicker`、后台小任务模型与 Subagent 模型时，只有连字符写法能唯一对上一个在售 Claude id 才改写；别家的 id、用户自己的值不动。中转站按每家自己的写法发出（子任务 1）。
    2. 经中转站能到的模型都不会被 Anthropic 审查时，写 `CLAUDE_CODE_AUTO_MODE_SERVER=0`。「会被审查」指名字是 Claude 的模型，或地址是 `api.anthropic.com` 的接口。每次重写都重算；用户自己的值不动；关掉时拿掉。
    3. 推理档位能到 max 却没有 xhigh 的模型，能力提示里也报 xhigh，好让 Claude Code 允许 Ultra Code；中转站按模型自己的档位发出（现有规则）。名字是 Claude 的模型不变。
    4. 请求的是 Claude 档位名（opus、sonnet、haiku、fable，或 Claude Code 内置的档位 id），没有开着的接口为这个档位配映射时，改用这个提供方的默认模型，不再回 404。
27. 保留 claude.ai 登录（Claude Code 设置页的选项，默认关）：
    - 打开时 `ANTHROPIC_AUTH_TOKEN` 写成空值（负责的键），Claude Code 于是用 claude.ai 登录；关掉选项时写回口令。
    - 中转站收下 claude.ai 的令牌但从不转发；去掉 `anthropic-beta` 里 `oauth-` 开头的项。
    - 对话与 count_tokens 请求：上游回 401，或回 403 且说 OAuth 令牌已吊销时，改回 502 `api_error` 并写明是哪家接口；其他错误保持状态码，只把正文里的 `x-api-key` 换成 `API key`（照 magpie）。
    - 照 magpie 检查两种不一致并提示：选项开着但口令被手填回去；选项关着但口令是空的。

### 模型与思考档位

28. 打开开关时挑默认模型，照 magpie 的几种方式依次取：已有且还能用的保持；上次关掉前用的放回；CLI 当前在用、有接口提供的沿用；档位名指向的映射模型；都没有时取第一个。用 ChatGPT 登录的 Codex 保持它自己上次选的模型，接口模型并进 `/model`。结果告诉 app 这次是哪一种，设置页显示一句说明；没有能用的模型时照旧拒绝并说明。
29. 默认模型可以是光秃秃的模型名，也可以是「接口标识/模型名」。设置页的选项同时列出两种；指定某家的显示成「模型名（接口名）」。
30. CLI 自己存下的选择跟着走：
    - CLI 配置里的模型变成另一个接口提供的模型（光秃秃的、带接口标识的、带 `[1m]` 的都算）时，Osuna 把它当成新的默认模型，更新自己记的写入值，不算被改过；跟随主模型的字段一起跟过去（照 magpie）。
    - 变成哪家接口都没有的模型时，报「模型被换掉」（第 34 条）。
    - Osuna 以后重写配置时不再改回 CLI 存下的模型。
    - 思考档位同样处理：Codex 的 `model_reasoning_effort`，Claude Code 的 `effortLevel` 与 `modelSettings`。
31. 默认思考档位（界面名「默认思考档位」，英文 Default thinking）：
    - 按提供方设，选项来自默认模型的档位；开关开着时写进 CLI 配置，关掉时还原；Osuna 新对话在没有记住的上次选择时也用它。
    - Claude Code：low 到 xhigh 写顶层 `effortLevel`，默认模型是 Claude 时另写 `modelSettings.<模型>.effortLevel`；max 写 `env.CLAUDE_CODE_EFFORT_LEVEL`，所有会话锁在 max、`/effort` 调不低，界面写明；Ultra Code 写 `ultracode: true`，只在模型支持 xhigh 时提供（含第 26 条第 3 项）。
    - Codex：写顶层 `model_reasoning_effort`，Codex 收的档位都可以选。
    - Osuna 自己的 Claude 对话没选 Ultra Code 时，明确传「不用」，免得设置文件里的默认值盖过来。
    - 按 Claude Code 与 Agent SDK 的源码核实（不在本机运行 Claude Code）：默认是 max 时，Osuna 对话里每次选的思考档位会不会被锁住；会的话，在 Osuna 对话的思考档位旁写明原因。
32. Claude Code 的后台小任务模型与 Subagent 模型（负责的键，关掉时还原）：
    - 后台小任务模型写 `env.ANTHROPIC_SMALL_FAST_MODEL`；不设就跟主模型。
    - Subagent 模型写 `env.CLAUDE_CODE_SUBAGENT_MODEL`；它的思考档位照 magpie 写成「模型名:档位」，中转站认出这个后缀、去掉后再选接口，并按目标格式设好档位。不设就跟主模型。
    - 选项来自开着的接口的已选模型。
33. Codex 的 Subagent 与记忆（照 magpie；负责的键，关掉时还原）：
    - 默认 Subagent 模型与思考档位：写 `[agents]` 的 `default_subagent_model`、`default_subagent_reasoning_effort`；档位按模型能收的校验。
    - 强制 Subagent 模型：不写配置，中转站把带 Subagent 标记的请求改成这个模型。
    - 派 Subagent 时的模型清单补全：请求里有 `spawn_agent` 工具且它的说明里有 Codex 列出的那几个模型时，中转站把其余可选模型补在后面（最多 200 个）。
    - 记忆模型：`[memories]` 的 `extract_model` 与 `consolidation_model` 写成同一个；只在 Codex 的记忆功能打开时有用，Osuna 不碰那个功能开关。
    - 「Codex Subagent 可用任意模型」：照 magpie 把清单里模型的多 Agent 版本标成 v1，让 GPT 主对话能在接口模型上开 Subagent；Codex 自己的 `multi_agent_v2` 开着（会盖过它）或读不到配置时提示。

### 提示、预览与重开

34. 设置页的「设置被改过」提示（读状态时检测，不在后台监视文件；文字由 app 按代码与参数翻译）：

    | 情况 | 什么时候算 | 按钮 |
    |---|---|---|
    | 不再经过中转站 | 地址、口令、`openai_base_url`、镜像服务商的地址被改；或第 25 条的云平台开关、托管设置盖过 | 重新应用、切回官方、保留当前设置（= 关掉开关但不改回文件，不再提示） |
    | 模型被换掉 | 第 30 条：换成哪家接口都没有的模型 | 重新应用、保留当前设置（= 不再提示，开关照开） |
    | 被绕过 | 设置没问题，但 CLI 自己的会话记录显示最近一次改写之后用过，中转站却没收到这个提供方的请求 | 重新应用、切回官方 |
    | 代理不转发 | 第 38 条 | 如何修复 |
    | 设置文件带注释 | 第 24 条 | 如何修复 |
    | Codex profile 盖过开关 | 现有 | 不变 |
    | 读不懂 | 现有 | 不变 |
    | `multi_agent_v2` 盖过 | 第 33 条 | 如何修复 |

    「地址没人应答」不做：Osuna 只写本机地址，这种情况只会因为地址被改而出现，已算在第一种里。「保留当前设置」是新 RPC。
35. 关开关前的预览（新 RPC）：在当前文件内容上算出关掉以后的结果，不写盘；按文件列出改回的项（现在的值、改回的值）、删掉的项、新建或删除的文件，并说明 Osuna 的 Codex 服务商会保留、用它开过的对话还能打开。app 在关「使用第三方接口」的确认框里显示；算不出时（文件读不懂）改用文字说明。
36. 改完提示要重开谁：每次改写后和读状态时，列出还在用旧设置的副本：
    - Osuna 自己正在运行的会话（按提供方计数）；
    - 在最近一次改写之前启动的终端 Claude Code、Codex 进程；
    - Codex 共用的后台 app-server（按它的进程记录文件判断启动时间）。没有客户端连着时 Osuna 用这个 `CODEX_HOME` 执行 `codex app-server daemon restart` 并说明已重启；有客户端连着时给出这条命令。
    - 每类说明怎么重开；Claude Code 新写入的环境变量会立刻用上，但删掉的变量、模型和思考档位要重开会话才生效，照实说明。
37. 关掉开关不作废口令（第 15 条），正在运行的会话继续经中转站，直到重开。

### 代理

38. Codex 代理检测（照 magpie）与绕开：
    - 按 Codex 自己的规则算出它会走哪个代理：登录 shell 的 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY`，macOS 与 Windows 的系统代理，`NO_PROXY` 只认精确 IP 或网段；Codex 配置开了 `respect_system_proxy` 时按它的路径。
    - 经这个代理请求中转站的根路径（3 秒超时），直连能通、经代理不通时报「代理不转发」，修复说明按代理来自环境变量、Windows 设置、其他三种情况给出（magpie 的三种说法）。
    - Osuna 自己起的 Codex 进程，环境里的 `NO_PROXY` 加上 `127.0.0.1`（已有值时追加）。终端 Codex 只提示。
    - 这次探测是 daemon 主动发出的请求，写进 `docs/usage.md` 的「Outbound requests」。

### 文档

39. 要写或要改的文档：
    - 第 3 条的新 ADR；ADR 0004、0007 标出被取代处。
    - `docs/glossary.md`：访谈中已改「第三方接口」「中转站」「使用第三方接口」「默认模型」「会话历史」「提供方」，新增「自己能联网搜索」「默认思考档位」「Codex 服务商」；实现完对照最终行为复核。
    - `docs/data-model.md`：接口的新字段、Agent 设置的新字段、接管记录里新负责的键、挪对话的备份与记录。
    - `docs/usage.md` 的「Outbound requests」：代理探测；models.dev 改为 Codex 打开开关时也拉；中转站转发 Codex 自己的 ChatGPT 请求（原样转发，不是 daemon 主动发出）。
    - `docs/custom-providers.md`：`extends: "claude"` 的自定义提供方与 WebSearch 规则的说明随第 8 条更新。
    - `THIRD_PARTY_NOTICES`：覆盖新借鉴的 magpie 文件。

## UI and Design

- **方向**：沿用现有的第三方接口页、提供方设置页与会话历史，不另做视觉风格。没有原型。遵守 `docs/design.md`、`docs/forms.md`、`docs/hover.md`、`docs/unistyles.md`、`docs/menus.md`、`docs/i18n.md` 与 `.atw/spec/app/frontend/`。用户定过的偏好：开 / 关一律用 Switch；模型名不用等宽字体；次要操作不用蓝色链接。
- **接口页**：「联网搜索」一行，Switch「自己能联网搜索」加一行说明（「适用于 Anthropic 或 OpenAI 官方接口前面的中转：Claude Code 和 Codex 的联网搜索原样交给它」）；只在有 Anthropic 或 Responses 地址时出现；保存中、成功、失败三态，失败信息留在原处直到重试或关掉。
- **Claude Code 设置页「使用第三方接口」区**：开关；默认模型（选项含「模型名（接口名）」）；默认思考档位（max 写明会锁住所有会话；Ultra Code 只在支持时出现）；后台小任务模型；Subagent 模型与它的思考档位；「保留 claude.ai 登录」Switch，说明哪些能用、哪些仍不能用；提示区（第 34 条的各种情况、云平台与托管设置、带注释、重开提示）；打开后的「默认模型是怎么挑的」一句。
- **Codex 设置页**：同上的开关、默认模型、默认思考档位、提示区，外加默认 Subagent 模型与思考档位、强制 Subagent 模型、记忆模型、「Codex Subagent 可用任意模型」Switch；代理提示带「如何修复」；共享后台进程的重启结果或命令。
- **关开关的确认框**：标题「关闭 {提供方} 的第三方接口？」一类；读取中显示「正在读取要改回的地方…」；按文件列出改回 / 删除 / 新建，长列表折叠成「还有 N 行」；Codex 写明「Osuna 的 Codex 服务商保留，用它开过的对话还能打开」；算不出时显示文字说明；取消与确认。
- **会话历史**：Codex 的行显示 Codex 服务商；行菜单与右键菜单加「挪到另一个 Codex 服务商…」；新加多选模式，选中几行后批量挪；挪动对话框选择目标、说明会先备份、挪回即撤销；最近一分钟写过的被跳过并说明；进行中、成功、失败三态；续不上的错误里给出同一个操作。
- **Osuna 对话的思考档位**：默认思考档位是 max 且核实会锁住时，旁边写明原因。
- **视口**：桌面（Electron 与浏览器，宽 1280）和窄窗口（compact，宽 390）。原生端不做实机验收；官方 Paseo 手机 App 不出现新界面。
- **看截图就能判断的验收**：
  - 新增的开关都是 Switch；模型名不是等宽字体。
  - 中文界面的新文字全是中文，用词与 `docs/glossary.md` 一致（「自己能联网搜索」「默认思考档位」「Codex 服务商」「Subagent」保留英文）；英文界面没有露出翻译键名。
  - 宽 390 下，提供方设置页的开关与提示区按钮、确认框的确认按钮、会话历史的挪动操作不被遮住。
  - 「联网搜索」一行只在有 Anthropic 或 Responses 地址的接口页出现。

## Testing Decisions

- **好测试的标准**：只测外部看得到的行为：CLI 收到什么、每个假上游（含假 ChatGPT 后端）收到什么、RPC 返回什么、磁盘上的 CLI 配置与 Codex 对话文件变成什么、界面显示什么；不测内部结构。确定性要求见 `docs/testing.md`。
- **接缝一（主）：daemon 端到端测试。** 进程内启动真实 daemon，`HOME`、`CLAUDE_CONFIG_DIR`、`CODEX_HOME` 都指向临时目录，本机起假上游与假 ChatGPT 后端，用 fetch 扮演 CLI 打中转站，读改写后的 `settings.json`、`config.toml`、模型目录，调新的 RPC。先例：现有的 Claude 配置、Codex 配置、中转站、主机共用接口那几组端到端测试与它们共用的假上游夹具。要覆盖：
  - 联网搜索：开关决定 `settings.json` 有没有禁止规则；搜索子请求只到开了开关的同名接口、只有 Responses 地址时的改写与结果回写、一家都没有时的 400；Codex 的 `web_search` 按开关保留或拿掉；`/alpha/search` 的两种回答。
  - Codex 两种接法写的键与还原；ChatGPT 自带模型原样转给假 ChatGPT 后端（请求头不变）、接口模型不带 ChatGPT 令牌；WebSocket 426；`/responses/compact`；模型清单合并与 ChatGPT 拿不到时用上次结果；镜像服务商的改写与还原；关掉后 Osuna 的 Codex 服务商表留着、旧对话的请求照常被接。
  - 认调用方：不带口令、带 ChatGPT 令牌、带 claude.ai 令牌的本机请求都收，认对 Agent；带 `Origin` 或转发头的拒收。
  - 保留 claude.ai 登录：令牌不转发、`oauth-` beta 被去掉、401 与吊销的 403 变 502。
  - `settings.json` 带 BOM、带注释时照改并保留；云平台开关拿掉与放回；四个修正；默认思考档位、后台小任务与 Subagent 模型写的键；CLI 存下另一个接口模型后默认模型跟着变、不报被改过、之后重写不改回；换成接口没有的模型报「模型被换掉」；「保留当前设置」两种含义。
  - 预览 RPC 不写盘、列出的项与真的关掉后一致；重开提示里 Osuna 会话数；关掉开关后带旧口令的请求照常被接。
  - 挪对话：用夹具做的对话文件（含压缩的）与状态库，挪动后服务商改了、其余字节不变、修改时间保留、备份与记录在；一分钟内写过的被跳过；挪回后与原文件逐字节相同；中途失败时改回。
  - 提供方会话列表带上 Codex 服务商。
- **接缝二：app 浏览器测试。** Playwright 加真实 daemon 加本机假中转服务，CLI 配置目录指向临时目录。先例：第三方接口设置页的浏览器测试与它的假中转服务夹具、导入会话那组测试。覆盖接口页的联网搜索开关、提供方设置页的新选项与提示区、关开关确认框的预览、会话历史的 Codex 服务商标签与单条、多选挪动；每个会失败的操作测成功与失败两种。
- **接缝三：已有的纯逻辑套件继续加用例**：Claude 配置改写、Codex 配置改写、Codex 模型目录、Claude 能力提示、中转站的路由、直通、翻译、认调用方。
- **新增的接缝只有两个，都放在最外层**：
  - 进程与命令：列出正在运行的 CLI 进程、执行 `codex app-server daemon restart`、探测代理，都经可替换的适配器，测试里用假实现（沿用现有的假 CLI 脚本做法）。
  - 登录方式：`account/read` 经可替换的适配器，测试里返回 ChatGPT、API key、未登录三种。
- **Codex 的一次性核实**（写代码时做，不进 CI）：在临时 `CODEX_HOME` 里用真的 Codex 核实三件事：列出所有服务商的对话；挪过的对话在 Codex 里列在新服务商下、能续上；Codex 从对话文件重建状态库后挪动会不会被改回。结果写进实现记录。不碰用户的 `~/.codex`。
- **不在本机运行 Claude Code。** Claude Code 的行为（读带注释文件的结果、`CLAUDE_CODE_EFFORT_LEVEL` 是否锁住 SDK 会话、搜索子请求的样子）来自读源码与文档；用真实账号的验收由用户自己做。
- 做会改写 CLI 配置的界面验收（截图）前，先向用户说明怎么隔离（写到哪个临时目录、不跑真 CLI、怎么证明真实文件没动），取得同意再做。
- 不新建测试套件，不加 npm 脚本或 CI 任务；所有上游都是本机假服务；本机只跑改到的测试文件，全量交给 CI。

## Constraints

- 总任务的约束全部适用：官方 Paseo 手机 App 一行不改；用 TypeScript 在 daemon 里重写，不托管 magpie；借鉴的文件保留 MIT 声明；协议遵守 `docs/protocol-compatibility.md`；中转站只服务本机；身份如实；不在用户本机测 CLI 登录。
- 每个新负责的键都遵守 ADR 0004 的改写规则（记原值并还原、原子替换、写前重读、外部改动检测），本文第 24、30、34 条改动的地方以新 ADR 为准。
- 不读不写 `auth.json` 与钥匙串。
- Codex 的对话文件与状态库只在用户发起挪动时改，先备份。
- 新数据遵守 `docs/data-model.md`：Zod 校验、原子写入、不做迁移；新字段一律可选。
- 界面文字覆盖 9 种语言，中文是真翻译（`docs/i18n.md`）。
- 不改用户自己写的 `WebSearch` 禁止规则、自己设的环境变量与模型选择。

## Acceptance Criteria

- [x] 联网搜索：「自己能联网搜索」只在有 Anthropic 或 Responses 地址的接口上出现，默认关，保存后重启仍在。至少一家开着的接口打开它时，`settings.json` 里没有 Osuna 写的 `WebSearch` 禁止规则，否则有；用户自己写的规则始终不动。
- [x] Claude Code 的搜索子请求只到同一模型下打开了开关的接口，在它们之间照常自动切换；只有 Responses 地址的那家收到原生 `web_search`，Claude Code 收到带 title、url 的搜索结果块；一家都没有时收到 400 和说明文字。
- [x] Codex 的 `web_search` 只出现在发给打开了开关的接口的请求里；`/alpha/search` 对 ChatGPT 自带模型转给 ChatGPT，对接口模型回 200 和说明。
- [x] 用 ChatGPT 登录的 Codex：开关打开后 `config.toml` 只多 `openai_base_url`、`model` 与 Osuna 的 Codex 服务商表，没有 Osuna 写的 `model_provider`、`model_catalog_json`；关掉后按原样还原，Codex 服务商表保留。
- [x] ChatGPT 自带模型的请求到达假 ChatGPT 后端时，请求头与 CLI 发出的一致；发给第三方接口的请求里没有 ChatGPT 令牌和账号 id；模型清单里 ChatGPT 自带模型在前、接口模型以「接口标识/模型名」在后；WebSocket 握手得到 426。
- [x] API key 登录或未登录的 Codex 照旧用 Osuna 的 Codex 服务商；登录方式变了以后，下次检查按新方式重写。
- [x] CC Switch 一类的 OpenAI 镜像服务商：开着时地址指向中转站，关掉时还原。
- [x] 中转站收下不带口令、带 ChatGPT 令牌或 claude.ai 令牌的本机请求并认对 Agent；带 `Origin` 或转发头的请求被拒；关掉开关后带旧口令的请求照常被接。
- [x] 关掉开关后，记在 Osuna 的 Codex 服务商名下的对话能续上；会话历史列出所有 Codex 服务商的对话并标明。
- [x] 挪对话：一条或几条挪到目标 Codex 服务商后，对话文件里只有服务商变了，修改时间不变，状态库已更新，备份与记录在；一分钟内写过的被跳过并说明；挪回后与原文件逐字节相同；中途失败时已改的被改回。续对话因服务商不在而失败时，错误里有「挪到另一个 Codex 服务商」。
- [x] Codex 模型清单里有真实档位、上下文、能否看图的模型，按真实值写；查不到的保持原写法。
- [x] `settings.json` 带 BOM、带注释、带尾随逗号时，开关能打开，Osuna 只改负责的键，BOM 与注释原样保留；带注释或尾随逗号时设置页有提示；连 JSONC 都读不懂的被拒绝，原因是界面语言。
- [x] 云平台开关在接管时被拿掉、关掉时放回；写在托管设置、`~/.claude.json`、登录 shell 里的有提示；托管设置的地址盖过中转站时有提示。
- [x] 带点的 Claude 版本写成连字符；`CLAUDE_CODE_AUTO_MODE_SERVER=0` 只在条件成立时写；能到 max 没有 xhigh 的模型报 xhigh；没配映射的档位名用默认模型回答，不再 404。
- [x] 保留 claude.ai 登录打开时 `ANTHROPIC_AUTH_TOKEN` 为空；上游收不到 claude.ai 令牌和 `oauth-` beta；上游 401 与吊销的 403 让 CLI 收到 502；两种不一致有提示。
- [x] 打开开关时默认模型按第 28 条挑，设置页说明是哪一种；默认模型可以是「接口标识/模型名」，显示成「模型名（接口名）」。
- [x] CLI 存下另一个接口提供的模型或思考档位后，默认模型、默认思考档位跟着变，不报被改过，之后的重写不改回；换成接口没有的模型时报「模型被换掉」，「重新应用」「保留当前设置」按第 34 条生效。
- [x] 默认思考档位：Claude Code 与 Codex 写的键与第 31 条一致，max 时设置页写明会锁住；Ultra Code 只在支持时出现；关掉时还原；Osuna 的 Claude 对话没选 Ultra Code 时不被默认值盖过。
- [x] 后台小任务模型、Subagent 模型与思考档位、Codex 的默认 Subagent 模型与档位、强制 Subagent 模型、模型清单补全、记忆模型、「Codex Subagent 可用任意模型」各按第 32、33 条生效，关掉时还原；`multi_agent_v2` 开着时有提示。
- [x] 设置页显示第 34 条表里的各种情况与按钮，「保留当前设置」两种含义都对；「被绕过」在 CLI 用过而中转站没收到请求时出现。
- [x] 关开关前的确认框列出的改回、删除、新建项，与确认后文件的实际变化一致；预览不改任何文件。
- [x] 改完设置后列出要重开的会话与重开办法；Codex 共享后台进程没人连着时被重启并说明，有人连着时给出命令。
- [x] Codex 经代理连不上中转站时，提示按代理来源给出改法；Osuna 起的 Codex 进程环境里 `NO_PROXY` 含 `127.0.0.1`。
- [x] 界面：UI and Design 一节的截图验收各条成立；9 种语言的键齐全，中文没有残留英文。
- [x] 旧客户端兼容：新协议字段都可选，新功能挂在新的能力位上；官方 Paseo 手机 App 连新 daemon 时，聊天、提供方设置、第三方接口的旧视图照常工作。
- [x] 文档：第 3 条的新 ADR 写好，ADR 0004、0007 标出被取代处；`docs/glossary.md` 与最终行为一致；`docs/data-model.md`、`docs/usage.md`、`docs/custom-providers.md`、`THIRD_PARTY_NOTICES` 按第 39 条更新。
- [x] Codex 一次性核实的三件事有结果，写进实现记录；挪动会被改回的话，在 ADR 与界面说明里写明。
- [ ] `npm run typecheck`、`npm run lint` 通过；改到的测试文件本机通过；合入后 CI 通过（已知常红的 Nix 两项除外）。
- [x] 用户验收（用户自己做）：真实的 Claude Code 在打开「自己能联网搜索」的接口上搜得到结果；真实的 Codex 用 ChatGPT 登录时，开关前后的对话是同一组，ChatGPT 自带模型与接口模型都能用；保留 claude.ai 登录时语音与 `/usage` 套餐额度可用。

验收记录（2026-10-19）：
- 本机：整仓 `npm run typecheck`、`npm run lint` 通过；本任务改过的 86 个单测与 daemon 端到端测试文件逐个单跑全过（3005 个用例），4 个浏览器测试文件全过（53 个用例）。
- 未勾的一条只差「合入后 CI 通过」：这时本任务还没推送到 GitHub，CI 没跑过；推送后再看。
- 用户认可的例外：中文截图里的相对时间（just now、5m ago）来自原有公共代码，由任务 10-13-zh-relative-time-and-plan-labels 处理；Claude Code 换模型后思考档位不改文件（20 号工单）；云平台开关一次只提示一处（16 号工单）。
- 官方 Paseo 手机 App 的兼容只靠协议兼容测试，没有实机验收（原生端免验收）。

## Out of Scope

- 代搜（Osuna 用搜索服务或别家接口替上游搜）与搜索 MCP（01·A16, B28, B29, H04；04·D1–D16）；WebFetch 的网站检查 `skipWebFetchPreflight`（Q22）。
- 「找到了 CLI 但不在终端 PATH 里」的提示（03·A03，挪到块 24「Agent 管理补齐」）；经反向代理连到中转站不算被改过（03·A11）；「地址没人应答」这种提示。
- ChatGPT 账号额度和余额都用完时临时改成独立服务商（子任务 9）；Codex 与 Claude Code 的多号轮换（子任务 9）；「不读登录凭证」总开关（子任务 8）。
- magpie 接入里不在块 2 的部分：按 Agent 设四个档位的模型（03·B03）；Codex 起标题、写描述、猜下一句、自动审批这些隐藏请求改投别的模型。
- Pi、OMP 的接入（子任务 6）；Claude Desktop、Codex 桌面应用的专门处理。
- Remote Control、ultrareview 经中转站可用（Claude Code 只在 Anthropic 自己的地址上提供）。

## Source Rows

块 2 与块 6 中本任务的明细行（`../10-16-magpie-osuna-gaps/research/gap-01-gateway-routing.md`、`gap-02-providers-accounts-plugins.md`、`gap-03-agents-usage.md`）与本文条目的对应：

| 明细行 | 本文条目 |
|---|---|
| 02·A26 | 7–11 |
| 03·A03 | Out of Scope（块 24） |
| 03·A06 | 28 |
| 03·A09 | 35 |
| 03·A10 | 30、34 |
| 03·A11 | Out of Scope |
| 03·A15 | 24 |
| 03·A17 | 36 |
| 03·B04 | 32 |
| 03·B05 | 32 |
| 03·B06、B07 | 31 |
| 03·B08、01·A38 | 27 |
| 03·B10 | 26.3 |
| 03·B11 | 26.2 |
| 03·B12、B13 | 25 |
| 03·B14 | 26.1 |
| 03·C01、C02 | 12–16 |
| 03·C03 | 19 |
| 03·C04 | 23 |
| 03·C05 | 31 |
| 03·C06–C10、01·F08 | 33 |
| 03·C13 | 38 |
| 03·C14 | 36 |
| 03·J12 | 20–22 |
| 访谈新增：档位名兜底 | 26.4 |
| 访谈新增：CC Switch 镜像服务商 | 17 |

## Further Notes

- **先后**：没有前置任务。子任务 9 排在本任务之后，它的第二层建在第 13–16 条的接法上；ChatGPT 额度用完的处理已记进它的 `prd.md`。子任务 3 做「复制这家接口」时带上第 7 条的字段。
- **写需求时助手新定的几处**（随本文交用户确认）：
  - 第 9 条：没有会搜的接口时回 400 `invalid_request_error`，不用会触发重新登录或重试的状态码。
  - 第 12 条：判断登录方式用临时 app-server 覆盖成内置 openai 服务商再调 `account/read`；打开开关、daemon 启动、读状态时各判断一次。
  - 第 13 条：照 magpie 把 Codex 的模型缓存标成过期，这也是 Osuna 写的一个 Codex 文件。
  - 第 2 条：新功能挂一个新的能力位。
  - 第 34 条：「被绕过」靠 CLI 自己的会话记录与中转站收到的请求对比来判断；检测只在读状态时做。
  - Testing Decisions：新增进程与命令、登录方式两个可替换的适配器；Codex 一次性核实三件事。
- **留到实现时对照 magpie 定的**：用户自己写的 `openai_base_url` 怎么处理（第 13 条）；历史里的 `web_search_call` 项（第 10 条）；搜索工具与结果在 Anthropic、Responses 之间怎么改写（第 9、10 条）；认 Agent 的 User-Agent 规则（第 15 条）；镜像服务商怎么认（第 17 条）；「Codex Subagent 可用任意模型」标 v1 的范围（第 33 条）。结论写进实现记录。
- **要先核实的推断**：Osuna 的 Claude 对话遇到带注释的设置文件会直接走官方（第 24 条，依据 Claude Code 文档）；默认思考档位为 max 时 Osuna 对话会被锁住（第 31 条）；挪过的对话会不会被 Codex 改回（第 22 条）；`openai_base_url` 指向本机且以 `/backend-api/codex` 结尾时，ChatGPT 工作区路由会不会把请求改到 ChatGPT 自己的后端、绕过中转站（第 13 条）。
- **规模**：三十多项决定，用一份需求文档，`/atw-tickets` 切成一组工单，一起验收、一起合并上线（Q36，同子任务 1）。中转站认调用方（第 15 条）、提示区（第 34 条）、默认模型与思考档位（第 29–31 条）是多张工单共用的基础，先做。
- **术语**：「自己能联网搜索」「默认思考档位」「Codex 服务商」在访谈中已写进 `docs/glossary.md`，「默认模型」「使用第三方接口」「中转站」「会话历史」已改写；本文按这些词使用。中文界面里 Subagent 保留英文。
