# 14 — 全部新界面的截图与一致性检查

**What to build:** 八段都合完之后，在 dev 桌面端把 `prd.md`「UI and Design」列出的每个页面与状态走一遍并截图，交给维护者作为并入的依据。走的过程中把各页之间不一致的地方修掉：上游带来的新界面（套餐用量弹窗与摘要、圆环悬浮卡、Explorer 标签与 + 菜单、内容宽度、速度菜单、新建工作区页上的导入会话、Providers 里的两个新提供方、插件页）与 Osuna 原有界面放在一起时，圆角、行高、分隔、下拉触发器、浮层质感、文案语气是同一套。这张工单只修漂移，不重新设计。前面各张工单里还没适配的小变化（内容宽度等）在这里收尾。规格见 `prd.md` 的「UI and Design」「其余看得见的变化」，以及 `docs/design.md`、`docs/qa.md`。

**Blocked by:** 13
**Status:** ready-for-agent
**Impl:** done

- [x] dev 桌面端跑的是合并分支当前的构建（server 改动后已重建）；启动方式不影响正式 daemon。
- [x] `prd.md`「UI and Design」里「必须存在的页面与状态」逐项截图，存进任务目录的 `screenshots/`，文件名能看出是哪个页面哪个状态；做不出的状态写明原因与替代证据。
- [x] `prd.md`「UI and Design」里「截图可核对的验收点」逐条核对，结果（满足 / 不满足及修复提交）记在 `## Comments` 下。
- [x] 内容宽度：在外观页，用 Osuna 的设置组件；调整后聊天与 Markdown 的最大宽度跟着变。
- [x] 新界面与 Osuna 原有界面之间的不一致已修：卡片圆角、行高、卡片内行分隔、下拉触发器、对话框按钮位置、浮层的圆角与底色。每处修了什么记在 `## Comments` 下。
- [x] 上游 e2e 里写死上游主题色值的断言已对照 Osuna 的主题核对过。
- [x] 界面语言切到中文再走一遍新界面：没有残留的英文，没有把订阅额度写成「用量」的地方。
- [x] 快速冒烟：侧栏、输入框、终端、Usage 页、Providers 页、插件页、关于页（仍有应用更新卡片）打开正常，无报错。不逐项截图。
- [x] 修动过的文件 typecheck 和 lint 通过，涉及的测试文件逐个跑过并通过；推到 `origin` 后草稿 PR 上的 CI 结果已看过。
- [x] UI：全部截图 / 桌面 1280 — `prd.md` 的截图验收点全部满足。
- [x] 原生端（iOS / Android）免验收，已在 `## Comments` 下注明。

## Comments

### 来自 09 的交接（2026-10-12）

- 速度菜单只在 Composer 上按界面语言显示（`localizeSpeedFeature`）。设置 → Agent 档案的编辑弹窗（`agent-profiles/settings/agent-profile-edit-modal.tsx`）里速度那一行仍是 daemon 的英文；daemon 给的 `Plan`、模式名、思考档位名也仍是英文（`docs/i18n.md`「Translation Scope」）。要不要一并处理由维护者定。
- 共用菜单（`Combobox`）的宽度随选中标记所在的行变化：英文速度菜单勾在 Normal 时约 95px、勾在 Fast 时约 81px（`screenshots/09-…-menu-open-…-en.png` 对 `…-menu-open-fast-checked-…-en.png`）。是共用组件的行为，不只是速度菜单。
- 速度触发器只有图标、没有下拉箭头（上游 `desktopTrigger: "icon"`），旁边的模型、思考、模式都带箭头；快速与超快在触发器上同为实心品牌色闪电，只能从提示与菜单区分。
- 远程 SSH 主机弹窗新增的 daemon 密码框（上游 #6081，`components/add-remote-ssh-host-modal.tsx`）是上游的写法，外观没有对过 `docs/design.md`。
- 09 的速度菜单截图来自无头 Chromium + 夹具，Electron 里没有实看过。

### 来自 11 的交接（2026-10-12）

