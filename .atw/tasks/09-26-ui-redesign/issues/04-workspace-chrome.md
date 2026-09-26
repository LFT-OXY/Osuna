# 04 — 工作区外框

**What to build:** 工作区头部（面包屑、分支切换、操作按钮）更紧凑；tab 条中 tab 高约 26、圆角 8，当前 tab 有底色，关闭按钮在 hover 或选中时出现，未聚焦 pane 的当前 tab 用更弱底色；pane 头与内容之间只有一条底边线、无阴影。多 tab 与分屏保留，行为不变。

**Blocked by:** 02 — Text、Row 组件与左侧栏
**Status:** ready-for-agent
**Impl:** done

- [x] 分屏时能分辨哪个 pane 获得焦点
- [x] tab 很多时不换行、不遮挡新建按钮
- [x] 关闭按钮在原生端与紧凑布局下的可达性不低于现状
- [x] 该区域 Electron 桌面端亮色与暗色截图与原型观感一致，截图作为证据附在本票 Comments
- [ ] 该区域中断言 CSS 值或几何尺寸的 e2e 已随设计更新，且在 CI 上通过
- [x] testID 与英文 UI 文案逐字未变
- [x] docs/design.md 等设计文档中对应章节已改写（改写过时内容，不在末尾追加）
- [x] typecheck 与 lint 通过

## Comments

### 2026-09-26 — 实现记录与视觉证据

Electron 桌面端证据：
- 启动方式：dev，`FORCE_COLOR=3 PASEO_LISTEN=127.0.0.1:6769 npm run dev --workspace=@getpaseo/desktop`。
- 截图：Playwright CDP 截图并读取计算样式。
- 截图时的状态：左右分屏，焦点在右侧 pane；右侧第 1 个 tab 为当前 tab，第 3 个 tab 处于悬停。

- 亮色：[头部与 tab 条](../evidence/04-electron-light-chrome.jpg)、[整窗](../evidence/04-electron-light-window.jpg)
- 暗色：[头部与 tab 条](../evidence/04-electron-dark-chrome.jpg)、[整窗](../evidence/04-electron-dark-window.jpg)
- 计算样式：
  - tab 为 26px 高，圆角 8px。
  - 暗色：聚焦 pane 的当前 tab 底色 `rgb(28, 28, 28)`，文字为 foreground；未聚焦 pane 的当前 tab 与悬停 tab 底色均为 `rgb(22, 22, 22)`，未聚焦的当前 tab 文字为 muted。
  - 亮色：对应两档为 `rgb(234, 234, 234)` 与 `rgb(241, 241, 242)`。
  - tab 条高 36，底边 1px `border`，`box-shadow: none`。
- 多 tab：在一个 pane 里开 8 个终端 tab，tab 条仍为一行，进入横向滚动，新建按钮移到 pane 工具栏，不被 tab 遮挡。

实现形态：
- 新增派生角色 `surfaceTabHover` 与 `surfaceTabActive`：
  - 在 `deriveThemeRoles` 里从 `surface0`（pane 底色）向前景色叠 5% 与 7.5%，亮暗共用一组比例。
  - 两档都经 `ensureDistinctRowColor` 拉开，默认亮色的 active 因此落在 `#eaeaea`（原型约 `#ededed`）。
  - 所有主题都走派生，默认亮 / 暗主题不单独给值。
  - 两个角色也加进了 `SurfaceBackdrop`，tab 上的状态环挖空跟随 chip 底色。
- tab chip：
  - 高度取 `HEADER_CONTROL_HEIGHT`，圆角 `radius.md`，标签改用 `<Text variant="caption">`。
  - 关闭按钮的显示条件加上"当前 tab"，原生端与紧凑布局仍常显。
  - 每个 chip 都预留关闭按钮位置，标签在按钮前截断；原来盖在标签上的渐变遮罩已去掉。原因：当前 tab 常显关闭按钮后，遮罩会让当前 tab 的标签末尾一直被淡出。
