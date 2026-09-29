# 04 — 块在草稿、排队编辑、发送失败恢复、Rewind 中保留

**What to build:**
- 草稿输入新增可选的分段结构字段，`text` 仍存序列化文本；有分段结构时以它为准。不升版本号、不写迁移。"是否有内容"与活跃草稿判定计入块。
- 切换 tab、切换工作区、重启 App 后块仍是块，手打的文字仍是文字。
- 排队项保存分段结构，编辑排队项时按结构恢复到输入框。
- 发送失败按提交前的分段结构恢复。
- Rewind 把气泡文本解析成块写回输入框（仍只在输入框为空时写入），包括 Agent mention 链接。

- 输入框的块节点视图目前传 `serverId={null}`（`composer/input/inline-block-node.web.tsx`），Rewind 写回的 Agent mention 若指向 profile 或自定义 provider 会显示 Bot 图标；本工单要把 serverId 带进节点视图。

**实现说明（2026-09-29）：**
- chip 仍在（工单 05 删除），排队项与交接的分段结构把 chip 放成开头的 Skill block，各恢复路径拆回 chip。
- 审查中追加（已与用户确认）：新建工作区页交给草稿 tab 建 agent 失败时按分段结构写回；原生端排队行按文字解析的例外写进 PRD；Rewind 在输入框有 chip 时不写回。
- 顺带修复工单 03 遗留的粘贴竞态（全选后按方向键立刻粘贴会覆盖整段，03 的 e2e 基线 2/6 偶发失败），单独提交。
- serverId 经 context 进节点视图；测试环境图标被桩掉，没有测试能观察，只有类型检查覆盖。

**Blocked by:** 03 — File mention：@ 选文件 / 目录 / 图片生成块并发送
**Status:** ready-for-agent
**Impl:** done

- [x] draft-store 测试（测试层 C）：带分段结构的草稿写入再读出一致；只有块的草稿是活跃草稿；没有分段字段的旧草稿照常读出。
- [x] 切 tab 回来：选中产生的块仍是块，手打的 `[x](path)` 仍是文字。
- [x] 编辑排队项后输入框里是块。
- [x] 发送失败后正文与块原样恢复。（单测覆盖 `submitAgentInput`；无 e2e）
- [x] Rewind 后输入框里是块（含 File mention 与 Agent mention）。
- [x] Playwright e2e 覆盖切 tab、排队编辑、Rewind 三条路径。
- [x] `npm run typecheck`、`npm run lint` 通过。
