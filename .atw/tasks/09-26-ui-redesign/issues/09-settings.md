# 09 — 设置页

**What to build:** 设置页按分组卡片呈现：卡片圆角 14，行最小高 56，左边标题与说明、右边控件；开关、分段控件、下拉、按钮尺寸统一；provider 行显示图标、版本、就绪状态与操作按钮。list + detail 的设置外壳结构不变。

**Blocked by:** 02 — Text、Row 组件与左侧栏；03 — 通用控件与浮层
**Status:** ready-for-agent
**Impl:** ready

- [ ] 所有设置子页（通用、Providers、Hosts、快捷键、终端、插件、关于等）都迁移到新卡片与行
- [ ] 危险操作仍需确认对话框，红色只出现在对话框里
- [ ] 移动端设置页同样应用新 token，无布局回退
- [ ] 该区域 Electron 桌面端亮色与暗色截图与原型观感一致，截图作为证据附在本票 Comments
- [ ] 该区域中断言 CSS 值或几何尺寸的 e2e 已随设计更新，且在 CI 上通过
- [ ] testID 与英文 UI 文案逐字未变
- [ ] docs/design.md 等设计文档中对应章节已改写（改写过时内容，不在末尾追加）
- [ ] typecheck 与 lint 通过
