# 07 — Composer

**What to build:** Composer 成为页面上最明显的操作入口：圆角 22、低透明度 1px 描边，亮色用 Composer 阴影、暗色用顶部内高光，Web / Electron 带毛玻璃；Composer toolbar 左侧 Agent controls 为 28 高幽灵按钮，右侧附件按钮、上下文占用、32 圆形停止与发送按钮（运行中两者同时出现，发送即排队）；上下文信息条附着在 Composer 底部。窄 pane 时左侧控件截断，发送与停止按钮不被压缩或遮挡。

**Blocked by:** 02 — Text、Row 组件与左侧栏；03 — 通用控件与浮层
**Status:** ready-for-agent
**Impl:** ready

- [ ] 分屏窄 pane 下发送与停止按钮完整可见、可点击
- [ ] 键盘快捷键、附件、语音等 Composer 现有行为不变
- [ ] 原生端为不透明表面，键盘弹出时布局不回退
- [ ] 该区域 Electron 桌面端亮色与暗色截图与原型观感一致，截图作为证据附在本票 Comments
- [ ] 该区域中断言 CSS 值或几何尺寸的 e2e 已随设计更新，且在 CI 上通过
- [ ] testID 与英文 UI 文案逐字未变
- [ ] docs/design.md 等设计文档中对应章节已改写（改写过时内容，不在末尾追加）
- [ ] typecheck 与 lint 通过
