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
**Impl:** ready

- [ ] 端到端：Codex 请求翻译成 Chat 格式、Anthropic 格式时，上游都收到 `prompt_cache_key` 等四个字段（Chat 上游收哪几个照 magpie）。
- [ ] 资料里有 xhigh 档的模型收到 xhigh；没有 xhigh 档的模型，按 magpie 的规则收到最接近的档位。
- [ ] 请求没给回复上限、翻译成 Messages 格式时，`max_tokens` 等于模型公布的上限；资料里没有时是 16384。
- [ ] 其余四种修补，在翻译套件里各有用例。
- [ ] 第 15 张直接复用本张的模型资料查询，不另写一份。
- [ ] 借鉴 magpie 的代码，文件头保留 MIT 声明。
- [ ] `npm run typecheck`、`npm run lint` 通过，改到的测试文件本机通过。

参考：prd.md 第 21 条；明细 01·B17、B34、B41、B43、B51、B55、B56。
