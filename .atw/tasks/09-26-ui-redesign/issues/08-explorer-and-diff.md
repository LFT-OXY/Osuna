# 08 — Explorer sidebar 与 diff

**What to build:** Explorer sidebar 与工作区视觉统一：Files / Changes / Session history 的 tab 使用与工作区 tab 同一套样式；改动文件行（28 高，状态字母、目录淡化的路径、±统计）用 Row，选中行有底色；diff 新增 / 删除行为浅绿 / 浅红底色加 3px 左侧色条，大段未改动内容折叠为"N unmodified lines"分隔，文件头吸顶。

**Blocked by:** 02 — Text、Row 组件与左侧栏；04 — 工作区外框
**Status:** ready-for-agent
**Impl:** ready

- [ ] diff 统一视图与分栏视图都应用新样式
- [ ] 紧凑布局的 Explorer 覆盖层同样应用新样式，无布局回退
- [ ] diff 行底色与状态色 token 一致
- [ ] 该区域 Electron 桌面端亮色与暗色截图与原型观感一致，截图作为证据附在本票 Comments
- [ ] 该区域中断言 CSS 值或几何尺寸的 e2e 已随设计更新，且在 CI 上通过
- [ ] testID 与英文 UI 文案逐字未变
- [ ] docs/design.md 等设计文档中对应章节已改写（改写过时内容，不在末尾追加）
- [ ] typecheck 与 lint 通过
