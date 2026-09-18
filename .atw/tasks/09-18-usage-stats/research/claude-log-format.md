# Claude Code 会话日志格式（用量解析规则）

2026-09-18 由子代理 r01-claude 调研。证据来源：

- 本机 `~/.claude/projects/**/*.jsonl` 全量扫描（687 个文件、202,061 行，含 334 个子代理 transcript），Claude Code 版本只有 `2.1.220`（402 文件）和 `2.1.258`（263 文件）；逐行看了最近修改的 5 个主文件。
- 参考项目 `TokenTracker/src/lib/rollout.js`（行号以该文件为准）：`parseClaudeFile` `:2470`、`claudeMessageDedupKey` `:4565`、`normalizeClaudeUsage` `:4572`、`resolveClaudeFileCwd` `:4268`。
- Paseo 现有代码：`packages/server/src/server/agent/providers/claude/agent.ts`（`buildOptions` 的 `resume`/`sessionId` 绑定 `:3266-3270`、`captureSessionIdFromMessage` `:4488`、`parseClaudeSessionDescriptor` `:6243`）。

样本文件脱敏代号（都在 `~/.claude/projects/<编码后的 cwd>/` 下）：

| 代号    | 文件                                    | 说明                                           |
| ------- | --------------------------------------- | ---------------------------------------------- |
| S1      | `2296b7fd-….jsonl`                      | 2.1.258，cli，82 行，4 轮，本文 3 条样例行出处 |
| S2      | `4ee78c56-….jsonl`                      | 2.1.258，cli，有 1 个子代理目录                |
| S3      | `0cc418d5-….jsonl`                      | 2.1.258，cli，无子代理，用于 cost-state 对账   |
| F0 → F1 | `a727fce7-….jsonl` → `03206343-….jsonl` | 2.1.258，`sdk-cli` 入口，resume 后的新旧文件对 |
| T1      | `3b2db8fb-….jsonl`                      | 2.1.220，含 3 次 compact                       |
| E1      | `da2b6b47-….jsonl`                      | 2.1.258，含 `<synthetic>` 行                   |

## 1. 文件布局

```
~/.claude/projects/<cwd 编码：/ → ->/
  <sessionId>.jsonl                     主 transcript，文件名 = 内部 sessionId（全库无一例外）
  <sessionId>/subagents/agent-<id>.jsonl 子代理 transcript（Task/Agent 工具）
  <sessionId>/subagents/agent-<id>.meta.json  {agentType, description, toolUseId, spawnDepth}
  <sessionId>/tool-results/*.txt        大工具输出外置，不是 jsonl
  memory/                               无 jsonl
```

只处理 `*.jsonl`。cwd 编码见 `packages/server/src/server/agent/providers/claude/project-dir.ts:27`；目录名不可逆（`-` 既是分隔符也可能是原路径字符），cwd 一律从行内 `cwd` 字段取。

## 2. 字段表

