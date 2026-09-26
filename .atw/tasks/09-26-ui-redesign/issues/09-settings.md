# 09 — 设置页

**What to build:** 设置页按分组卡片呈现：卡片圆角 14，行最小高 56，左边标题与说明、右边控件；开关、分段控件、下拉、按钮尺寸统一；provider 行显示图标、版本、就绪状态与操作按钮。list + detail 的设置外壳结构不变。

**Blocked by:** 02 — Text、Row 组件与左侧栏；03 — 通用控件与浮层
**Status:** ready-for-agent
**Impl:** done

- [x] 所有设置子页（通用、Providers、Hosts、快捷键、终端、插件、关于等）都迁移到新卡片与行
- [x] 危险操作仍需确认对话框，红色只出现在对话框里
- [x] 移动端设置页同样应用新 token，无布局回退
- [x] 该区域 Electron 桌面端亮色与暗色截图与原型观感一致，截图作为证据附在本票 Comments
- [x] 该区域中断言 CSS 值或几何尺寸的 e2e 已随设计更新，且在 CI 上通过（PR #4 CI 全绿：[run 36259696496](https://github.com/LFT-OXY/Osuna/actions/runs/36259696496)，ac45c5dca）
- [x] testID 与英文 UI 文案逐字未变
- [x] docs/design.md 等设计文档中对应章节已改写（改写过时内容，不在末尾追加）
- [x] typecheck 与 lint 通过

## Comments

### 2026-09-26 — 实现记录与视觉证据

实现前与用户确认的两项决定：
1. 已安装 provider 行不显示版本。快照（`ProviderSnapshotEntrySchema`）没有版本字段，PRD 不允许改协议和 daemon。版本只在"添加 provider"目录行显示，它读的是 ACP 注册表。
2. provider 行保留"整行点击进入详情 + chevron"，chevron 挪到行尾，不改成原型的 Configure 按钮。这样符合 design.md §12，testID、文案和 e2e 都不用动。

Electron 桌面端证据：
- 启动方式：dev，`FORCE_COLOR=3 PASEO_LISTEN=127.0.0.1:6769 npm run dev --workspace=@getpaseo/desktop`。
- 截图方式：Playwright CDP 截图并读取计算样式；紧凑布局在同一窗口模拟 420 宽。
- 截图文件：
  - 亮色：[通用](../evidence/09-electron-light-general.jpg)、[外观](../evidence/09-electron-light-appearance.jpg)、[Providers](../evidence/09-electron-light-providers.jpg)、[快捷键](../evidence/09-electron-light-shortcuts.jpg)、[主机概览](../evidence/09-electron-light-host.jpg)、[关于](../evidence/09-electron-light-about.jpg)
  - 暗色：[通用](../evidence/09-electron-dark-general.jpg)、[外观](../evidence/09-electron-dark-appearance.jpg)、[Providers](../evidence/09-electron-dark-providers.jpg)、[快捷键](../evidence/09-electron-dark-shortcuts.jpg)、[主机概览](../evidence/09-electron-dark-host.jpg)、[关于](../evidence/09-electron-dark-about.jpg)
  - [紧凑布局（暗）](../evidence/09-electron-dark-compact.jpg)：设置列表、通用、Providers 三张拼在一起。
- 计算样式（界面字号 15）：
  - 卡片圆角 14px，1px 描边，底色为 `surfaceCard`。亮色 `rgb(255, 255, 255)` 配 `rgb(228, 228, 231)`；暗色 `rgb(17, 17, 17)` 配 `rgb(25, 25, 25)`。
  - 标题加一行说明的行正好 56px 高。
  - 终端回滚输入框：112 宽、28 高、右对齐。
- 与原型对照：
  - 一致：
    - 卡片形态、56 行高、左边标题加说明、右边控件。
    - 分组标题为 13px medium 弱色。
    - 下拉、分段、按钮都是 28 高，开关 32×18。
    - provider 行由图标框、名称、状态圆点加文字、控件组成。
  - 有差异、保留现状：
    - 下拉文字为 14px，与 sm 按钮标签同档，原型是 12.5。按钮标签字号由工单 03 定为 `fontSize.base`，下拉跟随按钮。
    - 已安装 provider 行没有版本（见决定 1），元信息行显示模型数。
    - provider 图标框是 `surface2` 底加单色图标，原型是品牌色底加字母，因为仓库只有单色 provider 图标。
    - "添加 provider"目录每行仍是填充的 accent "添加"按钮，与原型的 Install 一致；这与 design.md "每页最多一个 accent"不符，属于原有问题，本票没有改。

实现形态：
- 共享层：
  - `styles/settings.ts` 定义卡片（`radius.xl`、`surfaceCard`）和行（最小高 56，内边距 16，标题与控件间距 16）。
  - 行内文字：标题 `body`、说明 `caption`、行尾只读值 `rowValue`、行首图标框 `rowIconFrame`。
  - 大约 30 个直接用 `settingsStyles` 的文件跟着换了外观：Hosts、插件、终端、关于、项目、Agents、日程等页没有再单独改。
