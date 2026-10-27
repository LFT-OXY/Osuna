# 第 5 段冲突裁决记录

工单 06 的逐文件记录，供工单 14 写 PR 正文用。规则编号指 `docs/release.md`「冲突裁决」的三条。

## 第 5 段：v0.13.0-beta.1（`3fa625701`）

合并前分支头 `f98b93b1d`。git 报 76 个冲突文件（模拟预计 51 个首次出现；`file-pane/markdown-preview/` 的 13 个改名冲突因工单 05 先删掉而没有出现）。

### 元数据
- 13 个 package.json：版本号与 `@getpaseo/*` 内部依赖取 Osuna（0.17.0），其余取上游：根目录的 `react-dom` 与 Osuna 的 `sharp` 都留；client 加上游的 `ws`；plugin 的 react peer 取上游 `>=19.1.0 <20`；server 的 `test:integration` 以上游为底（加了 `connected-hosts/hosts.e2e.test.ts` 与 `connected hosts`），补回 Osuna 的 `api-endpoint-pi`、`api-endpoint-omp` 两个 e2e（规则 3，与前几段同样处理）。解完相对合并前的差异只有上游在版本号之外的改动（Expo 54 → 57、React 19.2.3、RN 0.86.3 等，以及 client/protocol 的新导出）。
- package-lock.json：照 `npm install --package-lock-only` 在合并前的锁上重新生成，npm 报「已是最新」却把 Expo 留在 54（本机已装的 node_modules 与旧锁让它认为满足）。改为在不含 node_modules 的临时目录里，以上游 `3fa625701` 的锁为底、补上 Osuna 独有的 34 个包条目（沿用合并前锁里的版本：tiptap 3.31.3、dagre 3.1.1、re2js 2.8.8 等）、`@floating-ui/core`/`utils` 跟着 Osuna 的 `@floating-ui/dom` 1.8.0 升一档，再跑一次 `npm install --package-lock-only` 规整（连跑两次结果不变）。npm 规整时删掉的 9 条 `packages/expo-two-way-audio/node_modules/*` 在上游自己的锁上跑同一命令也会删，不是本次引入。`npm ls --package-lock-only` 报的 invalid 与上游自己的锁相比没有新增。
- CHANGELOG.md：取合并前，逐字节相同。上游新增的 `CHANGELOG.zh-CN.md` 原样收下。
- README.zh-CN.md：5 个冲突块取 Osuna（赞助表、下载链接、文档链接、支持 Paseo 段）。README.md / ja / ko 本段无改动。
- CLAUDE.md：无冲突；上游在冲突块外加了两行文档表（`website-i18n.md`、`connected-hosts.md`）照收，另加的「When Mo requests an APK…」是上游维护者个人的打包约定，删掉。

### 文档
- docs/explorer-sidebar.md：以上游 #7424 的三端统一描述为底，「Files and Changes hide their close buttons」补回 Session history（规则 2）。会话历史与逻辑图两节的整合留给工单 07。

### server
- agent/agent-manager.ts（5 块）：上游 #7561 把 `projectAgentMessage` 换成可产出多条的 `projectAgentMessages`；以上游为底，Osuna 的 `withoutTrailingRoutingBlock` 包在四处入口外（历史导入、两处历史回放、实时时间线），`stripTrailingRoutingBlock` import 保留（规则 2 + ADR 0004）。
- agent/agent-messages/index.ts：上游把信封代码挪进 `envelope.ts`、本文件只剩转出；取上游。随代码挪走的 `COMPAT(legacySystemEnvelope)`、`COMPAT(agentMessageToolEnvelope)` 在 `envelope.ts` 里写回第 1 段已定的 v0.18.0。
- agent/agent-projections.ts：Osuna 的 `stripNullableRoutingBlock`、`toProviderSessionHandleKey` 与上游新加的列表排序函数都留（规则 3）。
- agent/agent-prompt.ts：上游 #7561 把 `sendPromptToAgent` 拆成「准备信封」与 `sendPreparedPromptToAgent`；取上游，Osuna 的 Routing block 解析接到 `sendPreparedPromptToAgent` 的 `startAgentRun` 上（ADR 0004）。`startCreatedAgentInitialPrompt` 自动合并后仍带 Routing block。结束通知里 Osuna 的权限文案在本段仍在 `agent-prompt.ts`，未丢。
- agent/create-agent/create.ts（4 块）：上游 #7407 重写 setup，删掉 `buildSessionConfig`、`setupContinuation`、`timeline-append`；冲突块取上游，只留 Osuna 的 `resolveRoutingBlock` 字段与 `withParentToolCallIdLabel` 导入（规则 3）。
- agent/tools/paseo-tools.ts：上游去掉 `worktree`，Osuna 的 `parentToolCallId` 保留。
- session.ts：上游去掉 `buildSessionConfig` 回调；只留 Osuna 的 `resolveRoutingBlock`。
- websocket-server.ts：Osuna 的 `detachUpgrade` 与上游的 `hostLinks` 都留。
- checkout-diff-manager.ts：比较模式不再写死成 `base`，改成 `compare.mode`，Osuna 的 `filesOnly` 保留。
- utils/checkout-git.ts（无冲突、编译失败）：上游把读 diff 拆进 `readCheckoutDiff`，Osuna 的按文件复用与生成文件判断用到的 `context` 没有传进去；补一个 `context` 参数。All changes 下按文件复用是否正确留给工单 09。
- agent/agent-manager.test.ts：vitest import 顺序取上游。

