# 上游 v0.11.2 → v0.13.0 与 Osuna 的功能重叠与冲突

调研日期 2026-10-26，只读。引用写法：上游 = `d34d17a90`（v0.13.0），基点 = `ab10a6694`（v0.11.1，
`git merge-base main d34d17a90` 的结果；v0.11.2 补丁 `759532509` 不在上游主线上），Osuna = `main`
（`b8d4f55e7`，Osuna 0.17.0）。裁决依据是 [docs/release.md「冲突裁决」](../../../../docs/release.md)
的三条规则：1 = Osuna 有意的产品决定保留，2 = 重复实现以上游为底、补回 Osuna 多出的行为，3 = 其余两边都保留。

规模：上游基点以来 327 个非合并提交、改了 1934 个文件；Osuna 基点以来改了 5977 个文件（含任务目录与 skills），
两边都改的文件 398 个（只算 Osuna 上次合并 `d7800df9a` 之后的改动是 156 个）。

上游发布点（全部在 v0.13.0 祖先链上的按 tag 提交合并；0.11.3 / 0.11.4 的 tag 不在主线上，但 #6953、#7030 和
`7aa3fac06` 在主线里会随 0.12 段带进来）：v0.12.0-beta.1 `e2f4948f9`、beta.2 `c517d07d6`、beta.3 `cc748dfe1`、
v0.12.0 `cafe4b01c`、v0.13.0-beta.1 `3fa625701`、beta.2 `30d8cb044`、v0.13.0 `d34d17a90`。

## 1. 上游用户看得见的变化（0.11.3 – 0.13.0）

上游 CHANGELOG 只给正式版写条目，beta 归到所属正式版。修复类只列与 Osuna 有交集的。

| 发布点 | 变化 | PR |
| --- | --- | --- |
| 0.11.3/0.11.4 | Hoplite 作为可选 ACP 提供方；Add provider 目录可搜索、改卡片网格；添加失败改 toast；插件提供方不再给 Remove | #6953 #7030 #6568 |
| 0.12.0 | 后台工作区，Show background 开关 | #5039 #7141 |
| 0.12.0 | Diff 面板 Send feedback；手机上评论在 sheet 里写 | #6455 |
| 0.12.0 | 手机全屏 Composer、浮动头、New agent/terminal 进标签切换器、脚本进 ⋯ → Scripts | #6531 #6431 #7122 |
| 0.12.0 | 手机文件与子 Agent 在 sheet 里打开 | #6827 #6885 #6958 |
| 0.12.0 | 手机设置页改成 App / Host 两组大方块 | #7129 |
| 0.12.0 | Agent 间消息带发送者名字；CLI/MCP 发给运行中 Agent 默认插话（steer） | #6373 #5164 |
| 0.12.0 | 新 Markdown 渲染器（三端 `react-native-enriched-markdown`），跨段选择、代码块复制、表格横滑 | #6973 |
| 0.12.0 | Claude Mythos 5.1（需 CLI 宣告）；Claude 问题卡片选项预览 | #6403 #6171 |
| 0.12.0 | `paseo usage` CLI | #6474 |
| 0.12.0 | Command Center 按匹配度+最近排序；子 Agent 列表显示模型/思考/模式/上下文；Paseo 工具行以动作开头 | #7277 #7290 #7283 |
| 0.12.0 | 用量：Refresh all 不换位、刷新失败保留旧值、Cursor 多账号分卡 | #6947 #7246 #7344 |
| 0.12.0 | 语音：OpenAI 兼容 TTS 模型/音色名、Android 听写被打断 | #6060 #7200 |
| 0.13.0 | 可折叠屏宽布局；Explorer 手机/平板/桌面统一标签与 launcher，手机标签可滚动、关闭进长按菜单 | #7424 #7705 #7589 |
| 0.13.0 | 连接的主机（daemon 存主机清单，Agent 在别的机器上建/提示/监视 Agent，`paseo host add`） | #7370 #7593 |
| 0.13.0 | paseo.sh 简中站 | #7373 |
| 0.13.0 | Changes 默认 All changes（已提交+未提交一个 diff） | #7576 |
| 0.13.0 | Claude 计划审批里的 Implement with Auto | #7453 |
| 0.13.0 | 终端粘贴图片、拖入文件 | #3795 |
| 0.13.0 | 侧栏按 Created 排序，Display → Sort；长项目组只显示 7 个 + Show more | #7635 #7771 |
| 0.13.0 | Command Center 结果与标签/侧栏同图标同状态 | #7690 |
| 0.13.0 | Manual 元数据生成只用所选模型，不回退默认 | #7611 |
| 0.13.0 | New workspace 的 Host 字段常显，菜单末尾 Add host | #7580 |
| 0.13.0 | 主机有密码时经中继的连接必须带密码 | #7668 |
| 0.13.0 | ACP 固定版本更新 | #7781 |
| 0.13.0 | 移除旧 WebView 终端渲染器 | #7639 |
| 0.13.0 | 用量行写明是已用还是剩余，并本地化 | #7376（`eda3e4318`） |
| 0.13.0 | 子 Agent 报告与结束通知合成一条；重启后 notifyOnFinish 仍送达 | #7561 #7683 #7528 |
| 0.13.0 | 工作区 setup 输出只推给正在看 Setup 面板的 App | #7407 #7473 |
| 0.13.0 | 只加载所选语言的翻译 | #7410 |
| 0.13.0 | 插件：文件面板、`useTabState`/`addAgentPanel`、运行时翻译、清单翻译、`Markdown` 组件、内联 SVG 图标、UI 入口改为 `@getpaseo/plugin/client/ui` | #7411 #7366 #7614 #7685 #7478 #7373 #7579 #7368 #7474 |
| 0.13.0 | 新设置分区 Files（`settings/files-section.tsx`） | 随 #7411 |

