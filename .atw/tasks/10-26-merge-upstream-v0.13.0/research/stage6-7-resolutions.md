# 第 6、7 段冲突裁决记录

工单 12 的逐文件记录，供工单 14 写 PR 正文用。规则编号指 `docs/release.md`「冲突裁决」的三条。

## 第 6 段：v0.13.0-beta.2（`30d8cb044`）

合并前分支头 `2c350eeb2`。git 报 45 个冲突文件（模拟预计 19 个首次出现），另有 1 个上游删、Osuna 改。

### 元数据
- 13 个 package.json：版本号与 `@getpaseo/*` 内部依赖取 Osuna（0.17.0）。server 的 `test:integration` 以 Osuna 一侧为底（含 `api-endpoint-pi`、`api-endpoint-omp`），补上游新加的 `-t` 过滤词 `password-protected daemon refuses`（规则 3）。解完相对合并前只多出上游在版本号之外的改动：app 删 `build:terminal-webview` 脚本与 `eas-build-post-install` 里的调用，relay 加 `@noble/ciphers`、`@noble/curves`、`@noble/hashes`。
- package-lock.json：在只放各 package.json 的临时目录里，以合并前的锁为底跑 `npm install --package-lock-only --ignore-scripts`，连跑两次不变；相对合并前只多出三个 `@noble` 包条目与 relay 的三条依赖声明，与上游这一段锁的改动一致。
- CHANGELOG.md：取合并前，逐字节相同。

### 文档
- docs/glossary.md：Osuna 的「Generated file」与上游的「Last prompt」两条都留（规则 3）。
- docs/release.md：发版清单那一行取上游（多了提交 `CHANGELOG.zh-CN.md` 一句），后面补回 Osuna 的「刷新内置价格快照」一项（规则 3）。

### server
- session-admission-auth.ts：上游 #7668 删掉 `COMPAT(relayPasswordOptional)` 免密分支，取上游（prd「中继密码」，维护者 2026-10-26 确认）。
- bootstrap.ts：Osuna 的 `resolveMutableUsageSection`、`resolveMutableCliSignIns` 与上游的 `createInitialRelayConfig` 都留（规则 3）。解完不含提供方名字（`claude.test.ts`「keeps provider names out of the generic server bootstrap」）。
- agent/agent-prompt.ts：上游 #7683 把结束通知整段搬进 `agent/finish-subscriptions/`；Osuna 在这一段里只改过权限那句文案。取上游的删除，文案搬进 `finish-subscriptions/internal/notification.ts` 的 `formatFinishNotificationBody`，上游的 `host unreachable`、`host removed` 两种原因与 `serverId` 照收（prd「连接的主机与 Agent 间消息」）。
- agent/agent-prompt.test.ts：上游删了全部结束通知用例（挪到 `finish-subscriptions.test.ts`）；保留 Osuna 的 `appendRoutingBlock` 与「发送者信封后 Routing block 仍在末尾」两条。Osuna 唯一的断言改动（权限文案原文）挪进 `finish-subscriptions.test.ts`「permission checkpoint retains intent…」，断言原文不变。
- agent/create-agent/create.ts：import 去掉不再使用的 `setupFinishNotification`，留 Osuna 的 `RoutingBlockResolver`。
- agent/providers/claude/agent.test.ts：Osuna 的「drops the Routing block from import previews」与上游 #7626 的导入列表权限用例都留（规则 3）。上游重写的会话列表仍经 `normalizeImportablePromptPreview` → `stripTrailingRoutingBlock`。
- workspace-git-service.ts（无冲突、编译失败）：上游 #7681 把 `peekSnapshot` 改成私有的 `getCachedSnapshot`；Osuna 的 `peekRepoRoot` 改调新名字，仍只读缓存、不跑 git。

### app
- components/terminal-emulator.tsx：上游 #3795 把拖入文件挪出这个组件，import 块取上游，只留 Osuna 的 `SPACING`（四边内边距 `contentInset` 在块外，照留）。
- components/terminal-copy-paste-actions.tsx：上游把 `hasClipboardText` 改成 `hasClipboardContent`（粘贴图片），Osuna 的翻译文案 `workspace.terminal.paste` 保留。
- terminal/webview/terminal-emulator-webview-html.ts（上游删、Osuna 改）：接受删除（上游 #7639 去掉 WebView 渲染器，连生成脚本一起删了）。设置页、存储与 `resources.test.ts` 里的 `useLegacyTerminalRenderer` / `legacyTerminalRenderer` 都已随上游清掉，Osuna 没有别的引用。
- components/ui/autocomplete-popover.tsx：上游 #7679 改用 `useKeyboardAnchor` 与 `KeyboardTranslateView` 跟随键盘；以上游为底，补回 Osuna 的左右内缩 `PANEL_INSET`、底边贴住 Composer 顶边（不加 `OFFSET_FROM_ANCHOR`）、上沿留白 `TOP_CLEARANCE`、置灰行判断与额外属性（规则 2）。
- screens/workspace/workspace-tab-presentation.tsx：上游 #7690 把状态点、运行环、待输入图标抽进 `components/status-icon.tsx`；取上游，Osuna 的两个无障碍文案（`workspace.tabs.status.agentRunning`、`agentNeedsInput`）搬进 `StatusIcon`（规则 2）。`StatusIcon` 的描边表补上 Osuna 多出的 4 个背景表面名（`surfaceCard`、`surfaceSidebarActive`、`surfaceTabHover`、`surfaceTabActive`），否则类型不通过。
- plugins/workspace-panels/panel.tsx：import 两边都留（上游 `useState`，Osuna `useTranslation`）。
- stores/workspace-layout-store.ts：Osuna 的 `autoOpenLogicMapTab` 与上游 #7685 的 `deferOpenTab`、`consumePendingOpen` 都留。
- stores/session-store-hooks/selectors.test.ts：Osuna 的 `selectProjectWorkspaceDirectories` 用例与上游的排序用例都留。
- logic-map/panel-surface.browser.test.tsx（无冲突、类型失败）：上游 `ToastApi.show` 改为返回关闭函数，测试里的假提示跟着返回空函数，断言不变。
- file-panels/choice/model.test.ts（无冲突、用例失败）：上游 #7614 把 Markdown、HTML 的 Source 做成内置面板里的视图，「带行号的目标打开内置面板并切到 Source」。Osuna 从 `file-pane-render-mode.test.ts` 挪来的 3 条（普通行号、逻辑图节点文档、HTML 行号）断言从 `builtin:source` 改为 `builtin:markdown` / `builtin:html`；切到 Source 由面板的 `useTextFileView` 决定，`file-editing.spec.ts` 补一条「Markdown 行号目标开源码视图」与上游的 HTML 用例并列。