### protocol / client
- protocol/src/messages.ts：Osuna 的 `ProviderAccount*` 与上游的 `Hosts*` 请求、响应在联合类型里都留。新增字段与 RPC 都是可选或新 schema，`mode` 枚举只加了 `"all"`。
- client/src/daemon-client.ts：保留 Osuna 的 `normalizeCheckoutDiffCompare`（带 `filesOnly`），`mode` 不再写死 `base`。

### app：Markdown 文件预览与逻辑图（ADR 0016）
- file-pane/pane.tsx：上游 #7366 把文件标签整个改写成 `file-panels` 的面板选择，Osuna 在这里只改过「带行号打开走源码」；整份取上游。
- components/file-pane-render-mode.ts / .test.ts（上游删、Osuna 改）：接受删除。上游的 `useFilePanelChoice` 对任何带行号的打开都选 Source（`lineNavigation`），与 Osuna 的决定一致。prd 要求把 Osuna 的「行号视图」挪到上游做同一决定的地方：`file-pane/pane.tsx` 原来内联的 `location.lineStart ? navigationRevision : null` 抽成 `file-panels/choice/model.ts` 的 `filePanelLineNavigation(location, revision)`，注释写明逻辑图节点文档的 `lineView: "preview"` 同样开 Source（评审后补）。Osuna 的 4 个 `filePreviewRenderKindForLocation` 用例挪进 `file-panels/choice/model.test.ts`，先经 `filePanelLineNavigation` 再交给选择模型，节点文档与 HTML 两条照原样传 `lineView: "preview"`（无行号的 Markdown 开预览；普通行号、逻辑图节点文档、HTML 行号开 Source），断言意思不变。`lineView` 仍由 `logic-map/node-doc.ts` 写进位置、随标签持久化。
- logic-map/panel-surface.tsx：上游删了 `file-explorer/read-result.ts`，读节点文档改用上游新的 `utils/decode-utf8`，非文本文件返回 null，行为不变。

### app：Explorer（上游 #7424，细节适配在工单 07）
- 接受删除 `compact-explorer-sidebar.tsx`、`compact-explorer-sidebar-host.tsx`、`stores/explorer-tab-memory.ts`；`keyboard/shift/internal/policy.ts` 里只给被删侧栏用的函数一并删掉。
- workspace-tabs/explorer-sidebar.ts：`ExplorerSidebarView` 保留 Osuna 的 `"sessions"`，`Presentation` 取上游（去掉 `"pane"`）。
- stores/panel-store/state.ts：上游删掉按检出记标签的那套；`ExplorerTabSchema` 保留 `"sessions"`。
- agent-stream/view.tsx：保留 Osuna 抽出的 `openExplorerView`；上游从 Explorer 查询里去掉了 `checkout`，跟着去掉。
- stores/workspace-layout-store.ts：上游把持久化改成可复用的 `createPersistedStateProjection`；以上游为底，补回 Osuna 的 `explorerSidebarSeededTabKindsByWorkspace`、`logicMapTabAutoOpenedByWorkspace`（后者加进 `PERSISTED_SLICES`）。
- screens/workspace/workspace-desktop-tabs-row.tsx（12 块）：标签底色取上游 `resolveWorkspaceTabChipBackdrop` 与 `rail`，Osuna 的 `restBackdrop`/`resolveChipBackdrop` 去掉；保留 Osuna 的「没有关闭按钮的标签不留关闭位」（`tabWithCloseSlot`）。底色换回 Osuna 的 `surfaceTabHover`/`surfaceTabActive` 留给工单 07。
- screens/workspace/use-workspace-tab-layout.ts：依赖两边合并（`compact` + `tabCloseSlots`）。
- workspace-tab-layout.test.ts（Osuna 用例）：上游给布局输入加了必填的 `compact`，补 `compact: false`，断言不变。
- explorer-sidebar.test.ts、session-history/internal/open-terminal-tab.test.ts（Osuna 用例）：去掉上游删掉的 `supportsPaneSplits`、`checkout` 参数。

