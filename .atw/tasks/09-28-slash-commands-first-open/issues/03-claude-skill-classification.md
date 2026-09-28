# 03 — Claude 精确区分 skill 与命令

**What to build:** Claude 的指令列表里，只有 SDK init `skills` 名单里的条目标为 skill，其余（含 `.claude/commands` 自定义命令）标为命令；终端专用命令（`terminal_slash_commands`）从列表中隐藏。Claude 进程初始化完成后取一次完整列表写入指令目录缓存，会话中收到 `commands_changed` 时覆盖缓存，下次打开菜单即可见。见 PRD「provider 侧接口」中 Claude 一行与 `kind` 规则。

**Status:** ready-for-agent
**Impl:** done

**Blocked by:** 01

- [x] 进程初始化完成时上报完整列表并写缓存；`commands_changed` 覆盖缓存
- [x] 有上报列表时按 init `skills` 判定 `kind`；只有扫描结果时按所在目录（`skills` → skill，`commands` → command）判定
- [x] 删除按 root-only 名单猜 `kind` 的旧逻辑
- [x] 隐藏 init `terminal_slash_commands` 中的命令，所有端一致
- [x] 测试：`claude/agent.test.ts` 用假的 init 与 `commands_changed` 消息断言 `kind`、隐藏与缓存覆盖
- [x] PR 说明写明行为变化：自定义命令从"技能"移到"命令"，行中间 `/` 不再列出它们
- [x] `typecheck`、`lint` 通过

**实现记录（2026-09-28）：** 上报通道是新的 `commands_changed` stream 事件，AgentManager 收到后写指令目录。本仓库直接提交到 main，行为变化写在提交说明里。真实 CLI 契约测试（`agent-commands.real.e2e.test.ts`）改为跑一个 turn 后断言；本机无 OpenRouter key 被跳过，交给 CI。已知限制见 PRD「provider 侧接口」Claude 条目。
