# Codex rollout 文件的用量解析规则

2026-09-18 调研。三类来源：

- 本机样本 `~/.codex/sessions`：77 个文件、33 MB、2026-05-26 至 2026-09-17，`cli_version` 0.133.0-alpha.1 → 0.154.0（本机 `codex --version` = 0.154.0）。全量做了统计，逐行细看了 9 个文件。样本引用写作 `rollout-<日期>T<时分秒>-<thread id 前 8 位>`，cwd 一律脱敏为 `~`。
- 参考项目 TokenTracker：`src/lib/codex-rollout-parser.js`（下称 parser.js）、`codex-token-usage.js`、`codex-model-attribution.js`、`codex-service-tier.js`、`rollout.js`、`pricing/index.js`。
- Codex 上游源码 `openai/codex@main`（2026-09-18 拉取，commit 7498521）：`codex-rs/protocol/src/protocol.rs`（下称 protocol.rs）、`codex-rs/rollout/src/{recorder,policy,rollout_file_name,compression}.rs`、`codex-rs/history/src/rollout_payload.rs`、`codex-rs/core/src/context/user_instructions.rs`。

扫描脚本在会话 scratchpad（`scan-codex.js` / `extras.js` / `invariants.js` / `cumul.js` / `tur.js` / `deep.js`），只读，不入库。

## 1. 文件位置、命名与 thread id

| 结论                                                                                                             | 依据                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录 `$CODEX_HOME/sessions/YYYY/MM/DD/`，年月日按**本地时间**                                                    | recorder.rs:1705-1712 `OffsetDateTime::now_local()`；本机 37 个日目录                                                                                                                 |
| 文件名 `rollout-<YYYY-MM-DDTHH-MM-SS>-<thread_id>.jsonl`；`thread/revert` 会产生 `<thread_id>_<rollout_id>` 变体 | rollout_file_name.rs:62-71；recorder.rs:99-103；本机 0 个下划线变体                                                                                                                   |
| 文件名时间戳是本地时间、无时区；`session_meta.payload.timestamp` 与每行 `timestamp` 是 UTC 带 `Z`                | `rollout-2026-05-26T06-34-24` 的 payload.timestamp = `2026-05-26T13:34:24.615Z`（当时 UTC-7）；`rollout-2026-09-16T14-31-10` = `06:31:10.867Z`（UTC+8）。**时间一律取行内 timestamp** |
| 文件名末尾 UUID == 首行 `session_meta.payload.id`（thread id）                                                   | 77/77 一致；parser.js:1283-1288 `rolloutSessionIdFromPath` 只作兜底                                                                                                                   |
| `payload.session_id` 是**根线程** id，子代理文件里 `session_id != id`                                            | protocol.rs:3117-3119 注释 "session_id is equal to the root thread's ID"；本机 4 个子代理文件均如此（如 `rollout-2026-09-16T15-28-13-01a0a91d`：id=01a0a91d…，session_id=01a0a917…）  |
| 首行 `session_meta.payload.timestamp` 早于该行 `timestamp`，差 0.1 s 到 87 s                                     | `rollout-2026-06-20T02-20-11-019ee4f9`：payload 12:20:11.965Z，行 12:21:38.209Z。会话开始时间取 payload.timestamp                                                                     |
| 上游支持 `.jsonl.zst` 压缩                                                                                       | compression.rs:25,64；本机 0 个，扫描器要同时接受两种后缀                                                                                                                             |
| `~/.codex/archived_sessions/` 扁平目录，归档是**移动**不是复制                                                   | recorder.rs:1522；本机 2 个归档文件的 id 都不在 `sessions/` 里。扫描两处；游标/去重键按 thread id + 事件签名，不能按路径（rollout.js:169-176 注释同样理由）                           |

## 2. 行结构与事件类型

每行 `{timestamp, ordinal?, type, payload}`。`ordinal` 5817/6039 行有，222 行没有（旧版本）。77 个文件时间戳零倒序。

