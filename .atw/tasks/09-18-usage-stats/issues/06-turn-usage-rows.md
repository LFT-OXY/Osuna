# 06 — 每轮用量行：四家解析器另落 Turn usage

**What to build:** 四家解析器在桶行之外为每一轮各输出一份每轮行（键 `(cli, backend, sessionId, turnKey, model)`，五列 token + `startedAt` / `lastAt` / `userMessageIds` / `turnId?`），落盘到 `usage/turns-YYYY-MM.jsonl`，与桶行同批写、同压缩规则、启动全量进内存并建 `(cli, sessionId) → 轮列表` 索引；子代理 usage 归入父轮。本票只到存储与内存索引，RPC 归 07。

**Status:** ready-for-agent
**Impl:** doing

**Blocked by:** 03, 04

依据：spec 实现决策第 2、3、4 节；15 号决策票。

- [ ] 接缝 2：四家夹具各断言每轮行——Claude `turnKey=promptId`、`userMessageIds` 为该组全部 user 行 uuid，子代理按首条 user 行 `promptId` 归父轮；Codex `turnKey=turn_id`、`userMessageIds=[]`，≥0.153.2 子线程按 `root_turn_id` 归父轮；Pi/OMP `turnKey` 为开轮 user 条目 `entry.id`、`userMessageIds=[entry.id]`，`tasks/` 子会话按 header `timestamp` 落入父会话哪轮的 `[startedAt, lastAt]` 归哪轮，匹配不上只进桶行。
- [ ] 接缝 2：同一轮跨两次解析产生两条增量行，加载后合并为一条：token 相加、`startedAt` 取最小、`lastAt` 取最大、`userMessageIds` 并集、`turnId` 取非空。
- [ ] 接缝 1：daemon 以同一 `PASEO_HOME` 重启后 `turns-*.jsonl` 不新增行；行数超过唯一键两倍时被重写。
- [ ] 每轮行的 `lastAt − startedAt` 之和与同会话桶行 `durationMs` 之和相等（夹具级断言）。
- [ ] `docs/data-model.md` Usage 一节补每轮行 schema。
- [ ] `npm run typecheck`、`npm run lint`，改动的测试文件通过。