## 2. Osuna 自上次同步（10-13）以来的功能

来源：Osuna `CHANGELOG.md` 0.16.0、0.17.0 与 `.atw/tasks/archive/2026-10/` 下 10-13 之后的任务。0.15.0 是上次合并
上游 v0.9–v0.11.2 的版本，其中 Osuna 自己的部分（套餐用量窗口、内容宽度、守护进程密码栏等）在下面需要时单独引用。

- 第三方接口与中转站（0.16，ADR 0004 0007 0008 0010 0011 0012）：设置「第三方接口」页、按模型名挑接口、自动换家、
  Claude Code / Codex 总开关与默认模型、终端里的 CLI 经主机中转。
- 中转站稳健性、接口管理好用性、Gemini 格式、Pi/OMP 接入（0.17，任务 10-16-*）。
- 接口余额与套餐额度、用量页按官方账号与每家接口分开记账、人民币与倍率、逐条请求（ADR 0014，任务 10-16-endpoint-balance、10-16-gateway-ledger-usage）。
- Codex / Claude Code 多号自动轮换、「隐私 → 读取 CLI 登录凭证」开关（ADR 0015，任务 10-16-multi-account-rotation、10-16-credential-switch-risk-notes）。
- 对话逻辑图：右边栏「逻辑图」面板与 `logic_map` 工具（ADR 0013，任务 10-19-logic-map）。
- Changes 面板大改动集优化：按文件复用、生成文件和大文件默认收起、只看文件树时不读全文（任务 10-19-diff-view-large-changesets）。
- 设置页左栏滚动位置修复（10-15）、选择框贴底往上展开。

## 3. 冲突点

### 3.1 需要维护者拍板

#### Q1 Web 端 Markdown 文件预览用哪套渲染器

