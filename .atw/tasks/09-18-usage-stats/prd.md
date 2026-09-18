# 本机会话 token 用量与估算成本统计

术语按 `docs/glossary.md`：**Usage / Usage source / Usage bucket / Turn / Turn usage / Backing sessions / Backfill / Plan usage / Estimated cost / Price table / Custom price**。本文中「来源」= Usage source，「桶」= Usage bucket，「轮」= Turn，「回填」= Backfill，「套餐用量」= Plan usage，「估算成本」= Estimated cost，「价格表」= Price table，「自定义价格」= Custom price。

决策来源：三轮访谈（`research/interview-decisions.md`）与 15 张已解决的决策票（`map.md` → `map-issues/`）。本文是这些决策的收敛版；两者冲突时以本文为准，本文未提及的细节以票为准。

## 问题陈述

用户在一台或多台主机上用 Claude Code、Codex、Pi、OMP 跑了大量会话，有些是 Paseo 发起的，更多是在终端里直接跑的。他们不知道这些会话一共消耗了多少 token、按公开 API 价格折算值多少钱、花在哪个项目和哪个模型上、哪天用得最凶。Paseo 现在只在 composer 的上下文环形表里显示当前会话的上下文占用和一个粗略成本，daemon 重启就归零，也不覆盖 Paseo 之外的会话；套餐用量（订阅配额）藏在主机设置页里，与 token 消耗没有放在一起看。

## 解决方案

daemon 直接解析四个 CLI 留在本机的会话日志，把每条 assistant 消息的五列 token 归到 (来源, 模型, 会话, 目录, 15 分钟 UTC 桶)，把每轮的 token 另存一份，估算成本在查询时按当前价格表现算。app 侧新增侧栏项「用量」，页面照搬参考项目 TokenTracker 的仪表盘布局：周期选择、72px 大数字、来源卡片、Top 模型、趋势、热力图、每日明细可展开到会话行、按月汇总、项目 Top 10，并把套餐用量卡片搬进来；多台主机的数据在客户端相加。会话内两处：turn footer 在 "Worked for" 后追加本轮 token 与估算成本，上下文环形表旁显示「已用 / 上限」文字并在弹层里给出本会话合计。价格表内置 LiteLLM 快照、每天自动更新、可按模型填自定义价格；这一区块放在主机设置页原来套餐用量的位置。全部新文案接入 9 种语言。

## 用户故事

### 采集与覆盖

1. 作为一名同时在终端和 Paseo 里跑 agent 的开发者，我希望「用量」页统计主机上该 CLI 的**全部**会话，而不只是 Paseo 发起的那些，这样我看到的是真实总消耗。
2. 作为开发者，我希望 Claude Code、Codex、Pi、OMP 四家的会话都被统计，这样不必换工具就能对比。
3. 作为 Pi 或 OMP 用户，我希望用量按路由到的后端（Anthropic、OpenAI、Ollama…）拆开显示，这样能看出每个后端各花了多少，因为它们的价格不同。
4. 作为开发者，我希望首次以带此功能的版本启动 daemon 时，历史日志被**全部**回填，这样过去几个月的用量马上可见，不用从零开始积累。
5. 作为开发者，我希望回填在后台低优先级进行、最近的日子先补齐，这样打开页面几秒内就能看到近期数据，而 daemon 不会卡住。
6. 作为开发者，我希望回填有进度显示，这样知道数据什么时候算完整。
7. 作为开发者，我希望 daemon 重启后回填从上次停下的地方继续，而不是重头再扫一遍。
8. 作为在 Paseo 里跑 agent 的用户，我希望一轮结束后几秒内本轮的 token 就出现在 footer 上，这样不必等周期扫描。
9. 作为在终端里跑 agent 的用户，我希望我的会话在一分钟内出现在「用量」页，这样页面反映的是当前状态。
10. 作为开发者，我希望没装某个 CLI 的机器上功能照常工作，只是该来源为空，而不是报错。
11. 作为开发者，我希望同一响应在日志里被拆成多行、resume 复制的旧历史、OMP 分支复制的父条目都**不被重复计数**，这样总数可信。
12. 作为开发者，我希望子代理（Claude subagents、Pi/OMP tasks、Codex 子线程）的 token 计入父会话，这样用 Task 工具的会话不会少算。
13. 作为开发者，我希望子代理不算作独立的轮，这样轮次数反映的是我发过的消息数。

### 「用量」页

14. 作为开发者，我希望侧栏有一个「用量」项，可以像其他侧栏项一样在外观设置里显示或隐藏。
15. 作为开发者，我希望按日 / 周 / 月 / 总计 / 自定义区间切换周期，并用 ‹ › 翻到上一个 / 下一个周期。
16. 作为开发者，我希望周期与热力图都以**周一**为一周的起点。
17. 作为开发者，我希望看到周期内的 token 总数（千分位）与估算成本，并清楚标注「估算 · 按公开 API 价格计算」。
18. 作为开发者，我希望看到来源分布条与来源卡片（图标、名称、占比、模型数），首张是「全部」。
19. 作为开发者，我希望点一张来源卡片展开该来源的模型明细（名称、tokens、估算成本、占比），再点收起。
20. 作为开发者，我希望统计面板显示近 7 天、近 30 天、30 天内活跃日均、会话数，以及 Top 3 模型、首个活跃日、活跃天数。
21. 作为开发者，我希望热力图固定显示最近 26 周（手机 20 周），与周期选择无关，悬停格子看到日期与 token 数。
22. 作为开发者，我希望趋势图按来源堆叠，可切换为按模型堆叠；日周期按小时、周 / 月 / 自定义按天、总计按月一柱。
23. 作为开发者，我希望每日细目表列出每天的总计 / 输入 / 输出 / 缓存 / 推理 / 会话 / 估算成本，点一行展开当天的会话列表。
24. 作为开发者，我希望会话行显示来源、标题、项目、模型、时间、时长、↑↓缓存明细、Token / 成本 / 轮次，并有「打开」按钮。
25. 作为开发者，我希望点会话行的「打开」时，已导入的会话直接打开对应 agent，其他会话像 Session history 一样在终端里 resume。
26. 作为开发者，我希望 Claude 的一条 resume 链显示为**一个**会话，而不是每次 resume 一行。
27. 作为开发者，我希望按月汇总表列出每月的总计 / 输入 / 输出 / 缓存 / 会话 / 估算成本。
28. 作为开发者，我希望项目用量列出 Top 3 / 6 / 10 项目，非 git 目录带标签，点一行展开到具体 cwd。
29. 作为开发者，我希望套餐用量卡片在「用量」页左列底部，与 token 消耗放在一起看，主机设置页不再显示它。
30. 作为开发者，我希望无价格的模型在成本处显示 `$0.00` 并带「无价格数据」标签，汇总卡片提示「N 个模型无价格数据」并可跳到价格表。
31. 作为开发者，我希望页面在回填期间照常可用，只在总览头部看到一枚「回填中 M / N」的琥珀 pill，回填完成后 pill 消失、数据自动刷新。
32. 作为开发者，我希望数据变化后页面自动刷新，不必手动点。
33. 作为手机用户，我希望页面在窄屏上变成单列，顺序为总览 → 数据明细 → 其余卡片。
34. 作为开发者，我希望页面在暗色主题下配色正确。

