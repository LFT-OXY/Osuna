# Map — 本机会话 token 用量与估算成本统计

## Destination

一份可直接切票的 `prd.md`：daemon 解析 Claude Code / Codex / Pi / OMP 的本地会话日志，持久化五列 token 与估算成本，提供跨 Host 可合并的查询协议；新增「用量」侧栏页（周期、汇总、来源卡片、Top 模型、趋势、热力图、每日明细可展开会话、按月、项目 Top 10、价格表、Plan usage）与会话内用量（turn footer 的每轮 token / 估算成本、上下文环形表旁的已用 / 上限文字及其弹层里的本会话合计）。到达标志：存储行 schema、协议形状、各 CLI 解析规则、计价规则、刷新与回填策略、两处 UI 的形态都已决定，没有留给实现阶段的设计问题。

## Notes

- 访谈结论（三轮，全部已定）：`research/interview-decisions.md`。它是需求边界，map 只解决它没覆盖的设计问题，不重开已定项。
- 参考项目事实：`research/reference-tokentracker.md`；Paseo 现状：`research/paseo-usage-facts.md`。
- 术语：`docs/glossary.md` 的 **Usage / Usage source / Plan usage / Estimated cost**；Pi/OMP 内部的 "provider" 在 UI 上叫后端（backend），不叫 Provider。
- 每个 session 必读：`docs/data-model.md`（Store Surface Rule）、`docs/protocol-compatibility.md`、`docs/rpc-namespacing.md`（新 RPC 用 `usage.<op>.request/response`）、`docs/file-observation.md`、`docs/i18n.md`、`docs/design.md`。
- 本机日志体量（2026-09-18）：Claude 687 个 jsonl 669MB（目录内全量 1346 文件，单文件最大 57MB）、Codex 77 个 33MB、Pi 594 个 305MB、OMP 501 个 442MB（另有 1347 个 .log），合计约 1.45GB。回填与内存设计以此为量级。
- 图表：无图表库，`react-native-svg` 自绘。
- 研究票由子代理跑 `atw-research`，结果写 `research/<topic>.md`，票内 `## Answer` 只放结论与指针。

## Decisions so far

<!-- 一行一票：标题链接 + 一句结论 -->

