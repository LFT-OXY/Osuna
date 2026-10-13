# 02 — 第一段：合并到上游 v0.11.0-beta.1

**What to build:** 合并分支上有一个把上游 `4aa2f2817`（v0.11.0-beta.1，共同祖先 v0.10.0 之后的 79 个提交）合进来的 merge commit，并开出指向 main 的草稿 PR。合完之后 Osuna 多出上游这一段的内容——套餐用量的重写（此时是独立页面形态）、内置插件、Muse Code 与 Antigravity、侧栏分成顶部与底部两组、约一半的缺陷修复——而 Osuna 自己的功能和有意做的决定都在：`/usage` 仍是 Osuna 的 Usage 页，指令列表仍不启动进程，各提供方的 `paseo.create_agent` 命名、子智能体权限归属、已装版本与一键升级照常，daemon 自更新仍不存在。套餐用量在这张工单结束时做到「Osuna 现有的入口仍有数据」为止，侧栏的细调留给 03，新提供方的核实留给 04，最终形态留给 11、12。这一段占本次 150 个冲突文件里的约 104 个，是最大的一张工单，merge commit 不能拆。规格见 `prd.md` 的「合并方式」「中间段的处理原则」「套餐用量」「提供方的冲突」「补丁分支」「版本号与发版元数据」「协议与兼容」。

**Blocked by:** 01
**Status:** ready-for-agent
**Impl:** done

- [x] 开工先验证一个前提并把结果记在 `## Comments` 下：上游在这一段保留了旧的套餐用量列表消息，Osuna 现有的套餐用量入口（Usage 页卡片、Composer 用量条、上下文圆环提示）靠它继续有数据。前提不成立时停下来告诉维护者，再决定把 12 的哪部分提前。
- [x] 合并前按 `docs/release.md`「合并后核对」的口径统计一次应用与 CLI 源码中指向上游站点的链接数（全部与非测试），记在 `## Comments` 下，作为后续各段的基线。
- [x] 合并分支包含一个以合并前的分支头与 `4aa2f2817` 为双亲的 merge commit。
- [x] 每个冲突文件怎么裁的、依据哪条规则，按区域逐个记在 `## Comments` 下，供 15 写 PR 正文用。规则裁决不了、或保留两边会改变用户可见行为的冲突没有自行取舍：已停下来问过维护者，问答记在 `## Comments` 下。
- [x] `/usage` 打开的是 Osuna 的 Usage 页；上游这一段的套餐用量独立页面没有接路由。上游为它带来的测试与此矛盾的，已按 Osuna 的行为改写，处理方式记在 `## Comments` 下。
- [x] Osuna 的套餐用量入口有数据：Usage 页的套餐卡片、Composer 用量条、上下文圆环提示里的套餐用量。主机设置页仍是价格表，没有套餐用量区块。
- [x] 上游的用量来源、报告列表消息与 `features.usageSources` 已收下；Osuna 的 Usage 消息与 `features.usage` 原样存在。
- [x] 侧栏按上游分成顶部与底部两组，分支能通过检查；顶部组里 Osuna 的「用量」条目仍在。细调与已保存顺序的测试在 03。
- [x] 内置插件工作区已收下，版本号是 `0.14.2`；dev daemon 启动时内置插件加载无报错。两个新提供方的逐项核实在 04。
- [x] daemon 自更新保持删除：上游改过的那几个文件没有恢复，`server_info` 不声明这项能力。上游别处的新代码若引用了其中的函数，只恢复了被引用的最小部分并记下原因。
- [x] Osuna 已去掉的侧栏横向分割线保持去掉；上游的新代码若需要那个组件，恢复的范围与原因记在 `## Comments` 下。
- [x] 补丁分支分叉处落在这一段的文件，按固定裁决处理：上游的部分取主线一侧，Osuna 的改动保留。
- [x] 指令目录的现有测试全部通过，无一改动断言；通用 ACP 与各提供方取指令列表不等待、不重连。上游若在这一段改了取指令列表的行为，没有收，并记在 `## Comments` 下。
- [x] Claude、Codex、Pi、OMP、OpenCode 1.x 两边都留：`paseo.create_agent` 命名与父工具调用归属、子智能体权限归属、已装版本与一键升级、CLI 启动解析、Codex 的官方与第三方接口切换、Pi 的 custom 消息过滤与 skill 还原的现有测试全部通过，无一改动断言。上游给提供方客户端新套的包装已对照接口把 Osuna 的可选方法转交。
- [x] 所有工作区版本号是 `0.14.2`；各 `package.json` 相对合并前的差异只有上游在版本号之外的改动；`package-lock.json` 是重新生成的，差异能逐项对应到上游新增或升级的依赖与新工作区。
- [x] `CHANGELOG.md` 与合并前逐字节相同。
- [x] 协议新增的字段都是可选的，协议的现有测试无一改动断言；上游新带进来的 `COMPAT(...)` 标签已按「合并后核对」改写版本号，清单记在 `## Comments` 下。
- [x] `docs/release.md`「合并后核对」逐项过完，结果记在 `## Comments` 下：更新源、桌面身份与数据目录（上游改了桌面打包配置）、签名与签名断言、只手动触发的部署工作流、上游站点链接的非测试数不多于基线、翻译键。任何一项有变化都已查清原因。
- [x] 翻译资源测试通过；上游新增的键九种语言齐全，zh-CN 是真实翻译。
- [x] 对本段冲突涉及的测试文件对比合并前后，没有 Osuna 的断言行被悄悄删掉；必须跟着改的断言逐条记在 `## Comments` 下。
- [x] typecheck 和 lint 通过；本段冲突文件对应的测试文件、以及本段新增或改动过的测试文件逐个单独跑过并通过。
- [x] dev 桌面端快速冒烟：侧栏、输入框、Usage 页、Providers 页、插件页打开正常，无报错。
- [x] 合并分支已推到 `origin`，并开出指向 main 的草稿 PR（推送与开 PR 前先向维护者说明并取得同意）；`gh` 命令带 `--repo LFT-OXY/Osuna`。

