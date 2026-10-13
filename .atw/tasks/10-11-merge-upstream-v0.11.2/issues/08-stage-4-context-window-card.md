# 08 — 第四段的适配：上下文圆环悬浮卡

**What to build:** 鼠标停在上下文圆环上出现的是上游的悬浮卡，外观是 Osuna 的，内容是两边的并集：上下文占用、本智能体的 token 与估算花费、用时（进行中的轮次在走表）、当前接口、这个智能体所用账号的套餐用量。圆环在智能体第一轮之前就显示。连的是不支持 Usage 的旧 daemon 时，卡里提示需要升级主机。会话花费只显示一处，数据来自 Osuna 的 Usage 统计。Osuna 原来「按提供方」的那段套餐用量不再保留，换成上游「按账号」的。刷新按钮等上游在第 6 段才定型的部分留给 12 收尾。规格见 `prd.md` 的「上下文圆环」「UI and Design」，以及 `docs/floating-panels.md`、`docs/hover.md`、`docs/design.md`。

**Blocked by:** 06
**Status:** ready-for-agent
**Impl:** done

- [x] 悬浮卡里有：上下文占用百分比与 token 数、本智能体的 token（输入与输出）、估算花费、用时、当前接口。Osuna 原提示里的每一项都在，清单与对照记在 `## Comments` 下。
- [x] 进行中的轮次，用时在走表；轮次结束后停在结算值。
- [x] 会话花费只出现一处，取 Osuna 的 Usage 统计；上游那一行不重复显示。
- [x] 主机不支持 Usage（旧 daemon）时卡里有升级主机的提示；主机状态未知时不显示这一段。
- [x] 套餐用量一段是上游按智能体所用账号的显示；文案写「套餐用量」。
- [x] 圆环在智能体第一轮之前显示；圆环旁的 token 标签仍按 Osuna 的设置显示。
- [x] 悬浮按 `docs/hover.md` 的写法；浮层按 `docs/floating-panels.md`；原生端与窄屏上能通过点按打开同样的内容。
- [x] 上下文圆环的工具函数测试与组件测试：上游的用例通过；Osuna 的 token、花费、用时、升级提示用例在新结构上通过。断言的改动只限于结构变化所必需的，逐条记在 `## Comments` 下。
- [x] 实施中发现两边在同一项上结论相反（同一个数两边算法不同、同一状态两边显示相反）时没有自行取舍：已停下来问过维护者。
- [x] 界面语言为中文时卡里没有残留的英文；翻译资源测试通过。
- [x] typecheck 和 lint 通过；改动涉及的测试文件逐个跑过并通过。
- [x] UI：上下文圆环悬浮卡 / 智能体有历史 / 桌面 1280 — 卡里同时有上下文占用、token 与估算花费、用时、当前接口、套餐用量；圆角、底色、阴影与 Osuna 其他浮层一致。
- [x] UI：上下文圆环 / 新会话第一轮之前 / 桌面 1280 — 圆环已显示，悬浮卡能打开。
- [x] UI：上下文圆环悬浮卡 / 主机不支持 Usage / 桌面 1280 — 卡里有升级主机的提示。做不出这个状态时写明原因，以组件测试为证。

## Comments

**起点。** 06 已把圆环换成上游的结构（`context-window-meter.tsx` 的圆环本体 + 桌面 `HoverCard` / 原生宽屏 `Tooltip` / 窄屏 `ContextWindowSheet`，详情在 `context-window-details.tsx`），并把 Osuna 的本会话合计、当前接口一行、圆环旁的 token 标签接了回去。08 做的是外观、测试、文案与截图的收尾。

**Osuna 原提示里的每一项 → 现在在哪（对照合并前 `802b17d8c` 的 `context-window-meter.tsx` 与 `provider-usage/tooltip-section.tsx`）。**

