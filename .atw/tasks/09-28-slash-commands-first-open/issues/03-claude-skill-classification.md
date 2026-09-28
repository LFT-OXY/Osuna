# 03 — Claude 精确区分 skill 与命令

**What to build:** Claude 的指令列表里，只有 SDK init `skills` 名单里的条目标为 skill，其余（含 `.claude/commands` 自定义命令）标为命令；终端专用命令（`terminal_slash_commands`）从列表中隐藏。Claude 进程初始化完成后取一次完整列表写入指令目录缓存，会话中收到 `commands_changed` 时覆盖缓存，下次打开菜单即可见。见 PRD「provider 侧接口」中 Claude 一行与 `kind` 规则。

**Status:** ready-for-agent
**Impl:** ready

**Blocked by:** 01

- [ ] 进程初始化完成时上报完整列表并写缓存；`commands_changed` 覆盖缓存
- [ ] 有上报列表时按 init `skills` 判定 `kind`；只有扫描结果时按所在目录（`skills` → skill，`commands` → command）判定
- [ ] 删除按 root-only 名单猜 `kind` 的旧逻辑
- [ ] 隐藏 init `terminal_slash_commands` 中的命令，所有端一致
- [ ] 测试：`claude/agent.test.ts` 用假的 init 与 `commands_changed` 消息断言 `kind`、隐藏与缓存覆盖
- [ ] PR 说明写明行为变化：自定义命令从"技能"移到"命令"，行中间 `/` 不再列出它们
- [ ] `typecheck`、`lint` 通过
