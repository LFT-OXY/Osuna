# 04 — Gemini 出错时冷却和自动切换

**What to build:** Gemini 地址出错时和别的格式一样判错、冷却、自动切换（Failover）。另外认得出 Gemini 特有的两种情况：回「API key not valid」时这家被标成「需要检查」并换家；限流时按 Gemini 给的「N 秒后再试」冷却。空回复、中途断开、安全拦截、「没有这个模型」都按规则处理，CLI 不会收到半截或空的回答。

**Blocked by:** 02
**Status:** ready-for-agent
**Impl:** done

- [x] 400 且错误说 key 无效（`API key not valid` / `API_KEY_INVALID`）认作 key 无效：标「需要检查」、换家（G4，比 magpie 多）。
- [x] 读 `error.details` 里 RetryInfo 的 `retryDelay` 作为恢复时间，与现有 Retry-After、重置时间同一优先级规则（G5，比 magpie 多）。
- [x] 额度用尽、欠费、限流按现有状态码 + 词表分类（`RESOURCE_EXHAUSTED` 等），冷却时长沿用现有规则。
- [x] 思考后空回复（只想了、什么都没说）在同一家多重试一次（magpie 59289946 的 `emptyRetries`：思考已随来随发给了 Agent，重问在原地接着写；从 03 挪来）。
- [x] 空回复（什么都没说、且不是 length / filter 结束）按失败重试或换家；没见到 finishReason 就断开按「回复不完整」处理；没有 candidate 的 chunk 交给空回复逻辑（照 magpie）。
- [x] 安全拦截（`promptFeedback.blockReason`，或 SAFETY、PROHIBITED_CONTENT、BLOCKLIST、SPII、IMAGE_SAFETY 结束且还没输出内容）按拒答：不冷却、换下一家。
- [x] 「没有这个模型」时按现有规则去掉这个格式再试下一种或下一家。
- [x] 测试：daemon 端到端用假 Gemini 上游逐个回 key 无效、带 `retryDelay` 的 429、额度、限流、空回复、中途断开、安全拦截、没有这个模型，检查冷却状态（接口页记录）与是否自动切到下一家同名模型；判错套件、冷却套件加用例。

参考：prd「判错与冷却」，用户故事 38–45；`research/decisions.md`「判错」与回复部分。

实现时凡本工单没写明的细节，先查 magpie 最新 main 的做法并照做（源码要重新克隆 yetone/magpie 到 `/tmp` 下只读查看）；比 magpie 少做或更严一律不行，除非 prd 写明（G4、G5 是写明的多做）。测试绝不连真实中转服务或 Google。

## Comments

- 2026-10-25 实现：`failure.ts` 加 `keyInvalid`（400 说 key 无效 → auth、可换家）；`cooldown.ts` 的 `vendorWait` = Retry-After，否则错误体 RetryInfo 的 `retryDelay`，额度、限流、最后一家原地等都用它。Gemini 的 429 带 `QuotaFailure` 时按词表算额度（类型名里有 quota），与 magpie 一致。
- 解码器：不带 `candidates` 字段的 chunk 发 `done`（说完了、没有结束原因）；`candidates: []` 不算（照 magpie `geminiEnds`）；`promptFeedback.blockReason` 属安全过滤的发 `filter` 结束，即拒答。工单 02 的旧测试「只带用量的 chunk 不算结束」照 magpie 改写。
- 空回复：开口前 Gemini 什么都没说（有结束原因或 `done`）即空回复，沿用现有的重问一次再换家、不冷却。开口后只想了没说：流式在同一家按原请求原地再问最多 3 次（magpie `emptyRetries` 的 `thoughtOnly` 分支），思考留在 CLI 那里、新回答接在后面；仍空则流尾报 `<名字>: an empty reply …`，`lateRests` 不冷却（magpie #1221）。整份请求先读完再交，空的交回中转站重问一次再换家。
- 开口前「什么都没说、流结束、没说完」现在对所有非 Chat 格式都换家（照 magpie 被扣着的尝试的 `errEndedShort`）；通用中转站与 Chat 入口的端到端测试（269 条）本机通过。
- 审查后未改的判断项：`retryDelay` 与 `resetsIn` 解析错误体的写法相近未抽公共函数；`askAfterEmpty` 与续写的 `askUntilSettled` 循环相近；`to === "gemini"` 分在 `isEmptyReply`、`answeredNothing` 两处（`endedEmpty` 不分格式）；测试注释里带工单代号 G4/G5。magpie 的 `matesLast`（同一家多账号排后）Osuna 无多账号，不适用。
