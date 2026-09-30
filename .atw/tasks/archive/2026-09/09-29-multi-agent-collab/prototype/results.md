# 路由提示遵从度实测结果（01 号票）

实测日期 2026-09-30。提示文本：`routing-prompt-v1.md`（v2 只改一条禁令，见 `routing-prompt-v2.md`）。

## 方法

- 脚本 `packages/server/src/server/prototype-routing-prompt-compliance.ts`（只在 `research/routing-prompt-compliance` 分支上）起一个隔离的进程内 daemon（临时 PASEO_HOME、随机端口、`mcpInjectIntoAgents: true`），不碰 6767。
- 每次在一个新的临时 git 仓库（`src/sum.js`、`src/format.js`）里建父智能体（最宽松模式），发"用户正文 + 路由块"。mention 写成 `[@Name](paseo://agent/<provider>)`（ADR 0005）。
- 场景：single（@Codex + 父自己的一小部分）、same（@Claude Code 两次）、cross（@Codex + @Claude Code）。每格 2 次。
- 路由块里的思考档位故意填非默认值（codex `medium`、claude `low`），用来检验父智能体是否照抄。
- 子智能体一出现就记下快照然后取消。取消之后父智能体会查状态、重发任务，这是实验手段带来的噪声，不计入。
- 父模型取各自的默认：Claude `claude-opus-5-5`、Codex `gpt-6-astra`、Pi `openai-codex/gpt-6-astra`（Pi 的用户设置默认值；Paseo 快照标的默认 `anthropic/claude-fable-5` OAuth 过期，第一批 6 次全部空跑，原始记录在 `runs-v1-pi-auth-failed/`）。
- 原始记录：`runs-v1/`、`runs-v1-pi/`；汇总：`python3 analyze.py <dir>`。

## 结果

"先派发 = 否"指派发前有别的输出或工具调用，括号里是第一个。
| run | model | 期望 | create_agent | 照抄 | 先派发 | 发现类调用 | 原生子智能体 | 代批 | task 含文件 | task 长度 | 子智能体 | 后续轮询 | 秒 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| claude-cross-1 | claude-opus-5-5 | 2 | 2 | 2/2 | 是 | - | - | - | [True, True] | [458, 553] | 2 | 6 | 51 |
| claude-cross-2 | claude-opus-5-5 | 2 | 2 | 2/2 | 是 | - | - | - | [True, True] | [472, 574] | 2 | 4 | 46 |
| claude-same-1 | claude-opus-5-5 | 2 | 2 | 2/2 | 是 | - | - | - | [True, True] | [531, 475] | 2 | 4 | 50 |
| claude-same-2 | claude-opus-5-5 | 2 | 2 | 2/2 | 是 | - | - | - | [True, True] | [499, 463] | 2 | 2 | 40 |
| claude-single-1 | claude-opus-5-5 | 1 | 1 | 1/1 | 是 | - | - | - | [True] | [397] | 1 | 2 | 36 |
| claude-single-2 | claude-opus-5-5 | 1 | 1 | 1/1 | 是 | - | - | - | [True] | [307] | 1 | 2 | 34 |
| codex-cross-1 | gpt-6-astra | 2 | 2 | 2/2 | 否（assistant） | - | - | - | [True, True] | [369, 372] | 2 | 6 | 110 |
| codex-cross-2 | gpt-6-astra | 2 | 2 | 2/2 | 否（assistant） | - | - | - | [True, True] | [386, 427] | 2 | 8 | 257 |
| codex-same-1 | gpt-6-astra | 2 | 2 | 2/2 | 否（assistant） | - | - | - | [True, True] | [398, 406] | 2 | 6 | 77 |
| codex-same-2 | gpt-6-astra | 2 | 2 | 2/2 | 否（assistant） | - | - | - | [True, True] | [341, 359] | 2 | 6 | 83 |
| codex-single-1 | gpt-6-astra | 1 | 1 | 1/1 | 否（assistant） | - | - | - | [True] | [310] | 1 | 4 | 239 |
| codex-single-2 | gpt-6-astra | 1 | 1 | 1/1 | 否（assistant） | - | - | - | [True] | [347] | 1 | 4 | 193 |
| pi-cross-1 | openai-codex/gpt-6-astra | 2 | 2 | 2/2 | 否（read） | - | - | - | [True, True] | [289, 336] | 2 | 1 | 96 |
| pi-cross-2 | openai-codex/gpt-6-astra | 2 | 2 | 2/2 | 否（read） | - | - | - | [True, True] | [643, 709] | 2 | 1 | 96 |
| pi-same-1 | openai-codex/gpt-6-astra | 2 | 2 | 2/2 | 否（read） | - | - | - | [True, True] | [299, 336] | 2 | 0 | 94 |
| pi-same-2 | openai-codex/gpt-6-astra | 2 | 2 | 2/2 | 否（read） | - | - | - | [True, True] | [301, 326] | 2 | 1 | 128 |
| pi-single-1 | openai-codex/gpt-6-astra | 1 | 1 | 1/1 | 否（read） | - | - | - | [True] | [278] | 1 | 2 | 71 |
| pi-single-2 | openai-codex/gpt-6-astra | 1 | 1 | 1/1 | 否（mcp） | - | - | - | [True] | [260] | 1 | 2 | 111 |

子智能体实际生效的 provider、模型、模式、思考档位 18/18 与路由块一致。

## 观察

- 三家父 provider 都做到了：mention 一个调一次 `create_agent`，同 provider 两个 mention 就两个会话，按 mention 在正文中的位置分工；`provider`/`settings` 照抄；没有先调 `list_providers`/`list_models`/`inspect_provider`；没用原生子智能体；没有 `respond_to_permission`。
- `initialPrompt` 都自足：带仓库路径、目标文件、只读/可写约束、汇报格式，cross 场景还说明了另一个子智能体负责什么。
- Claude 永远先派发。Codex 派发前会说一句计划，6 次里有 3 次先 `cat` 了用户全局的 `codexhost-delegation` skill（`@` 触发了它的描述）。Pi 6 次都先读这个 skill，其中 5 次还跑了 `codex-connect delegate --help`，最后仍然走 `create_agent`。→ v2 把禁令扩到委派类 skill 和 CLI。
- Pi 经 pi-mcp-adapter 调工具，派发前固定多 4 次代理调用（search/server/connect/describe）。这是 adapter 的机制，提示改不掉。工具名在时间线上是 `paseo.create_agent`，入参被包成 `{tool: "paseo_create_agent", args}`，07 号票识别 Pi 的派发卡片时要拆这层。
- Claude 父智能体派发后会自己轮询 `get_agent_activity`/`get_agent_status`，尽管 `create_agent` 返回的 guidance 说"不要轮询"。与路由提示无关，属于现有通知机制的问题。
- 附带发现：Claude Code 首次连 Paseo MCP 时用 `2026-07-28` 协议版本，被服务端 SDK 拒绝（只支持到 `2025-11-25`）后回退成功。不影响派发，但每次都在日志里报 error。