- 上游：#6973 三端统一到 `react-native-enriched-markdown`，删掉 `react-native-markdown-display`、
  `components/markdown-text*.tsx`、`components/markdown/fence/*`、`styles/markdown-styles.ts`。#7366 #7411 #7614 把
  `file-pane/` 改到 `file-panels/`，Markdown 预览成为 `file-panels/builtin.tsx` 的 `builtin:markdown`
  （`MarkdownPanel` → `FileMarkdownPreview`），`file-panels/markdown-preview/` 只有 `index.tsx`、`document.ts`。
  相对图片与链接由 #6750 #7538 处理（`resolveMarkdownFileDirectory`、`AssistantFileLinkResolverProvider`）。
- Osuna：[ADR 0001](../../../../docs/adr/0001-markdown-file-preview-dom-renderer-with-lezer.md) 定了 Web 预览走 DOM 渲染：
  `file-pane/markdown-preview/{index.web.tsx,dom-markdown.web.tsx,code-block.web.tsx,github-alerts.ts,image.web.tsx,link.web.tsx,resource.ts,source-line.web.ts,styles.web.ts}`，
  约 2200 行；`resource.ts` 管相对图片、磁盘变更刷新、缺图占位、相对链接（`a0e70b59d`）；`source-line.web.ts` 供逻辑图按行滚动。
- 规则为何裁不了：两边是同一功能的两套实现，但渲染器不同，规则 2「以上游为底再补回」等于丢掉 ADR 0001 的 DOM 渲染；
  规则 1 只列了 release.md 里那几类决定，ADR 0001 不在其中。保留哪套都会改变用户看到的效果。
- 问题：Web/Electron 的 Markdown 文件预览保留 Osuna 的 DOM 渲染，还是改用上游的 enriched 渲染器？
- 推荐：保留 DOM 渲染，挂成 `file-panels/markdown-preview/index.web.tsx`，props 改成上游面板的
  `filePath / workspaceRoot / client`；iOS/Android 用上游渲染器；更新 ADR 0001 的原生端描述。理由：README 式文档
  （居中、徽章行、`[!NOTE]`）是 ADR 0001 的原因，上游对 HTML 只做规整（`components/markdown/html.ts`），这些效果大概率回不来
  （未在界面上验证）；逻辑图按行滚动也依赖 DOM。

#### Q2 聊天消息的 Markdown 外观

- 上游：#6973 重写 `components/message.tsx` 与 `components/markdown/renderer.tsx`，样式移到 `components/markdown/styles.ts`，
  原生代码块由库渲染。
- Osuna：`dc38236f6`、`a1c8b7a1c` 改过 `styles/markdown-styles.ts`；`highlighted-code-block.tsx` 加了语言标签头，引用
  `MarkdownTextSpan` 与 `fenceLanguageToExtension`（两者上游已删）。
- 规则 1 的「设置页外观」不覆盖聊天，规则 2 以上游为底时原生代码块的语言标签头会丢，属用户可见变化。
- 问题：聊天渲染引擎用上游的，Osuna 样式迁到 `components/markdown/styles.ts`，接受原生端代码块失去语言标签头，可以吗？
- 推荐：可以。Web 代码块仍走 `HighlightedCodeBlock`，标签头保得住；原生端 Osuna 本来免验收。

#### Q3 套餐用量文案：两套翻译键

- 上游：`eda3e4318`（#7376）新增顶层 `providerUsage.*`（九种语言），重写 `usage/copy.ts`、`usage/format.ts`，加
  `formatContextPercentage`。zh-CN 用「已使用」「刷新中...」「连接到 {{host}} 以查看提供商用量」。
- Osuna：同一批界面早已走 `usage.planUsage.*`（`usage/copy.ts` 注释写明），另有上游没有的：「刚刚 / x 分钟前」、
  `cliSignInsOff` 与 `cli-sign-ins-off-notice.tsx`、`apiEndpointsOnNote`、`strip.*`、配速文字、`plan-usage/resets-row.tsx`
  （Codex 剩余重置次数）。zh-CN 用「已用」「刷新中…」「套餐用量」「提供方」。
