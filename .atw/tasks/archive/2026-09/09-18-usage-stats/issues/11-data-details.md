# 11 — 数据明细：每日细目可展开会话、按月、项目 Top 10

**What to build:** 「用量」页右列「数据明细」卡三页签可用。每日细目表（日期 / 总计 / 输入 / 输出 / 缓存 / 推理 / 会话 / 估算成本）点行展开当天会话列表（来源图标、标题、来源 pill、多主机时主机徽标、项目 · 模型 · 时间 · 时长、↑↓缓存明细、Token / 成本 / 轮次、「打开」按钮：已导入打开 agent，否则像 Session history 一样终端 resume）；按月表；项目用量（前 3 / 6 / 10 分段、首字母头像、非 git 标签、主机徽标、来源小图标、点行展开 cwd）。服务端补 `usage.sessions.list`。

**Status:** ready-for-agent
**Impl:** done

**Blocked by:** 07, 08

依据：spec 实现决策第 6 节（会话行）、第 7 节 `usage.sessions.list`、第 9 节数据明细；10 号决策票第 5 节；原型 `prototype/usage-page.html` 右列。

范围内（服务端）：`usage.sessions.list` 一行一 (会话, 本地日)、token 只算当天、按 `lastAt` 倒序、每天 500 行截断带 `truncated`；Claude resume 链合并为一行归最新 id；`handle`（Claude/Codex = sessionId，Pi/OMP = 游标索引反查路径，查不到 null）、`importedAgentId` / `importedAgentWorkspaceId`（按 Backing sessions 任一 id 匹配）；`summary.sessionCount` 按链计。

范围内（客户端）：三页签、会话行复用 Session history 的打开 / 导入逻辑、项目 Top N 在跨主机合并后截取、`usage.details.* / usage.sessionRow.*` 键 9 语言。

- [x] 接缝 1：`usage-sessions.e2e.test.ts` —— 跨天会话两行且各自只算当天（全值断言整行）、时区换算、区间收窄；`forkedFrom` 相连的两份 transcript 合并为一行归最新 id 且 `summary.sessionCount` / `days[].sessionCount` 为 1；`handle` 回传；假 agent 创建后其会话带 `importedAgentId`。
- [x] 接缝 2：每天 500 行截断在 `server/usage/sessions.test.ts` 验（501 份真实 transcript 夹具不值当，已写进 spec 的测试决策）。
- [x] 接缝 3：`usage-page-details.spec.ts` —— 展开某日读会话行（来源、项目、模型、轮次数与每日细目一致）、再点折叠；按月页签数字；项目页签前 3 / 前 10 与展开 cwd。
- [x] 接缝 3：`usage-page-session-open.spec.ts` —— 真 workspace + 指向它的 transcript，点「打开」真开出终端并跳到该 workspace。「已导入 → 切 agent」不在浏览器里验（要真 Claude 才能造出带用量的已导入 agent），由接缝 1 的 `importedAgentId` 与接缝 2 的 `resolveUsageSessionAction` 覆盖。
- [x] 接缝 2：`usage/details.test.ts`（项目 Top N 截取 + 条形基准、页签键存在性）、`usage/sessions.test.ts`（跨主机合并与行 key）、`usage/open-session.test.ts`（打开动作的六种结果）、`usage/aggregated-sessions.test.ts`（按天取数、部分主机失败、全失败抛错）。
- [x] 资源测试通过；`npm run typecheck`、`npm run lint` 干净；server / protocol / client / app 相关套件与三个 Playwright spec 通过。

## Comments

- 会话行不带标题：prd §7 的行形状里没有 title，daemon 也不存消息文本（用户 2026-09-19 决定）。行改为以项目名领头。
- 代码审查（Standards + Spec 两轴）提出 13 条，已全部处理；两条明确不做并写进 spec：500 行截断留在接缝 2、「已导入 → 切 agent」不进浏览器 spec。
