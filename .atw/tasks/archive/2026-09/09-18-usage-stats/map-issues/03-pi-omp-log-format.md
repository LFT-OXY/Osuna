# 03 — Pi 与 OMP 会话日志的用量解析规则与后端字段

**Type:** research
**Blocked by:** None
**Status:** resolved

## Question

对着本机 `~/.pi/agent/sessions` 与 `~/.omp/agent/sessions` 的真实样本与参考项目 `parsePiLikeIncremental` / `parseOmpLikeIncremental`，确定：(1) assistant 消息的 `usage` 五列字段名与 `totalTokens` 的关系；(2) **每条消息是否带后端 provider 字段**（Pi 的 `msg.provider`；OMP 是否也有，没有的话能否从 `model` 的 `provider/model` 形式或 session header 推出），这决定 OMP 能否按后端拆来源；(3) 去重键（`entry.id` / 顶层 8 字符 id）；(4) session header 里 cwd、sessionId、timestamp 的位置；(5) 子 agent 的 transcript 目录结构，是否计入父会话；(6) 每轮边界与耗时推导；(7) Paseo 的 `resolvePiSessionsDir` / `resolveOmpSessionsDir` 与参考项目目录解析是否一致（`PI_SESSION_DIR`、`OMP_HOME` 等）。产出 `research/pi-omp-log-format.md`。

## Answer

产出 `research/pi-omp-log-format.md`（字段表、去重、子 agent、轮次耗时、目录解析各一节，均附样本文件 + 行号或参考项目行号）。要点：

1. **OMP 每条 assistant 消息都有 `message.provider`**（全量 14182/14182），Pi 同样 100%。OMP 可以按后端拆来源，参考项目单桶是它自己没做；Q25 的"无字段则单桶"兜底可删。provider 值大小写不统一（`Anthropic` vs `anthropic`），拆桶前归一化。
2. usage：两家都是 `input/output/cacheRead/cacheWrite` + 推理列；**Pi 0.85 推理列叫 `reasoning`，OMP 叫 `reasoningTokens`**；`totalTokens` 恒 = 四列之和、不含推理；推理是 output 子集。参考项目对 Pi 读 `reasoningTokens` 恒得 0。
3. 去重键 = 顶层 8 位 hex `entry.id`，需跨文件：OMP 分支/续接会把父会话条目复制进子文件（92 条完全相同副本，子文件 header `parentSession` 为父文件路径）。
4. header `type:"session"`{version,id,timestamp,cwd,parentSession?}：Pi 恒第 1 行，OMP 恒第 2 行（第 1 行是定长 `title`）。OMP 目录名有 `-<home 相对>`、`-tmp-…`、`--<绝对>--` 三种且会自动迁移，cwd 必须读 header。
5. 子 agent 都在与主文件同名的同级目录：Pi `tasks/<ts>_<uuid>.jsonl`（header parentSession = 父 uuid）与 `<8hex>/run-N/session.jsonl`；OMP `<Agent>.jsonl`、`<Sub>/<Sub>.<Grand>.jsonl`（靠路径归属）。都算同 cwd 同来源。OMP 还有独立 `model_usage` 行记录 smol 角色调用，参考项目不计。
6. 轮次 = user 到下一 user；assistant `message.timestamp`(ms) 是请求开始，`entry.timestamp`(ISO) 是写盘，差值 = 单次模型耗时（OMP 自带 `duration`/`ttft`，2 秒内吻合 14044/14053）；墙钟轮耗时按 Q26 口径可直接算。
7. 目录解析：Paseo Pi 侧与上游一致；Paseo OMP 侧的 `OMP_AGENT_DIR`/`OMP_SESSION_DIR` 上游不存在，且 `provider-config.ts:140` 默认字面量使后续分支不可达；上游 OMP 真值是 `PI_CONFIG_DIR` + `OMP_PROFILE|PI_PROFILE` + `PI_CODING_AGENT_DIR` + `$XDG_DATA_HOME/omp/sessions`（`pi-utils/src/dirs.ts:247-301,777-779`），参考项目的 `OMP_HOME` 也是自造的。用量扫描器建议自己按上游规则解析。