`type` 取值来自 `RolloutItemWire`（rollout_payload.rs:22-62，snake_case）：`session_meta / response_item / inter_agent_communication / inter_agent_communication_metadata / compacted / turn_context / token_usage_record / world_state / retained_context / security_risk_score / event_msg / realtime_item`。本机出现频次：

| type/payload.type                                     | 行数                                            | 用途                         |
| ----------------------------------------------------- | ----------------------------------------------- | ---------------------------- |
| session_meta                                          | 78（77 文件 + 1 回放）                          | 身份、cwd、版本              |
| turn_context                                          | 130                                             | **model**、cwd、turn_id      |
| event_msg/token_count                                 | 717（709 有 info，8 条 info=null）              | **用量**                     |
| token_usage_record                                    | 84（仅 cli ≥ 0.153.2）                          | 用量 + turn_id + response_id |
| event_msg/task_started / task_complete / turn_aborted | 131 / 106 / 15                                  | 轮次边界                     |
| event_msg/thread_settings_applied                     | 53                                              | service_tier                 |
| response_item/message                                 | 910（developer 326 / user 251 / assistant 333） | 用户提示                     |
| event_msg/user_message                                | 7（仅 legacy 模式）                             | 见 §7                        |
| world_state / inter_agent_communication_metadata      | 81 / 7                                          | 无关                         |

持久化规则见 policy.rs:9-25（`TurnContext / TokenUsageRecord / SessionMeta` 恒持久化）与 :113-134（`TokenCount / TurnStarted / TurnComplete / TurnAborted / ThreadSettingsApplied` 恒持久化；`UserMessage / AgentMessage / McpToolCallEnd` 等仅 `history_mode == Legacy`）。`ExecCommandEnd`、`ModelReroute` 不持久化（policy.rs:139-147），所以参考项目里的 `model/rerouted` 归属（codex-model-attribution.js:47-51）在 rollout 里永远看不到。

## 3. `token_count` 事件与累计差分

结构（protocol.rs:2337-2340、2270-2275、2235-2249）：

```json
{"timestamp":"…Z","type":"event_msg","payload":{"type":"token_count",
  "info":{"total_token_usage":{六字段},"last_token_usage":{六字段},"model_context_window":828400}|null,
  "rate_limits":{…}|null}}
```

六字段：`input_tokens, cached_input_tokens, cache_write_input_tokens, output_tokens, reasoning_output_tokens, total_tokens`。

| 结论                                                                         | 依据                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `info == null` 是纯限速快照，跳过                                            | 本机 8 条（4 文件，如 `rollout-2026-09-08T16-58-27-01a0803d`），`rate_limits` 字段全 null                                                                                                                                                                                                                                                                         |
| 一条 `token_count` = 一次 Responses API 响应，一轮里工具往返几次就有几条     | protocol.rs:2256 "one completed response"；`rollout-2026-09-16T14-31-10-01a0a8e9` 第一轮 5 条（L19/25/31/39/43）                                                                                                                                                                                                                                                  |
| **`input_tokens` 含 `cached_input_tokens`**，未缓存输入 = input − cached     | protocol.rs:2420-2426 `non_cached_input = (input - cached).max(0)`；本机 709/709 cached ≤ input；parser.js:441-443 同样减法                                                                                                                                                                                                                                       |
| **`reasoning_output_tokens` 含在 `output_tokens` 内**                        | 709/709 reasoning ≤ output；709/709 `total == input + output`（若 reasoning 独立于 output，total 应更大）。计价时 reasoning 记 0，只按 output 计（pricing/index.js:197-207）                                                                                                                                                                                      |
| `total_tokens == input + output`，不重复计 cached，不能用来计费              | 同上；protocol.rs:2433 `tokens_in_context_window = total_tokens`，它表达的是上下文占用                                                                                                                                                                                                                                                                            |
| `cache_write_input_tokens` 是 `#[serde(default)]`，旧版本可缺                | protocol.rs:2241；本机 0.144.4 的 13 条缺该字段，其余 696 条有，值全为 0。缺省按 0                                                                                                                                                                                                                                                                                |
| `total_token_usage` 是**进程内**累计：`total += last`（`append_last_usage`） | protocol.rs:2305-2308；本机 627/709 满足 `total[n] − total[n−1] == last[n]`（六字段逐项）                                                                                                                                                                                                                                                                         |
| **resume 后 total 从 0 重来**，同一文件内会回退或出现 `total == last`        | 10 次回退 + 5 次 `total==last`，全部紧跟一次新进程的第一轮：`codex_sdk_ts` 0.149.1 每轮一个进程（`rollout-2026-08-28T15-41-50-01a04751` L115/L177/L267/L303/L316/L333 每轮首条 total==last，且每轮前有 `thread_settings_applied`）；`codex-tui` 0.147.0 在 85 分钟后 resume（`rollout-2026-08-19T11-33-31-01a01814` L299 total=2196222 → L320 total=86188==last） |
| 相邻两条 `info` 完全相同的重复                                               | 5 次（0.142.x / 0.147.0 / 0.154.0），需去重                                                                                                                                                                                                                                                                                                                       |