### 多主机

35. 作为连接了多台主机的用户，我希望「用量」页默认合并全部已连接主机的数据，并可在头部下拉里筛选到某一台。
36. 作为多主机用户，我希望未连接的主机在下拉里标「未计入」、旧版本主机标「需要更新主机」，二者都不计入合计。
37. 作为多主机用户，我希望项目行与会话行带主机徽标，同名项目在两台主机上是两行，不被误合并。
38. 作为只连接一台主机的用户，我希望看不到主机筛选控件。
39. 作为用户，我希望只要任一已连接主机支持该功能，侧栏就出现「用量」项。

### 会话内

40. 作为在 Paseo 里跑 agent 的用户，我希望每轮结束后 footer 显示 `Worked for 6m 12s · ↑14.3K ↓4.6K · $0.17`，这样知道刚才那轮花了多少。
41. 作为用户，我希望 hover（手机点按）footer 的用量段看到本轮按模型的明细（输入 / 缓存 / 输出 / 估算成本）与耗时。
42. 作为用户，我希望轮还在跑时 footer 仍只显示 loader 和秒表，轮结束后再补上用量。
43. 作为用户，我希望轮结束但日志尚未落盘时看到一条骨架占位，而不是空白或错误。
44. 作为用户，我希望 daemon 重启或 resume 之后，历史轮的 footer 仍然有用量，因为它来自日志而非内存。
45. 作为用户，我希望 composer 的上下文环形表右侧显示 `84K / 200K`（已用 / 模型上限），手机上只留环。
46. 作为用户，我希望环形表弹层里依次看到上下文占用、本会话合计（Token ↑↓、估算成本、轮次、Agent 运行时长、会话跨度）、套餐用量。
47. 作为用户，我希望本会话合计覆盖该 agent 用过的**全部** provider session（Claude 每次 resume 换的 id 都算），这样长会话不会只剩最后一段。
48. 作为用户，我希望回填未完成或某段日志已被删除时，本会话合计标注「不完整」，而不是给一个看似准确的数字。
49. 作为连着旧版本主机的用户，我希望 footer 只显示现有 "Worked for"，弹层的本会话合计段显示「需要更新主机」，其余功能不受影响。

### 计价

50. 作为开发者，我希望所有会话（含订阅账号跑的）统一按公开 API 价格估算成本，UI 一律写「估算成本」。
51. 作为开发者，我希望 daemon 内置一份 LiteLLM 价格快照，离线也能计价。
52. 作为开发者，我希望 daemon 每天自动从 LiteLLM 拉一次最新价格，并可在设置里关掉自动更新。
53. 作为注重隐私的用户，我希望明确知道这是本功能唯一的网络请求、只拉一个公开文件、不带任何本机数据。
54. 作为开发者，我希望主机设置页的价格表区块列出用量里出现过的所有模型及其四列单价（每百万 token），无价格的排在前面。
55. 作为开发者，我希望能给任一模型填自定义价格（四列），保存后历史成本立即按新价重算。
56. 作为开发者，我希望价格表区块有「立即刷新」按钮，并显示上次更新时间与模型数。
57. 作为开发者，我希望自定义价格填 0 表示「已定价、免费」，而不是「无价格数据」。

### 语言

58. 作为非英语用户，我希望「用量」页、footer 用量段、环形表弹层、价格表区块的全部文案都有我的语言版本（9 种语言）。
59. 作为非英语用户，我希望套餐用量卡片原本硬编码的英文也一并翻译。
60. 作为中文用户，我希望术语一致：用量、来源、套餐用量、估算成本、价格表、自定义价格、轮次、热力图、回填。
61. 作为任意语言的用户，我希望千分位、日期、星期按我的语言格式化，而 K/M/B 缩写与 `$` 保持一致。

## 实现决策

### 1. 采集范围与日志根目录

- 只采集 Claude Code、Codex、Pi、OMP。OpenCode、Copilot 不做。
- 根目录按各 CLI 自己的规则解析：Claude `$CLAUDE_CONFIG_DIR` 或 `~/.claude/projects`（含每个会话目录下的 `subagents/`）；Codex `$CODEX_HOME` 或 `~/.codex` 下的 `sessions` 与 `archived_sessions`；Pi 沿用现有 Pi session 目录解析；OMP 按上游 `PI_CONFIG_DIR` / `OMP_PROFILE` / `PI_PROFILE` / `PI_CODING_AGENT_DIR` / `$XDG_DATA_HOME/omp/sessions` 规则解析，**不再使用** Paseo 自造的 `OMP_AGENT_DIR` / `OMP_SESSION_DIR`，并修正 OMP provider 配置里让后续分支不可达的默认字面量。扫描侧**只按环境变量解析**，不读 OMP `settings.json` 的 `sessionDir`（读它的是 import 侧的 `resolveImportSessionsDir`）：口径与本节「由入口按环境解析出默认值」一致，代价是用 `settings.json` 搬走 sessions 的用户该来源为空，在 `docs/usage.md` 写明。
- 只认 `.jsonl`；`.log` / `.json` / `.zst` 忽略。`.jsonl.zst` 跳过并记一次 info —— 计数对四个根目录一视同仁（只有 Codex 会压缩，但没必要为它开特例），info 每个 daemon 生命周期只发一次。按「什么是好测试」的不断言日志行，测试只验证它没被计入报表。
- 根目录不存在静默跳过，下轮扫描再试。
- 四个根目录、扫描间隔、价格表拉取的 fetch 实现都是 daemon 运行时配置的一部分，由入口按上述规则从环境解析出默认值；这是测试注入点（见测试决策）。

### 2. 四家日志的解析规则

四个解析器是纯函数：输入一段字节与上次的解析状态，输出桶行增量、每轮行增量、新状态。它们不碰文件系统。切行、JSON 解析、时间区间、轮次计数与结算这些共通部分在 `usage/parse.ts`，每个解析器只写自己的行处理。共同规则：

- 按 `\n` 字节自行切行，不用 Node `readline`（它把 JSON 字符串里的 U+2028/2029 当换行）。
- 只消费到最后一个完整 `\n`，半行留到下次。
- 五列 token 统一口径：`input` 为**非缓存**输入、`cachedInput`、`cacheWrite`、`output`（含推理）、`reasoning`（output 子集，只作展示）。
- 单个文件最大 57MB，必须流式读。

