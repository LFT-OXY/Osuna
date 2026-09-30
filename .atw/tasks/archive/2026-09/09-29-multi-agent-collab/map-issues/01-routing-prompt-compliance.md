# 01 — 路由提示的写法与各父 provider 的遵从度实测

**Type:** prototype
**Blocked by:** None
**Status:** resolved

## Question

写一版路由提示（末尾 `<paseo-system>` 块：按出现顺序列出每个 mention 的 provider/model、模式、思考档位；要求每个 mention 调一次 `create_agent`、task 自带全部上下文、不得改用自己的子智能体、不得改动已给的模型/模式/档位、不得用 `respond_to_permission` 代批），在 dev daemon 上手工把它附到用户消息末尾，分别让 Claude Code、Codex、OpenCode、Pi（装了 pi-mcp-adapter 时）当父智能体各跑几次典型分工消息（单 mention、同 provider 两个 mention、跨 provider）。记录：是否每个 mention 恰好一次 `create_agent`、`provider`/`settings` 是否照抄、task 是否自足、是否改用原生子智能体、是否先调 `list_providers`/`list_models` 浪费轮次。结论决定提示文本定稿，以及某个父 provider 在 v1 是否要置灰。实测脚本与原始记录放 `prototype/`，用户看结果拍板。

## Answer

2026-09-30，用户拍板：**路由提示以 `prototype/routing-prompt-v2.md` 定稿；v1 不置灰任何父 provider**（能否派发仍按 04 号票的三层判定）。

- 实测：Claude Code（opus-5-5）、Codex（gpt-6-astra）、Pi（openai-codex/gpt-6-astra，经 pi-mcp-adapter）各跑 single / same / cross 三场景 × 2 次，共 18 次。每个 mention 恰好一次 `create_agent`，同 provider 两个 mention 就两个会话，按 mention 位置分工；`provider`/`settings` 18/18 照抄，子智能体实际生效的模型、模式、档位全对；没有先调 `list_*`/`inspect_provider`，没用原生子智能体，没有代批；`initialPrompt` 都自足。
- v2 相对 v1 只改一条：禁令扩到"子智能体、任务、委派类工具、skill 或 CLI"。原因：`@` 会触发用户全局的委派 skill（`codexhost-delegation`），Codex 3/6、Pi 6/6 派发前先去读它，Pi 还跑 `codex-connect`。最终都走了 `create_agent`，所以 v2 不再复测。
- 给 07 号票：Pi 的派发在时间线上是 `paseo.create_agent`，入参包成 `{tool: "paseo_create_agent", args}`，识别时要拆这层；Pi 派发前固定多 4 次 adapter 代理调用。
- 附带发现（不在本 map 范围）：Paseo 快照给 Pi 标的默认模型（`anthropic/claude-fable-5`）和 Pi 自己的设置默认值（`openai-codex/gpt-6-astra`）不一致；Claude Code 首连 Paseo MCP 用 `2026-07-28` 协议版本被拒后回退，每次在日志报 error。

资产：结果 `prototype/results.md`；提示 `prototype/routing-prompt-v1.md`、`routing-prompt-v2.md`；原始记录 `prototype/runs-v1/`、`runs-v1-pi/`；脚本与记录的可运行快照在一次性分支 `research/routing-prompt-compliance`（`packages/server/src/server/prototype-routing-prompt-compliance.ts`）。
