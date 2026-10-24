# Pi / OMP 用上第三方接口

来源：总任务 [`10-16-magpie-osuna-gaps`](../10-16-magpie-osuna-gaps/prd.md) 的第 6 个子任务。总任务的 Constraints、Implementation Decisions、Testing Decisions 对本任务全部适用，下面只写本任务特有的。访谈的逐条决定与依据见 [`research/decisions.md`](research/decisions.md)（2026-10-24，两轮 Q1–Q12）。

对照基准：magpie `7597c132`（HEAD `dd1e8822` 上 Pi / OMP 接线没变）；Pi 1.4.0（本机 1.3.0）；OMP 18.12.6（本机 17.3.3，Osuna 要求最低 16.3.9）。

差距明细：03·D01, D02；01·A04, B59；02·C16 的 Pi 部分；03·A01, A14, A21 中与 Pi、OMP 有关的部分。

## Problem Statement

用户在 Claude Code、Codex 里已经能用第三方接口（**API endpoint**）：打开「使用第三方接口」（**Use API endpoints**），它们就经过内置中转站（**Gateway**）用上各家中转服务的模型，一家不行自动换下一家（**Failover**）。Pi、Oh My Pi（OMP）却用不上：

- 内置中转站只认 Claude Code 说的 Anthropic 格式和 Codex 说的 OpenAI Responses 格式，Pi、OMP 默认说的 OpenAI Chat 格式一来就回「不支持」。
- Osuna 不读也不改 Pi、OMP 的配置文件，Pi、OMP 的设置页没有「使用第三方接口」，也选不了默认模型（**Default model**）。
- 想让 Pi、OMP 用中转服务，只能自己手写它们的模型配置文件，一家一家地填地址和 key；没有自动切换，用量页也分不出哪些走了哪家接口。
- OMP 能在一台电脑上存多套互不相干的设置（命名配置），还能给小任务、规划、看图等用途各指定一个模型；这些都得手改。

## Solution

Pi 和 OMP 像 Claude Code、Codex 一样用第三方接口：

- 内置中转站多一个 OpenAI Chat 入口。Pi、OMP 打到中转站的请求，和 Claude Code、Codex 的一样会选接口、换真 key、翻译格式、自动切换、记账。
- Pi 的提供方设置页有「使用第三方接口」开关、默认模型、默认思考档位（**Default thinking**）。
- OMP 的提供方设置页按 **OMP 配置**（OMP profile）分块：默认那套一块，每找到一套命名配置多一块。每块有自己的开关、默认模型、默认思考档位和**模型角色**（Model roles）。
- 打开开关后，Osuna 改写 Pi / OMP 自己的全局配置，加一个叫 `osuna` 的服务商，模型显示为 `osuna/<模型>`。在终端里直接跑 `pi`、`omp` 开新会话也走中转站。
- 关掉开关前先列出会改回什么，关掉后放回原样；开着期间用户在 Pi / OMP 里自己改过的保留。
- 经过中转站的 Pi / OMP 调用按中转站账本记一次，用量页不算两遍，并按接口分开。

## User Stories

### 中转站的 Chat 入口

1. 作为 Pi 用户，我希望内置中转站收 OpenAI Chat 格式的请求，以便 Pi 用它默认的格式就能经过中转站。
2. 作为 OMP 用户，我希望同样能用 Chat 格式经过中转站，以便和 Pi 一样。
3. 作为用户，我希望 Chat 入口和现有入口一样只收本机请求，以便别的机器、网页拿不到我的接口。
4. 作为用户，我希望 Chat 请求也会在多家接口间自动切换、冷却和粘在同一家，以便 Pi / OMP 和 Claude Code 一样稳。
5. 作为用户，我希望中转站把 Chat 请求翻译成接口支持的格式（Anthropic、Responses、Chat），以便只有 Anthropic 地址的接口也能给 Pi 用。
6. 作为用户，我希望中转站把回复按 Chat 格式流式回给 Pi / OMP，包括思考、工具调用和用量，以便 Pi / OMP 照常显示。
7. 作为 Pi 用户，我希望 Pi 在对话中途新加的工具被中转站挪到请求的工具清单里，以便新工具能被模型调用、只认标准写法的中转服务不报错。
8. 作为用户，我希望 Pi / OMP 发的 `developer` 角色在转给只认 `system` 的中转服务时被改成 `system`，以便请求不被拒绝。
9. 作为用户，我希望 Chat 请求被拒、被拒答、上游断流时，Pi / OMP 收到 Chat 格式的明确错误，以便知道发生了什么。
10. 作为用户，我希望中转站从 Pi / OMP 发的会话编号认出同一个对话，以便这个对话一直走同一家、提示缓存不白写。
11. 作为用户，我希望中转站凭 Pi、OMP 各自的中转站口令认出是谁在请求，以便记账时分得清 Pi 和 OMP。