- 11 的 14 张截图（`screenshots/11-*`）来自无头 Chromium + 夹具，套餐用量弹窗、侧栏摘要、设置 → 侧边栏在 Electron 里没有实看过。
- 弹窗的「没有已连接的主机」「刷新中」两个状态没有截图，只有代码路径与单元测试。
- 视觉评审留下、没有改的几条（都是上游版式或共用组件）：卡片里的错误说明在浅色主题下对比度约 1.9:1（颜色是 `docs/design.md` 规定的 `palette.red[300]`）；窄屏选项抽屉的标题比下面两行靠左约 3pt；余额行的数值右缘与窗口行不齐；侧栏摘要里高占用的百分比不变色；设置页「套餐用量摘要」的图标与「价格表」相同。
- 报告超过一周没更新时，中文下出现英文日期（「Jan 15更新」「登录已过期（Sep 20）」），来自共用的 `utils/time.ts`。

### 来自 12 的交接（2026-10-12）

- 12 的 17 张截图（`screenshots/12-*`）来自无头 Chromium + 夹具，用量条、Usage 页的套餐卡片、圆环悬浮卡里的套餐用量在 Electron 里没有实看过。「主机没连上」的 Usage 页卡片没有截图，只有 `plan-usage/hosts.test.ts` 的用例。
- Usage 页套餐卡片标题行：右侧的「刚刚 / 刷新」比标题低约 6px，「刷新」的右缘没收到卡片内容的右边线（卡片里各行的数值、单卡刷新图标、相邻热力图卡的「UTC+08:00」都收在同一条线上）。这一行是 12 之前就有的头部。
- 切到「剩余」后，同一张额度卡片里窗口的条按剩余填充，余额（Extra usage）的条仍按已用填充；余额行比窗口行紧约 6px。上游的卡片（弹窗、Usage 页、两种悬浮卡都是它）。
- 用量条在「剩余」下只有数字变了，没有别的标记（读屏的说法里写了「剩余」）。
- 鼠标刚从上下文圆环移开、悬浮卡还没收起时就切到别的页面（例如点侧栏的「用量」），悬浮卡会留在新页面上；一次性探测里 3 秒后仍在。正常移开、等它收起再走没有这个问题。06 接进来的上游悬浮卡 + Osuna 的保留面板，12 没有改这部分。
- 英文界面 Usage 页明细表的表头溢出成「ReasoningSe」（`12-usage-page-plan-card-data-desktop-1280-en.png` 右下）。
- Usage 页上「当前使用第三方接口 X」那一行（12 补回，写在对应账号的卡片下面）没有截图，也没有用例。

### 来自 13 的交接（2026-10-12）

- 模型菜单里有 Haiku 5.5 的截图已有（`screenshots/13-composer-model-menu-claude-haiku-5-5-desktop-1280-{en,zh}.png`），是无头 Chromium + 假的 Claude 命令行拍的，不是 Electron。在 dev 桌面端实看这一项时，本机真实的 Claude Code 是 2.1.296（门槛 2.1.293），daemon 会去问真实的 `claude` 的版本与登录状态——动手前先问维护者。
- 评审的 Visual 维度在这两张图上记了三处菜单原本就有、与 13 无关的现象，视觉工单里看要不要处理：(1) 模型说明以型号名开头（「Haiku 5.5 · Fastest for quick answers」紧跟在标题「Haiku 5.5」后面），并在弹层右边缘之前约 68 逻辑像素处就截断；(2) 列表滚到底时最后一行下方留白约 31、顶部分隔线到首行只有约 5；(3) 中文界面里 Composer 的「Medium」「Auto mode」与侧栏工作区行的「now」是英文（前两个是否由服务端下发没有核实）。

### 实施记录（2026-10-13）

**环境。** 先 `npm run build:server`（成功），再 `env -u PASEO_HOME FORCE_COLOR=3 PASEO_LISTEN=127.0.0.1:6769 npm run dev --workspace=@getpaseo/desktop`。启动日志 `Home:` 是本检出的 `.dev/paseo-home`，结束后 6767 仍在监听、6769 与 8082 已释放。窗口 1280×800，Playwright 经 CDP 操作与截图。维护者 2026-10-13 同意启动：dev daemon 会向本机真实的 `claude`、`codex` 问版本与模型，并只读地读取本机登录去查套餐额度（代码核实：用量来源只读不写，不刷新令牌）。全程没有在任何输入框里发送消息。用完已还原：界面语言 zh-CN、内容宽度默认、内容字号 15、侧栏摘要关闭；为截图建的演示工作区（mock 提供方，`/tmp/osuna14-demo.*`）已归档。

