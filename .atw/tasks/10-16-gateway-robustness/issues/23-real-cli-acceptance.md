# 23 — 用户验收：用真实的 CLI 试一遍

**What to build:** 有两件事，只读过源码确认，没有用真实的 CLI 端到端跑过。这张由用户自己用真实的 Claude Code 和 Codex，经过内置中转站来验收：

- 慢模型等待超过 5 分钟时，CLI 不断开；
- 上游中途断开时，CLI 显示的错误写明了接口名和原因。

助手不在本机运行真实的 CLI。助手负责准备验收步骤，必要时提供一个本机的假中转服务，让「很慢」和「中途断开」能够复现；用户自己运行真实的 CLI，判断结果。

**Blocked by:** 17, 20, 21
**Status:** ready-for-human
**Impl:** ready

- [ ] 真实的 Claude Code：慢模型等待超过 5 分钟，会话不断开，最后拿到回答。
- [ ] 真实的 Codex：同上。
- [ ] 上游中途断开时，Claude Code 和 Codex 显示的错误里都有接口名和原因。
- [ ] 结论（通过，或不通过以及看到的现象）记在本票的 Comments 里。

参考：prd.md「Acceptance Criteria」最后一项；research/decisions.md「两个 CLI 的行为」。
