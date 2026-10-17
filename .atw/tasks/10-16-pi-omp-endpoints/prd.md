# Pi / OMP 用上第三方接口

来源：总任务 [`10-16-magpie-osuna-gaps`](../10-16-magpie-osuna-gaps/prd.md) 的第 6 个子任务。这是起步稿，写明范围、依据和要在本任务里定的问题；需求还在 discover，`/atw-spec` 时整份重写。总任务的 Constraints、Implementation Decisions、Testing Decisions 对本任务全部适用，下面只写本任务特有的。

## Problem Statement

Pi、Oh My Pi（OMP）用不上第三方接口：内置中转站只有 Anthropic Messages 和 OpenAI Responses 两种 Agent 入口，Osuna 也不往 Pi、OMP 的配置里写中转站。

## Scope

### 要做

- 内置中转站加 OpenAI Chat 入口（01·A04），与现有入口一样只收本机请求、凭提供方的中转站口令。
- Pi、OMP 有「使用第三方接口」开关和默认模型（Default model），与 Claude Code、Codex 用同一套设置。
- Osuna 写进 Pi、OMP 配置的服务商：默认用 OpenAI Chat 格式，个别模型改走 Responses 或 Anthropic（照 magpie：服务商默认 `api: "openai-completions"`，见 magpie `internal/agent/pi_api_test.go:14-67`、`omp_api_test.go:17-71`）。
- Pi 在对话中途加的工具，提升到请求顶层（01·B59）。
- 经过中转站的调用，按子任务 5 定的规则对账，不算两遍。

### 在本任务里定

- Pi、OMP 各写哪些配置文件和键。magpie 给 Pi 写服务商和默认模型、补 enabledModels、打开会话亲和头；给 OMP 写 config.yml 和 models.yml、enabledModels 加 magpie/**、命名 profile 各自接入（03·D01、D02）。
- 在终端里直接跑 Pi、OMP 时是否同样生效（Claude Code、Codex 现在会）。
- 关掉开关时怎么还原。

### 不做

- Pi、OMP 以外的 Agent；Chat 以外的新入口（见总任务 Out of Scope）。

## Decisions So Far

- Q13：做 Pi、OMP，其他 Agent 不做。
- Q17：块 10 只加 OpenAI Chat 入口，随本任务一起做。

## Ordering

- 排在子任务 5 之后：要按它的对账规则跳过经过中转站的调用。
- 子任务 7 排在本任务之后：Pi、OMP 也要能用 Gemini 模型。

## Constraints

- ADR 0004 的文件改写规则适用于 Pi、OMP 的配置文件。
- 术语表里 Gateway、Use API endpoints、Default model 等词条中「Claude Code 和 Codex」的说法扩到 Pi、OMP。

## Testing

- daemon 端到端测试：让测试程序扮演 Pi、OMP 打 Chat 入口；Pi、OMP 的配置改写全在临时目录里做。
- 浏览器测试：Pi、OMP 提供方设置页的开关与默认模型。

## Source Rows

03·D01, D02；01·A04, B59；02·C16 的 Pi 部分；03·A01, A14, A21 中与 Pi、OMP 有关的部分。

## Getting Started

由用户输入 `/atw-askme-with-docs` 定上面三个问题，再 `/atw-spec`。

## Acceptance Criteria

- [ ] TBD — discover 之后写。
