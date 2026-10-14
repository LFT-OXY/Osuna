# 03 — 从 magpie 抄出判错词表、冷却常量与协议转换样本清单

Type: research
Status: resolved
Blocked by: None

## Question

magpie 源码在 `/Users/oxy/Documents/Configuration/dev-environment/demo/agent客户端源码/magpie`（MIT）。为 TypeScript 重写准备「照抄清单」：

1. **判错**：`internal/gateway/routing.go:124-160` 的全部正则（creditWords、usedUpWords、rateWords、plannedWords、quotaCodes、resetsWhen 等）原文抄出，附每条匹配的厂商例子；`:168-226` 的错误分类常量；`fallback.go:1075-1100` `retryable()` 的完整判定表；`fallback.go:945-991` modelRefused / modelRetired 的判定。
2. **冷却**：`routing.go:91-122` 的时长常量、`:545-674` `restAfterMarked` 的决策顺序、`:685-722` `rateRest` 的退避公式、`fallback.go:1166-1205` `passing` 的原地重试规则、`fallback.go:816-833` `quotaHeld` 的「全在冷却时不再请求」规则，整理成伪代码。
3. **粘性**：`affinity.go:335-405` `affine` 的 12 条判定表与常量（cacheWorth 1024、cacheCold 5 分钟、stickKeep 24 小时）、`gateway.go:5355-5452` 对话识别规则，整理成伪代码。
4. **协议转换**：`ir.go` 的 Request / Message / Part / Event / Usage 结构逐字段抄成 TypeScript 接口草稿；`anthropic.go`、`chat.go`、`responses.go` 各自 parse/build/decoder/encoder/render 的函数签名与职责；stop reason 与 usage 的映射表；magpie 自己加 cache_control 的三处位置；工具调用配对修补（pairToolBlocks 等）的规则。
5. **测试样本**：列出 `internal/gateway/` 下与这三种协议转换相关的 `_test.go` 文件清单（文件名、行数、测的是什么），标出哪些是「请求/响应 JSON 夹具」可直接搬到 TypeScript 测试、哪些是 Go 逻辑测试需重写。
6. **许可证声明**：MIT 声明原文，供借鉴文件头引用。

产出 `research/magpie-port-inventory.md`。只抄事实与出处，不做取舍。

## Answer

- 判错：抄出 10 条 routing.go 词表正则 + 3 条辅助 + 8 条 fallback.go 词表（均原文）、19 个 fail* 常量、`failure()` 9 步顺序、`retryable()` 判定表、`modelRefused/modelRetired` 规则，附源码注释里的厂商例子。
- 冷却：13 个时长常量原文、`Rest` 结构、`restAfterMarked` 全流程伪代码（含冷却键按账号/模型的 4 条例外）、`rateRest` 翻倍公式、`passing` 规则与主循环 4 处调用点、`quotaHeld` 条件。
- 粘性：4 个常量 + 5 种模式、`affine` 12 步判定与动作、`sessionHeaders` 6 个头、`conversationID` 哈希规则、`turnIn` 轮次计数。
- 协议转换：Request/Message/Part/Event/Usage/Result/Format 抄成 TS 接口草稿；三协议五件套签名与职责表；stop reason 双向 7 条映射；usage 三协议双向映射；`cache_control` 三处（末消息末块、system、无 system 时末工具）；`pairToolBlocks/pairToolMessages/joinToolRuns/orphanedToolOutputs/pairToolItems` 规则。
- 测试样本：`internal/gateway/` 共 550 个 `_test.go`，列出 86 个与三协议相关的（行数、Test 名、判定）；约 20 个可直接搬 JSON 夹具、12 个混合、其余为起假上游的 Go 逻辑；`testdata/upstream_bodies/` 13 个小 JSON 可搬、5 个大体只有 sha256。注意仓库里不存在 `anthropic_test.go` 等单文件，magpie.md 的测试行数无法复核。
- 许可证：MIT 原文及文件头短式。

报告：`research/magpie-port-inventory.md`