## Comments

### 2026-10-11 实施记录

**开工前提（成立）。** 上游 `4aa2f2817` 保留了旧的套餐用量列表消息：协议里 `provider.usage.list.request/response` 还在；服务端由上游新的 `session/usage/usage-session.ts` 的 `handleLegacyList` 应答（数据来自内置插件的用量来源，`listLegacyUsage()`）；`server_info.features.providerUsageList: true` 仍然声明；客户端 `DaemonClient.listProviderUsage()` 还在。Osuna 的三个入口（Usage 页卡片、Composer 用量条、圆环提示）走的正是 `client.listProviderUsage()` 并以 `features.providerUsageList` 为门槛，所以不需要把 12 的任何部分提前。dev 桌面端实测 Usage 页的套餐卡片与 Composer 用量条都有数据。

**链接基线（合并前，`docs/release.md`「合并后核对」的口径）。** `packages/app/src`：全部 73、非测试 1（`pair-link-modal.tsx` 的占位符）。`packages/cli/src`：全部 13、非测试 3（`onboard.ts`、`hub/authority.ts`、`hub/help.ts`）。合并后四个数字不变，非测试的四行逐行相同。

**合并。** `git merge --no-ff --no-commit 4aa2f2817`，双亲是合并前的分支头 `961cc94e2` 与 `4aa2f2817`。实际冲突 103 个文件：content 82、modify/delete 11、file location 8、add/add 3、rename/delete 2（同一文件可出现在两类里）。服务端 22 个文件由子代理解，逐文件记录在本节「服务端」；其余由主会话解。

#### 冲突裁决（规则编号：①Osuna 的产品决定保留 ②两边重复实现以上游为底、补回 Osuna 多出的 ③其余两边都留；「补丁分支」= 上游的部分取主线一侧，Osuna 的改动保留）

**版本号与发版元数据**

- 12 个 `package.json`：版本号与 `@getpaseo/*` 内部依赖的冲突块取 Osuna（`0.14.2`）。`packages/server/package.json` 的 `build:lib` 两边各加了一段拷贝，都留（上游的 `builtin-plugins` 拷贝 + Osuna 的价格表快照拷贝）。上游新增的工作区 `plugins/package.json` 版本号从 `0.11.0-beta.1` 改成 `0.14.2`。相对合并前的差异只有上游在版本号之外的改动：根 `workspaces` 加 `plugins`、`typecheck:server` 加内置插件；`client` 的 `build` 先建 relay；`plugin` 加 `./server/usage` 导出；`relay` 的 `exports` 改为只指 `dist`；`server` 加依赖 `yaml@2.9.1`。
- `package-lock.json`：冲突块取 Osuna 后用 `npm install --package-lock-only --ignore-scripts` 重新生成。相对合并前共 33 行新增，逐项对应：`plugins` 工作区及其链接、`packages/server/node_modules/yaml@2.9.1`。
- `CHANGELOG.md`：取 Osuna，与合并前逐字节相同（`cmp` 核对，格式化之后又核对一次）。
- `README.md` 没有冲突，上游的改动自动合入（提供方列表加上 Antigravity 与 Muse Code）。

**协议与客户端（③）**

- `packages/protocol/src/messages.ts`（4 块）：Osuna 的 `provider.version.check.*`、`provider.upgrade.*` 与上游的 `usage.list_reports.*`、`UsageReportSchema`、`UsageReportEntrySchema` 都留。
- `packages/client/src/daemon-client.ts`（3 块）：Osuna 的 `checkProviderVersions`、`upgradeProvider` 与上游的 `listUsageReports`（含对旧主机的 `COMPAT(providerUsageList)` 转换）都留。
- 协议新增的必填字段只出现在新消息里；对已有 schema 的改动只有 `ProviderOptionsSchema` 从 `z.json()` 放宽为 `z.unknown()`。`features.usageSources`（上游）与 `features.usage`、`providerVersions`、`apiEndpoints`（Osuna）都在。

**套餐用量（②，按「中间段的处理原则」只做到入口有数据）**

