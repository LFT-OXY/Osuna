# Gemini 上游格式

来源：总任务 [`10-16-magpie-osuna-gaps`](../10-16-magpie-osuna-gaps/prd.md) 的第 7 个子任务。这是起步稿，写明范围、依据和要在本任务里定的问题；需求还在 discover，`/atw-spec` 时整份重写。总任务的 Constraints、Implementation Decisions、Testing Decisions 对本任务全部适用，下面只写本任务特有的。

## Problem Statement

中转服务的 Gemini 模型用不了：第三方接口只有 Anthropic、OpenAI Chat、OpenAI Responses 三种请求格式（Request format），内置中转站不会把请求翻成 Gemini 格式。用户的说法：大家不用 Gemini CLI，而是在 Claude Code、Codex、Pi、OMP 里调用 Gemini 模型（Q14）。

## Scope

### 要做

- 第三方接口多一个 Gemini 格式的地址，一家最多四个地址（02·A07）。
- 内置中转站把 Claude Code、Codex、Pi、OMP 的请求翻成 Gemini 格式发出，再把回复（含流式）翻回它们各自的格式；思考、工具调用、图片都要照常（01·B01、B60 的 Gemini 上游部分）。
- 判错、冷却、自动切换覆盖 Gemini 上游。
- 测试连接、自动识别格式、拉模型清单都支持 Gemini 地址。

### 在本任务的地图里定

- 翻译细节：思考签名、工具调用、图片、安全设置、用量字段。
- 判错分类：Gemini 的各种错误对应哪种冷却。
- 模型清单怎么拉，名字怎么和别家的同名模型对上。

### 不做

- Gemini 入口（给 Gemini CLI 用，01·A13）、Vertex（02·V01–V05）、Code Assist（Q15）。

## Decisions So Far

- Q14：Gemini 格式要做，为的是让 Claude Code、Codex、Pi、OMP 能用中转服务的 Gemini 模型。
- Q15：只做上游一半；不做 Gemini 入口、Vertex、Code Assist。

## Ordering

- 排在子任务 1 之后：共用那里改过的翻译与判错。
- 排在子任务 6 之后：Pi、OMP 也要能用。

## Constraints

- 术语表的 Request format 词条改为四种。
- ADR 0007 里「三种请求格式互译」的说法随之更新。
- 照 magpie 的 Gemini 翻译写的文件，保留 MIT 声明。

## Testing

- daemon 端到端测试：本机假 Gemini 上游，分别让测试程序扮演 Claude Code、Codex、Pi、OMP 发请求。
- 翻译的已有测试套件加 Gemini 的用例。

## Source Rows

01·B01, B60 的 Gemini 上游部分；02·A07。

## Getting Started

由用户输入 `/atw-map` 先画地图，再逐个定。

## Acceptance Criteria

- [ ] TBD — discover 之后写。