- 规则 2 要以上游为底，但会换掉用户看得到的中文措辞，也与 `docs/glossary.md` 的「提供方」用语不一致。
- 问题：以上游 `providerUsage.*` 和 `copy.ts` 为底、各语言的值改回 Osuna 现有译法、补回 Osuna 独有键、删掉
  `usage.planUsage` 中与上游重复的键，可以吗？
- 推荐：可以。符合规则 2 与 [ADR 0006](../../../../docs/adr/0006-usage-in-code-is-upstream-plan-usage.md)，同时保住术语；
  同一句话两套键并存，以后每次合并都要再解。

#### Q4 中继连接强制校验密码（#7668）

- 上游：删除 `packages/server/src/server/session-admission-auth.ts` 的 `COMPAT(relayPasswordOptional)`，设了密码的主机拒绝
  不带密码的中继连接。
- Osuna：同一处只把标签版本改成 `v0.15.0`（`0cfd79d03`），行为与基点一致：中继不带密码放行、带错密码拒绝。0.16/0.17
  CHANGELOG 写着「旧 App（包括官方 Paseo 手机 App）连接新主机照常工作」。两边不是重复实现。
- 规则 3 收上游会改变用户可见行为：没升级的 App、没存密码的中继主机都会被拒。
- 问题：接受上游的强制校验吗？
- 推荐：接受。这是安全修复（泄露的配对链接即可拿到完整控制权）。在合并后首个 Osuna 版本的 CHANGELOG「行为变化」写明
  「设了密码的主机，经中继连接必须带密码；旧 App 需重新添加主机」，并在 `SECURITY.md` 同步。

#### Q5 手机上逻辑图首次自动打开时是否弹出 Explorer

- 上游 #7424 后，手机上 Explorer 要先 `usePanelStore.showMobileFileExplorer()` 才会弹出。
- Osuna 的 `autoOpenLogicMapTab` 只调 layout store 的 `showExplorerSidebar`；合并后手机上逻辑图标签会加进 Explorer 但不弹出。
- 规则 3 保留两边即得到「不弹出」，但这是用户可见行为，需要确认。
- 推荐：不弹，只加标签；手机上全屏弹出会打断正在看的对话，桌面行为不变。

#### Q6 上游新 lint 规则 `paseo/no-raw-pressable`

- 上游：`scripts/oxlint/paseo-plugin.mjs` 新增规则，豁免名单 96 个文件，注释写「只许移出，不许加入」。
- Osuna：约 27 个非测试文件直接用 `Pressable`（如 `api-endpoints/*`、`components/usage/*`、`logic-map/canvas.tsx`、
  `provider-detail/*`），合并后 lint 会挂。
- 规则 3 要两边都保留，但与上游的名单约定冲突；在合并内迁到 `PressHighlight` 又会改动设置页按下态外观（规则 1）。
- 问题：合并时把这些文件加进豁免名单、另开工单迁移，可以吗？
- 推荐：可以。合并 PR 只做合并；迁移涉及设置页外观，单独做并截图验收。

#### Q7（可后置）远端子 Agent 不进派发组

- 上游 #7370 让 Agent 在远端主机建子 Agent，只出现在 Subagents track；Osuna 的 `subagents/dispatch-group.tsx` 只在父 Agent
  所在主机按标签找子 Agent，`parentToolCallId`（`86475c4ec`）也不会随远端创建请求传过去。
- 这是新功能的缺口，不是现有行为丢失。推荐合并时不补，另开工单。

### 3.2 可按规则直接裁决

提供方与语音

1. **语音**：无冲突。上游只有 #6060（`speech/providers/openai/config.ts`、`persisted-config.ts`）、#7756（`tts.ts`）、
   #7200（`audio-engine.*`、`use-dictation*`）；Osuna 自基点没改 `server/speech`、`app/src/audio`、`use-dictation*`。
   只需核对 #7200 新键的 zh-CN。
