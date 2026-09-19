# 参考项目 TokenTracker 事实笔记

来源：`/Users/oxy/Documents/Configuration/dev-environment/demo/源码/TokenTracker`，2026-09-18 由子代理调研。只记录与"用量统计"相关的部分，排行榜/成就/小组件/宠物/Skills/IP 检查/服务状态不在范围内。

## 采集

- 数据流：CLI 运行 → hook 触发 `sync` → `src/lib/rollout.js`（22064 行，47 个 `parse*Incremental`）解析本地日志 → `queue.jsonl` → 本地 API → dashboard（`CLAUDE.md:14-18`）。
- **hook 只触发 sync，不自己上报**（`src/lib/claude-config.js:109-117`、`opencode-config.js:9-45`）。Pi / Cursor 等是被动读日志，无 hook（`src/commands/init.js:739-825`）。
- 该文件含非常规字节，grep 需 `LC_ALL=C`。

| 工具        | 日志路径                                              | 入口                                                                 | 字段与坑                                                                                                                                                                                                                                                                     |
| ----------- | ----------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Claude Code | `~/.claude/projects/**/*.jsonl`（`sync.js:632,1047`） | `parseClaudeIncremental` `rollout.js:860`，`parseClaudeFile` `:2470` | `message.usage`：input / cache_read → cached / cache_creation；`output_tokens` 要**减去** thinking/reasoning（`normalizeClaudeUsage` `:4572`）。model 取 `message.model`；cwd 从会话文件解析 `resolveClaudeFileCwd` `:1034`；会话数只算含 text block 的 user 行 `:2503-2514` |
| Codex       | `$CODEX_HOME                                          |                                                                      | ~/.codex` 的 sessions（`sync.js:590,690-714,804`）                                                                                                                                                                                                                           | `parseRolloutIncremental` `rollout.js:225` → `src/lib/codex-rollout-parser.js` | `input_tokens` **已含 cached**，需 `input - cached`（`:441-443`）；用量来自 `token_count` 事件的 `info.last_token_usage` / `total_token_usage` 累计差分 `consumeUsageDelta` `:1006-1012`；session id / cwd 来自 `session_meta`，cwd 可被 `turn_context` 覆盖 `:959-988`；额外记 `long_context_*` / `priority_*` 子集列供加价 `:654-720`               |
| Pi          | `${PI_CODING_AGENT_DIR                                |                                                                      | ~/.pi}/agent/sessions/\*_/_.jsonl`（`rollout.js:15129-15202`）                                                                                                                                                                                                               | `parsePiLikeIncremental` `:15287`，`parsePiIncremental` `:15654`               | `usage.input/output/cacheRead/cacheWrite/reasoningTokens` 五列直出，无陷阱（`:15415-15462`）；model 缺省 `pi-unknown` `:15204`；去重键 `entry.id`（消息级）`:15409`；cwd 读首行 `type:"session"` header `:15497-15521`；**source 按后端 provider 拆成 `pi-<provider>`** `:15260-15274`；走 Copilot 订阅路由的成本恒 0（`pricing/index.js:18-23,186`） |
| OpenCode    | `${OPENCODE_HOME                                      |                                                                      | XDG_DATA_HOME                                                                                                                                                                                                                                                                |                                                                                | ~/.local/share}/opencode/storage/\*\*`与`opencode.db`（`sync.js:1202-1236`）                                                                                                                                                                                                                                                                          | `normalizeOpencodeTokens` `rollout.js:4414-4431` | 五列直出；v2 取 `model.id` + `model.providerID` `:3960-3979`；去重键 `sessionID | messageID` `:3419`；v2 db 有 `directory`列可作 cwd`:4857` |
| Copilot     | OTEL jsonl / `session-store.db` / `data.db` 三路      | `rollout.js:16725,17426,18228`                                       | 三路都**无 cwd**，进不了项目维度；CLI span 的 input 含 cache read+write 要都减 `:16371-16382`                                                                                                                                                                                |

