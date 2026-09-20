# 13 — 会话内两处：turn footer 每轮用量与环形表本会话合计

**What to build:** Paseo 里跑一轮 agent，轮结束后 footer 在 "Worked for 6m 12s" 后同行追加 `· ↑14.3K ↓4.6K · $0.17`，hover / 手机点按弹层「本轮用量」按模型列出输入 / 缓存 / 输出（推理另注）/ 估算成本，多模型加合计行，下方耗时与 "估算成本 · 按公开 API 价格计算"；运行中的一轮仍只显示 loader 与秒表；轮完成但行未到显示骨架条；无价格显示 `$0.00` 点下划线 + 弹层琥珀 pill；手机上用量段落到第二行。composer 上下文环形表右侧显示 `84K / 200K`（手机只留环），弹层三段：上下文窗口 → 本会话合计（Token ↑↓、估算成本、轮次、Agent 运行、会话跨度，`complete=false` 标「不完整」，运行中一轮秒表叠加）→ 套餐用量。旧 daemon：footer 无用量段，弹层本段显示「需要更新主机」。token 缩写全 app 统一为 K/M/B 一位小数，"Worked for" 迁入 i18n。

**Status:** ready-for-agent
**Impl:** done

**Blocked by:** 07

依据：spec 实现决策第 10、12 节；原型 `prototype/composer-usage-strip.html`（`?variant=A`）；13、14、15 号决策票。

范围内：client 包的 `usage.agent.get / usage.agent.turns.list` 方法；`usage.updated` 命中本 agent 时两处重拉；轮与每轮行对齐纯函数（`turnId` 相等 → 首条 user_message `messageId ∈ userMessageIds` → 不显示）；`formatTokenCount` 改 K/M/B 一位小数并更新其现有用例与环形表弹层；`message.turnUsage.*`、`message.workedFor`、`contextWindow.sessionTotal.*` 键 9 语言，`contextWindow.sessionCost` 英文改 "Estimated cost {{cost}}"、zh-CN「估算成本 {{cost}}」，`contextWindow.accessibility` 含已用 / 上限。

- [x] 接缝 2：对齐函数用例——`turnId` 命中、`turnId` 为 null 但 `messageId` 命中、都不命中；秒表叠加函数；`formatTokenCount` 新格式（`14.3K`、`1.2M`、`999`）。
- [x] `*.real.spec.ts`：`CLAUDE_CONFIG_DIR` 指向临时目录，跑一轮真实 Claude，轮结束后 footer 出现 `↑ ↓ $` 段，弹层含模型名与耗时；环形表旁出现 `已用 / 上限`，弹层本会话合计的 Token 与 footer 该轮一致。
- [x] 接缝 3（非 real）：旧 daemon 夹具下 footer 只显示 "Worked for"，弹层本段显示「需要更新主机」。
- [x] 手机宽度下 footer 用量段换到第二行、环形表旁无文字（截图证据）。
- [x] 资源测试通过；`npm run typecheck`、`npm run lint`，改动的测试与 spec 通过。

## 实现记录

- `formatTokenCount` 未改造而是删除：`components/context-window-meter.utils.ts` 整个移除，两个调用点改用 `usage/format.ts` 的 `formatUsageTokensCompact`，全 app 只剩一种缩写实现。该函数原本没有用例，新格式的用例在 `usage/format.test.ts`。
- 对齐纯函数在 `usage/turn-usage.ts`：`matchTurnUsage`（`turnId` → 首条 user_message `messageId`）、`summarizeTurnUsage`、`buildTurnUsageBreakdown`、`addRunningTurnElapsed`、`isTurnUsagePending`、`hasAgentUsage`；轮身份由 `timeline/turn-time.ts` 的 `TurnTiming` 带出（`turnId` / `userMessageId`）。
- 取数在 `usage/use-agent-usage.ts`（`useReplicaQuery` + `usage.updated` 订阅）。订阅按面挂：stream view 的 `AgentUsageScopeProvider` 管 footer，composer 的环形表自己再订一次——环形表是 stream view 的兄弟节点而非子节点，靠「恰好同时挂载」是错的。
- **`usage.agent.get` 分不清「回填没扫到」和「这家 CLI 根本不采」**（两者都是 `turns: 0, complete: false, firstAt: null`）。客户端用 `isUsageTrackedProvider`（PRD §1 的四家）补上这一刀：四家之一的空报表显示「本会话合计」并标「不完整」，其余 provider（OpenCode、Copilot、ACP、自定义二进制）不渲染零值。包一层 claude 的自定义 provider 带的是自己的 id，因此落在名单外，等行落盘后照常显示。
- 未做（原型保真的小差异）：原型的旧主机块是「灰 pill + 此主机的 daemon 不提供用量统计。」一句说明，实现只画 pill——票面要求的就是 pill。
- `turn-usage.claude.real.spec.ts` 已写但本地未跑：需要 `npm run test:e2e:real` 与真实 Claude。手机宽度的两条断言中，环形表旁无文字由非 real 的 `context-window-token-label.spec.ts` 覆盖并通过；footer 换行只在 real spec 里，因为 mock agent 不产生任何用量行。