2. **Add provider 目录**（#6953 #7030）：上游改 `components/provider-catalog-list.tsx` 为卡片网格 + `SearchField`，排序走
   `provider-catalog-search.ts` 的 `rankProviderCatalog`，失败弹 toast。Osuna 目录在弹窗 `screens/settings/provider-catalog-dialog.tsx`，
   头部搜索、`settingsStyles.row` 行列表、`matchesSearch` 过滤、弹窗内 `Alert`（`011d4eaea` `0c55827ac` `f8e980a85`）。
   裁决：规则 1 保留 Osuna 弹窗、行列表与行内错误；规则 2 把 `rankProviderCatalog` 排序接到 Osuna 列表并保留其测试。
3. **Hoplite**：上游内置插件 `plugins/hoplite-provider`、`requiresConfiguration`、`features.hopliteProvider`、
   `buildAcpProviderConfigPatch(entry, supportsHopliteProvider)` 带 `COMPAT(hopliteProvider)`、`isConfigOwnedProvider`。
   Osuna 弹窗调用不带能力位，Remove 只看 `provider-detail/header.tsx` 的 `providerSource === "custom"`。
   裁决：规则 2/3 收入，弹窗接能力位，把「写进配置的内置提供方可删除」补进 Osuna 的 `canRemove`；硬编码
   `"Update the host to add Hoplite."` 改翻译键；`COMPAT` 版本改 Osuna 版本号。外链只有 `installLink: https://hoplite.sh/docs/cli#install`，
   与其他 ACP 条目同类、不在 release.md 的 PAT 里；赞助文案只在 CHANGELOG 与 `packages/website/public/sponsors/`。
4. **#6507 长自定义模型名的 Remove**：上游改 `provider-diagnostic-sheet.tsx` 的 `CustomModelRow`，Osuna 已把它挪进
   `provider-detail/`。规则 2：把 `flexShrink`/`minWidth` 修复移到 Osuna 的位置，`custom-model-removal.spec.ts`、
   `provider-removal.spec.ts` 按 Osuna 结构适配。
5. **#7611 元数据生成只用所选模型**：上游改 `structured-generation-providers.ts`、`git-metadata-generator.ts`，文案键
   `fallbackHint` 换成 `modelHint`。Osuna 只在 `metadata-generation-page.tsx` 删了 paseo.sh 链接并加 `scope="allProviders"`。
   规则 3 收逻辑；新键里的 “Paseo” 改 “Osuna”（main 的 `fallbackHint` 已是），文档链接不放回（规则 1）。
6. **#6403 Claude 模型探测**：`claude/model-discovery.ts` 的 `discoverClaudeModels` 刷新时起一次 Claude Code 读
   `supportedModels()`。Osuna 接口模型走 snapshot 的 `apiEndpointModelGroups`，不经官方清单，不重叠。规则 3；合并后实测
   总开关开着时探测进程不进中转站账本。
7. **其余提供方修复**（#7209 #6741 #7383 #5999 #7590 #7453 #6920 #7781 #6325 #7339）：功能不重叠，规则 3。#7209 会让
   包装脚本的「已装版本」读不到，属更准确的行为。

主机、通知、Agent 间消息

8. **连接的主机 #7370 #7593**：上游 `server/connected-hosts/`（`$PASEO_HOME/hosts.json`）、RPC `hosts.*`、
   `features.connectedHosts`/`hostMultiplexing`、`cli/src/commands/host/`、`paseo-tools.ts` 的 `hostTools` 给 7 个工具加
   `serverId`、新工具 `list_hosts`、`PARENT_SERVER_ID_LABEL`。Osuna 在同文件加了 `PARENT_TOOL_CALL_ID_LABEL`、`LOGIC_MAP_*`、
   `registerLogicMapTools`、`features.agentMentions`。RPC、权限键、MCP 工具、CLI 子命令、feature 键均不撞。规则 3；上游包装器
   会把 `context` 传给本地处理函数，Osuna 的 `parentToolCallId` 写法接得上。