- `packages/app/src/usage/`：27 个文件全部取上游原样（含与 Osuna 的 `provider-usage/format.ts`、`format.test.ts` 相撞的两个、Osuna 已删而上游改名并修改的 `balance-bar.tsx`）。git 按目录改名把 Osuna 新增的 7 个文件挪进了 `usage/`（`strip*.ts(x)`、`use-provider-usage-hosts.ts`、`use-provider-usage.test.ts`、`view*.ts`），已挪回。
- `packages/app/src/provider-usage/`：Osuna 的 15 个文件原样留在原目录（上游删、Osuna 改的 6 个冲突取 Osuna）。与合并前的唯一差异是 `card.tsx` 的 `getProviderIcon` 换成 `useProviderIcon`（见「提供方图标」）。两套代码在第 1–5 段并存：Osuna 的入口继续走旧消息，上游的新目录供上游的入口用；最终归并在 11、12。
- `packages/app/src/app/usage.tsx`（add/add）：取 Osuna，`/usage` 是 Osuna 的 Usage 页。上游的 `usage/usage-screen.tsx` 留在代码里、没有接路由。上游的 `useOpenUsageScreen()` 跳的就是 `/usage`，所以侧栏底部的套餐用量图标与摘要点开的是 Osuna 的 Usage 页（dev 桌面端实测）。
- `screens/settings/host-page.tsx`（2 块）：取 Osuna，主机设置页仍是 `PriceTableSection`；上游的 `HostUsageSection` 留在 `usage/` 里不挂载。
- `e2e/browser/provider-usage-tooltip.spec.ts`、`usage-page-plan-usage.spec.ts`、`e2e/support/helpers/provider-usage.ts`（上游删、Osuna 改）：留 Osuna 的，与合并前逐字节相同。它们在 WebSocket 路由层模拟旧消息，不依赖服务端实现。

**侧栏（②，细调在 03）**

- `sidebar-nav/model.ts`（2 块）：取上游的两组结构；顶部组在上游四项之后加 Osuna 的 `usage`。顶部的 `usage`（Osuna 的「用量」）与底部的 `usage`（上游的套餐用量摘要）编号相同，文案、图标、默认显隐按所在的组区分：`builtinSidebarNavLabelKey(id, section)` 的 `section` 必填（上游的两处调用补上 `"footer"`，其中一处在上游的 `usage/sidebar-item.tsx`），顶部得到 `sidebar.sections.usage`；紧凑布局默认隐藏只对底部组生效。
- `components/sidebar/sidebar-nav-rows.tsx`（1 块）：导入两边都留；Osuna 的「用量」行取顶部组的文案键。
- `screens/settings/sidebar/sidebar-nav-section.tsx`（2 块）：图标两边都留，按组取（顶部 `BarChart3`、底部 `Gauge`）；行组件多收一个 `section`。
- `components/left-sidebar.tsx`（7 块）：底部取上游的结构（底部条目行 + 图标行：添加项目、套餐用量、主机、帮助、设置；「导入会话」图标随上游去掉）。外观留 Osuna 的：添加项目图标仍是 `Plus`，图标按钮的框与间距、底部内边距是 Osuna 的。
- **横向分割线**：上游给底部容器加的上边框（`footerContainer`）与底部条目行下面的 `SidebarSeparator` 没有收（①，Osuna 的侧栏不画横向分割线）。`components/sidebar/sidebar-separator.tsx`（Osuna 删、上游改）按上游恢复，原因：上游新的插件 UI 套件 `plugins/sidebar-items/kit.tsx` 把它作为 `SidebarSeparator` 导出给插件（`@getpaseo/plugin/client/ui` 的公开接口），插件自己画的分割线由插件决定。恢复范围只有这个组件本身，应用自己的侧栏没有用它。
- `components/sidebar/sidebar-header-row.tsx`（5 块）：Osuna 把这一行迁到了 `<Row>`，上游给它加了右侧槽 `trailing`、`rowRef`、可为空的图标、`inline` 变体。结果：外观与无右侧槽的行仍走 `<Row>`；有 `trailing` 时走同文件新增的 `RowWithTrailingSlot`，用 `getRowSurfaceStyle` 取 `<Row>` 的同一套表面状态，右侧槽是行按钮的兄弟节点（插件 SDK 约定右侧槽里的按钮自己响应按下，`<Row>` 的后置槽在按钮里面，放不了）。
- `hooks/use-settings/storage.ts`（4 块）与 `storage.test.ts`（1 块）：Osuna 的终端字体两项与上游的 `contentMaxWidth` 都留。上游的 `sidebarFooterItems`、`usage` 偏好自动合入；顶部与底部各自一个列表保存。

**上下文圆环与 Composer**

- `components/context-window-meter.tsx`（5 块）：取 Osuna（上游这一段只是去掉了提示里的套餐用量一段，Osuna 的入口要保留到 12）。补进上游的修复 #5598：进度弧用 SVG 的 `transform="rotate(-90 …)"`，不再用样式旋转。
- `composer/index.tsx`（7 块）：圆环的参数取 Osuna；草稿指令的入参取上游的 `commandDraft`（`DraftCommandTarget`），Osuna 的 `prefetchCommands`、`onPickSkill`、`onPickMention`、`hasSkillBlockInInput` 保留。
- `hooks/use-agent-autocomplete.ts`（5 块）：收下上游 #5594（草稿还缺项目或模型时不向 daemon 要指令列表，空列表提示「先选项目 / 先选模型」），并入 Osuna 的指令列表状态模型：缺项目或模型时菜单照常打开、不请求、不转圈；Osuna 的预取与「部分列表」页脚保留。ADR 0003 的行为没有变（这是不请求，不是等待或重连）。

**提供方图标（②）**

