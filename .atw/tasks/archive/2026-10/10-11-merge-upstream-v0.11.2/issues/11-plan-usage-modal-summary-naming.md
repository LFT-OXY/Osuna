# 11 — 套餐用量最终形态（一）：弹窗、侧栏摘要与叫法

**What to build:** 上游的三样东西在 Osuna 里是完整可用的，并且用 Osuna 的叫法与外观：点侧栏底部图标出现「套餐用量」弹窗，桌面上是对话框、窄屏上是底部抽屉，里面能选主机、全部刷新、看到每个账号的额度窗口，来源不可用时写明原因；设置 → 侧边栏里有「套餐用量摘要」开关，打开后侧栏底部常驻显示固定的额度窗口百分比，没数据时自动隐藏；用户能选百分比显示已用还是剩余。整个应用里「用量」只指 token 与花费，「套餐用量」只指订阅额度。规格见 `prd.md` 的「套餐用量」「叫法」「侧栏」「UI and Design」，以及 `docs/design.md`、`docs/floating-panels.md`、`docs/i18n.md`。

**Blocked by:** 10
**Status:** ready-for-agent
**Impl:** done

- [x] 弹窗标题、侧栏底部图标的提示、设置 → 侧边栏的开关（「套餐用量摘要」）、偏好项的说明、空状态与错误文案都写「套餐用量 / Plan usage」，九种语言沿用 Osuna 已有的译法，zh-CN 是真实翻译。代码里上游的命名没有改。
- [x] zh-CN 下全应用标着「用量」的入口只有 Usage 页一个；用 `rg` 在翻译资源里核对过上游新增的键，结果记在 `## Comments` 下。
- [x] 上游为弹窗与侧栏摘要带来的测试（模型、固定窗口、偏好、文案、浏览器用例）通过；因叫法而改的文案断言逐条记在 `## Comments` 下。
- [x] 弹窗：能选主机；全部刷新可用；某个来源不可用时显示原因；没有已连接的主机时显示对应的说明。
- [x] 弹窗里的确认或操作按钮按 Osuna 的对话框写法（按钮在页脚、按自身宽度靠右），`testID` 不动。
- [x] 侧栏摘要：默认关闭；打开后显示固定窗口的来源图标与百分比；没有可显示的数据时隐藏，底部图标仍在；点摘要与点图标打开的是同一个弹窗。
- [x] 已用 / 剩余的偏好能切换，弹窗与摘要同时跟着变。
- [x] 设置 → 侧边栏的底部条目一组与同页其他设置项外观一致。
- [x] 连的是没有 `features.usageSources` 的旧 daemon 时，弹窗按上游的做法提示升级主机，没有回退路径。
- [x] 术语表与 03 写下的词条一致；这一段上游若又改了术语表里套餐用量的词条，已按同一原则收进来。
- [x] 翻译资源测试通过。
- [x] typecheck 和 lint 通过；改动涉及的测试文件逐个跑过并通过。
- [x] UI：套餐用量弹窗 / 有数据 / 桌面 1280 — 标题是「套餐用量」，每个账号一张额度卡；弹窗的圆角、底色与 Osuna 其他对话框一致，卡片是 Osuna 的卡片样式。
- [x] UI：套餐用量弹窗 / 某个来源不可用 / 桌面 1280 — 卡上写明原因。本机做不出这个状态时写明原因，以上游的测试为证。
- [x] UI：套餐用量弹窗 / 窄屏 390 宽（桌面端把窗口缩窄） — 是底部抽屉，内容不被裁掉。
- [x] UI：侧栏 / 摘要打开且有固定窗口 / 桌面 1280 — 底部显示来源图标与百分比，位置在图标行上方。
- [x] UI：设置 → 侧边栏 / 桌面 1280 — 有「套餐用量摘要」开关。
- [x] UI：界面语言为中文 — 弹窗、摘要、设置项里没有残留的英文，也没有把订阅额度写成「用量」的地方。

## Comments

### 来自 10 的交接（2026-10-12）

