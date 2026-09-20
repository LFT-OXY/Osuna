# 01 — Claude Code 会话日志的用量解析规则

**Type:** research
**Blocked by:** None
**Status:** resolved

## Question

对着本机 `~/.claude/projects/**/*.jsonl` 的真实样本与参考项目 `rollout.js` 的 `parseClaudeFile` / `normalizeClaudeUsage`，确定：(1) 带用量的行长什么样（`message.usage` 的字段、`output_tokens` 是否含 thinking/reasoning、是否有 `cache_creation` 的 5m/1h 细分）；(2) 去重键（`message.id`、`requestId`、同一 message 多行的情况）；(3) model 字段位置与可能取值（含 `<synthetic>` 等要跳过的值）；(4) cwd、sessionId、timestamp 的位置；(5) resume 换 sessionId 后新文件如何与旧文件关联（有无 `parentUuid`/`leafUuid` 跨文件引用）；(6) 每轮耗时推导：用户 prompt 行与该轮最后一行的时间戳如何判定轮次边界；(7) 子代理（Task 工具）的 transcript 是否在同一文件或子目录，是否要计入。产出 `research/claude-log-format.md`，附字段表与 3 条脱敏样例行。

## Answer

笔记：`research/claude-log-format.md`（字段表、3 条脱敏样例、每条结论的样本行号 / `rollout.js` 行号）。要点：

1. 用量在 `type:"assistant"` 行的 `message.usage`：`input_tokens` / `cache_read_input_tokens` / `cache_creation_input_tokens`（细分 `cache_creation.ephemeral_5m|1h_input_tokens`，和恒等于总数）/ `output_tokens`（**含 thinking**）/ `output_tokens_details.thinking_tokens`（仅 2.1.258，2.1.220 无此字段，reasoning 记 0）。model 在 `message.model`；cwd、sessionId、timestamp（ISO UTC）、uuid/parentUuid、requestId 都在行顶层。
2. 去重键 `message.id`；一个响应按 content block 拆成多行、usage 逐行复制，且前几块可能是流式快照（output 1-6），**组内取最后一行**（3603/3603 最后一行即最大值）。参考项目取第一行，子代理文件上会少算，不照抄。需跨文件去重。
3. resume（Paseo 走 SDK，`entrypoint:"sdk-cli"`）会新建 sessionId 文件并把旧历史整段复制进来，复制行带 `forkedFrom:{sessionId,messageUuid}`，message.id 与旧文件 100% 重叠：**跳过带 forkedFrom 的行**，用 `forkedFrom.sessionId` 关联新旧文件。无 leafUuid 跨文件引用。
4. 轮次键 = user 行 `promptId`（prompt 与伴随 meta 行共用）；轮 = 含 ≥1 条 assistant 的 promptId 组；耗时 = 最后一条 assistant 行 ts − 首条 user 行 ts。cli 入口另有 `system/turn_duration.durationMs` 可校验（偏差中位数 −30 ms），SDK 入口没有，必须用时间戳推导。
5. 子代理在 `<sessionId>/subagents/agent-<id>.jsonl`（`isSidechain:true`、`agentId`、sessionId=父），主文件不含其 usage：**计 usage（归父 session/cwd，按自身 model）、不计轮次**。
6. 跳过：`<synthetic>` model（API 错误行，usage 全 0，无 requestId）、`isCompactSummary` user 行、tool_result user 行（不计轮）、所有非 user/assistant 类型行（`attachment`、`system`、`cost-state`、`last-prompt` 等）。压缩那次调用没有 usage 行，是已知缺口。`cost-state` 只能作无子代理会话的测试期望值，不能当真值。