- [LiteLLM 价格表的结构、体积、许可与 Paseo 出站策略](map-issues/04-litellm-pricing.md) — 四列字段 `*_cost_per_token`（美元/每 token），精简后 3696 条 444KB（gzip 38KB）可内置，MIT 许可；key 多为裸名需小写→Claude 归一化→去日期→剥 provider 前缀四步匹配；daemon 定时拉取是首个自发出站请求，需 config 开关 + ETag 条件 GET + 降级链 + 文档说明。详见 `research/litellm-pricing.md`。
- [file-observer 模块能否承担四个日志目录的观察](map-issues/06-file-observer-fit.md) — 可以但不值得：事件只有 {path,type} 且 macOS 追加写报成 create，消费者仍要 stat + 游标续读；root 不存在会抛错、无内建轮询回退。推荐 v1 用 `turn_completed` 定向增量 + 60 秒 mtime/size 指纹扫描（四目录 2000 余文件全量 stat 约 20ms）兜底，watcher 留作后续升级。单个 Claude jsonl 最大 57MB，回填必须流式读；`~/.omp` 有 1347 个 .log 会产生噪音事件。详见 `research/file-observer-fit.md`。
- [全量回填的耗时与内存量级](map-issues/05-backfill-volume.md) — 本机 1859 个 jsonl / 1.39GB / 31 万行，单线程流式全量扫描 2.3 秒、峰值 RSS 约 220MB；(source, model, session, cwd, UTC 小时) 桶 2662 个跨 115 天，外推一年约 8500 桶、3MB 内存。不需要 worker，只需每文件 `await setImmediate` 让路，每 20 文件或 500ms 落一次游标；必须流式读（最大文件 57MB，整读 286MB）。坑：Node readline 把 JSON 字符串内的 U+2028/2029 当换行会切碎行，解析器要按 `\n` 字节自行切行。详见 `research/backfill-volume.md`。
- [Claude Code 会话日志的用量解析规则](map-issues/01-claude-log-format.md) — 用量在 assistant 行 `message.usage`（input / cache_read / cache_creation / output 含 thinking；`thinking_tokens` 仅新版有），去重键 `message.id` 且同一响应拆多行要**取组内最后一行**（参考项目取首行会少算）；resume 新文件整段复制旧历史并带 `forkedFrom`，跳过并用它关联新旧文件；轮次键 user 行 `promptId`，耗时 = 末条 assistant ts − 首条 user ts；子代理在 `<sessionId>/subagents/agent-*.jsonl`，计 usage 不计轮；跳过 `<synthetic>` model、`isCompactSummary`、tool_result 行。详见 `research/claude-log-format.md`。
- [Pi 与 OMP 会话日志的用量解析规则与后端字段](map-issues/03-pi-omp-log-format.md) — **OMP 每条 assistant 消息都带 `message.provider`**（Pi 同），可按后端拆来源，值需大小写归一化；usage 四列同名，推理列 Pi 叫 `reasoning`、OMP 叫 `reasoningTokens`，且是 output 子集（`totalTokens` = 四列和）；去重键顶层 8 位 hex `entry.id` 必须跨文件（OMP 分支/续接会整段复制父会话条目）；header `type:"session"` Pi 第 1 行、OMP 第 2 行，cwd 必须读 header；子 agent 在同名同级目录，同 cwd 同来源；每轮 = user 到下一 user，assistant `message.timestamp` 是请求开始、`entry.timestamp` 是写盘；Paseo OMP 侧 `OMP_AGENT_DIR/OMP_SESSION_DIR` 上游不存在，真值是 `PI_CONFIG_DIR`/`OMP_PROFILE`/`XDG_DATA_HOME/omp/sessions`，且 `provider-config.ts:140` 的默认字面量让后续分支不可达。详见 `research/pi-omp-log-format.md`。
- [Codex rollout 文件的用量解析规则](map-issues/02-codex-rollout-format.md) — 文件名 UUID = `session_meta.payload.id`（thread id），`archived_sessions/` 要一并扫并按 thread id 去重，上游还有 `.jsonl.zst`；`token_count.info.last_token_usage` 的 input 含 cached、total = input + output（reasoning 已含在 output，计价记 0）；`total_token_usage` 是进程内累计、resume 后归零，**只计 last、不做 total 差分**，相邻重复签名去重；model 只来自 `turn_context.payload.model`；cwd 取 `session_meta` 并按 `turn_context` 覆盖；轮次 = `task_started{turn_id}` 到 `task_complete/turn_aborted`，用户提示行需排除 AGENTS.md/skill 注入；0.153.2 起有 `token_usage_record`（含 turn_id/response_id）优先消费、旧文件回退 `token_count`。详见 `research/codex-rollout-format.md`。
- [存储行 schema、桶粒度与内存聚合结构](map-issues/07-storage-and-aggregation.md) — 成本不落盘、查询时算；UTC 15 分钟桶；行 = 键 `(cli, backend, model, sessionId, cwd, bucket)` 的增量，五列 token（input 为非缓存输入）+ turns + durationMs，轮按开始时间归桶；同键启动相加、比例 >2 原子压缩；游标按 `(cli, sessionId)` 身份记于 `usage/scan-state.json`，兼作 sessionId→路径索引，重写场景接受重复计数；全量进内存；一个 `UsageStore` 四方法（loadRows/appendRows/loadScanState/saveScanState）。
- [用量查询协议与跨 Host 合并](map-issues/08-protocol-and-cross-host.md) — 三个 RPC：`usage.report.get`（一次返回全部区块，请求带本地日期闭区间 + IANA 时区 + 来源/模型/项目筛选 + 趋势粒度与堆叠维度，模型与项目**全量**返回）、`usage.sessions.list`（一行一 (会话, 本地日)，每天上限 500）、`usage.agent.get { agentId }`（Composer 条，daemon 自行按 provider session id 求和）；广播 `usage.backfill.progress` 与 `usage.updated`。聚合在 daemon 内存算、成本查询时算；跨 Host 只在客户端相加，项目**不跨 Host 合并**（带 Host 徽标）、Top 10 合并后再截；项目归属 = 注册表 → git 根 → cwd 本身；一个 flag `features.usage`，旧 daemon 标「需要更新主机」、未连接标「未计入」。
- [计价：内置快照、自动更新、用户覆盖与匹配顺序](map-issues/09-pricing-model.md) — 快照与缓存共用 `PricingTable`（美元/每 token 原值），缓存 `usage/pricing-cache.json` 与快照取 `fetchedAt` 新者；启动 30 秒后检查、24 小时一次、ETag 条件 GET、失败 1 小时退避；配置 `features.usage.pricing.{autoUpdate, overrides}` 走 `set_daemon_config`；覆盖只做精确匹配、存每百万、不限来源；读 `usage.pricing.list`、刷新 `usage.pricing.refresh`、广播 `usage.pricing.updated`；匹配：覆盖 → 原样/小写 → Claude 归一化 → 去日期 → 剥路径末段 → 按 provider 偏好序挑 `/<末段>` 键 → 未命中 $0 标「无价格数据」。
- [Paseo 会话到日志的映射与每轮耗时规则](map-issues/10-session-mapping-and-duration.md) — agent 记录加顶层 `providerSessionIds`（Backing sessions），在 `refreshSessionPersistence` 换 id 时追加，旧记录读时补 `[persistence.sessionId]` 并沿 scan-state 的 `forkedFromSessionId` 链补全；游标条目新增 `forkedFromSessionId`/`firstAt`/`lastAt`/`openTurn`；Composer 求和 = 链内全部行，`complete` = 回填非 running 且每个 id 有游标，运行中一轮本地秒表叠加；轮起点 = 用户提交（Codex 用 `task_started`）、终点 = 本轮最后一条消息条目，等待全计入，`turns` 首条 assistant 时记、`durationMs` 按终止标记/下一 user/静止 10 分钟增量追加，子代理不计轮；会话行追加 `handle`/`importedAgentId`/`importedAgentWorkspaceId`，Claude resume 链合并为一行、sessionCount 按链计。
- [「用量」页的布局原型](map-issues/12-usage-page-prototype.md) — 视觉整体照抄参考项目 TokenTracker：左 4 / 右 8，左列统计面板 / 热力图（固定 26 周、周一起）/ 趋势（按来源堆叠，可切按模型）/ Plan usage，右列总览（周期页签 + 72px 大数字 + 来源分布条 + 来源卡片，点卡片展开模型明细）+ 数据明细（每日细目可展开会话 / 按月 / 项目 Top 3·6·10）；**价格表挪到主机设置页**；Host 筛选在总览头部下拉、不可用主机灰化带 pill；回填只是一枚琥珀 pill；08 号响应加 `heatmapDays`；来源固定色表。原型 `prototype/usage-page.html`。
- [刷新触发、兜底扫描与历史回填调度](map-issues/11-refresh-and-backfill.md) — 用量服务全局 `agentManager.subscribe` 消费 turn 终止事件做定向解析（Claude 拼项目目录、Pi/OMP 用 `nativeHandle`、Codex 按 thread id 在今昨两日目录找），读到 EOF 轮未闭合则 2 秒/10 秒各重试一次；周期扫描常量 60 秒（env `PASEO_USAGE_SCAN_INTERVAL_MS`）递归 stat 四根 `.jsonl` 比对 `(size, mtimeMs)`，兼做 10 分钟静止结算；**回填 = 启动后的第一轮扫描**，`backfill.state` 只随启动轮变化、按 mtime 倒序处理；串行 worker 两条队列（定向优先）、每文件 `setImmediate` 让路，中断仅 daemon 停止；批内行先游标后（崩溃窗口重复计数）；回填期间不发 `usage.updated`，之后每批按会话各发一条并反查 `agentId`；`start()` 同步加载后 RPC 即可用，接线在 ScheduleService 之后；不做采集开关；`.jsonl.zst` 跳过。
- [Composer 工具条本会话用量条原型](map-issues/13-composer-usage-strip-prototype.md) — **修订访谈 Q10**：会话内用量拆两处。每轮 token 与估算成本跟在 turn footer 的 "Worked for" 后（`· ↑14.3K ↓4.6K · $0.17`，同色同字号，hover 弹层按模型明细），会话合计放进上下文环形表弹层（上下文 → 本会话合计 → Plan usage）；环形表右侧加文字 `84K / 200K`，手机只留环。每轮数据源 = 日志解析时另落每轮行 + 新 RPC `usage.agent.turns.list`（修订 07，细节归 15 号票）；token 缩写统一 K/M/B 一位小数。原型 `prototype/composer-usage-strip.html`。
- [i18n 键的分组与 provider-usage copy.ts 迁入方式](map-issues/14-i18n-keys-and-copy-migration.md) — 顶层 `usage` 命名空间按区块分组（overview / stats / heatmap / trend / planUsage / details / sessionRow / hostFilter / backfill）+ `columns` 共用列名，不跨面复用、不往 `common` 加词；turn footer 键在 `message.turnUsage.*`（"Worked for" 一并迁入）、环形表弹层在 `contextWindow.sessionTotal.*` 并把 "Session cost" 改为 "Estimated cost"；价格表键 `settings.host.priceTable.*`，`settings.hostSections.usage` 显示改为 "Price table"；copy.ts 10 条迁 `usage.planUsage.*` 后删除，format.ts / card.tsx 英文改为描述对象；来源名与后端名表是客户端常量不进 i18n；9 语言各内联一次写齐；千分位 / 日期 / 星期走 `Intl` 按 UI 语言，K/M/B 与 $ 固定；zh-CN：套餐用量 / 轮次 / 热力图 / Token 不译。