**差分规则（建议）**：每条事件计入 `last_token_usage`，不对 `total` 做减法；`total` 只用于识别重复与 resume。参考项目 `consumeUsageDelta`（codex-token-usage.js:98-158）在能建立血缘（`total − last` 等于某个已知 baseline）时返回 `last`，回退时返回 `last`，只有 `total` 签名与已知 baseline 重复时返回 null，效果等价于"计 last + 按签名去重"，多出来的 baseline LRU 是为多 SessionState 交错准备的（同文件 :3-8 注释），本机 0 例。

**去重键**：`thread_id + timestamp + 六字段签名`（parser.js:1015-1016 `eventKey`）。0.153.2+ 可直接用 `token_usage_record.response_id`（§4）。

**长上下文 / priority 加价**：参考项目按原始 input（含 cached）> 272 000 判定长上下文（parser.js:45,684-686），按 `thread_settings_applied.thread_settings.service_tier == "priority"` 判定 Fast 加价（codex-service-tier.js:3-15，写在下一轮 `turn_context` 之前）。本机 53 条 service_tier：priority 42 / default 10 / 缺 1。访谈没有要求这两项，先不做，但字段位置记在这里。

## 4. `token_usage_record`（0.153.2 起新增，参考项目未使用）

结构（protocol.rs:2258-2267）：`thread_id, turn_id, session_id, root_turn_id, response_id, usage, turn_token_usage, thread_token_usage`。本机 84 条，全部在 cli ≥ 0.153.2 的 7 个文件里，写在对应 `token_count` 之前 1 到 6 行。

本机 84/84 验证：`usage` == 紧随其后 `token_count.last_token_usage`；`thread_token_usage` == 其 `total_token_usage`；`turn_token_usage` == 同 `turn_id` 内 `usage` 累计；`turn_id` 都能在同文件 `turn_context.turn_id` 找到。子代理文件里 `thread_id` = 子线程、`session_id` = 根线程（`rollout-2026-09-16T15-28-13-01a0a91d` 15/15）。

建议：有 `token_usage_record` 时以它为准（`response_id` 天然去重键，`turn_id` 直接对上 `turn_context.model`），并跳过其后第一条 `token_count`；旧文件回退到 §3。父文件 `rollout-2026-09-16T15-21-39-01a0a917` 有 57 条 `token_count` 但 56 条记录，多出的 1 条是相邻重复签名（§3 去重能覆盖）。

## 5. model 来源

