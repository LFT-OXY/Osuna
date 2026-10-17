# 07 — 翻译的通用修补

**What to build:** 让中转站在选路时能查到每个候选模型的资料：上下文窗口、回复上限、推理档位。资料先取接口自己的模型清单，其次取 models.dev（都是现有来源）。

翻译时照 magpie 做这些：
- Codex 的 `prompt_cache_key`、`include`、`client_metadata`、`text.verbosity` 带给上游；
- 推理档位按模型真实支持的档位来适配，不再固定把 xhigh、max 降到 high；
- 需要回复上限而请求没给时，按模型公布的上限填，资料里没有才用 16384；
- 工具 schema 的根是 anyOf、oneOf 或 allOf 时，包成 object；
- 认得 Chat 上游的 `reasoning_details`，以及 Vertex 的 `extra_content.google.thought`；
- 翻给 Codex 的 assistant 消息标上 `phase`；
- Codex 中途改档位时，用 `configuration_update`。

**Blocked by:** None
**Status:** ready-for-agent
**Impl:** done

- [x] 端到端：Codex 请求翻译成 Chat 格式、Anthropic 格式时，上游都收到 `prompt_cache_key` 等四个字段（Chat 上游收哪几个照 magpie）。
- [x] 资料里有 xhigh 档的模型收到 xhigh；没有 xhigh 档的模型，按 magpie 的规则收到最接近的档位。
- [x] 请求没给回复上限、翻译成 Messages 格式时，`max_tokens` 等于模型公布的上限；资料里没有时是 16384。
- [x] 其余四种修补，在翻译套件里各有用例。
- [x] 第 15 张直接复用本张的模型资料查询，不另写一份。
- [x] 借鉴 magpie 的代码，文件头保留 MIT 声明。
- [x] `npm run typecheck`、`npm run lint` 通过，改到的测试文件本机通过。

参考：prd.md 第 21 条；明细 01·B17、B34、B41、B43、B51、B55、B56。

## Comments

### 核对记录（2026-10-17）

逐条对照代码与测试核过；改到的测试文件在 packages/server 下逐个单跑全部通过；`npm run typecheck`、`npm run lint` 在 HEAD 5e5287609 上通过。

- 第 1 条：照 magpie 做，Chat 上游只收 `prompt_cache_key`，Anthropic 上游四项都不收（responses.test.ts「an Anthropic upstream gets none of them」）——与原文「都收到」不同，用户 2026-10-17 认可，见 spec rpc-and-protocol.md 工单 07 一节。
- 第 4 条：`configuration_update` 没做（用户 2026-10-17 决定，需要时另开票）；`reasoning_details` 只从 Chat 客户端历史读，Osuna 目前没有 Chat 客户端，暂时触发不到（用户认可）。其余修补有用例。
