# 接口相关请求补上 Osuna 的 User-Agent

## Goal

docs/usage.md 说接口相关请求自报 Osuna 身份，但拉模型清单（upstream-models.ts:140-142）、测试连接（upstream-connection.ts:133-155）、厂商状态页（vendor-status.ts:230-233）和各套餐用量插件都没设 User-Agent，发出的是 Node 默认值。补上 Osuna/<version> 或改文档。来源：子任务 10-16-endpoint-balance 访谈 Q9（2026-10-22）。

- 2026-10-22 补记：Codex 套餐用量来源查 `chatgpt.com/backend-api/wham/usage` 时写的是浏览器的 `User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)`（`plugins/codex-usage-source/server/usage.ts` 的 fetchUsage），与总任务第 15 条「不冒充别的软件」相冲；改之前先查清上游为什么这样写（可能是 chatgpt.com 拦非浏览器请求）。

## Requirements

- TBD

## Acceptance Criteria

- [ ] TBD

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, slice the work into `issues/NN-slug.md` tickets before `task.py start`.