| 结论                                                                                                                                                                                                               | 依据                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| **唯一来源是 `turn_context.payload.model`**，每轮开头写一次                                                                                                                                                        | protocol.rs:3283-3286 注释（每个真实用户轮写一次，mid-turn compaction 后再写）；本机 130/130 非空                         |
| `session_meta` 没有 model 字段，只有 `model_provider`（"openai" 56 / 自定义 provider id "oxy" 22）                                                                                                                 | protocol.rs:3117-3183 `SessionMeta` 无 `model`；本机 78/78 无；codex-model-attribution.js:17-23 在 5849 文件上同样 0 命中 |
| `token_count` 不带 model，归到**最近一条在前的 `turn_context`**；有 `token_usage_record` 时按 `turn_id` 精确对应                                                                                                   | codex-model-attribution.js:3-6；本机 `turn_context.turn_id` 与前一条 `task_started.turn_id` 130/130 一致                  |
| 不用 `thread_settings_applied.thread_settings.model`：它是用户在 UI 选择的时刻，早于生效                                                                                                                           | codex-model-attribution.js:11-15                                                                                          |
| 为空情况：文件没有 `turn_context`（本机 4 个，只有 `session_meta` 或再加一条 `task_started`，会话刚建就退出，也没有 `token_count`，无需模型）；`token_count` 先于 `turn_context` 出现，本机 0 例。兜底 `"unknown"` | `rollout-2026-09-17T13-54-54-01a0adee`（1 行）、`rollout-2026-09-12T22-43-00-01a09612`（2 行）                            |
| 子代理文件回放父线程 `turn_context`，模型归属无害（回放段没有用量事件，§8）                                                                                                                                        |                                                                                                                           |

本机出现的模型值：`gpt-5.5`、`gpt-5.6-sol`、`gpt-5.6-luna`、`gpt-6-astra`。`turn_context.effort`（119/130 有）不影响计价。

## 6. cwd 来源与覆盖

| 结论                                                                                     | 依据                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 初值 `session_meta.payload.cwd`（78/78 有），之后每条 `turn_context.payload.cwd` 覆盖    | `TurnContextItem.cwd` 是必填 `AbsolutePathBuf`（protocol.rs:3297）；parser.js:985-988                                                                                         |
| 本机 0 例 `turn_context.cwd ≠ session_meta.cwd`，覆盖逻辑保留但基本不触发                | 全量比对                                                                                                                                                                      |
| 特殊值：`codex_sdk_ts` 会话 cwd = `/`；Codex Desktop 闲聊会话 cwd = `~` 或 `~/Downloads` | `rollout-2026-09-12T22-43-00-01a09612`、`rollout-2026-08-28T15-41-50-01a04751`（cwd=/）；`rollout-2026-09-08T16-50-47-01a08036`（~/Downloads）。项目维度会出现这类"非项目"cwd |
| `session_meta.git`（38/78 有）：`commit_hash, branch`，10 个还有 `repository_url`        | 参考项目用它算 `owner/repo` project_key（reference-tokentracker.md）；Paseo 按 cwd → Project 归并即可                                                                         |
| `thread_settings_applied.thread_settings.cwd` 也有，不用                                 | protocol.rs:2213                                                                                                                                                              |

## 7. 轮次边界、用户消息与时间戳

一轮的事件序（`rollout-2026-09-16T14-31-10-01a0a8e9` L45-L80）：

```
event_msg/thread_settings_applied   （可选，用户在 UI 改过设置时）
event_msg/task_started {turn_id, model_context_window}
world_state                          （可选）
turn_context {turn_id, model, cwd}
response_item/message role=developer|user  ×N  （注入 + 真实提示）
… reasoning / function_call / custom_tool_call / token_usage_record / token_count …
event_msg/task_complete {turn_id}  或  event_msg/turn_aborted
```