- **弹窗标题已经是「套餐用量 / Plan usage」。** 上游的 `usage/usage-modal.tsx` 用 `builtinSidebarNavLabelKey("usage")` 取标题，Osuna 的这个函数必须说明取哪一组，10 为了通过 typecheck 写成了 `("usage", "footer")`。标题之外的叫法、侧栏摘要与外观都没有动，仍在这张工单。
- **10 之后已经按 Osuna 叫法通过的上游用例**（改写处见 10 的「按 Osuna 决定改写的上游测试」）：`e2e/browser/usage-modal.spec.ts`「Usage Settings cog」四条里齿轮的无障碍名称是 `Plan usage options`；`e2e/browser/usage-sidebar-item.spec.ts` 里设置 → 侧边栏的底部条目叫 `Plan usage summary`。这张工单再改文案时，这两处的期望值跟着改。
- **「Usage Settings cog desktop light / dark」本机偶发**：7 次里 2 次、另一轮 12 次里 1 次，挂在 `closeUsageOptions`（`e2e/support/helpers/usage-sidebar-item.ts`）读不到刚打开的选项浮层的位置——浮层打开后自己又收起了；窄屏两条稳定。Osuna 对 `adaptive-modal-sheet.tsx`、`dropdown-menu.tsx` 相对上游只有外观改动，没有查到原因。做弹窗外观时在 dev 桌面端手动试一下「切换已用 / 剩余后再打开齿轮菜单」会不会自己收起。CI 第二轮（run 38227801363）在 Linux 上也撞到一次同样的现象：`usage-sidebar-item.spec.ts:173`「a reload keeps the pins and the toggle」这一步（上游原样）首跑挂在同一处、重试通过，所以不是本机环境问题。

### 实现记录（2026-10-12）

**现状。** 开工时弹窗标题、底部图标的提示、设置 → 侧边栏的开关、选项菜单与空状态 / 错误文案已经是「套餐用量 / Plan usage」（03、05、10 做的）。这张工单补的是额度卡片与侧栏摘要里还没走翻译的几处，并核对外观。

**新走翻译键的文案（上游 `usage/` 里的英文字面量，英文输出与上游逐字相同）。**

- `format.ts`：`69% left` → `usage.planUsage.percentLeft`（新键）；`resets 2h` / `resetting now` → 已有的 `resets` / `resettingNow`。新增 `formatRunsOutLabel`，用已有的 `runsOut`。
- `window-bar.tsx`：上游从「resets 2h」里截字拼出「runs out 2h」，文案走翻译后不能再截，改用 `formatRunsOutLabel`。**行为上与上游有一处不同**：用完时间已过（或无效）时，上游显示红色的「runs out resetting now」/「runs out」，现在退回显示重置时间、不标红——与 Osuna 原来的额度卡片（`provider-usage/format.ts` 的 `resolveWindowTrailing`）一致。
- `balance-bar.tsx`：`$42.50 left` → 已有的 `balanceLeft`。
- `card.tsx`：状态字 `Error` / `Unavailable` → 已有的 `status.error` / `status.unavailable`。
- `pinned.ts`：侧栏摘要里每个窗口的无障碍说明（`Claude Session 31% used` / `… left`）→ 新键 `summaryWindowUsed` / `summaryWindowLeft`。`resolvePinnedUsage` 多一个可选的第三个参数 `t`：结果被 `useUsageSummary` 缓存，hook 传入 `useTranslation()` 的 `t` 并列进依赖，切换语言后才会重算。
- `sidebar-item.tsx`：摘要整行的无障碍名称原来在代码里用 `: ` 和 `, ` 拼，改走 `usageCopy.summary`（新键 `summaryLabel`、`summarySeparator`），中文下是「套餐用量：Claude Session 已用 31%，Codex Weekly 已用 12%」。
- `copy.ts`：新增 `usageCopy.ago`，把「3h」「now」按界面语言写成「3 小时前」「刚刚」（复用 `usage.common.time.*`），用在「登录已过期（…）」与「更新于 …」。上游的 `formatCompactTimeAgoAsProse` 是共用工具（工作区标签的悬浮提示也用），没有动。
- `options.tsx`：「已用 / 剩余」两个选项的标签原来在模块加载时取一次，切换界面语言后不跟着变；改成组件里用 `useTranslation` 取。`testID` 不变。`usageCopy.displayUsed` / `displayRemaining` 因此没有调用方，已删。
- 九种语言各加五个键（`percentLeft`、`summaryWindowUsed`、`summaryWindowLeft`、`summaryLabel`、`summarySeparator`）。
- zh-CN 另改四处：`hostUnavailable` / `hostUpgradeRequired` 里的「提供方用量」→「套餐用量」（「提供方用量」进了 `zhCNRetiredTermPattern`）；`showInSidebar` / `showInSidebarHint` 的「侧栏」→「侧边栏」（与设置页一致）；`updated` 由「更新于 {{ago}}」改成「{{ago}}更新」（「更新于 刚刚」不通顺；Osuna 的 Usage 页卡片也用这个键，读作「3 分钟前更新」）。
- **其余八种语言的九句提示改成「套餐用量」的说法（维护者 2026-10-12 决定，见下「评审与决定」）**：`refreshFailed`、`connectHostToSee`、`updateHostToSee`、`agentError`、`loading`、`empty`、`errorTitle`、`hostUnavailable`、`hostUpgradeRequired`。英文由 `… usage` / `… provider usage` 改成 `… plan usage`；es、fr、ja、ko、pt-BR、ru、ar 用各自 `title` 的那个词。
- `resources.test.ts` 的 `migratedSourceLiterals.planUsage` 追加 `resetting now`、`resets `、`runs out `、`Unavailable`。

