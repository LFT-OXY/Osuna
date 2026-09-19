# 11 — 刷新触发、兜底扫描与历史回填调度

**Type:** interview
**Blocked by:** 06, 07
**Status:** resolved

## Question

定：`turn_completed` 触发该会话文件增量解析的接线点；是否接 file-observer 还是 mtime 轮询、兜底周期；首次回填的调度（后台低优先级、批大小、可中断续跑；进度线上形状已由 08 号票定为报表内 `backfill` 字段 + 广播 `usage.backfill.progress`，本票只定何时发、发什么值）以及 `usage.updated` 广播的触发点与节流；回填与增量并发时的游标一致性；daemon 重启后的恢复。

## Answer

访谈一轮十题，全部按推荐通过（2026-09-18）。

### 1. `turn_completed` 接线与文件定位

- 用量服务在 bootstrap 里 `agentManager.subscribe(cb, { replayState: false })` 做全局订阅（范例 `persistence-hooks.ts:50`），只消费 `agent_stream` 里的 `turn_completed`、`turn_failed`、`turn_canceled`（三者都触发 `durationMs` 结算）。不在 `onStreamTurnCompleted` 内部加钩子。
- 文件定位取 Backing sessions **末项** id：Claude `claudeProjectDirSync(cwd)/<sessionId>.jsonl`（`claude/agent.ts:5038`）；Pi/OMP `persistence.nativeHandle` 即路径；Codex 先查 scan-state 索引，未命中在 `sessions/<今天>` 与 `<昨天>`（本地日期目录）下按 `rollout-*-<threadId>.jsonl` 找，仍未命中放弃、留给周期扫描。

### 2. 事件早于落盘

定向解析立即执行；读到 EOF 时 `openTurn` 仍未闭合（CLI 尚未写完）→ 2 秒后重试一次、再 10 秒一次，之后交给周期扫描。未实测 SDK/app-server 的写盘时序，此规则同时覆盖"已落盘"和"慢落盘"。

### 3. 周期扫描（Usage scan）

- 每 60 秒对四个根递归 readdir + stat 全部 `.jsonl`，与 scan-state 的 `(size, mtimeMs)` 比对，变化或新增入队；根不存在静默跳过、下轮再试。同轮顺带执行 10 号票的"mtime 静止超 10 分钟结算 `openTurn`"。
- 间隔为常量 60 秒，环境变量 `PASEO_USAGE_SCAN_INTERVAL_MS` 覆盖（测试/调试用），不进 `set_daemon_config`、无 UI。定时器写法同 `workspace-reconciliation-service.ts:174-178`（`setInterval` + `unref` + `clock` 注入）。

### 4. 回填（Backfill）= daemon 启动后的第一轮扫描

- 启动时 `loadRows()` + `loadScanState()` 后跑一遍与第 3 条完全相同的扫描；首次启动即全量回填，重启后只剩无游标/有变化的文件，"可中断续跑"不需要额外机制。
- `backfill.state`：`idle` = 启动轮尚未开始；`running` = 启动轮队列未清空；`done` = 启动轮清空。后续周期扫描不改变它。`filesTotal/filesDone` 只统计启动轮入队的文件；`startedAt` 为启动轮开始时刻。
- 处理顺序按文件 mtime **倒序**，最近会话先出数据。

### 5. 优先级与可中断

- 一个串行 worker、两条队列：定向解析优先，扫描/回填其次；队列按 `(cli, sessionId)` 去重，后台队列中的文件被定向触发时提升到优先队列。每处理完一个文件 `await setImmediate()` 让路（05 号票）。
- "可中断"仅指 daemon 停止：`dispose()` 置停止标志，等当前文件处理完并落一次游标后返回。**不做用户手动暂停/取消**。

### 6. 落盘顺序与崩溃语义

每 20 文件或 500 毫秒一批，批内 `appendRows(rows)` 成功后再 `saveScanState()`。两步之间崩溃 → 重启后重读该批、重复计数（窗口 ≤ 500 毫秒），与 07 号票"重写场景接受重复计数"同口径；否决"先游标后行"（永久漏计，不可修正）。

### 7. `usage.updated` 发送规则

- 启动轮期间**不发** `usage.updated`，只发 `usage.backfill.progress`（≥ 1 秒一次），`done` 时页面重拉。
- 启动轮结束后，每批落盘完成后按受影响的 `(cli, sessionId)` **各发一条**。`agentId`：定向解析带触发它的 agent；周期扫描命中的文件反查 Backing sessions 含该 id 的 agent，有则带上（10 分钟静止结算也能刷新 Composer 条）。服务端不再节流，靠 08 号票定的客户端去抖。

### 8. 启动与关闭顺序

- `start()` 同步 `await` 完成 `loadRows()` + `loadScanState()`（百毫秒级），启动轮在后台跑；RPC 立即可用，回填未完成时报表从内存返回、`backfill.state` 为 `running`。
- 接线在 `ScheduleService`（`bootstrap.ts:1332`）之后、需 `wsServer` 已创建（用 `wsServer.broadcast`，`websocket-server.ts:935`）；关闭在 `scheduleService.stop()` 之后、`wsServer.close()` 之前 `dispose()`（`bootstrap.ts:1794-1797`）。

### 9. 不做采集开关

功能随 daemon 常开（每分钟约 20-50 毫秒只读 I/O）。第一轮访谈 Q12 的"首次启用"读作"首次以带此功能的版本启动"。若将来要开关，08 号票的报表响应需补 `disabled` 状态。

### 10. 文件发现边界

根目录取自 01/02/03 号票：Claude `$CLAUDE_CONFIG_DIR || ~/.claude/projects`（含 `<sessionId>/subagents/`）；Codex `~/.codex/sessions` + `archived_sessions`；Pi `resolvePiSessionsDir`；OMP 按 03 号票纠正后的 `PI_CONFIG_DIR / OMP_PROFILE / XDG_DATA_HOME` 规则。只认 `.jsonl`（忽略 `.log`、`.json`、`.zst`）；Codex `.jsonl.zst` v1 不解压，跳过并记一次 info，列入 Out of scope。

否决：在 agent-manager 内部直接调用用量服务；固定延迟 1 秒再解析；扫描间隔进 daemon 配置/UI；独立于启动轮的"回填"功能与手动暂停；先游标后行；回填期间逐条发 `usage.updated`；`features.usage.enabled` 开关。

## Comments

- 2026-09-18，由 15 号票补充：`turn_completed` 触发的定向解析闭合的那一轮，其每轮增量行带 Paseo `turnId`；批内桶行与每轮行同写。见 `map-issues/15-turn-usage-rows-and-rpc.md` 第 1、3 节。