Claude Code：

- 用量在 `type:"assistant"` 行的 `message.usage`；`output_tokens` 含 thinking；`thinking_tokens` 仅新版有，缺失记 0。model 在 `message.model`；cwd、sessionId、timestamp、uuid、requestId 在行顶层。
- 去重键 `message.id`，同一 id 拆多行时**取组内最后一行**（前几行可能是流式快照）。
- resume 生成的新文件整段复制旧历史并带 `forkedFrom`：**跳过带 `forkedFrom` 的行**，记录 `forkedFrom.sessionId` 用于串链。
- 轮键 = user 行 `promptId`；轮起点 = 该组首条 user 行 ts；跳过 `isCompactSummary`、tool_result 型 user 行、`<synthetic>` model、所有非 user/assistant 类型行。
- 子代理文件在 `<sessionId>/subagents/`，计 usage 归父 session / cwd、按自身 model，不计轮；其首条 user 行 `promptId` 即父轮键。

Codex：

- 文件名 UUID = `session_meta.payload.id`（thread id），`archived_sessions/` 一并扫描、按 thread id 去重。行内 `timestamp` 为 UTC，文件名时间不用。
- 0.153.2 起优先消费 `token_usage_record`（带 `turn_id` / `response_id`），旧文件回退 `token_count.info.last_token_usage`；**只计 last，不做 total 差分**（total 是进程内累计、resume 后归零）；相邻重复签名去重；`info=null` 跳过。
- `input_tokens` 含 cached，`input` = input − cached；reasoning 含在 output 内，计价记 0；`cache_write` 缺失按 0。
- model 只来自最近一条在前的 `turn_context.payload.model`，没有时记 `unknown`。cwd 取 `session_meta`，按 `turn_context` 逐轮覆盖。
- 轮 = `task_started{turn_id}` 到 `task_complete` / `turn_aborted`；轮起点 = `task_started` ts；轮键 = `turn_id`。轮内每一行（含没有用量的 `response_item`）都推进轮的终点，所以被杀掉的进程留下的轮量到自己最后一行而不是最后一次响应；终止事件结算后立即关闭该轮，后续行属于下一轮（Codex 没有 Claude 那种 stop hook 续跑，轮 id 不会重开）。子线程文件（`session_meta.source.subagent`）不计轮，用量按 `parent_thread_id` 归父会话，≥0.153.2 用 `turn_context.root_turn_id` 归父轮。
- 游标键与 sessionId 兜底取文件名末尾的 thread id（`rollout-<本地时间>-<thread id>[_<rollout id>]`），首条 `session_meta` 覆盖它。

Pi 与 OMP：

- header `type:"session"`（Pi 第 1 行、OMP 第 2 行）给出 id、cwd、timestamp、`parentSession`。cwd 必须读 header，不从目录名推。
- 每条 assistant 消息都带 `message.provider`（后端）与 `message.model`；后端值小写归一化后作 `backend`。
- usage 四列同名；推理列 Pi 叫 `reasoning`、OMP 叫 `reasoningTokens`，两者都读。
- OMP 的分支 / 续接子文件会把父会话条目原样复制进来，父文件里已经算过一遍。解析器保持纯函数不读父文件，改按 header 时间戳切：header 带 `parentSession` 时，**早于 header `timestamp` 的条目一律跳过**。依据是本机全量样本——5 个 OMP 分支文件的 263 条副本全部命中、0 条自己的条目被误伤，595 个 Pi 文件没有一条消息早于自己的 header。Pi 也写 `parentSession` 但不复制条目，规则只对 OMP 生效。代价：父文件不在被扫描的根下（换 profile、被 `settings.json` 搬走、已删除）时这批副本少计，在 `docs/usage.md` 写明。
- 轮 = user 条目到下一 user 条目；轮键 = 开轮 user 条目 `entry.id`。轮的终点只由消息条目推进，`model_change` / `credential_pin` / `session_exit` 这些记账行不算——它们在轮结束后还会写很久。`stopReason` 非 `toolUse` 时结算一段，轮不关闭：同轮之后再出现 assistant 再追加一段；`stopReason` 缺失不当作终止。
- 子 agent 在与主文件同名的同级目录（Pi `tasks/`、嵌套 run 目录，OMP `<Agent>.jsonl` 与子目录）：日志根下相对路径超过两段即子 agent，父会话 id 取第二段目录名里 `_` 之后的部分——Pi 的嵌套 run 目录不写 `parentSession`，只有路径说得出归属。同 cwd 同来源，不计轮，按 header `timestamp` 落在父会话哪一轮的 `[startedAt, lastAt]` 内归哪轮；匹配不上的只进桶行。

### 3. 每轮耗时与轮次结算

- 起点 = 用户提交时刻（Claude 用户行 ts、Codex `task_started` ts、Pi/OMP user 条目 ts）。终点 = 本轮最后一条消息条目的 ts，中断 / 异常同样处理。工具执行、权限等待、用户停留全部计入墙钟耗时。与客户端 `deriveStreamTurnTiming` 同口径。
- `turns` 在本轮首条 assistant 出现时 +1，归入轮起点所在桶。`durationMs` 分次追加，触发条件：终止标记（Claude `stop_reason≠tool_use`、Codex `task_complete`/`turn_aborted`、Pi/OMP `stopReason≠toolUse`）、下一条用户提交、文件 mtime 静止超过 10 分钟。终止后同轮再出现 assistant（stop hook 续跑）再追加一段。
- 每轮行不存耗时，`durationMs = lastAt − startedAt` 查询时派生；与桶行的分次结算按构造相等。
- 未结算轮的状态存在游标条目的 `openTurn` 里。

### 4. 存储

