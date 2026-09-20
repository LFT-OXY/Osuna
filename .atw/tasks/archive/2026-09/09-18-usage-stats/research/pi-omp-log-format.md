# Pi 与 OMP 会话日志的用量解析规则（研究票 03）

2026-09-18 调研。依据：本机真实样本（`~/.pi/agent/sessions` 594 文件、`~/.omp/agent/sessions` 501 文件，只读全量结构扫描 + 最近 8 个主文件与 3 个子 agent 文件逐行抽样）、上游源码（Pi `@earendil-works/pi-coding-agent` 0.85.1 与其 `pi-ai`；OMP 源码 `@oh-my-pi/pi-coding-agent` 17.3.3 / `pi-utils`，本机 `omp --version` 为 18.1.18，样本由 18.x 写出）、参考项目 `TokenTracker/src/lib/rollout.js`（行号以该文件为准）、Paseo `main`（f864192e9）。样本路径已把家目录写成 `~`，目录名中的用户名写成 `<user>`。

## 1. 结论速览

| 问题           | 结论                                                                                                                                                                                                                                                                                                                                    |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (1) usage 五列 | Pi 与 OMP 都是 `usage.input / output / cacheRead / cacheWrite` + 推理列；**推理列字段名不同**：Pi 0.85 是 `reasoning`，OMP 是 `reasoningTokens`。两者 `totalTokens` 恒等于四列之和，**不含推理列**；推理是 `output` 的子集（pi-ai 类型注释 + 全量样本 0 例 reasoning > output）。                                                       |
| (2) 后端字段   | **两者每条 assistant 消息都带 `message.provider`**（Pi 13662/13662，OMP 14182/14182），值是 pi 侧配置的 provider id（`openai-codex`、`anthropic`、`3oxy-gpt`、`DeepSeek`…）。OMP 能像 Pi 一样按后端拆来源；参考项目把 OMP 固定成单桶只是它没做，不是日志缺字段。另有 `message.api`（协议名）可辅助。                                    |
| (3) 去重键     | 顶层 `entry.id` 8 位十六进制，就是消息 id。单文件内无重复；OMP **跨文件有 92 条完全相同的副本**（分支/续接时把父会话条目复制进子文件，子文件 header 带 `parentSession` 路径），Pi 无跨文件重复。去重键用 `entry.id`（建议加 `message.timestamp` 兜底防碰撞），作用域必须跨文件。                                                        |
| (4) header     | `type:"session"`，字段 `version`(3) / `id`(会话 uuid v7) / `timestamp`(ISO) / `cwd`(未编码绝对路径) / 可选 `parentSession`。**Pi 恒在第 1 行；OMP 恒在第 2 行**（第 1 行是定长 `title` 记录）。                                                                                                                                         |
| (5) 子 agent   | 都放在与主文件同名的同级目录里。Pi：`<会话>/tasks/<ts>_<uuid>.jsonl`（header `parentSession` = 父会话 uuid）与 `<会话>/<8hex>/run-N/session.jsonl`；OMP：`<会话>/<AgentName>.jsonl` 和 `<会话>/<Sub>/<Sub>.<Grand>.jsonl`（header 无 parentSession，靠路径归属）。参考项目两者都计入同一来源、同一 cwd。                                |
| (6) 轮次与耗时 | 轮 = 一条 `role:"user"` 到下一条 user 之间；结束条件是 assistant `stopReason ∈ {stop,error,aborted,length}`（`toolUse` 表示还在同一轮）。assistant 的 `message.timestamp`(ms) 是**请求发出时刻**，顶层 `entry.timestamp`(ISO) 是**写盘时刻**，差值 = 单次 LLM 调用耗时（OMP 另有 `duration`/`ttft`，与差值在 2 秒内吻合 14044/14053）。 |
| (7) 目录解析   | Paseo Pi 侧与上游一致且比参考项目全；Paseo OMP 侧用了上游不存在的 `OMP_AGENT_DIR`/`OMP_SESSION_DIR`，且 `providerParams.sessionDir` 默认填了字面量导致其余分支不可达；上游 OMP 还有 `PI_CONFIG_DIR`/profile/XDG 三个变量两边都没完整覆盖。详见 §7。                                                                                     |

