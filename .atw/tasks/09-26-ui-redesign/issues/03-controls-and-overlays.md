# 03 — 通用控件与浮层（含毛玻璃）

**What to build:** 所有共享控件和浮层换成新外观且对外接口不变：按钮、下拉菜单、右键菜单、Combobox、Tooltip、开关、分段控件、输入框、sheet、确认对话框。菜单圆角 10、菜单项高 30 圆角 6、高亮态清楚；对话框圆角 18、带底部按钮区与浅色风险警示块；危险操作在菜单中为红色文字，红色按钮只出现在确认对话框里。毛玻璃（半透明表面 + 背景模糊与饱和度）与全局噪点只在 Web / Electron 生效，原生端为同色不透明表面；对话框遮罩在 Web 上带轻微模糊。

**Blocked by:** 01 — token 与主题
**Status:** ready-for-agent
**Impl:** done

- [x] 毛玻璃在 Web 与原生降级两条路径各有 browser 测试断言计算样式
- [x] 原生端（iOS / Android）菜单、sheet、对话框为不透明表面，无模糊
- [x] 现有菜单引擎（popover / sheet、子菜单、hover intent）行为不变
- [x] 该区域 Electron 桌面端亮色与暗色截图与原型观感一致，截图作为证据附在本票 Comments
- [ ] 该区域中断言 CSS 值或几何尺寸的 e2e 已随设计更新，且在 CI 上通过
- [x] testID 与英文 UI 文案逐字未变
- [x] docs/design.md 等设计文档中对应章节已改写（改写过时内容，不在末尾追加）
- [x] typecheck 与 lint 通过

## Comments

### 2026-09-26 — 实现记录与视觉证据

实现前与用户确认的两项决定（改变了本票范围）：

1. `confirmDialog` 保持系统原生对话框：Electron `dialog.ask`、浏览器 `window.confirm`、原生 `Alert.alert`。原因是它的外观由操作系统决定。"圆角 18、底部按钮区、浅色警示块、遮罩模糊、红色按钮"落在应用内对话框上，即 `AdaptiveModalSheet` 的桌面卡片。约 20 处用 `page.once("dialog")` 的 e2e 因此不受影响。
2. 控件高度：`md` 断点起（桌面、平板、Electron）按钮、输入框、分段控件为 xs 24 / sm 28 / md·lg 32；紧凑布局保持触控高度 28 / 32 / 44。切分点与菜单行高相同。

Electron 桌面端证据（dev，`FORCE_COLOR=3 PASEO_LISTEN=127.0.0.1:6769 npm run dev --workspace=@getpaseo/desktop`，Playwright CDP 截图并读取计算样式）：

- 菜单（文件浏览器右键，含红字"删除"）：[亮](../evidence/03-electron-light-menu.jpg)、[暗](../evidence/03-electron-dark-menu.jpg)。
  - 计算样式：亮色 `rgba(255, 255, 255, 0.8)`、`backdrop-filter: blur(12px) saturate(1.14)`、圆角 10px；暗色 `rgba(17, 17, 17, 0.8)`，另带 `inset 0 1px rgba(255,255,255,.04)`。
  - 菜单项 30px 高、圆角 6px。
  - 高亮：鼠标打开时 0 行高亮，悬停时 1 行，键盘 ↓↓ 后 1 行（焦点行）。
- 带底部按钮区的确认对话框（Remove host，只截图，随后点了取消）：[亮](../evidence/03-electron-light-confirm-dialog.jpg)、[暗](../evidence/03-electron-dark-confirm-dialog.jpg)。
  - 卡片圆角 18px、毛玻璃。
  - 遮罩：亮 `rgba(0,0,0,.18)` / 暗 `.35`，均为 `blur(4px)`。
  - 底部按钮区为 `surfaceDialogFooter` 色带，按钮右对齐。