9. **通知合并 #7561 #7683 #7528**：上游把结束通知格式化移到 `agent/finish-subscriptions/internal/notification.ts` 的
   `formatFinishNotificationBody`，投递移到 `agent-messages/{delivery,envelope}.ts`，`agent-prompt.ts` 新增
   `sendPreparedPromptToAgent`。Osuna `c8067ef5b` 把权限段改成「由用户在子会话里批准，未授权别用 respond_to_permission」，
   `agent-manager.ts` 放行带父标签 Agent 的 attention（记录在 `docs/agent-lifecycle.md`）。裁决：Osuna 文案规则 1 保留并移进
   新文件，同时留上游的 `serverId` 与 host unreachable 原因；Routing block（`resolveRoutingBlock`/`appendRoutingBlock`）规则 3
   接到 `sendPreparedPromptToAgent` 与 `startCreatedAgentInitialPrompt`。用 `subagent-permission.e2e` 验证文案没丢。
10. **#6373 发送者身份、#5164 默认插话**：上游 `d0bc188a5` 新增 `agent-messages/index.ts`、`protocol/agent-message*.ts`；
    `f22775a8e` 给 `send_agent_prompt` 加 `activeTurnBehavior`（Agent 调用默认 steer）。Osuna ADR 0004 的 Routing block 追加在
    prompt 末尾（`agent-prompt.ts:126`），`activeTurnBehavior` 在基点就有。规则 3；合并后测一次带 Agent mention 的消息经信封
    包装后 Routing block 仍在末尾。
11. **后台工作区、侧栏排序、Command Center**（#5039 #7141 #7635 #7771 #7690）：新键在 `sidebar.display.{showBackground,sort.*}`，
    Osuna 无同名；Osuna 在 `sidebar-workspace-list.tsx` 只改了样式（`1c5ffedd6`）。规则 3；新加的 Show more 行与排序菜单用
    Osuna 的 Row/Text 样式。

插件、文件面板、Explorer

12. **逻辑图的 `lineView: "preview"`**（`workspace/file-open/index.ts`、`components/file-pane-render-mode.ts`）：上游删了
    `file-pane-render-mode.ts`。规则 3：移进 `file-panels/source/panel.tsx` 决定预览/源码的那段，`file-pane-render-mode.test.ts`
    里 Osuna 的用例一起移走不删；`PluginFilePanelProps.params` 多一个可选字段。
13. **插件翻译 #7478** 与 Osuna 在 `surface-screen.tsx`、`workspace-panels/panel.tsx` 给兜底文案加的 `t()`：规则 3，语言清单一致。
14. **插件图标 #7368**：`resolvePluginIcon` → `pluginIconComponent`，Osuna 的 `settings-screen.tsx`、`sidebar-nav-section.tsx` 跟改。
15. **`panel-manifest.ts` 必填 `compactSheet`**：Osuna 的 `session_history`、`logic_map` 补 `compactSheet: null`，不撞名。
16. **Osuna 新文件引用上游已删模块**：`logic-map/panel-surface.tsx` → `@/file-explorer/read-result`；`dom-markdown.web.tsx`、
    `code-block.web.tsx` → `fence/language`、`styles/markdown-styles`。规则 3，迁到上游新位置。
17. **设置 → Files 分区**：上游 id `files`、键 `settings.files.*`，Osuna 的 `files` 键在 `panels.*` 下，不撞。规则 1：用 Osuna
    设置页外观与翻译键，补 zh-CN。
