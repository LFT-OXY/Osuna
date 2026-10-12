# 12 — 套餐用量最终形态（二）：Osuna 的三个入口换到上游数据

**What to build:** Osuna 自己的三个套餐用量入口不再走旧的兼容通道，全部用上游的报告数据：Usage 页里的套餐卡片复用上游的额度卡片，按页面上的主机筛选显示，多主机时按主机分组；Composer 上方的用量条带上新认出的登录与 OpenCode Go；上下文圆环的悬浮卡带上游定型后的刷新按钮。百分比显示已用还是剩余，在弹窗、侧栏摘要、悬浮卡、Usage 页卡片、用量条五处一致。主机设置页仍是价格表。Osuna 旧的套餐用量代码里被上游取代的部分清掉。规格见 `prd.md` 的「套餐用量」「上下文圆环」「Testing Decisions」「UI and Design」。

**Blocked by:** 11
**Status:** ready-for-agent
**Impl:** done

- [x] Usage 页的套餐卡片用上游的报告数据与上游的额度卡片；标题、刷新按钮、「多久前更新」保留；按页面的主机筛选显示，计入不止一台主机时按主机分组并报出主机名；主机不可用时有说明。
- [x] Composer 用量条用上游的报告数据：新认出的登录与 OpenCode Go 出现在用量条里；用量条的取舍规则（显示哪个窗口、空间不够时怎么收）与合并前一致，Osuna 用量条的现有测试在新数据上通过。
- [x] 上下文圆环悬浮卡：带上游的刷新按钮；08 列出的 Osuna 内容仍在。
- [x] 已用 / 剩余的偏好切换后，弹窗、侧栏摘要、悬浮卡、Usage 页卡片、用量条五处同时跟着变。
- [x] 主机设置页是价格表，没有套餐用量区块；上游的那个区块组件留在代码里、没有挂载。
- [x] Osuna 旧的套餐用量模块里被上游等价实现取代的部分已删除，没有两套并存的取数逻辑；只为用量条与 Usage 页卡片服务、上游没有对应物的部分保留在不与上游相撞的位置。没有因此产生的孤儿代码。
- [x] 应用里不再有代码请求旧的套餐用量列表消息；服务端上游的兼容应答仍在，供旧客户端使用。
- [x] 连的是没有 `features.usageSources` 的旧 daemon 时，三个入口按上游的做法提示升级主机或不显示，没有回退路径。
- [x] Osuna 的两条浏览器用例（Usage 页的套餐用量、圆环提示里的套餐用量）保留并改到新数据来源与新悬浮卡上；辅助代码跟着改。断言的改动只限于换实现所必需的，逐条记在 `## Comments` 下，供 15 写 PR 正文。
- [x] Osuna 用量条与视图的单元测试通过；改动的断言逐条记在 `## Comments` 下。
- [x] 翻译资源测试通过；不再被引用的翻译键连同 zh-CN 的英文白名单条目一起删掉。
- [x] typecheck 和 lint 通过；改动涉及的测试文件逐个跑过并通过。
- [x] 推到 `origin` 后草稿 PR 上的 CI 结果已看过并记在 `## Comments` 下。
- [x] UI：Usage 页 / 套餐卡片有数据 / 桌面 1280 — 卡片里是每个账号的额度窗口，卡片外框、标题行与同页其他卡片一致。
- [x] UI：Composer / 用量条有数据 / 桌面 1280 — 用量条在输入框上方，样子与合并前一致。
- [x] UI：上下文圆环悬浮卡 / 有数据 / 桌面 1280 — 套餐用量一段带刷新按钮。
- [x] UI：设置 → 某台主机 / 桌面 1280 — 是价格表，没有套餐用量区块。
- [x] UI：切到「剩余」后 / 桌面 1280 — 弹窗、Usage 页卡片、用量条上的百分比都是剩余值。

## Comments

### 来自 10 的交接（2026-10-12）

- `e2e/browser/usage-settings.spec.ts` 仍是 02 标的 `test.describe.skip`（主机设置页不挂上游的套餐用量区块）。上游的额度卡片接到 Usage 页的套餐卡片之后，把这组用例改到那里。
- `e2e/browser/usage-sidebar-item.spec.ts`「pinned windows show in the sidebar…」里，上游「去主机设置页的套餐用量区块核对固定项与已用 / 剩余」那一步在 10 去掉了（主机设置页是价格表）。Usage 页的套餐卡片接上上游数据后，可以把这一步改到 Usage 页上补回来。

