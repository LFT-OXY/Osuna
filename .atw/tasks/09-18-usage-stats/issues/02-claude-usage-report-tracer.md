# 02 — 服务端 tracer：Claude Code 日志 → 用量报表

**What to build:** daemon 启动后扫描本机 Claude Code 会话日志，把每条 assistant 消息的五列 token 与每轮的轮次 / 耗时归到 (来源, 模型, 会话, 目录, UTC 15 分钟桶)，落盘到 `$PASEO_HOME/usage/`，重启后不重复计数；客户端通过 `usage.report.get` 拿到按本地时区分组的完整报表（汇总、来源、模型、日、月、趋势、热力图、项目、回填状态），并通过 `usage.backfill.progress` 看到回填进度；`server_info.features.usage` 为 true。估算成本本票一律为 0、`priced=false`（计价归 05 号票）。

**Status:** ready-for-agent
**Impl:** doing

**Blocked by:** None — can start immediately

依据：spec 实现决策第 1、2（Claude 段）、3、4、5、7 节；`research/claude-log-format.md`、`research/backfill-volume.md`、`research/file-observer-fit.md`。

范围内：

- daemon 运行时配置新增 `usage` 段（四个日志根、扫描间隔、pricing fetch 与 autoUpdate 占位），入口按各 CLI 环境规则解析默认值，测试 daemon 选项透传。这是全任务唯一的测试注入点。
- `UsageStore` 四方法：`loadRows()`（含同键相加与 > 2 倍时的原子压缩）、`appendRows(rows)`、`loadScanState()`、`saveScanState(state)`。桶行文件 `buckets-YYYY-MM.jsonl`、游标 `scan-state.json`。
- Claude 解析器为纯函数：按 `\n` 字节切行、半行留存；`message.id` 组内取最后一行；跳过 `forkedFrom` 行并记 `forkedFromSessionId`；跳过 `<synthetic>`、`isCompactSummary`、tool_result 型 user 行与非 user/assistant 行；`subagents/` 文件归父会话、不计轮；轮键 `promptId`、起点首条 user ts、`turns` 在首条 assistant 时 +1、`durationMs` 按终止标记 / 下一 user / 静止 10 分钟分次追加，未结算轮存游标 `openTurn`。
- 扫描 worker：启动轮 = 回填（mtime 倒序、每文件 `setImmediate` 让路、每 20 文件或 500 毫秒一批、先行后游标）；周期扫描 60 秒（`PASEO_USAGE_SCAN_INTERVAL_MS` 覆盖，时钟注入）比对 `(size, mtimeMs)`；根不存在静默跳过；`dispose()` 等当前文件完成。
- `usage.report.get` 全部区块（含 `heatmapDays` 最近 182 天、`last7Days/last30Days`、粒度默认规则、项目归属 = 注册表 → git 根 → cwd）；`usage.backfill.progress` 广播 ≥ 1 秒一次；`features.usage` 带 COMPAT 标签；接线在 ScheduleService 之后。
- 协议 schema 一次写全（含本票不填的成本字段），遵守 `docs/protocol-validation.md` 纯净规则；`docs/data-model.md` 目录树与 Usage 一节先写桶行与游标。

范围外：定向解析与 `usage.updated`（07）、每轮行（06）、计价（05）、其他三家（03、04）。

- [ ] 接缝 2：Claude 夹具（脱敏真实片段，每个坑一份：多行同 id 取尾、`forkedFrom` 跳过、synthetic、子代理归父、U+2028 切行、半行续读、轮次与耗时）→ 解析器输出全值断言。
- [ ] 接缝 1：临时 `PASEO_HOME` + 夹具根目录起 daemon，`usage.report.get` 的 `summary / sources / models / days / months / heatmapDays / projects` 全值正确；同一夹具换 `timezone`（含 +05:30）后 `days` 分法正确。
- [ ] 接缝 1：回填期间收到 `running` 进度事件，结束时 `done`；daemon 关闭后以同一 `PASEO_HOME` 重启，报表不变、`buckets-*.jsonl` 不新增行。
- [ ] 接缝 1：往夹具文件追加行后，注入时钟推进一个扫描周期，报表增量正确；截断文件后重置游标、报表重算、日志里有一条 warn。
- [ ] 接缝 1：某月文件行数超过唯一键两倍时启动后被重写为每键一行，报表不变。
- [ ] 旧客户端连接不报协议错误（`features.usage` 为新可选字段）。
- [ ] `npm run typecheck`、`npm run lint`，改动的测试文件通过。