**截图（`screenshots/14-*`，38 张，中英各一）。**

- 文件名带 `electron` 的 26 张是 dev 桌面端实拍。带真实账号数据的画面只看不入库：套餐用量弹窗、选项浮层、侧栏摘要、Usage 页、Composer 用量条、真实会话上的圆环悬浮卡（卡里同时有上下文、本会话的 token 与估算成本、轮次、用时、套餐用量与刷新）。这些状态入库的图仍是 08、11、12 的夹具图。
- 文件名带 `desktop` 的 12 张来自 `packages/app` 下的一次性 Playwright 用例（无头 Chromium、1280×800、`deviceScaleFactor: 2`、隔离 daemon、`installUsageReportsFixture` 的假数据），拍完已删脚本：弹窗「没有已连接的主机」、弹窗「刷新中」、Usage 页套餐卡片头部（修后）、外观页的内容宽度行（评审后改过组件，Electron 已停，改用无头重拍）。
- `14-settings-price-table-icon-*` 裁掉了右侧的价格表：表里是本机会话日志中出现过的模型名。
- 做不出的状态：**Usage 页「主机不可用」**。页面只计入已连接的主机——两台隔离 daemon 停掉一台后，它那一组直接从卡片里消失，画面与单主机时逐像素相同（所以没有另存一张）；一台主机都没连上时侧栏不显示「用量」入口。`usage.planUsage.hostUnavailable` 与单台主机的 `unavailable` 文案走不到界面上，证据仍是 `plan-usage/hosts.test.ts`。「当前使用第三方接口 X」那一行没有造数据的夹具，仍无截图。
- + 菜单在三个标签都开着时只列终端与差异；「从 + 菜单打开会话历史」的图仍是 `07-explorer-plus-menu-*`。

**截图验收点（`prd.md`「UI and Design」）。**

| 验收点 | 结果 | 证据 |
| --- | --- | --- |
| 侧栏顶部有「用量」；底部有「套餐用量」图标、没有「导入会话」图标 | 满足 | `14-workspace-sidebar-explorer-tabs-*` |
| 弹窗标题「套餐用量」，圆角、底色与其他对话框一致 | 满足 | 实测 `radius 18`、1px `border`、`surfaceGlass` + `blur(12px) saturate(1.14)`、`shadowDialog`；`14-plan-usage-modal-*` |
| 中文下标着「用量」的入口只有 Usage 页；说订阅额度的地方都写「套餐用量」 | 满足 | 弹窗标题、图标提示、设置开关、悬浮卡分区、Usage 页卡片标题逐处看过 |
| 设置 → 侧边栏有「套餐用量摘要」开关，默认关闭；打开后侧栏底部出现百分比 | 满足 | `14-settings-sidebar-bottom-group-default-*`；打开后的实看未入库，图见 `11-sidebar-summary-pinned-*` |
| 圆环悬浮卡同时有上下文、token 与估算花费、用时、套餐用量与刷新 | 满足 | Electron 实看（真实 Claude 会话，未入库）；`12-context-window-card-plan-usage-refresh-*` |
| Usage 页有套餐卡片；主机设置页是价格表 | 满足 | `14-usage-page-plan-card-header-*`、`14-settings-price-table-icon-*` |
| Composer 上方的用量条在 | 满足 | Electron 实看（未入库）；`12-composer-strip-data-*` |
| Explorer 标签栏有会话历史；标签的高度、圆角、选中态与工作区标签相同 | 满足 | 实测两边都是高 26、`radius 8`、选中 `rgb(234,234,234)`、`caption` 12/16；`14-explorer-session-history-*` |
| 外观页有内容宽度，行高、圆角与同页一致，卡片内无通栏分割线 | 评审后修到满足 | 行高 56、卡片 `radius 14`；输入框与三个字号输入框实测同为 64×28、`radius 8`、边框 `rgb(212,212,216)`；`14-settings-appearance-content-width-*` |
| Providers 两级，列表里有 Muse Code 与 Antigravity；关于页有应用更新卡片 | 满足 | `14-settings-providers-list-*`、`14-settings-about-app-update-*` |
| 新建工作区页有导入会话入口 | 满足 | `14-new-workspace-import-entry-*` |
| 中文下新界面没有残留的英文 | 不完全满足，见下 | — |
| Claude 模型列表里有 Haiku 5.5 | 满足 | 本机 Claude Code 2.1.296；`14-composer-claude-model-menu-haiku-5-5-*` |