### 来自 11 的交接（2026-10-12）

- **九种语言里说订阅额度的提示都已写成「套餐用量 / plan usage」**（维护者 2026-10-12 决定）。Osuna 旧模块用的几个键也在内：`usage.planUsage.loading`、`empty`、`errorTitle`、`refreshFailed`、`hostUnavailable`、`hostUpgradeRequired`。`provider-usage/format.test.ts` 里断言英文的 5 处已跟着改；这张工单删旧模块时，这几条断言随被删的代码一起走，不用再改回。
- zh-CN 的 `usage.planUsage.updated` 由「更新于 {{ago}}」改成「{{ago}}更新」。Usage 页的套餐卡片也用这个键。
- 上游额度卡片的文案都从 `usage/copy.ts` 的 `usageCopy` 取；「已用 / 剩余」的百分比用 `formatDisplayPct`，重置与用完的说法用 `formatResetLabel` / `formatRunsOutLabel`（`usage/format.ts`）。Usage 页卡片与用量条改接上游数据时沿用这几个，不另写一套。会被缓存的本地化结果要把 `t` 传进去，见 `.atw/spec/app/frontend/component-guidelines.md`「Copy」。
- 造上游报告数据的夹具与中文截图的写法记在 `.atw/spec/app/frontend/testing.md`（`installUsageReportsFixture`）。

### 实现记录（2026-10-12）

**开工时核实出的一处规格偏差，与维护者的决定。** 规格写「用量条改接上游数据后，新认出的登录与 OpenCode Go 自动出现」。读实现后发现不会自动出现：上游的报告是按「来源 + 账号」给的（`UsageReportEntry`，`sourceId` 是 `claude`、`codex`、`opencode-go`……），用量条原来按提供方 id 在列表里找第一条；Pi / OMP / OpenCode 借用的 Claude、ChatGPT 登录只有按智能体问（`usage.list_reports` 带 `agentId`）才对得上，而 OpenCode Go 的来源只在全局范围报账号（`plugins/opencode-go-usage-source/index.server.ts`：`scope.kind === "global"`），按智能体问永远没有它。把这两点摆给维护者后，维护者 2026-10-12 选定：**用量条跟着会话实际用的账号走**（与上下文圆环悬浮卡同一份），草稿没有智能体可问时按所选提供方取主机上的第一个账号，OpenCode 会话按账号问不到时显示 OpenCode Go。

**做成了什么。**

