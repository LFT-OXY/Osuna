# Claude Code / Codex 接入细节与联网搜索放行

来源：总任务 [`10-16-magpie-osuna-gaps`](../10-16-magpie-osuna-gaps/prd.md) 的第 2 个子任务。这是起步稿，写明范围、依据和要在本任务里定的问题；需求还在 discover，`/atw-spec` 时整份重写。总任务的 Constraints、Implementation Decisions、Testing Decisions 对本任务全部适用，下面只写本任务特有的。

## Problem Statement

- 打开、关掉「使用第三方接口」（Use API endpoints）前后开的 Codex 对话互相看不见；关掉后，经中转站开的对话续不上。推断的原因（未实际运行）：Codex 按服务商分组记录对话，开关打开时 Osuna 只向 Codex 要中转站那个服务商名下的对话，关掉时又删了那个服务商表。
- Claude Code 的 `settings.json` 带 BOM 或注释，就被当成解析不了，Osuna 什么都不写。
- 走第三方接口时，Osuna 给 Claude Code 写了 WebSearch 的禁用规则，所以一律不能联网搜索，哪怕那家中转服务自己会搜。
- 其余接入细节见下面的候选。

## Scope

### 已定要做

- 每家接口加「这家自己会联网搜索」开关：打开后，Claude Code 用这家时不再禁止 WebSearch，搜索请求原样交给这家（02·A26）。要核实能不能只对这家生效：禁用规则写在 Claude Code 的 `settings.json` 里，对整个 CLI 生效，而中转站按每个请求选接口。
- 定下 Codex 经过内置中转站的接法：维持现在的独立服务商表，还是像 magpie 那样，Codex 用 ChatGPT 登录时只写 `openai_base_url`。子任务 9 的第二层要建在这里的结论上，见「与子任务 9 的关系」。

### 候选（在本任务里挑）

- Codex 对话：开关前后互相看不见；关开关后旧对话续不上。
- 走中转站时保留 claude.ai 登录。
- Subagent 与后台小模型用哪个模型（上次明确不做，这次重新问）。
- 新会话的推理强度。
- 云厂商开关与 managed-settings 让请求绕过中转站时的提示。
- 带点的版本号模型名改写。
- 外部改动的提示回到界面上。
- `settings.json` 容忍 BOM 和注释。
- 关开关前预览会改回什么。
- 改完提示哪些会话要重开才生效。

### 不做

- 代搜：Osuna 用搜索服务替上游搜、搜索 MCP（01·A16, B28, B29, H04；04·D1–D16）。
- Codex 与 ChatGPT 登录并存：归子任务 9。

## Decisions So Far

- Q8：块 2 做，具体条目进本任务再定。
- Q11：先做「这家自己会联网搜索」的按接口开关；代搜以后再说。

## 与子任务 9 的关系

magpie 的做法：Codex 用 ChatGPT 登录时只写 `openai_base_url`。Codex 保留自带的 OpenAI 服务商和登录，对话仍记在 OpenAI 名下，第三方模型和 ChatGPT 自带模型同时出现在 `/model` 里；没有登录、或用 API key 登录时，才用独立的服务商表（magpie `internal/agent/codex.go:30-36`）。这可能也能解决「开关前后对话互相看不见」，但只对 ChatGPT 登录有效，未核实。子任务 9 的第二层（经过内置中转站换号）建在本任务定下的接法上，所以定接法时要把它考虑进去。

## Ordering

- 没有前置任务。
- 子任务 9 排在本任务之后。

## Constraints

- ADR 0004 的文件改写规则适用于每个新写的键。
- 改 WebSearch 禁用规则，要写新 ADR 或更新 ADR 0004 里的那一条。
- 改 Codex 的接法，要更新 ADR 0007 里 Codex 写什么的那几条。

## Testing

- daemon 端到端测试：先例是 Claude Code 配置、Codex 配置那两组；CLI 配置目录一律指向临时文件夹。
- 已有的 CLI 配置改写套件继续加用例（BOM、注释等）。
- 界面改动（联网搜索开关等）加浏览器测试。

## Source Rows

块 2：03·A03, A06, A09–A11, A15, A17, B04–B08, B10–B14, C01–C10, C13–C14, J12；01·A38, F08。块 6：02·A26。

## Getting Started

由用户输入 `/atw-askme-with-docs` 挑候选、核实联网搜索能否按家生效，再 `/atw-spec`。

## Acceptance Criteria

- [ ] TBD — discover 之后写。