## 2. Pi 字段表

样本：`~/.pi/agent/sessions/--Users-<user>-Downloads--/2026-09-18T05-58-05-138Z_01a0b317-….jsonl`（32 行）。

| 项                                      | 位置                                           | 值/形态                                                                                                                                                              | 样本行  |
| --------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| session header                          | 第 1 行 `type:"session"`                       | `{version:3, id:"01a0b317-…", timestamp:"2026-09-18T05:58:05.138Z", cwd:"~/Downloads"}`；全量 594/594 都在第 1 行                                                    | L1      |
| sessionId                               | header `id`                                    | uuid v7，与文件名 `<ts>_<id>.jsonl` 后半段相同                                                                                                                       | L1      |
| cwd                                     | header `cwd`                                   | 未编码绝对路径；目录名 `--<cwd 去掉首个 / 后把 / \ : 换成 ->--`（pi `dist/core/session-manager.js:242-246`）                                                         | L1      |
| 模型切换                                | `type:"model_change"`                          | `{provider, modelId}` 两个字段                                                                                                                                       | L2      |
| 用量载体                                | `type:"message"` 且 `message.role:"assistant"` | 其余 role：`user`、`toolResult`                                                                                                                                      | L5      |
| id                                      | 顶层 `id`                                      | 8 位 hex，全量 13662 条无重复                                                                                                                                        | L5      |
| timestamp                               | 顶层 `timestamp`                               | ISO 字符串，写盘时刻（session-manager 追加时 `new Date().toISOString()`，`session-manager.js:786`）                                                                  | L5      |
| message.timestamp                       | `message.timestamp`                            | ms 数字，请求开始时刻（pi-ai 在发请求前构造 `stopReason:"pending"` 骨架并赋 `Date.now()`，`pi-ai/dist/api/openai-codex-responses.js:150-160`）                       | L5      |
| provider                                | `message.provider`                             | 全量出现 9 种：`openai-codex`(6737) `3oxy-gpt`(3353) `3oxy-claude`(2873) `3oxy-deepseek`(604) `3oxy-gemini`(85) `ollama`(4) `deepseek`(2) `newapi`(2) `anthropic`(2) | L5      |
| model                                   | `message.model`                                | 裸模型 id（`gpt-6-astra`、`claude-opus-5`…），不带 provider 前缀                                                                                                     | L5      |
| api                                     | `message.api`                                  | `openai-codex-responses` / `anthropic-messages` / `openai-completions` / `openai-responses`                                                                          | L5      |
| usage.input/output/cacheRead/cacheWrite | `message.usage`                                | 四列恒有                                                                                                                                                             | L5      |
| usage.reasoning                         | `message.usage.reasoning`                      | **字段名是 `reasoning`**，13360 条有、302 条无；恒 ≤ output（是 output 子集，`pi-ai/dist/types.d.ts:272-277`）                                                       | L5      |
| usage.cacheWrite1h                      | 可选                                           | Anthropic 后端才有（2815 条），是 cacheWrite 的子集（同上 :270-271）                                                                                                 | —       |
| usage.totalTokens                       | `message.usage.totalTokens`                    | 全量 13662/13662 = input+output+cacheRead+cacheWrite（不含 reasoning）                                                                                               | L5      |
| usage.cost                              | `message.usage.cost`                           | pi 自算；Codex 订阅路由恒 0，不能当估算成本用                                                                                                                        | L5      |
| stopReason                              | `message.stopReason`                           | 枚举 `pending/stop/length/toolUse/error/aborted/deferred`（`pi-ai/dist/types.d.ts:287`）；样本出现 stop/toolUse/error/aborted                                        | L5      |
| 零用量行                                | —                                              | 199 条五列全零（多为 `stopReason:"error"/"aborted"`），参考项目跳过并记 seen                                                                                         | —       |
| 其他行类型                              | —                                              | `thinking_level_change`、`custom`(扩展数据，可能很大)、`custom_message`、`session_info`(标题)、`compaction`；6 行坏 JSON，需容错                                     | L3, L10 |