- **Composer 用量条**（`packages/app/src/plan-usage/`）。有智能体时先问 daemon 这个智能体用的是哪个账号（`usage.list_reports` 带 `agentId`，用量条自己的查询键 `["usage", serverId, "strip", agentId]`，每 5 分钟刷新、不重试）；daemon 报不出账号或没问成时，改看主机的列表（与弹窗、侧栏摘要同一条查询），按提供方找第一个账号，`opencode` 额外认 `opencode-go`。草稿只看主机的列表。选哪个账号是纯函数 `selectPlanUsageStripReport`，要不要取主机列表是 `stripNeedsHostReports`。显示哪些窗口、空间不够怎么收（`fitPlanUsageStripSegments`）、第三方接口时不显示、短名字的翻译键都没动。百分比按上游的已用 / 剩余偏好写（`displayPercent`），圆环旁只写数字，读屏的说法里写明「已用」还是「剩余」（新增 `usage.planUsage.strip.windowA11yLeft`、`windowA11yLeftNoTrailing`，九种语言）。悬停卡片换成上游的额度卡片（`usage/card.tsx`，`compact`、不可固定、不带刷新按钮——悬停卡片不接受点按，卡片底部写着多久前更新）。套餐名一段的图标改用报告自带的来源图标。
- **Usage 页的套餐卡片**（`components/usage/usage-plan-card.tsx`）。外框仍是这一页的 `UsageCard`，标题、「刷新」按钮、「多久前更新」保留；每台主机一组，组里每个账号一张上游的额度卡片（带各自的刷新按钮，侧栏摘要打开时窗口行可以固定，与弹窗里一样），账号之间一条分隔线。状态的说法用上游的：主机没连上「连接 X 后可查看套餐用量」、主机太旧「更新 X 后可查看套餐用量」、加载中、出错（带重试）、没有数据。头部的刷新绕过 daemon 的缓存（上游的 `refreshReports`，与弹窗的「全部刷新」相同）。分组、最近更新时间、忙碌状态是纯函数 `resolvePlanUsageHosts`。
- **上下文圆环悬浮卡**。06 / 08 已经接上上游的 `AgentUsage`，桌面悬浮卡与窄屏抽屉里每张额度卡都有刷新按钮；这张工单没有再改它的代码，只确认了它不受用量条新增的查询影响（见下）。
- **旧模块**。`packages/app/src/provider-usage/` 整个目录没有了：`card.tsx`、`list.tsx`、`format.ts`、`format.test.ts`、`tone.ts`、`types.ts`、`view.ts` 删除（上游的 `usage/card.tsx`、`format.ts`、`tone.ts`、`types.ts`、`model.ts` 是等价实现）；`strip.ts`、`strip.test.ts`、`strip-gauge.tsx` 搬到 `plan-usage/`；`use-provider-usage*.ts` 改写成 `plan-usage/use-strip-usage.ts`、`use-hosts.ts`、`hosts.ts`。应用里没有代码再调 `listProviderUsage`、读 `features.providerUsageList`；`packages/client` 与 `packages/server` 里上游的兼容处理（`COMPAT(providerUsageList)`）原样在。e2e 的旧夹具 `e2e/support/helpers/provider-usage.ts` 删除。
- **上游文件里加的东西**只有 `usage/queries.ts` 末尾一段导出（`hostUsageQueryKey`、`usageReportsQueryKey`、`requireUsageClient`、`listHostUsageReports`、`refreshHostUsageReports`、`USAGE_REPORTS_STALE_TIME_MS`），用量条与 Usage 页卡片从这里拿键、取数与强制刷新。
- **翻译键**。删掉不再被引用的 `usage.planUsage.hostUpgradeRequired`、`usage.planUsage.tooltipLoading`（九种语言；都不在 zh-CN 的英文白名单里）。`rg` 逐个核对了 `usage.planUsage.*` 其余 47 个键都还有引用（`summaryWindowUsed` / `summaryWindowLeft` 是 `copy.ts` 里按偏好拼出来的）。

**与 11 的交接不同的一处。** 11 建议用量条的重置与用完说法直接用 `formatResetLabel` / `formatRunsOutLabel`。用量条没有用：它跟着传进来的时钟倒数、返回「翻译键 + 参数」供组件渲染，现有测试也是按这个形状断言的；上游那两个函数读系统时间、直接返回句子。用量条里留了一个小的 `resolveFullTrailing`，用的是同一批翻译键（`usage.planUsage.resets`、`runsOut`、`resettingNow`），屏幕上的字与上游窗口条相同。百分比、色调、夹取用的都是上游的 `displayPercent`、`formatPct`、`windowTone`、`clampPct`。

**第三方接口的那一行提示。** 旧的 Osuna 卡片在 Usage 页上给启用了第三方接口的提供方标一行「当前使用第三方接口 X」。上游的额度卡片里没有这一行，初版因此丢了它，评审指出后补回：`PlanUsageReports` 在来源是该提供方的账号卡片下面写这一行（`selectActiveApiEndpoint(entries, entry.sourceId)`，翻译键 `usage.planUsage.apiEndpointNote` 不变）。上下文圆环悬浮卡里的那一行（`ActiveApiEndpointNote`）与「用了第三方接口时用量条不显示」也都在。Usage 页上的这一行没有用例守着（改动前也没有；mock 提供方写不进第三方接口配置，造这个状态的夹具与套餐用量的夹具不能同时装在一个页面上）。

**一个要知道的事实：侧栏一打开应用就取一次主机的列表。** 上游的 `useHasUsageSummary`（`left-sidebar.tsx`）不管摘要开没开都读主机的报告。所以「打开 Usage 页之前不取套餐用量」不再成立，相关断言按此改了（见下）。

