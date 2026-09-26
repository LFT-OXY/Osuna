# 03 — 通用控件与浮层（含毛玻璃）

**What to build:** 所有共享控件和浮层换成新外观且对外接口不变：按钮、下拉菜单、右键菜单、Combobox、Tooltip、开关、分段控件、输入框、sheet、确认对话框。菜单圆角 10、菜单项高 30 圆角 6、高亮态清楚；对话框圆角 18、带底部按钮区与浅色风险警示块；危险操作在菜单中为红色文字，红色按钮只出现在确认对话框里。毛玻璃（半透明表面 + 背景模糊与饱和度）与全局噪点只在 Web / Electron 生效，原生端为同色不透明表面；对话框遮罩在 Web 上带轻微模糊。

**Blocked by:** 01 — token 与主题
**Status:** ready-for-agent
**Impl:** ready

- [ ] 毛玻璃在 Web 与原生降级两条路径各有 browser 测试断言计算样式
- [ ] 原生端（iOS / Android）菜单、sheet、对话框为不透明表面，无模糊
- [ ] 现有菜单引擎（popover / sheet、子菜单、hover intent）行为不变
- [ ] 该区域 Electron 桌面端亮色与暗色截图与原型观感一致，截图作为证据附在本票 Comments
- [ ] 该区域中断言 CSS 值或几何尺寸的 e2e 已随设计更新，且在 CI 上通过
- [ ] testID 与英文 UI 文案逐字未变
- [ ] docs/design.md 等设计文档中对应章节已改写（改写过时内容，不在末尾追加）
- [ ] typecheck 与 lint 通过