### app：Changes（All changes 的行为在工单 09）
- git/use-diff-query.ts：Osuna 的订阅结构（`resolveCheckoutDiffSubscription`、`onFiles`）为底，接上上游的 `checkoutDiffAll` 能力位：host 不支持时不订阅并给出升级提示；订阅输入的 `mode` 加 `"all"`。
- data/push-router.ts / .test.ts：两边都留——`filesOnly` 读取 + 上游的 `"all"`；测试类型加 `"all"`，Osuna 的「清单订阅」用例与上游把「subscribes active…」改写成的 `it.each(["base","all"])` 都留（Osuna 没改过原用例正文，已核对相同）。

### app：套餐用量（上游 `providerUsage` 键全面替换在工单 08）
本段只做到能编译、Osuna 行为不丢。上游把同一批文案换成 `providerUsage.*` 并给格式化函数加 `now`、`t` 参数，凡是两边做同一件事的地方以上游为底（规则 2），Osuna 独有的留：
- copy.ts：取 Osuna（`usage.planUsage.*` 的全部条目仍被 Osuna 独有的界面使用）；`problem` 加上游的可选 `t` 参数。
- format.ts、balance-bar.tsx、pinned.ts、card.tsx 的状态与更新时间、sidebar-item.tsx、options.tsx：取上游（同一句话的上游写法）。`model.ts` 保留 Osuna 的 `planUsageAccountNames`、`formatUsageFreshness`（Osuna 测试仍在用，工单 08 处理去留），`COMPAT(usageLoginErrors)` 写回 v0.15.0。
- window-bar.tsx：上游的 `now` 时钟与带 `t` 的格式化为底，补回 Osuna 的用量计数、上限标记与「用完时间已过就显示重置时间」（Osuna 对所有读数如此，上游只对保留的旧读数）；值的换行样式取 Osuna 的 inline/wrap 两种布局。
- queries.ts：上游的 `t` 参数 + Osuna 的 `cliSignInsOff`。
- agent-usage.tsx：import 两边都留。card.tsx 保留 Osuna 的 Codex 剩余重置次数行。
- format.test.ts / model.test.ts：import 合并，Osuna 用例都留。
- 本段跑测试时，为让冲突文件对应的 Osuna 用例通过，提前做了工单 08 的一小部分：en 的 `providerUsage.hostUnavailable`、`hostUpgradeRequired`、`agentError` 写回 Osuna 的「plan usage」；zh-CN 的 `hostUnavailable`、`hostUpgradeRequired`、`agentError`、`values.used`（「已用」）、`duration.*`（`{{value}}d/h/m`）、`timing.resetsIn`、`timing.runsOutIn` 写回 Osuna 译法；`duration.*` 三个键加进中文英文白名单的 abbreviations。`formatRunsOutLabel` 保留 Osuna「用完时间已过不返回」的写法（上游的 `runsOutNow` 键因此暂时无人引用，08 处理）。
- **因换成上游实现而改动的 Osuna 断言（PR 正文要列）**：`usage/format.test.ts` 的 `formatDisplayPct(31, "used")` 从 `"31%"` 改为 `"31% used"`（en）与 `"已用 31%"`（zh-CN），用例名跟着改（prd 用户故事 32）；`usage/pinned.test.ts` 中文用例里 `"Codex Weekly"` 改为 `"Codex 每周"`（上游 #7376 起已知窗口名按界面语言写）。
- **其余跟着改的 Osuna 用例（只改调用或准备步骤，断言不变）**：`workspace-tab-layout.test.ts` 补 `compact: false`；`explorer-sidebar.test.ts`、`open-terminal-tab.test.ts` 去掉上游删掉的 `supportsPaneSplits`、`checkout`；`explorer-sidebar.test.ts` 的「selects Session history in the compact Explorer」把 `usePanelStore.explorerTab === "sessions"` 改为断言布局里 Explorer 聚焦的是 `session_history`（上游删了 panel store 的 explorerTab）；`theme.test.ts` 插件夹具补 `locale`、`i18n`、`filePanels`；`logic-map/draft-logic-map-store.test.ts` 在写入前先 `await before.persist.rehydrate()`（上游 #7410 起存储读取期间的写入会被丢掉）。
- 中文界面这段期间会显示上游的「已使用」「刷新中...」等措辞，工单 08 改回 Osuna 译法。