**Osuna 单元测试的断言改动（供 15 写 PR 正文）。** 都是换数据形状所必需的，没有放宽。

- `plan-usage/strip.test.ts`（原 `provider-usage/strip.test.ts`）：
  - 输入由 `view: ready([ProviderUsage])` + `providerId` 换成 `hostReports` / `agentReports` + `providerId`（先 `selectPlanUsageStripReport` 再 `resolvePlanUsageStrip`），新增入参 `displayAs`。各用例的期望值不变。
  - 套餐名一段：`providerId: "claude"` 改成 `icon: <来源图标的 SVG>`；无障碍参数 `provider` 取的是来源名（值仍是 `Claude`）。
  - 「没有套餐名」：`planLabel: null` 改成不带这个字段（新结构里它是可选的）。
  - 「取数中」「取数失败 / 主机离线 / 主机太旧」两条并成一条 `hostReports: null`：用量条不再收到带原因的状态，三个翻译键不再是它的输入。
  - 「条目不可用」：`status: "error"` / `"unavailable"` 换成新结构的两种报告（`error`、`problem`）。
  - 删掉「刷新进行中仍显示上一次的结果」：模型不再有 `isRefreshing` 入参；这个行为由查询缓存保证，`hosts.test.ts`「stays ready while a refresh is in flight」与 `use-strip-usage.test.ts`「does not while an earlier answer still names the agent's account」各守一半。
  - 「只发出存在的翻译键」多跑一遍按剩余显示的情形。
  - 新增：选哪个账号 6 条（跟智能体的账号、别的提供方借来的登录、草稿、daemon 没报、OpenCode → OpenCode Go、没有账号），按剩余显示 1 条。
- `plan-usage/use-strip-usage.test.ts`（原 `use-provider-usage.test.ts`）：
  - 「挂载时取一次、每 5 分钟刷新」现在断言的是问智能体账号的那条查询，且此时不取主机列表。
  - 「不该显示时不取不刷」「隔了 5 分钟回来再取」保留，改到新查询上。
  - 删掉「圆环弹层的观察者不轮询」「用量条取到的交给弹层、不存第二份」：06 起弹层读的是上游按账号的 `AgentUsage`，不再有那个观察者。
  - 新增：daemon 报出账号时不取主机列表、报不出时才取、草稿只取主机列表；`stripNeedsHostReports` 4 条；`resolveStripReports` 5 条（答案没到时不交出主机缓存里的列表等）。
- `plan-usage/hosts.test.ts`（原 `provider-usage/view.test.ts`）：
  - 「先说连接再说升级」：期望由 `{ kind: "error", message: { key: "usage.planUsage.hostUnavailable" | "hostUpgradeRequired" } }` 改成上游的 `{ kind: "unavailable", message: "Connect to Laptop to see plan usage" | "Update Laptop to see plan usage" }`（点名主机，不带重试）。
  - 就绪 / 刷新中 / 失败的重取保留上次结果：`payload` 改成 `reports`，其余不变。
  - 删掉「把客户端未就绪的哨兵还原成翻译后的句子」：上游直接抛翻译后的句子（`usageCopy.clientUnavailable`），没有哨兵。「别的失败原样透传」保留，期望由 `{ text }` 改成字符串。
  - 新增：按页面顺序分组并用页面给的主机名、取各主机最新的更新时间、还没有主机应答时没有时间、任一主机在取就算忙、应用不认识的主机按未连接。
- `provider-usage/format.test.ts` 随 `format.ts` 删除（11 的交接已预告）。它守的东西现在在上游的 `usage/format.test.ts`、`usage/copy.test.ts`（百分比、重置与用完的说法、余额、英文原文）；用量条自己的短说法仍在 `strip.test.ts`。

**浏览器用例的改动（供 15 写 PR 正文）。**

