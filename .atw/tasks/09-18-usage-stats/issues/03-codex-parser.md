# 03 — Codex rollout 日志进入用量报表

**What to build:** 本机 `~/.codex/sessions`（含 `archived_sessions/`）里的 Codex 会话出现在用量报表的 Codex 来源下，token、轮次、耗时、cwd、model 都正确；`.jsonl.zst` 被跳过并只记一次 info。

**Status:** ready-for-agent
**Impl:** doing

**Blocked by:** 02

依据：spec 实现决策第 2 节 Codex 段、第 3 节；`research/codex-rollout-format.md`。

- [ ] 接缝 2：Codex 夹具覆盖——`token_usage_record` 优先与旧文件回退 `token_count`、只计 `last_token_usage` 不做 total 差分（resume 后 total 归零）、相邻重复签名去重、`info=null` 跳过、`input = input − cached`、`cache_write` 缺失按 0、reasoning 计入 output、model 取最近在前的 `turn_context`（无则 `unknown`）、cwd 按 `turn_context` 覆盖、轮 = `task_started` → `task_complete/turn_aborted`、子线程文件不计轮。
- [ ] 接缝 1：夹具根含 `sessions/YYYY/MM/DD/` 与 `archived_sessions/` 同一 thread id 的两份文件，报表只计一次；一个 `.jsonl.zst` 文件被跳过，daemon 日志一条 info。
- [ ] 接缝 1：Claude 与 Codex 夹具同在，`sources` 有两个来源，占比全值正确。
- [ ] `npm run typecheck`、`npm run lint`，改动的测试文件通过。