| 需要的量              | 位置                                                             | 说明 / 证据                                                                                                                                                                                                                 |
| --------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| input                 | `message.usage.input_tokens`                                     | 非缓存输入。S1:29                                                                                                                                                                                                           |
| cached input          | `message.usage.cache_read_input_tokens`                          | 缓存命中读入。S1:29                                                                                                                                                                                                         |
| cache write           | `message.usage.cache_creation_input_tokens`                      | 缓存写入；细分 `message.usage.cache_creation.{ephemeral_5m_input_tokens, ephemeral_1h_input_tokens}`，两者之和 == 总数（52,388 / 52,391 行成立，3 例差 1 个 token 的舍入），两个版本都有                                    |
| output                | `message.usage.output_tokens`                                    | **已含 thinking**，见 §5                                                                                                                                                                                                    |
| reasoning             | `message.usage.output_tokens_details.thinking_tokens`            | **仅 2.1.258 有**；2.1.220 的 usage 没有 `output_tokens_details`（36,165 行全无），老日志 reasoning 只能记 0                                                                                                                |
| model                 | `message.model`                                                  | 取值：`claude-fable-5-1`、`claude-fable-5`、`claude-opus-5`、`claude-opus-4-8`、`claude-sonnet-5`、`claude-haiku-4-5-20251001`、`<synthetic>`（22 行，见 §9）。没有 `[1m]` 后缀出现在此字段                                 |
| cwd                   | 顶层 `cwd`                                                       | `user` / `assistant` / `attachment` / `system` 行都有；23 个文件内 cwd 会变（bash `cd` 后跟着变，都是原 cwd 的子目录）。参考项目取**文件内第一个 cwd** `rollout.js:4268-4290`，Paseo 描述符也取第一个 `agent.ts:6221`；沿用 |
| sessionId             | 顶层 `sessionId`（`session_id` 是重复字段，不总在）              | 主文件内恒等于文件名；子代理文件里 = 父会话 id（S2 子代理首行）                                                                                                                                                             |
| timestamp             | 顶层 `timestamp`                                                 | ISO 8601 UTC，`2026-09-18T09:44:45.432Z`，全库 165,222 行格式一致（24 字符、Z 结尾）                                                                                                                                        |
| uuid / parentUuid     | 顶层                                                             | 每行一个 uuid，parentUuid 指向前一行（包括 attachment 行），形成单链；assistant 拆块时块间也串链（S1:29-31）                                                                                                                |
| requestId             | 顶层 `requestId`（`req_011…`）                                   | 同一 API 响应的所有块同一个 requestId；52,281/52,303 行有，缺的 22 行全是 `<synthetic>`                                                                                                                                     |
| message.id            | `message.id`（`msg_011…`）                                       | 同一 API 响应的所有块相同，去重键，见 §4                                                                                                                                                                                    |
| apiBlockIndex         | 顶层                                                             | 仅 2.1.258；块序号 0,1,2…                                                                                                                                                                                                   |
| promptId              | `user` 行顶层                                                    | 轮次键，见 §7                                                                                                                                                                                                               |
| isSidechain / agentId | 顶层                                                             | 子代理行 `isSidechain:true` + `agentId`；本机主文件中 0 行 sidechain（老版本会把 sidechain 写进主文件，参考项目仍按路径 `/subagents/` 判定 `rollout.js:2494`）                                                              |
| entrypoint            | 顶层                                                             | `cli`（657 文件）/ `sdk-cli`（26）/ `sdk-ts`（4）。Paseo 走 SDK，落 `sdk-cli`                                                                                                                                               |
| version               | 顶层                                                             | Claude Code 版本，决定 §2 的字段差异                                                                                                                                                                                        |
| gitBranch             | 顶层                                                             | 可选展示                                                                                                                                                                                                                    |
| 标题                  | `type:"ai-title"`.`aiTitle`、`type:"custom-title"`.`customTitle` | Paseo 已解析 `agent.ts:6224-6230`                                                                                                                                                                                           |

## 3. 带用量的行长什么样（3 条脱敏样例，S1）

用户 prompt 行（S1:10）：

```json
{
  "parentUuid": "1da44e5a-…",
  "isSidechain": false,
  "promptId": "98cef157-…",
  "type": "user",
  "message": { "role": "user", "content": "<prompt text>" },
  "uuid": "d4a59160-…",
  "timestamp": "2026-09-18T09:44:42.587Z",
  "origin": { "kind": "human" },
  "userType": "external",
  "entrypoint": "cli",
  "cwd": "/Users/<user>/code/<project>",
  "sessionId": "2296b7fd-…",
  "version": "2.1.258",
  "gitBranch": "<branch>"
}
```

assistant 用量行（S1:29，同一响应的第 0 块，thinking 块）：

```json
{
  "parentUuid": "54ed7e2f-…",
  "isSidechain": false,
  "message": {
    "model": "claude-fable-5-1",
    "id": "msg_011CfAgxN6VSNBC81Geo5CZh",
    "type": "message",
    "role": "assistant",
    "content": [{ "type": "thinking", "thinking": "<redacted>", "signature": "<redacted>" }],
    "stop_reason": "tool_use",
    "usage": {
      "input_tokens": 2,
      "cache_creation_input_tokens": 26884,
      "cache_read_input_tokens": 34560,
      "output_tokens": 408,
      "output_tokens_details": { "thinking_tokens": 84 },
      "server_tool_use": { "web_search_requests": 0, "web_fetch_requests": 0 },
      "service_tier": "standard",
      "cache_creation": { "ephemeral_1h_input_tokens": 26884, "ephemeral_5m_input_tokens": 0 },
      "inference_geo": "not_available",
      "iterations": [
        {
          "input_tokens": 2,
          "output_tokens": 408,
          "cache_read_input_tokens": 34560,
          "cache_creation_input_tokens": 26884,
          "type": "message",
          "model": null
        }
      ],
      "speed": "standard"
    }
  },
  "apiBlockIndex": 0,
  "requestId": "req_011CfAgxMbE9jvDzFmfYLJNM",
  "type": "assistant",
  "uuid": "1ffbcab2-…",
  "timestamp": "2026-09-18T09:44:45.432Z",
  "entrypoint": "cli",
  "cwd": "/Users/<user>/code/<project>",
  "sessionId": "2296b7fd-…",
  "version": "2.1.258",
  "gitBranch": "<branch>"
}
```