### Pi 的开关与默认设置

12. 作为 Pi 用户，我希望在 Pi 的设置页打开「使用第三方接口」，以便 Pi 用上第三方接口的模型。
13. 作为 Pi 用户，我希望打开后 Pi 的模型列表里出现 `osuna/<模型>`，以便在 Pi 自己的 `/model` 里也能挑。
14. 作为 Pi 用户，我希望 Pi 能选的模型和 Codex 的 `/model` 一样（开着的接口里选中的模型，按「接口名显示方式」显示接口名），以便四家看到同一份清单。
15. 作为 Pi 用户，我希望选一个默认模型，以便终端里的新会话和 Osuna 里没有记住上次选择的新对话直接用它。
16. 作为 Pi 用户，我希望选一个默认思考档位，以便新会话从这一档起步。
17. 作为在 Pi 里设过启用模型清单的用户，我希望 Osuna 把默认模型放到清单最前面，以便默认模型真的生效（Pi 新会话先用清单里的第一个）。
18. 作为没设过启用模型清单的 Pi 用户，我希望 Osuna 不替我新建这个清单，以便 Pi 的其他模型照常可选。
19. 作为 Pi 用户，我希望 Osuna 给每个模型写对上下文、回复上限、能否看图和可用的思考档位，以便 Pi 不发出会被拒绝的参数。
20. 作为 Pi 用户，我希望模型没有的思考档位在 Pi 里选不到，以便不因为选了一档而被中转服务拒绝。
21. 作为 Pi 用户，我希望 Osuna 按模型选对 Pi 跟中转站说话的格式（默认 Chat，GPT 一类可走 Responses，Claude 可走 Anthropic），以便少翻译一层、思考和缓存更不容易出岔子。

### OMP 的开关、默认设置与模型角色

22. 作为 OMP 用户，我希望在 OMP 的设置页打开「使用第三方接口」，以便 OMP 用上第三方接口的模型。
23. 作为 OMP 用户，我希望选默认模型和默认思考档位，以便 OMP 的新会话直接用上。
24. 作为 OMP 用户，我希望打开开关只改 OMP 的「默认」角色，其余角色空着交给 OMP 自己挑，以便不打乱我原来的安排。
25. 作为 OMP 用户，我希望在「模型角色」里给 Subagent、小任务、难题、规划、看图、顾问、提交说明、极小任务、记忆各选一个第三方接口的模型，以便不同用途用不同的模型。
26. 作为 OMP 用户，我希望每个角色还能单独设思考档位，以便难题想得深、小任务答得快。
27. 作为 OMP 用户，我希望每个角色旁边写着空着时跟谁，以便知道不设会用什么。
28. 作为 OMP 用户，我希望把某个角色清空就交还给 OMP 自己，以便随时撤回。
29. 作为在 Osuna 配置里给 OMP 手写过小任务、难题、规划模型的用户，我希望在 Osuna 里开的 OMP 对话仍以我手写的为准，以便我明确指定的不被覆盖。

### OMP 配置（命名配置）

30. 作为用 `omp --profile work` 的用户，我希望 OMP 设置页自动列出 work 这套配置，以便不用手动登记。
31. 作为这样的用户，我希望每套配置有自己的开关、默认模型、思考档位和模型角色，以便工作和个人用不同的接口安排。
32. 作为用户，我希望新找到的配置默认关着，以便 Osuna 不擅自改我没让它改的配置。
33. 作为用户，我希望关掉某一套只还原那一套，以便其他套不受影响。
34. 作为写过「自定义提供方」让 Osuna 在 work 配置里开 OMP 的用户，我希望这个提供方跟着 work 那一块的设置走，以便不用再设一遍。
35. 作为用户，我希望当前环境已经指向的那套配置不被重复列出，以便不出现两块管同一份文件。

### 终端、还原与提示