- `components/provider-icons.ts`（1 块）与 `provider-icons.test.ts`（2 块）：上游把按主机快照取图标改成订阅式的 `useProviderIcon` / `useProviderIcons`（快照晚到时已挂载的界面跟着更新），删掉了 `getProviderIcon`。以上游为底，Osuna 的品牌色与彩色图标保留：`resolveProviderGlyph` 还在，新增订阅版 `useProviderGlyph`；`getProviderIcon(provider, serverId)` 留给组件之外的调用方（`buildAgentMentionOptions`），读快照当前内容、不订阅。测试两边的用例都留。
- Osuna 在组件里取图标的 9 处换成订阅式：`model-browser.tsx`（2 块）、`composer/agent-controls/model-sheet.tsx`（2 块）、`screens/settings/providers-section.tsx`（2 块）三个冲突文件，以及没有冲突的 `provider-control.tsx`、`provider-detail/view.tsx`、`session-history/index.tsx`、`mention-defaults-section.tsx`、`provider-usage/card.tsx`、`inline-blocks/block-view.tsx`、`inline-blocks/view.tsx`、`subagents/dispatch-group.tsx`。

**外观与设置（①③）**

- `styles/theme.ts`（3 块）、`appearance/apply.ts`（2 块）、`appearance/apply.test.ts`（2 块）、`appearance/provider.tsx`（1 块）：Osuna 的 `typeScale` 与上游的 `contentMaxWidth` 都留。
- `screens/settings/appearance/appearance-section.tsx`（4 块）：两边的回调都留；上游的内容宽度一行原样收下，只带回它用到的三个样式（Osuna 已删掉的 `fontFamilyInput`、`sizeInput` 不带回）。用 Osuna 的设置组件重搭在 14。
- `screens/settings-screen.tsx`（6 块）：取 Osuna 的详情页头（图标徽标、Providers 面包屑）。上游把页头换成新的 `PageLayout`，没有用在设置页上（①，设置页外观归 Osuna）；`PageLayout` 组件本身随上游保留。上游给插件设置页加的「返回插件」入参自动合入。
- `components/provider-diagnostic-sheet.tsx`（4 块）：取 Osuna 的精简版（内容早已搬到 `provider-detail/`）。上游在这里改的「更新于」相对时间自动刷新，Osuna 的 `provider-detail/time-ago.ts` 已有等价行为。

**其余应用侧**

- `components/adaptive-modal-sheet.tsx`（2 块，补丁分支）：两块取上游主线（去掉 `renderBackdrop`）；主线带来的 `ABSOLUTE_FILL_STYLE` 在 Osuna 改过的遮罩写法里用不到，没有带。解完相对 `4aa2f2817` 的差异只有 Osuna 的外观改动。
- `hosts/host-confirmation-sheet.tsx`（add/add，4 块）：上游补丁分支与主线在这个文件上内容相同，冲突只是 Osuna 把按钮挪进底部按钮区的改动，取 Osuna。
- `components/add-host-modal.tsx`（1 块）：取 Osuna 的依赖数组（回调里用到 `directConnectionLabels.authFailure`）。
- `components/schedules/schedule-row.tsx`（2 块）：上游的 `ScheduleMeta` + `useTimeAgo`（相对时间自动刷新）与 Osuna 的翻译合在一起。
- `contexts/session-context.tsx`（2 块）：取上游的集中写法 `toDaemonServerInfo`；Osuna 加的 `hostPlatform` 补进 `stores/session-store.ts` 的 `toDaemonServerInfo`（不报冲突、不补会静默丢失）。
- `runtime/host-runtime.ts`（1 块）：`useHostRuntimeConnectionStatuses` 两边各修了同一个问题（React Compiler 丢掉只为触发重渲染的读取）。**留了 Osuna 的写法**，没有按②取上游：Osuna 把取值做成了有单元测试的纯函数 `readHostConnectionStatuses`，取上游会留下只有测试在用的导出；两边对外行为相同。代价是上游再改这个 hook 时要再解一次。
- `plugins/surface-screen.tsx`（6 块）：主机切换取上游新的通用 `HostFilter`；Osuna 的翻译兜底（`pluginSurface.fallbackTitle`、关闭按钮）保留，上游的标题解析保留。`plugins/workspace-panels/panel.tsx`（1 块）：导入两边都留。
- i18n 九个文件：`agentAutocomplete` 两边的键都留。`pairing.hostConfirmation` 一段补丁分支与主线各带来一份、逐字相同，自动合并后重复（`TS1117`），去掉后一份。zh-CN 的 `recovery.restoreDescription` 与新增的 `restoreWithoutBranchDescription` 取上游的新含义，按 Osuna 的既有译法写（Agent、工作树）。
- `e2e/browser/file-editing.spec.ts`（1 块，补丁分支清单里的文件）：取 Osuna 的导入（`expectDiagramWithLabels` 仍在用）。
- 文档：`docs/providers.md` 留 Osuna 的 Pi 思考档位一段 + 上游重写的 MCP 两段；`docs/custom-providers.md` 键名随上游改成 `options`、正文留 Osuna 的；`docs/glossary.md` 的 Sidebar items 取上游的新定义（Osuna 这条与基点相同），Osuna 的三条字体词条保留，上游新增的四条（Usage source、Report ID、Usage report、Usage (sidebar item)）原样插入——**此刻术语表里有两条 Usage source**，按「叫法」改写在 03。

**不报冲突、但要动手才对的地方**