**没有翻译、照原样显示的。** 窗口名（Session、Weekly、Extra usage）、套餐档位（Max、Pro）、来源名、账号、短窗口名（5h、wk）、来源返回的错误原文（`Request failed: 503 …`）都是 daemon / 插件给的，按 `docs/i18n.md` 不翻译。时长单位 `2h` / `3d` / `45m` 保持缩写，与 Osuna 原来的卡片一致。超过一周的时间上游工具写成英文月份（`Jan 15`），中文下会出现「登录已过期（Sep 20）」；那个工具是共用的，没有在这张工单里改。

**zh-CN 下标着「用量」的入口（`rg -n "用量" zh-CN.ts | rg -v 套餐用量`，改后 8 行）。** `sidebar.sections.usage`「用量」（顶部条目，唯一的入口）、Usage 页标题「用量」、轮次页脚「本轮用量」两条、Usage 页内的「项目用量」「此周期没有用量」「无法加载用量数据」两条——都指 token 与花费。说订阅额度的没有一处写成「用量」。英文里除 Usage 页与轮次页脚之外，值里带 usage 的只剩 `apiEndpointNote` 的「actual usage」（说的是实际消耗）与 macOS 的「high CPU usage」。`packages/client` 抛出的 `Update the host to see usage.` 是上游客户端的报错原文，不是界面文案，没有动。

**因叫法而改的文案断言（供 15 写 PR 正文）。** 都只是把期望的英文换成新文案，没有删用例、没有放宽。

- 上游的：`usage/model.test.ts` 4 处（`Update Laptop to see usage` → `… to see plan usage`；`Connect to Laptop to see usage` → `… plan usage`；`Unable to load usage: Unknown agent` ×2 → `Unable to load plan usage: …`）；`e2e/browser/usage-modal.spec.ts` 1 处（`/^Update .+ to see usage$/` → `… to see plan usage$/`）；`e2e/browser/context-window-meter.spec.ts` 6 处（`Loading usage...` ×5 → `Loading plan usage...`；`Unable to load usage: Unknown agent` → `Unable to load plan usage: …`）；`e2e/browser/usage-settings.spec.ts` 2 处（仍是 02 标的 `describe.skip`，为了不留旧文案一并改）。
- Osuna 自己的：`provider-usage/format.test.ts` 5 处（`Loading usage...`、`No usage data`、`Unable to load usage`、`Connect to this host to see provider usage`、`Update the host to see provider usage` → 各自的 plan usage 写法）。
- 10 记下的两处仍然有效：齿轮叫 `Plan usage options`，底部条目叫 `Plan usage summary`。
- 上游其余的断言（`69% left`、`Unavailable`、`Updated 2h ago`、`Claude Session 31% used`、`/Claude .*69% left, Codex .*88% left/` 等）原样通过。

