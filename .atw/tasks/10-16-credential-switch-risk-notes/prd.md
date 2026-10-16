# 登录凭证开关与风险提示

来源：总任务 [`10-16-magpie-osuna-gaps`](../10-16-magpie-osuna-gaps/prd.md) 的第 8 个子任务。这是起步稿，写明范围、依据和要在本任务里定的问题；需求还在 discover，`/atw-spec` 时整份重写。总任务的 Constraints、Implementation Decisions、Testing Decisions 对本任务全部适用，下面只写本任务特有的。

## Problem Statement

Osuna 为显示套餐用量（Plan usage）会读 CLI 的登录凭证，比如 Claude Code 的钥匙串项、Codex 的 `auth.json`，没有地方关掉。Antigravity 有封号风险，Osuna 的 Antigravity 提供方页没有提示。

## Scope

### 要做

- 主机级「不读登录凭证」总开关，照 magpie 的账号发现开关（02·B25：关了就不读任何凭据，关前列出受影响的订阅）。关掉读取后，读 CLI 登录的套餐用量来源全部停止，套餐用量不显示；子任务 9 的多号自动轮换也停。
- Antigravity 提供方页加风险提示。依据是 Antigravity FAQ：把 `agy` 包进第三方应用、或自动轮换账号，消费者套餐不支持（`../10-16-magpie-osuna-gaps/research/subscription-ban-risk.md`）。

### 在本任务里定

- 开关叫什么、哪一边算「开」、放在哪个设置页。
- 关掉后，已经读到的数据怎么处理。
- 风险提示的文字与链接；做法要能给子任务 9 沿用。

## Decisions So Far

- Q21：做这个小子任务，排在订阅账号之前。
- Q25：8 排在 9 前面，因为 9 要用到这里的总开关和风险提示做法。

## Ordering

- 没有前置任务。
- 子任务 9 排在本任务之后，服从这里的开关，沿用这里的风险提示做法。

## Constraints

- 测试不读真实的钥匙串和登录文件（总任务 Testing Decisions）。

## Testing

- daemon 端到端测试：开关打开前后，套餐用量来源是否去读（用临时目录里的假凭证）。
- 浏览器测试：开关、关前列出的受影响项、Antigravity 页的提示。

## Source Rows

02·B25；03·I01 里套餐用量来源的现状；`subscription-ban-risk.md` 的 Antigravity 部分。

## Getting Started

由用户输入 `/atw-askme-with-docs` 定上面三个问题，再 `/atw-spec`。

## Acceptance Criteria

- [ ] TBD — discover 之后写。