### app：其余
- components/add-host-modal.tsx：上游把连接失败文案挪到 `connection-failure-copy.ts`。以上游为底，Osuna「密码被拒只给本地化原因」的行为搬进新文件（加 `authFailure` 标签，规则 2）。上游新用例「preserves authentication failures and their technical details」断言英文原文作详情，与 Osuna 的决定（`9be046d8c`）相反，**按 Osuna 改写**为「只给本地化原因、raw 为 null」（PR 正文要列）。
- components/adaptive-modal-sheet.tsx：RN 0.86 去掉 `absoluteFillObject`，取上游的 `absoluteFill`；Osuna 的遮罩与卡片样式（`desktopScrim`）保留，scrim 也改用 `absoluteFill`。`composer/agent-controls/thinking-slider.tsx` 同理（编译失败暴露）。
- components/status-ring/clock.ts：以上游为底（每个环自己的 rotation、保留面板不活跃时不接时钟），补回 Osuna 的 `enabled`（减少动态效果时不接时钟）。上游新的手机端测试壳 `e2e/mobile/status-ring/native.tsx` 跟着传 `{ enabled: true }`。
- components/left-sidebar.tsx：import 取 Osuna，删掉不再使用的 `X`。
- panels/agent-tracks.tsx：上游 #7370 让子 Agent 按地址（`serverId` + `agentId`）打开、跨主机时导航过去；Osuna 已把打开逻辑抽成 `subagents/use-open-subagent.ts`（派发组共用）。冲突块取 Osuna，上游的跨主机处理搬进 hook（`openSubagent` 收 `AgentAddress`），`agent-panel.tsx` 给派发组包一层本机地址（派发组只列本机子 Agent，远端进派发组是后续工单）。
- plugins/surface-screen.tsx：取上游（插件翻译解析标题与内联 SVG 图标），兜底标题仍走 Osuna 的 `pluginSurface.fallbackTitle`。
- plugins/themes/index.ts：Osuna 的撞名限定词与上游的插件翻译合在一起：显示名先按插件翻译解析，撞名判定看解析后的名字。
- runtime/host-runtime.ts：import 两边合并。
- screens/settings-screen.tsx、settings/sidebar/sidebar-nav-section.tsx：插件图标解析改名 `resolvePluginIcon` → `pluginIconComponent`，Osuna 的标题图标与 header 图标两处跟改；插件设置页标题加上游的翻译解析。
- styles/theme.test.ts（Osuna 用例）：插件夹具补上游新加的必填字段 `locale`、`i18n`、`filePanels`。
- test-stubs/react-native-unistyles.ts、vitest.config.ts：两边都留（Osuna 的逻辑图色板与 Reanimated 桩；上游的语法色、用量组件编译与翻译资源打包插件）。
- usage/pinned.test.ts（上游用例）：上游在用例里动态 import `i18n`，与 Osuna 文件顶部的 import 重名，lint 报遮蔽；删掉那行动态 import。

### e2e
- add-changed-file-to-chat.spec.ts：取上游（按 1400/390 两种宽度跑），读 Composer 文字改用 Osuna 的 `expectComposerText`（Tiptap，prd「Composer」）。
- changes-pane.spec.ts：代码字体用 Osuna 的字体选择器步骤。
- usage-settings.spec.ts：冲突块取 Osuna（从壳打开用量页、`usage-plan-usage-card`、`"23%"`）。冲突块之外上游把 `"70%"`、`"64%"` 两条断言改成 `"70% used"`、`"64% used"`（#7376，用量行写明已用或剩余），自动合并进来，与 prd 用户故事 32 一致，保留（PR 正文要列）。
- support/helpers/subagents.ts：Osuna 的派发组辅助与上游的连接主机辅助都留，import 合并。
- website/src/data/sponsors.test.ts：取 Osuna（README 不放赞助表）。

### i18n
- zh-CN.ts：Osuna 的 Git 文案（「未提交的更改」等）保留，上游新键 `all` 译「全部更改」；上游新加的 `filePanels` 照收，`directoryMissing` 用 Osuna 的「未找到工作区目录。」。
- 内置文件面板的提供者名 `panels.file.filePanels.builtin.owner` 九种语言从 `Paseo` 改为 `Osuna`：它在「打开方式」菜单里显示成「Markdown — Paseo」，是界面上的应用名，Osuna 的应用名（`sidebar.help.appName`、会话历史里的来源名）都写 Osuna（规则 1，ADR 0002 的显示身份）。它加进 `resources.test.ts` 中文英文白名单的 `brands`，格式名 `builtin.markdown`、`builtin.html` 加进 `abbreviations`。
- 上游 zh-CN 新键里 `providerUsage.*` 的措辞（「已使用」「提供商」「刷新中...」）不符合术语表，按 prd 由工单 08 改回；`settings.files.*`、`filePanels.*` 是真实译文。

### 适配提交
- `COMPAT(...)` 新名字 7 个改写为 v0.18.0：`checkoutDiffAll`、`fileByteWrites`×5、`fileVersionKind`、`pluginReactNativeEntrypoint`×3、`pluginSettingsGroup`×2、`workspaceSetupCombinedLog`、`workspaceSetupObservation`×3（e2e 辅助里那处没写版本，不动）。
