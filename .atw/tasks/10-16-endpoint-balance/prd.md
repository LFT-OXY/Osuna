# 余额与套餐额度显示

来源：总任务 [`10-16-magpie-osuna-gaps`](../10-16-magpie-osuna-gaps/prd.md) 的第 4 个子任务。这是起步稿，写明范围、依据和要在本任务里定的问题；需求还在 discover，`/atw-spec` 时整份重写。总任务的 Constraints、Implementation Decisions、Testing Decisions 对本任务全部适用，下面只写本任务特有的。

## Problem Statement

用户不知道每家中转服务还剩多少钱、套餐 key 还剩多少额度。Osuna 现有的 9 个套餐用量来源（Plan usage source）只读 CLI 的登录或环境变量，不读第三方接口里存的 key。

## Scope

### 要做（照 magpie 全做，只显示）

- 已知厂商按地址自动查余额：DeepSeek、Kimi、OpenRouter、硅基流动、阶跃等（02·A70）。
- new-api / one-api：「这把 key」只用 key 查（`/api/usage/token`）；「整个账户」另填系统访问令牌和用户 ID 查（`/api/user/self`）。
- sub2api：「这把 key」只用 key 查（`/v1/usage`）；「整个账户」用登录令牌查（`/api/v1/user/profile`）。
- OpenAI 旧式额度（`/dashboard/billing/credit_grants`）。
- 自定义余额地址与取值表达式。
- 套餐 key 的额度窗口：Kimi Code、GLM Coding Plan、MiniMax 等（02·A73）。
- 查不到时显示原因：地址不对、令牌被拒、服务不支持。

查法与取值照 magpie `internal/provider/balance.go:42-145`。

### 在本任务里定

- 中转服务要不要由 Osuna 自动试探余额地址（magpie 不试探，要用户填）。
- 什么时候查、多久查一次、能不能关。
- 接口余额与套餐用量（Plan usage）在界面和用词上怎么区分。

### 不做

- 按余额或额度提前换家（Q10）。

## Decisions So Far

- Q10：只做显示，不做按额度提前换家。
- Q16：照 magpie 全做，「能查的话那就不需要省了」。

## Ordering

- 排在子任务 3 之后：用同一组页面。
- 子任务 5 排在本任务之后：用量页要用到这里的余额。

## Constraints

- daemon 会带着 key 对外发请求：写进 `docs/usage.md` 的「Outbound requests」（总任务 Implementation Decisions 第 7 条）。
- 查余额的请求用 Osuna 自己的身份。
- key 和令牌只存在 daemon 里，不发给客户端。

## Testing

- daemon 端到端测试：本机假余额接口扮演 new-api、sub2api 和已知厂商，验证请求带了什么、取到的值对不对、失败原因对不对。
- 浏览器测试：余额与额度窗口的显示、查不到时的提示。

## Source Rows

块 5：02·A70–A74, B27–B28；01·F03, D08；03·I01–I10，去掉按额度换家的部分。

## Getting Started

由用户输入 `/atw-askme-with-docs` 定上面三个问题，再 `/atw-spec`。

## Acceptance Criteria

- [ ] TBD — discover 之后写。