- `composer-plan-usage-strip.spec.ts`（Osuna）：夹具由 `installProviderUsageFixture` 换成上游的 `installUsageReportsFixture`，数据由按提供方的条目换成按账号的报告。
  - 「取一次」类的断言由「旧消息的请求数」改成「按智能体问的请求」：第 1 条由 `requestCount() === 1` 改成「按智能体的请求恰好一条且带这个智能体的 id」；悬停刷新、5 分钟刷新两条同理。
  - 悬停卡片：`provider-usage-window-*` 这几个 testID 随旧卡片消失，改成在 `usage-report-mock:account` 里按文字找（`12% · resets 3h`、`46% · resets 4d`，没有 `Weekly · Fable`）；加「卡片里没有按钮、没有可勾选的行」。`Max 20x`、`Updated just now`、`Extra usage`、`$3.00 / $50.00` 不变。
  - 「每次取数都失败时保持安静」：请求数由 4 改成 5（问智能体 1 次不重试 + 主机列表 4 次），并按 06 的备注补了明确的出错态断言——打开套餐用量弹窗，看到 daemon 的原话。
  - 「5 分钟后安静」：第二次的应答由「列表里换成别的提供方」改成「daemon 不再报这个智能体的账号，主机列表里也没有它的提供方」。
  - 「旧主机不问」：`supported: false` 换成 `usageSupported: false`，断言不变（0 个请求）。
  - 悬停卡片里两行窗口与余额改成一条连着读的断言（`Session12% · resets 3hWeekly46% · resets 4dExtra usage$3.00 / $50.00`），顺序与相邻关系都在检查之内。
  - 新增 5 条：跟着智能体的账号而不是主机上的第一个、daemon 的答案没到之前不显示主机上的第一个账号、只会旧消息的已发布主机照常显示、daemon 没报时退回主机列表、切到剩余后用量条的数字与读屏说法跟着变。
- `usage-page-plan-usage.spec.ts`（Osuna）：同样换夹具。
  - 第 1 条去掉「进应用后、打开 Usage 页前请求数为 0」（侧栏会取一次，见上）；`OpenUsage 0.6.27`（旧结构里的数据来源字段，新结构没有）换成账号名 `dev@example.com`，并加「三个账号三张卡片」「所有请求都不带强制刷新、不按智能体」。
  - 刷新一条由「请求数从 1 变 2」改成「点刷新前强制刷新 0 次、点后恰好 1 次」，数字 23% → 64% 不变。
  - 第 4 条去掉 `Max 20x`：新结构里出错的报告不带套餐档位。等待由「旧消息的第 1 次请求答完」改成「按智能体问的那 1 次请求已发出」（侧栏的请求不算数）。
  - 新增 1 条：两台主机时按主机分组并报出主机名；筛到一台后只剩它的账号，那一组仍报出主机名（页面计入的主机数没变，这是原有行为）。
- `usage-settings.spec.ts`（上游，02 起整组跳过）：取消跳过，三条用例改到 Usage 页的套餐卡片上跑——入口由设置 → 主机 → 用量改成 Usage 页，`usage-card` 改成 `usage-plan-usage-card`；「全部刷新」按钮换成卡片头部的「Refresh」；去掉「区块上有设置齿轮」那一句（Osuna 的卡片头部没有齿轮，偏好在弹窗里改），改完直接在卡片上看 `30% left`、`93% left`；旧主机一条加「卡片头部的 Refresh 按不动」。按的是「主机设置页不放回套餐用量区块」这条决定。
- `usage-sidebar-item.spec.ts`（上游）：10 去掉的那一步补回来，改成去 Usage 页的套餐卡片核对 `69% left` 与 Codex Weekly 仍是固定的。
- `usage-price-table.spec.ts`（Osuna）：主机设置页「没有套餐用量区块」那一句，testID 由早已不存在的 `provider-usage-card` 改成上游区块的 `usage-card`。
- `e2e/support/helpers/context-window.ts`（上游的辅助代码，上游的用例文件 `context-window-meter.spec.ts` 没有改）：桌面宽度下用量条一挂载就问一次智能体的账号，`scriptAgentUsage` 把每次连接上第一个按智能体的请求认作用量条的，答「没有账号」，不占用编排好的应答，也不计入 `agentRequests()` / `refreshedAgents()`。

**顺手做的一处。** Usage 页卡片头部的「刷新」在没有一台主机能报套餐用量时置灰（原来按下去什么也不发生）。

