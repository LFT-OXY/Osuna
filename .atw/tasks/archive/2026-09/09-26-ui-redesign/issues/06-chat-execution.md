# 06 — 对话流：执行过程

**What to build:** agent 执行过程更安静：工具调用每项一行（约 26）、可折叠，展开内容缩进并放在浅底等宽框里、有最大高度；思考过程默认折叠为一行；本轮改动文件汇总为一块，显示文件数、±统计与打开 diff 按钮；运行中状态行为低频扫光（分段动画，不可见时暂停，减少动态时静止）。

**Blocked by:** 02 — Text、Row 组件与左侧栏
**Status:** ready-for-agent
**Impl:** done

- [ ] 工具调用、思考、改动文件块的折叠 / 展开在 Web 与原生端都可用（未验证，2026-09-27 用户决定作为已知缺口接受：没有 iOS / Android 模拟器或真机证据）
- [x] 扫光动画在元素不可见时不持续重绘（Web：离屏暂停有 browser 测试；隐藏面板（display:none）与窗口切到后台按代码推断会暂停，没有测试。原生：只在所在面板隐藏时暂停，用户已接受）
- [x] 开启减少动态效果时扫光静止
- [x] 该区域 Electron 桌面端亮色与暗色截图与原型观感一致，截图作为证据附在本票 Comments
- [x] 该区域中断言 CSS 值或几何尺寸的 e2e 已随设计更新，且在 CI 上通过（PR #4 CI 全绿：[run 36259696496](https://github.com/LFT-OXY/Osuna/actions/runs/36259696496)，ac45c5dca）
- [x] testID 与英文 UI 文案逐字未变
- [x] docs/design.md 等设计文档中对应章节已改写（改写过时内容，不在末尾追加）
- [x] typecheck 与 lint 通过

## Comments

### 2026-09-26 — 实现记录与视觉证据

Electron 桌面端证据：
- 启动方式：dev，`FORCE_COLOR=3 PASEO_LISTEN=127.0.0.1:6769 npm run dev --workspace=@getpaseo/desktop`。
  - 数据：`npm run cli -- run --host 127.0.0.1:6769 --provider mock --model ten-second-stream` 在临时 git 仓库里跑一轮。每个循环都有 thinking / read / grep / edit / bash，而且 edit 的都是同一个文件。
  - 截图：Playwright CDP 截图并读计算样式。外观设置的界面字号为 15。
- 亮色：[执行过程（展开的 Edit 与改动文件块）](../evidence/06-electron-light-execution.jpg)、[运行中](../evidence/06-electron-light-running.jpg)
- 暗色：[执行过程](../evidence/06-electron-dark-execution.jpg)、[运行中](../evidence/06-electron-dark-running.jpg)
- 计算样式：
  - 工具行高 27。界面字号 15 时 label 行高 19，加上下内边距 4 + 4；界面字号 14 时为 26，e2e 已断言。
  - 展开框缩进 26px，圆角 8px，底色 `surface2`：亮 `rgb(244, 244, 245)`，暗 `rgb(23, 23, 23)`。描边为 `borderCodeBlock`：亮 `rgb(228, 228, 231)`，暗透明。
  - 改动文件卡片圆角 10px，底色与描边同上。
  - 运行中状态行的扫光：`getAnimations()` 为 `running`，`animation-timing-function: steps(24)`。
- 与原型（`osuna-ui-prototype.html`，截图时仍在会话临时目录）对照：
  - 一致：
    - 工具行最小高 26，图标 14，工具名 + 弱色摘要。
    - 展开内容缩进、浅底加淡描边框、等宽字。
    - 思考折叠为一行。
    - 改动文件块浅底、圆角 10，含文件数、±统计、Open diff。
    - 状态行 "Working for …" 扫光，2.4s 分 24 段。
  - 有差异、保留现状：
    - 展开缩进 26（原型 28），对齐标签轨。
    - 展开最大高度沿用原有的 400 / 300（原型 160）。
    - 卡片头高 40（原型 42）。
    - 原型的 "Show files" 文字链接换成了行首 chevron 与文件列表。
    - 工具名不加粗：design.md 规定 medium 字重只给结构标签。