| Osuna 原提示里的内容 | 现在 |
| --- | --- |
| 「上下文窗口」小标题 | 在，卡里第一段的小标题（窄屏抽屉里由抽屉标题承担） |
| 占用百分比（大号数字 + 「已使用」+ 进度条） | 在，按上游写成一行「已使用 25%」；大号数字与进度条不再画——圆环本身就是这根进度条，上游用例按整句「25% used」定位 |
| Token「已用 / 上限」一行 | 在，「32k / 128k Token」（数字写法见下面「问过维护者的一处」） |
| 本会话合计：Token ↑↓ | 在，`context-window-session-total` 第一行 |
| 本会话合计：估算成本 | 在；全卡只有这一处花费 |
| 本会话合计：轮次（进行中写「N + 进行中」） | 在 |
| 本会话合计：Agent 运行（进行中每秒走表） | 在 |
| 本会话合计：会话跨度（两端都已知才有） | 在 |
| 扫描未完成时的「不完整」标记 | 在 |
| 旧 daemon 的「需要更新主机」 | 在；主机还没说支不支持时整段不出现 |
| 当前接口一行（该提供方启用第三方接口时） | 在，位置沿用 06：本会话合计之后、套餐用量之前，主机不报告套餐用量时也显示（合并前它在按提供方的套餐卡片里、没有额度就不出现；维护者 2026-10-12 定为保持 06 的做法） |
| 按提供方的套餐用量段 | 按规格换成上游按账号的 `AgentUsage` |
| 圆环旁的 token 标签（跟随设置，手机不显示）与悬停变深 | 在；悬停变深在 06 随旧结构丢掉，这次补回 |
| 宽屏左右两栏 / 窄栏可见时不重复套餐用量 | 06 已按规格去掉：新结构是单栏，套餐用量段常在 |
| 卡片右缘对齐圆环（`align="end"`） | 在；06 换成上游的居中后卡片会伸出输入框右缘，这次改回 `alignment="end"` |

**这张工单改了什么。**

- **外观。** 悬浮卡（以及原生宽屏的提示）改用 Osuna 的浮层外框 `popoverSurfaceStyle(theme, { glass: false })`：圆角 `radius.lg`、1px `border`、`shadowPopover` 投影、暗色的顶部内高光，不透明。内边距与段间距都是 `spacing[3]`。上游的两种形状（`plainPopover` 窄内边距无间距 / `usagePopover`）合成一种，06 备注的「本会话合计紧贴上下文段」随之消失；主机报告套餐用量时卡宽 300，否则随内容。只在 `context-window-meter.tsx` 里覆盖，没有改上游的 `ui/hover-card.tsx`。脚本读到的实际样式（Light）：底色 `rgb(255, 255, 255)`、边框 `1px rgb(228, 228, 231)`、圆角 `10px`、投影 `rgba(0, 0, 0, 0.35) 0px 16px 40px -18px`、内边距 `12px`、宽 300；卡片右缘 x=1135，与圆环触发区右缘相同。
- **三段同一种小标题。** 「上下文窗口」「本会话合计」「套餐用量」都是 `micro` / `medium` / `foregroundMuted`（`rgb(113, 113, 123)`）；上下文段的文字改用共用 `<Text>` 的 `body` 与 `caption`，不再用上游的裸 `Text` + 字号。「套餐用量」小标题经 `AgentUsage` 新增的可选 `renderHeader` 画在分隔线之后（上游文件里加了一个 prop 和一行渲染，标了 Osuna），整段不出现时它也不出现。
- **token 标签悬停变深补回。** 按 `docs/hover.md`：`HoverCardTrigger` 里那个普通 `View` 上加 `onPointerEnter` / `onPointerLeave`，只换颜色，不动尺寸。
- **zh-CN 文案。** `usage.planUsage` 下同一张卡用的三句由「用量」改为「套餐用量」：`loading`「正在加载套餐用量…」、`empty`「暂无套餐用量数据」、`errorTitle`「无法加载套餐用量」（术语表：用量只指 token 与花费）。其余八种语言不动——英文的「Loading usage...」有上游用例钉着，其余语言的叫法归 11。
- **`resolveSessionTotal` 搬到 `usage-stats/turn-usage.ts`。** 「主机未知 / 不支持 / 有数据 / 扫描器不读的提供方」这几种情况原来是详情文件里的私有函数，没有测试；搬到 Osuna 的用量模块、改成对象参数后在 `turn-usage.test.ts` 里逐条断言。行为不变。

