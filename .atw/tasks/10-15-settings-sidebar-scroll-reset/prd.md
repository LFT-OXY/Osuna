# 设置页左栏切换栏目后滚动位置丢失

## Goal

设置页左栏滚到底部后点任一栏目，左栏回到顶部。原因：每个栏目是独立路由（settings/[section]、settings/hosts/[serverId]/...），切换时 router.replace 换页，SettingsScreen 连同左栏 ScrollView 重新挂载。原来就有，不是第三方接口任务引入的；该任务给左栏加了「第三方接口」一项后更容易碰到。2026-10-15 工单 14 真实验收时用户发现。

## Requirements

- TBD

## Acceptance Criteria

- [ ] TBD

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, slice the work into `issues/NN-slug.md` tickets before `task.py start`.
