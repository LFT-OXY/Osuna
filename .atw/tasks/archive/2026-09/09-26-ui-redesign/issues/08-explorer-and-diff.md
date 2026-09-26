# 08 — Explorer sidebar 与 diff

**What to build:** Explorer sidebar 与工作区视觉统一：Files / Changes / Session history 的 tab 使用与工作区 tab 同一套样式；改动文件行（28 高，状态字母、目录淡化的路径、±统计）用 Row，选中行有底色；diff 新增 / 删除行为浅绿 / 浅红底色加 3px 左侧色条，大段未改动内容折叠为"N unmodified lines"分隔，文件头吸顶。

**Blocked by:** 02 — Text、Row 组件与左侧栏；04 — 工作区外框
**Status:** ready-for-agent
**Impl:** done

- [x] diff 统一视图与分栏视图都应用新样式
- [x] 紧凑布局的 Explorer 覆盖层同样应用新样式，无布局回退
- [x] diff 行底色与状态色 token 一致
- [x] 该区域 Electron 桌面端亮色与暗色截图与原型观感一致，截图作为证据附在本票 Comments
- [x] 该区域中断言 CSS 值或几何尺寸的 e2e 已随设计更新，且在 CI 上通过（PR #4 CI 全绿：[run 36259696496](https://github.com/LFT-OXY/Osuna/actions/runs/36259696496)，ac45c5dca）
- [x] testID 与英文 UI 文案逐字未变
- [x] docs/design.md 等设计文档中对应章节已改写（改写过时内容，不在末尾追加）
- [x] typecheck 与 lint 通过

## Comments

### 2026-09-26 — 实现记录与视觉证据

实现中由用户决定的两点：
- hunk 分隔采用原型式纯装饰：标签居中，UI 字体 `micro` 档，`foregroundExtraMuted` 色，两侧等长横线。分隔行不能选中，也不进复制，跨 hunk 复制只得到代码行。原来复制会带上 `@@` 头。
- 不保留 git hunk 头里的函数上下文，只显示行数。

Electron 桌面端证据：
- 启动方式：dev，`FORCE_COLOR=3 PASEO_LISTEN=127.0.0.1:6769 npm run dev --workspace=@getpaseo/desktop`。
- 数据：临时 git 仓库里一个 1500 行文件，在第 400 行附近与第 1300 行附近各改一处；另有一个只改一行的测试文件，和一个新文件。
- 截图方式：Playwright CDP 截图并读取计算样式；紧凑布局在同一连接里把视口模拟成 420 宽。
- 截图文件：
  - 亮色：[整窗](../evidence/08-electron-light-window.jpg)、[Explorer 与 diff](../evidence/08-electron-light-explorer-diff.jpg)、[紧凑覆盖层](../evidence/08-electron-light-compact-overlay.jpg)
  - 暗色：[整窗](../evidence/08-electron-dark-window.jpg)、[Explorer 与 diff](../evidence/08-electron-dark-explorer-diff.jpg)、[紧凑覆盖层](../evidence/08-electron-dark-compact-overlay.jpg)、[Jump to file](../evidence/08-electron-dark-compact-jump.jpg)
- 计算样式（界面字号 15）：
  - Explorer tab：高 26、圆角 8px。当前 tab 底色亮色 `rgb(234, 234, 234)`、暗色 `rgb(28, 28, 28)`，与聚焦 pane 的当前工作区 tab 同一档（`surfaceTabActive`）。其余 tab 透明。
  - 紧凑覆盖层 tab：圆角 8px，当前 tab 为 `surfaceTabActive`，高度保留触屏的 33。
  - 改动文件行：高 28、圆角 8px，两侧收进 6px。
    - 选中行亮色底色 `rgb(234, 234, 234)`、内描边 `rgb(218, 218, 218)`；暗色底色 `rgb(19, 19, 19)`、内描边 `rgb(33, 33, 33)`。
    - 状态字母为 semibold `micro`，分别用 `statusWarning` / `statusSuccess` / `statusDanger`。
- 与原型对照：
  - 一致：
    - tab 形态。
    - 行高 28 与选中底色。
    - 字母颜色。
    - 加 / 删行浅色底加 3px 左侧色条（统一与分栏都有）。
    - 分隔行居中标签加两侧横线。
    - 文件头吸顶。
  - 有差异、保留现状：
    - Changes 保持树形（文件夹行 + 文件行），没有改成原型的扁平列表。PRD 要求布局结构不变，树里的目录由文件夹行给出。
    - 状态字母放在 ±统计之后（原变更图标的位置），原型在行首。行首是文件图标，与 Files 树共用对齐轨。
    - 画布文件头的方框变更图标也换成了同一字母，树行与文件头一致。原型文件头没有这个标记。
    - 选中行带 1px 内描边，与侧栏行共用 `getRowSurfaceStyle`；原型只有底色。
    - 状态字母用 UI 字体 `micro` 档（semibold），与 `<Text>` 阶梯一致；原型是等宽 10px。
    - 加 / 删行底色沿用既有派生（成功色 15%、危险色 10%），原型为 10% / 9%。
    - 分隔行高取代码行高，原型为 26。
    - 最后一个 hunk 之后没有分隔。daemon 不给文件总行数，而 PRD 不允许改 daemon。
    - 文件头高 30，原型为 34。

实现形态：
- Explorer tab（`screens/workspace/explorer-sidebar-tab-rail.tsx`、`components/compact-explorer-sidebar.tsx`）：
  - 改用工作区 tab 的 `surfaceTabHover` / `surfaceTabActive`、`radius.md`，标签用 `<Text variant="caption">`。
  - Explorer 不持有焦点，当前 tab 始终用 active 一档。
  - 状态环挖空的底色跟随 tab 底色。