**修了什么。**

1. **内容宽度不跟着变。** 改完宽度回到已打开的聊天，输入框变了而消息与回合页脚没变，重新加载后才对。行外框的样式是主题样式与行内对象合并出来的，Unistyles 在 Web 上按合并后的值生成样式类，主题数值变了、行又不重渲染就拿不到新值；上游的用例每一步都重新加载页面，所以没拦住。现在宽度另经 `agent-stream/row-max-width.ts` 的 context 传给行外框与回合页脚行。`e2e/browser/content-width.spec.ts` 加了一步「不重新加载回到聊天」，修前 804、修后通过。Markdown 预览与输入框本来就跟着变。
2. **Usage 页套餐卡片头部。** 「刚刚 / 刷新」比标题低 4px，「刷新」的文字离内容右边线 12px。`usage-plan-card.tsx` 的 `headerRight` 让出按钮的内边距与多出的高度；实测文字右缘 624.7 对边线 625.7，中线与标题同为 631（`14-usage-page-plan-card-header-crop-*`）。
3. **价格表的图标。** 设置里「价格表」与「套餐用量摘要」、侧栏底部的套餐用量都是仪表盘图标；价格表改成 `CircleDollarSign`。
4. **插件页输入框提示。** zh-CN 的 `owner/slug, 目录、Git URL 或 npm 包` 改成全用顿号。
5. **内容宽度的输入框**（评审发现）。上游这一行是裸输入框加自绘样式（高 36、宽 80、文字「重置」、边框 `border`），同页的字号行用 `FormTextInput size="sm"`（高 28、宽 64、图标重置、边框 `borderInput`）。改成直接用 `FontSizeRow`，它多了一个可选的 `resetAccessibilityLabel`，上游用例按读屏名找输入框与重置按钮的写法不用改。`settings.appearance.layout.reset` 这个文案键不再被引用，是上游的键，留着。

**看过、没有不一致的。** 卡片圆角（设置卡片与弹窗里的额度卡片都是 14）、行高（设置 → 侧边栏上下两组都是 56）、卡片内行分隔（`borderCardRow`）、浮层（选项浮层 `radius 10`、玻璃底；圆环悬浮卡与速度菜单走共用的 `popoverSurfaceStyle` 与 `Combobox`）。远程 SSH 主机弹窗的 daemon 密码框与直连主机弹窗的密码行是同一种写法；这一族弹窗的按钮在合并前后都在正文里通栏排，不是这次带来的。上游 e2e 里新增的色值断言只有 `codex-speed.spec.ts` 的四处，09 已换成 Osuna 的色值；`explorer-sidebar.spec.ts` 是相对比较。

**中文界面里仍是英文的。**

- 用量来源插件给的窗口与余额名：`Session`、`Weekly`、`5-hour`、`30-day`、`Extra usage`、`Credits`、`Disabled`、档位名，以及来源报错的原文。
- daemon 给的模式名、思考档位名与功能名（`Medium`、`Bypass`、`Auto-review`，速度旁边那个按钮的读屏名 `Toggle plan mode`），Agent 档案编辑弹窗里的速度一行。按 `docs/i18n.md`「Translation Scope」不翻。
- 相对时间：会话历史的 `11h ago`、侧栏的 `now`、超过一周的 `Jan 15`。共用的 `utils/time.ts` 写死英文，合并前就是这样，14 处在用。

**没改，留给维护者定。**

- 上面三类英文。
- 共用悬浮卡：鼠标刚移开就切页时卡片会留在新页面上（12 的交接）。上游的共用组件，按 `prd.md`「Out of Scope」不在这次修。
- 上游额度卡片里余额行与窗口行不齐、切到「剩余」后余额条仍按已用填充；浅色主题下卡片里的错误说明对比度低（`palette.red[300]`，`docs/design.md` §11 规定的颜色）。
- 共用菜单的宽度随内容变（速度菜单约 75 – 95px）；速度触发器没有下拉箭头。
- 新建工作区页没有选提供方时，模型菜单是空的（标题只有图标、正文「没有匹配的模型」），要先点左边的提供方按钮。dev 的本地存储里没有上次用的提供方时就是这样；这是 Osuna 自己的两段式选择，不是这次合并带来的。
- 英文界面 Usage 页明细表表头溢出（12 的交接）：`usage-details-card.tsx` 这次合并没有动过。
- 打开一个 rollout 已不在的旧 Codex 会话时，「加载 Agent 失败」的报错原文不换行，横向顶满面板。

