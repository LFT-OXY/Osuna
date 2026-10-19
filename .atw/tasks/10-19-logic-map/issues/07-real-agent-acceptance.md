# 07 — 真实 Agent 验收（Claude Code、Codex、Pi）

**What to build:** 用真实的 Agent 把整条路走一遍：在 Claude Code、Codex、Pi 里各开一次"逻辑图"开关，聊一个小功能，确认图会自动出现和更新、回复里有增改删节点的说明、点节点能看到文档。这一张要用到真实账号和真实对话，不在本机自动测 CLI 登录，由用户来做；做之前先征得用户同意。见 PRD Testing Decisions 的"真机验收"。

**Blocked by:** 01, 02, 03, 04, 05, 06

**Status:** ready-for-human

**Impl:** ready

- [ ] Claude Code：开开关聊一个小功能，图自动出现并随对话更新；回复里有改动说明；点节点能打开文档。
- [ ] Codex：同上。
- [ ] Pi：同上。
- [ ] 任一 provider 不按说明块行事时，记下现象并另开工单。