参考项目对应：`parsePiLikeIncremental` 字段映射 `rollout.js:15415-15462`，读的是 `usage.reasoningTokens`，**对本机 Pi 0.85 恒取到 0**（推理列被丢）。cwd 读 header `:15497-15521`；source 按 `msg.provider` 拆成 `pi-<slug>` `:15260-15274`。

## 3. OMP 字段表

样本：`~/.omp/agent/sessions/-Downloads/2026-09-12T04-03-07-748Z_01a093c8-8764-….jsonl`（82 行）。

| 项                                              | 位置                                  | 值/形态                                                                                                                                                                                                                                                  | 样本行        |
| ----------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| 第 1 行                                         | `type:"title"`                        | `{v:1, title, updatedAt, pad:"<定长空格>"}`，为原地改写标题预留；全量 501/501                                                                                                                                                                            | L1            |
| session header                                  | 第 2 行 `type:"session"`              | `{version:3, id, timestamp, cwd, parentSession?, title?, titleSource?}`；全量 501/501 在第 2 行                                                                                                                                                          | L2            |
| parentSession                                   | header 可选                           | 5 个文件带，值是**父会话文件的绝对路径**（`--continue`/分支）；子文件复制了父条目                                                                                                                                                                        | L2            |
| cwd 目录名                                      | —                                     | 三种：家目录内 `-<相对 home 的路径编码>`（33 个）、系统 tmp 内 `-tmp-…`、其余 `--<绝对>--`（3 个）。规则见 OMP `src/session/session-paths.ts:35-92`；旧 `--<home>-…--` 目录会被自动迁移成 `-…`（`:94-134`），因此**不能靠目录名反推 cwd，必须读 header** | —             |
| 模型切换                                        | `type:"model_change"`                 | `{model:"openai-codex/gpt-6-astra", role?, resolvedModelIsFallback}`，**合并串**，与 Pi 的两字段不同                                                                                                                                                     | L3            |
| 用量载体                                        | `type:"message"` + `role:"assistant"` | 同 Pi                                                                                                                                                                                                                                                    | L13           |
| id                                              | 顶层 `id`                             | 8 位 hex；跨文件 92 条重复，全部是分支复制（内容、时间戳完全相同）                                                                                                                                                                                       | L13           |
| timestamp / message.timestamp                   | 同 Pi                                 | 写盘 ISO / 请求开始 ms                                                                                                                                                                                                                                   | L13           |
| provider                                        | `message.provider`                    | 全量 8 种：`openai-codex`(7014) `3oxy-OpenAI`(3862) `Anthropic`(1771) `DeepSeek`(1302) `3oxy-deepseek`(180) `3oxy-gpt`(44) `ollama`(6) `OpenAI`(3)。注意**大小写不统一**（`Anthropic` vs Pi 的 `anthropic`），拆桶前要归一化                             | L13           |
| model                                           | `message.model`                       | 裸模型 id，同 Pi                                                                                                                                                                                                                                         | L13           |
| usage 四列                                      | `message.usage`                       | 同 Pi                                                                                                                                                                                                                                                    | L13           |
| usage.reasoningTokens                           | 可选                                  | **字段名是 `reasoningTokens`**，9653 条有、4529 条无；恒 ≤ output                                                                                                                                                                                        | L13           |
| usage.cttl                                      | 可选                                  | 1749 条出现，缓存 TTL 类信息，与计量无关                                                                                                                                                                                                                 | —             |
| usage.totalTokens                               | —                                     | 全量 14182/14182 = 四列之和，不含 reasoningTokens                                                                                                                                                                                                        | L13           |
| usage.cost                                      | —                                     | omp 自算；Codex 路由样本里非 0（如 0.266），但口径是 omp 自己的价表，不宜直接用                                                                                                                                                                          | L13           |
| duration / ttft                                 | `message.duration`、`message.ttft`    | ms；14053 / 13739 条有（`pi-ai/src/types.ts:937-938`）                                                                                                                                                                                                   | L13           |
| completedAt / contextSnapshot / providerPayload | 可选                                  | `providerPayload` 含完整上游响应，单行可达数十 KB                                                                                                                                                                                                        | L13           |
| 其他行类型                                      | —                                     | `title_change`、`credential_pin`(provider + 凭据 hash)、`session_init`(子 agent 的 task 全文)、`reset_boundary`、`compaction`、`service_tier_change`、`custom`(22510 行，占比大)、**`model_usage`**（2 条，见下）；38 行坏 JSON                          | —             |
| model_usage                                     | `type:"model_usage"`                  | 独立记录 `smol` 等辅助角色的调用：`{purpose:"auto-thinking", role:"smol", provider, model, usage}`，**不是 message，参考项目不计入**。数量少但确实是 token 消耗，实现时决定是否计入                                                                      | 子 agent 样本 |