tool_result 用户行（S1:38，不是人类输入，不含 usage）：

```json
{
  "parentUuid": "b4a04a9c-…",
  "isSidechain": false,
  "promptId": "98cef157-…",
  "type": "user",
  "message": {
    "role": "user",
    "content": [
      {
        "tool_use_id": "toolu_01Fgrv…",
        "type": "tool_result",
        "content": "<redacted>",
        "is_error": false
      }
    ]
  },
  "uuid": "dfcafd88-…",
  "timestamp": "2026-09-18T09:44:50.077Z",
  "toolUseResult": "<redacted>",
  "sourceToolAssistantUUID": "b4a04a9c-…",
  "entrypoint": "cli",
  "cwd": "/Users/<user>/code/<project>",
  "sessionId": "2296b7fd-…",
  "version": "2.1.258",
  "gitBranch": "<branch>"
}
```

`usage.iterations[]` 只在 3 行里长度 >1，且其 output 之和不等于顶层值；**忽略它，只用顶层五列**。

## 4. 去重键：`message.id`，且组内取最后一行

- **一个 API 响应按 content block 拆成多行**，每行都完整复制同一份 `usage`（S1:29-31 三行 `mid=…1Geo5CZh` 同 usage；S2 里 43 个 message.id 对应 117 行）。不去重会多算 2-4 倍。
- 键用 `message.id` 即可，`requestId` 与 message.id 一一对应（全库 0 个 requestId 映射到多个 message.id），且 `<synthetic>` 行没有 requestId。参考项目结论相同，`rollout.js:4553-4569`（曾因要求两者同时存在而漏去重，1.6-3.7 倍多算）。
- **组内 usage 可能不一致**：前几块带的是流开始时的快照（`output_tokens` 为 1-6），最后一块才是终值。全库 24,711 组里 3,603 组不一致，**最后一行 == 最大值 3,603/3,603**。分布：子代理文件 3,600 组（两个版本都有），2.1.220 主文件 3 组，2.1.258 主文件 0 组。
- 因此规则是：**按 message.id 分组，取该 id 最后出现那行的 usage**（或逐行用 `max(output_tokens)` 覆盖）。参考项目是"见过就跳过"取第一行（`rollout.js:2529-2530`），在子代理文件上会把 output 记成 1，**不要照抄**。
- 增量解析要注意：同一 message.id 的后续块可能在下一次读取窗口才到，游标实现里每个 sessionId 要保留"最后一个 message.id + 已记 usage"以便覆盖修正。
- 去重要**跨文件**：resume 会把旧文件的 assistant 行原样复制到新文件（§6），message.id 相同。

## 5. `output_tokens` 已含 thinking 的证据

- S1 全文件：4 个响应 `output_tokens` = 408+547+2132+627 = 3714，`thinking_tokens` = 84+232+1767+266 = 2349；文件末尾 Claude Code 自己写的 `cost-state` 行（S1:80）`modelUsage["claude-fable-5-1"] = {outputTokens: 3714, thinkingTokens: 2349, …}`，两者分列且 output 不是 3714+2349。
- S3 用 §4 规则去重求和后五列与 `cost-state.modelUsage` **完全相等**（input 4651 / output 47978 / thinking 24413 / cacheRead 7,193,609 / cacheCreation 295,554），同时验证了去重规则和"thinking ⊂ output"。
- 参考项目同口径：`normalizeClaudeUsage` 把 `output - thinking` 记 output、thinking 记 reasoning（`rollout.js:4572-4590`），计价时 reasoning 按 output 单价（`pricing/index.js:200-207`）。Paseo 也这样拆，只是老版本 thinking=0 时 output 全算 output，价格无差。

## 6. resume 换 id 后的跨文件关联

Paseo 每次重建 query 都传 `resume: claudeSessionId`（`agent.ts:3266-3270`），SDK 入口下 Claude Code 会**新建一个 sessionId 文件**，并把旧会话历史**整段复制**进新文件，每条复制行带 `forkedFrom: {sessionId: <旧 id>, messageUuid: <旧行 uuid>}`，复制行本身拿新 uuid（全库 uuid 跨文件重复 0 例）。证据 F0 → F1：

