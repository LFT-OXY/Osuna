# 06 — Antigravity 封号风险提示

**What to build:** 用户打开 Antigravity 提供方页，最上方（标题下第一块）看到黄色常驻的封号风险提示（**Ban risk notice**），标题「Antigravity 账号可能被封禁」，正文引用 Google 常见问题，附「Antigravity 常见问题 ↗」链接；没有关闭按钮，`agy` 装没装都显示；启用 Antigravity、新建 Agent 选提供方时不另外弹窗。提示做成可复用组件（标题、正文、条款链接），子任务 9 直接用。

**Blocked by:** None — can start immediately
**Status:** ready-for-agent
**Impl:** ready

- [ ] 可复用的封号风险提示组件：输入标题、正文、条款链接（文字与地址）；警示色常驻块，不要求用户做选择。
- [ ] 提示内容由 app 按提供方 ID 决定，只给 `antigravity` 配一条；不加插件清单字段或协议字段；连旧 daemon 也显示。
- [ ] 文字照规格「封号风险提示」一节原文；英文标题「{name} account may be suspended」；其余语言照意思翻译，中文是真翻译；「不支持」与「违反条款」分两句，不说成 Osuna 的用法就是违规。
- [ ] 链接指向 `https://antigravity.google/docs/faq/`，按项目现有外链方式打开。
- [ ] 测试：app 浏览器测试（Antigravity 页提示在 1280 与 390 下都在最上方、文字与链接正确；别的提供方页没有）。
- [ ] 文档：`docs/glossary.md` 的 **Ban risk notice** 按最终文字核对并补 Code 指向。
- [ ] UI: Antigravity 提供方页 / `agy` 已装与未装 / 1280 与 390 — 最上方是黄色提示块，标题、正文、「Antigravity 常见问题 ↗」都在；390 下完整显示，在其余内容之前。