36. 作为在终端里直接跑 Pi / OMP 的用户，我希望打开开关后新会话也走第三方接口，以便和在 Osuna 里一样。
37. 作为用户，我希望关掉开关之前看到会改回什么，以便放心操作。
38. 作为用户，我希望关掉后 Pi / OMP 的默认模型、默认角色、启用模型清单、思考档位回到我原来的设置，`osuna` 服务商被删掉，以便回到它们自己的设置。
39. 作为用户，我希望开着期间我在 Pi / OMP 里自己改过的设置在关掉时保留，以便 Osuna 不覆盖我的改动。
40. 作为用户，我希望 Osuna 只动它自己写的那些键，我在 Pi / OMP 配置里写的别的东西原样保留，YAML 文件的注释和写法不变，以便配置文件不被弄乱。
41. 作为用户，我希望 Pi / OMP 的配置文件解析不了时 Osuna 不写、并告诉我哪个文件有问题，以便不把坏文件弄得更坏。
42. 作为用户，我希望再次打开开关时放回我上次用的模型和角色，以便来回切换不用重选。
43. 作为在 Pi / OMP 自己的模型选择里把默认换成另一个第三方接口模型的用户，我希望 Osuna 的默认模型跟着变，以便两边一致。
44. 作为把 Pi / OMP 默认换成接口以外的模型、或被别的程序改过配置的用户，我希望 Osuna 像对 Claude Code、Codex 一样提示并让我处理，以便不被悄悄覆盖。
45. 作为开着 Pi / OMP 对话的用户，我希望改了设置后看到哪些对话要重开才生效，以便知道下一步做什么。
46. 作为用户，我希望 Osuna 里给 Pi / OMP 开新对话时，模型选择里出现第三方接口的模型，以便不用重启 Osuna。

### 用量

47. 作为用户，我希望 Pi / OMP 经过中转站的调用按中转站账本记一次、不再从对话记录里算第二遍，以便用量页数字可信。
48. 作为用户，我希望用量页把 Pi / OMP 走官方和走各家接口的用量分开，以便知道钱花在哪家。
49. 作为用户，我希望 Pi / OMP 的请求出现在「请求」列表和接口页的「最近异常」里，以便查问题。
50. 作为在终端里直接跑 Pi / OMP 的用户，我希望这些经过中转站的调用也记进账，以便不在 Osuna 里开的会话也算进去。

### 跨部分

51. 作为用官方 Paseo 手机 App 的用户，我希望升级后手机照常能用，以便不受这次改动影响。
52. 作为连着旧 daemon 的新 App 用户，我希望 Pi / OMP 的设置页不出现用不了的开关，以便不点了才发现不支持。
53. 作为用别的界面语言的用户，我希望新文字在 9 种界面语言里都有，中文界面全是中文。
54. 作为用户，我希望 Osuna 写进 Pi / OMP 配置的只有它自己的身份，不冒充别的软件，以便不额外增加风险。

## Implementation Decisions

### 中转站：Chat 入口

- 入口表加 `POST /v1/chat/completions`，请求格式为 OpenAI Chat。和现有两个入口一样：只收本机回环、不带转发头的请求，网页来的回 403（ADR 0007、0010）。Chat 的解析器、回复编码器、错误形状已有，复用；不另写翻译。
- **认调用方**：Pi / OMP 会按模型打三个入口中的任意一个，所以认 Agent 靠中转站口令，不靠路径。口令对不上时照 ADR 0010 按 User-Agent 认；Chat 入口仍认不出时按 Pi 记，和 Anthropic 入口认不出时按 Claude Code 记同理。
- **按入口的格式取思考参数**：给请求补推理档位时，按这次请求所在入口的格式，不按「Agent 默认格式」。Pi 打 Chat、Responses、Anthropic 三个入口都要对。
- **Pi 中途加的工具**（01·B59，照 magpie `message_tools.go`）：Chat 请求里只装工具、没有内容的 system / developer 消息，其工具按名字去重并入顶层 `tools`，这条消息丢掉。
- **`developer` 角色**：直转给 Chat 上游时改成 `system`（照 magpie）；翻译成别的格式时照现有翻译处理。
- **会话粘性**：中转站认得的会话头加上 `x-session-affinity`（Pi 的 Chat / Anthropic、OMP 都发它）；现有的 `session_id`、`x-client-request-id` 已经覆盖 Pi 的 Responses。
- **账本**：账本的 Agent 取值扩到 Pi、OMP。Chat 回复的回复编号是写回给 Pi / OMP 的 Chat `id`（子任务 5 的账本字段说明）。
- 借鉴 magpie 的文件顶上保留 MIT 声明，`THIRD_PARTY_NOTICES` 补上新借鉴的文件。

### 提供方与设置