- 树形行（`components/tree-primitives.tsx`）：Files、Changes 与 Jump to file 共用。
  - 高 28，名称为 `label` 档，两侧收进 6px。收进量从内边距里扣回（`treeRowIndent`），名称仍落在 pane 的前导轨上。
  - hover / 按下 / 选中改用 `getRowSurfaceStyle`。
  - 没有直接渲染 `<Row>`：树行的按下目标是带拖拽、右键菜单的 `ContextMenuTrigger`，按 design.md §12 对"自带按下目标的行"的规定，保留原有结构，状态走同一个 `getRowSurfaceStyle`（与工作区行、项目行相同）。
- Changes 下方的 Commits 区：提交行（`git/commits-section/commit-row.tsx`）同样为 28 高、两侧收进 6px、`getRowSurfaceStyle` 悬停底色，主题行与分区标题改为 `label` 档。收进量从内边距扣回，提交图节点位置不变，轨道仍按原行距连续。
- 状态字母：
  - `FileChangeBadge`（原 `FileChangeIcon`）保留 image 角色与原无障碍名（Modified / New / Deleted）。
  - 字母与状态色集中在 `diffFileChangePresentation`（`git/file-header-presentation.ts`），树行与 web / 原生画布文件头共用。
- diff 行：
  - `createDiffPalette` 读主题角色 `diffAddition*` / `diffDeletion*`。
  - web 与原生都在单元格左缘画 3px 色条，只覆盖文字高度，不覆盖评审区。
- 分隔行：
  - 新行类型 `DiffSeparatorRow`，与 status 行同级，不是 line 行，因此不参与命中、选区与复制。
  - `DiffCell` 去掉了 `"header"` 类型和随之失效的分支。
  - 行数取旧侧行号间隔：`@@ -0,0` 与从第 1 行开始的 hunk 不画分隔。
  - 几何在 `diffSeparatorLayout`（`palette.ts`），web 与原生共用。原生画在不随横向滚动的固定层，标签用头部排版（UI 字体）。
- 文字与图标 token：
  - 树行名称、提交行主题、Commits 标题改为 `<Text variant="label">`。
  - 有两处渲染不了 `<Text>`，直接读 `typeScale`：Files 树的新建 / 重命名输入框（`draftInput` 字号取 `label` 档，与相邻行名一致），以及画布文件头与分隔标签（`headerTypography.microSize`）。先例是 `<Row>` 前置槽取 `label` 行高。
  - 碰到的文件里 14 / 16 的图标尺寸换成 `ICON_SIZE`，包括 `tree-primitives.tsx` 的两个树图标常量。紧凑覆盖层 PR tab 图标的 13 不在 `ICON_SIZE` 刻度内，保持原值（与工单 04 对 11 的处理相同）。
- 新文案 `workspace.git.diff.unmodifiedLine` / `unmodifiedLines`：九个语言都已补上，模型文案由 `git/diff-document/labels.ts` 统一构造。

测试：
- 单测：
  - `model.test.ts` 覆盖统一与分栏的分隔标签、文件开头与新文件不画分隔、分隔行不计入文字行。
  - `hit-testing.test.ts`：分隔行不被命中，全选与分栏全选不含分隔。
  - `paint.web.test.ts`：色条、评审区不画色条、分隔几何与标签、文件头字母。
  - `workspace-cache.test.ts`：切换语言后分隔文案失效。
  - `palette.test.ts`：diff 调色板读主题角色。
  - 连同 `git`、`components`、`styles`、`i18n` 等目录，共 180 个文件 1458 条，全部通过。
- browser：`components/ui/row`、`components/ui/text` 共 27 条，通过（树行复用的行状态规则与 `label` 档）。
- e2e 本地定向：
  - 新增 `explorer-sidebar.spec.ts` "draws its tabs as workspace tab chips"：高 26、圆角 8、当前 tab 与聚焦 pane 当前 tab 同色、其余透明。
  - 新增 `changes-pane.spec.ts` "changes tree rows are 28px and the selected row keeps a fill and ring"。
  - `changes-pane.spec.ts` 的选区辅助函数按新几何更新。这些夹具从已提交的空文件改起，hunk 从第一行开始，不再有分隔行，第一行改动就是正文第一行。
  - 最终改动后跑了 `changes-pane`、`explorer-sidebar`、`file-explorer-context-actions`、`file-explorer-collapse`、`commit-diff-panel`，共 49 条，48 条通过。
    - 失败的 1 条是 "creates, renames, copies, and deletes entries through the file explorer"（`toBeVisible`）。单独运行通过；整个文件重复 2 次，10/10 通过。判断为批量运行时偶发。
  - 更早一轮里，"changes diff waits for configured fonts…" 在批量中失败过一次（设置页字体输入的 `toHaveValue`），单独重复 2 次都通过。
  - 另跑过 `add-changed-file-to-chat`、`explorer-surface-upgrade`、`changes-shortcut-placement`，全部通过。
  - 全量 e2e 待 CI，对应验收项没有勾选。

检查：`packages/app` 的 typecheck（`tsgo --noEmit`）无错误；改动文件的 lint 为 0 warning、0 error；改动文件已逐个用 `format:files` 格式化。全仓 typecheck 在本机会被 `packages/cli` 的已知 tsgo 退化拦下，交给 CI。

未验证：原生端没有真机或模拟器证据。原生分隔行与色条的绘制代码只经过 typecheck。

