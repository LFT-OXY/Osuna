# 07 — 第四段的适配：Explorer 标签

**What to build:** Explorer 的标签用上游的新写法——有 + 菜单、能拖动排序、Files 与 Changes 能关闭——同时是 Osuna 的样子，并且 Osuna 的会话历史视图是其中正式的一种标签：默认就在，能关掉，能从 + 菜单重新打开，能拖到别的位置。标签的高度、圆角、选中态与工作区标签是同一种，不带上游的色值与间距。规格见 `prd.md` 的「Explorer 的标签」「UI and Design」，以及 `docs/explorer-sidebar.md`、`docs/menus.md`、`docs/design.md`。

**Blocked by:** 06
**Status:** ready-for-agent
**Impl:** doing

- [x] 会话历史是新写法里的一种标签：默认标签列表里有它；关闭后 + 菜单里出现它，点一下重新打开；能拖动排序。
- [x] Files、Changes 可关闭并能从 + 菜单打开；PR 标签的行为与上游一致。
- [x] 上次打开的 Explorer 标签在切换工作区与重启后的记忆行为与合并前一致（Osuna 现有的测试通过，无一改动断言）。
- [x] Explorer 标签的测试里有会话历史的用例：默认存在、关闭、从 + 菜单打开。
- [x] 标签的外观按 `docs/design.md` 与工作区标签的现有样式；上游在这批改动里对色值、间距的纯外观调整没有收。
- [x] + 菜单按 `docs/menus.md` 的菜单引擎约定，桌面是浮层、窄屏是抽屉，外观与 Osuna 其他菜单一致。
- [x] 上游 e2e 里写死上游主题色值的断言已对照 Osuna 的主题重算；改动逐条记在 `## Comments` 下。
- [x] `docs/explorer-sidebar.md` 的冲突两边都留，并写上会话历史在新标签结构里的位置。
- [x] 界面语言为中文时，+ 菜单与标签上没有残留的英文；翻译资源测试通过。
- [x] typecheck 和 lint 通过；改动涉及的测试文件逐个跑过并通过。
- [x] UI：Explorer / 默认状态 / 桌面 1280 — 标签栏里有会话历史；标签的高度、圆角、选中态与同一窗口里的工作区标签一致。
- [x] UI：Explorer / + 菜单展开 / 桌面 1280 — 菜单里列出当前未打开的视图，圆角与底色与 Osuna 其他菜单一致。
- [x] UI：Explorer / 关掉 Files 之后 / 桌面 1280 — 标签栏里没有 Files，+ 菜单里有。

## Comments

### 2026-10-12 实施记录

**起点。** 06 已把 Explorer 换成上游的共用标签行（`screens/workspace/explorer-sidebar.tsx` 渲染 `WorkspaceDesktopTabsRow host="explorer"`），会话历史作为 `session_history` 面板补进 `panels/panel-manifest.ts`（`showCloseButton: false, singleton: true`）与启动项目录，Files / Changes / 会话历史的默认种子与补种逻辑没动；上游的 Explorer e2e 已按 Osuna 的行为改过预期（06 的记录逐条）。07 做的是外观、测试、文档与截图的收尾。

**逐项核对（共用标签行对照 Osuna 原 `explorer-sidebar-tab-rail.tsx`，基点 `351fc0655`）。** 一致、没改的：chip 高度 `HEADER_CONTROL_HEIGHT`（26）、`radius.md`（8）、`<Text variant="caption">` 标签、选中态 `surfaceTabActive` / 悬停 `surfaceTabHover`、静止无底色；几何也一致——老 rail 外侧 4 + slot 2 + chip 内边距 8，共用行 `TAB_ROW_PADDING_HORIZONTAL` 4 + `TAB_CHIP_GAP / 2` 2 + `TAB_CHIP_HORIZONTAL_PADDING` 8，图标都落在 x = 14；tooltip、拖动排序（`SortableInlineList`）、右键菜单（含移到主区）由共用行提供。**不一致、本工单修的一处：** 共用行的 `tabsContainer` 底色写死 `surface0`（主画布），静止 tab 的状态环挖空 `resolveChipBackdrop` 也返回 `surface0`，溢出时的滚动遮罩 `backdrop="surface"`；Explorer 坞是 `surfaceSidebar`（Light `#fafafa` 对 `#fcfcfc`，Dark `#000000` 对 `#0a0a0a`，Zinc 等深色主题差得更多），老 rail 三处都用侧栏底色。改法：`WorkspaceDesktopTabsRow` 按 `host === "explorer"` 派生 `onSidebar`，标签行加 `tabsContainerSidebar`（`surfaceSidebar`），`resolveChipBackdrop` 多一个 `restBackdrop`（`TabRestBackdrop = "surface0" | "surfaceSidebar"`）经 `ResolvedDesktopTabChip` → `TabChip` 传下去，滚动遮罩 `backdrop` 随 `onSidebar` 取 `"sidebar"`。主区标签行三处的取值不变。