- 支持第三方接口的提供方从「Claude Code、Codex」扩到「Claude Code、Codex、Pi、OMP」。服务端、协议、App 里写死两家的清单和按两家穷举的表都要扩，编译器会逐处报出来。继承 `pi` 的自定义提供方（Pi 分支程序）不接。
- **每个 Agent 的设置**沿用 `agents.<键>` 那份记录：
  - Pi 的键是 `pi`。
  - OMP 默认那套的键是 `omp`；命名配置的键由 `omp` 加配置名组成，在实现里定具体写法，保证不和提供方 id 撞名。
  - 线上 schema 已经是「字符串 → 设置」的映射，新键不用改形状。
- Pi / OMP 用到的字段：`enabled`、`defaultModelId`、`defaultThinkingOptionId`。OMP 新增一个可选字段「模型角色」：每个角色一个模型取值（同 `defaultModelId` 的写法）和一个思考档位，没有即为空。只对 Claude Code、Codex 有意义的字段（保留 claude.ai 登录、Ultra Code、后台小任务模型、Subagent 模型、记忆模型等）Pi / OMP 不用。
- **列出 OMP 配置**：daemon 扫 OMP 根目录（`~/.omp`，或 `PI_CONFIG_DIR` 给的名字）下 `profiles/<name>/agent`，名字规则照 OMP（照 magpie `omp.go:92-107`）。daemon 环境里 `OMP_PROFILE` / `PI_PROFILE` 已经指向的那套就是「默认」块管的目录，不另列一块。扫到的列表随设置一起返回（可选新字段）。
- **自定义提供方跟随**：继承 `omp`、在 `env` 里给了 `OMP_PROFILE` 的自定义提供方，用那一套的设置，不单独出现开关。
- **口令**：Pi、OMP 各一个中转站口令，和现有两家一样生成、关开关不作废。OMP 各套配置共用 OMP 的口令。
- **能打开的条件**同现有：至少一家接口开着且选了模型，daemon 在 TCP 上监听。

### 写进 Pi 配置的内容

目录照 Osuna 现有的 Pi 规则：daemon 环境的 `PI_CODING_AGENT_DIR`，否则 `~/.pi/agent`。

- `models.json`：加 `providers.osuna`。
  - `baseUrl` 指向中转站的 `/v1`，`api: "openai-completions"`，`apiKey` 写 Pi 的中转站口令（字面值，口令不以 `$` 或 `!` 开头）。
  - `compat.sendSessionAffinityHeaders: true`；用户自己在这一项里设过的 `compat` 值保留。
  - `models`：清单同 Codex 的 `/model`。每个模型写 `id`、`name`（按「接口名显示方式」带接口名）、`reasoning`、`thinkingLevelMap`、`contextWindow`、`maxTokens`、`input`、`cost`，取值来自模型设置（**Model settings**）的结果，只写已知的。
    - `thinkingLevelMap` 把 Pi 的 7 档都列出，模型没有的档写 `null`。
    - 回复上限不超过上下文。
    - 只接受自适应思考的 Claude 写 `compat.forceAdaptiveThinking`。
    - `promptCache`：Claude 走 Anthropic 时 300 / 3600，GPT 走 Responses 时 300。
    - 以上照 magpie `agents.go:519-590`。
- `settings.json`：
  - `defaultProvider: "osuna"`，`defaultModel` 为默认模型。
  - 设了默认思考档位才写 `defaultThinkingLevel`。
  - `enabledModels` 已存在时，把默认模型放到最前（比 magpie 多做，Q5）；没有就不建。
- **每个模型的格式**（Q3，照 magpie `route.go:167-207`）：
  - 默认 Chat。
  - GPT 系模型：某家接口的模型，那家有 Responses 地址就走 Responses；裸名要所有提供它的接口都有 Responses 地址才走 Responses。
  - Claude 模型：某家接口的模型，那家有 Anthropic 地址就走 Anthropic，`baseUrl` 写中转站根地址。
  - 其余不写 `api`，沿用服务商级的 Chat。
  - 「只用这种格式」钉在某种格式上的模型，按钉的格式走。

### 写进 OMP 配置的内容

每套配置一个目录：默认那套照 Osuna 现有的 OMP 目录规则，命名配置是 `profiles/<name>/agent`。