- 内联新建按钮：与 tab 同高同圆角。
- 头部：
  - 桌面端改为 `项目 / 工作区` 面包屑，紧凑布局不变。
  - 头部操作按钮（打开编辑器、git 操作、脚本、插件按钮）改为圆角 `radius.md`、hover 底色 `interactionHighlight`；脚本按钮在紧凑布局下的 ghost 形态由 `borderRadius.lg` 改读 `radius.md`，数值同为 8。
  - `GitActionsSplitButton` 的 `menuOnly` 形态也用在 Changes 工具栏（`git/diff-pane.tsx`，属工单 08 区域），同一组件，圆角与 hover 底色一起变了。
- 图标尺寸 token：本票碰到的文件里，12 / 14 / 16 的图标尺寸字面量换成 `ICON_SIZE`。脚本菜单行内操作图标这一组（11 与 12 混排）整组保持原值：11 不在 `ICON_SIZE` 刻度内，只换一半会让同一组图标混用常量和字面量。

与工单原文的偏离：
- **没有在头部加分支切换。** 分支切换在 Changes 面板里，`e2e/browser/branch-switcher.spec.ts` 用 `expectNoBranchSwitcherInWorkspaceHeader` 断言它不在头部。PRD 要求布局结构不变，所以没有搬动。
- **头部高度保持 36**（原型 44）。现状已比原型紧凑。"更紧凑"落在面包屑、操作按钮和 tab 条上。
- **原型面包屑里的项目图标没有做。** 头部当前只拿到项目名字符串，没有项目图标数据。

与原状的差异（审查中提出，按以下处理）：
- `icon-button-chrome.ts` 的 large 尺寸圆角由 6 改为 `radius.md`（8），small 尺寸改用 `radius.sm`（数值仍为 6）。
  - large 是全应用头部图标按钮共用的原件，所以设置页等其他头部的图标按钮也跟着变。
  - 只改工作区会让同一控件族出现两种圆角，因此保留，没有回退。
- 与原型的 tab 文字 / 图标颜色差异，原因都是 Text 只有三级文字色（foreground / muted / extraMuted），没有原型的 `--text-2` 这一档：
  - 未聚焦 pane 的当前 tab 文字用 muted，原型是 `--text-2`。
  - 悬停 tab 的文字用 foreground，原型是 `--text-2`。沿用改动前的行为。
  - 关闭按钮图标静止时用 muted、悬停或按下时用 foreground，原型是 `--faint`。沿用改动前的行为。

测试：
- 单测：
  - `styles/theme.test.ts` 新增默认主题的 tab 底色断言，以及全目录主题（含插件样例）的 tab 两档对比度断言。
  - `styles`、`screens/workspace`、`components/ui`、`git`、`plugins/buttons`、`workspace`、`status-ring` 目录，外加 11 个自带假主题的 jsdom 测试，共 120 个文件 1026 条全部通过。
  - `workspace-scripts-button.test.tsx` 的假主题补了 `radius`。
- browser：`status-ring`、`row` 通过。
- e2e：
  - `launcher-tab.spec.ts` 新增一条：tab 26px / 8px；指针不在 tab 上时，当前 tab 显示关闭按钮、非当前 tab 隐藏；分屏后聚焦 pane 的当前 tab 底色相对 tab 条的对比度高于未聚焦 pane 的当前 tab。
  - 本地定向通过：`launcher-tab` 3 条、`branch-switcher`、`workspace-cwd`、`workspace-focus-mode`、`workspace-terminal-tab-rename`、`workspace-scripts-menu-resize`、`plugin-workspace-panels`、`plugin-buttons`、`changes-pane` 的评审用例，以及 `explorer-pane-placement` 的 2 条。
  - 本地失败但与本票无关：
    - `explorer-pane-placement` 的 2 条在未改动的基线（2f1642441）上同样失败：菜单已打开，但 `getByRole("menuitem", { name: "Split pane right" })` 匹配不到，原因未查明。
    - `workspace-agent-tab-tooltip` 失败原因是本机 opencode 配置（`Invalid mode 'build'`）。
    - `terminal-tab-title-loading` 失败原因是本机 shell 用标题转义覆盖了终端名。
  - 已有的相关 CSS / 几何断言都不用改：`changes-pane.spec.ts` 对 `workspace-tab-working_diff` 底色的断言是和自身前一刻比较；`support/helpers/plugin-buttons.ts` 的头部截断与几何断言只在紧凑视口。两者本地通过。全量 e2e 待 CI。