**问过维护者的一处（同一个数两边写法不同）。** 圆环旁的 token 标签是 Osuna 的写法「32.0K / 128.0K」（`formatUsageTokensCompact`），卡里「已用 / 上限」一行是上游的写法「32k / 128k」（`formatTokenCount`）。维护者 2026-10-12 的决定：**保持现状，各用各的**，不改上游的代码与测试。没有发现别的两边结论相反的地方：会话花费按规格只留 Osuna 的；「主机不报告套餐用量」（上游，整段不显示）与「主机不支持 Usage」（Osuna，提示更新主机）说的是两项不同的主机能力。

**测试。**

- `usage-stats/turn-usage.test.ts`：新增 `resolveSessionTotal` 五条（先红后绿：导出不存在）；`summary()` 夹具从 `resolveSessionSpanMs` 的 describe 里提到文件顶层共用，原有断言不变。26 条通过。
- 新文件 `e2e/browser/context-window-session-total.spec.ts`（在现有的 browser 项目与 CI 作业里，没有新建套件）三条。mock 智能体没有真实用量行，用新辅助 `e2e/support/helpers/agent-usage.ts` 的 `installAgentUsageSummaryFixture` 代答 `usage.agent.get`，并可给提供方快照里的 mock 提供方挂上启用中的第三方接口；套餐用量来自上游的 `installLoginUsage`（daemon 侧的真插件）：
  - 「the context details add the agent's session total and API endpoint to its context and plan usage」：卡里同时有「25% used」、本会话合计（标题 + Token、估算成本、轮次、Agent 运行、会话跨度五行按行精确比对）、当前接口一行的整句、「Plan usage」小标题与账号卡片；全卡提到花费的只有「Estimated cost」「$1.23」各一处。先红后绿（缺小标题）。
  - 「the agent runtime ticks while a turn runs and settles when it ends」：进行中轮次显示「3 + running」，`page.clock.fastForward` 快进 60 秒后 Agent 运行至少多 60 秒；停止后回到「3」与 daemon 给的「12m 34s」。这是 06 已有的行为，写下来就是绿的。夹具始终答同一份合计，所以它证明的是停表，**没有证明** `usage.updated` 到达后重新取数——试过由夹具推一条 `usage.updated`，到不了 `observeEvents` 的订阅方，没有继续追。
  - 「the context details are in Chinese when the interface is」：zh-CN 下小标题、已使用、合计五行、当前接口整句、「套餐用量」都是中文。
- 上游的 `context-window-meter.spec.ts` 10 条、Osuna 的 `turn-usage-old-daemon.spec.ts`（旧主机的「Update host」）与 `context-window-token-label.spec.ts`：**文件没有改动，断言一条没改**，全部通过（本机 `--project=browser`，四个文件共 15 条）。
- `i18n/resources.test.ts`、`provider-usage/format.test.ts`、`usage-stats/format.test.ts` 通过；`npm run typecheck`、改动文件的 `npm run lint` 通过。
- 没有跑的：整套测试（按仓库规定交给 CI）；`turn-usage.claude.real.spec.ts`（要真实的 Claude 登录，本机不测登录）；原生端。

**截图（`screenshots/08-*`，逻辑视口 1280×800、2 倍像素比拍下后缩到 1600 宽存档，Light，zh 与 en 各一套）。** 由一个一次性的 Playwright 脚本取自无头 Chromium 对真实应用 + 隔离 daemon（脚本用的就是上面的辅助，拍完已删，没有提交），不是 dev 桌面端窗口：mock 智能体没有 token 统计，dev 桌面端要拍「有历史」得跑一轮真实的 Claude / Codex，截图还会带上真实的套餐百分比（仓库是公开的）；另外 Electron 的 CDP 截图会结束悬停状态。卡片是同一份 Web 代码，Electron 里的整体过一遍归 14。数据是造的：合计与第三方接口「Acme Gateway」由夹具代答，套餐用量来自测试插件（来源名「Claude」、档位「Max」、窗口名「Session / Weekly」是插件给的数据，不走翻译）。

