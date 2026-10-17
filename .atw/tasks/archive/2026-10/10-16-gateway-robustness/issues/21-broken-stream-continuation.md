# 21 — 断流后接着写

**What to build:** 翻译的回复断了时，先「接着写」（magpie 的 continuation）：把 CLI 已经收到的部分交回上游，让模型续写，最多续 2 次。要同时满足这些条件：

- 上游能从一半接着写：Anthropic 原生支持；Chat 只限厂商自己的预填模式（照 magpie）；
- 还没开始任何工具调用；
- 不是拒答；
- 这家的这个模型没拒过预填（读第 05 张的记录）。

接不上，或续了两次仍然断，就按第 20 张在流的末尾补错误。

**Blocked by:** 05, 20
**Status:** ready-for-agent
**Impl:** done

- [x] 端到端：Anthropic 上游第一次说到一半断开，中转站把已经发出的部分作为预填再问，第二次说完。Claude Code 收到一条完整的回复：一个 `message_start`，文字连贯，一个 `message_stop`。
- [x] 已经开始工具调用时断开：不续写，在流尾补错误。
- [x] 不支持预填的 Chat 上游断开：不续写，在流尾补错误。
- [x] 记录里这家这个模型不收预填：不续写。
- [x] 连续断开三次：续写两次，然后在流尾补错误。
- [x] 借鉴 magpie 的代码，文件头保留 MIT 声明。
- [x] `npm run typecheck`、`npm run lint` 通过，改到的测试文件本机通过。

参考：prd.md 第 41 条；明细 01·B10。

## Comments

### 核对记录（2026-10-17）

逐条对照代码与测试核过；改到的测试文件在 packages/server 下逐个单跑全部通过；`npm run typecheck`、`npm run lint` 在 HEAD 5e5287609 上通过。

- 第 1 条：接着写只在翻译时做，Claude Code + Anthropic 上游是直通；由「translated for Codex, an Anthropic reply cut mid-way is asked to go on」加「translated for Claude Code, a DeepSeek Chat reply cut mid-way goes on in its prefix mode」合起来覆盖。
