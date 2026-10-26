# 第 2–4 段冲突裁决记录

工单 04 的逐文件记录，供工单 14 写 PR 正文用。规则编号指 `docs/release.md`「冲突裁决」的三条。

## 第 2 段：v0.12.0-beta.2（`c517d07d6`）→ merge commit `16d847b51`，适配 `4633a4393`

合并前分支头 `223d38be0`。git 报 31 个冲突文件（模拟预计 12 个首次出现；另 19 个是版本号、锁文件与第 1 段已解过又被上游改到的文件）。

### 元数据
- 13 个 package.json：冲突块全是版本号，取 Osuna（0.17.0）。解完与合并前逐字节相同：上游这段没改依赖。
- package-lock.json：取合并前版本后 `npm install --package-lock-only --ignore-scripts` 重新生成，与合并前相同。
- CHANGELOG.md：取 Osuna，与合并前逐字节相同。

### server
- agent-manager.ts（import）：两边都留——上游 #7169 新用的 `parseAgentMessage` + Osuna 的 `stripTrailingRoutingBlock`（规则 3）。上游用它的 `tryRunOutOfBand` 在 Routing block 追加之前执行（`agent-prompt.ts` 先走 out-of-band 再 `withRoutingBlock`），不影响 ADR 0004。
- opencode/bridge-plugin.mjs：Osuna 的 `toolCallIdHeader` 与上游 #7183 的 `formatErrorDetail` 两个函数都留（规则 3）。拼接时 git 冲突块外的公共结尾 `}` 写了两遍，构建时 esbuild 报出，已删。
- opencode/bridge.test.ts、tools/paseo-tools.ts（import）：两边都留（Osuna 的逻辑图工具与 `PaseoToolExecutionContext`、上游的 `PaseoToolInputError`）。

### app
- e2e/browser/launcher-tab.spec.ts：上游 #7245 合并重叠用例，删掉「tab bar shows action buttons per pane」及其两个辅助断言（上游自己的用例，Osuna 没改过）；Osuna 新加的「active tabs keep their close button…」用例保留。
- agent-stream/view.tsx：上游 #7205 把聊天里的路径点击改成 `createInlinePathOpener`（文件夹链接在 Files 里展开）。以上游为底（规则 2），保留 Osuna 抽出的 `openExplorerView`（Changes 按钮共用，按 `isGitCheckout` 判断是否 git），上游的 `openInlineDirectory` 改为 `revealDirectory` 后调 `openExplorerView("files")`。
- components/sidebar/sidebar-nav-rows.tsx（import）：两边都留（Osuna 的 BarChart3 + 上游的 ReactNode）。
- composer/input/input.tsx：上游 #7214 只把手机 Composer 的硬编码阴影换成 `theme.shadow.sm`；Osuna 的输入组件没有这条样式，取 Osuna，文件与合并前相同。同一提交把浅色主题 `shadow.sm` 从 0.02 调到 0.08，`theme.ts` 自动合并进来——Osuna 里用 `shadow.sm` 的只有聊天「滚到底部」按钮，浅色下阴影略深，theme.test 通过；不涉及设置页外观与 Osuna 色板，照收。
- screens/open-project-screen.tsx：上游 #7167 改成可滚动（矮屏也能点到按钮），以上游为底，Logo 换回 `OsunaLogo`；上游这里去掉了 `TitlebarDragRegion`，照收。
- screens/new-workspace-screen.tsx（3 块）：上游 #7239 把表单的展示代码挪到 `screens/new-workspace/form/`（约 990 行）。冲突块取上游；Osuna 在被挪走代码里的改动是文案走翻译键，补到 `form/index.tsx`：主机名兜底、项目与隔离的无障碍标签、项目搜索占位与空列表（键是 Osuna 已有的 `newWorkspace.fields.host`、`newWorkspace.accessibility.*`、`newWorkspace.projectPicker.*`）。Osuna 在保留部分的改动（行内块 segments、`projectUnavailableMessage`、终端 `viewAttributes`、错误文案翻译键）git 自动合并，import 两边都留。`new-workspace-launch/launch-control.tsx` 随上游改名到 `form/`，Osuna 没改过它。
- components/question-form-card.tsx（6 块）：上游 #7098 给作答失败加提示并允许重试。Osuna 把卡片重做成编号行（状态在 `question-form-card-core.ts`），冲突块取 Osuna；Osuna 已有 `isResponding` 防重入与「只在作答中显示加载」，补上的只有 `responseError` 属性与错误提示（放在选项与底部按钮之间）。
- i18n ar/fr/ja/ko/ru：两边都加了 `newWorkspace.fields.host`，Osuna 写的是英文占位，取上游的真实译文。en/es/pt-BR/zh-CN 自动合并；zh-CN 新键 `dictation.paused`「麦克风已中断，正在等待恢复…」、`message.question.responseFailed`「未能发送你的回复，请重试。」、`newWorkspace.fields.branch`「分支」是真实译文。上游删掉的 `fields.base` 在 Osuna 里没人用。

