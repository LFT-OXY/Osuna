### 元数据与文档
- 13 个 package.json：冲突块取 Osuna（版本号 0.17.0）；server `test:integration` 以上游清单为底，补回 Osuna 的 api-endpoint-pi / api-endpoint-omp 两个 e2e（规则 3）。
- package-lock.json：冲突块取 Osuna 后 `npm install --package-lock-only --ignore-scripts` 重新生成；差异只有上游 #6973 新增的 react-native-enriched-markdown、mdast/micromark 四个包，与删掉的 react-native-markdown-display、react-native-uitextview 及其依赖。
- CHANGELOG.md：整份恢复为合并前（逐字节相同）。
- postinstall-patches.mjs：取主线一侧（补丁分支固定裁决；Osuna 同步后没改过）。
- 四份 README：冲突块取 Osuna；上游在冲突块之外加的赞助商表格（指向 paseo.sh / hoplite.sh）不收，整份与合并前相同（规则 1：外链只指向本仓库；Osuna 已删赞助一节）。
- CLAUDE.md：文档表两边各加一行，两边都留（上游新增的 docs/markdown-renderer.md、native-text-selection.md 随合并进仓库，表里要有对应行）。偏离工单「冲突块取 Osuna」的字面，理由是 CLAUDE.md 自己要求新文档加行。
- docs/agent-lifecycle.md：Osuna 有意删掉的「Provider-managed child agents」一节不放回，收上游新加的 Background workspaces；子 Agent 标签一段以上游（手机 sheet）为底补回 Osuna 的权限请求说明。
- docs/explorer-sidebar.md：表格合并，Osuna 的 Session history 与上游的 Sheets 行都留。
### 协议
- protocol agent-types.ts、messages.ts：两边各加的 import / 可选字段都留（规则 3）；上游新加的 internal 是可选字段。
### server：Agent 间消息与 Routing block
- agent-manager.ts（9 块）：import 两边合并（isSystemInjectedEnvelope 已随上游移到 agent-messages，不再从 agent-prompt 引）；recordSubmittedPrompt 用上游新签名（accepted/rejected），保留 Osuna 的 `options.submittedPrompt ?? prompt`（上游新加的 rejected 路径也补上，否则失败的那条会带 Routing block）；历史回放、导入、流式三处都改成「先剥 Routing block，再交给上游的 projectAgentMessage」——Routing block 追加在信封之后（ADR 0004），不先剥离信封就解析不出来；reconcileSubmittedPromptEcho 取上游（进来的 item 已剥离）；countLiveAgents* 与上游 listRetiredInternalAgents 都留（规则 3）。
- agent-prompt.ts：startCreatedAgentInitialPrompt 收上游的 prepareAgentMessage 信封，Routing block 照旧挂在 startAgentRun（规则 3，ADR 0004）。
- agent-prompt.test.ts：import 合并；Osuna 的权限文案断言改为对 parseAgentMessage 解出的正文断言（信封会把 `'` 转义成 `&apos;`，原断言对原始 prompt 不再成立）——断言内容不变，只换了取值位置。
- agent-manager.test.ts：import 合并（onTestFinished + 上游的 agent-messages）。
### server：提供方
- acp-agent.ts：保留 Osuna 的 reportCommands（指令报回即推送，ADR 0003），带上上游的 `command.input?.hint` 参数提示（规则 3）。
- generic-acp-agent.commands.test.ts：保留 Osuna 的「等报回」写法，期望值换成上游 fake 脚本新报的两条（review 带 query 提示、status）；这是上游改了 fake 脚本后必须跟着改的断言。
- generic-acp-agent.ts、cursor-acp-agent.ts：Osuna 删掉的 waitForInitialCommands 不放回（ADR 0003），收上游的 usageProvider。
- pi/agent.test.ts：收上游新增的两组 thinking_level_changed 用例；Osuna 有意删掉的「thinking 更新后读状态失败」用例不放回，Osuna 改名的「读状态失败时模型切换照样完成」保留。
- opencode/bridge.test.ts、fake-agent-client.ts：两边的 import 与选项都留；beforeCreateSession 用上游带 config 的新签名，Osuna 的 nextSessionId / onSessionCreated 保留。
### server：其余
- private-files.ts：Osuna 可替换的 rename 选项 + 上游「写到符号链接指向的文件」的 destination，两者合用。
- session.ts：Osuna 的 resolveRoutingBlock + 上游新的 buildSessionConfig（已创建的工作树直接复用）。
- terminal.ts：两边 import 合并。
- checkout-git.ts：Osuna 的按文件复用（reuse.trackedPatches）以上游的 oldPathByPath（改名需要两条路径）为底重写；import 两边都留。
### app：e2e 与测试辅助
- acp-provider-catalog.spec.ts：两边 import 都留；上游用例按卡片网格写，按 Osuna 弹窗结构的适配留给工单 03。
- appearance-theme-picker.spec.ts、helpers/settings.ts：取 Osuna（Osuna 的主题色值、Osuna 的提供方弹窗按钮）。
- assistant-selection-copy.spec.ts：上游新渲染器直接用 HTML 标签定位，Osuna 的「界面字体前插到字体栈」断言保留。
- composer-whitespace.spec.ts、helpers/subagents.ts：两边都留。
- file-editing.spec.ts：Osuna 的 DOM 预览用例与上游的相对图片用例都留；DOM 预览与它的用例按 ADR 0016 在工单 05 删除。
### app：其余
- agent-stream/presentation.ts：以上游为底（新渲染器后不再按 Markdown 块拆行），补回 Osuna 的 dispatchGroups 参数。
- appearance/provider.tsx：两边 import 都留。
### app：聊天 Markdown（第 1 段只做到能编译，样式迁移在工单 02）
- message.tsx（3 块，全在 import 区）：以上游重排后的 import 为底，补回 Osuna 仍在用的 contentTypeStep / SPACING、UiText、InlineBlockText、shimmer 系列与 useReduceMotionEnabled；Osuna 已删掉的 MaskedView、reanimated、react-native-svg、useRetainedPanelActive 与 WEB_TOOLCALL 常量不放回。正文其余部分 git 自动合并（上游删掉旧渲染规则，Osuna 的工具行外观、用户气泡、turn footer 用量都在）。
- highlighted-code-block.tsx：上游删了 MarkdownTextSpan，代码文字改用 react-native 的 Text（这里命名 NativeText，避免与 Osuna 头部用的 ui/text 重名）；Osuna 的语言标签头、复制按钮、icon-button-chrome 保留；语言别名按上游放回本文件，并导出 fenceLanguageToExtension 供 DOM 预览用（DOM 预览工单 05 删除）。
- fence/language.ts、styles/markdown-styles.ts 与 markdown-styles.test.ts：接受上游删除（modify/delete）。markdown-styles.test.ts 里 Osuna 的断言（正文 contentTypeStep 与 86% 色调、标题档位、代码块 surface2 + borderCodeBlock + radius.lg、行内代码、引用块）随 Osuna 样式在工单 02 迁到上游的 components/markdown/styles.ts 与它的测试上——**02 必须补上这些断言**，原文见 `git show 3fc36c0a8:packages/app/src/styles/markdown-styles.test.ts`。
- DOM 预览（dom-markdown.web.tsx、code-block.web.tsx）：引用改到新位置——Mermaid 用上游只收 code 的 MermaidFence，语言首词在本文件内取，fenceLanguageToExtension 从 highlighted-code-block 引。整套 DOM 预览在工单 05 删除。
- file-pane/markdown-preview/index.tsx（原生版）与 pane.tsx：两边的 props 都留——Osuna 的 resources / lineStart / navigationRevision（Web 的 DOM 预览用）与上游的 filePath / workspaceRoot / client / serverId（新渲染器解析相对图片用）；index.web.tsx 的 props 跟着补上可选字段，使两版签名一致。
### app：提供方
- provider-catalog-list.tsx（12 块）：上游这里只改了外观（卡片网格、SearchField、StatusBadge）和排序；第 1 段整份取 Osuna（规则 1：Osuna 的弹窗与行列表），上游的 rankProviderCatalog 排序在工单 03 接到 Osuna 列表上。
- provider-diagnostic-sheet.tsx：上游只有 #6507（长自定义模型名不挤掉删除按钮），这段代码 Osuna 已挪到 provider-detail/；第 1 段取 Osuna，修复在工单 03 挪到 Osuna 的位置。
- provider-icons.ts：两边都留（Osuna 的品牌色 + 上游的终端图标名与 Map 泛型）。
- question-form-card.tsx（4 块）：Osuna 把卡片重做成编号行（状态在 question-form-card-core.ts）；上游 #6171 的选项预览（ScrollableCodeSurface）补进 Osuna 的 QuestionOptionRow，Web 判断改用文件已有的 isNative。
### app：侧栏
- left-sidebar.tsx、sidebar-header-row.tsx、sidebar-help-menu.tsx、sidebar-workspace-row-content.tsx：上游在这几处只有 #6431 / #6885 / #7150 的外观改动（density 尺寸、DensityIcon、按下底色、SidebarSectionHeader）；Osuna 已把侧栏改成自己的 Row 外观并有自己的悬停 / 按下高亮，四个文件整份取 Osuna（规则 1，docs/design.md）。核对过：解完冲突后与合并前的差异只有这些外观改动，没有功能性改动被丢。
### app：通用组件
- autocomplete-utils.ts / .test.ts、autocomplete.tsx：上游把滚动到可见的计算挪到通用的 ui/scroll-reveal.ts（getScrollOffsetToRevealItem）；以上游为底（规则 2），把 Osuna 的 bottomInset（底部渐隐不算可见）加进上游函数，Osuna 的两条 bottomInset 用例挪进 scroll-reveal.test.ts（函数名换成上游的，断言不变）；Osuna 原有的「向上 / 向下滚」两条与上游 scroll-reveal.test 的同名用例重复，随旧函数删除。AUTOCOMPLETE_FADE_HEIGHT 留在 autocomplete-utils。
- combobox.tsx：上游的 SheetVisibleFrame 外框 + Osuna 的滚动区内边距写法（unistyles 在第三方滚动区上不生效）。
### app：Composer
- composer/draft/input-draft.ts：上游给文字替换加了 kind（hydrated / replace），Osuna 的替换带 segments（行内块）；两者合成 `publishTextReplacement(kind, { text, segments })`。
- composer/input/input.tsx（19 块）：第 1 段整份取 Osuna（Web / Electron 的 Tiptap 输入）。上游这段对它的改动是 #6531 手机全屏编辑及其后续修复（#6902 #6945 #6987 #7129 #7130），全部依赖被 Osuna 删掉的测高模块，按工单安排在 02 接入；02 的对照：`git diff ab10a6694 e2f4948f9 -- packages/app/src/composer/input/input.tsx`。
- composer/input/height.native.ts、height.web.ts：保持 Osuna 的删除（modify/delete），02 只在原生端恢复。
- composer/input/state.test.ts：两边 import 都留（上游新的 resolveComposerSurfaceText 等用例随 state.ts 自动合并进来）。
- composer/input/text-input.web.browser.test.tsx：取 Osuna（整份是 Tiptap / contenteditable 的用例）；上游新加的「输入法组合中重渲染保持句柄与选区」是 textarea 写法，02 按 contenteditable 改写补上。
### app：面板与子 Agent
- git/use-working-diff.ts、git/diff-pane.tsx：上游 #6455 的 Send feedback（useReviewFeedback、presentation）与 Osuna 的只看文件树 / 评审附件发布 / 文件展开默认值都留（规则 3）。
- panels/agent-panel.tsx：Osuna 的 skillNames + 上游的 showsComposer（手机 sheet 里不显示 Composer）。
- panels/agent-tracks.tsx 与 subagents/use-open-subagent.ts：Osuna 把打开子 Agent 的逻辑抽成 useOpenSubagent（派发组共用），上游在 agent-tracks 里把同一段逻辑简化成统一走 openPreferredWorkspaceTarget（手机上由布局决定开成 sheet）；以上游写法为底改写 useOpenSubagent（规则 2），agent-tracks 用 Osuna 的 hook 并接上上游的 opensInSheet。
- panels/provider-subagent-panel.tsx：Osuna 的待处理权限 + 上游的 opensInSheet；副标题改用上游的 PaneSubtitle 组件，Osuna 去掉的横向分割线在 PaneSubtitle 里同样去掉（commit 6bb673f4e 的决定）。
- plugins/surface-screen.tsx：依赖数组取上游的 hostFilter，补回 Osuna 加的 t。
- i18n zh-CN.ts（3 块）：Osuna 的译文 + 上游新键的中文（全屏 / 退出全屏、工作区操作，有服务异常、清除搜索），按术语表用「工作区」「提供方」。
- provider-selection.test.ts：两边新加的 describe 都留。
- review/surface.test.tsx：取上游（mock 主题改用真实的 darkTheme）；Osuna 只是给假主题补了 radius / controlHeight，真实主题里都有，测试本身的断言不受影响。
### app：设置页
- settings-screen.tsx（11 块）：上游 #7129 / #7150 / #6885 在这里只有外观改动（手机设置首页的大方块 island、density 图标尺寸、按下底色）；按规则 1 与 prd「手机设置首页保留 Osuna 的行列表」整份取 Osuna。核对过解完后与合并前的差异只有这些外观改动。
- appearance-section.tsx：上游 #? 给字体输入框加 ref，提交被规整后的值写回输入框；接到 Osuna 的 FormTextInput 上（它转发同一种 EditingTextInputHandle）。界面字体在 Osuna 已改成系统字体选择器，commitUiFontFamily 保持 Osuna 写法，等宽字体那一行按上游返回提交值。
- screens/settings/providers-section.tsx / .test.tsx：Osuna 已把这一页重写（目录挪进弹窗、删除挪到详情页、开关成组）；上游这里的改动是 Hoplite 能力位、「写进配置的提供方可删除」与添加失败改 toast（共 38 行）。第 1 段整份取 Osuna，Hoplite 能力位与删除条件在工单 03 接到 Osuna 的弹窗与详情页；toast 不收（Osuna 是行内错误，规则 1）。
- workspace-scripts-button.tsx：上游 #7122 重构了脚本按钮（ScriptIcon 按脚本取图标、去掉 ghost 形态、手机进 ⋯ 菜单），以上游为底；Osuna 在这里只把图标尺寸换成 ICON_SIZE 令牌，同值换回令牌。
- workspace-screen.tsx（8 块）：上游 #6431 把手机端的标签切换器、紧凑头部、项目行拆到 compact-workspace-header/ 与 workspace-header-project-row.tsx（-1031 行）；Osuna 这边只改了 68 行。以上游整份为底（规则 2），把 Osuna 的改动挪到新位置：会话历史 / 逻辑图的标签名进 compact-workspace-header/tab-switcher.tsx 的两个兜底函数与两处 labels；项目名面包屑（宽屏 `项目 /` 在标题前、md 档间距 2、中文注释）进 workspace-header-project-row.tsx；ScreenHeader / 闸门页 MenuHeader 的 borderless 补回。Osuna 改过的手机切换器箭头尺寸与 mobileTabsRow 分割线所在的代码已被上游整体替换，原生端免验收。
- stores/workspace-layout-store.ts / .test.ts：Osuna 的逻辑图标签自动打开记录与上游的手机 sheet（layoutMode、sheetsByWorkspace）都留，持久化判断两边的条件都算；测试两边新加的用例都留。
- styles/theme.ts / theme.test.ts：取 Osuna（t3code 色板由 deriveThemeRoles 推出，是 Osuna 的设计决定）；上游把浅色侧栏 hover / 选中改成 surface3 / surface4 不收，上游改的那条侧栏用例 Osuna 早已换成「Default palette」一组。
- timeline/turn-time.ts：上游把每轮耗时改成按尾部缓存的增量计算，以上游为底（规则 2），把 Osuna 每轮带的 turnId / userMessageId（用量行按它们对上）加进 OpenTurn、closeTurn 与相等比较。
- utils/file-mention-autocomplete.test.ts：收上游新增的邮箱地址用例，按 Osuna 的签名补 `blockBoundary: 0`；上游的 formatQuotedFileMentionPath 用例不收（Osuna 已随行内块删掉这个函数）。
- headers/back-header.tsx：上游加了手机的 CompactHeader 分支、桌面拆成 DesktopBackHeader，并删掉了无人调用的 titleAccessory；Osuna 的设置详情页仍在用 titleAccessory 与 borderless，两者都补回桌面分支（规则 3，git 静默删掉的那一行一并恢复）。
- add-project-flow.tsx：上游给结果列表加了滚动到选中行（contentRef、activeItemRef），以上游结构为底，Osuna 的翻译键（进度、加载中、空列表文案走 t）补回。
### 编译接线（合并后为通过 typecheck 做的修补）
- agent-manager.ts：流式事件里重复声明的 item 去掉（上面已先剥 Routing block）；countLiveAgentsStartedBefore 结尾被拼接吃掉的 `}` 补回。
- acp-agent.ts：上游新加的 releaseHistoryRuntime 里调用的 settleCommandsReady 在 Osuna 已随「不等指令报回」（ADR 0003）删除，这一行去掉。
- routing-block.ts、logic-map-instruction-block.ts：formatSystemNotificationPrompt 随上游挪到 agent-messages，改从新位置引入。
- composer/input/text-input.web.tsx：上游给 EditingTextInputHandle 加了必填的 setSelection，Osuna 的 Tiptap 输入补上实现（复用已有的 setTextSelection）。
- composer/index.tsx：上游给 MessageInput 传的 editingSession、submissionError 两个属性只服务手机全屏编辑，Osuna 的 input.tsx 还没接，先不传，工单 02 接入时加回。
- panels/panel-manifest.ts：上游把 compactSheet 设为必填，Osuna 的 session_history、logic_map 补 `compactSheet: null`。
- agent-stream/stream-tick.bench.ts：按 Osuna 的 prepareToolCallHistory / projectToolCallDetailLevel 签名补 dispatchGroups。
- e2e：acp-provider-catalog.spec.ts 里上游的 openAddProviderArea（卡片网格）换成 Osuna 的 openProviderCatalog，只为能编译，用例内容按 Osuna 结构的适配在工单 03；hoplite-model-discovery.real.spec.ts（真实登录用例，不在 CI 里跑）去掉 Osuna 已删除的 drillIntoProvider，直接点提供方行。
- 测试文件里三处「两边都留」拼接时漏掉的公共结尾（subagents.ts、provider-selection.test.ts、workspace-layout-store.test.ts）补回。
- zh-CN 上游新键核对：「Workspace 标签」改「工作区标签」，「选择智能体」「智能体标签页」按术语表改「Agent」（术语表：Agent 保留英文、Workspace 译「工作区」）；其余新键（全屏、显示后台工作区、发送反馈等）是真实译文。
### 改动的上游测试
- agent-stream/model.test.ts（上游新用例）：期望的 TurnTiming 补上 Osuna 多出的 turnId / userMessageId（都是 null），断言内容没放宽。
- i18n/resources.test.ts：上游新键 providerCatalog.types.acp 的值是协议名「ACP」，加进 zh-CN 英文允许清单的 abbreviations（守卫本身未放宽）。
- timeline/turn-time.test.ts（上游新增的增量计算用例）：期望值同样补上 turnId / userMessageId: null。
- agent-manager.ts 历史回放两处、workspace-layout-store.ts 一处：手工拼接冲突块时公共尾行被写了两遍（历史记录会重复一份），已去重；agent-manager.test 的「刷新不追加第二份时间线」用例因此通过。逐个扫过所有冲突文件，没有别的相邻重复行。
- daemon-e2e/agent-mention-routing-block.e2e.test.ts（Osuna 的 ADR 0004 用例）：上游给 Agent 间消息套了发送者信封、子 Agent 结束时给调用方发通知，两条「不带 Routing block」的用例原来按「prompt 原文相等」断言，改成「信封能整串解析出原文 + 所有 prompt 末尾都没有 Routing block」——证明的事不变；老客户端直发帧的辅助函数改为等 daemon 回第一帧再发会话消息（上游的 hello 改成异步处理，立刻发会被当成 hello 之前的消息断开，真实客户端本就等 server_info）。另外 7 条带 Routing block 的用例原样通过。
- packages/website/public/schemas/paseo.config.v1.json：两边各给配置加了字段，生成的 JSON Schema 合并后过期，按测试提示用 generate:config-schema 重新生成（生成产物不手工合并）。
- website/src/data/sponsors.test.ts（上游新测试）：要求四份 README 有赞助商表，与 Osuna 决定（README 归 Osuna、外链只指向本仓库）矛盾；改成断言 README 里没有赞助表（规则 1，PR 正文写明）。
### 本机跑测试的结果
- 本段新增 / 改动的测试文件、冲突文件对应的测试、Osuna 不变量测试（指令目录、Routing block、子 Agent 权限、桌面更新源、翻译资源、提供方升级等）共 241 个文件逐个单独跑过。合并引起的失败都已修（见上）；命令行脚本型测试（tests/*.test.ts）用 tsx 跑、浏览器测试用 --project browser、官网测试从仓库根目录跑，按正确方式重跑后全部通过。
- 合并前本来就挂、与合并无关（在临时检出的合并前代码上对照过，同样失败）：`daemon-e2e/git-operations.e2e.test.ts` 的 4 条 paseo.json setup / 归档用例（CI 只跑其中 "merges into"，这 5 条本机通过）；`file-observer/index.test.ts` 的「ignore update is a barrier」在 macOS 时过时不过，合并前后一样。
- 没在本机跑：`claude-history-other-project-dir`、`claude-provider-config-dir-history` 两个 e2e（要起真实 Claude CLI，按约定不在本机测 CLI 登录），以及 *.real.* 真实提供方用例。
- 评审后补记：cli/src/commands/agent/run.ts 是上游自动合并（resolveRunCallerAgentId 换成上游的 resolveCallerAgentId，逻辑等价），本段手工只改了 COMPAT 版本；hooks/use-acp-provider-catalog.ts 同样只改 COMPAT；desktop/package.json 冲突块取 Osuna，上游新增的 test:e2e:window-startup 脚本自动合并进来；CLAUDE.md 里 explorer-sidebar 一行的描述随上游更新为含 compact workspace sheet。
- 问题卡片：上游这段对 question-form-card-core.ts 只加了 preview 字段的解析（已自动合并），没有改作答状态，Osuna 的状态逻辑原样保留。
- 评审后：agent-mention-routing-block 定时任务那条改回逐条 toEqual（先过滤掉上游发给调用方的结束通知），不再用 toContain。