|                                   | F0（旧）       | F1（新）                                                                   |
| --------------------------------- | -------------- | -------------------------------------------------------------------------- |
| entrypoint                        | sdk-cli        | sdk-cli                                                                    |
| 行数 / assistant 行 / 人类 prompt | 733 / 167 / 12 | 1716 / 364 / 27                                                            |
| 带 `forkedFrom` 的行              | 0              | 624（其中 168 条 assistant 带 usage，49 个 message.id，**全部**存在于 F0） |
| 首行                              | 正常           | F1:1-4 是 `attachment`/`user` 复制行，`forkedFrom.sessionId` = F0          |

结论：

- **跳过所有带 `forkedFrom` 的行**（用量与轮次都不算），旧文件已经算过；再加 §4 的跨文件 message.id 去重兜底。
- 新旧文件关联键就是 `forkedFrom.sessionId`（首个带该字段的行）。Paseo 侧另有 `thread_started` 事件在 id 变化时触发（`agent.ts:4508-4525`），与访谈 Q27 的"agent 记录追加 provider session id 列表"互补：日志侧从 `forkedFrom` 反推链，记录侧从事件正推。
- 没有 `leafUuid` 跨文件引用：`last-prompt.leafUuid` 只指向本文件最后一行。首行 `parentUuid` 指向别的文件的情况只出现在 5 个子代理文件（团队测试目录，复制过的会话），主文件 0 例。
- cli 入口的 `claude --resume` 不换文件（本机 cli 文件 0 个带 forkedFrom）。

## 7. 轮次边界与耗时

轮次键是 `user` 行的 **`promptId`**：

- 人类 prompt 行与同时刻的伴随 meta 行（`isMeta:true`、`turnCompanion:true`，如 hook 注入上下文）共用一个 promptId（S1:10-11）；斜杠命令行与随后的 skill 正文 meta 行也共用（本会话 d904e82c…:10-11，时间戳相同）。
- 本轮所有 `tool_result` 行都带同一个 promptId（主文件 26,302/27,027 一致；不一致的都是"meta 行自己开了一轮"的情形，见下）。
- `assistant` 行**没有** promptId，按顺序归属最近一个非 tool_result 的 user 行。

轮次规则：

1. 顺序扫描；遇到 `type:"user"` 且 content 不含 `tool_result` 的行，若 promptId 与当前轮不同，开新候选轮，`start = 该行 timestamp`。
2. 之后的 `assistant` / `tool_result` 行归入当前轮。
3. 只有含 ≥1 条 assistant 行的候选轮才算一轮（纯 `isMeta` 行如 `<local-command-caveat>`、`## Context Usage` 后面没有 assistant，273 例；而队友消息 "Another Claude session sent a message" 51/52 例、skill 正文 551/593 例、图片 meta 行都会引出 assistant，要算轮）。
4. `end = 本轮最后一条 assistant 行的 timestamp`（正常收尾 `stop_reason:"end_turn"`）；被打断时（下一条 user 行有 `interruptedMessageId`，或 assistant 行 `isAbortedMidStream:true`）取本轮最后一条 assistant/tool_result 行。
5. 耗时 = end − start。

校验：cli 入口会写 `type:"system", subtype:"turn_duration"` 行（`durationMs`、`messageCount`、parentUuid 指向本轮最后一条 assistant），1,365 条。与上面规则对比：`lastAssistant.ts − prompt.ts` 相对 `durationMs` 中位数 −30 ms、p10 −210 ms、p90 +24 ms，可用。**SDK 入口（Paseo 会话）不写 `turn_duration`**（sdk-cli 66 轮里 0 条，sdk-ts 0 条），所以必须用时间戳推导；有 `turn_duration` 时可直接用 `durationMs` 覆盖。与客户端 `deriveStreamTurnTiming` 口径一致（访谈 Q26）。

不算轮次的 user 行：`tool_result` 行、`isCompactSummary:true`（压缩摘要，`isVisibleInTranscriptOnly:true`，T1:998）、带 `forkedFrom` 的复制行、`isMeta` 且后面没有 assistant 的行。参考项目只数"有 text 块且非 tool_result"的 user 行做会话数（`rollout.js:2497-2514`），它把 meta 行也数进去了，比本规则粗。

## 8. 子代理 transcript