- 目录 `$PASEO_HOME/usage/`，四类文件：桶行 `buckets-YYYY-MM.jsonl`、每轮行 `turns-YYYY-MM.jsonl`（均按行所属月分文件，append-only）、游标 `scan-state.json`、价格缓存 `pricing-cache.json`（后两者原子写）。
- **桶行**键 `(cli, backend, model, sessionId, cwd, bucket)`：`cli` 为 `claude|codex|pi|omp`；`backend` 小写后端名，claude/codex 为 null；`model` 日志原样；`sessionId` 为 provider 自己的 id（Claude sessionId、Codex thread id、Pi/OMP header id）；`bucket` 为 **UTC 15 分钟**桶起点 ISO 字符串。值：五列 token + `turns` + `durationMs`。token 归 assistant 消息自身时间戳所在桶，轮归用户消息时间戳所在桶，跨桶的轮不拆。不存 host、成本、文件路径。
- **每轮行**键 `(cli, backend, sessionId, turnKey, model)`：五列 token + `startedAt` + `lastAt` + `userMessageIds: string[]` + `turnId?: string`。不存成本、耗时、cwd。
- 行 = 一次解析对一个键的**增量**。启动加载时同键相加：token 相加、`turns`/`durationMs` 相加、`startedAt` 取最小、`lastAt` 取最大、`turnId` 取非空、`userMessageIds` 并集。某月文件行数 > 唯一键数 × 2 时原子重写为每键一行。v1 就带压缩。
- **估算成本不落盘**，查询时按当前价格表算，用户补自定义价格后历史立即重算。
- **游标**按文件身份记，键 `(cli, sessionId)`，Claude 子代理文件用 `父 sessionId + agentId`。值 `{ path, inode, size, mtimeMs, offset, forkedFromSessionId, firstAt, lastAt, openTurn }`。`size ≥ offset` 且路径变了视为移动、续读；`size < offset` 或 inode 变视为重写，重置 offset 从头读、记一条 warn，接受重复计数。游标文件同时是 `sessionId → 文件路径` 的索引。
- 启动**全量进内存**，按完整键保存；服务层另建 `(cli, sessionId) → 轮列表` 索引。不做按月懒加载。
- 一个 `UsageStore` 管这个目录，四个方法：`loadRows()`（含压缩）、`appendRows(rows)`（桶行与每轮行同批、按月分组各 append 一次、内部串行队列）、`loadScanState()`、`saveScanState(state)`。聚合结构与解析器状态不进 store。
- 量级依据：本机 1859 个日志文件 / 1.39GB 单线程流式全量扫描 2.3 秒、峰值 RSS 约 220MB；桶行一年约 8500 条、每轮行一年约 6 万条，内存十几 MB。不需要 worker 线程。

### 5. 刷新与回填

- 一个用量服务，一个串行 worker，两条队列：定向解析优先、扫描其次；按 `(cli, sessionId)` 去重，后台队列中的文件被定向触发时提升。每处理完一个文件 `await setImmediate()` 让路。
- **定向解析**：服务全局订阅 agent 事件流，只消费 `turn_completed` / `turn_failed` / `turn_canceled`。文件定位取该 agent Backing sessions 末项：Claude 按 cwd 编码的项目目录 + sessionId；Pi/OMP 用 persistence 里的原生路径；Codex 先查游标索引，未命中在今天与昨天的本地日期目录下按 thread id 找，仍未命中交给周期扫描。读到 EOF 而 `openTurn` 未闭合 → 2 秒后重试一次、再 10 秒一次，之后交给周期扫描。
- **周期扫描**：每 60 秒对四个根递归 readdir + stat 全部 `.jsonl`，与游标的 `(size, mtimeMs)` 比对，变化或新增入队；同轮执行 10 分钟静止结算。同一 `(cli, sessionId)` 在多个根下各有一份时（Codex 归档副本）只读**更完整的那份**：先比字节数、再比 mtime、最后比路径；不靠根目录数组顺序定胜负，否则 `log-roots.ts` 里换个次序就会让活跃文件被归档旧副本顶掉。间隔为常量，环境变量 `PASEO_USAGE_SCAN_INTERVAL_MS` 覆盖，不进 daemon 配置、无 UI。定时器用 `setInterval` + `unref` + 注入时钟。不接 file-observer watcher（事件类型不可信、消费者仍需 stat + 续读，v1 不值得）。
- **回填 = 启动后的第一轮扫描**。启动时 `loadRows()` + `loadScanState()` 同步完成（RPC 随即可用），启动轮在后台按文件 mtime **倒序**处理。`backfill.state`：`idle` 启动轮未开始、`running` 队列未清空、`done` 已清空；`filesTotal / filesDone / startedAt` 只统计启动轮。重启后只剩无游标或有变化的文件，"可中断续跑"不需要额外机制。不做手动暂停 / 取消，不做采集开关。
- **落盘顺序**：每 20 个文件或 500 毫秒一批，批内先 `appendRows` 再 `saveScanState`。两步之间崩溃 → 重启后重复计数（窗口 ≤ 500 毫秒），不做永久漏计的"先游标后行"。
- **广播**：启动轮期间只发 `usage.backfill.progress`（≥ 1 秒一次），不发 `usage.updated`；`done` 后页面重拉。之后每批落盘后按受影响的 `(cli, sessionId)` 各发一条 `usage.updated { cli, sessionId, agentId? }`，`agentId` 由定向触发带上或反查 Backing sessions 含该 id 的 agent。服务端不节流，客户端去抖。
- 接线在 ScheduleService 之后、需要 wsServer 已创建；关闭在 ScheduleService 停止之后、wsServer 关闭之前，`dispose()` 等当前文件处理完并落一次游标。

### 6. Backing sessions 与会话映射

- 存储的 agent 记录新增顶层可选字段 `providerSessionIds: string[]`，按首次出现顺序去重。唯一写入点是 session persistence 刷新处：handle 的 sessionId 与列表末项不同就追加；创建 / 导入时初始化为 `[sessionId]`。四家都维护，通常只有 Claude SDK 入口每次 resume 会换 id。
- 旧记录读时缺失视为 `[persistence.sessionId]`，不迁移写盘；Claude 再沿游标里的 `forkedFromSessionId` 父链向前补全。
- Paseo 的 Fork 是新 agent、自带新列表；CLI 自己的分支（Codex `forked_from_id`、Pi/OMP `parentSession`）不纳入链。
- 「已导入」判定扩展到 Backing sessions 任一 id。
- `usage.agent.get` / `usage.agent.turns.list` 求和范围 = 列表（含反推链）内每个 `(cli, sessionId)` 的全部行，跨 cwd、含子代理行。`complete = 回填不处于 running 且列表内每个 sessionId 都有游标`。
- 会话行（`usage.sessions.list`）里 Claude resume 链合并为一行、归到最新 id，`sessionCount` 按链计 1。

### 7. 协议

沿 `docs/rpc-namespacing.md`，命名 `usage.<名词>.<动词>.request/response`；一个 feature flag `server_info.features.usage`，带 COMPAT 标签。token 为整数五列 `input / cachedInput / cacheWrite / output / reasoning`，`estimatedCost` 为 USD 浮点。以下形状来自 08、09、12、15 号票，已裁到决策部分：

