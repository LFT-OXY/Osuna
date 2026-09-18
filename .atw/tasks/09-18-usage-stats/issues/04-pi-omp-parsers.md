# 04 — Pi 与 OMP 日志按后端拆来源进入用量报表

**What to build:** Pi 与 OMP 的会话出现在用量报表里，来源按路由到的后端拆分（`{cli:"pi", backend:"anthropic"}`、`{cli:"omp", backend:"openai"}`），OMP 分支 / 续接复制的父条目不重复计数，子 agent 归父会话。

**Status:** ready-for-agent
**Impl:** ready

**Blocked by:** 01, 02

依据：spec 实现决策第 1 节（目录）、第 2 节 Pi/OMP 段、第 3 节；`research/pi-omp-log-format.md`。

- [ ] 接缝 2：Pi 与 OMP 夹具覆盖——header 行号（Pi 第 1 行、OMP 第 2 行）与 cwd 读 header、`message.provider` 小写归一化、推理列 `reasoning` / `reasoningTokens` 两种、`entry.id` 跨文件去重（OMP 子文件按 `parentSession` 跳过复制条目）、轮 = user 到下一 user、轮起点 user 条目 ts、子 agent 目录（Pi `tasks/` 与嵌套 run、OMP 同名目录）归父会话不计轮。
- [ ] 接缝 1：Pi 与 OMP 根目录来自 01 号票的解析函数与现有 Pi 解析；夹具根同时含 Pi 与 OMP 两种后端，`sources` 出现四个来源，每个来源的 `modelCount` 与占比全值正确。
- [ ] 接缝 1：OMP 根目录里的 `.log` 文件不被扫描。
- [ ] `npm run typecheck`、`npm run lint`，改动的测试文件通过。