- `08-context-window-card-history-desktop-1280-{zh,en}`：上下文占用、本会话合计（Token、估算成本、轮次、Agent 运行、会话跨度）、当前接口一行、套餐用量（带刷新）。
- `08-context-window-card-before-first-turn-desktop-1280-{zh,en}`：第一轮之前圆环已在（空环），卡里「暂无上下文数据」+ 套餐用量。
- `08-context-window-card-host-without-usage-desktop-1280-{zh,en}`：`publishedVersion: "0.8.0"` 的隔离主机，卡里「本会话合计 / 需要更新主机」。

**原生端免验收**（无原生端模拟环境）：原生宽屏的提示与窄屏抽屉渲染的是同一个 `ContextWindowDetails`；窄屏抽屉由上游的 compact 用例在 390 宽下点开过。

**留给 12 的。** 套餐卡片本身（`usage/card.tsx`：刷新按钮、账号行、两张卡之间的间距）是上游在第 6 段才定型的，这次没有动。

**评审（Standards / Spec / Visual 各一轮，修一轮，只复查修过的）。**

- **已修（Standards 硬违规）：** JSX 经 prop 传递（`header` 节点 → `renderHeader` 函数 + `useCallback`，`component-guidelines.md`）；`resolveSessionTotal` 三个位置参数含布尔 → 对象参数，条件里的子句起了名字（`docs/coding-standards.md`）；`context-window-meter.tsx` 三元分支里的数组字面量去掉；e2e 辅助改用 `loadSessionMessageReaders()` 按协议 schema 读帧，不再自己 `JSON.parse`。
- **已修（Standards 判断项，顺手）：** zh-CN 同一张卡的三句一起改；失真的分隔线注释；新用例从 `context-window-token-label.spec.ts` 搬到名字对得上的新文件，原文件恢复原样；走表用 `page.clock.fastForward` 不等真实时钟；合计各行加 `context-window-session-total-row`，不再按 DOM 结构定位；两条用例重复的准备步骤收进 Playwright fixture。
- **已修（Spec）：** 「当前接口」原先没有任何证据——补了用例与截图。评审指出我把这一行挪进套餐用量段是规格没要求的行为变化（主机不报告套餐用量时它会消失）——**撤回，位置回到 06 的做法**。「轮次结束后停在结算值」证据偏弱——试过加强，没做成，如实写在上面的测试记录里。截图尺寸与来源的说法按实际改写。
- **已修（Visual，Standards 也报了）：** 三段小标题太淡（`foregroundExtraMuted` 按 `docs/design.md` §3 只给被动的界面装饰）→ `foregroundMuted`；卡片右缘伸出输入框约 60px → `alignment="end"`。六张截图在修后全部重拍。
- **复查：** 重拍的六张看过，小标题读得清、卡片右缘与圆环对齐、当前接口一行在；四个浏览器用例文件 15 条、三个单测文件 75 条在修后重跑通过；typecheck 与改动文件的 lint 通过。
- **评审后仍开着、问过维护者的三项（2026-10-12，三项都按现状）：**
  1. 截图取自无头 Chromium 而不是 dev 桌面端（原因见「截图」）——**接受**，Electron 里的实看归 14。
  2. 「轮次结束后停在结算值」的用例只证明停表、没有证明 `usage.updated` 之后的重新取数——**按现状提交**，14 在桌面端实看时顺带确认。
  3. 当前接口一行的位置——**保持 06 的做法**：独立一行，只要该提供方启用了第三方接口就显示，主机不报告套餐用量时也显示。
- **判断项，照原样提交并告知维护者：**
  1. 原生宽屏的提示用了卡片的 `radius.lg`，`docs/design.md` §6 写提示是 `radius.md`——它装的是一张卡而不是一两行字，合并前 Osuna 也是 `radius.lg`。
  2. 第一轮之前的空环只有一圈 `surface3` 的轨道，Visual 认为像禁用态（上游的画法；合并前 Osuna 这时不显示圆环）。
  3. 旧主机的「需要更新主机」是一行普通的次要文字，Visual 认为太弱、没说明后果（合并前就是这样，有现成用例钉着文案）。
  4. 英文下「Session total / Session span」与套餐窗口名「Session」同卡撞词；「已使用 25%」比各行大一档。都是既有文案与上游的层级，没有动。