## 存储

- 本地全是 JSON/JSONL，**没有自己的 SQLite**（`sqlite-reader.js` 只读别家 db）。目录 `~/.tokentracker/tracker/`：`queue.jsonl`（主队列，append-only）、`queue.state.json`（云端上传 offset）、`project.queue.jsonl` + state、`cursors.json` 或 `cursor-store-v2/`、`cache/pricing.json`。
- queue 行字段：`source, model, hour_start, input_tokens, cached_input_tokens, cache_creation_input_tokens, output_tokens, reasoning_output_tokens, total_tokens, billable_total_tokens, total_cost_usd, conversation_count`（`rollout.js:3178-3180`）。
- 时间桶是 **UTC 半小时**（`toUtcHalfHourStart` `rollout.js:3861`），字段名却叫 `hour_start`。
- 云端 Postgres 表 `tokentracker_hourly` 唯一键 `(user_id, device_id, source, model, hour_start)`；排行榜用预聚合表，原因是 42 万行 group by 超边缘函数 25 秒预算。

## 计价

- 双层：LiteLLM 上游 `model_prices_and_context_window.json` 24 小时磁盘缓存 + 内置 seed 快照（2284 模型，约 250KB）+ 人工覆盖 `src/lib/pricing/curated-overrides.json`（每百万 token USD：`input/output/cache_read/cache_write`，"编辑此文件即可覆盖定价，无需重新部署"）。
- 匹配七级，人工覆盖始终优先（`pricing/matcher.js:1-12`）：source 级精确 → curated 精确 → LiteLLM 精确 → curated 别名 → curated 子串 → LiteLLM 后缀剥离 / provider 前缀剥离 → LiteLLM 反向子串（最长 key 优先）→ 未命中。另有各家模型名归一化（`normalizeClaudeModel` `:89` 等）。
- **未知模型返回全零并进负缓存**（`pricing/index.js:119-129`），UI 显示 $0 并加文案"$0 不代表免费"（`dashboard/src/content/copy.csv:744-745`）。
- 公式 `computeRowCost`（`pricing/index.js:181-305`）只用五列 token，**绝不用 total_tokens**：`(input×in + output×out + cached×cache_read + cache_creation×cache_write + reasoning×out) / 1e6`。特例：Codex 等 reasoning 已含在 output 里，reasoning 成本记 0（`:200-207`）；本地推理恒 0；OpenAI 长上下文与 priority 倍率；DeepSeek 按北京时间峰谷分时。
- **所有成本都是估算成本**，UI 一律 "Estimated"（`copy.csv:208,701,717,967`）；没有订阅费摊销，没有实付口径。

## 聚合与 API（`src/lib/local-api.js`，3281 行）

| 接口                           | 行号      | 返回                                                                                                      |
| ------------------------------ | --------- | --------------------------------------------------------------------------------------------------------- |
| usage-summary                  | 2110-2174 | totals（total/billable/cost/input/output/cache/reasoning/conversation_count）+ rolling last_7d / last_30d |
| usage-daily                    | 2177-2185 | 每天一条：各列 + cost + conversation_count + models map                                                   |
| usage-hourly                   | 2886-2893 | 某天 24 小时                                                                                              |
| usage-monthly                  | 2896-2927 | 每月一条 `YYYY-MM`                                                                                        |
| usage-model-breakdown          | 2348-2408 | sources[] → models[]，每层 totals + cost                                                                  |
| usage-heatmap                  | 2285-2345 | `week_starts_on:"sun"`，格子含 day/total/billable/level 0-4/models                                        |
| project-usage-summary / detail | 2478-2661 | Top 10 项目（硬上限），project_key 来自 cwd（Claude）或 git 远端 owner/repo（Codex）                      |
| sessions / session-insights    | 2222-2275 | 逐会话行，可 resume，CSV 导出                                                                             |