### i18n
- 九种语言：终端新增的 `fileUploaded`、`pasteFileFailed`、`uploadingFile` 与 Osuna 的终端按钮文案都留；元数据生成的 `fallbackHint` 换成上游的 `modelHint`，值里的 “Paseo” 改 “Osuna”，上游放回的 `docs` 不收（feature-overlap 3.2 第 5 条）。
- 上游新增键的 zh-CN：`sort.*`（排序、创建时间、最近提示词、请更新主机以排序工作区）、`preview`/`source`（预览、源代码）、上面三条终端文案，都是真实译文、符合术语表（提示词、主机）。

### e2e
- plugin-file-panel-examples.spec.ts、helpers/markdown-file-panel-plugin.ts：上游 #7614 去掉了独立的 Source 面板，helper 导出的 `SOURCE_OPTION` 删掉、单选数断言取上游（`toHaveCount(2)`）。Osuna 原来那行只是把面板名改成 “Source — Osuna”。`plugin-file-panel-settings.spec.ts` 里上游另起的本地 `SOURCE_OPTION` 留着，名字在适配提交改成 Osuna；“Open with…” 里的 “Markdown — Paseo” 两处评审后改 Osuna。
- sidebar-nav-settings.spec.ts：上游的 `expectCompactSidebarOpen` 与 Osuna 的 `expectNoFooterRule`（Osuna 侧栏底部不画分割线）合起来。
- terminal-protocol-query.spec.ts：Osuna 的深色背景常量与上游的文件粘贴脚本、辅助函数都留。
- helpers/seed-client.ts：Osuna 的 `SeedAgentUpsert` 返回类型与上游新加的 `cancelAgent` 都留。

### 适配提交
- `274385b24`：上游新带进来的 6 个 `COMPAT` 名字改写为 v0.18.0（日期不动）；`plugin-file-panel-settings.spec.ts` 里上游写的 “Source — Paseo” 改 “Source — Osuna”（断言是 `toHaveCount(0)`，不改名会恒真）；`file-editing.spec.ts` 补 Markdown 行号用例；术语表 Last prompt 补 zh-CN 叫法。

## 第 7 段：v0.13.0（`d34d17a90`）

合并前分支头 `274385b24`。git 报 22 个冲突文件（模拟预计 5 个首次出现）。

### 元数据
- 13 个 package.json：只差版本号，取 Osuna（0.17.0）；解完与合并前逐字节相同。上游这一段锁文件只改了内部包版本号，重新生成后与合并前逐字节相同。
- CHANGELOG.md 取合并前，与工单开始前（`2c350eeb2`）逐字节相同。上游更新的 `CHANGELOG.zh-CN.md` 原样收下。
- 安卓商店说明 `130001`–`130004`（add/add）：留 Osuna 的。`nix/npm-deps.hash` 随上游改，不追。

### app
- plugins/evaluate.ts：上游 #7780 把 `@getpaseo/plugin/client/react-native` 改指 `pluginReactNativeCompatRuntime`；取上游这一行，`COMPAT(pluginReactNativeEntrypoint)` 的版本留 Osuna 第 5 段改写的 v0.18.0。
- stores/sidebar-order-store.ts：上游 #7771 恢复手动排序时删掉了 `COMPAT(automaticWorkspaceOrder)` 那段兼容；取上游的删除（Osuna 一侧只改过版本号）。
- e2e/settings-toggle-tab-regression.spec.ts：上游改成只取可见的 `message-input-root`，Osuna 读 Tiptap 的 `[role="textbox"]`，两者合起来。

### 核对
- 本段没有新的 `COMPAT` 名字；外链数不变；`.github`、桌面打包配置与主进程、协议、`bootstrap.ts`、文档本段都没有改动。新增翻译键只有 `manual`（zh-CN「手动」）。
- 本段新增或改动的 16 个测试文件里没有 Osuna 的断言行被删。
