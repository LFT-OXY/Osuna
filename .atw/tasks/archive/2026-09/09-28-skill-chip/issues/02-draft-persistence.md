# 02 — Skill chip 随草稿持久化

**What to build:** 已选的 Skill chip 跟正文一起存进草稿：切 tab、切工作区、重启 App 后仍在；只有 chip 没有正文也算活跃草稿；发送失败时 chip 与正文一起恢复；排队消息与编辑重发仍是拼好的纯文本。chip 按现有草稿键隔离（Workspace-owned state）。见 PRD「草稿持久化」。

**Status:** ready-for-agent
**Impl:** done

**Blocked by:** 01

- [x] 草稿输入新增可选 `skills`（`{ name, description? }[]`），旧草稿读出为空；不升级版本号、不写迁移
- [x] 活跃判定计入 chip
- [x] 发送失败恢复 chip
- [x] 测试 A2：`stores/draft-store/persistence.test.ts`、`state.test.ts` 覆盖写入读回、旧草稿、只有 chip 为活跃
- [x] 实测切 tab 与重启后 chip 仍在；`typecheck`、`lint` 通过
