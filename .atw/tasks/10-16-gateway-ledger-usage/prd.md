# 中转站记账与用量页融合

来源：总任务 [`10-16-magpie-osuna-gaps`](../10-16-magpie-osuna-gaps/prd.md) 的第 5 个子任务。这是起步稿，写明范围、依据和要在本任务里定的问题；需求还在 discover，`/atw-spec` 时整份重写。总任务的 Constraints、Implementation Decisions、Testing Decisions 对本任务全部适用，下面只写本任务特有的。

## Problem Statement

用量页（Usage）只读 CLI 自己的会话记录，分不出哪些用量走了哪家第三方接口、各家花了多少。中转站的切换、失败、冷却只写在 daemon 日志里，冷却状态只在内存里，重启就没了。

## Scope

### 要做

- 账本：内置中转站给每次经过的请求记一条，包括哪家接口、哪个模型、token、耗时、首字等待、切换与失败；不存对话内容（Q18、Q24）。
- 去重：读 CLI 会话记录时，跳过账本里已有的调用。Claude Code 按回复的 `message.id`，Codex 按 `token_usage_record` 的 `response_id`，Pi / OMP 按会话记录里的 provider（Q18；依据 magpie `docs/subsystems/gateway-sessions.md`、`internal/usage/codex_identity.go:42-51`）。
- 用量页按来源分开：官方一组，每家第三方接口各一组（Q18、Q24）。
- 价格倍率：每家接口一个倍率，估算成本 = 公开价 × 倍率；自定义价格优先（Q23，照 magpie 的 `PriceRate`）。
- 人民币显示，大数用「万 / 亿」：汇率每天取一次，取不到用上次的（Q19）。
- 出字速度与首字等待统计（Q24）。
- 逐条请求列表，可导出 CSV（Q24）。
- 接口页的「最近切换、失败、冷却」改读账本，重启不丢（Q24）。

### 在本任务的地图里定

- 账本怎么存：追加式文件怎么落盘、留多久、多大，和现有用量缓存是什么关系。
- 去重的边界情况：CLI 记录先到还是账本先到、daemon 重启时中断的请求、在终端里直接跑的会话。
- Pi / OMP 的对账规则（要在子任务 6 之前定好）。
- 用量页、请求列表、接口页记录的界面。
- 用量页怎么显示子任务 4 查到的余额。
- 把块 7、块 16 的明细逐行标「做 / 不做」。

### 不做

- 块 16 没选的条目，以后再说：5 分钟与 1 小时缓存写入分开、1 小时缓存价与长上下文分档价、按实际回答的模型找价、额度提醒与历史与整窗估算、更多统计（调用次数、最长连续、最忙一天、按时段、会话形态、请求用途）、上下文被什么占着、按历史调参。
- 块 7 的实时路由页、按天回放、查看请求体与回复体、中转站查询接口、Claude Code 状态栏。

## Decisions So Far

- Q12：原定轻量、只存内存、不记账，已被 Q18、Q24 推翻：现在要记账，重启不丢。
- Q18：照搬 magpie 的做法（办法二），推翻 ADR 0007 否决的「Record the gateway's own usage」。
- Q19、Q23、Q24：见「要做」。

## Ordering

- 排在子任务 4 之后：用量页要用到它的余额。
- 子任务 6 排在本任务之后：Pi / OMP 接入时，按这里的对账规则跳过经过中转站的调用。

## Constraints

- 写新 ADR 推翻 ADR 0007 的那条否决项，并在 ADR 0007 里标出。
- 用量（Usage）与套餐用量（Plan usage）的命名分界照 ADR 0006。
- 存储遵守 `docs/data-model.md`。
- 更新 `docs/usage.md`：用量来源多了中转站账本；「Outbound requests」加上取汇率的请求。
- 术语表要改的词条：Usage、Usage source、Estimated cost、Failover、Endpoint status。

## Testing

- daemon 端到端测试：请求经过中转站后读用量的 RPC，验证不重复计算、按接口分开、倍率与人民币。
- 用量解析与对账的已有套件加用例。
- 浏览器测试：用量页分组、请求列表与 CSV 导出、接口页记录。

## Source Rows

块 7：01·A24–A27, A34–A35, G01–G08；02·C05, C07–C11；03·G01, G08, G12–G13, L01–L02, J10。块 16：03·G02–G19, H01–H12, K01–K03, L03–L04；04·K2–K4。两块都只做选中的部分。

## Getting Started

由用户输入 `/atw-map` 先画地图：把「在本任务的地图里定」摊成一张张要定的问题，再逐个定。

## Acceptance Criteria

- [ ] TBD — discover 之后写。