- `models.yml`（只有 `models.yaml` 时用它）：加 `providers.osuna`。
  - `baseUrl`、`api: openai-completions`、`apiKey` 写 OMP 的中转站口令；`auth: apiKey`，以免 OMP 把自定义 Anthropic 服务商当 OAuth。
  - `compat.promptCacheSessionHeader: x-session-affinity`。
  - `models` 同 Pi 的清单与格式规则，思考写成 `thinking: {mode, efforts}`：
    - 只接受自适应思考的 Claude 用 `anthropic-adaptive`；
    - 其他走 Anthropic 的模型用 `budget`；
    - 其余用 `effort`。
  - OMP 早于 16.4.0 或版本未知时，`max` 降为 `xhigh`（照 magpie `omp.go:597-625`）。
  - 用户在这一项里写的 `modelOverrides`、`discovery`、`disableStrictTools`、`remoteCompaction`、自己加的请求头和 `compat` 保留（照 magpie `omp.go:687-697`）。
  - 只有旧的 `models.json`、没有 YAML 时，先照 OMP 自己的迁移转成 `models.yml` 再写（照 magpie `omp.go:205-246`）。
- `config.yml`：
  - `modelRoles.default` 写默认模型；
  - 设了角色才写对应的 `modelRoles.<role>`（带思考档位时写成 `osuna/<模型>:<档位>`）；
  - 设了默认思考档位才写 `defaultThinkingLevel`；
  - `enabledModels` 规则同 Pi。
  - 角色键照 OMP：`default`、`task`（界面叫 Subagent）、`smol`、`slow`、`plan`、`vision`、`advisor`、`commit`、`tiny`、`memory`。
- **不写 User-Agent**：magpie 给 OMP 写 `User-Agent: omp` 以便认人，Osuna 凭口令认，不写（总任务第 15 条，身份如实）。
- **Osuna 启动 OMP 时**，Osuna 配置里手写的 `smolModel` / `slowModel` / `planModel` 仍作为启动参数传入，优先于 `config.yml` 的角色；终端不受影响。

### 改写规则与还原

- ADR 0004 / 0012 的规则全部适用于 Pi 的两个文件和每套 OMP 配置的两个文件：
  - 只动自有键；记录原值并恢复；第一次改写前留完整副本；
  - 原子替换；写前重读、变了重算；解析不了就不写；
  - 读状态时检测外部改动。
- 每个文件一份接管记录，和 Claude Code、Codex 的接管记录并列。
- JSON 用保留注释与格式的方式改。YAML 按节点改，保留注释、列表的 flow / block 写法和用户的其他键。
- **关开关**：
  - 先列出会改回什么（现有的关前预览）。
  - 然后放回原值：Pi 的 `defaultProvider` / `defaultModel` / `defaultThinkingLevel`，OMP 的各个 `modelRoles` / `defaultThinkingLevel`；`enabledModels` 挪回或删掉 Osuna 加的条目，删空的列表整个删掉。
  - 最后删 `providers.osuna`。
  - 开着期间用户自己改过的键保留。
  - OMP 只要还有别的角色或别的地方用着 `osuna/`，就保留服务商（照 magpie `dropMagpie`）。
- **再打开**：放回上次走中转站时的默认模型与角色（现有 reconnect 做法）。
- **跟随与漂移**：
  - 用户在 Pi / OMP 里把默认存成另一个 `osuna/` 模型，Osuna 的默认模型跟着变。
  - 改成接口以外的模型，或文件被别的程序改过，按 Claude Code、Codex 现有的外部改动 / 被绕过提示处理。
- **同步**：接口、选中模型、模型设置、「接口名显示方式」、已下线模型一变，就重写所有开着的 Pi / OMP 配置里的 `models` 清单。默认模型或角色指向的模型不再提供时，照现有默认模型的处理。
- **要重开的对话**：Pi、OMP 加进现有「哪些对话要重开」提示。Pi、OMP 的 RPC 模式在会话开着时不重读模型文件，OMP 的 `config.yml` 会重读但不换正在跑的会话的模型。
- **Osuna 自己的模型清单**：设置改写后，刷新 Osuna 里 Pi / OMP 的模型清单，新对话的模型选择里马上出现 `osuna/` 模型；新对话没有记住上次选择时用默认模型。

### 用量对账

- 照 ADR 0014 与子任务 5 的 Pi / OMP 规则：
  - 会话记录里的条目按回复编号能对上账本的，合并后只算一次；
  - 对不上且条目的 provider 是 `osuna` 的，跳过，只算账本。
- 读 Pi / OMP 会话记录时，回复编号改用记录里的 `responseId`；现在用的「会话 id / 条目 id」对不上账本。没有 `responseId` 的老记录照旧。
- Pi 的 `usage` 条目、OMP 的 `model_usage` 条目，provider 是 `osuna` 的同样按上面的规则处理。