- **`usage.report.get`**：请求 `{ from: "YYYY-MM-DD" | null, to, timezone: IANA, filters?: { sources?: [{cli, backend}], models?, projects? /* rootPath */ }, trend?: { granularity?: "hour"|"day"|"month", stackBy: "source"|"model" } }`。`from/to` 为客户端本地日期闭区间，「总计」传 `from: null`；daemon 用 `timezone` 把 UTC 15 分钟桶换算成本地日 / 小时 / 月。粒度未传按范围定：≤ 2 天 hour、≤ 92 天 day、否则 month。响应 `payload`：
  - `summary: { totals, estimatedCost, sessionCount, last7Days, last30Days }`，近 7/30 天按请求时区的今天算，独立于 from/to。
  - `sources: [{ cli, backend, totals, estimatedCost, modelCount, share }]`
  - `models: [{ model, cli, backend, totals, estimatedCost, priced }]` 全量降序。
  - `trend: { granularity, stackBy, points: [{ key, groups: Record<string, {totals, estimatedCost}> }] }`
  - `days: [{ day, totals, estimatedCost, sessionCount, turns }]`、`months: [...]`
  - `heatmapDays: [{ day, totals }]` 固定最近 182 天，独立于 from/to。
  - `projects: [{ rootPath, displayName, kind: "git"|"non_git"|"directory", totals, estimatedCost, cwds: [{ cwd, totals, estimatedCost }] }]` 全量（上限 200）降序。
  - `backfill: { state, filesTotal, filesDone, startedAt }`、`error: string | null`
- **`usage.sessions.list`**：请求同上的 `{ from, to, timezone, filters }`。一行一 (会话, 本地日)，同一会话跨天多行、token 只算当天：`{ day, cli, backend, sessionId, cwd, project, models: [{model, 五列, estimatedCost}], totals, estimatedCost, turns, durationMs, firstAt, lastAt, handle: { providerId, providerHandleId } | null, importedAgentId?, importedAgentWorkspaceId? }`，按 `lastAt` 倒序，每天最多 500 行、超出 `truncated: true`。`handle` 与 Session history 的描述符同名：Claude/Codex 为 sessionId，Pi/OMP 为游标索引反查的文件路径。
- **`usage.agent.get { agentId }`**：`{ byModel, totals, estimatedCost, turns, durationMs, firstAt, lastAt, complete }`。客户端不接触 provider session id 列表。
- **`usage.agent.turns.list { agentId }`**：`{ turns: [{ cli, backend, sessionId, turnKey, turnId: string | null, userMessageIds, startedAt, endedAt, durationMs, byModel: [{ model, 五列, estimatedCost, priced }], totals, estimatedCost, priced }], complete }`，按 `startedAt` 升序，不分页、无 `since`。Codex 历史轮无 `turnId` 时 daemon 按 durable timeline 的 user_message 时间戳与 `startedAt` 在 ±30 秒内最近匹配补上；Claude/Pi/OMP 不做时间匹配。
- **`usage.pricing.list`**（无参）：`{ table: { fetchedAt, source: "cache"|"snapshot", autoUpdate }, models: [{ model, cli, backend, priced, priceSource: "override"|"table"|null, matchedKey, pricePerMillion | null, lastSeenAt }] }`，`priced=false` 在前、再按 `lastSeenAt` 倒序。
- **`usage.pricing.refresh`**（无参）：`{ result: "updated"|"not_modified"|"failed", fetchedAt, error | null }`，忽略 `autoUpdate` 开关。
- 广播：`usage.backfill.progress`（字段同 `backfill`）、`usage.updated { cli, sessionId, agentId? }`、`usage.pricing.updated`（无 payload）。
- 写价格配置走现有 `set_daemon_config`，不另起 RPC。
- 项目归属：行只有 cwd，顺序为项目注册表（cwd 在某 `projectRootPath` 之下）→ 向上找 git 根（按 cwd 缓存）→ cwd 本身（目录已不存在也落这里）。
- 客户端 inbound 校验由 zod-aot 生成，新 schema 遵守 `docs/protocol-validation.md` 的纯净规则（无 transform / catch / preprocess，默认值只在原始叶子上）。

### 8. 计价

- 内置快照放在用量服务的 pricing 子目录，同目录附 LiteLLM 的 MIT LICENSE 原文。快照与缓存共用 `PricingTable = { _meta: { source, fetchedAt, etag, license }, models: { <key>: { input, cachedInput, cacheWrite, output } } }`，单价为美元 / 每 token 原值；精简规则：跳过 `sample_spec`、只留四列、四列全空丢弃、缺列 `null` 计价按 0。精简后约 3700 条、444KB。
- 快照刷新是手动脚本，发版前跑，`docs/release.md` 完成清单加一行。不做 CI 自动提交。
- 自动更新：启动后延迟 30 秒检查（缓存缺失或 `fetchedAt` 超 24 小时才发请求），之后每 24 小时；`If-None-Match` 条件 GET，304 只更新 `fetchedAt`；超时 15 秒；失败 1 小时后再试、只记 info；响应非法 JSON 或形状异常视同失败、不覆盖缓存。启动时取缓存与快照中 `fetchedAt` 较新者，缓存解析失败则删除并用快照。这是 daemon 唯一自发的出站请求，文档必须写明。
- 配置字段 `features.usage.pricing.autoUpdate: boolean`（默认 true）与 `features.usage.pricing.overrides: PricingOverride[]`，环境变量 `PASEO_USAGE_PRICING_AUTO_UPDATE=0|1` 启动时覆盖。两者是运行时安全字段，进可变配置 schema。
- `PricingOverride = { model: string, pricePerMillion: { input, cachedInput, cacheWrite, output }, note?: string }`：精确匹配（trim + 不分大小写）、不限来源、存每百万 token；`model` 在数组内唯一，重复后者为准；四列非负，0 算已定价；删除 = 从数组移除。
- 成本 = input × 输入价 + cachedInput × 缓存读价 + cacheWrite × 缓存写价 + output × 输出价；reasoning 不单独计价。长上下文分档、Claude 1 小时缓存写入加价、OpenAI 服务档位一律不算，记为已知偏差。
- 匹配顺序（命中即停，按 model 缓存结果，表或覆盖变化时清空含负缓存）：覆盖表精确 → 原始 id（原样 / 小写）→ Claude 归一化（点转横线、`sonnet-4-5` 补 `claude-`）→ 去 `-YYYYMMDD` 后缀 → 剥 provider 路径取末段再走前两步 → 在所有以 `/<末段>` 结尾的键里按固定偏好序挑（anthropic, openai, gemini, deepseek, zai, moonshot, xai, mistral, groq, openrouter，都不在则字典序最小）→ 未命中四列 0、`priced=false`。不做反向子串、不按 Pi/OMP 后端名拼前缀、不剥推理档位后缀。存储与展示永远用原始 model id。

### 9. 「用量」页

