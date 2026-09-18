# 02 — Codex rollout 文件的用量解析规则

**Type:** research
**Blocked by:** None
**Status:** resolved

## Question

对着本机 `~/.codex/sessions` 的真实样本与参考项目 `src/lib/codex-rollout-parser.js`，确定：(1) 文件命名与 `session_meta.payload.id`（thread id）的对应；(2) `token_count` 事件里 `info.last_token_usage` / `total_token_usage` 的字段与累计差分规则，`input_tokens` 是否含 cached；(3) reasoning 是否含在 output 里（计价时 reasoning 记 0）；(4) model 从哪读（`turn_context`?）、可能为空的情况；(5) cwd 来自 `session_meta.payload.cwd` 与 `turn_context` 覆盖；(6) 每轮边界：用户消息事件类型与时间戳；(7) Codex 版本差异（旧格式文件是否存在于本机）。产出 `research/codex-rollout-format.md`。

## Answer

完整笔记：`research/codex-rollout-format.md`（本机 77 个样本全量统计 + 参考项目 + Codex 上游源码 `codex-rs/protocol/src/protocol.rs`、`codex-rs/rollout/src/*`）。要点：

1. **命名与 thread id**：`sessions/YYYY/MM/DD/rollout-<本地时间>-<thread_id>.jsonl`（revert 时有 `_<rollout_id>` 变体，上游还支持 `.jsonl.zst`）；文件名 UUID 与首行 `session_meta.payload.id` 77/77 一致；`payload.session_id` 是根线程 id，子代理文件里二者不同。文件名时间是本地时间，行内 `timestamp` 是 UTC，只用后者。`archived_sessions/` 是移动过去的扁平目录，要一并扫描、按 thread id 去重。
2. **token_count**：`payload.info.{total_token_usage,last_token_usage,model_context_window}`，`info=null` 是限速快照跳过。**`input_tokens` 含 `cached_input_tokens`**（上游 `non_cached_input = input − cached`，本机 709/709 cached ≤ input）；**`total_tokens == input + output`** 709/709。`total` 是进程内累计（`append_last_usage`），**resume 后归零**（本机 10 次回退、5 次 total==last，全在新进程首轮），所以**每条只计 `last_token_usage`，不做 total 差分**；相邻重复签名 5 例需去重。
3. **reasoning 含在 output 内**（709/709 reasoning ≤ output 且 total = input + output），计价 reasoning 单价 0，与参考项目 `pricing/index.js:197-207` 一致。`cache_write_input_tokens` 是 serde default，0.144.4 部分缺，按 0。
4. **model 只来自 `turn_context.payload.model`**（130/130 非空，每轮开头写一次）；`session_meta` 没有 model 字段（78/78），只有 `model_provider`。`token_count` 无 model，归到最近一条在前的 `turn_context`；`thread_settings_applied.model` 不能用（选择时刻早于生效）。为空只发生在没有 `turn_context` 的空会话（本机 4 个，都无用量），兜底 `unknown`。
5. **cwd**：`session_meta.payload.cwd` 初值，`turn_context.payload.cwd` 逐轮覆盖（本机 0 例不同）。SDK 会话 cwd 为 `/`，Desktop 闲聊在 `~`。
6. **轮次**：`event_msg/task_started{turn_id}` → `turn_context{turn_id}` → `response_item/message role=user`（含注入的 `# AGENTS.md` / `<recommended_plugins>` / `<skill>` 等）→ … → `task_complete{turn_id}` 或 `turn_aborted`。耗时用 `task_started` 到终止事件的时间戳；`event_msg/user_message` 只在 legacy 模式写（本机 7 条），不能依赖。
7. **版本差异**：本机最早 0.133.0-alpha.1（2026-05）已是现行格式，无参考项目兼容的 `payload.msg` 老包装；**0.153.2 起新增 `token_usage_record`**（`usage/turn_token_usage/thread_token_usage/turn_id/response_id`，84/84 与紧随的 `token_count` 一致），建议优先消费它、旧文件回退 `token_count`。子代理文件开头回放父线程历史但不含用量事件，取第一条 `session_meta` 定身份即可。

参考项目对应实现：`codex-rollout-parser.js:959-988`（session_meta/turn_context）、`:1006-1012`（consumeUsageDelta）、`:441-443`（input 减 cached）、`codex-token-usage.js:98-158`（差分状态机）、`codex-model-attribution.js:3-23`（模型归属）。