### 协议与兼容

- 新功能挂在一个新的 `server_info.features.*` 上；新 App 只有看到它才给 Pi / OMP 显示第三方接口设置。旧 daemon 不发，App 就不显示。
- 新字段（OMP 的模型角色、OMP 配置列表）都是可选的；不新增 RPC，沿用现有的读写 Agent 设置、关前预览、要重开提示等 RPC，provider 取值多了 `pi`、`omp` 和 OMP 配置的键。
- 官方 Paseo 手机 App 与旧客户端照常工作，看不到 Pi / OMP 的新设置；ADR 0007 给旧客户端的「单个启用接口」投影不变。

### 文档与术语

- `docs/glossary.md` 已在访谈时更新：新增「OMP profile」「Model roles」；「API endpoint」「Gateway」「Use API endpoints」扩到 Pi、OMP。实现完再核对 Default model、Default thinking、Compact at、Long conversations、Full window、Test models 等条目，把「Claude Code and Codex」的说法改对。Compact at 等对 Pi / OMP 不适用的，写明只对 Claude Code、Codex。
- ADR：
  - 0004：管理的文件扩到 Pi、OMP。
  - 0007：「Claude gets … Codex gets …」处补上 Pi、OMP 走 Chat 入口。
  - 0010：Chat 入口与按口令认 Pi / OMP。
  - 0012：情况表补上 Pi、OMP。
  - 0014：Pi / OMP 规则的服务商名定为 `osuna`。
  - 这些改动在原文里直接改正，不另写新 ADR：没有被推翻的决定。
- `docs/usage.md` 的用量来源与 Pi / OMP 对账；`docs/custom-providers.md` 的「OMP profiles」一节写明自定义提供方跟随对应配置块的设置。

## UI and Design

- **方向**：沿用 Claude Code、Codex 提供方设置页里现有的「使用第三方接口」一块（开关、默认模型、默认思考档位），不另做样式。遵守 `docs/design.md`、`docs/forms.md`、`docs/hover.md`、`docs/unistyles.md`、`docs/menus.md`、`docs/i18n.md` 与 `.atw/spec/app/frontend/`。
- **用户定过的偏好**：开 / 关一律用 Switch；模型名不用等宽字体；次要操作不用蓝色链接。
- **Pi 设置页**：「使用第三方接口」开关、默认模型、默认思考档位，与 Claude Code、Codex 的同一块一样。
- **OMP 设置页**：「使用第三方接口」分成几块，块标题依次为「默认」和每套命名配置的名字。
  - 每块有开关、默认模型、默认思考档位和「模型角色」区。
  - 「模型角色」区列 9 个角色，每个角色一行：显示「中文名（OMP 原名）」，有模型选择和思考档位选择，下面一行灰字说明空着时用什么（照 magpie：Subagent、小任务、难题跟默认模型；规划、看图由 OMP 自己挑；顾问跟难题的模型；提交说明、极小任务跟小任务的模型；记忆跟极小任务的模型）。
  - 选了模型的角色可以清空。
  - 只有默认那套时不显示块标题。
- **状态**：
  - 打开、关掉、改默认模型、改角色都可能失败（配置文件解析不了、写入冲突、没有可用接口）。失败信息留在那一块里，直到重试或关掉；成功后显示现有的「哪些对话要重开」提示。
  - 关掉前弹出现有的改回预览，列出 Pi / OMP 配置里会改回的键。
  - 没有开着的接口或没选模型时，开关不可打开，并说明原因（同现有）。
  - 配置列表加载中显示加载状态；OMP 没有命名配置时只显示默认块。
- **视口**：桌面端宽 1280（Electron 与浏览器），窄窗口宽 390。原生端免实机验收。
- **界面验收**（看截图就能判断）：
  - Pi 设置页在 1280 和 390 下都能看到「使用第三方接口」开关、默认模型、默认思考档位，开关是 Switch。
  - OMP 设置页有两套配置时，两块各有标题「默认」和配置名，各自的开关独立。
  - 「模型角色」区 9 行，中文界面显示「小任务（smol）」这样的名字，每行有说明，模型名不是等宽字体。
  - 关开关前的预览里列出 Pi / OMP 的具体设置项。
  - 失败时错误信息留在出错的那一块里。
  - 中文界面没有残留英文；英文界面没有露出的翻译键名。
  - 宽 390 下，开关和保存类操作不被遮住。

## Testing Decisions

