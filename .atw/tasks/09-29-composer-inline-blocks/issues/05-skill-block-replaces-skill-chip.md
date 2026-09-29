# 05 — Skill block 取代 Skill chip

**What to build:**
- 在 Command menu 选中 skill：从正文移除当前 `/query`（连同紧随的一个空格），Skill block 追加到开头块串末尾（同名去重），光标回到原 `/query` 所在位置。显示原始名与立方体图标；Web 悬停显示全名与描述。
- Skill block 固定在开头：光标不能放到开头 Skill block 之前。
- 选中命令（非 skill）、客户端内置命令、插件命令照旧插入文字。有 Skill block 时不识别客户端命令与插件客户端命令；只有块也可发送。
- 删除 Attachment tray 中的 Skill chip 渲染与 Skill chip 纯逻辑模块，Attachment tray 只放粘贴 / 拖拽的附件。
- 旧草稿的 `skills` 字段读取时转成开头的 Skill block，标 `COMPAT(skill-chip-draft)`；新写入不再写 `skills`。
- 原生端选中 skill 在正文开头插入 `/name `（开头已有同名时不重复）。
- 更新 `docs/glossary.md` 中 **Attachment tray**、**Skill block** 的代码引用。

**实现说明（2026-09-29）：**
- 输入框里每个开头 Skill block 后跟一个空格，输入框文字即发出的 `/a /b 正文`；发送一律从分段结构序列化。
- 光标限制扩到整串开头块：空选区落在最后一个开头 Skill block 之前都移到它后面（审查追加）。
- 输入框内部粘贴的 Skill block 移到开头块串末尾（审查追加）。
- 原生端 `/name ` 追加在开头已知 skill 之后，与 Web 选中顺序一致；skill 名随选中从 Command menu 带下（审查追加，两轮审查意见合并后的做法）。
- 旧草稿 `skills` 走草稿存储既有 legacy 迁移，`docs/data-model.md` 补了退役字段的做法，并补上漏写的 `segments`。
- 原生端只有单测，没有实机验证；01、03 遗留的原生端验收同样未做，需要设备。

**Blocked by:** 04 — 块在草稿、排队编辑、发送失败恢复、Rewind 中保留
**Status:** ready-for-agent
**Impl:** doing

- [x] 编解码单元测试（测试层 B 的选中部分）：开头与中间 `/query` 选中 skill 后被移除、光标位置正确、同名去重、顺序保持、选中命令不产生块、有 Skill block 时不识别客户端命令。
- [x] draft-store 测试：旧 `skills` 字段读出为开头的 Skill block。
- [x] 正文中间选 skill，块出现在开头；agent 收到 `/a /b 正文`。
- [x] 光标无法移到开头 Skill block 之前；光标紧跟 Skill block 后退格整块删除。
- [x] 手打的 `/skill` 在输入框里保持文字，切 tab 回来仍是文字；发出后气泡按已知 skill 显示为块。
- [x] Attachment tray 不再出现 Skill chip；仓库里不再有 Skill chip 代码与文案（无障碍文案按五种块保留）。（只剩 `COMPAT(skill-chip-draft)` 读旧草稿的迁移代码）
- [ ] 原生端选 skill 插入开头 `/name `。（`pickSkillText` 单测覆盖；未实机）
- [ ] 补 01、03 未做的原生端验收：原生端气泡渲染块无崩溃（截图）；原生端选文件插入链接文字，发出后气泡显示块。
- [x] Playwright e2e（mock agent）覆盖选 skill → 块在开头 → 发送文本断言 → 气泡显示块。
- [x] `npm run typecheck`、`npm run lint` 通过。