18. **手机 Explorer 统一 #7424 #7589**：上游删 `components/compact-explorer-sidebar{,-host,-host-state}.tsx`、
    `ExplorerSidebarPresentation` 去掉 `"pane"`、`PaneHost` 加 `"sheet"`。Osuna 在被删文件里加过硬编码 `"sessions"` 标签、
    `onOpenTerminal` 后切回 Agent、标签样式（`8ba86ec6d` `ec04b11dd`），而桌面已用 `EXPLORER_SIDEBAR_SEEDED_TAB_KINDS` 预置会话历史。
    规则 2：接受删除，补回手机默认预置会话历史、从会话历史开终端后 `showMobileAgent`；launcher 的
    `PRIMARY/SUPPORTING_LAUNCH_ORDER` 两边合并；`docs/explorer-sidebar.md` 以上游为底并入会话历史、逻辑图两节。
19. **Explorer 标签底色**：上游 #7589 新文件 `screens/workspace/workspace-tab-chip-backdrop.ts`
    （`resolveWorkspaceTabChipBackdrop`），Osuna `f3a4a379a` 用 `restBackdrop` 修同一问题。规则 2：以上游函数为底，换回 Osuna 的
    `surfaceTabHover`/`surfaceTabActive` 色值，保留「无关闭按钮的标签不留关闭位」。

设置页、翻译、网站与外链

20. **手机设置页大方块 #7129**：上游 `settings-screen.tsx` 的 `SidebarGroup` island 样式；Osuna 用 `SettingsNavRow`
    （`docs/design.md` 写定）。规则 1：不收 island 样式，按下态等无关外观的改动照收。
21. **`BackHeader`**：上游删 `titleAccessory`（无调用方在用），Osuna 加 `borderless`。规则 3。
22. **设置分区与侧栏条目编号**：Osuna 的 `api-endpoints`、价格表 `usage`、「隐私」、「内容宽度」上游无同名；
    `BUILTIN_SIDEBAR_ITEM_IDS` 上游未改。无冲突。
23. **按需加载翻译 #7410**：上游 `i18n/i18next.ts` 改为 `bundledTranslations` 后端、启动只载 `en`、`partialBundledLanguages`；
    `resources.test.ts` 改用 `canonicalKeys`。Osuna 没改 `i18next.ts`，运行时代码没有直接导入非英文语言包或用 `getFixedT`。
    规则 3；`api-endpoints/reopen-hints-copy.test.ts:129` 的 `getFixedT("zh-CN")` 前要 `await i18n.loadLanguages("zh-CN")`。
24. **网站简中 #7373 与外链**：Osuna 对 `packages/website` 只改过版本号，`deploy-website.yml` 只能手动触发。规则 3 全收。
    按 release.md 的 PAT 数非测试外链：上游 app/cli 在基点与 v0.13.0 都是 22/9，0.12–0.13 没加；Osuna 现为 1/3。

Changes、setup、用量、终端

25. **Changes 的 All changes #7576** 与 Osuna 大改动集优化：上游给 `CheckoutDiffCompareSchema.mode` 加 `"all"`、
    `features.checkoutDiffAll`、`checkout-git.ts` 的 `prepareAllChangesIndex`（私有 `GIT_INDEX_FILE`），客户端默认 `"all"`，
    没做按文件增量。Osuna 新增 `utils/checkout-diff-file-reuse.ts`（`CheckoutDiffFileReuse`）、1 秒节流、`filesOnly` 与
    `features.checkoutDiffFilesOnly`、`generated` 标记、`panels/changes/file-expansion`、`working-diff-subscription.ts`。
    不是同一功能的两套实现，规则 3。`checkout-diff-manager.ts` 的 `normalizeCompare` 里 Osuna 写死 `"base"` 与上游
    `mode: compare.mode` 同行冲突；要把 `filesOnly`/`fileReuse` 接到 all 模式，并补测试证明私有 index 下未跟踪文件的判定。
26. **#6745 等价提交**：Osuna `3c8f957da` 已单独摘过，与上游 `be0acb293` 内容等价，冲突取上游一侧。
27. **工作区 setup #7407 #7473 #6999 #6542**：上游删 `worktree-bootstrap.ts`/`worktree-session.ts` 约 780 行、重写
    `create-agent/create.ts`。Osuna 没改 setup，只在 `create.ts` 加了 `resolveRoutingBlock`、`withParentToolCallIdLabel`。
    规则 3，挂到上游新流程上。