- **好测试的标准**：只测外部看得到的行为，包括 Pi / OMP 收到什么、上游收到什么、配置文件被改成什么、RPC 返回什么、界面显示什么；不测内部结构。确定性要求见 `docs/testing.md`。
- **接缝一（主）：daemon 端到端测试**，在现有 daemon 端到端目录里各加一组 Pi、OMP 的测试，先例是 Claude Code、Codex 的接口接入测试和中转站测试。测试进程内启动真实 daemon，本机起假上游。Pi / OMP 的配置目录指向临时目录（`PI_CODING_AGENT_DIR`，以及让 OMP 根目录落在临时目录里）。
  - 用 fetch 带 Pi / OMP 的口令打 Chat、Responses、Anthropic 三个入口，检查：上游收到的请求；回给 Pi / OMP 的 Chat 流（含思考、工具调用、用量）；中途加的工具被提升；`developer` 改成 `system`；会话头带来的粘性；一家失败时的自动切换；口令认出 Pi 和 OMP。
  - 通过 RPC 打开、关掉开关，改默认模型、思考档位、OMP 角色，检查 Pi 的 `models.json` / `settings.json`、每套 OMP 的 `models.yml` / `config.yml` 的内容，以及关掉后还原的结果：用户自己的键保留、`enabledModels` 挪回、删空的列表删掉、解析不了不写。
  - OMP 命名配置：临时目录里放两套配置，检查列表、各自开关互不影响、当前已指向的那套不重复列出。
  - 用量：假的 Pi / OMP 会话记录与经过中转站的请求同时存在，读用量 RPC，检查同一调用只算一次、`osuna` 条目对不上时被跳过、按接口分开。先例是中转站账本的用量测试。
- **接缝二：app 浏览器测试**，往第三方接口设置页的浏览器测试里加用例，或在同目录加 Pi / OMP 的一组；用 Playwright、真实 daemon、本机假中转服务。Pi / OMP 配置目录指向临时目录，绝不碰真实的 `~/.pi`、`~/.omp`。
  - 覆盖 Pi 的开关、默认模型、默认思考档位；OMP 两套配置的分块、模型角色的选择与清空；关前预览；每个会失败的操作都测成功和失败两种情况。
  - 浏览器测试里的 daemon 不能真的去升级 Pi / OMP。
- **已有的纯逻辑套件继续加用例**：
  - Chat 翻译套件：提升工具、`developer` 改写。
  - 中转站粘性套件：`x-session-affinity`。
  - Pi / OMP 用量解析套件：`responseId`、`osuna` 跳过。
  - 合并对账套件。
  - Pi / OMP 配置改写的细则（`enabledModels` 挪动与挪回、YAML 写法保留、每个模型的格式与思考档位、OMP 旧版本的 `max` 降级、旧 `models.json` 迁移）：照 Claude Code、Codex 配置改写套件的先例，与它们并列加 Pi、OMP 的套件，不另加 npm 脚本或 CI 任务。
- **不连真实中转服务、不运行真的 Pi / OMP**：所有上游都是本机假服务，Pi / OMP 由测试程序扮演。
- **本机只跑改到的测试文件**，全量交给 CI。
- 做会改写真实 Pi / OMP 配置的界面验收前，先向用户说明怎么隔离，取得同意再做。

## Out of Scope

- Pi、OMP 以外的 Agent，包括继承 `pi` 的自定义提供方（Pi 分支程序）。
- Chat 以外的新入口（总任务 Out of Scope 的块 10）。
- 按提供方隐藏模型（magpie 每个 Agent 各挑模型进列表）：以后四家一起加，已记进总任务 Out of Scope。
- Gemini 格式：子任务 7 做，届时 Pi / OMP 也能用 Gemini 格式的接口。
- 「按 Pi / OMP 的样子测模型」（类似 Test as Claude Code / Codex）。
- 手动编辑 CLI 配置文件的界面。
- WSL、局域网共享密钥（magpie 的 WSL 接法）。
- 让 Osuna 在某套 OMP 命名配置里开对话的界面：仍用手写的自定义提供方。
- Compact at、长对话、完整窗口对 Pi / OMP 不生效（Pi / OMP 自己按上下文压缩）。

## Acceptance Criteria

