# 04 — 块在草稿、排队编辑、发送失败恢复、Rewind 中保留

**What to build:**
- 草稿输入新增可选的分段结构字段，`text` 仍存序列化文本；有分段结构时以它为准。不升版本号、不写迁移。"是否有内容"与活跃草稿判定计入块。
- 切换 tab、切换工作区、重启 App 后块仍是块，手打的文字仍是文字。
- 排队项保存分段结构，编辑排队项时按结构恢复到输入框。
- 发送失败按提交前的分段结构恢复。
- Rewind 把气泡文本解析成块写回输入框（仍只在输入框为空时写入），包括 Agent mention 链接。

**Blocked by:** 03 — File mention：@ 选文件 / 目录 / 图片生成块并发送
**Status:** ready-for-agent
**Impl:** ready

- [ ] draft-store 测试（测试层 C）：带分段结构的草稿写入再读出一致；只有块的草稿是活跃草稿；没有分段字段的旧草稿照常读出。
- [ ] 切 tab 回来：选中产生的块仍是块，手打的 `[x](path)` 仍是文字。
- [ ] 编辑排队项后输入框里是块。
- [ ] 发送失败后正文与块原样恢复。
- [ ] Rewind 后输入框里是块（含 File mention 与 Agent mention）。
- [ ] Playwright e2e 覆盖切 tab、排队编辑、Rewind 三条路径。
- [ ] `npm run typecheck`、`npm run lint` 通过。
