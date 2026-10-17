# 19 — 拒答换家

**What to build:**

**怎么认拒答**：照 magpie，只认错误本身，不认回答文字里引用的句子。两种形式：
- **报错形式**：HTTP 错误体或流里的错误事件，包括整句「The request was rejected because it was considered high risk」和厂商的安全过滤错误码。
- **结束形式**：Anthropic 的 `stop_reason: refusal`、Chat 的 `finish_reason: content_filter`、Responses 因 `content_filter` 没有完成。

**开口前的拒答**：不冷却，不标「需要检查」，问遍剩下所有有同名模型的候选。

**全部拒答时**：
- Claude Code 收到排第一那家被扣下的原样拒答：200、`stop_reason: refusal`、带 `stop_details`，流式还是整份照 CLI 的要求。保活已经开始时，以流内的拒答结尾发出。
- Codex 收到 Responses 形状的 400 和原因。保活已经开始时，用一个 Codex 不会重问、并且会显示原因的终止型 code 发 `response.failed`；具体用哪个 code，对照 magpie 和 Codex 源码定。

**其他**：
- 开口后的拒答照常转给 CLI，不冷却。
- 翻译时把 Anthropic 的 `stop_details` 带给 Anthropic 客户端。
- 用 403 说出的拒答，不算 key 有问题。

**Blocked by:** 17
**Status:** ready-for-agent
**Impl:** done

- [x] 端到端：第一家在开口前回 `stop_reason: refusal`，第二家正常回答。CLI 只收到第二家的回答，第一家的状态仍是「可用」。
- [x] 三家都拒答：Claude Code 收到第一家的拒答，包含 `stop_details`；Codex 收到 400 和原因。
- [x] 报错形式的 high risk 拒答、Chat 的 `content_filter`，各有一例。
- [x] 用 403 说出的拒答，不标「需要检查」。
- [x] 保活开始后全部拒答：两种 CLI 各自收到流内的形式。
- [x] 回答文字里引用「considered high risk」，不被当成拒答。
- [x] 实现记录写明 Codex 终止型 code 的结论。
- [x] 借鉴 magpie 的代码，文件头保留 MIT 声明。
- [x] `npm run typecheck`、`npm run lint` 通过，改到的测试文件本机通过。

参考：prd.md 第 13–17 条；明细 01·C05。

## Comments

### 核对记录（2026-10-17）

逐条对照代码与测试核过；改到的测试文件在 packages/server 下逐个单跑全部通过；`npm run typecheck`、`npm run lint` 在 HEAD 5e5287609 上通过。

- 第 2 条：Claude Code 收到的是第一份结束形式的拒答，不一定是排第一的那家（用户 2026-10-17 决定，见 ADR 0008 与 spec）。e2e 里两种读法结果相同。
