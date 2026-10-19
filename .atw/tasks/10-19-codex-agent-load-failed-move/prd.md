# 续不上的 Codex Agent 在加载失败页给出说明和挪动按钮

来源：任务 `archive/2026-10/10-16-cli-wiring-web-search` 的 14 号工单。用户 2026-10-18 选「另开工单以后做」，2026-10-19 整体验收时再次确认（见那个任务的 `research/implementation-notes.md` 14 节、14 号工单 Comments）。规则、文案与对话框都沿用那个任务定下的，这里只补一条没接上的路径。

## Problem Statement

一段 Codex 对话记在某个 Codex 服务商名下，这个服务商后来从 Codex 设置里没了（例如被别的工具删掉），对话就续不上（``Model provider `…` not found``）。10-16 任务已经在三处给出说明和「挪动对话…」按钮：会话历史的「导入为 Osuna Agent」、已归档 Agent 的「取消归档」、CLI 的续对话。

还有一处没接：daemon 重启后，打开一个**没归档**的这种 Codex Agent，Agent 页只显示「Failed to load agent」，不说原因，也没有挪动按钮。用户不知道怎么修。

## Solution

这时 Agent 页显示和别处一样的说明（用界面语言，不靠匹配英文原文），并给出「挪动对话…」按钮，打开同一个挪动对话框；挪好后重试，Agent 能正常打开。其他原因的加载失败照旧。

## Implementation Decisions

1. 原因用错误码传：daemon 在这条路径上也用 10-16 任务的 `codex_model_provider_missing` 码（`server/agent-resume-errors.ts` 的 `toAgentResumeWireError` 一类做法），app 只看码。已知难点：错误要穿过时间线同步的几层状态（`fetch_agent_timeline_request` 到 Agent 页的「Failed to load agent」，见 `packages/app/src/panels/agent-panel.tsx`、`packages/app/src/navigation/agent-route-resolution-view.tsx`）。
2. 协议遵守 `docs/protocol-compatibility.md`：新字段可选；旧客户端照旧看到「Failed to load agent」。
3. 说明、按钮、对话框沿用 10-16 任务的文案与 `MoveCodexConversationSheet`；daemon 只给码、不给服务商 id 时，用不点名服务商的说明（同「取消归档」那处）。

## Acceptance Criteria

- [ ] daemon 重启后打开未归档、服务商不在的 Codex Agent，Agent 页显示原因说明与「挪动对话…」按钮；挪到夹具里存在的服务商后重试，Agent 正常打开。
- [ ] 其他原因的加载失败仍显示原来的「Failed to load agent」。
- [ ] 旧客户端兼容：新协议字段可选。
- [ ] 新文案（如有）9 种语言齐全；`npm run typecheck`、`npm run lint` 通过；改到的测试文件本机通过。

## Out of Scope

- 挪动规则、备份、对话框本身（10-16 任务已做）。
- 终端里 `codex resume` 的报错（错误在终端里，Osuna 接不到）。