**新加的用例（都加在上游已有的测试文件里）。** `format.test.ts`：按已用 / 剩余写百分比（英、中）、重置与用完的说法（英、中）、用完时间已过时不返回；`pinned.test.ts`：摘要窗口的无障碍说明按界面语言写；`copy.test.ts`：中文下「登录已过期（3 小时前）。运行 claude 以刷新登录。」、摘要整行的名称按语言的标点拼接；`model.test.ts`：中文下「3 分钟前更新」等。

**验证（本机）。**

- `npm run typecheck`、改动文件的 `npm run lint` 与 `format:check:files` 通过。
- 单元测试（最后一轮）：`src/usage/`、`src/provider-usage/`、`src/i18n/`、`src/components/usage`、`src/components/context-window*` 共 13 个文件 182 条通过；`src/sidebar-nav` 22 条在改文案之前跑过，之后没有再动它依赖的文件。
- Playwright（`--project=browser`，最后一轮）：`usage-modal`、`usage-sidebar-item`、`context-window-meter`、`usage-page-plan-usage`、`composer-plan-usage-strip` 44 条全部通过，含「Usage Settings cog desktop light / dark」。`sidebar-nav-settings` 在第一轮跑过：12 条里 2 条是断言 `Ctrl+O` / `Ctrl+N` 的已知本机问题（macOS 上是 ⌘），只在 CI 验。
- 整套测试没有在本机跑，这张工单也没有推送；CI 结果随 12 的推送一起看。

**逐条验收的依据。**

- 能选主机 / 全部刷新 / 来源不可用写明原因：`usage-modal.spec.ts` 的「a host picked in the Usage modal…」「refreshes one report…」「Usage Settings cog…」「opens from the sidebar…」「expired login…」「an account with all logins failing…」。没有已连接的主机：`usage-modal.tsx` 在选不出主机时显示 `usage.planUsage.noHosts`（zh-CN「没有已连接的主机」），`model.test.ts` 有「没有主机时不选主机」的用例；浏览器用例里 daemon 始终连着，这个状态没有截图。
- 弹窗里没有确认类按钮：标题行右侧是主机筛选、全部刷新、齿轮三个工具按钮（与工作区工具栏同一个 `ToolbarButton`），整页加载失败时的「重试」在 `<Alert>` 里用 `outline` 小按钮（`docs/design.md` 对可恢复错误的规定）。所以没有需要挪到页脚的按钮，`testID` 都没动。
- 摘要默认关闭、没数据时隐藏而图标仍在、两个入口开同一个弹窗：`sidebar-nav/model` 的默认值（03）与 `usage-sidebar-item.spec.ts` 的「without summary data…」「both compact footer entry points…」「on desktop Usage opens as a dialog…」。
- 已用 / 剩余切换后弹窗与摘要同时变：`usage-sidebar-item.spec.ts`「pinned windows show in the sidebar, follow the used/remaining toggle and persist」，加截图 `11-plan-usage-modal-remaining-*`。
- 旧 daemon：`usage-modal.spec.ts`「tells the user to update a host without usage support」，加截图 `11-plan-usage-modal-host-needs-update-*`。代码里没有回退路径。
- 术语表：上游这一段（v0.11.0）的三条词条 10 已按同一原则收进来，逐条对过上游原文；这张工单只在 **Plan usage** 一条的 UI 说明里补上弹窗。

**10 留下的「齿轮菜单偶尔自己收起」。** 用一次性的 Playwright 用例在桌面 1440 宽连续做 40 次「打开齿轮菜单 → 切换已用 / 剩余 → 在 50 / 150 / 300 / 600 毫秒各看一次」，菜单一次也没有收起。所以不是用户能碰到的收起。推测（没有证实）：菜单内容变宽后浮层重新定位（`menu-overlay.tsx` 在重新测量时把位置清空、换 key 重挂），上游辅助函数 `closeUsageOptions` 正好在那一帧读位置读到空。上游的辅助函数与菜单引擎都没有改；CI 上再出现时按偶发重跑。

**截图（`screenshots/11-*`，14 张）。** 来源：`packages/app` 下的一次性 Playwright 用例（无头 Chromium、1280×800 与 390×844、`deviceScaleFactor: 2`、隔离 daemon、e2e 夹具造的假数据），拍完已删除脚本。没有用 dev 桌面端：弹窗里是真实账号的套餐档位与百分比，仓库是公开的；「来源不可用」「主机要升级」两个状态本机真实数据也造不出来。Electron 里的实看留给 14。