### 适配提交
- `COMPAT(dictationCapture)`（expo-two-way-audio/src/core.ts）写的是「added after v0.11.2」，改写为 `added in v0.18.0`，日期不动。

### 核对
- 合并后核对：更新源、appId / productName、userData、签名三项、四个部署工作流只手动触发、上游站点链接 app 74 / 1、cli 13 / 3（与合并前相同）、版本号全 0.17.0、CHANGELOG 相同、`bootstrap.ts` 本段未改、CI 没有新的装 Playwright 的非 24.04 作业。协议、桌面、.github 本段无改动。
- 测试：本段新增或改动的 23 个测试文件中，去掉 3 个 `*.real.*` 真实提供方用例，其余逐个单独跑过并通过；另跑 `resources.test.ts`、`theme.test.ts`、`question-form-card.browser.test.tsx` 与 `screens/new-workspace/` 下 5 个测试，全部通过。
- 被删的测试行：用脚本比对「合并后删掉、且不在合并基点 e2f4948f9 里」的行，没有 Osuna 的断言被删。被删的都是上游 #7245 合并重叠用例时删的上游自己的用例。

## 第 3 段：v0.12.0-beta.3（`cc748dfe1`）→ merge commit `a5eb7c89a`，适配 `bba9d2374`

合并前分支头 `4633a4393`。git 报 31 个冲突文件（13 个版本号、锁文件与 CHANGELOG，其余 18 个是代码）。

### 元数据
- 13 个 package.json 冲突块是版本号，取 Osuna。另有 server 的 `test:integration`：上游把后几条 `-t` 用例合成一次 vitest 调用，以上游为底补回 Osuna 的 `api-endpoint-pi`、`api-endpoint-omp` 两个 e2e（规则 3，与第 1 段同样处理）。解完 package.json 与合并前的差异只有这一行；锁文件重新生成后与合并前相同。CHANGELOG 取合并前。

### 协议
- messages.ts：上游 #7246 把「可用」的用量报告抽成 `AvailableUsageReportSchema`（也用于新加的 `lastSuccessful`）。以上游为底（规则 2），Osuna 的 `resets`、`held`、`onCredits` 三个可选字段并进这个 schema。新增字段 `lastSuccessful`、`successfulAt` 都是可选的。
- messages.wire-compat.test.ts：Osuna 的旧客户端解析接口列表用例与上游的用量快照兼容用例都留；协议现有断言未改。

### server：用量来源（ADR 0015 与 #7246 并存）
- plugins/usage-sources/index.ts（3 块）：以上游的「最近一次成功的快照」为底（`successful`、`activeCacheKeys` 清理、发现失败时沿用上次映射、`fetchedAt` / `completedAt` 分开），保留 Osuna 的遗忘代数（`generation`：`forget()` 之前开始的读取回来时不写缓存也不写快照）、`consumesResets`、存着的号（`savedAccount`）读取与 `answeredBy`。全局发现改成 `discover({ kind: "global" }, this.defaults)` 后再判代数。`forget()` 另清空 `successful`：下一次列举本来就会把不在名单上的快照清掉，这一行让「关掉读取 CLI 登录凭证后不留读数」不依赖那次列举。
- index.test.ts：两边用例都留。上游新用例用的是旧的位置参数构造函数，Osuna 早已改成选项对象，按 Osuna 的签名改写（`{ now }`、`{ agents }`、`{ now, deadlineMs }`、`{ now, logger }`），断言不变。新加两条并存用例：关掉读取 CLI 登录凭证后之前的成功读数不再作为 `lastSuccessful` 出现、关掉前开始的读取不留快照；Agent 启动时的号在 CLI 换号后，用它自己存着的登录读失败时，留着的是它自己上次成功的读数。
- agent/mcp-server.test.ts（import）：两边都留。上游新用例「每个对外工具都有时间线标签」挂在 Osuna 的 `read_logic_map`、`update_logic_map` 上：在上游的 `protocol/src/paseo-tool-presentation/catalog.ts` 补两条，标签与 server 注册时的 title 一致（规则 3）。