- 新侧栏项「用量」加入内建侧栏项列表，与 History / Search / Schedules 同一套显示 / 排序偏好；路由新增一个顶层页面，改动前读 `docs/expo-router.md`。任一已连接主机 `features.usage=true` 时出现。
- **视觉整体照抄参考项目 TokenTracker 的仪表盘**（布局与组件样式），本页是独立视觉岛，不按 `docs/design.md` 令牌重画；原型 `prototype/usage-page.html` 是 UI 章节的真值。要点：
  - 桌面 12 栅格左 4 / 右 8。左列：统计面板、热力图、使用趋势、套餐用量；右列：用量总览、数据明细；两列末尾卡片拉伸到同一底边，数据明细表格超出内部滚动。手机单列：总览 → 数据明细 → 左列四卡。
  - 总览头部：周期页签（日 / 周 / 月 / 总计 / 自定义，自定义选中后页签文字变区间、下方出两个日期输入）+ ‹ › 翻页 + 回填 pill + 主机筛选 + 刷新。中央 "TOKEN 总数" 标签 + 72px 大数字 + 绿色估算成本（ⓘ）+ 区间 + "估算成本 · 按公开 API 价格计算"。来源分布条 → 来源卡片栅格（首张「全部」），点卡展开模型明细。
  - 统计面板：7 天 / 30 天 / 平均 / 会话数四格、Top 3 模型、开始使用日、活跃天数。
  - 热力图固定 26 周（手机 20 周）、周一起、5 级绿阶、悬停日期与 token；只做 2D。
  - 趋势按来源堆叠柱，卡片标题右侧 tiny 分段控件切「按来源 / 按模型」；未来日画灰色矮柱。
  - 套餐用量卡片沿用现有组件的窗口条 / 余额条样式，标题右侧显示更新时间。
  - 数据明细三页签：每日细目（可展开会话行，「打开」走 Session history 的打开 / 导入逻辑）/ 按月 / 项目用量（前 3 / 6 / 10 分段，行展开 cwd）。
  - 主机筛选：只有一台主机时不显示；下拉首项「全部主机」带「N 台计入」pill；不支持的主机灰字不可选 + 「需要更新主机」pill；未连接灰点不可选 + 「未计入」pill。
  - 回填：总览头部一枚琥珀 pill「回填中 M / N」带呼吸点，悬停提示"最近的日期先补齐"；无横幅；`done` 后消失。
  - 配色：来源固定色表（Claude Code `#d97757`、Codex `#3b82f6`、Pi/OMP 按后端取表、未知后端 hsl 兜底、同一后端在 Pi 与 OMP 下同色）；热力图明 / 暗两套绿阶；品牌绿 `#059669`。
  - 数字：总览大数字与表格千分位全量；统计四格、来源展开、项目、会话用 K/M/B 一位小数；成本两位小数。
- 图表用 `react-native-svg` 自绘，不引入图表库。
- 数据获取：向每个已连接且支持的主机发同一请求（主机筛选决定发给谁），客户端做跨主机相加：`summary` 的 token / 成本 / 会话数直加；`days` / `months` / `trend` / `heatmapDays` 按 key 相加；`sources` / `models` 按 `(cli, backend[, model])` 合并后重排；**项目不跨主机合并**，每行带 `serverId`；Top 10 合并后再截。会话行每行带 `serverId`，handle 归属该主机。`usage.updated` 到达后去抖重拉报表；`backfill.progress` 只更新 pill，`done` 时重拉。
- 价格表**不在**本页；主机设置页保留价格表区块。

### 10. 会话内两处

- **turn footer**：现有 "Worked for 6m 12s" 之后同一行、同色、同字号，以 " · " 分隔追加 `↑14.3K ↓4.6K · $0.17`（↑ 非缓存输入，↓ 输出含推理）。hover / 手机点按弹层「本轮用量」：按模型表（模型 / 输入 / 缓存 = 缓存读 + 缓存写 / 输出，推理另注 / 估算成本），多模型加合计行；下方「耗时」与 "估算成本 · 按公开 API 价格计算"。手机上 footer 允许换行，用量段整体落到第二行。运行中的一轮不显示 token；轮结束等 `usage.updated` 命中本 agent 后重拉 `usage.agent.turns.list`。占位：轮已完成但行未到 → 64×12 骨架条；无价格 → `$0.00` 点下划线 + 弹层琥珀 pill；旧 daemon → 不加段落。原型 `prototype/composer-usage-strip.html`。
- **轮与每轮行的对齐**（客户端）：`turnId` 相等 → 本轮首条 user_message 的 `messageId ∈ userMessageIds` → 都不中则不显示用量段。`userMessageIds`：Claude 为该 promptId 组内全部 user 行 uuid；Pi/OMP 为 `[entry.id]`；Codex 为空（靠 daemon 补的 `turnId`）。定向解析闭合的那一轮，其每轮行带触发它的 Paseo `turnId`。
- **上下文环形表**：位置不变，环右侧加 `84K / 200K` 文字（12px 次要色，hover 变主色，tabular-nums），手机只留环。弹层三段：上下文窗口 → **本会话合计**（Token ↑↓、估算成本、轮次、Agent 运行时长、会话跨度）→ 套餐用量（现有组件原样）。数据走 `usage.agent.get`；运行中的一轮把本地秒表叠加到 `durationMs`，`turn_completed` 后收到 `usage.updated` 重拉替换；`complete=false` 标「不完整」；旧 daemon 时本段显示灰 pill「需要更新主机」。
- token 缩写统一为 K/M/B 一位小数：现有 `formatTokenCount`（`12k` 无小数）改为此格式，环形表弹层一并切换，同屏只有一种缩写。成本沿用现有 session cost 格式（< $0.01 四位小数，否则两位）；耗时沿用现有 duration 格式。

### 11. 主机设置页价格表区块

- 取代搬走的套餐用量区块，段导航标签由 "Usage" 改为 "Price table"（键名不改，只改值）。
- 卡片标题 + "每百万 token 美元 · LiteLLM 快照，N 小时前更新，M 个模型"；右上自动更新开关 + 立即刷新。表格列：模型 / 输入 / 缓存读 / 缓存写 / 输出 / 来源 / 操作；已计价行末「自定义价格」幽灵按钮展开四格输入；无价格行直接四格输入 + 保存，名称后琥珀 pill「无价格数据 · 估算 $0」。
- 读 `usage.pricing.list`；写覆盖表与开关走 `set_daemon_config` 整段替换；`usage.pricing.updated` 到达后重拉。多主机时按主机分组（每台主机自己的配置，不同步）。

### 12. i18n

