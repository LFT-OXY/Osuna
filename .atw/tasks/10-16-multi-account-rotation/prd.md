# Codex 与 Claude Code 多号自动轮换

来源：总任务 [`10-16-magpie-osuna-gaps`](../10-16-magpie-osuna-gaps/prd.md) 的第 9 个子任务。这是起步稿，写明范围、依据和要在本任务里定的问题；需求还在 discover，`/atw-spec` 时整份重写。总任务的 Constraints、Implementation Decisions、Testing Decisions 对本任务全部适用，下面只写本任务特有的。

## Problem Statement

有多个 ChatGPT 或 Claude 订阅号的用户，一个号用完只能手动换。每个号一个配置目录的手工办法，会让会话和配置（技能、MCP、指令文件）分家（Q22）。

## Scope

### 要做（照 magpie 的两层，Q28）

- **Codex 第一层：换登录。** Osuna 保存用户的多个 ChatGPT 号；定时看 Codex 当前登录的号的额度，快用完或到了用户给这个号设的上限，就让 Codex 换登到下一个还有余量的号；原来的号回落后换回。可以调号的顺序，也可以固定只用某一个号。
- **Codex 第二层：经过内置中转站换号。** Codex 有多个号时，请求经过内置中转站；当前号接不了的请求，在回复第一个字之前交给别的号。可以关成只换登录。
- **Claude Code 只做第一层。** Claude 订阅的请求不经过内置中转站。
- 换登录只对新会话生效。Codex 已核实：app-server 启动时读一次登录，Osuna 正是用 app-server 跑 Codex，开着的对话要靠第二层。Claude Code 待核实。
- **风险提示：** 为 Codex、Claude Code 各自第一次打开时各提示一次，写明条款原文链接和可能的后果；不逐号确认，账号列表上不常驻风险标记（Q27）。
- **加号：** 让真的 Codex、Claude Code 完成登录，Osuna 收下结果。不像 magpie 那样借 Codex CLI 的登录客户端自己登录（magpie `internal/provider/account.go:982`、`internal/provider/signin.go:42-43`）。

### 在本任务的地图里定

- 具体数字。magpie：启动 1 分钟后看一次，之后每 5 分钟；任一窗口用到 98%（按顺序模式是 100%）或到了上限就换走；所有窗口回到 90% 以下换回（magpie `internal/provider/codex_switch.go:15-79`）。
- 号的顺序、每号每个窗口的上限、固定用某个号。
- 怎么读每个号的额度：Codex 的号向 OpenAI 查；Claude 的号，magpie 只靠 Claude Code 自己的 `/usage`，没读到过额度的号不换上去。
- 登录过期后怎么续：尽量让 CLI 自己续；必须由 Osuna 代办时单独决定，写进 ADR。
- 与「使用第三方接口」怎么同时存在。子任务 2 已定 Codex 用 ChatGPT 登录时只写 `openai_base_url`，第三方模型和 ChatGPT 自带模型同时出现在 Codex 的 `/model`，接口的模型写成「接口标识/模型名」（`../10-16-cli-wiring-web-search/research/decisions.md` Q9、Q25）；第二层建在这个接法上。
- 账号额度和余额都用完时怎么办（子任务 2 Q34 留到这里）。magpie 定时查额度，用完时临时把 Codex 改成独立服务商，好让 Codex 桌面应用还能用第三方模型（magpie `internal/agent/codex.go:964-1001,1145-1186`）。完全发不出的只有桌面应用，Osuna 用的 app-server 和终端 Codex 照常发出，事实见 `../10-16-cli-wiring-web-search/research/codex-account-held.md`。换到下一个还有余量的号可能就是这里的答案。
- 从别的工具的文件导入账号（02·B15）要不要做。
- 账号存在哪里、怎么保护。
- 界面：账号列表、各号额度、Agent 现在登录的是哪个号、为什么换了号、换号失败的原因和处理办法。

### 不做

- 订阅给别的 Agent 用（含 ChatGPT、Claude）、每日预热（02·B31）、签到（02·B32）、自动用掉 Codex 重置卡（02·B30）。
- 借用 CLI 的登录身份，由 Osuna 自己登录。

## Decisions So Far

- Q20 → Q22 → Q26：订阅账号只做 Codex 与 Claude Code 的多号自动轮换。
- Q27：打开时提示一次，每个提供方各一次。
- Q28：照 magpie 两层做。
- 第 6 轮助手的边界：不冒充别的产品，不躲避厂商识别。
- 第 8 轮：加号由真的 CLI 完成登录。
- 依据与出处见 `../10-16-magpie-osuna-gaps/research/decisions.md` 第 6–8 轮和 `subscription-ban-risk.md`。

## Ordering

- 排在子任务 2 之后：第二层建在那里定下的 Codex 接法上。
- 排在子任务 8 之后：服从它的总开关，沿用它的风险提示做法。

## Constraints

- 写新 ADR，推翻 ADR 0004 的「`~/.codex/auth.json` is never read or written」，并在 ADR 0004 里标出。
- 改写登录信息同样守 ADR 0004 的文件改写规则：原子替换、写前重读、解析不了就不写。Codex 的 refresh token 只能用一次，绝不能把旧的登录文件写回去（ADR 0004 的 Considered Options 记过这个坑）。
- 服从子任务 8 的总开关。
- 查各号额度的请求写进 `docs/usage.md` 的「Outbound requests」。
- 身份如实，见总任务 Implementation Decisions 第 15 条。

## Testing

- 测试绝不读写真实的 `~/.claude`、`~/.codex`、钥匙串，也不在本机运行真的 Claude Code。读写登录的部分做成可替换的适配器，测试用临时目录里的假凭证；Codex 只在临时 `CODEX_HOME` 里跑。
- daemon 端到端测试：本机假额度接口和假 ChatGPT 后端，验证第一层什么时候换登、换到谁、什么时候换回，第二层什么时候把请求交给别的号。
- 用真实账号的验收由用户自己做。做会改写 CLI 配置的界面验收前，先向用户说明怎么隔离，取得同意再做。

## Source Rows

块 12：02·B01–B33 中多号与自动切换的部分；01·A15, F04；03·C11, I08。在地图里逐行标「做 / 不做」。不做的：02·B30、B31、B32 和订阅给别的 Agent 用的各行。

## Getting Started

由用户输入 `/atw-map` 先画地图，再逐个定。

## Acceptance Criteria

- [ ] TBD — discover 之后写。
