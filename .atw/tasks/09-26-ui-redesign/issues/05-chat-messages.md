# 05 — 对话流：消息与正文

**What to build:** 对话流中的消息正文换成新风格：用户消息右对齐、最大宽度 80%、圆角 18、使用 message surface；agent 回复无背景，文字为主前景色约 86%，markdown 排版（段落、列表、行内代码、标题）改用新 Text 阶梯；代码块带语言标签与复制按钮，暗色下无边框。消息的时间戳与复制、编辑等操作在 hover 时出现，原生端常显。

**Blocked by:** 02 — Text、Row 组件与左侧栏
**Status:** ready-for-agent
**Impl:** ready

- [ ] markdown 样式单测随新设计更新并通过
- [ ] 长回复与长代码块滚动和选中复制行为不变
- [ ] 移动端对话流同样应用新 token，无布局回退
- [ ] 该区域 Electron 桌面端亮色与暗色截图与原型观感一致，截图作为证据附在本票 Comments
- [ ] 该区域中断言 CSS 值或几何尺寸的 e2e 已随设计更新，且在 CI 上通过
- [ ] testID 与英文 UI 文案逐字未变
- [ ] docs/design.md 等设计文档中对应章节已改写（改写过时内容，不在末尾追加）
- [ ] typecheck 与 lint 通过