- [每轮用量行的 schema、turnKey 与 `usage.agent.turns.list` 协议](map-issues/15-turn-usage-rows-and-rpc.md) — 每轮行 `usage/turns-YYYY-MM.jsonl`，键 `(cli, backend, sessionId, turnKey, model)` + 五列 token + `startedAt`/`lastAt`/`userMessageIds`/`turnId?`，与桶行同批写、同压缩、全量进内存；turnKey = Claude `promptId` / Codex `turn_id` / Pi·OMP user `entry.id`，子代理 usage 归父轮（有键用键、无键按时间包含）；对齐 = `turn_completed` 定向解析给该轮行打 Paseo `turnId` + 客户端按 `turnId` → user_message `messageId ∈ userMessageIds` 两级匹配，Codex 历史轮由 daemon 按 ±30 秒时间戳补 `turnId`；RPC 不分页回全部 Backing sessions 的轮，`durationMs = lastAt − startedAt` 派生；剩余雾（测试接缝、文档归属）留给 spec 阶段。

## Not yet specified

（已无待开票的雾。以下两条由 15 号票决定留给 `/atw-spec` 写 prd 时一并定，不再开票。）

- 测试接缝：进程内 daemon 夹具 + 临时目录假日志的粒度；解析器的样本夹具从哪来（脱敏真实日志片段）。
- 文档：`docs/data-model.md` 新增 usage 存储一节；是否需要 `docs/usage.md` 承载各 CLI 日志坑。

## Out of scope

- 供应商渠道及其归因（用户明确不做，`09-18-provider-channels` 已回退）。
- OpenCode、Copilot 的用量采集。
- 参考项目的排行榜、成就、菜单栏与小组件、桌面宠物、Skills、IP 检查、服务状态；热力图 3D 视图与趋势图放大弹窗（12 号票：v1 不做）。
- 会话效率、上下文健康度、年度总结、质量/美元、设备用量卡。
- 实付成本 / 订阅费摊销；只做估算成本。
- 数据保留期策略（不自动删除）。
- 日志文件被重写/截断时的精确撤销（每行带 fileId + 撤销行）；四家日志只追加，07 号票决定重置游标并接受重复计数。
- Composer 内的快速切换、运行中会话重启等与渠道相关的能力。
- Codex `.jsonl.zst` 压缩归档的解压与解析（11 号票：v1 跳过并记 info，本机 0 个）。
- 回填的手动暂停/取消与用量采集开关 `features.usage.enabled`（11 号票：采集只读、成本可忽略，常开）。