- `11-plan-usage-modal-data-desktop-1280-{zh,en}`：标题「套餐用量」，每个账号一张卡（14 圆角、卡片底色与边线同设置页卡片），对话框圆角、玻璃底色、标题下一条细线与 Osuna 其他对话框相同。
- `11-plan-usage-modal-source-unavailable-desktop-1280-{zh,en}`：Codex 卡「不可用」+「登录已过期（3 小时前）。运行 codex 以刷新登录。」；OpenCode Go 卡「错误」+ 来源返回的原文。
- `11-plan-usage-modal-data-compact-390-{zh,en}`：底部抽屉，内容没有被裁；窄屏下卡片上直接写「刚刚更新」。
- `11-plan-usage-modal-options-desktop-1280-zh`、`11-plan-usage-modal-options-compact-390-zh`：选项菜单（桌面是浮层、窄屏是抽屉），「在侧边栏显示」「显示：已用 / 剩余」。
- `11-plan-usage-modal-remaining-desktop-1280-zh`：切到剩余后「剩余 69%」，侧栏摘要同时变。
- `11-plan-usage-modal-host-needs-update-desktop-1280-zh`：「更新 localhost 后可查看套餐用量」。
- `11-sidebar-summary-pinned-desktop-1280-{zh,en}`：摘要在图标行上方，来源图标 + 百分比 + 短窗口名。
- `11-settings-sidebar-summary-on-desktop-1280-{zh,en}`：底部一组一行「套餐用量摘要」，卡片与行高同顶部一组（截图里开关是打开的，为了同时拍到侧栏摘要；默认关闭见 03 的截图）。

### 评审与决定（2026-10-12）

三个维度各一轮（规范、规格、视觉），修一轮，只对修过的六处复查一次。

**修掉的。** 侧栏摘要的无障碍说明切换语言后不重算（规范，硬性）；`summaryWindow` 三个位置参数改成一个对象、类型用 `UsageDisplayAs`（规范，硬性）；「提供方用量」没进退役词清单（规范）；`usageCopy.displayUsed` / `displayRemaining` 没有调用方（坏味道）；摘要名称中英标点混用（规格）；「更新于 刚刚」不通顺、「侧栏」与「侧边栏」不一致（规格、视觉）；`formatRunsOutLabel` 补「Osuna：」标记。复查六处全部确认解决。

**维护者的两个决定。**

1. 其余八种语言里弹窗内的九句提示也改成「套餐用量」的说法——**改**。规格评审指出只有 zh-CN 达标；这要动 72 句文案与 18 处断言（其中 5 处是 Osuna 自己的测试），所以问了维护者。
2. 用完时间已过时退回显示重置时间、不标红——**按现在这样**。两个维度都指出这改了上游行为，需要维护者确认。

**留着没动的（判断项或不在这张工单里）。**

- 报告超过一周没更新时，上游的共用时间工具给的是英文日期，中文下是「Jan 15更新」「登录已过期（Sep 20）」。复查指出改「{{ago}}更新」之后日期与「更新」之间没有空格。要修就得动 `utils/time.ts`（工作区标签的悬浮提示也用），不在这张工单里。
- 「没有已连接的主机」「刷新中」两个状态没有截图，只有代码路径与单元测试。留给 14。
- 截图来自无头 Chromium，规格的目标视口是 Electron 桌面端。留给 14。
- `AGO_KEYS` 的类型是 `Record<string, string>`；`agoProse` 把「3h」再拆回数字与单位（上游 `formatUsageFreshness` 收的就是这个字符串）；五处测试各自写了一遍切换语言的 try / finally（仓库里别的测试也是这个写法）。
- 视觉：卡片里的错误说明在浅色主题下对比度约 1.9:1，颜色是 `docs/design.md` 规定的 `palette.red[300]`，要改得改规范；窄屏选项抽屉的标题比下面两行靠左约 3pt，是菜单抽屉的通用外壳；余额行的数值右缘与窗口行不齐（窗口行给图钉留了位）；侧栏摘要里 92% 与 31% 同色；设置页「套餐用量摘要」的图标与「价格表」相同、与侧栏底部入口不是同一个。这几条都是上游的版式或共用组件，没有在这张工单里改。
