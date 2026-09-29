# 05 — Skill block 取代 Skill chip

**What to build:**
- 在 Command menu 选中 skill：从正文移除当前 `/query`（连同紧随的一个空格），Skill block 追加到开头块串末尾（同名去重），光标回到原 `/query` 所在位置。显示原始名与立方体图标；Web 悬停显示全名与描述。
- Skill block 固定在开头：光标不能放到开头 Skill block 之前。
- 选中命令（非 skill）、客户端内置命令、插件命令照旧插入文字。有 Skill block 时不识别客户端命令与插件客户端命令；只有块也可发送。
- 删除 Attachment tray 中的 Skill chip 渲染与 Skill chip 纯逻辑模块，Attachment tray 只放粘贴 / 拖拽的附件。
- 旧草稿的 `skills` 字段读取时转成开头的 Skill block，标 `COMPAT(skill-chip-draft)`；新写入不再写 `skills`。
- 原生端选中 skill 在正文开头插入 `/name `（开头已有同名时不重复）。
- 更新 `docs/glossary.md` 中 **Attachment tray**、**Skill block** 的代码引用。

**Blocked by:** 04 — 块在草稿、排队编辑、发送失败恢复、Rewind 中保留
**Status:** ready-for-agent
**Impl:** ready

- [ ] 编解码单元测试（测试层 B 的选中部分）：开头与中间 `/query` 选中 skill 后被移除、光标位置正确、同名去重、顺序保持、选中命令不产生块、有 Skill block 时不识别客户端命令。
- [ ] draft-store 测试：旧 `skills` 字段读出为开头的 Skill block。
- [ ] 正文中间选 skill，块出现在开头；agent 收到 `/a /b 正文`。
- [ ] 光标无法移到开头 Skill block 之前；光标紧跟 Skill block 后退格整块删除。
- [ ] 手打的 `/skill` 在输入框里保持文字，切 tab 回来仍是文字；发出后气泡按已知 skill 显示为块。
- [ ] Attachment tray 不再出现 Skill chip；仓库里不再有 Skill chip 代码与文案（无障碍文案按五种块保留）。
- [ ] 原生端选 skill 插入开头 `/name `。
- [ ] Playwright e2e（mock agent）覆盖选 skill → 块在开头 → 发送文本断言 → 气泡显示块。
- [ ] `npm run typecheck`、`npm run lint` 通过。
