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
**Impl:** done

- [x] 上述横线全部去掉，卡片内行分隔为边框色的 50%；桌面与紧凑布局无布局回退
- [x] 新颜色在全部内置主题与插件主题样例中都有值，主题单测通过
- [x] 设置页 Electron 桌面端亮色与暗色截图（通用、外观、Providers、快捷键、主机）与 t3 观感对照，截图作为证据附在本票 Comments
- [x] 该区域中断言边框或颜色的 e2e 已随设计更新，且在 CI 上通过（PR #4 CI 全绿：[run 36259696496](https://github.com/LFT-OXY/Osuna/actions/runs/36259696496)，ac45c5dca）
- [x] testID 与英文 UI 文案逐字未变
- [x] docs/design.md 对应章节已改写（§5 卡片内行分隔、§5 workspace chrome 规则扩展到设置页），不在末尾追加
- [x] typecheck 与 lint 通过

## Comments

### 2026-09-27 — 实现记录与视觉证据

新角色：
- `borderCardRow` 为 `border` 的 50%，由 `deriveThemeRoles` 为所有主题派生，不进 `ThemeRoleOverrides`。
- 取值：默认暗色为 `rgba(25, 25, 25, 0.5)`，默认亮色为 `rgba(228, 228, 231, 0.5)`。
- `theme.test.ts` 断言了亮暗两套的字面值，并把它加进 `REDESIGN_ROLES`，覆盖全部内置主题和两个插件主题样例。

去掉的横线：
- 设置页详情头部：桌面 `ScreenHeader` 始终传 `borderless`（原来只在没有详情头时才去线）。紧凑布局两处 `BackHeader` 也传 `borderless`，为此 `BackHeader` 新增了 `borderless` prop。
- 设置侧栏：去掉返回行（`SidebarHeaderRow` 的 `header` 变体，只有设置页在用）的底边线，以及"应用"与"主机"两组之间的 `SidebarSeparator`。这个组件去掉后没有别处引用，已删除。
- 主机外观页底部预览块的顶边线：该块靠 `surfaceSidebar` 底色与卡片分开。

改淡为 `borderCardRow` 的行线：
- `settingsStyles.rowBorder`。
- 快捷键设置的 `separator`。
- 审查中补上的价格表行 `price-row.tsx` `rowBlock`。
- 两处对话框内卡片的行线："provider 详情 sheet 的模型列表（`provider-diagnostic-sheet.tsx` `modelRow`）"和"agent profile 编辑弹窗的 features 卡片"。它们都在 `settingsStyles.card` 或同形卡片里，属于"同类行线"。工单只点名了设置页，这两处是我按 design.md §5 的卡片行规则顺带统一的。

与工单字面不同的一处取舍：
- 插件列表 `pluginRow` 原来每项都画底边线，最后一项还和卡片外框叠成双线。工单把它列在"去掉"下。
- 但插件行位于 `settingsStyles.card` 里，按 PRD"卡片内行与行之间的分隔保留，颜色减为边框色的 50%"，我改成了标准卡片行线：非首行一条 `rowBorder` 顶线。
- 如果要求完全不画线，把 `plugins-page.tsx` 里的 `!isFirst && settingsStyles.rowBorder` 删掉即可。

保留的线：
- 卡片外框。
- 对话框 footer。
- 竖向分隔（设置侧栏右边线）。
- 配对设备弹窗的 `directRow` 顶线、agent profile 外观取色器的 `colorRow` 底线：两者在浮层或对话框里，不是卡片行分隔。
- 快捷键帮助对话框的行线：它原本就用 `surface2`。

Electron 桌面端证据：
- 方式：dev 桌面端，用 Playwright CDP 截图，并读取计算样式。紧凑布局用 CDP 模拟 420 宽。
- 截图：
  - 暗色：[通用](../evidence/11-electron-dark-general.jpg)、[外观](../evidence/11-electron-dark-appearance.jpg)、[快捷键](../evidence/11-electron-dark-shortcuts.jpg)、[主机](../evidence/11-electron-dark-host.jpg)、[Providers](../evidence/11-electron-dark-providers.jpg)、[插件](../evidence/11-electron-dark-plugins.jpg)
  - 亮色：[通用](../evidence/11-electron-light-general.jpg)、[外观](../evidence/11-electron-light-appearance.jpg)、[快捷键](../evidence/11-electron-light-shortcuts.jpg)、[主机](../evidence/11-electron-light-host.jpg)、[Providers](../evidence/11-electron-light-providers.jpg)、[插件](../evidence/11-electron-light-plugins.jpg)、[紧凑 · 列表](../evidence/11-electron-light-compact-root.jpg)、[紧凑 · 详情](../evidence/11-electron-light-compact-detail.jpg)
- 计算样式：通用、外观、主机、Providers 四页中，所有 1px 顶边行线在暗色下都是 `rgba(25, 25, 25, 0.5)`，亮色下都是 `rgba(228, 228, 231, 0.5)`；设置侧栏返回行 `border-bottom-width: 0px`。
- 与 t3 对照：卡片外框实线、行间更淡一档的分隔，对应 t3 `SettingsGroup` 的 `border` 加 `[&>*+*]:border-border/50`。

审查（两个轴一轮）：
- Spec：
  - 价格表行线漏改，已改。
  - 对话框内卡片行线属于超出工单点名范围，已在上文注明。
  - 插件行取舍已在上文注明。
- Standards：没有硬性问题。采纳的判断性意见：
  - design.md §5 不枚举使用方。
  - 文档里不引用 t3。
  - styling.md 只写派生规则。
  - 测试名改为 "draws card row dividers at half the border alpha"。
- Standards 未采纳：插件行样式数组用 `useMemo`，理由是沿用同类行组件（`desktop-permission-row.tsx`、`host-page.tsx`、`sidebar-nav-section.tsx`）的写法。

测试：
- 先写失败测试再实现（红→绿）：`theme.test.ts`，120 条通过。
- 定向运行 `plugins/theme.test.ts`、`providers-section.test.tsx`、`terminal-profile-edit-modal.test.tsx`、`plugins-page.test.tsx`、`plugins-page-state.test.ts`，全部通过。
- 现有 e2e 里，设置页只断言卡片外框 1px 与行高，这两项都没有变化，因此没有 e2e 需要更新。全量 e2e 待 CI，对应验收项没有勾选。

检查：`packages/app` 的 typecheck（`tsgo --noEmit`）无错误；改动文件 lint 为 0 warning、0 error；已用 `format:files` 格式化。

未验证：
- 插件行：这台主机没有已配置插件，没有截到图，只有 `plugins-page.test.tsx` 的渲染测试覆盖。
- 价格表行、provider 详情 sheet、agent profile 编辑弹窗：没有截图。
- 原生端（iOS / Android）：没有证据。