**连旧主机时的实际表现（与工单的验收句有出入）。** 工单写「连的是没有 `features.usageSources` 的旧 daemon 时……提示升级主机或不显示」。实际分两种，都是上游的做法、应用里没有回退代码：只声明 `providerUsageList` 的已发布主机，由 `packages/client` 里上游的兼容处理把旧列表换算成报告，三个入口照常有数据（用量条按智能体问时不发请求、直接得到「没有」，于是按提供方看主机列表）；两个特性都不声明的更旧主机，Usage 页卡片写「更新 X 后可查看套餐用量」，用量条不显示、不发请求，悬浮卡里没有套餐用量一段。`prd.md`「套餐用量」最后一条已按此改写。

**验证（本机）。**

- `npm run typecheck`、改动文件的 `npm run lint` 通过；排除 `.expo` 类型的临时配置复核过一次，没有落在改动文件上的错误。
- 单元测试：`src/plan-usage`（3 个文件 63 条）、`src/usage/`、`src/i18n`、`src/composer/context-strip`、`src/price-table` 共 16 个文件 264 条通过。
- 浏览器用例（`--project=browser`，逐个文件）：`composer-plan-usage-strip`（13 条）、`usage-page-plan-usage`（5 条）、`usage-settings`（3 条）、`context-window-meter`（10 条，上游的用例文件没有改）最后一轮通过；`usage-modal`、`usage-sidebar-item`、`usage-price-table`、`context-window-session-total`、`context-window-token-label` 在评审前的一轮里与 `context-window-meter` 一起 48 条通过，之后没有再动它们与它们读的代码路径之外的东西（评审后的改动在 `plan-usage/`、Usage 页卡片与上面四个文件）。
- 整套测试交给 CI。

**逐条验收的依据。**

- Usage 页卡片：`usage-page-plan-usage.spec.ts` 五条 + `usage-settings.spec.ts` 三条 + `hosts.test.ts`；截图 `12-usage-page-plan-card-*`。主机不可用：截图是「主机太旧」；「主机没连上」只有 `hosts.test.ts` 的用例，浏览器用例里 daemon 始终连着。
- 用量条：`composer-plan-usage-strip.spec.ts` 13 条、`strip.test.ts`、`use-strip-usage.test.ts`；取舍规则的用例（`fitPlanUsageStripSegments` 9 条、变窄让位、面板隐藏再显示）断言未动。
- 圆环悬浮卡带刷新按钮：`context-window-meter.spec.ts`「reports stream in one card at a time, each with Refresh」；08 的内容由 `context-window-session-total.spec.ts`、`context-window-token-label.spec.ts` 守着；截图 `12-context-window-card-plan-usage-refresh-*`（这张图里没有「本会话合计」，是夹具的限制：造它的夹具与套餐用量的夹具不能同装，08 的截图里有）。
- 五处已用 / 剩余：弹窗与侧栏摘要 `usage-sidebar-item.spec.ts`；Usage 页卡片 `usage-settings.spec.ts` 第 1 条与 `usage-sidebar-item.spec.ts` 补回的一步；用量条 `composer-plan-usage-strip.spec.ts` 最后一条；悬浮卡用的是同一个 `useUsageDisplay`（上游的 `AgentUsage`）。截图 `12-remaining-*`。
- 主机设置页是价格表：`usage-price-table.spec.ts`（`usage-card` 数量为 0）；`HostUsageSection` 仍在 `usage/host-usage-section.tsx` 并由 `usage/index.ts` 导出，没有挂载。
- 不再请求旧消息：`rg "listProviderUsage|providerUsageList" packages/app/src` 无结果。

**截图（`screenshots/12-*`，17 张）。** 来源同 11：`packages/app` 下的一次性 Playwright 用例（无头 Chromium、1280×800、`deviceScaleFactor: 2`、隔离 daemon、e2e 夹具造的假数据，窗口带与内置来源相同的色调），拍完已删除脚本；存成 1280 宽、256 色。