- 几乎所有接口先过 `scopedQueueRows` 按来源过滤（`:544-553`）。
- 展示层**按客户端时区**聚合：前端传 `tz` + `tz_offset_minutes`，`getZonedParts` 用 `Intl.DateTimeFormat` 取本地年月日（`:653-734`），`rowDayKey` 把 UTC 桶映射成本地日期 `:373-385`。
- 周起始日不一致：周期选择器周一起（`dashboard/src/lib/date-range.ts:67-71`），热力图周日起（`local-api.js:2338`）。自然月；"total" 是最近 24 个自然月；支持自定义范围。

## 前端（用量相关）

- `DashboardView.jsx` 左右双栏，卡片可拖拽。左：StatsPanel（起始日、streak、订阅、会话数、近 7/30 天、Top 模型徽章）、ActivityHeatmap（2D/3D）、DeviceUsageCard、TrendMonitor（day/hour/month，按 provider/model 堆叠）、QualityPerDollar、SessionInsights。右：UsageOverview（周期选择 day/week/month/total/custom + 汇总）、DataDetails（项目表 + 按天/按月明细，可排序分页）、CostAnalysisModal、ContextBreakdownPanel。
- 来源卡片（用户截图）：「全部 100% / 16 个模型」「CLAUDE 52.41% / 5 个模型」「Pi · OpenAI Codex」「oh-my-pi」「Pi · 3oxy Gpt」「CODEX」「Pi · Ollama」…，即按 source 拆、Pi 再按后端 provider 拆。

## 保留、增量、去重

- 无保留期；只有用户主动按项目清除（`project-usage-purge.js`）。
- 游标两层：文件层 `cursors.files[path] = {inode, offset, …}`，inode 相同才续读，`offset > size` 视为截断重置（`rollout.js:926-931,1068-1082`）；超 16MB 迁移到 `cursor-store-v2/` 分代存储。Pi 用"最后一个完整换行符"作边界防半行（`:15303-15353`）。
- 去重三层：消息级（Claude `message.id` 或 `message.id:requestId`，历史 bug 曾导致无 requestId 的端点重复计费 1.6-3.7 倍，`:4553-4569`；hash 上限 10 万条）、桶级 totalsKey 哈希（`:3151-3172`）、账号级跨设备。

## 追问补充（2026-09-18）

- **OMP**：日志 `~/.omp/agent/sessions/--<cwd编码>--/<timestamp>_<sessionId>.jsonl`，home 解析 `OMP_HOME` → `PI_CONFIG_DIR` → `~/.omp`（`rollout.js:10846-10890`）；子 agent transcript 在同名同级目录，计入同一会话（`:10816-10818`）。入口 `parseOmpIncremental` `:15087` → `parseOmpLikeIncremental` `:14712`。只有 `type:"message"` 且 `role=="assistant"` 的行带 `usage.input/output/cacheRead/cacheWrite/totalTokens/reasoningTokens`，去重键顶层 8 字符 `id`，model 逐条取、回退 `omp-unknown`。**source 固定 `"omp"`，不按后端拆**（`:15091`），尽管注释承认 omp 也是路由器（`:10841-10842`）；Pi 拆分理由在 `dashboard/src/lib/provider-display.js:32-34`："每个后端计价不同，必须各自成桶"。
- **来源显示名**：`provider-display.js` `formatProviderDisplayName:56-78`：硬编码表 `SPECIAL_PROVIDER_NAMES:3-14`（pianthropic → "Pi · Anthropic" 等）→ i18n key（omp → "oh-my-pi"）→ 兜底 `pi-` 前缀动态生成 `Pi · <Slug>`（`:72-75`）；key 先去空格/下划线/连字符再小写。
- **自定义价格：没有 UI，没有 CLI 命令**。CLI 十个子命令无 pricing；dashboard 设置页无定价项。唯一入口是开发者改 `curated-overrides.json` 并同步 5 个边缘函数副本（`test/edge-pricing-parity.test.js` 守护）。README 只在 provider 条目里说"显示 $0 并不代表免费"（`README.zh-CN.md:205`）。