- `components/context-window-meter.tsx`：自动合并删掉了 `serverId`、`provider` 两个属性，并把 `<Tooltip>` 的 `open` / `onOpenChange` 换成了上游的写法，圆环提示里的套餐用量因此不再加载（lint 的未使用变量报出来的）。都已恢复。`composer/index.tsx` 的选择器里 `provider` 同样被删，已恢复。
- `components/context-window-meter.utils.ts`（Osuna 已删）：上游的 `usage/format.ts` 引用其中的 `formatTokenCount`，按上游恢复这个 9 行的文件。
- `file-pane/markdown-preview/index.web.tsx`（Osuna 独有）：上游删掉了常量 `MAX_CONTENT_WIDTH`，改用 `theme.contentMaxWidth`，Markdown 预览因此跟随内容宽度设置。
- `styles/theme.test.ts`：测试数据补上 `InstalledPlugin` 新增的三个字段。
- `packages/desktop/src/daemon/daemon-manager.test.ts`：上游的两条新用例调用 `createDaemonCommandHandlers()` 不带参数，Osuna 的签名要求 `appUpdates`，补上 `createFakeAppUpdates()`。
- `usage/copy.ts`（上游）：`"No connected hosts"`、`"Try again"` 两句在 Osuna 里早已迁到翻译键，i18n 守卫不允许源码里再出现字面量。先接到现成的键（`addProject.empty.noConnectedHosts`、`sessions.actions.tryAgain`）；这份文案的本地化与「套餐用量」的叫法在 03。

#### `/usage` 与上游的中间页面

- 路由：见上。
- 上游为中间页面带来的浏览器用例里，有两组在 Osuna 里无从进入，标成了 `test.describe.skip` 并写明原因：`e2e/browser/usage-screen.spec.ts`（5 条，测占用 `/usage` 的独立页面；上游在 v0.11.0 把它换成 `usage-modal.spec.ts`）与 `e2e/browser/usage-settings.spec.ts`（3 条，测主机设置页的套餐用量区块；这个文件到 v0.11.2 还在，12 把上游的卡片接到 Usage 页后改到那里）。这是对「按 Osuna 的行为改写」的处理方式：没有可改写的落点，跳过而不是删除，免得后面各段在这两个文件上出现修改对删除的冲突。
- **没有处理、会在 CI 的 Playwright 里失败的（评审核实）：**
  - `e2e/browser/usage-sidebar-item.spec.ts`（4 条）：除了下面的 `testID` 相撞，它还要点进上游的中间页面（`usage-host-<serverId>`、`usage-report-*`、`usage-host-filter-trigger`，只由没有接路由的 `usage/usage-screen.tsx` 渲染）。
  - `e2e/browser/sidebar-nav-settings.spec.ts` 里上游新增的底部用例（第 41–74、206–231 行）：`expectFooterSeparator` 断言 `sidebar-footer` 有 1px 上边框、`sidebar-footer-separator` 存在，`expectFooterIconRow` 断言图标按钮之间间距为 0——Osuna 不画分割线、图标按钮之间有 2px 间距，都对不上。
  - **Osuna 自己的一条也会失败**：同一文件第 171 行 `expectSidebarItemHidden(page, "usage")` 要求可见的 `sidebar-usage` 为 0。顶部「用量」行与上游的底部摘要行 `testID` 同为 `sidebar-usage`（dev 桌面端实测页面上有两个），而底部摘要在这一段默认可见。设置 → 侧边栏的两张卡片里也各有一个 `sidebar-nav-item-usage` / `sidebar-nav-toggle-usage`，不限定卡片的定位会命中两个。
  - 这几处都属于侧栏的细调，留给 03：把两个条目的 `testID` 分开、按 Osuna 的外观改上游的底部断言、把点进中间页面的步骤改到 Osuna 有的落点或同样跳过。在 03 做完之前，草稿 PR 上这两个 spec 是已知红灯。

#### 服务端（子代理解，主会话核对过冲突标记、OMP 会话目录一处的差异与那条失败用例）

- `agent/provider-registry.test.ts`（1）：留 Osuna 的两条用例（①③）。
- `agent/provider-snapshot-manager.ts`（1）：两边都留（③）。
- `agent/providers/codex-app-server-agent.ts`（3）：会话级 `listCommands()` 取 Osuna（只问已连接的 app-server，否则 `null`；①，ADR 0003）；`listCodexCustomPrompts` 的重复声明取 Osuna 已挪走的写法（补丁分支）。
- `agent/providers/codex-app-server-agent.test.ts`（4）、`codex/rewind.ts`（1）：取上游主线（补丁分支，HEAD 一侧没有 Osuna 的内容）。
- `generic-acp-agent.ts`（2）、`cursor-acp-agent.ts`、`kiro-acp-agent.ts`、`trae-acp-agent.ts`（各 1）：上游删 `providerParams`（改走 `providerOptions`）→ 收；Osuna 删的「取指令列表前等待」保持删除（①）。`generic-acp-agent.commands.test.ts`（1）：取 Osuna。
- `omp/provider-config.ts`（2）：取上游的改名（`runtimeOptions`）。
- `omp/session-descriptor.ts`（4）：两边各实现了一遍 OMP 会话目录解析，导入路径取上游的实现（②），Osuna 的导入预览去 Routing block 保留。Osuna 的 `resolveOmpRoots` / `resolveOmpSessionPaths` 仍在，Usage 的日志根目录与诊断在用。`omp/session-descriptor.test.ts`（2）：两边的用例都留。
- `omp/agent.ts`（2）：上游的 `resetActiveTurn` 与 Osuna 的 `listCommands()` 签名都留；Osuna 的 `processExited` 并入上游的 `runtimeDead`（上游这一段新增了进程退出后下一轮重新拉起运行时，`processExited` 从不复位，留着会让重启后的会话永远答 `null`）。取指令列表仍不拉起进程，新增 1 条用例证明（`omp/agent.test.ts`）。
- `omp/host-tools.ts`（1）：以上游为底，补回 `providerToolCallId`（`paseo.create_agent` 的父工具调用归属）。`omp/tool-call-mapper.test.ts`（1）：两边的用例都留。
- `authorization/operation-permissions.ts`（2）、`test-utils/paseo-daemon.ts`（1）：两边都留。
- `session.ts`（5）、`session/provider/provider-catalog-session.ts`（5）及其测试（3）、`websocket-server.ts`（1）：去掉上游已删的 `ProviderUsageService`，旧消息改由上游的 `UsageSession.handleLegacyList` 应答；Osuna 的版本检查与升级两个服务保留。上游的 `usageSession` 与 Osuna 的 `usageStatsSession` 并存。
- 冲突之外：`agent/provider-registry.ts` 的 `wrapClientProvider` 自动合并后复杂度 21（上限 20），把 Osuna 的三个可选方法转交收进 `forwardOsunaClientMethods`，上游的行没动；`opencode/bridge.test.ts` 给 Osuna 用例的假上下文补上上游新调用的 `ask`。
- 包装核对：`wrapClientProvider`、`opencode/runtime-client.ts` 三个可选方法都转交；插件提供方（Muse Code、Antigravity 走这里）三个都没有，合并前也没有。所有提供方的会话级 `listCommands()` 逐个看过，没有先重连或先等待的。

