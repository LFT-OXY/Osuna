# 07 — 冷却状态重启后保留

**What to build:** 某家接口（的某个模型）冷却中时重启 Osuna，重启后它接着冷却、到点自动恢复，接口行照常显示「冷却中」和恢复时间；「立刻恢复」后重启不再冷却。

**Blocked by:** None — can start immediately
**Status:** ready-for-agent
**Impl:** done

- [ ] 冷却状态（接口、模型、冷却到何时、原因分类）原子写盘，启动时读回，过期的丢掉；文件坏了当作没有冷却；失败计数仍只在内存。
- [ ] 端到端测试：冷却 → 重启 → 仍跳过这家；到点恢复；「立刻恢复」→ 重启 → 不冷却；坏文件 → 正常启动。
- [ ] 文档：`docs/data-model.md` 冷却状态文件；`docs/glossary.md` **Endpoint status** 去掉「重启清零」。
- [ ] 界面不变（接口行、详情头的冷却显示照旧）。

参考：prd 第 13 条，用户故事 46；ADR 0014「Also changed in ADR 0007」。

实现时凡本工单没写明的细节，先查 magpie `7597c132` 的做法并照做（出处见 `research/decisions.md`）；比 magpie 少做或更严一律不行，除非 prd 写明。