**冒烟。** 侧栏、输入框、终端（开一个再关）、Usage 页、Providers 页、插件页、关于页（应用更新卡片在）打开正常；走查期间页面没有抛错，控制台只有 React 的未知属性警告。

**检查。** `npm run typecheck`、改动文件的 `npm run lint` 与 `format:files` 通过。本机逐个跑过并通过：`e2e/browser/content-width.spec.ts`（评审后的改动之后又跑一遍）、`usage-page-plan-usage.spec.ts`、`usage-price-table.spec.ts`（`--project browser`），`src/i18n/resources.test.ts`、`src/agent-stream/{strategy-web,render-strategy,footer-spacing}.test.*`、`src/screens/settings/appearance/font-size-row.browser.test.tsx`。

**原生端（iOS / Android）免验收。** 行外框的最大宽度在原生端同样走 context，数值与主题里的一致。

### 评审与处理（2026-10-13）

三个维度各一个子代理，对同一份冻结补丁（7 个代码文件 + 本工单记录）与 40 张截图。

**Spec。**

- 内容宽度的输入框没用 Osuna 的字段组件（工单「用 Osuna 的设置组件」）——**已修**，见上面第 5 条。
- 「中文界面没有残留的英文」不完全满足；「Usage 页：主机不可用」这个规格要求的状态走不到界面上——两条都要维护者裁定，记录在上面。`prd.md` 的「UI and Design」已补一句说明后者。
- 「下拉触发器」与 13 交接的模型菜单没有核对结论——补在下面。
- 价格表图标换成 `CircleDollarSign` 偏出「只修漂移」：改的是 Osuna 原有入口，工单列的不一致清单里没有图标。11 的视觉评审把「与套餐用量摘要同图标」交给了本工单，所以改了；**要不要保留由维护者定**，撤回只是 `settings-screen.tsx` 的一行。
- 内容宽度的修复是上游的缺陷，PR 正文要对着「修上游自己的缺陷……」写明：它在工单的验收项里（「调整后聊天与 Markdown 的最大宽度跟着变」）。
- 修复只覆盖行外框与回合页脚行。`view.tsx` 里 `contentWrapper` 的两处（待批权限卡的外框、空状态）仍只靠主题：Unistyles 在 Web 上开着 `CSSVars`，主题里的数值不会就地改写已生成的样式类，要等组件重渲染；这两处只有改宽度时正好挂着权限请求、或对话是空的才看得到，重新打开即恢复。没有改，没有实测。

**Standards。** 没有硬性违规。判断题里改了三条：context 的默认值从 `null` 换成 `DEFAULT_CONTENT_MAX_WIDTH`，去掉走不到的分支；`DispatchSubagentIndex` 改为导出，`StreamRowProviders` 直接用它；用例改用 `clickSettingsBackToWorkspace`，并多断言回合页脚行（`turn-footer-row`）。留着的一条：行外框的样式里仍有 `maxWidth: theme.contentMaxWidth`，context 再盖一次——底下那份是上游的原文，留着少一处合并冲突。

**Visual。**

- 内容宽度输入框高 36 / 宽 80、边框不是 `borderInput`——**已修**（同 Spec 第一条）。
- `usage-page-plan-card-after-host-drop-*` 与 `…-header-*` 是同一张图——**已删**前者，原因写进截图清单。
- 「导入会话」是胶囊形，`docs/design.md` §4 的按钮圆角是 6 / 8 / 10——上游的入口样式，03 已评审并入库；没有改，交维护者。
- 英文下 Explorer 的三个标签被截成「Chan… / Session …」——07 已记录并交维护者（上游共用标签行「收缩到放下」的策略）。
- 弹窗「刷新中」的转圈几乎看不见——上游的刷新按钮在刷新时置灰（`disabled` 即 50% 不透明度），转圈本身又是 `foregroundExtraMuted`。试过只把转圈换成 `foregroundMuted`，叠上置灰后看不出差别，已撤回；要改得动「刷新时是否置灰」，交维护者。
- 圆环旁的标签写「3.6K / 128.0K」（Osuna 的 Usage 数字写法），悬浮卡里写「4k / 128k」（上游的写法）——没有改，交维护者。
- 套餐卡片头部「刷新」的字形比标题低约 2px——中文字形与拉丁数字的基线差，盒子中线已对齐，没有再调。