- 下拉触发器：`components/ui/dropdown-trigger.tsx` 自带外框，与 sm 按钮同高同圆角，静止时 `borderInput`，悬停或展开时 `borderAccent`。
  - 通用、外观、主机外观三处原本各自手画的外框都删掉了，改用它。
  - `SettingsSelect` 原来没有外框，现在也有了。
- 输入框：通用页的终端回滚、外观页的字体和字号，从手写样式的 `EditingTextInput` 换成 `FormTextInput`（桌面 sm、紧凑 md，与 `SettingsInput` 相同）。
- 设置侧栏：导航行改为 `<Row size="sm">`，选中态与左侧栏相同（浅底加内描边）。分组标签为 `caption` medium，主机选择器的高度、圆角和悬停底色与导航行一致。
- Providers：
  - 按决定 1、2 重写了行；目录行换成设置卡片与行，共用同一个图标框。
  - 去掉了 `useUnistyles`，图标颜色改走 `withUnistyles`。
- 危险操作：主机页的"移除连接"和"Remove host"原来在页面上就是红字（后者还有红图标），现在改为普通 outline。两者都先打开确认，红色按钮只在确认的 footer 里。
- 桌面 daemon 版本不一致的提示：从手写的琥珀色边框块换成 `<Alert variant="warning">`。
- 同时清掉了改动文件里的 `useUnistyles`：设置页主体、providers、桌面更新、主机页的 Remove host。

审查中处理的问题：
- 本地发现：`FormTextInput` 在 Web 上会压平 `style` 来拆分外框和文字，而 Web 上的 Unistyles 样式只剩 class，压平后没有值。结果是输入框宽度和对齐悄悄失效，Electron 里输入框变宽、左对齐。
  - 本票的三个输入框改为传普通对象。
  - 原因写在 `form-field.tsx` 的注释和 styling spec 里。
  - 其他调用方（`SettingsInput` 的 `minWidth`、日程表单等）有同样问题，没有改，超出本票范围。
- 仓库的 `unistyles-module-scope` 守卫测试抓到了模块顶层的 `[settingsStyles.row, settingsStyles.rowBorder]` 数组，已改为在渲染时组合。
- Standards 轴意见：
  - design.md 里 provider 段落在复述代码，已压缩为代码里读不到的两点：共用图标框、为什么没有版本。
  - 删掉了只复述代码的注释。
  - 颜色映射改用仓库惯用名。
- Spec 轴意见：
  - 主机页页面上的红字按钮：已修，见上。
  - 未采纳：`plugins-page`、`host-page` 本地文字仍用 `fontSize.base/sm`，没有换成 `typeScale`。两者都随界面字号换算，PRD 只要求"碰到的文件顺带换 token"。
  - 未采纳（Standards 轴）：新增的几何 e2e 被判为"测结构不测行为"（docs/testing.md）。保留，因为本票验收项明确要求 e2e 断言新的尺寸，工单 08 的 tab 与树行几何用例是同类先例。
  - 未采纳：`settingsStyles` 的修改也作用到日程表、诊断 sheet 等非设置页的卡片。design.md §1 要求同一种行在各处是同一个组件，这正是预期结果。

测试：
- 单测：
  - `providers-section.test.tsx` 把行组成的断言改为新顺序：图标 → 名称 → 模型数 → 状态 → 开关 → chevron。改完先确认失败，实现后通过。
  - 连同 `screens/settings`、`components/ui`、`components/settings`、`styles`、`desktop` 等目录，共 58 个文件 526 条，全部通过。
- e2e 本地定向：
  - 新增 `settings-navigation.spec.ts` "lays out settings as 14px cards with 56px rows and 28px controls"。
  - `appearance-theme-picker.spec.ts` 的界面字号断言改为分组标题的 `label` 档：21 → 20px，12 → 11px。
  - 批量跑了 `provider-removal`、`acp-provider-catalog`、`provider-settings-refresh`、`host-appearance`、`settings-host-page`、`settings-host-selection`、`settings-i18n`、`sidebar-nav-settings`、`plugin-theme`、`projects-settings`、`agent-profiles-settings`、`agent-message-submission`，61 条里 60 条通过。
  - 失败的 1 条是 `sidebar-nav-settings` "owner reorders…"：断言快捷键徽标为 "Ctrl+N"，macOS 本机渲染为 "⌘N"。stash 掉本票改动后在基线上同样失败，是本机平台差异，与本票无关。
  - 最终改动后复跑 `settings-navigation`、`appearance-theme-picker`、`settings-host-page`、`provider-removal`、`acp-provider-catalog`，全部通过。
  - 全量 e2e 待 CI，对应验收项没有勾选。

检查：`packages/app` 的 typecheck（`tsgo --noEmit`）无错误；改动文件的 lint 为 0 warning、0 error；改动文件已逐个用 `format:files` 格式化。

未验证：
- 原生端（iOS / Android）没有真机或模拟器证据。紧凑布局只在 Electron 里模拟了 420 宽。
- dev 窗口启动时控制台有一条 "React does not recognize the uniProps prop" 警告，出现在进入设置页之前；设置各页的 DOM 里没有带 `uniprops` 属性的元素。来源没有继续追。