实现形态：
- 工具行（`ExpandableBadge`，`components/message.tsx`）：
  - 单行最小高 26，文字为 `<Text variant="label">`，图标 14，图标笔画落在正文左轨。
  - 展开内容缩进到标签轨，放进与代码块相同的 `surface2` 框、`borderCodeBlock` 描边、`radius.md`，保留原有的最大高度。
  - 框由工具行负责画，`ToolCallDetailsContent` 通过 `framed` 去掉内部各段自带的边框与底色。
  - 概览分组展开后是一列缩进的子工具行，不加框。
- 思考：沿用同一种工具行，默认折叠（已有设置 "Always expand reasoning" 默认关闭）。
- 改动文件块（`agent-stream/turn-changed-files.ts` + `turn-changed-files-card.tsx`）：
  - 只在已完成回合出现，位置在页脚上方。数据从本轮回复的 edit / write 工具调用汇总，概览模式下会展开分组宿主行。失败和取消的调用不计入。
  - 显示文件数、±统计、Open diff。Open diff 打开 Explorer 的 Changes 视图；非 git 工作区不显示这个按钮。
  - 可展开为文件列表，点击文件会打开该文件。
  - 回合范围由 strategy 新增的 `collectAssistantResponseItems` 给出，复制内容也改由它实现。
- 运行中状态行：新增文案 "Working for {{duration}}"，十个语言都已补上，放在 `<ShimmerText>` 上；`turn-working-elapsed` 仍在这份文字上。`LiveElapsed` 改为 render 函数插槽。
- 扫光模块 `components/shimmer/`：
  - 每秒 10 段（`shimmerSteps`）。
  - Web 端用共享的 IntersectionObserver 加 `visibilitychange`，经 CSS 变量控制 `animation-play-state`。
  - 原生端经 `useRetainedPanelActive` 暂停，进度按段取整。
  - 减少动态效果改由 `hooks/use-reduce-motion-enabled`（Web 端实时读 matchMedia）判断，开启时不画扫光层。
  - 工具行原有的扫光、同一行的 `SyncedLoader` 都改用这套机制。
- `DiffViewer` 的上下文行和 hunk 头不再自带 `surface1` 底色，改由外层容器给。此前框里会多出一层带内边距的"白板"，截图时发现。

审查后由用户确认或作者说明的取舍：
- 改动文件块的数据只能从工具调用推出来：daemon 不记录每轮 diff，PRD 又不允许改 daemon。
  - write 整份内容计为新增。
  - 以 old/new 文本给出的 edit 只剥掉首尾相同的行，一次 edit 改多处时会多算。`docs/design.md` 已写明。
  - Open diff 打开的是工作区当前的全部改动，不是这一轮的。
- 原生端扫光只在所在面板隐藏时暂停。行在列表里滚出屏幕但没被卸载时仍在跑。用户选择接受现状，并写进设计文档。
- 改动文件列表的行没有用 `<Row>`：`<Row>` 的三态取自侧栏角色，叠在 `surface2` 卡片上分不开，所以这些行用 `Pressable` 自己画悬停色（`surface3`）。
- 单复数沿用仓库惯例（one / other 两个 key 加 `{{count}}`），俄语译文改写成不依赖复数形态的句式。

测试：
- 单测：
  - 新增 `agent-stream/turn-changed-files.test.ts`（5 条）、`components/shimmer/timing.test.ts`（3 条）。
  - `render-strategy.test.ts` 新增按回合收集 items 的用例。
  - 连同 i18n、styles 守卫、agent-stream、tool-calls、status-ring，共 32 个文件 301 条，全部通过。
- browser：新增 `components/shimmer/shimmer-text.browser.test.tsx`，覆盖分段节拍、滚出视口暂停与恢复、减少动态效果时不画、运行中切换、文字每秒更新时持续运行。连同 status-ring、assistant-selection-copy 共 45 条，全部通过。
- e2e 本地定向：
  - `agent-stream-ui` 新增 "keeps execution quiet"，覆盖工具行高 26、展开 / 收起、思考默认折叠、改动文件块展开 / 收起、Open diff 打开 Changes。
  - `tool-call-shimmer` 收紧为精确断言 `steps(n)`。
  - 另跑了 `tool-call-overview-sheet`、`agent-consecutive-turns`、`agent-message-submission`。
  - 以上全部通过。"keeps the viewport fixed after the user scrolls away" 在批量运行中失败过一次，单独重复运行都通过，判断为偶发。
  - 全量 e2e 待 CI。

未验证：原生端没有真机或模拟器证据。折叠 / 展开的共享代码路径与 Web 相同，但本票没有原生证据，所以对应验收项没有勾选。