28. **用量服务端** `plugins/usage-sources/index.ts`：上游 #7246 加 `successful` 快照与 `activeCacheKeys` 清理；Osuna 加多号轮换
    （ADR 0015）、`forget()` 代数、用掉一次重置。规则 3；缓存键与清理互相影响，要用测试证明。#7778 #7344 #6947 只有上游改，直接收。
29. **`paseo usage` CLI #6474**：Osuna CLI 无 usage 子命令，不撞。规则 3 收；规则 2 补一条：主机关掉「读取 CLI 登录凭证」时
    命令说明原因，而不是只显示空列表。
30. **终端 #7639 #3795**：上游删 `terminal-emulator-webview.native.tsx` 与 `useLegacyTerminalRenderer`，Osuna 没改渲染器选择，
    只重新生成过 `terminal-emulator-webview-html.ts`；规则 3 接受删除，清掉 `settings-screen.tsx` 与 `storage.test.ts` 的引用。
    #3795 重写 `terminal-emulator.tsx`、`terminal-pane.tsx`，与 Osuna 的字体/字号、四边内边距、DECSET 2031 主题推送
    （`c3cf65346` `953eb7122` `38ac3a4f5`）是同文件不同功能，规则 3。

产品决定与 CI

31. **桌面身份、更新源、daemon 自更新**：上游 `packages/desktop` 只加了 Linux `extraResources` 的 `icon.png`、
    `protectConsoleStreams`、`showWindowWhenReady`；`appId`、`productName`、`publish`、userData 都没碰；区间内没有更新器或
    daemon 自更新相关提交。无冲突，照 release.md「合并后核对」逐项过一遍即可。
32. **CI 运行环境**：上游 `ci.yml` 改成 8 个 Playwright 分片、`app-tests` 等新作业，`runs-on: ubuntu-latest` 并
    `npx playwright install`。Osuna 已把装 Playwright 的作业固定为 `ubuntu-24.04`（#24，ubuntu-latest 装不上）。规则 3：
    上游新作业凡是装 Playwright 的都改成 `ubuntu-24.04`。
33. **`COMPAT` 版本号**：上游 0.12/0.13 新带进的标签写 `added in v0.12/v0.13`，与 Osuna 自己的 v0.12–v0.17 同名不同义
    （main 上有 66 个文件带 `added in v0.12–0.17`）。按 release.md 只改写合并前 main 上不存在的标签名。

## 4. 没查完的部分

- `claude/agent.ts` 里 #7431 #7626 的大段重写与 Osuna 指令发现、Routing block 剥离的逐段冲突。
- #7370 对 `daemon-client.ts`、`session.ts`、`websocket-server.ts` 的具体冲突块；#7683 结束订阅持久化文件与 Osuna 数据目录的关系。
- enriched 渲染器在 Web 上的实际显示（Q1、Q2 的推荐没有界面验证）。
- #7424 顺带把 Expo 升到 57（`package-lock.json`、patches）对 Osuna 依赖的影响。
- `docs/design.md` 上游增改只看了 `no-raw-pressable` 一段；`sidebar-nav-section.tsx` 窄屏改动、可折叠屏 #7705 细节。
- `push-router.ts`（Osuna 改 77 行）的用途；#6455 Send feedback 在 Osuna `filesOnly` 下的表现；`usage/format.ts` 逐行对比。
- #7373 插件清单翻译的服务端（`plugin-registry.ts`、`manifest.ts`）；`public-docs/**` 与 `*.zh-CN.md` 里的外链。
- 原生终端去掉旧渲染器后能否沿用 Osuna 字体设置（原生端免验收）。
- release.md 提醒的「只在 beta 中间段存在的设计」：没有逐个 beta 对比 v0.13.0 的最终形态。