- 顶层新建 `usage` 命名空间，按区块分组：`overview`（含 `period.*`、`range` / `rangeSingle`、a11y）/ `stats` / `heatmap` / `trend` / `planUsage` / `details.{daily, monthly, projects}` / `sessionRow` / `hostFilter` / `backfill` / `columns`（共用列名）/ `common`（仅跨区块且不属任何表列的词）。不按类型分；重试用 `common.actions.retry`；**不往 `common` 加新词**。
- turn footer 键在 `message.turnUsage.*`（自带 `columns.*`），"Worked for" 一并迁为 `message.workedFor: "Worked for {{duration}}"`。环形表弹层新段在 `contextWindow.sessionTotal.*`；同时把现有 `sessionCost` 英文改为 "Estimated cost {{cost}}"、zh-CN「估算成本 {{cost}}」，`contextWindow.accessibility` 扩成含已用 / 上限。
- 价格表键 `settings.host.priceTable.*`。
- 套餐用量模块原有 10 条英文迁到 `usage.planUsage.*` 后删除 copy 文件；相对时间与 "left" 改为纯函数返回 `{ key, params }`、组件层渲染；单位缩写（"3h"）保持英文。英文值逐字不变。
- 来源显示名与后端名表不进 i18n，是客户端常量（Claude Code / Codex / Pi / OMP；anthropic → Anthropic、openai → OpenAI、xai → xAI、github → GitHub Copilot…；未知首字母大写；" · " 分隔）。
- 9 语言各自内联、一次写齐，不留英文占位；zh-CN 由用户校对，其余以资源测试为守卫。单复数用 `{one, many}` 两键；运行时拼键的地方加 `i18n.exists()` 测试；四处图形（热力图格、趋势柱、来源卡、环形表）建 a11y 键。
- 千分位、百分比、日期、月份、星期短名按 UI 语言走 `Intl.NumberFormat` / `Intl.DateTimeFormat`；K/M/B、`$`、成本小数位固定。日期区间用两端各自格式化 + `range` 键拼，不用 `formatRange`。iOS / Android 真机各做一次 Intl 冒烟。
- zh-CN 术语：用量 / 来源 / 套餐用量 / 估算成本 / 价格表 / 自定义价格 / 轮次（「第 N 轮」作序数）/ 热力图 / 回填；Token 保留拉丁字。

### 13. 门控与兼容

- 协议只加不改：新 RPC、新广播、新 feature flag、agent 记录新可选字段、配置新可选字段。旧客户端忽略新广播；新 daemon 接受无 `providerSessionIds` 的旧记录。
- 客户端按 `features.usage` 一次门控：侧栏项、footer 用量段、弹层本会话合计、价格表区块；旧 daemon 的表现见第 9、10 节。不做回退路径。
- 套餐用量卡片从主机设置页搬走后，现有的套餐用量浏览器 spec 改为在「用量」页定位卡片，断言文案不变。

### 14. 文档

- `docs/data-model.md`：目录树加 `usage/` 四类文件；新增「Usage」一节写桶行 / 每轮行 / 游标 / 价格缓存的 schema、增量行与启动压缩、成本不落盘的原因。agent 记录一节加 `providerSessionIds`。
- 新建 `docs/usage.md`（CLAUDE.md 文档表加一行）承载代码说不出的事：为什么是 UTC 15 分钟桶、为什么成本查询时算、四家日志的坑（Claude 多行取尾与 `forkedFrom`、Codex total 归零与 `token_usage_record`、Pi/OMP 跨文件 id 复制与 header 位置、U+2028 切行）、OMP 目录解析的真值、回填 = 启动轮、崩溃窗口重复计数、唯一出站请求与隐私说明、`.jsonl.zst` 不做。
- `docs/release.md` 完成清单加「刷新价格快照」一行。
- `docs/glossary.md` 已随本任务更新（工作区未提交的 diff），随实现一起提交。

## 测试决策

### 什么是好测试

只断言外部可见的行为：RPC 响应、落盘文件、页面上的文字与控件。不断言私有状态、内部调用顺序、日志行。每个断言写全值（`toEqual` 完整对象），不用 `toBeTruthy` / `toBeDefined`，不写条件分支。遵守 `docs/testing.md` 的两类：带端口 / 适配器的单元测试（无 `vi.mock`、无 JSDOM、无组件挂载），或真实端到端（进程内真 daemon、Playwright 真浏览器）。

### 测试接缝（三个，高到低）

**接缝 1（主）：daemon 的 WebSocket RPC 边界，进程内真 daemon。** 用现有 `createTestPaseoDaemon` / `createDaemonTestContext` + `DaemonClient` 起一个 daemon，`PASEO_HOME` 为临时目录，四个日志根指向临时目录里预先放好的夹具日志，扫描间隔与时钟注入，价格表 fetch 注入为内存适配器（返回固定 JSON / 304 / 失败）。为此 daemon 运行时配置新增 `usage` 段（根目录、扫描间隔、pricing fetch、autoUpdate），测试 daemon 选项透传，这是唯一新增的注入点。在这个接缝上验证：

- 四家日志各一份夹具 → `usage.report.get` 的 `summary` / `sources` / `models` / `days` / `projects` 全值；同一夹具在不同 `timezone` 下 `days` 的分法。
- 回填进度事件序列（`running` → `done`）、`backfill` 字段；daemon 关闭再以同一 `PASEO_HOME` 重启后不重复计数、报表不变。
- 往夹具文件追加行后（模拟 CLI 写盘）触发扫描 → `usage.updated` 到达、报表增量正确；截断文件 → 重置游标、warn。
- `usage.sessions.list` 的 (会话, 日) 拆行、Claude resume 链合并为一行、`handle` 字段、每天 500 行截断。
- 用假 agent client 创建 agent，其 persistence sessionId 指向某个夹具会话 → `usage.agent.get` / `usage.agent.turns.list` 的求和、`complete`、`turnId` 打标（假 client 发 `turn_completed` 后定向解析），旧记录无 `providerSessionIds` 时的补全。
- `set_daemon_config` 写自定义价格 → `usage.pricing.updated` 广播、报表成本立即重算、`usage.pricing.list` 的 `priceSource`；`usage.pricing.refresh` 在 fetch 返回 200 / 304 / 失败时的三种结果与缓存文件内容；`autoUpdate=false` 时不发请求。
- 未支持根目录不存在、Codex `.zst` 存在时的静默跳过。

**接缝 2：解析器与计价匹配的纯函数单元测试。** 四个解析器是 `(bytes, state) → { bucketRows, turnRows, state }` 的纯函数，价格匹配是 `(model, table, overrides) → 结果`，客户端的跨主机合并、热力图分级、轮次对齐、数字格式化、来源显示名、i18n 键存在性也是纯函数。它们的输入是夹具行，输出全值断言。这个接缝存在的理由：四家日志的每个坑（Claude 同 id 多行取尾、`forkedFrom` 跳过、`<synthetic>`；Codex total 归零、相邻重复签名、`token_usage_record` 优先；Pi/OMP 跨文件 id 复制、header 行号、推理列名；U+2028 切行、半行续读）在接缝 1 上只能看到总数对不对，看不出是哪条规则错了。

