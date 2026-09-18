# 07 — 存储行 schema、桶粒度与内存聚合结构

**Type:** interview
**Blocked by:** 01, 02, 03, 05
**Status:** resolved

## Question

在 `$PASEO_HOME/usage/` 按月 JSONL 的前提下定：行字段的最终清单（五列 token、估算成本是否落盘还是查询时算、轮次数、耗时累加、cwd、sessionId、后端）；桶粒度是 UTC 小时还是半小时；多轮同桶的合并规则；游标文件的形状（inode + offset + 文件指纹）与截断/重写的处理；daemon 启动加载策略（全量进内存 vs 按月懒加载）；store 接口（遵守 Store Surface Rule）。以 05 的量级数字为约束。

## Answer

访谈一轮七题，全部按推荐通过（2026-09-18）。

1. **估算成本不落盘**，查询时按当前价格表现算。依据 Q17：用户在价格表区块补价后历史必须立即重算。行里不存"当时价格"，实付成本已明确不做。
2. **时间桶 = UTC 15 分钟**，`bucket` 存桶起点 ISO 字符串。覆盖 +5:30 / +5:45 / +12:45 等非整小时时区，行数约为小时桶的 2-3 倍，一年仍在十几 MB 内存量级。术语：时间桶叫 **usage bucket**；`docs/glossary.md` 的 Usage source 词条已把"bucket"改成"source"，并删掉"无后端字段退化单桶"（03 号票证实 Pi/OMP 100% 带后端字段）。
3. **行 = 一次解析对一个键的增量**，键 `(cli, backend, model, sessionId, cwd, bucket)`：
   - `cli` `claude|codex|pi|omp`；`backend` 小写归一化后端名，claude/codex 为 null（两列，不拼成一列 `source`）
   - `model` 日志原样，归一化留给计价匹配
   - `sessionId` provider 自己的 id：Claude sessionId、Codex thread id、Pi/OMP header `id`
   - `cwd` 绝对路径
   - `input` **非缓存输入**（Codex 用 input − cached 统一口径）、`cachedInput`、`cacheWrite`（Codex 按 0）、`output`（含推理）、`reasoning`（output 子集，只作展示，Claude 旧版记 0）
   - `turns` 本桶内**开始**的轮次数，`durationMs` 这些轮耗时合计；轮按用户消息时间归桶，token 按各条 assistant 消息自身时间戳归桶，跨桶的轮不拆
   - 子代理行归父 session/cwd、按自身 model、`turns` 为 0；不存 host、成本、文件路径
4. **同键多行启动时相加**；月文件按桶所属月分文件（回填会写历史月）；load 时某月文件行数 > 唯一键数 × 2 则原子重写为每键一行。v1 就带压缩。
5. **游标按文件身份记**，键 `(cli, sessionId|thread id)`，Claude 子代理文件用"父 sessionId + agentId"；值 `{ path, inode, size, mtimeMs, offset }`，`offset` 只推进到最后一个完整 `\n`。路径未知但身份已知且 `size ≥ offset` → 移动，更新 path 续读；`size < offset` 或 inode 变 → 重写，重置 offset 从头读，记一条 warn，**接受重复计数**（四家日志都只追加，正常运行不会发生）。不建全局去重集合：Claude 靠 `forkedFrom` 跳过，OMP 子文件按 `parentSession` 临时读父文件 id 集合。全部游标放 `usage/scan-state.json` 原子写，回填期间每 20 文件或 500 ms 落一次。**这份状态同时是 sessionId → 文件路径的索引**，10 号票复用，不另建会话索引。
6. **启动全量进内存**，按完整键保存（每日明细要展开到会话行），聚合在查询时扫内存算。不做按月懒加载。
7. **一个 `UsageStore` 管 `$PASEO_HOME/usage/` 两类文件、四个方法**：`loadRows()`（含第 4 条的压缩）、`appendRows(rows)`（按月分组各 append 一次，内部串行队列防增量与回填交错）、`loadScanState()`、`saveScanState(state)`（原子写）。内存聚合结构（暂名 `UsageIndex`）不进 store，由服务层组合；解析器状态、去重键不进 store。

否决的替代方案：成本落盘（参考项目做法）、小时/半小时桶、每行带 `fileId` + 撤销行做精确重写恢复（已列入 Out of scope）、按月懒加载、行与游标拆两个 store。

## Comments

- 2026-09-18，由 10 号票修订：游标条目新增 `forkedFromSessionId`（Claude）、`firstAt`/`lastAt`、`openTurn`；轮的 `turns` 在首条 assistant 时记入，`durationMs` 分次增量追加。见 `map-issues/10-session-mapping-and-duration.md` 第 2、4 节。

- 2026-09-18，由 13 号票修订：桶行之外**另落每轮行**（键含 `(cli, sessionId, turnKey, model)`），供 turn footer 显示每轮 token 与估算成本；schema 与 turnKey 归 15 号票。见 `map-issues/13-composer-usage-strip-prototype.md` 第 3 节。

- 2026-09-18，由 15 号票定稿：每轮行文件 `usage/turns-YYYY-MM.jsonl`，键 `(cli, backend, sessionId, turnKey, model)`，字段五列 token + `startedAt` / `lastAt` / `userMessageIds` / `turnId?`，与桶行同批 append、同压缩规则、启动全量进内存。见 `map-issues/15-turn-usage-rows-and-rpc.md` 第 1、6 节。