### app：套餐用量
- usage/card.tsx：上游把 `reportContent` / `reportMessages` 挪进 `model.ts` 的 `resolveUsageReport`，冲突块取上游；Osuna 在这里只改过 COMPAT 版本号，随挪到 model.ts 的那一行保留 Osuna 的 `v0.15.0`（适配提交）。
- usage/format.ts、model.ts、window-bar.tsx、card.tsx：上游 #7246 新加的硬编码英文「Reset time passed」「Last updated」「No successful update」改走 Osuna 的文案模块：`usage/copy.ts` 加 `resetTimePassed`、`lastUpdated(ago)`、`noSuccessfulUpdate`，九种语言补 `usage.planUsage.*` 三个键（zh-CN「已过重置时间」「最后更新于{{ago}}」「尚未成功更新」）。Osuna 的「用完时间已过就不写 runs out、改显示重置时间」本来就对所有读数生效，比上游只对保留的旧读数这样做更严，保留 Osuna 写法，只把 `retained` 传给重置时间。
- usage/format.test.ts：两边用例都留（上游的英文断言在默认语言下照常成立）。
- e2e/support/helpers/usage-login.ts、cli/commands/usage/presentation.ts：两边新加的函数都留（Osuna 的重置用例辅助、凭证关闭说明；上游的新鲜度断言、`availableDetails`、`successfulTime`）。

### app：Markdown（维护者 2026-10-26 决定：块间距用上游的统一间距）
- 上游 #7298 把聊天 Markdown 改成「每一块后面同一个间距」（`density.blockGap`：窄 12、宽 16），并在依赖补丁里让渲染库把代码块覆盖层包在同样的边距里；Osuna 在工单 02 迁过来的样式里各块有自己的上下边距（段落 12 / 窄 8、标题上多下少、代码块与表格上下 12、图片 8、分割线 10）。这会改变用户看到的段距，按规则问了维护者，答「用上游的统一间距」。
- components/markdown/styles.ts：签名改成上游的 `{ compact, blockGap }`，所有块用上游的 `block`（上 0、下 blockGap）；Osuna 的字号档位、86% 色调、标题 semibold、compact 只降标题档、代码块与引用块与表格外观都保留。Web 代码块外框 `createCodeBlockFrameStyle` 去掉 `marginVertical`（间距由渲染库照 codeBlock 的边距包在外面，不去掉会翻倍）。
- components/markdown/renderer.test.ts：**因这条决定改动的 Osuna 断言（PR 正文要列）**：段落下边距 `spacing[3]` → `16`（宽）；compact 段落下边距 `spacing[2]` → `12`；Web 代码块外框的 `marginVertical: spacing[3]` 改为断言外框不带 `marginVertical`。其余调用跟着签名改成 `{ blockGap: 16 }` / `{ compact, blockGap: 16 }`，字号、颜色、外框等断言不变。
- fence/mermaid/presentation.ts：上游去掉图框的边距（由块间距负责），Osuna 的「四边取水平内边距」保留。
- fence/mermaid/host.web.tsx：上游去掉把源码视图边距拆到外层的逻辑（`textStyle` 不再带边距）；Osuna 把「查看图表」按钮挪进代码块头部（`renderHeaderActions`）、删掉了 `sourceContainerStyle`，两边合起来是源码视图直接用 `textStyle`、外层是不带样式的 View。

### app：其余
- composer/draft/workspace-tab.tsx：Osuna 的逻辑图草稿键与上游 #7303 的 `isConnected` 都留。

