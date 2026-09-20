# 04 — Pi 与 OMP 日志按后端拆来源进入用量报表

**What to build:** Pi 与 OMP 的会话出现在用量报表里，来源按路由到的后端拆分（`{cli:"pi", backend:"anthropic"}`、`{cli:"omp", backend:"openai"}`），OMP 分支 / 续接复制的父条目不重复计数，子 agent 归父会话。

**Status:** ready-for-agent
**Impl:** done

**Blocked by:** 01, 02

依据：spec 实现决策第 1 节（目录）、第 2 节 Pi/OMP 段、第 3 节；`research/pi-omp-log-format.md`。

- [x] 接缝 2：Pi 与 OMP 夹具覆盖——header 行号（Pi 第 1 行、OMP 第 2 行）与 cwd 读 header、`message.provider` 小写归一化、推理列 `reasoning` / `reasoningTokens` 两种、`entry.id` 跨文件去重（OMP 子文件按 `parentSession` 跳过复制条目）、轮 = user 到下一 user、轮起点 user 条目 ts、子 agent 目录（Pi `tasks/` 与嵌套 run、OMP 同名目录）归父会话不计轮。
- [x] 接缝 1：Pi 与 OMP 根目录来自 01 号票的解析函数与现有 Pi 解析；夹具根同时含 Pi 与 OMP 两种后端，`sources` 出现四个来源，每个来源的 `modelCount` 与占比全值正确。
- [x] 接缝 1：OMP 根目录里的 `.log` 文件不被扫描。
- [x] `npm run typecheck`、`npm run lint`，改动的测试文件通过。

## Comments

**票 01 实现与审查时发现** —— 两条关于 01 号票解析函数的注意事项：

- `resolveOmpSessionPaths`（`providers/omp/provider-config.ts`）只按上游环境变量解析，**不读** `settings.json` 的 `sessionDir`；读它的是 import 侧的 `resolveImportSessionsDir`。用 `settings.json` 把 sessions 搬走的用户，用量扫描会扫空。**已定（2026-09-19，用户）：按票面现状走，扫描侧不读 settings.json。** 口径与 spec 实现决策第 1 节「由入口按环境解析出默认值」一致，已写进 prd.md 第 1 节；代价是用 `settings.json` 搬走 sessions 的用户该来源为空，由 14 号票在 `docs/usage.md` 写明。本票不要顺手补读。
- 未复刻上游 `normalizeProfileName`（`pi-utils/dirs.ts`）：`..`、尾点、Windows 保留名在上游会退回默认 profile，Paseo 直接把 profile 名拼进路径。只影响只读扫描，边界极窄。

**本票实现与审查时定下** —— 去重口径与票面措辞不同，已回写 prd 第 2 节：

- 票面写「`entry.id` 跨文件去重」，prd 同段又要求解析器是不碰文件系统的纯函数，两句互斥。实现按后者：OMP header 带 `parentSession` 时，早于 header `timestamp` 的条目一律跳过，不读父文件、不维护 id 集合。本机全量样本 263 条副本全中、0 误伤。残留缺口（父文件不在被扫描根下时少计）由 14 号票写进 `docs/usage.md`。
- 轮次终点只由消息条目推进，且终止后不关闭轮——`model_change` / `session_exit` 这类记账行在轮结束后还会写很久，会把墙钟撑长；同轮失败重试则要能再追加一段。夹具 `fixtures/pi/pi-retry-after-error.jsonl` 钉住这两条。
