# 07 — 真实 Agent 验收（Claude Code、Codex、Pi）

**What to build:** 用真实的 Agent 把整条路走一遍：在 Claude Code、Codex、Pi 里各开一次"逻辑图"开关，聊一个小功能，确认图会自动出现和更新、回复里有增改删节点的说明、点节点能看到文档。这一张要用到真实账号和真实对话，不在本机自动测 CLI 登录，由用户来做；做之前先征得用户同意。见 PRD Testing Decisions 的"真机验收"。

**Blocked by:** 01, 02, 03, 04, 05, 06

**Status:** ready-for-human

**Impl:** done

- [ ] Claude Code：开开关聊一个小功能，图自动出现并随对话更新；回复里有改动说明；点节点能打开文档。
- [ ] Codex：同上。
- [ ] Pi：同上。
- [ ] 任一 provider 不按说明块行事时，记下现象并另开工单。

## Comments

2026-10-20 用户在 dev 桌面端完成三个 provider 的真机验收，记录见 `research/07-real-agent-acceptance-notes.md`。Claude Code、Codex、Pi 都能画图、标失败步骤、回复里说明增改删，界面（自动刷新、子图与面包屑、点节点开文档并蓝框）用户确认正常。发现两处问题，另开工单：Osuna 工具关着时逻辑图开关没有提示（08）；Codex、Pi 没给每个节点写文档（09）。修完后的复测是 10。