- [x] 内置中转站收 `POST /v1/chat/completions`：只收本机请求；Pi、OMP 的口令各自认得出；请求能翻译到 Anthropic、Responses、Chat 三种上游；流式回复含思考、工具调用和用量；失败会自动切换。
- [x] Pi 中途加的工具被提升到顶层；`developer` 角色在直转 Chat 时改成 `system`；带 `x-session-affinity` 的同一对话粘在同一家。
- [x] Pi 设置页打开开关后，临时目录里 Pi 的 `models.json` 有 `providers.osuna`，模型清单同 Codex，每个模型的格式、上下文、思考档位按本文规则；`settings.json` 的默认模型与思考档位正确；已有的 `enabledModels` 把默认模型放在最前。
- [x] OMP 两套配置各自打开、关掉互不影响；`models.yml`、`config.yml` 写法正确；9 个角色可设、可清空，带思考档位；不写 User-Agent。
- [x] 关掉开关前预览列出会改回的键；关掉后 Pi / OMP 配置回到原样，开着期间用户自改的键保留，用户原有的其他键与 YAML 写法不变；解析不了的文件不写并报出文件名。
- [x] 在 Pi / OMP 里把默认换成另一个 `osuna/` 模型，Osuna 的默认模型跟着变；换成接口以外的模型时出现与 Claude Code、Codex 相同的提示。
- [x] Pi / OMP 开着的对话出现在「要重开」提示里；Osuna 新对话的模型选择里出现 `osuna/` 模型。
- [x] 用量：经过中转站的 Pi / OMP 调用只算一次，按接口分开；`osuna` 条目对不上时被跳过；终端里直接跑的 Pi / OMP 调用记进账本。
- [x] 协议：新功能挂在 `server_info.features.*` 上，新字段可选；旧 daemon 下新 App 不显示 Pi / OMP 的第三方接口设置；官方 Paseo 手机 App 照常工作。
- [x] 界面验收（UI and Design 一节）逐条有截图；9 种语言的 i18n 测试通过。
- [x] 文档：`docs/glossary.md` 相关条目已核对；ADR 0004、0007、0010、0012、0014 在原文中补上 Pi / OMP；`docs/usage.md`、`docs/custom-providers.md` 已更新；`THIRD_PARTY_NOTICES` 覆盖新借鉴的 magpie 文件。
- [ ] typecheck、lint 通过；改到的测试文件本机通过；PR 的 CI 通过（已知常红的 Nix 两项除外）。

## Further Notes

- **先后**：排在子任务 5 之后（按它的对账规则）；子任务 7（Gemini 上游）排在本任务之后，届时 Pi / OMP 也要能用 Gemini 格式的接口。子任务 9 不依赖本任务。
- **版本差异**（来自 Pi / OMP 源码）：
  - Pi 的 `apiKey` 写裸环境变量名会被当成字面值；OMP 会先当环境变量名去查。口令是随机串，两边都按字面值用。
  - Pi 新会话先用 `enabledModels` 的第一项，压过默认模型。
  - Pi / OMP 的 RPC 模式都不重读模型文件。
  - OMP 自定义 Anthropic 服务商不写 `auth` 时按 OAuth 组装请求。
- **本机已有的 Pi / OMP 配置**：本机的 `~/.pi/agent`、`~/.omp/agent` 里已有用户的 `models.json` / `models.yml`，助手没有读过内容。界面验收用临时目录，涉及真实配置的验收由用户自己做或先取得同意。
- **参考源码**：magpie `7597c132` 在 `/tmp/magpie-7597`，Pi 源码在 `/tmp/pi-mono-src`，OMP 源码在 `/tmp/omp-src`，都是只读的临时克隆。
- **待另开工单**（工单 02 审查，用户 2026-10-24 决定）：设置页「已更新 just now」的相对时间来自全应用共用的英文时间工具，中文界面露出英文；不在本任务改，另开工单做时间文字本地化。
- **验收时记下的后续事项**（2026-10-24，不在本任务改）：关开关预览弹窗中文标题「关闭 Oh My Pi 的第三方接口?」用了半角问号；以下只有代码、没有专门测试：`PI_CONFIG_DIR` 指定的 OMP 根目录、`PI_PROFILE` 指向的那套并入「默认」、命名配置按套随接口同步、advisor / commit 两个角色的写入。思考档位名（High、Off 等）用户决定保留英文。
- **待另开工单**（PR #29 的 CI，用户 2026-10-24 决定）：Windows CI 上价格表（models.dev）更新后 Pi 的 `models.json` 没被改写，Mac、Linux 正常；原因未查清，`api-endpoint-pi.e2e.test.ts` 的这一条先在 Windows 上跳过。Codex / Claude 的同类测试本来就不在 Windows 上跑，这条后台改写在 Windows 上从没被测过。
