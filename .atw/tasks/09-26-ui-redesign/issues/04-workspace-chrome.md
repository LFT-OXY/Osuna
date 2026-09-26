# 04 — 工作区外框

**What to build:** 工作区头部（面包屑、分支切换、操作按钮）更紧凑；tab 条中 tab 高约 26、圆角 8，当前 tab 有底色，关闭按钮在 hover 或选中时出现，未聚焦 pane 的当前 tab 用更弱底色；pane 头与内容之间只有一条底边线、无阴影。多 tab 与分屏保留，行为不变。

**Blocked by:** 02 — Text、Row 组件与左侧栏
**Status:** ready-for-agent
**Impl:** ready

- [ ] 分屏时能分辨哪个 pane 获得焦点
- [ ] tab 很多时不换行、不遮挡新建按钮
- [ ] 关闭按钮在原生端与紧凑布局下的可达性不低于现状
- [ ] 该区域 Electron 桌面端亮色与暗色截图与原型观感一致，截图作为证据附在本票 Comments
- [ ] 该区域中断言 CSS 值或几何尺寸的 e2e 已随设计更新，且在 CI 上通过
- [ ] testID 与英文 UI 文案逐字未变
- [ ] docs/design.md 等设计文档中对应章节已改写（改写过时内容，不在末尾追加）
- [ ] typecheck 与 lint 通过
