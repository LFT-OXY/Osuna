# Claude Code 认识接口模型：数据从哪里来（工单 18）

调研日期 2026-10-15。Claude Code 版本 2.1.299（本机 `/opt/homebrew/Caskroom/claude-code@latest/2.1.299/claude`）。

## Claude Code 这边认什么

| 设置 | 作用 | 出处 |
|---|---|---|
| 模型名后加 `[1m]` | 不认识的名字带 `[1m]` 一律按 100 万上下文算；发请求前去掉后缀 | code.claude.com/docs/en/model-config.md「Correct the window for a gateway or custom model ID」「Customize pinned model display」（"Claude Code strips the suffix before sending the model ID to your provider"） |
| `env.CLAUDE_CODE_MAX_OUTPUT_TOKENS` | 一个值管所有请求；不认识的模型默认 32000、上限 128000 | env-vars.md 同名行 |
| `env.CLAUDE_CODE_MAX_CONTEXT_TOKENS` | 一个值管所有「不认识、又没带 `[1m]`」的模型；不设就按 20 万压缩 | env-vars.md 同名行；model-config.md 同上一节 |
| `env.CLAUDE_CODE_MODEL_CAPABILITIES` | `模型=effort,xhigh_effort,max_effort;…`，`*` 结尾是前缀匹配，`-能力` 是关掉；比较前去掉 `[1m]` | 公开文档没有；2.1.299 二进制里的 `cPo()` 解析函数（`r.split(";")`、`indexOf("=")`、`endsWith("*")`、`m(e)=e.replace(/\[1m\]/gi,"")`） |

模型名含 Claude 官方名（`chinhae/claude-opus-5-5`）时 Claude Code 自己认识（model-config.md：`anthropic/claude-opus-4-8` 能认出），不用写。

## Osuna 现在有什么

接口模型只存 `{ id, label }`（`packages/protocol/src/api-endpoint/rpc-schemas.ts:13`）；拉列表时只读 `id`/`slug` 和显示名（`packages/server/src/server/api-endpoints/upstream-models.ts` 的 `collect`），其它字段丢掉。模型也可以手填。

## 各家模型列表给不给

| 列表格式 | 上下文 | 最长回复 | 思考档位 |
|---|---|---|---|
| Anthropic 官方 `/v1/models` | `max_input_tokens` | `max_tokens` | `capabilities.effort.{low,medium,high,xhigh,max}.supported` |
| OpenAI 官方 / new-api 类中转站 `/v1/models` | 无 | 无 | 无 |
| Codex `models[]`（`slug`） | `context_window` | 无 | `supported_reasoning_levels` |
| OpenRouter | `context_length` | `top_provider.max_completion_tokens` | 无明确档位 |

常见中转站走 OpenAI 格式，基本什么都不给。实现时 `data[]` 里若带 `max_output_tokens` / `supported_reasoning_levels`（网关类列表）也一并读。

## 两份公开资料

| | LiteLLM 模型表 | models.dev |
|---|---|---|
| Osuna 现状 | 已在用：用量价格每天下载一次，内置快照；只留四列价格（`packages/server/src/server/usage/pricing/table.ts`），docs/usage.md 写明这是 daemon 唯一主动的对外请求 | 没用；magpie 用它（`internal/catalog/catalog.go`） |
| 大小 | 2.8 MB | 5.7 MB |
| 上下文 / 最长回复 | `max_input_tokens` / `max_output_tokens` | `limit.input`（没有用 `limit.context`）/ `limit.output` |
| 思考档位 | 只有 `supports_reasoning` 和 `supports_{xhigh,max,…}_reasoning_effort` 几个布尔，o3、deepseek-v4-pro 只说「会思考」不说档位 | `reasoning_options[{type:"effort",values:[…]}]`，8873 条里 4224 条有 |

本机 dev 接口上的模型对照（输入上限 / 最长回复 / 档位）：

| 模型 | LiteLLM | models.dev |
|---|---|---|
| gpt-5.5 | 1,050,000 / 128,000 / xhigh | 922,000 / 128,000 / none–xhigh |
| gpt-5.6-* | 922,000 / 128,000 / xhigh | 922,000 / 128,000 / none–max |
| gpt-6-*、gpt-6.1-sol | 922,000 / 128,000 / xhigh、max | 922,000 / 128,000 / low–max |
| deepseek-v4-pro | 1,000,000 / 393,216 / 只说会思考 | 1,000,000 / 393,216 / none–max |
| kimi-k2.5 | 262,144 / 262,144 / 只说会思考 | 262,144 / 98,304 / 无 |
| qwen3-max、MiniMax-M2.5 | 无 | 有上下文和最长回复 |

## 发现的缺口

GPT-6 系列输入上限 92.2 万，不到 100 万，按「≥100 万加 `[1m]`」不会加，Claude Code 仍按 20 万压缩。magpie 另写 `CLAUDE_CODE_MAX_CONTEXT_TOKENS` 补这一块（`internal/agent/claude.go` 的 `claudeWindow`、`writeWindow`，约 820、1889 行）：一个值管所有没带 `[1m]` 的模型，取起始模型的；起始模型带 `[1m]` 时取其余已知模型里最小的。

## 用户决定（2026-10-15）

- 数据来源：先看接口自己的模型列表给没给（Anthropic、Codex、OpenRouter 格式），没给的查 models.dev（magpie 的做法）。models.dev 的下载归价格表的自动更新开关管，开关关掉就不下载；只在 Claude Code 总开关开着时下载。
- 另写 `CLAUDE_CODE_MAX_CONTEXT_TOKENS`，按起始模型取（magpie 的做法）；起始模型带 `[1m]` 或不知道时不写。
- 用户自己设了的这四个值一律不碰；关总开关时只删 Osuna 写的。