### 适配提交
- `.github/workflows/ci.yml`：上游把 Playwright 从 4 片扩到 8 片，新增的 `playwright-5`–`playwright-8` 是 `ubuntu-latest`，改成 `ubuntu-24.04`（#24 的原因：ubuntu-latest=26.04 装不上 Playwright）。
- `COMPAT(usageLastSuccessful)`、`COMPAT(usageSuccessfulAt)`×2 改写为 v0.18.0；随代码挪进 `usage/model.ts` 的 `COMPAT(usageLoginErrors)` 写回 Osuna 原来的 v0.15.0（这个名字合并前就有）。

### 核对
- 合并后核对：身份、更新源、签名、部署工作流、外链（app 74 / 1、cli 13 / 3）、版本号、CHANGELOG 都与合并前相同；上游本段改了 `.github/workflows/ci.yml`（8 片 Playwright 等，新分片已固定 24.04）与 `desktop/e2e/workspace-restart.spec.ts`，桌面打包配置与主进程未动。
- 测试：本段新增或改动的 28 个测试文件（去掉 `*.real.*`）加上 `resources.test.ts`、`usage/` 与 `plan-usage/` 下全部测试、Markdown 与 Mermaid 相关测试、`assistant-selection-copy` 浏览器测试，逐个单独跑过并通过。`mcp-server.test.ts` 第一次因逻辑图工具缺标签失败，补目录后通过。
- 被删的测试行：只有 `renderer.test.ts` 里因维护者决定改的三条间距断言与跟着改签名的调用，见上。

## 第 4 段：v0.12.0（`cafe4b01c`）→ merge commit `80515069f`，适配 `17dc4c830`

合并前分支头 `bba9d2374`。git 报 26 个冲突文件。

### 元数据
- 13 个 package.json 冲突块只有版本号，取 Osuna；解完与合并前相同，锁文件重新生成后与合并前相同；CHANGELOG 取合并前。
- 安卓商店说明 `120001–120004.txt`（add/add）：Osuna 自己发过 0.12.0，同名文件留 Osuna 的（逐字节同合并前）。

### 文档
- docs/design.md：上游 #7364 在 §2 那段加了「图标按钮用 ToolbarButton、菜单行用 MenuItem / ComposerTrackRow、其余行用 PressHighlight」，并加了 `no-raw-pressable` 一条；Osuna 在同一段改过 SettingsSection 的路径（`components/settings/headings/`）与「确认框需要细节时用 AdaptiveModalSheet（§6）」。以上游为底，Osuna 两处改动补回（规则 3）。

### 代码规范检查（`paseo/no-raw-pressable`）
- 上游这段在 `.oxlintrc.json` 加了规则与 94 个文件的豁免名单，注释写「只许移出」。全仓 lint 在 Osuna 的 21 个文件上报错（prd 估计约 27 个）：`agent-stream/turn-changed-files-card.tsx`、`agent-stream/turn-usage-segment.tsx`、`api-endpoints/` 下 5 个（agent-section、connection-form-sheet、host-list-section、models-section、request-extras-fields）、`components/branch-switcher.tsx`、`components/provider-catalog-list.tsx`、`components/usage/` 下 5 个（usage-details-card、usage-overview-card、usage-requests-table、usage-segmented-control、usage-session-list）、`logic-map/canvas.tsx`、`price-table/litellm-price-group.tsx`、`provider-detail/header.tsx`、`provider-detail/models.tsx`、`screens/settings/appearance/font-picker-row.tsx`、`screens/settings/mention-defaults-section.tsx`、`subagents/dispatch-group.tsx`。
- 按 prd 的决定加进豁免：单独成一块（不混进上游的名单，以后上游从名单里移出文件时不冲突），注释写明是 Osuna 合并上游 v0.12.0 时加入、待迁移、迁移会动设置页等处的按下态外观所以另开工单截图验收。
- 偏离 prd 一处：prd 说豁免名单放在 merge commit 之后的适配提交里；但本段为了上游新用例给 `provider-catalog-list.tsx` 加了 testID，这个文件进了 merge commit，提交钩子的 lint 就会在它上面报错。merge commit 本身要过 lint，所以豁免块放进了 merge commit，这一段的 merge commit 因此也过得了全仓 lint。