| 结论                                                                                                                                                                                                                                                                                               | 依据                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **轮次 = `task_started` 到同 `turn_id` 的 `task_complete` / `turn_aborted`**；无终止事件时用本轮最后一行时间                                                                                                                                                                                       | 本机 task_started 131、task_complete 106、turn_aborted 15，10 轮无终止（进程被杀或截止扫描时仍在跑）                                                                          |
| 轮次耗时（访谈 Q26）用 `task_started.timestamp` 作起点，比用户消息行更准：`task_started` 可比 `turn_context` 早数秒（上下文/MCP 准备）                                                                                                                                                             | `rollout-2026-09-16T14-31-10-01a0a8e9` L46 07:07:56 → L47 07:08:03                                                                                                            |
| `event_msg/user_message` 只在 `history_mode == "legacy"` 写入，paginated（本机 73/77）不写                                                                                                                                                                                                         | policy.rs:120-134；本机 7 条全在 0.144.4 / 0.146.1 的 `codex_exec` legacy 文件（`rollout-2026-08-06T19-41-21-019fd6e0`），字段 `message, images, local_images, text_elements` |
| 用户提示 = `response_item/message` 且 `role == "user"`，`content[].type` 为 `input_text`（可带 `input_image`）                                                                                                                                                                                     | 本机 251 条                                                                                                                                                                   |
| 同一轮里还有**注入的** user 消息，前缀：`# AGENTS.md instructions`（user_instructions.rs:24）、`<recommended_plugins>`、`<skill>`、`<environment_context>`、`<turn_aborted>`、`<subagent_notification>`、SDK 的 `[Context: You are inside …`；`# Codex Role:` / `# Response language` 也是配置注入 | 本机 251 条里普通文本 120、`# AGENTS.md…` 40、`<recommended_plugins>` 29、`<skill>` 32、`<turn_aborted>` 14、`<environment_context>` 6、`<subagent_notification>` 2           |
| 真实提示 = 本轮 `turn_context` 之后、第一条 reasoning/assistant/tool 之前，**最后一条不以 `<` 或 `#` 开头的 user 消息**。统计只需要轮次数和时间，不必解析正文                                                                                                                                      | `rollout-2026-05-26T06-34-24-019e647e` L4（`# AGENTS.md…`）→ L5 turn_context → L6 真实提示                                                                                    |
| 会话计数口径：至少 1 条有效 `token_count` 的文件                                                                                                                                                                                                                                                   | 本机 12/77 文件没有用量事件（3 个只有 session_meta，其余是首轮被中止）                                                                                                        |
| `~/.codex/history.jsonl`（`session_id, ts, text`，39 行）是用户输入历史，可辅助，不依赖                                                                                                                                                                                                            |                                                                                                                                                                               |

## 8. 子代理、fork 与多条 `session_meta`

| 结论                                                                                                                                                                                                                                                                                       | 依据                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 子代理文件 `session_meta.source` 为对象：`{"subagent":{"thread_spawn":{parent_thread_id, depth, agent_path, agent_nickname, agent_role}}}` 或 `{"subagent":{"other":"guardian"}}`；同时有 `parent_thread_id / agent_role`，0.154.0 还有 `forked_from_id`、`subagent_history_start_ordinal` | protocol.rs:2820-2831 `SessionSource`，:3175-3180；本机 4 个（0.147.0 ×2、0.149.0、0.154.0）                                                                        |
| **子代理文件开头回放父线程历史**：第 2 行是父线程的 `session_meta`，随后父的 `task_started / turn_context / message` 全部同一 timestamp；回放段**不含** `token_count` / `token_usage_record`，从 `subagent_history_start_ordinal` 起才是自己的                                             | `rollout-2026-09-16T15-28-13-01a0a91d`：L1 子 meta（`subagent_history_start_ordinal`=19），L2 父 meta，L3-L19 全是 `07:28:13.597Z`，用量事件 0 条；L20 起自己的轮次 |
| 文件身份只取**第一条** `session_meta`                                                                                                                                                                                                                                                      | parser.js:961-975 `sessionLineageCaptured`                                                                                                                          |
| 子代理用量只在子文件；父文件 `token_usage_record.thread_id == session_id` 56/56，`turn_context.root_turn_id == turn_id` 11/11                                                                                                                                                              |                                                                                                                                                                     |
| 参考项目担心的"同一文件多个 SessionState 交错"（codex-token-usage.js:3-8）本机 0 例；按 `last` 计费天然不受影响                                                                                                                                                                            |                                                                                                                                                                     |