参考项目对应：`parseOmpLikeIncremental` 用量行 `rollout.js:14712-14830`（读 `reasoningTokens`，对 OMP 正确），source 固定 `"omp"` `:15087-15098`；cwd 读 header 扫前 64KB 找 `"session"` 行 `:11000-11026`，所以 header 在第 2 行不影响它。

## 4. 后端字段结论（问题 2）

- OMP **有** `message.provider`，覆盖率 100%，且 `model_change` 的 `model` 也是 `provider/model` 合并串，两处都能拿到。无需从 session header 推断。
- 拆桶粒度建议：`source = omp + normalize(provider)`，normalize 至少做小写；Pi 与 OMP 的 provider id 都是用户在 `models.json`/`config.yml` 里自定义的名字（`3oxy-gpt`、`3oxy-OpenAI` 等是本机自定义端点），显示名走访谈里定的"首字母大写 + 少数固定表"即可。
- 参考项目 OMP 单桶的原因是历史实现（注释 `rollout.js:10841-10842` 承认 omp 也是路由器），不是数据限制；Q25 里"OMP 无 provider 则退化单桶"的兜底分支可以删掉。

## 5. 去重键（问题 3）

- 键 = 顶层 `entry.id`（8 位 hex）。单文件内 Pi/OMP 均 0 重复。
- OMP 分支/续接会把父会话条目复制进新文件（新文件 header `parentSession` 指向父文件绝对路径），92 条副本内容完全一致 → 全局（跨文件）按 `entry.id` 去重即可正确。Pi 的 `parentSession` 路径形态（13 个文件）**不复制条目**，0 重复。
- 8 位 hex 空间约 43 亿，本机 2.8 万条无碰撞，但建议键用 `entry.id + message.timestamp` 防止未来碰撞误删。
- 参考项目 `seenIds` 只保留最近 1 万条（`:15597-15600`），超过后老副本会被重复计数；Paseo 若按 (provider, sessionId) 存游标，可把"已见 id"限定在会话文件级别 + 父子文件级别。

## 6. 子 agent 目录结构与归属（问题 5）

Pi（`--<cwd>--/<ts>_<uuid>/…`，213 个嵌套文件）：

