# 11 — 数据明细：每日细目可展开会话、按月、项目 Top 10

**What to build:** 「用量」页右列「数据明细」卡三页签可用。每日细目表（日期 / 总计 / 输入 / 输出 / 缓存 / 推理 / 会话 / 估算成本）点行展开当天会话列表（来源图标、标题、来源 pill、多主机时主机徽标、项目 · 模型 · 时间 · 时长、↑↓缓存明细、Token / 成本 / 轮次、「打开」按钮：已导入打开 agent，否则像 Session history 一样终端 resume）；按月表；项目用量（前 3 / 6 / 10 分段、首字母头像、非 git 标签、主机徽标、来源小图标、点行展开 cwd）。服务端补 `usage.sessions.list`。

**Status:** ready-for-agent
**Impl:** ready

**Blocked by:** 07, 08

依据：spec 实现决策第 6 节（会话行）、第 7 节 `usage.sessions.list`、第 9 节数据明细；10 号决策票第 5 节；原型 `prototype/usage-page.html` 右列。

范围内（服务端）：`usage.sessions.list` 一行一 (会话, 本地日)、token 只算当天、按 `lastAt` 倒序、每天 500 行截断带 `truncated`；Claude resume 链合并为一行归最新 id；`handle`（Claude/Codex = sessionId，Pi/OMP = 游标索引反查路径，查不到 null）、`importedAgentId` / `importedAgentWorkspaceId`（按 Backing sessions 任一 id 匹配）；`summary.sessionCount` 按链计。

范围内（客户端）：三页签、会话行复用 Session history 的打开 / 导入逻辑、项目 Top N 在跨主机合并后截取、`usage.details.* / usage.sessionRow.*` 键 9 语言。

- [ ] 接缝 1：跨天的夹具会话在 `usage.sessions.list` 里是两行且各自 token 只算当天；Claude 两个 `forkedFrom` 相连的文件合并为一行、`sessionId` 为最新、`summary.sessionCount` 为 1；某天塞入 501 个会话时返回 500 行 + `truncated=true`；导入过的会话带 `importedAgentId`。
- [ ] 接缝 3：点某日行展开，会话行文字（来源、项目、模型、Token、轮次）正确；点「打开」对未导入的 Claude 会话打开终端 tab（参照 Session history 现有断言）；对已导入会话切到该 agent。
- [ ] 接缝 3：按月页签数字正确；项目页签切「前 3」只剩三行，点行展开 cwd。
- [ ] 接缝 2：项目 Top N 合并 + 截取函数、会话行按天分组函数全值用例。
- [ ] 资源测试通过；`npm run typecheck`、`npm run lint`，改动的测试与 Playwright spec 通过。