**上游在这批改动里对标签行的纯外观调整。** 对比 `351fc0655..HEAD` 的 `workspace-desktop-tabs-row.tsx`：上游只加了 `host` / `launchPurpose` / `ownsKeyboardShortcuts` / `panePanelKinds` 与按 `presentation.showCloseButton` 画关闭按钮，另把 `TAB_MIN_WIDTH` 96 → 64——这是为了 320 宽的 Explorer 坞放下 Files 等三个 chip，是布局必需而非色值间距（上游 e2e `expectTabTitleFits(page, "Files", { min: 64, max: 90 })` 守着），照收；没有色值、间距、圆角的调整。上游该文件带的 `borderBottom` 分割线与坞的 `tabRailDivider` 在 06 已按 Osuna 保持删除。

**上游 e2e 里写死主题色值的断言。** 对 `351fc0655..HEAD` 的 `packages/app/e2e` 差异 grep `rgb(` / 六位 hex：没有新增写死色值的断言；Explorer 相关只有 Osuna 自己的「`rgba(0, 0, 0, 0)`（静止无底色）」与「与主区当前 tab 同底色」的相对断言，无需重算。

**测试（本机逐个文件跑过）。**
- `e2e/browser/explorer-sidebar.spec.ts`「draws its tabs as workspace tab chips」新增断言：Explorer 内 `workspace-tabs-row` 的 `background-color` 等于 `workspace-explorer-sidebar` 的。先跑红（Expected `rgb(250, 250, 250)`，Received `rgb(252, 252, 252)`），改完整个文件 4 条通过（`--project=browser`）。
- 会话历史用例已在 06 落在 `e2e/support/helpers/explorer-plugin-menu.ts`（`expectIndependentExplorerPanelTabs`：默认打开、+ 菜单里不重复、右键关闭后从 + 菜单回来）与 `explorer-sidebar.spec.ts`（默认可见、Close other tabs 关两个）；本工单没有再加。
- 单元：`workspace-tabs/explorer-sidebar.test.ts`（含「opens Session history as an Explorer-only tab on desktop」「selects Session history in the compact Explorer」）、`stores/workspace-layout-store.test.ts` 共 144 条通过（要在 `packages/app` 目录下跑，仓库根目录缺 `__DEV__` 垫片）；`panels/panel-manifest.test.ts`、`i18n/resources.test.ts`、`components/compact-explorer-sidebar-host-state.test.ts` 46 条通过。记忆行为的两个测试文件相对基点无改动（`git diff --stat` 为空），断言无一改动。
- `npm run typecheck`、对改动文件的 `npm run lint` 与 `npm run format:files` 通过。

**dev 桌面端截图（`screenshots/07-*`，Electron 1280×800，Light，zh 与 en 各一套；主机名原本已是 dev-host）。**
- `07-explorer-default-desktop-1280-{zh,en}`：Explorer 标签栏「文件 / 更改 / 会话历史」+「+」，当前「更改」。脚本读到：Explorer 标签行 `rgb(250, 250, 250)` = 坞底色，主区标签行 `rgb(252, 252, 252)`；当前 chip 高 26px、圆角 8px，与主区「新建标签页」chip 同一种。评审后修掉关闭槽并全部重拍：中文「更改」chip 宽 64px（共用行的最小可点击宽度），标签左 26px（图标 14 + 间距 4 + 内边距 8）、右 14px（内边距 8 + 最小宽度多出的 6）；英文「Changes」chip 宽 78px、右侧恰为内边距 8px。拍前脚本把 Files 拖回第一位（顺便验证了拖动排序），六张的顺序一致。
- `07-explorer-plus-menu-desktop-1280-{zh,en}`：+ 菜单为浮层，条目「终端 ⇧⌘T / 差异 ⇧⌘G」（Files、Changes、会话历史已打开，按单例不列；Agent 与终端配置不出现），圆角、底色与工作区其他下拉菜单同一引擎。
- `07-explorer-files-closed-desktop-1280-{zh,en}`：右键「文件」→ 关闭后标签栏里没有 Files，+ 菜单多出「文件 ⇧⌘E」；点它后 Files 回来（截图之后恢复）。
- 中文界面下标签与 + 菜单没有残留英文。
- **观察，未改、交维护者：** en 下 320 宽的坞里三个 chip 按共用行「收缩到放下」的策略被截成「Chan… / Session … / Files」（zh 的「文件 / 更改 / 会话历史」放得下）。Osuna 原 rail 是按内容宽度排、放不下横向滚动；换成上游共用行后这是上游的布局策略。要改得在共用行加按宿主的最小宽度或让坞更宽，超出本工单「外观与工作区标签同一种」的范围。
- 截图脚本把 dev 的界面语言依次改成 zh-CN、en 取图，结束时设回 zh-CN（原值没有先读出来，dev 一直是中文界面）。
- 窄屏（compact）的 Explorer 是 `components/compact-explorer-sidebar.tsx` 的整页覆盖层，上游没动，它没有共用标签行也没有 + 菜单，「桌面是浮层、窄屏是抽屉」这一项只按桌面验（原生端免验收）。
- `docs/explorer-sidebar.md` 复核：06 已以上游新文本为底并补进会话历史（「Files, Changes, and Session history are the Explorer defaults」「Session history cannot leave Explorer」「Files, Changes, and Session history hide their close buttons through the panel manifest」），本工单的底色改动不改文档说法（`docs/design.md` §5 本来就写「Explorer tabs are the same chips on the sidebar surface」），只补 `.atw/spec/app/frontend/styling.md`。

