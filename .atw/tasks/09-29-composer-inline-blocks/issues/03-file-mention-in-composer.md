# 03 — File mention：@ 选文件 / 目录 / 图片生成块并发送

**What to build:**
- 编辑器支持行内块节点（inline、atom、不可编辑），覆盖三种块；Agent mention 节点用 provider 图标，本工单不提供其插入入口。
- 在 `@` 列表选中文件、目录、图片：当前 `@query` 替换为 File mention 加一个空格，显示 basename 与对应图标；Web 悬停显示相对路径（按 `docs/hover.md`，紧凑宽度不出提示）。
- 块是原子的：方向键整块跳过，光标紧跟块后退格整块删除，选区覆盖半块时整块处理。
- 粘贴外部文字一律按纯文字插入；输入框内部复制粘贴保留块；复制到外部时剪贴板是序列化文本。
- 发送时按序列化规则拼成文本；只有块也可发送；气泡显示为块（依赖 01）。
- 原生端选中文件插入序列化链接文字加空格。

**Blocked by:** 01 — 气泡与 Queue track 从文本渲染块；02 — Web/Electron 输入框换成 Tiptap（纯文字，行为不变）
**Status:** ready-for-agent
**Impl:** doing

- [x] 选文件 / 目录 / 图片后输入框出现对应图标 + basename 的块，外观与参考图一致（无底色、accent 文字、名字过长截断、颜色随主题 accent）。
- [x] 方向键、退格、选区删除对块整块处理。
- [x] 手打 `@path`、`[x](path)` 与粘贴的外部文字保持文字；输入框内部复制粘贴保留块。
- [x] agent 收到的文本等于序列化写法；气泡显示块。
- [ ] 原生端插入链接文字，发出后气泡显示块。——代码路径已写（`MessageInput.insertInlineBlock` 退回 `insertInlineBlockText`，有单测），本机没有 iOS 模拟器与原生工程，未实机验证。
- [x] Playwright e2e（mock agent）：选文件与目录 → 块 → 退格整块删除 → 发送文本断言 → 气泡显示块。
- [x] Electron 浅色、深色截图各一张（含文件、目录、图片块）。
- [x] `npm run typecheck`、`npm run lint` 通过。
