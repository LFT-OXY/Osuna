# 11 — 设置页去掉横向分割线，卡片行分隔改淡

**What to build:** 把工单 10 在工作区做的"去横线、靠底色和留白分层"推广到设置页。页面外框的横线全部去掉；卡片内行与行之间的分隔线保留，但颜色减到边框色的 50%，与 t3 `SettingsGroup`（`[&>*+*]:border-t [&>*+*]:border-border/50`）一致。布局结构不变。

- **去掉**：
  - 设置页详情区头部（`ScreenHeader`）的底边线，桌面与紧凑布局（`BackHeader`）都去掉。
  - 设置侧栏里的分隔线：返回行下方、"应用"与"主机"两组之间（`SidebarSeparator`）。
  - 内容区里的零散横线：插件列表每项的底边线（`plugins-page.tsx` `pluginRow`）、主机外观页底部区块的顶边线（`host-appearance-section.tsx`），以及审查中发现的同类线。
- **改淡**：卡片内的行分隔（`settingsStyles.rowBorder`，以及快捷键设置里的 `separator` 等同类行线）改用边框色的 50%。新颜色按 PRD 的派生规则加进所有主题（含插件主题），不逐套手调，不硬编码。
- **保留**：卡片外框的 1px 描边；对话框 footer 上方的线；竖向分隔。

**Blocked by:** 09 — 设置页；10 — 去掉横向分割线、Composer 控件图标对齐 t3
**Status:** ready-for-agent
**Impl:** doing

- [ ] 上述横线全部去掉，卡片内行分隔为边框色的 50%；桌面与紧凑布局无布局回退
- [ ] 新颜色在全部内置主题与插件主题样例中都有值，主题单测通过
- [ ] 设置页 Electron 桌面端亮色与暗色截图（通用、外观、Providers、快捷键、主机）与 t3 观感对照，截图作为证据附在本票 Comments
- [ ] 该区域中断言边框或颜色的 e2e 已随设计更新，且在 CI 上通过
- [ ] testID 与英文 UI 文案逐字未变
- [ ] docs/design.md 对应章节已改写（§5 卡片内行分隔、§5 workspace chrome 规则扩展到设置页），不在末尾追加
- [ ] typecheck 与 lint 通过