#### 取指令列表（ADR 0003）

上游这一段没有改任何提供方取指令列表的等待或重连行为；相关冲突都是相邻行。没有收的只有基点原有、Osuna 早已删除的两处（通用 ACP 与 Cursor / Kiro / Trae 的首次等待；Codex 断开时先 `connect()`）。收下的 #5594 与 OMP 退出后下一轮重启都不是取列表。

#### daemon 自更新

这一段上游没有碰那五个文件，`session/daemon/` 的文件清单与合并前相同，`server_info` 不声明这项能力。

#### 测试

- **因换成上游实现而跟着改的 Osuna 测试（断言内容都没变）：**
  - `omp/session-descriptor.test.ts`「session import reads a project settings.json sessionDir」：三处标识符随上游改名（`resolveOmpProviderParams` → `resolveOmpProviderOptions`、`runtimeProviderParams` → `runtimeOptions`）。
  - `session-history/index.test.tsx`、`screens/settings/providers-section.test.tsx`：对图标模块的替换（mock）里 `getProviderIcon` → `useProviderIcon`、`resolveProviderGlyph` → `useProviderGlyph`。
  - `components/provider-icons.test.ts`：`replaceProviderSnapshotIcons` 的导入路径随上游改到 `@/data/provider-icons`。
  - `opencode/bridge.test.ts`、`styles/theme.test.ts`：只补测试数据。
- **按 Osuna 的决定处理的上游测试：** 上面两组跳过的浏览器用例；`daemon-manager.test.ts` 两条用例补参数；`generic-acp-agent.commands.test.ts` 冲突块里上游的 `initialCommandsWaitTimeoutMs` 没有取。
- **Osuna 的断言有没有被悄悄删掉：** 对相对合并前有变化的测试文件逐个比对（被删的行里、基点没有的才算 Osuna 写的）：服务端 57 个、其余 67 个，没有。上游改的都是基点自己的断言（`provider-icons.test.ts` 的两条基点用例从 `getProviderIcon` 改成 `useProviderIcon`；服务端三处见子代理记录）。
- **跑过并通过：** 全仓 `npm run typecheck`、`npm run lint`、`npm run format:check`；挪开 `.expo` 后应用包再做一次类型检查。应用包 155 个单元测试文件（1978 条，含这一段新增或改动的 40 个与冲突文件对应的）、全部 29 个浏览器组件测试文件（274 条，先挪开旧的 `.vite` 缓存）。服务端约 115 个文件（子代理逐个跑）。协议 33 个文件、客户端 4 个（改动过的 2 个与 `daemon-client`、用量相关的）、插件 SDK 3 个、relay 1 个、桌面 2 个、CLI 3 个（两个脚本式用例用 `tsx` 跑）、官网 1 个、内置插件 10 个。
- **跑了没过、没有修：**
  - `plugins/antigravity-provider/server/provider.test.ts`「reports startup auth without waiting for init forever」：期望「Run `agy` and sign in」，实际「kill EPERM」。上游的 `signals.ts` 结束进程组时只容忍 `ESRCH`，macOS 上进程组已退出时返回的是 `EPERM`。纯上游代码，本机（macOS）必挂，预期 CI（Linux）通过；上游到 v0.11.2 也没有改这一处。它在 macOS 上是用户看得见的：Antigravity 没登录时显示「kill EPERM」而不是登录提示。记给 04 核实。
  - `packages/server/src/server/agent/mcp-parity.e2e.test.ts`「list_worktrees on empty repo」：这个工具在基点、Osuna、上游三边的源码里都不存在，文件本次没有改动，与合并无关。
- **没跑：** 需要真实提供方或登录的 `*.real.e2e`、`*.local.e2e`、`daemon-e2e/api-endpoint-*.e2e`、`daemon-e2e/models.e2e` 与另外 5 个较重的服务端 e2e；应用的 Playwright 用例。交给 CI。

#### 合并后核对