- 位置 `<sessionId>/subagents/agent-<agentId>.jsonl`，同级 `agent-<agentId>.meta.json` 给 `agentType`/`description`/`toolUseId`/`spawnDepth`（S2 子代理）。文件内每行 `isSidechain:true`、`agentId`、`sessionId` = 父会话、`cwd` 与父相同、有 `requestId`，assistant 行带 `attributionAgent`（如 `Explore`），model 可与主会话不同（S2 主 fable-5-1，子代理 opus-5）。
- 主文件里只有派生它的 `tool_use` / `tool_result`（"Async agent launched…"）和 `queue-operation` 通知行，**不含子代理的 usage**。
- **要计入**：这是真实计费的 API 调用；归到父 sessionId、父 cwd、按子代理自己的 model 分桶。只计 usage，**不计轮次和耗时**（子代理的 user 首行 promptId 是父轮的，tool_result 的 promptId 会变，不适合当轮次键）。
- 子代理文件是 §4 流式快照的主要来源（3,600/3,603 组），"最后一行为准"在这里最关键。
- 老版本把 sidechain 写进主文件（`isSidechain:true` 行），本机 0 例；解析时对 `isSidechain:true` 行同样"计 usage、不计轮"，路径与字段两条判定都留。

## 9. 要跳过的行

| 行                        | 判定                                                                                                                                                                                                                  | 处理                                                                                       |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 非消息行                  | `type` ∈ `last-prompt`、`mode`、`permission-mode`、`atis-latch`、`attachment`、`file-history-snapshot`、`file-history-delta`、`queue-operation`、`ai-title`、`custom-title`、`cost-state`、`artifact-*`、`frame-link` | 无 usage，跳过（标题行可另取展示名）                                                       |
| `system` 行               | subtype `turn_duration`、`stop_hook_summary`、`away_summary`、`compact_boundary`、`local_command`、`agents_killed`、`informational`、`model_refusal_fallback`                                                         | 无 usage；`turn_duration` 用于 §7 校验                                                     |
| `<synthetic>`             | `message.model == "<synthetic>"`，同时 `isApiErrorMessage:true`、`error:"authentication_failed"` 等，usage 全 0，`message.id` 是 uuid 不是 `msg_`（E1，22 行）                                                        | 跳过；参考项目靠 `isAllZeroUsage` 顺带跳过 `rollout.js:2540`                               |
| `isApiErrorMessage:true`  | 本机 22 行全是 `<synthetic>`                                                                                                                                                                                          | 同上                                                                                       |
| `isAbortedMidStream:true` | usage 只有流开始快照（output 1-2），实际输出未知                                                                                                                                                                      | 按行内数值计（略少算），不额外处理                                                         |
| tool_result user 行       | `message.content[].type == "tool_result"`                                                                                                                                                                             | 不计轮，无 usage                                                                           |
| compact                   | `system/compact_boundary` + `user isCompactSummary`                                                                                                                                                                   | 压缩本身那次 API 调用**没有 usage 行**（T1:997-999 前后无 assistant 行），已知缺口，不可补 |
| `forkedFrom` 行           | 见 §6                                                                                                                                                                                                                 | 跳过                                                                                       |
| `summary` 行              | 老版本的 `type:"summary"`，本机 0 例                                                                                                                                                                                  | 若遇到跳过                                                                                 |

## 10. `cost-state` 行：只能当参考

`type:"cost-state"`（仅 2.1.258 cli 入口，49/687 文件）是 Claude Code 进程级累计：`totalCostUSD`、`modelUsage{model:{inputTokens,outputTokens,thinkingTokens,cacheReadInputTokens,cacheCreationInputTokens,costUSD}}`、`totalDuration`、`totalAPIDuration`、`startTime`（epoch ms）。

- 无子代理的会话（S3）与 §4 去重求和完全一致，可做**测试夹具的期望值**。
- 有子代理/多进程的会话（S2）不一致：它包含子代理模型（`claude-opus-5[1m]`，注意这里有 `[1m]` 后缀）和日志里没有的 haiku 调用（1352 in / 16 out，标题生成），fable 列的数值也对不上（进程可能跨过 /clear 或多个会话）。**不要拿它当真值**，也不要用它的 costUSD。

## 11. 对参考项目的取舍

| 参考项目做法                                | 本项目                                                                                 |
| ------------------------------------------- | -------------------------------------------------------------------------------------- |
| 去重取第一行 `rollout.js:2529`              | 取最后一行（§4）                                                                       |
| `output - thinking` / thinking 单列 `:4572` | 沿用                                                                                   |
| 只按 `/subagents/` 路径判 sidechain `:2494` | 路径 + `isSidechain` 双判                                                              |
| 会话数 = 含 text 块的 user 行 `:2497`       | 轮次 = promptId 组且含 assistant（§7），会话数 = 文件数（去掉 forkedFrom 链上的旧 id） |
| 不处理 `forkedFrom`                         | 跳过复制行 + 跨文件 message.id 去重                                                    |
| cwd 取首个 `:4268`                          | 沿用                                                                                   |
| 半小时桶 `toUtcHalfHourStart`               | 访谈定的是 UTC 小时桶                                                                  |