**补：下拉触发器与模型菜单。** 新界面里的下拉触发器只有弹窗的主机筛选（多主机时才出现，`usage-host-filter-trigger`，11 的 `11-plan-usage-modal-*` 是单主机，没有拍到）与 Usage 页的主机筛选（12 之前就有）；这次没有逐个量。模型菜单（13 交接的三条：说明以型号名开头并截断、列表底部留白、中文下的英文）在 Electron 里实看与 13 的无头图一致，是菜单原本就有的，没有改。

**复核（只看已修的五条，一次）。** 四条判为已修：context 默认值、`DispatchSubagentIndex` 导出、用例改用 helper 并断言回合页脚行、重复截图已删。内容宽度输入框一条判为外观已修、行为有两处与上游原写法不等价：

- 输入前先去掉非数字字符（照字号行的写法），`900.5` 会变成 9005 再被夹成 4000、`12abc` 会写入 600。复核后已改回把原文交给 `parseContentMaxWidth`（`900.5` → 900，`12abc` 不写入）；这一处改完没有再送复核，`content-width.spec.ts` 与 `font-size-row.browser.test.tsx` 重跑通过。
- 设置在别处变了，框里的字要到下次失焦才换。字号行本来就是这样（输入框只在 `resetKey` 变时换字），没有改，交维护者。

规范写回：`docs/unistyles.md` 新增「Numeric Theme Tokens On Web」；`.atw/spec/app/frontend/styling.md` 的字号行一节收进内容宽度；`prd.md` 的「其余看得见的变化」「UI and Design」各补一句实际情况。

### 给 15 的交接（2026-10-13）

- PR 正文要写：(1) 内容宽度实时生效是修上游的缺陷，理由是它在 14 的验收项里；(2) `e2e/browser/content-width.spec.ts` 多了一步「不重新加载回到聊天」并断言 `turn-footer-row`，`TurnFooterRow` 为此多了一个 testID；(3) 内容宽度行换成 `FontSizeRow`，上游的 `settings.appearance.layout.reset` 文案键不再被引用；(4) 价格表图标换成 `CircleDollarSign`（待维护者确认）。
- 这次动到的上游文件：`agent-stream/view.tsx`、`agent-stream/turn-footer.tsx`、`screens/settings/appearance/appearance-section.tsx`、`i18n/resources/plugin-settings.ts`、`screens/settings-screen.tsx`，下次合并上游时会多几处冲突。
- dev 桌面端的本地存储里没有 `@paseo:create-agent-preferences`，新建工作区页默认不选提供方；15 打包后实看时如果遇到「选择模型」是空的，先点左边的提供方按钮。
- 等维护者定的事项都列在「实施记录」的「没改，留给维护者定」与「评审与处理」里。

#### 推送后的 CI（草稿 PR #16）

- 推送的提交 `9237cfdb6`（含 `be23885ab`），CI run 38333824622。第一次：20 个作业里 19 个通过，`app-tests` 失败在 `src/components/ui/autocomplete.browser.test.tsx`「Command menu › scrolls a group's title into view with its first row」（7102 条里的 1 条，已知的 CI 偶发，与本工单的改动无关）。`gh run rerun --failed` 之后第二次全部通过：format、lint、typecheck、server-tests（ubuntu / windows / macos 文件观察）、desktop-tests（ubuntu / windows）、app-tests、sdk-tests、relay-tests、cli-tests 三片、playwright 四片。Desktop Packages（run 38333824621）通过。
- 改过的 `e2e/browser/content-width.spec.ts` 在 playwright 分片里通过。

#### 维护者的裁定（2026-10-13）

- 「界面语言切到中文再走一遍新界面：没有残留的英文」与「`prd.md` 的截图验收点全部满足」按原文没有满足：中文界面里仍有三类英文（见「中文界面里仍是英文的」）。维护者选「按范围外接受并关闭」：这三类不是这次合并带来的，另开任务 `10-13-zh-relative-time-and-plan-labels`。两条验收项据此勾掉。
- 价格表的图标：维护者选「保留新图标」（`CircleDollarSign`）。