来源卡片"Codex"一桶即可；子代理 cwd 与父相同，项目维度自然归并。

## 9. 版本差异与"旧格式"

本机最早文件（2026-05-26，0.133.0-alpha.1）已经是 `{timestamp, ordinal, type, payload}` + `session_meta / turn_context / event_msg` 的现行格式，**没有**参考项目兼容的 `payload.msg.type == "token_count"` 老包装（parser.js:389-393），也没有无 `session_meta` 的文件。可以不做旧格式分支；`extractTokenCount` 的双路径可作为廉价保险。

版本增量（按本机首次出现）：

| 字段                                                                                                          | 版本                           |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `turn_context.workspace_roots / multi_agent_version`                                                          | 0.137.0                        |
| `session_meta.context_window`、`turn_context.comp_hash / approvals_reviewer`                                  | 0.144.4                        |
| `token_count.last_token_usage.cache_write_input_tokens` 稳定出现                                              | 0.144.4 部分缺，0.146.1 起全有 |
| `session_meta.parent_thread_id / agent_role / agent_nickname`                                                 | 0.147.0                        |
| `session_meta.subagent_history_start_ordinal`                                                                 | 0.149.0                        |
| `turn_context.root_turn_id`、`token_usage_record`                                                             | 0.153.2                        |
| `session_meta.forked_from_id / agent_path`；`thread_source` 在 0.154.0 的 `t3code_desktop` 文件里缺失（4 个） | 0.154.0                        |
| `history_mode`：legacy 4 文件（0.142.x-0.146.1 `codex_exec` / `Codex Desktop`），其余 paginated               |                                |

`originator` 分布：codex_exec 28、codex-tui 25、Codex Desktop 10、codex_sdk_ts 9、t3code_desktop 4、buzz-acp 2；归档目录里还有 `codex_cli_rs`。不同前端写出的结构一致，只有 legacy/paginated 与 SDK 的每轮一进程差异。

## 10. 给 Paseo 解析器的规则清单

1. 扫描 `$CODEX_HOME/sessions/**/rollout-*.jsonl{,.zst}` 与 `archived_sessions/rollout-*.jsonl{,.zst}`；thread id 取首行 `session_meta.payload.id`，文件名 UUID 只作兜底。
2. 会话开始 = `session_meta.payload.timestamp`；一切时间用行内 UTC timestamp，不用文件名。
3. 状态机逐行：`session_meta`（仅第一条）→ cwd、session_id、cli_version；`turn_context` → model、cwd、turn_id；`task_started` / `task_complete` / `turn_aborted` → 轮次与耗时。
4. 用量：优先 `token_usage_record.usage`（去重键 `response_id`，模型按 `turn_id`），跳过其后紧邻的 `token_count`；否则 `token_count.info.last_token_usage`（去重键 thread id + timestamp + 六字段签名；`info == null` 跳过）。**不对 `total_token_usage` 做差分**。
5. 五列映射：`input = input_tokens − cached_input_tokens`，`cached = cached_input_tokens`，`cache_write = cache_write_input_tokens ?? 0`，`output = output_tokens`，`reasoning = reasoning_output_tokens`（只展示，计价按 output 已含，reasoning 单价 0）。
6. model 缺失时记 `"unknown"`；cwd 缺失用 session_meta 的值。
7. 子代理文件：第一条 `session_meta` 定身份，回放段无用量事件，正常逐行即可。
