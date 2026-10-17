# 31 — 用户验收：用真实的 CLI 试一遍

**What to build:** 自动化测试全部用假上游和假登录。这张由用户用自己的真实账号与接口，经过内置中转站做最终验收。助手不在本机运行真的 Claude Code、Codex，只负责准备验收步骤。

**Blocked by:** 29, 30
**Status:** ready-for-human
**Impl:** ready

- [ ] 真实的 Claude Code：在打开「自己能联网搜索」的接口上，WebSearch 搜得到带链接的结果；同一模型没有这样的接口时，Claude Code 收到「不能联网搜索」的说明。
- [ ] 真实的 Codex（ChatGPT 登录）：开关前后开的对话在 `codex resume` 列表里是同一组；`/model` 里 ChatGPT 自带模型与接口模型都在，两种都能回复。
- [ ] 保留 claude.ai 登录打开时，Claude Code 的语音与 `/usage` 套餐额度可用。
- [ ] 结论（通过，或不通过以及看到的现象）记在本票的 Comments 里。

参考：prd.md「Acceptance Criteria」最后一项。
