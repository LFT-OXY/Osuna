# 10 — 修完后用 Codex、Pi 复测

**What to build:** 08、09 合入后，在 dev 桌面端用真实的 Codex 和 Pi 各再走一遍：先在设置里关掉"启用 Osuna 工具"看开关旁的提示，再打开，新开对话打开逻辑图开关、聊一个小功能，确认每个节点都有文档、缺文档时 Agent 会按工具的提醒补上。这一张要用真实账号和真实对话，由用户来做；做之前先征得用户同意。结果追加到 `research/07-real-agent-acceptance-notes.md`。

**Blocked by:** 08, 09

**Status:** ready-for-human

**Impl:** done

- [x] 关掉 Osuna 工具时，逻辑图开关旁显示提示；打开后提示消失。
- [x] Codex：没有 spec 框架的项目里，聊完后每个节点都有文档（或 Agent 按提醒补齐）。
- [x] Pi：同上。
- [x] 仍有 provider 不按说明行事时，记下现象并另开工单。