**接缝 3：app Playwright 浏览器 spec。** worker daemon 通过现有 `e2eDaemonEnvironment` 选项把四个根目录环境变量指到 spec 自带的夹具目录、把扫描间隔调短。验证「用量」页首屏文字与卡片、周期切换与翻页、来源卡展开、每日细目展开会话行与「打开」跳转、主机筛选（两台真 daemon，参照现有双主机 spec；旧 daemon 参照现有旧 daemon spec 的「需要更新主机」pill）、回填 pill 出现与消失、价格表区块填自定义价格后成本刷新、套餐用量卡片在新位置（改现有 spec 的路由）。turn footer 与环形表弹层的真实链路用 `*.real.spec.ts` 跑一轮 Claude（`CLAUDE_CONFIG_DIR` 指到临时目录），断言 footer 出现 `↑ ↓ $` 段与弹层内容；非 real 的 footer 覆盖靠接缝 1 的 `usage.agent.turns.list` 加接缝 2 的对齐函数。

三个接缝之外不再加：不为 `UsageStore` 单独写 store 测试（它的行为从接缝 1 的重启与压缩用例可见），不为 React 组件写挂载测试。

### 夹具来源

解析器夹具是**脱敏的真实日志片段**：从本机四个目录截取，每个片段十几到几十行，覆盖一条规则，文件名说明覆盖的行为（如 `claude-multiline-message-id.jsonl`、`codex-total-reset-after-resume.jsonl`、`omp-child-copies-parent-entries/`）。脱敏规则：cwd 替换为 `/work/<project>`，消息内容替换为占位，id / 时间戳 / usage 数字保留。夹具与解析器同目录存放，接缝 1 与接缝 3 复用同一批夹具（接缝 3 的夹具目录布局要与真实目录结构一致：Claude 的编码项目目录名、Codex 的 `YYYY/MM/DD`、Pi/OMP 的 header）。不写生成脚本，手工整理一次。

### 先例

- 进程内 daemon + `DaemonClient`：`docs/ad-hoc-daemon-testing.md`，现有 `*.e2e.test.ts`（owned-subscriptions、daemon-client）。
- 服务级注入时钟 / fetch / 临时 home：quota-fetcher 的 `ProviderUsageService` 测试（`now` / `fetch` 注入）、schedule service 测试（时钟注入 + 假 agent client）。
- 纯函数 + 描述对象：`schedule-format` 测试（返回 `{ key, params }`）、`turn-time` 测试。
- i18n 守卫：`i18n/resources.test.ts`（9 语言键集合一致、相同字串 < 25%、占位符一致）。
- Playwright：`provider-usage-settings.spec.ts`（套餐用量卡片文案）、`host-appearance.spec.ts`（两台真 daemon）、`creation-old-daemon.spec.ts`（旧 daemon 门控）、`claude-workflow-*.real.spec.ts`（真 Claude 一轮）。

## 验收标准

- [ ] 在装有四个 CLI 日志的主机上启动 daemon，「用量」页在几秒内出现最近几天的数据，回填 pill 显示进度并在完成后消失；重启 daemon 后总数不变。
- [ ] 四家夹具经 `usage.report.get` 得到的总数与人工按规则算出的数一致（含去重、子代理归父、Codex 只计 last）。
- [ ] Paseo 里跑一轮 Claude，轮结束后 footer 出现 `↑ ↓ $` 段，弹层按模型明细与耗时正确；环形表旁出现 `已用 / 上限`，弹层本会话合计与 footer 各轮之和一致。
- [ ] 主机设置页价格表区块给一个无价格模型填自定义价格后，「用量」页与 footer 的估算成本立即变化，不需要重启。
- [ ] 两台主机时总览合计为两台之和，项目行带主机徽标；断开一台后下拉里标「未计入」且合计减少；连一台旧 daemon 时标「需要更新主机」。
- [ ] 套餐用量卡片在「用量」页左列底部正常显示，主机设置页该位置变为价格表，段导航标签为 "Price table"。
- [ ] 9 语言资源测试通过；切到 zh-CN 后页面无残留英文（来源名、模型名、单位缩写、`$` 除外）。
- [ ] 旧版本 app 连新 daemon、新 app 连旧 daemon 都不报协议错误。
- [ ] `npm run typecheck`、`npm run lint`、改动文件的 vitest 与目标 Playwright spec 通过；CI 全绿。
- [ ] `docs/data-model.md`、`docs/usage.md`、`docs/release.md`、`docs/glossary.md`、CLAUDE.md 文档表已更新。

## 范围之外

- 供应商渠道及其归因（用户明确不做）。
- OpenCode、Copilot 的用量采集。
- 参考项目的排行榜、成就、菜单栏 / 小组件、桌面宠物、Skills、IP 检查、服务状态；热力图 3D 视图与趋势图放大弹窗。
- 会话效率、上下文健康度、年度总结、质量 / 美元、设备用量卡。
- 实付成本、订阅费摊销；长上下文分档、Claude 1 小时缓存写入加价、OpenAI 服务档位的精确计价。
- 数据保留期策略（不自动删除）。
- 日志文件被重写 / 截断时的精确撤销（每行带 fileId + 撤销行）；重置游标并接受重复计数。
- Codex `.jsonl.zst` 压缩归档的解压与解析。
- 回填的手动暂停 / 取消；用量采集开关。
- file-observer watcher 接入（留作后续升级，接法已记在研究笔记）。
- 价格表跨主机同步；USD 以外的币种。
- 价格表区块放在「用量」页（用户否决）。
- 按 Paseo 设计令牌重画「用量」页（用户否决，要求照抄参考项目）。

## 补充说明

- 两份原型是 UI 章节的真值：`prototype/usage-page.html`、`prototype/composer-usage-strip.html`（`?variant=A`）。
- 研究笔记：`research/claude-log-format.md`、`research/codex-rollout-format.md`、`research/pi-omp-log-format.md`（字段表与脱敏样例，可直接做夹具起点）、`research/litellm-pricing.md`、`research/backfill-volume.md`、`research/file-observer-fit.md`、`research/reference-tokentracker.md`、`research/paseo-usage-facts.md`。
- 每个实现 session 必读：`docs/data-model.md`（Store Surface Rule）、`docs/protocol-compatibility.md`、`docs/rpc-namespacing.md`、`docs/protocol-validation.md`、`docs/expo-router.md`（加路由前）、`docs/i18n.md`、`docs/testing.md`。
- 已知偏差（不修）：Claude 压缩那次调用没有 usage 行；Claude 旧版无 `thinking_tokens`；四列计价对长上下文与 1 小时缓存低估；崩溃窗口 ≤ 500 毫秒的重复计数。
- 本任务体量大（server 存储 / 解析 / 协议 / 计价 / 调度，app 页面 / 会话内 / 设置 / i18n），下一步走 `/atw-tickets` 切票。建议的切法顺序：存储与解析器（接缝 2 先行）→ 服务、调度与报表 RPC（接缝 1）→ 计价 → agent 映射与每轮 RPC → 协议与客户端 client 层 → 「用量」页 → 会话内两处 → 价格表区块与套餐用量迁移 → i18n 与文档。