- `12-composer-strip-data-desktop-1280-{zh,en}`：用量条「Max 20x｜5h 31% 3h｜周 54% 4d｜Fable 12% 4d」，圆环是绿色；与改动前的基线 `09-composer-codex-speed-normal-desktop-1280-zh` 同一个样子。
- `12-composer-strip-hover-card-desktop-1280-{zh,en}`：悬停卡片是上游的额度卡片，没有刷新按钮，底部「刚刚更新」。
- `12-context-window-card-plan-usage-refresh-desktop-1280-{zh,en}`：圆环悬浮卡的套餐用量一段带刷新按钮。
- `12-usage-page-plan-card-data-desktop-1280-{zh,en}`：Claude、两个 Codex 账号、OpenCode Go 各一张，账号之间一条分隔线。
- `12-usage-page-plan-card-host-needs-update-desktop-1280-zh`：「更新 localhost 后可查看套餐用量」，刷新置灰。
- `12-settings-host-price-table-desktop-1280-{zh,en}`：价格表，没有套餐用量区块。
- `12-remaining-plan-usage-modal-*`、`12-remaining-usage-page-plan-card-*`、`12-remaining-composer-strip-*`（各 zh、en）：切到剩余后三处同为 69% / 46% / 88%。

### 评审与决定（2026-10-12）

三个维度各评了一遍，修完后对修过的条目复查了一次。

**修掉的。** 规格：用量条在 daemon 的答案到达前先显示主机缓存里的第一个账号（`resolveStripReports` 加闸，补单元测试与浏览器用例）；Usage 页丢了第三方接口那一行（补回）；`usage-page-plan-usage.spec.ts` 第 4 条的等待能被侧栏的请求满足（改成等按智能体的请求）；工单记录与 `.atw/spec`、术语表里没跟上的地方。规范：对象分支的三元、`new Set([...])`、两个关注点的条件、内联的多字段形状、重复模块名的文件名（`use-plan-usage-hosts.ts` → `use-hosts.ts`）、`enabled` 已排除的分支（改用 `skipToken`）、箭头函数赋值、循环里逐条断言、把一行拆成四个互不相干的断言。另把重复写的 `requireClient` 换成上游导出的、`fetchedAt` 改用 `Date.parse` 比较。

**留着没动的（判断项，或不在这张工单里）。**

- Usage 页卡片头部「全部刷新」失败时没有提示（`.catch(() => undefined)`）。上游的 `useHostUsage` 是同一个写法，旧实现也是静默；单张卡片的刷新失败有提示。
- `scriptAgentUsage` 靠「每次连接上第一个按智能体的非强制请求」认用量条的请求，720 是抄的主题断点。这是不改上游用例文件的代价；规范里写了它在什么情况下会失效。
- `plan-usage/` 直接引 `usage/` 里的文件、`TONE_COLOR_TOKEN` 与上游窗口条的配色各写一份、`planUsageProviderId` 与 `planUsageAgentId` 两个属性并排往下传、卡片里 `t()` 与 `usageCopy` 并用。
- 视觉：Usage 页卡片标题行右侧的「刚刚 / 刷新」比标题低约 6px、右缘没收到卡片内容的右边线（这一行是改动前就有的头部）；切到剩余后额度窗口的条按剩余填充、余额（Extra usage）的条仍按已用填充（上游的行为）；余额行比窗口行紧。都交给 14。
- 范围外看到的：英文界面 Usage 页明细表的表头溢出成「ReasoningSe」；鼠标刚从上下文圆环移开、悬浮卡还没收起时就切到别的页面，悬浮卡会留在新页面上（一次性探测里 3 秒后仍在）。都交给 14。

### CI（2026-10-12）

提交 `b88f77699` 推到 `origin/merge-upstream-v0-11-all`（草稿 PR #16；一并推上去的还有 10、11 收尾时没推的 `e45ed950a`、`85a24b6d6`、`7c1e862c4`）。

- **Desktop Packages**（run 38245666748）：通过。
- **CI**（run 38245666814）：第一次 18 项通过、2 项失败，都与这次改动无关——`server-tests (ubuntu-latest)` 是 `src/server/file-observer/internal/native-recursive.test.ts`「shallow scans recover coalesced deletes of new files in nested scopes」断言列表多出一项（文件监视的时序用例；这次没有改 `packages/server`），`desktop-tests (windows-latest)` 是下载 Electron 时 GitHub 返回 504。`gh run rerun --failed` 重跑后两项通过，全部 20 项为绿：format、lint、typecheck、app-tests、playwright 四个分片、server-tests 三个平台、desktop-tests 两个平台、cli-tests 三个分片、sdk-tests、relay-tests、linux、changes。