- 对话框（快捷键）：[暗](../evidence/03-electron-dark-dialog.jpg)。
- 浅色风险警示块：[亮](../evidence/03-electron-light-warning.jpg)、[暗](../evidence/03-electron-dark-warning.jpg)。取自配对设备对话框；原图含配对二维码与链接，属于凭据，只裁了警示块这一条入库。
- 设置页控件：[亮（分段控件、28 高按钮）](../evidence/03-electron-light-settings-controls.jpg)、[暗（32×18 开关、下拉触发器）](../evidence/03-electron-dark-settings-controls.jpg)。

实现形态：

- 浮层取值做成派生角色（`deriveOverlayRoles`）：`surfaceGlass`、`surfaceDialogFooter`、`surfaceWarning`、`overlayScrim`、`shadowPopover`、`shadowDialog`。Web 上主题色进样式工厂时是 CSS 变量，不能在工厂里算色。
- 毛玻璃由 `styles/floating-surface.ts` 的纯函数构造，参数 `{ glass }` 由 `GLASS_SURFACES_ENABLED`（`glass-support.ts` / `.web.ts`）决定。所以 browser 测试能在同一次运行里断言 Web 和原生降级两条路径。
- 对话框遮罩画在关闭用的 Pressable 上，与卡片并列：带 `backdrop-filter` 的祖先会成为卡片的 backdrop root，卡片自己的模糊只会采样到遮罩色。
- 全局噪点是 `body::after` 覆盖层（`install-web-surface-grain.web.ts`），不像 t3code 那样烘进各表面。Electron 空闲 GPU 占用若上涨，改为逐表面接入。

与原状的差异（审查中提出，按以下处理）：

- 菜单焦点高亮改为只在 `:focus-visible` 时显示。引擎在每次打开时都会聚焦首项（引擎行为未改），旧样式把焦点和悬停画成同一种高亮，鼠标打开后会同时亮两行。
- `<Alert variant="warning">` 全局改为浅色警示块（无边框、`surfaceWarning` 底、圆角 8），页面上的 warning 提示也一起变。这个文件同时去掉了 `useUnistyles()`。
- "清除浏览器数据"从页面上的红色按钮改为 outline（它先走 `confirmDialog`）。
- host 页的两处应用内确认（Remove host、Remove connection）按钮挪进 `footer`，右对齐。
- `ComboboxItem` 的 `elevated` 属性已删除：半透明高亮在任何表面都成立，且仓库里没有调用方。
- 输入框静止时带 `borderInput` 描边。`form-field`、`select-field`、`pane-find`、agent 外观字段的 `controlRest` / `Hover` / `Active` 改为直接引用 `theme`：Unistyles 插件原本不把经 `geometry` 变量带进来的颜色记为主题依赖，原生端切主题时这些颜色不会刷新。

未采纳：

- 开关关闭时轨道仍用 `surface3`，没有照原型改用 input 色。默认暗色的 `borderInput` `#1e1e1e` 在卡片上几乎看不见；旧主题派生的 `borderInput` 等于 `border`，同样太淡。
- host 页两个 footer 的 JSX 重复。这是原有重复，只是整体换了位置，没有合并。

测试：

- 单测：`styles`、`utils/color`、`components/ui`、`session-history`、`screens/settings` 等 43 个文件、387 条全部通过。
  - 主题单测新增浮层角色断言。
  - `control-geometry.test.ts` 改为新的尺寸契约。
  - 5 个 jsdom 测试的本地假主题补了 `radius` / `controlHeight`。
- browser：`styles/floating-surface`（Web 与原生两条路径）、`install-web-surface-grain`，以及 `components/ui` 下已有的测试，共 5 个文件 42 条通过。
- e2e 本地定向：`settings-navigation`（含 Remove host 流程）、`appearance-theme-picker`、`sidebar-workspace-mark-unread`、`rewind-menu.ui-contract`，共 19 条通过。全量待 CI。

未验证：原生端（iOS / Android）没有在真机或模拟器上跑过。不透明路径由 `GLASS_SURFACES_ENABLED = false` 和 browser 测试的降级用例覆盖。