- 更新源：`electron-builder.yml` 这一段上游没有改，`publish` 仍是 `LFT-OXY/Osuna`。
- 桌面身份与数据目录：`appId`、`productName` 是 Osuna 的；`packages/desktop/src/main.ts` 这一段没有改动。内置插件在这一段经 `packages/server` 的 `build:lib` 拷进 `dist/server/builtin-plugins`，还没有动桌面打包配置。
- 签名与签名断言：`desktop-release.yml` 没有改动，`mac-sign.js`、`OSUNA_MAC_SIGNING_SHA1`、`Verify macOS signature` 都在。
- 只手动触发的部署工作流：四个文件的 `on:` 都只有 `workflow_dispatch`。上游只改了 `ci.yml`（+10）。
- 上游站点链接：见基线，不变。上游在 `README.md` 给两个新提供方加了两个指向上游文档站的链接，改指本仓库的 `public-docs/supported-providers.md#antigravity` 与 `public-docs/muse-code.md`。
- 翻译键：`i18n/resources.test.ts` 38 条通过。zh-CN 这一段新增的键都是中文；`chooseProjectForCommands`、`chooseModelForCommands` 里的「命令」按 Osuna 的叫法改成「指令」。`sidebar.footer.usage` 现在是「使用情况」，在 03 改。
- `COMPAT(...)`：上游新带进来四个标签名，共 14 处，版本号改写为 `v0.15.0`、日期不动：`pluginSidebarAliases`（8 处，原 v0.11.0）、`codexFastPreference`（3 处，原 v0.10.0）、`providerParams`（2 处，原 v0.10.0）、`pluginProviderLaunch`（1 处，原 v0.10.0，连同同一行的「plugin host floor」）。`providerUsageList` 是 Osuna 已有的标签名，按规则不动；上游这一段新增的几处写的是 v0.1.98 与 v0.9.3，彼此不一致，是上游原样。

#### dev 桌面端（`.dev/paseo-home`、6769，先 `npm run build:server`）

- daemon 启动时 11 个内置插件全部加载（`antigravity-provider`、`muse-provider` 与 9 个用量来源），`daemon.log` 里没有 error 级日志。
- 侧栏：顶部五项（含「用量」），底部是摘要行与图标行；有添加项目、套餐用量、设置图标，没有导入会话图标，没有分割线。
- Usage 页：总览、统计面板、热力图在；套餐卡片有数据（Claude、Codex 两个账号的窗口）；没有主机错误条。底部套餐用量图标点开的也是这一页。
- 设置：Providers 列表里有 Muse Code 与 Antigravity；插件页打开正常，显示「没有已配置的插件」（内置插件不列在这里）；主机的「价格表」页是价格表。
- 输入框：打开有历史的 Claude 智能体，轮次页脚有 token 与花费，Composer 用量条有数据。用 mock 提供方造了一个 32K / 128K 的会话：圆环显示 25%、从 12 点方向起画，悬停弹层能打开。
- 控制台：只有三条合并前就有的开发期警告（`uniProps`、`accessibilityElementsHidden`、`importantForAccessibility` 落到 DOM 上；`uniProps` 那条 09-26 的任务里已记过），以及 Providers 页里 Osuna 自己的「升级」按钮嵌在行按钮里的提示。没有未捕获异常。
- 截图带真实账号与用量数字，没有入库。

#### 留给后面的

- 03：两个 `usage` 条目的 `testID` 相撞与上面列的两个 spec；`sidebar.footer.usage` 的叫法；`usage/copy.ts` 的本地化（现在借用了别的界面的翻译键，中文界面下「重试」旁边是英文标题）；术语表里上游的四条词条（此刻有两条 Usage source）；底部摘要在这一段默认可见。
- 14：外观页的内容宽度一行是上游原样的手搓输入框，不符合 `docs/design.md`，用 Osuna 的设置组件重搭。
- 04：Antigravity 在 macOS 上没登录时显示「kill EPERM」。
- 需要维护者知道、不挡合并：OMP 的目录规则在服务端现在有两份（导入走上游的，Usage 日志根目录与诊断走 Osuna 的）。已知差别是 `PI_CODING_AGENT_SESSION_DIR` 只有导入认，这个缺口合并前就有。
- `omp/test-utils/omp-harness.ts` 里 Osuna 的 `exitProcess()` 与上游的 `processExit()` 并存，没有动。

#### 评审（Standards 与 Spec 两个维度；本工单没有 UI 验收项，没有 Visual）

- 已修：`builtinSidebarNavLabelKey` 的可选参数改为必填；`resolveCommandsView`、`resolveGlyph` 改成对象入参；`RowWithTrailingSlot` 的属性类型改用 `Pick<SidebarHeaderRowProps, …>` 与 `<Row>` 的 `size`；`getProviderIcon` 的注释改准确。
- 按评审核实后改写了上面「没有处理、会在 CI 的 Playwright 里失败的」一段（原先只写了 `testID` 相撞，漏了分割线断言、图标间距断言与 Osuna 自己的那条用例）。
- 没有改、留给后面的：`usage/copy.ts` 借用别的界面的翻译键（03）；术语表两条 Usage source（03）；内容宽度的输入框（14）。
- 判断项，照原样提交：「usage 在哪一组」的判别分散在三处（03 把两个编号的落点分开后再收拢）；`RowWithTrailingSlot` 里重抄了 `<Row>` 的高度与内边距；`forwardOsunaClientMethods` 以出处命名；OMP 目录规则两份。