### app
- components/markdown/styles.ts：上游 #7360 给 Web 的 Markdown 容器加 `userSelect: text`（iPhone Safari 能选中文字）。两边都留：Osuna 的 `monoFamily` 与上游的 `WEB_CONTAINER`，返回类型取上游，字号仍是 Osuna 的（不随 compact 变）。
- components/provider-icons.ts / .test.ts（import）：上游 #7330 给 Kiro、Antigravity 换了真正的图标，`PackagePlus` 挪到测试里；Osuna 的 `useId`、`useMemo` 与测试里的 `renderToStaticMarkup` 都留。
- subagents/select.ts / .test.ts：上游 #7342 加了 `createSubagentsForParentSelector`（回复流式输出时复用子 Agent 行），Osuna 的派发组与提供方子 Agent 权限选择器都留，hook 用上游的写法；测试两边的 import 与用例都留。
- server/agent/mcp-server.test.ts（import）：两边都留（上游的终端管理器 + Osuna 的 `PARENT_TOOL_CALL_ID_LABEL`）。
- e2e/browser/provider-catalog-icons.spec.ts（上游新用例）：按上游的卡片网格写（`openAddProviderArea`、`provider-catalog-tile-*`、图标 24px）。按 Osuna 的「添加提供方」弹窗改写：从提供方页点开弹窗，按行找图标（给 Osuna 的目录行加 `testID="provider-catalog-row-<id>"`），图标尺寸按 Osuna 的 20px（兜底 16px）。按约定提供方类 Playwright 用例本机不跑，交 CI。
- server/plugins/usage-sources/index.test.ts：上游 #7142 新用例（Cursor 多账号分卡）又用了旧的位置参数构造函数，改成选项对象，断言不变。

### 适配提交
- `COMPAT(paseoToolCallDetail)`（protocol/src/paseo-tool-call-detail.ts）改写为 v0.18.0。

### 核对
- 合并后核对：身份、更新源、签名、部署工作流、版本号、CHANGELOG 不变；CI 只多了「Test lint rules」一步（跑 `scripts/oxlint/paseo-plugin.test.mjs`），没有新的 Playwright 作业；协议只新增了一个转出文件。上游站点链接 app 75 / 1（全部多 1，在上游 #7361 的 `components/markdown/renderer.test.ts` 测试样例里，按规矩不改）、cli 13 / 3，非测试数不变。
- 测试：本段新增或改动的 20 个测试文件加 `resources.test.ts`、`renderer.test.ts`、两个规则测试，逐个跑过并通过。`renderer.test.ts` 第一次挂在上游 #7361 的「句末句点不进链接」：本段与上一段都改了 enriched-markdown 的依赖补丁，本机装的还是旧补丁；删掉 `packages/app/node_modules/react-native-enriched-markdown` 重新 `npm install` 套上新补丁后通过（`package-lock.json` 不变）。
- 被删的测试行：没有。

## 整张工单的核对

- 三个 merge commit 的双亲：`16d847b51` = `223d38be0` + `c517d07d6`；`a5eb7c89a` = `4633a4393` + `cc748dfe1`；`80515069f` = `bba9d2374` + `cafe4b01c`。
- 指令目录（ADR 0003）：provider-registry、agent-manager、codex-app-server-agent、opencode slash-command-timeout、claude agent、pi agent、opencode runtime-client 与全部 `*command*` 测试（含三个用假 daemon 的指令 e2e）共 22 个文件逐个跑过并通过；本工单里这些文件只有上游新增的用例，现有断言无一改动。
- 协议测试：本工单里协议的测试文件只有新增用例和上游自己改的一行 import，没有改动断言。
- dev 桌面端冒烟（`.dev/paseo-home`、6769，启动前备份真实 `~/.codex/config.toml` 与 `~/.claude/settings.json`，结束后逐字节相同）：侧栏、输入框、新建工作区页、用量页（套餐用量卡片有数据，写「x 后重置」）、Providers 页都正常显示。控制台：启动瞬间一条连不上 6769（daemon 尚未起好）、`uniProps` 落到 DOM 与按钮嵌套按钮两条第 1 段已记；另有两条新的 React 开发警告 `accessibilityElementsHidden` / `importantForAccessibility` 落到 DOM，来自上游本期新代码（`command-center.tsx` #7277、`left-sidebar.tsx` #7244 在 Web 上传了原生端的无障碍属性），不是冲突裁决造成的，按 prd「上游缺陷只在弄坏 Osuna 功能时处理」不改。