| 形态                                | 数量 | 样本                                                                                               | 归属                                                                                                                                                                                                    |
| ----------------------------------- | ---- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<会话>/tasks/<ts>_<uuid>.jsonl`    | 108  | `--…-oxy-ip--/2026-09-17T07-59-42-068Z_01a0ae60-…/tasks/2026-09-17T08-13-36-468Z_01a0ae6d-….jsonl` | header 第 1 行 `parentSession:"01a0ae60-…"`（父会话 uuid，非路径），cwd 同父。生产者是 pi-subagents 扩展（`@gotgenes/pi-subagents/src/runtime.ts` 写 parentSession；目录名 `tasks` 未在源码中直接核到） |
| `<会话>/<8hex>/run-N/session.jsonl` | 105  | `--…-chinhae-my-pi-web--/2026-07-29T12-32-12-269Z_019faddc-…/4dc88dcc/run-0/session.jsonl`         | 推断为 pi-dynamic-workflows（`dist/workflow.js:80` 生成 `run-<id>`），header 无 parentSession，cwd 同父                                                                                                 |

OMP（`-<cwd>/<ts>_<uuid>/…`，177 个嵌套文件；目录里还有 `*.bash.log`、`*.md`、`.jsonl.lock`、`.tombstone` 等 1700 多个非 jsonl 文件，按扩展名过滤）：

| 形态                                         | 数量   | 样本                                                                                                                  | 归属                                                                                                                                 |
| -------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `<会话>/<AgentName>.jsonl`                   | 136    | `-Documents-Configuration-dev-environment-oxy-ip/2026-09-12T10-48-32-047Z_01a0953b-…/LandingVisual.jsonl`             | header 第 2 行有自己的 uuid 与 cwd，**无 parentSession**；靠路径（父目录名 = 父会话文件名）归属。第 5 行 `session_init` 带 task 全文 |
| `<会话>/<Sub>/<Sub>.<Grand>.jsonl`           | 41     | `-Documents-code-My-MarkArc/2026-08-13T14-15-23-140Z_019ffb7a-…/ResearchAgentOrch/ResearchAgentOrch.AcpRuntime.jsonl` | 二级子 agent，同上                                                                                                                   |
| `__advisor.jsonl` / `__advisor.<slug>.jsonl` | 本机 0 | —                                                                                                                     | omp-stats 归类为 advisor（`omp-stats/src/parser.ts:27-47`：相对路径 ≤2 段为 main，更深为 subagent）                                  |

归属结论：两者的子 agent 都与父会话同 cwd、同 provider 语义，参考项目都计入同一来源（`rollout.js:10812-10818`，Pi 走递归 walk `:15162-15190`）。Paseo 若要把子 agent 用量算到"本会话"（Q27 的 Composer 工具条），Pi 用 header `parentSession` uuid、OMP 用父目录名反查父会话文件名即可。

## 7. 轮次边界与耗时推导（问题 6）

- 轮次：从一条 `message.role:"user"` 开始，到下一条 user 之前的所有条目；一轮内 assistant `stopReason:"toolUse"` 后接 `toolResult`、再接 assistant，直到 `stop`/`error`/`aborted`/`length`。OMP 的 `reset_boundary`、两者的 `compaction` 不改变轮次。`parentId` 构成树（分支/回退），按文件顺序线性处理即可，被回退的分支 token 也真实消耗过。
- 墙钟轮耗时（与客户端 `deriveStreamTurnTiming` 同口径，Q26）：本轮最后一条条目 `entry.timestamp` − user 条目 `entry.timestamp`。样本：Pi 主文件 L4 user `05:58:06.036Z` → L5 assistant `05:58:13.076Z`，首次调用 7 秒。
- 纯模型耗时：每条 assistant 的 `Date.parse(entry.timestamp) − message.timestamp`。全量 Pi/OMP 无负值；OMP 与自带 `duration` 在 2 秒内吻合 14044/14053（9 条 off 是 `duration` 缺失时的写盘延迟）。Pi 没有 `duration`，只能用差值。
- 会话墙钟时长（tooltip）：最后一条条目 `entry.timestamp` − header `timestamp`。

## 8. Paseo 与参考项目的目录解析差异（问题 7）

上游真值：

- Pi 0.85.1（`dist/main.js:531-534`）：`--session-dir` → 环境变量 `PI_CODING_AGENT_SESSION_DIR` → settings.json `sessionDir`（`settings-manager.js:451`）→ `<agentDir>/sessions/--<cwd>--`；agentDir = `PI_CODING_AGENT_DIR` || `~/.pi/agent`。
- OMP（`pi-utils/src/dirs.ts`）：configRoot = `~/${PI_CONFIG_DIR || ".omp"}`，命名 profile（`OMP_PROFILE` 优先于 `PI_PROFILE`，`:38,78-90`）时为 `<configRoot>/profiles/<name>`；agentDir = 默认 profile 下的 `PI_CODING_AGENT_DIR` || `<configRoot>/agent`（`:247-249`）；sessions = `agentSubdir(agentDir,"sessions","data")`（`:777-779`）：Linux/darwin 上若 `$XDG_DATA_HOME/omp` 已存在则为 **`$XDG_DATA_HOME/omp/sessions`（去掉 agent/ 一层）**，否则 `<agentDir>/sessions`（`:286-301`）。上游**没有** `OMP_HOME`、`OMP_AGENT_DIR`、`OMP_SESSION_DIR`（源码 grep 无命中；`cli/help-extra.ts:57` 只列 `PI_CODING_AGENT_DIR`）。

| 实现                                                                                                                              | Pi                                                                                                                                                                                                                                                                     | OMP                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Paseo `resolvePiSessionsDir` / `resolveOmpSessionsDir`（`pi/session-descriptor.ts:109-135`，`omp/session-descriptor.ts:113-139`） | providerParams.sessionDir → `PI_CODING_AGENT_SESSION_DIR`（runtimeSettings.env 优先于进程 env）→ 项目 `.pi/settings.json` → 全局 settings.json → `PI_CODING_AGENT_DIR`/`~/.pi/agent` + `/sessions`。**与上游一致**，只是没处理 `--session-dir` 参数（本就是 CLI 参数） | providerParams.sessionDir → `OMP_SESSION_DIR` → `.omp/settings.json` → `OMP_AGENT_DIR`/`~/.omp/agent`。两个 env 名上游不存在；且 `provider-config.ts:140` 把 `runtimeProviderParams.sessionDir` 默认填成字面量 `~/.omp/agent/sessions`，`agent.ts:2213,2362` 原样传入，**后面三个分支永远不可达**。`PI_CONFIG_DIR`、profile、XDG 都没覆盖（只有诊断用的 `resolveOmpDiagnosticPaths` `provider-config.ts:80-120` 做对了 configRoot/profile/agentDir/XDG_DATA_HOME） |
| 参考项目（`rollout.js:15129-15160`；`:10846-10890`）                                                                              | `TOKENTRACKER_PI_AGENT_DIR` → `PI_CODING_AGENT_DIR`（仅当 `~/.pi` 是目录，`:10864-10875` 二选一归属）→ `~/.pi/agent`，+ `/sessions`；忽略 `PI_CODING_AGENT_SESSION_DIR` 与 settings.json                                                                               | `TOKENTRACKER_OMP_AGENT_DIR` → `PI_CODING_AGENT_DIR`（当 `~/.pi` 不存在）→ `OMP_HOME`（自造）→ `~/${PI_CONFIG_DIR}` → `~/.omp`，+ `/agent/sessions`；不处理 profile 与 XDG                                                                                                                                                                                                                                                                                         |
| 文件发现                                                                                                                          | 参考项目递归 walk 全部 `.jsonl`（含 tasks/ 与 workflow 嵌套）；Paseo `walkJsonlFiles` 也递归                                                                                                                                                                           | 参考项目主文件只取 cwd 目录下一层，子 agent 另走递归 walker，两者同 source；Paseo 递归                                                                                                                                                                                                                                                                                                                                                                             |

对本任务的建议（不改现有 import 逻辑，用量扫描器自己解析）：

1. Pi：复用 `resolvePiSessionsDir` 的顺序即可。
2. OMP：按上游算 configRoot(`PI_CONFIG_DIR`, `OMP_PROFILE|PI_PROFILE`) → agentDir(`PI_CODING_AGENT_DIR`) → XDG_DATA_HOME 分支 → `sessions`；`resolveOmpDiagnosticPaths` 已有前半段可抽出复用。`PI_CODING_AGENT_DIR` 被两家共用，Paseo 每个 provider 的 `runtimeSettings.env` 分开读，不需要参考项目那种"谁装了谁拥有"的猜测。
3. 解析器共用一套（格式同源），差异只有三点：header 行号（扫前 N 行找 `type:"session"`）、推理列名（`reasoning` ‖ `reasoningTokens`）、`model_change` 形态（两字段 ‖ 合并串，用量本身不依赖它）。
4. 需容错：坏 JSON 行（Pi 6、OMP 38）、`.jsonl.lock` 等非 jsonl 文件、`custom`/`providerPayload` 超长行、未完成的末行（参考项目按最后一个换行符提交游标，`rollout.js:15303-15353`）。

## 9. 与访谈决定的对照

- Q25 "OMP 无 provider 则单桶"：兜底不需要，OMP 100% 有 provider。
- Q26 耗时口径：日志可直接支持，Pi/OMP 另可得到纯模型耗时（OMP 还带 ttft），是否展示由实现决定。
- 五列存储：Pi 的推理列要读 `reasoning`，否则和参考项目一样丢掉；`totalTokens` 两家都不含推理，与"绝不用 total_tokens 计价"的口径一致。