#### 维护者的确认（2026-10-11，评审之后、提交之前）

- **问：** 上游为中间形态带来的浏览器用例，两组进不去的（`usage-screen.spec.ts` 5 条、`usage-settings.spec.ts` 3 条）标成跳过并写明原因，侧栏底部相关的约 10 条（含 Osuna 自己的 1 条）留到 03 改；评审认为规格写的是「改写」不是「跳过」。**答：** 按现在这样提交，侧栏那批在 03 处理；到 03 做完之前草稿 PR 上这两个 spec 是已知红灯。
- **问：** `runtime/host-runtime.ts` 的 `useHostRuntimeConnectionStatuses` 两边各修了同一个问题，按规则②应以上游为底，实施时留了 Osuna 的写法。**答：** 保留 Osuna 的写法。
- **问：** 提交后是否推送分支并开指向 main 的草稿 PR。**答：** 推送并开草稿 PR。

#### 提交、推送与草稿 PR

- merge commit `9c56f066e`（双亲 `961cc94e2` 与 `4aa2f2817`）；适配提交 `50246833d`（COMPAT 版本号、README 链接、zh-CN 两处「指令」、术语表一处代码指向、`.atw/spec` 的五条约定）。两次提交的钩子（lint、format、typecheck）都通过。
- 分支 `merge-upstream-v0-11-all` 已推到 `origin`；草稿 PR：[#16](https://github.com/LFT-OXY/Osuna/pull/16)，目标分支 main。
- 推送后在本机补跑了 Osuna 三个套餐用量入口的浏览器用例（`--project=browser`，各自起隔离的 daemon）：`provider-usage-tooltip.spec.ts`、`usage-page-plan-usage.spec.ts`、`composer-plan-usage-strip.spec.ts` 共 15 条通过。圆环提示里的套餐用量由第一个文件证明（dev 桌面端冒烟时用量条可见，提示里按设计不重复显示，没有直接看到）。
- CI 在草稿 PR 上的结果记在 03（已知红灯见上）。

#### 给 15 的「踩过的坑」候选

- 上游删掉、Osuna 还在用的行不报冲突：属性、选择器字段、`<Tooltip>` 的 `open` / `onOpenChange` 被自动合并拿掉，类型检查只抓得到一部分，其余靠 lint 的未使用变量与逐页冒烟。Osuna 自己的文件合完后看一遍 `git diff <合并前> -- <文件>`。
- 上游把「取值函数」换成 hook 时，Osuna 的测试里对该模块的替换（mock）要跟着换导出名，否则整个文件的用例一起挂。
- 上游的浏览器用例写死了上游的外观（分割线、图标间距）与中间设计的落点，不只是色值。
- 补丁分支与主线各带来一份相同的翻译键时，自动合并后对象里重复一份（`TS1117`）。

#### 推送后的 CI（`7d6392d74`）与补修

CI 20 项里 17 项通过（format、lint、typecheck、app-tests、server-tests 三个平台、desktop-tests 两个平台、cli-tests 三片、sdk-tests、relay-tests、linux、playwright 第 1 片）；playwright 第 2、3、4 片失败。失败的用例分四类：

- **预告过的侧栏两个 spec**（`sidebar-nav-settings.spec.ts` 3 条、`usage-sidebar-item.spec.ts` 4 条）：03 已处理（提交 `367e1b3cc`）。
- **设置页标题的定位（8 条，没有预告到）**：`metadata-generation-settings`、`settings-host-page`、`settings-navigation`、`plugin-management` 都经 `e2e/support/helpers/settings.ts` 的 `expectSettingsHeader`。上游把它改成找 `PageLayout` 的 `page-title`，自动合入；Osuna 的设置详情页保留了自己的页头（`settings-detail-header-title`）。改回原来的 testID。
- **`content-width.spec.ts`（1 条，没有预告到）**：上游给 Markdown 预览的阅读框加了 `testID="markdown-preview-frame"`，加在 `markdown-preview/index.tsx`；Osuna 的 Web 端走自己的 `index.web.tsx`，没有这个标识。补上（宽度已在合并时改为跟随 `theme.contentMaxWidth`）。
- **Osuna 的 `settings-providers-list-detail.spec.ts`「keeps a failed switch at the top of the detail until dismissed」（没有预告到）**：这条用例借「daemon 拒绝写 `providers.mock.*`」造一次真实的写入失败。上游这一段去掉了「自定义提供方必须声明 `extends`」的校验（没有 `extends` 的条目算作对插件提供方的覆盖，`packages/protocol/src/provider-config.ts`），写入因此成功、失败条不再出现。产品行为没有坏；改用现成的 `installDaemonConfigFailureFixture` 让第一次配置写入以 `rpc_error` 应答，断言一行没动。**这是 Osuna 测试里因上游行为变化而改的一处，列进 PR 正文。**
- 偶发、重试后通过：`rewind-menu.ui-contract.spec.ts`（已知）、`provider-settings-refresh.spec.ts`「provider model update age says just now」（上游这一段新增的用例）。

本机复核（`--project=browser`）：上述六个文件 25 条通过；`settings-providers-list-detail.spec.ts` 另有两条（宽窗与窄窗的面包屑）本机失败、CI 通过——它们取列表里的前两个提供方，本机取到的是 `codex`（报错里期望的地址是 `…/providers/codex`）；推断是本机装着真实的 Codex CLI、与 CI 的环境不同，没有进一步核实。
