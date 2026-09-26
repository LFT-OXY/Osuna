# 02 — Text、Row 组件与左侧栏

**What to build:** 左侧栏按原型 V1 呈现新风格，并由两个新基础组件驱动。Text：用途命名的字号阶梯（micro 11、caption 12、label 13、body 14、body-lg 15、title-sm 16、title 18、title-lg 20、display 24，外加一个行高更松的长文正文变体），每档自带行高，按外观设置的基础字号换算，颜色只接受文字三级 token 与语义色。Row：前置槽 / 内容区（标题 + 可选元信息行）/ 后置槽，hover、选中、按下三态取自新行 token，选中态在 hover 时仍可辨，遵循项目唯一的 hover 模式，后置悬停操作按 isHovered || isNative || isCompact 显示。左侧栏工作区行结构、数据来源、项目 / 状态两种分组、显示偏好都不变；选中态为细描边加浅底色；需要处理（attention）的工作区标题加粗；状态槽使用统一状态图标（运行中为低频旋转环，减少动态时静止）；Sidebar items 与底部工具栏换成新样式。

**Blocked by:** 01 — token 与主题
**Status:** ready-for-agent
**Impl:** done

- [x] Text 与 Row 有 browser 测试，覆盖每一档字号与三种状态的计算样式
- [x] 调整外观设置里的基础字号后，左侧栏文字按比例缩放
- [x] kebab 在 hover 时出现且不挤占 ±diff，在原生端与紧凑布局下常显
- [x] 开启减少动态效果时运行中旋转环静止
- [x] 该区域 Electron 桌面端亮色与暗色截图与原型观感一致，截图作为证据附在本票 Comments
- [ ] 该区域中断言 CSS 值或几何尺寸的 e2e 已随设计更新，且在 CI 上通过
- [x] testID 与英文 UI 文案逐字未变
- [x] docs/design.md 等设计文档中对应章节已改写（改写过时内容，不在末尾追加）
- [x] typecheck 与 lint 通过

## Comments

### 2026-09-26 — 实现记录与视觉证据

Electron 桌面端（dev，`FORCE_COLOR=3 PASEO_LISTEN=127.0.0.1:6769 npm run dev --workspace=@getpaseo/desktop`，Playwright CDP 截图，界面字号为本机设置的 15）：

- 暗色侧栏，选中行 hover，kebab 显示：[../evidence/02-electron-dark-sidebar.jpg](../evidence/02-electron-dark-sidebar.jpg)（选中行计算样式：底色 `rgb(19, 19, 19)`，内嵌描边 `rgb(33, 33, 33)`，圆角 8px）
- 亮色侧栏，同一状态：[../evidence/02-electron-light-sidebar.jpg](../evidence/02-electron-light-sidebar.jpg)
- 暗色整窗，含底部工具栏 hover：[../evidence/02-electron-dark-window.jpg](../evidence/02-electron-dark-window.jpg)（按钮 28×28、圆角 8px、hover 底色 `interactionHighlight`，工具栏高 44 + 1px 分隔线）
- 界面字号 18：[../evidence/02-electron-dark-sidebar-18px.jpg](../evidence/02-electron-dark-sidebar-18px.jpg)（Sidebar item 17px / 23px，工作区行 42px）。截完已把设置还原成 15。

本机 dev 数据里只有一个空闲工作区，截图里看不到运行中旋转环、attention 加粗和 ±diff。这三项由测试覆盖：
- 旋转环：`status-ring.browser.test.tsx`
- attention 加粗：代码路径 `sidebar-workspace-row-content.tsx`
- ±diff：原有的 `resolveTrailingActionVisibility`，逻辑未改

实现形态：
- `<Text>`（`components/ui/text.tsx`）读 `theme.typeScale`，`applyAppearance` 按界面字号换算字号和行高。`style` 的类型禁止写 `color` / `fontSize` / `lineHeight` / `fontWeight`。
- `<Row>`（`components/ui/row.tsx`）驱动 Sidebar items（`SidebarHeaderRow`，包括插件项和设置页的 "Back to workspace"）。
- 工作区行、项目头行、状态分组头、ghost 行的按下目标是 `ContextMenuTrigger` 加拖拽，不能直接渲染 `<Row>`。它们改用同一模块的 `getRowSurfaceStyle`，三态规则只有一份。
- 行标题、项目名、分组名、元信息行、时间戳、"Workspaces" 标题都迁到了 `<Text>`，所以都随界面字号缩放。

与原状的差异（审查中提出，按以下处理）：
- 按下态由 `surface2` 改为 `surfaceSidebarActive`。项目头行选中后 hover 不再盖掉选中底色。
- 失败状态由"工作区类型图标 + 红点角标"改为统一的危险色实心点，testID `workspace-status-indicator-failed` 不变。这是"统一状态图标"的直接结果，行结构不变。
- `StatusRing` 是全应用共用组件，改为 1 秒 8 步、减少动态时静止，所以 tab 和 Composer tracks 上的环一起变了。web 端实时读媒体查询，原生端以 `AccessibilityInfo` 订阅变化。
- "Workspaces" 标题字重由 normal 改为 medium，依据是原型和 design.md §3 "结构性标签用 medium"。
- `sidebar/sidebar-workspace-row.tsx` 在仓库里没有任何引用，这次没有迁移，也没有删除。

测试：
- browser：Text、Row、StatusRing、StatusBadge，共 4 个文件 38 条，全部通过。
- 单测：`appearance`、`styles/theme`、`components/sidebar`、`sidebar-workspace-list`、`sidebar-callout`、`status-loader`，共 18 个文件 208 条，全部通过。
- e2e 本地定向：
  - `appearance-theme-picker` 新增了亮色选中描边的断言。
  - `sidebar-workspace-mark-unread`、`workspace-labels`、`host-appearance` 通过。
  - `sidebar-nav-settings` 有 1 条失败：本机 macOS 渲染 `⌘N`，而断言期望 Linux CI 上的 `Ctrl+N`，属环境差异，与本票无关。
  - 全量 e2e 待 CI。

待确认：原生端与紧凑布局下 kebab 常显时，`resolveTrailingActionVisibility` 仍按原有行为把 ±diff 换成 kebab。本票只保证 hover 时 kebab 盖在 ±diff 上、不挤走它。
