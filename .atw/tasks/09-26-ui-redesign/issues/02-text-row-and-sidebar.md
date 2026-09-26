# 02 — Text、Row 组件与左侧栏

**What to build:** 左侧栏按原型 V1 呈现新风格，并由两个新基础组件驱动。Text：用途命名的字号阶梯（micro 11、caption 12、label 13、body 14、body-lg 15、title-sm 16、title 18、title-lg 20、display 24，外加一个行高更松的长文正文变体），每档自带行高，按外观设置的基础字号换算，颜色只接受文字三级 token 与语义色。Row：前置槽 / 内容区（标题 + 可选元信息行）/ 后置槽，hover、选中、按下三态取自新行 token，选中态在 hover 时仍可辨，遵循项目唯一的 hover 模式，后置悬停操作按 isHovered || isNative || isCompact 显示。左侧栏工作区行结构、数据来源、项目 / 状态两种分组、显示偏好都不变；选中态为细描边加浅底色；需要处理（attention）的工作区标题加粗；状态槽使用统一状态图标（运行中为低频旋转环，减少动态时静止）；Sidebar items 与底部工具栏换成新样式。

**Blocked by:** 01 — token 与主题
**Status:** ready-for-agent
**Impl:** ready

- [ ] Text 与 Row 有 browser 测试，覆盖每一档字号与三种状态的计算样式
- [ ] 调整外观设置里的基础字号后，左侧栏文字按比例缩放
- [ ] kebab 在 hover 时出现且不挤占 ±diff，在原生端与紧凑布局下常显
- [ ] 开启减少动态效果时运行中旋转环静止
- [ ] 该区域 Electron 桌面端亮色与暗色截图与原型观感一致，截图作为证据附在本票 Comments
- [ ] 该区域中断言 CSS 值或几何尺寸的 e2e 已随设计更新，且在 CI 上通过
- [ ] testID 与英文 UI 文案逐字未变
- [ ] docs/design.md 等设计文档中对应章节已改写（改写过时内容，不在末尾追加）
- [ ] typecheck 与 lint 通过