#### 评审（Standards、Spec、Visual 三个维度各一轮；修复后只复查修过的，各一次）

- **已修（Standards 硬违规）：** `resolveChipBackdrop` 的原 JSDoc 被新插的 `TabRestBackdrop` 类型隔开——类型及其注释挪到原 JSDoc 之上。
- **已修（Spec 范围蔓延）：** `task.json` 的 `implementation_base_sha` 被 `task.py resume` 改成了当前 HEAD，用 `set-meta` 设回 `351fc0655`。
- **已修（Visual 可观察缺陷）：** 中文截图里选中的「更改」chip 左内边距 9px、右侧空白约 24px——Osuna 给每个 chip 常留的关闭槽（`TAB_CLOSE_BUTTON_RESERVED_WIDTH`，06 为「当前 tab 常显关闭按钮、标签不动」加的）在上游 `showCloseButton: false` 的导航视图上成了死空白，老 rail 没有这个槽。改法：`computeWorkspaceTabLayout` 多一个逐 tab 的 `tabCloseSlots`，不画关闭按钮的 tab 不计 `closeButtonWidth`（`workspace-tab-layout.test.ts` 先红后绿：「reserves the close slot only for tabs that draw a close button」）；共用行从度量快照 `trackSnapshot.tabs` 的 `presentation.showCloseButton` 取值，与 `labelWidths` 同一份、同顺序。主区有关闭按钮的 chip 不受影响。en 下「Changes」少占 22px 后截断的程度随之减轻（Visual 也点到），但「收缩到放下」的策略本身仍是上游的，见上面的观察。
- **已修（Standards 判断项，顺手收）：** e2e 的 `dockFill` 加 `not.toBe("rgba(0, 0, 0, 0)")`，防坞容器日后不画底色时断言空过。
- **已修（Visual 证据一致性）：** en 的 + 菜单截图标签顺序与 zh 不同（Files 重开后排到末尾）——修完关闭槽后六张全部重拍，拍前把 Files 拖回第一位。
- **判断项，照原样提交并记录：** `host === "explorer"` 派生出 `TabRestBackdrop`（`"surface0" | "surfaceSidebar"`）与滚动遮罩的 `"surface" | "sidebar"` 两套词汇——只有两处，再多一种宿主或底色时收成「宿主 → 底色」映射；`restBackdrop` 四层透传与同文件 `showCloseButton` 的传法一致，不改 context。
- **复查（只查修过的，各一次）：** Visual 重看六张重拍截图：chip 右侧空白消失、与主区 chip 边距一致，六张顺序一致，无新发现；注释位置与 `task.json` 基点由主会话自查（`resolveChipBackdrop` 的 JSDoc 回到函数上方；`git diff task.json` 为空）。测试在修后重跑：`workspace-tab-layout.test.ts` 12 条、`explorer-sidebar.spec.ts` + `launcher-tab.spec.ts` 18 条、`explorer-plugin-menu.spec.ts` + `launcher-tab.spec.ts` 15 条（修前）通过，`npm run typecheck` 通过。
- **未推送、CI 未跑：** 本机不跑整套测试（`docs/testing.md`），整套交 CI；本工单没有推送。
