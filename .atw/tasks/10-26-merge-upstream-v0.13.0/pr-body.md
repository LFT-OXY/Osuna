## Summary

把上游 `getpaseo/paseo` 从 v0.11.2（`759532509`）到 v0.13.0（`d34d17a90`）的 328 个提交合进 main。分支从 main `b8d4f55e7` 开出，按上游七个发布点分七段，每段一个 merge commit，以 merge commit 并入。

```text
main b8d4f55e7
└── merge-upstream-paseo-updates
    ├── 3fc36c0a8  规划
    ├── f65422084  ← v0.12.0-beta.1 e2f4948f9（165 个提交）冲突 97
    │   ├── 45738fc5d 66b25dde6  适配：COMPAT、zh-CN 术语、记录
    │   ├── 0ae2787f1  ATW 升级到 0.7.0（与合并无关）
    │   └── 1007e07dc 223d38be0  适配：聊天 Markdown 与全屏 Composer、提供方
    ├── 16d847b51  ← v0.12.0-beta.2 c517d07d6（27）冲突 31
    │   └── 4633a4393  适配：COMPAT
    ├── a5eb7c89a  ← v0.12.0-beta.3 cc748dfe1（22）冲突 31
    │   └── bba9d2374  适配：Playwright 分片 5–8 固定 ubuntu-24.04、COMPAT
    ├── 80515069f  ← v0.12.0 cafe4b01c（22）冲突 26
    │   └── 17dc4c830 d2356e0e0  适配：COMPAT、记录
    ├── f98b93b1d  准备：删除 DOM Markdown 文件预览（ADR 0016）
    ├── f44be7529  ← v0.13.0-beta.1 3fa625701（52）冲突 76
    │   └── eeb3b5362 fa09280cd 1f18ae842 … 2c350eeb2  适配：Expo 57 导航钩子、Explorer、套餐用量文案、All changes、连接的主机、插件文件面板
    ├── 7e2a7ef83  ← v0.13.0-beta.2 30d8cb044（27）冲突 45
    │   └── 274385b24  适配：COMPAT、e2e 面板名、Markdown 行号用例
    ├── c644c42f6  ← v0.13.0 d34d17a90（13）冲突 22
    ├── abc5dbdc9  评审修正（工单 12）
    └── 140441c61  视觉走查与截图（工单 13）
```

带进来的：连接的主机（`paseo host add`、`hosts.*` RPC、`list_hosts`）；Hoplite 与按匹配度排序的「添加提供方」；侧栏按创建时间排序、后台工作区、「显示更多」；Changes 的 All changes（默认）；新的 Markdown 渲染器（跨段选择、表格横滑）；终端粘贴图片与拖入文件；插件文件面板与插件翻译；Claude 计划审批的 Implement with Auto、Mythos 5.1；子 Agent 报告与结束通知合成一条、daemon 重启后仍送达；手机全屏写消息与三端统一的 Explorer；经中继连接设了密码的主机必须带密码（#7668）；以及这两个版本的缺陷修复。Hoplite、连接的主机与登录相关的能力没有在本机实测，靠上游随合并带来的测试。

桌面身份、更新源、签名、外链、设置页外观、界面中文、版本号（`0.17.0`）与 `CHANGELOG.md` 仍是 Osuna 的。

### 各段冲突裁决

规则见 `docs/release.md`「冲突裁决」：① Osuna 的产品决定保留；② 两边重复实现以上游为底、补回 Osuna 多出的；③ 其余两边都留。逐文件记录在 `research/` 下（路径相对 `.atw/tasks/10-26-merge-upstream-v0.13.0/`）。

| 段 | 裁决摘要 | 记录 |
| --- | --- | --- |
| 1 | 补丁分支分叉处 16 个文件：上游部分取主线一侧，依赖补丁脚本取主线。版本号取 Osuna，锁文件重新生成（只多新渲染器的依赖）。`agent-manager.ts` 历史回放、导入、流式三处先剥 Routing block 再交给上游的信封投影（ADR 0004）。`acp-agent.ts` 保留指令报回即推送、不放回 `waitForInitialCommands`（ADR 0003）。`settings-screen.tsx` 整份取 Osuna（手机设置首页不收大方块）；`providers-section.tsx` 取 Osuna，添加失败的 toast 不收（Osuna 是行内错误）；`theme.ts` 取 Osuna 色板。`workspace-screen.tsx` 以上游拆分为底，Osuna 的改动挪到新文件。README 不收赞助表。CLAUDE.md 文档表两边都留（维护者确认）。 | `research/stage1-resolutions.md`，工单 01–03 |
| 2 | 版本号类取 Osuna，与合并前逐字节相同。新建工作区表单随上游挪到 `screens/new-workspace/form/`，Osuna 的翻译键补到新位置。问题卡片取 Osuna 的编号行，只补上游的 `responseError`。打开项目页以上游为底，Logo 换回 `OsunaLogo`。 | `research/stage2-4-resolutions.md` 第 2 段，工单 04 |
| 3 | 用量来源以上游「最近一次成功的快照」为底，保留 Osuna 的遗忘代数、`consumesResets`、存着的号（ADR 0015），补两条并存用例。上游新加的三句英文改走翻译键。聊天 Markdown 块间距用上游 #7298 的统一间距（维护者确认）。新增 Playwright 分片 5–8 改 `ubuntu-24.04`。 | 同上 第 3 段 |
| 4 | 收下 `paseo/no-raw-pressable` 检查，Osuna 21 个文件单独成块豁免（放进 merge commit，否则钩子 lint 过不了）。`docs/design.md` 以上游为底补回 Osuna 两处。`provider-catalog-icons.spec.ts` 按 Osuna 弹窗改写。 | 同上 第 4 段 |
| 5 | 先在准备提交里删掉 DOM 预览，13 个改名冲突因此没有出现。锁文件以上游锁为底补 Osuna 独有的 34 个包（npm 报「已是最新」却留在 Expo 54）。Explorer 接受上游 #7424 三端统一，补回会话历史；标签底色以上游函数为底、换回 Osuna 色值。Changes 比较模式不再写死 `base`。套餐用量以上游 `providerUsage` 为底（键合一在工单 08）。连接失败文案以上游新文件为底，搬入 Osuna「密码被拒只给本地化原因」。子 Agent 跨主机打开搬进 Osuna 的 `use-open-subagent.ts`，派发组只列本机。内置文件面板提供者名改 Osuna。Expo 57 下三页从 `@react-navigation/native` 取 `useIsFocused` 会崩，改从 `expo-router/react-navigation` 取并加 lint 规则（`fa09280cd`、`1f18ae842`）。 | `research/stage5-resolutions.md`，工单 06–11 |
| 6 | 接受 #7668，删除 `relayPasswordOptional` 免密分支。结束通知随上游搬进 `finish-subscriptions/internal/notification.ts`，Osuna 的权限文案搬过去，上游的 `host unreachable`、`host removed` 照收。接受删除 WebView 终端渲染器。`autocomplete-popover.tsx` 以上游为底补回 Osuna 的内缩与贴边。状态图标随上游抽进 `StatusIcon`，Osuna 两个无障碍文案搬过去。`docs/glossary.md`、`docs/release.md` 两边都留。元数据生成提示 `modelHint` 里 “Paseo” 改 “Osuna”，不放回文档链接。 | `research/stage6-7-resolutions.md` 第 6 段，工单 12 |
| 7 | 版本号类取 Osuna，锁文件与合并前逐字节相同。同名安卓商店说明 `130001`–`130004` 留 Osuna。`plugins/evaluate.ts` 取上游一行、COMPAT 版本留 v0.18.0。`sidebar-order-store.ts` 取上游的删除。 | 同上 第 7 段 |

上游新带进来的 `COMPAT(...)` 标签名都改写成 `v0.18.0`，日期不动；清单在工单 01、04、06、12 的 Comments。

### 删掉的 Osuna DOM 文件预览（ADR 0016）

Markdown 文件预览在 Web、Electron、手机都用上游 `file-panels` 下的预览与 Preview/Source 切换。Osuna 在 Web 上的 DOM 预览整套删除，提交 `f98b93b1d`（工单 05）。这是「Osuna 原有的测试不删除」的例外。

删除的文件，`packages/app/src/file-pane/markdown-preview/` 下 13 个：`index.web.tsx`、`dom-markdown.web.tsx`、`styles.web.ts`、`github-alerts.ts`、`code-block.web.tsx`、`image.web.tsx`、`link.web.tsx`、`resource.ts`、`resources-context.web.ts`、`pipeline.ts`、`source-line.web.ts`，以及下面两个测试文件。同目录的 `index.tsx`、`document.ts`、`document.test.ts` 是上游文件，还原成上游原样。

随之删除的测试：

- 两个测试文件：`markdown-preview/resource.test.ts`、`markdown-preview/source-line.browser.test.tsx`。`prd.md` 用户故事 60 与验收清单写的是「三个测试文件」，实际是这两个文件加下面的 e2e 用例与断言行（工单 05 的清单）。
- `e2e/browser/file-editing.spec.ts` 的 3 个用例（维护者 2026-10-26 同意），连同只给它们用的常量与辅助函数：
  - "renders a README-style Markdown file as sanitized HTML with GFM"
  - "repaints Markdown prose, quotes, tables, and code when the color scheme changes"
  - "renders the five GitHub alerts with localized titles and distinct colors"
- `markdown-preview/document.test.ts` 里 Osuna 加的 5 行 `bodyStartLine`（5 个用例各一行）。上游原有断言都在。

一并删掉：九种语言的 `panels.file.markdownCodeBlock`（1 键）与 `panels.file.markdownAlerts`（5 键）；`packages/app/package.json` 的 `react-markdown`、`rehype-raw`、`rehype-sanitize`、`rehype-slug`、`remark-gfm`。

不再有的效果（ADR 0016 接受，`prd.md` Out of Scope）：提示框、HTML 居中与徽章行、预览代码块着色、仓库内链接标签、缺图占位、磁盘变更刷新、预览里按行定位。逻辑图带行号的节点改为打开源码视图并停在那一行。

### 因换成上游实现而改动的 Osuna 断言

Markdown：

- `components/markdown/renderer.test.ts`：旧的 `styles/markdown-styles.test.ts` 随上游删掉样式文件，可表达的断言迁到「Osuna Markdown typography」一组（工单 02）。新引擎表达不了、没有迁的：shrink-and-wrap、Web 可选中、行内代码的圆角与水平内边距、引用块的分边内边距与右侧圆角、原生端代码块的 `paddingTop`（逐条原因在工单 02）。
- 同文件，块间距用上游统一间距（维护者 2026-10-26 决定）：段落下边距 `spacing[3]` → `16`；compact 段落下边距 `spacing[2]` → `12`；Web 代码块外框的 `marginVertical: spacing[3]` 改为断言不带 `marginVertical`（工单 04）。
- `components/file-pane-render-mode.test.ts`：工单 05 去掉「预览能否滚到行」参数，节点文档用例预期 `"markdown"` → `null`，HTML 那条拆出来，预期不变。第 5 段上游删了被测模块，4 个用例挪进 `file-panels/choice/model.test.ts`、经 `filePanelLineNavigation` 走上游的面板选择（工单 06）。第 6 段上游 #7614 把 Source 做成内置面板里的视图，其中 3 条预期从 `builtin:source` 改为 `builtin:markdown` / `builtin:html`，用户看到的效果由 `file-editing.spec.ts` 新补的「opens a Markdown line target as source」证明（工单 12）。
- `e2e/browser/plugin-file-panel-examples.spec.ts`：「Source — Osuna」单选可见的断言随上游删掉独立 Source 面板，改为上游的 `toHaveCount(2)`；helper 的 `SOURCE_OPTION` 删掉（工单 12）。

中继准入：

- Osuna 没有改过的断言。`server/auth.test.ts` 由上游 #7668 自己改：准入函数去掉 `transport` 参数，「中继不带凭据放行为 owner」「中继错密码」两条随参数删掉。新行为由 `daemon-e2e/relay-transport.e2e.test.ts`「password-protected daemon refuses a relay client without the password」守着（工单 12）。

套餐用量：

- `usage/format.test.ts`：`formatDisplayPct(31, "used")` 从 `"31%"` 改为 `"31% used"`（en）、`"已用 31%"`（zh-CN），用例名跟着改（上游 #7376，工单 06）。
- `usage/pinned.test.ts`：中文用例 `"Codex Weekly"` → `"Codex 每周"`（工单 06）。
- `e2e/browser/usage-settings.spec.ts`：冲突块之外上游自动合并进来的 `"70%"` → `"70% used"`、`"64%"` → `"64% used"`，保留（工单 06）。
- `usage/model.test.ts`：`formatUsageFreshness` 删掉，describe 改名「report freshness」改测上游的 `formatAgo` 路径；其余断言不变，只有 `"Updated Jan 15"` 改成 `"Updated 30d ago"`（上游对较早的时间只写天数，行为变化，工单 08）。
- `plan-usage/strip.test.ts`：只把翻译键名换成上游的 `providerUsage` 键，断言不变（工单 08）。

Agent 间消息与结束通知：

- `server/agent/agent-prompt.test.ts`：权限文案断言改为对 `parseAgentMessage` 解开信封后的正文断言，内容不变（工单 01）。第 6 段上游把结束通知用例整组挪走，这条断言挪进 `finish-subscriptions/finish-subscriptions.test.ts`「permission checkpoint retains intent…」，原文与 `toContain` 不变（工单 12）。
- `daemon-e2e/agent-mention-routing-block.e2e.test.ts`：两条「不带 Routing block」从「prompt 原文相等」改为「信封能解析出原文 + 逐条比对末尾没有 Routing block」（先滤掉上游的结束通知）；老客户端辅助函数等第一帧再发（工单 01）。「MCP send_agent_prompt and schedule fires never get a Routing block」在断言前加 `expect.poll` 等消息送到，跟上游 #7561 的排队投递，断言一行未改（工单 10）。

其余：

- `generic-acp-agent.commands.test.ts`：期望列表换成上游 fake 脚本新报的两条（review 带参数提示、status）；「等报回、不等进程」的写法与 null 用例不变（ADR 0003，工单 01）。
- `autocomplete-utils.test.ts`：`bottomInset` 两条挪进上游的 `scroll-reveal.test.ts`，另两条与上游重复删去（工单 01）。
- `workspace-tabs/explorer-sidebar.test.ts`「selects Session history in the compact Explorer」：`usePanelStore.explorerTab === "sessions"` 改为断言布局里 Explorer 聚焦 `session_history`（上游删了 `explorerTab`，工单 06）。
- `utils/checkout-diff-file-reuse.test.ts`「only diffs the file that changed since the previous run」：期望的 patch 命令加上游 #6562 的 `--no-ext-diff --no-color --src-prefix=a/ --dst-prefix=b/`，仍逐字相等（工单 09）。

只改调用或准备步骤、断言不变的 Osuna 用例另列在工单 06、12 的 Comments（`compact: false`、去掉 `supportsPaneSplits`、`persist.rehydrate()`、假 toast 返回关闭函数等）。

### 按 Osuna 决定改写的上游测试

「添加提供方」是 Osuna 的弹窗与行列表，不是卡片网格（规则 ①，工单 03、04）：

- `e2e/browser/acp-provider-catalog.spec.ts`：toast 断言改为弹窗行内错误 `provider-catalog-error` 的整句；点「Add Hoplite」改为搜索后点「Add」；添加后断言进详情页。
- `e2e/browser/provider-removal.spec.ts`「does not offer Remove for a plugin-registered provider」：改为进详情页打开 ⋯ 菜单断言没有删除项（原断言在 Osuna 列表上恒真）。
- `e2e/support/helpers/custom-models.ts`：添加按钮改用 Osuna 就地添加行的 `provider-add-model-submit`。
- `e2e/browser/provider-catalog-icons.spec.ts`：按行找图标，尺寸按 Osuna 的 20px（兜底 16px）。

手机设置首页保留 Osuna 的行列表：`settings-screen.tsx` 整份取 Osuna（规则 ①，`research/stage1-resolutions.md`「app：设置页」）。材料里没有记录因此改写的上游测试。

Composer 在 Web / Electron 是 Tiptap，按 textarea 读的改成读 contenteditable（工单 02、06、12）：

- `composer-whitespace`、`new-workspace-composer-draft`、`new-workspace-dictation-submit`、`new-workspace-launch-terminal`：29 处 `toHaveValue(X)` 换成 `expectComposerText(同一 locator, X)`，期望值不变；`composer-whitespace` 两条高度上限量 `[data-composer-input]` 外框。
- `support/helpers/composer.ts`：选区辅助用 Tiptap 选区；几何量外框。
- `composer-email-mentions`：选中文件后草稿是 Osuna 行内块。`composer-focus`：复制按钮按名字 `Copy code` 找。
- `composer/input/text-input.web.browser.test.tsx`「keeps its editing handle and selection across a rerender during composition」：上游 textarea 写法按 contenteditable 改写。
- `add-changed-file-to-chat.spec.ts`：改用 `expectComposerText`。`settings-toggle-tab-regression.spec.ts`：输入框按 Tiptap 读 `[role="textbox"]`。

ADR 0003（取指令列表不启动进程）：七段都没有改到指令发现代码，没有遇到要改写的上游 Claude 用例（工单 06、12）。唯一相关的改动是上面 `generic-acp-agent.commands.test.ts` 的期望列表。

内置文件面板提供者名是 Osuna（ADR 0002 的显示身份，规则 ①），上游 e2e 写死「— Paseo」，只改名字、断言动作不变（工单 11、12）：

- `e2e/support/helpers/markdown-file-panel-plugin.ts` 的 `BUILTIN_MARKDOWN_OPTION`（`SOURCE_OPTION` 第 6 段随上游删掉）。
- `e2e/browser/plugin-file-panel-examples.spec.ts` 的 radio 名字与 `:239` 的 “Open with…” 菜单项。
- `e2e/browser/plugin-file-panels.spec.ts:98`。
- `e2e/browser/plugin-file-panel-settings.spec.ts` 本地常量 “Source — Osuna”（断言 `toHaveCount(0)`，不改名会恒真）。
- 合并后 `packages/app/e2e` 下 `— Paseo` 0 处。

色值与外观：

- `appearance-theme-picker.spec.ts`、`e2e/support/helpers/settings.ts`：取 Osuna 的主题色值（工单 01）。
- `components/markdown/renderer.test.ts`「uses %s theme colours for tables and task labels」：`list.color` 从 `foreground` 改为 `foregroundProse`（Osuna 正文 86% 色调，工单 02）。
- `sidebar-nav-settings.spec.ts`：上游的 `expectFooterSeparator(page, true)` 换成 Osuna 的 `expectNoFooterRule`（Osuna 侧栏底部不画分割线，工单 12）。

套餐用量按 Osuna 译法（工单 08）：

- `usage/format.test.ts`：ja、fr、ar 的重置与用完文案改为 Osuna 译法（逐条前后值在工单 08）。
- `usage/model.test.ts`：韩语主机不可用提示改为 Osuna 译法。
- `e2e/browser/usage-modal.spec.ts`（日文）：选项按钮名「設定」→「プラン使用量のオプション」，「割合」→「表示」并限定在选项面板内。
- `server/plugins/usage-sources/index.test.ts`：上游新用例的位置参数构造函数改成 Osuna 的选项对象（第 3 段 5 处、第 4 段 1 处），断言不变。

其余：

- `website/e2e/i18n.spec.ts`「shows the changelog in Chinese」：`CHANGELOG.zh-CN.md` 是上游原样、Osuna 不写中文条目（维护者 2026-10-26 决定），Osuna 的版本整条以英文显示并带「尚未翻译」提示。上游断言 `getByRole("note")` 个数为 0 在 CI 上数到 13 条；改为断言能看到这条提示，「新增」小标题的断言不变（维护者 2026-10-27 同意，工单 14）。
- `website/src/data/sponsors.test.ts`：改为断言 README 里没有赞助表（README 归 Osuna、外链只指向本仓库，工单 01）。
- `i18n/resources.test.ts`：允许清单加 `providerCatalog.types.acp`（协议名 ACP，工单 01）；内置面板提供者名加进 `brands`、`builtin.markdown`/`builtin.html` 加进 `abbreviations`（工单 06）。
- `agent-stream/model.test.ts`、`timeline/turn-time.test.ts`：期望值补 Osuna 的 `turnId` / `userMessageId: null`（工单 01）。
- `components/connection-failure-copy.test.ts`「preserves authentication failures and their technical details」→「reports authentication failures with the localized reason only」：Osuna 的密码被拒只给本地化原因（`9be046d8c`，工单 06）。
- `usage/pinned.test.ts`：删掉上游用例里与 Osuna 顶部 import 重名的动态 import（lint 遮蔽，工单 06）。
- `e2e/mobile/status-ring/native.tsx`：`useStatusRingRotation()` 补 Osuna 的 `{ enabled: true }`（工单 06）。
- 侧栏「显示后台工作区」按 `docs/menus.md` 改成行尾 Switch（工单 13）：`sidebar-workspace-rename.spec.ts` 改按 `testID="sidebar-display-show-background"` 点行；`sidebar-project-filter.spec.ts` 加一条断言：名为「Show background」的 `switch` 未打开。

### 首轮 CI 之后的修正（工单 14）

首轮 CI 有 9 项失败，`main` 上 #32 全绿，都是合并带来的。逐条对日志、失败快照与 trace 定位，本机能跑的都先红后绿或单独跑过。

应用代码：

- `workspace-desktop-tabs-row.tsx`：Explorer 默认三个标签（多了会话历史），拖动时标签宽度逐帧变化，每个宽度往共享样式表加一条规则。宽度改走 `inlineUnistylesStyle`（`docs/unistyles.md`）。`explorer-resize-performance.spec.ts` 撤掉修复时本机挂、加上后通过。

Osuna 的测试，断言一对一替换、没有放宽：

- `usage-page-plan-usage.spec.ts`：`"23%"`、`"64%"`、`"61%"` → `"23% used"` 等，仍是精确匹配（上游 #7376 的写法）。
- `composer-plan-usage-strip.spec.ts`、`context-window-session-total.spec.ts`：同上，期望文本补 `used` / `已用`。
- `daemon-lifecycle.test.ts`、`test-daemon-connection.test.ts`：断言中文之前先 `i18n.loadLanguages("zh-CN")`（上游 #7410 按需加载翻译）。
- `providers-section.test.tsx`：`react-i18next` 的 mock 补 `initReactI18next`（工单 03 在 `use-acp-provider-catalog.ts` 引入了 `i18n`）。
- `server/.../checkout-diff-file-reuse.test.ts`「matches a full recomputation in All changes mode…」：Windows 上约 32 秒，单独给 120 秒超时；下一条是被它连带挂的。

按 Osuna 决定改写的上游测试：

- `appearance-font-family.spec.ts`：Osuna 在 Web 上用系统字体选择器代替文本框，`toHaveValue` 改为按「字段: 当前值」找按钮；分区标题字号 `12px` → `13px`（Osuna 的 `typeScale.label`）。
- `acp-provider-catalog.spec.ts`「model selector excludes Hoplite before opt-in」：Osuna 的模型菜单只列当前提供方，改在提供方菜单（含「More agents」）里断言没有 Hoplite。
- `changes-pane.spec.ts:276`、`composer-diff-stat.spec.ts`：Osuna 在 hunk 从第一行开始时不画 hunk 头，点新增行的位置从第 2.5 行改为第 1.5 行。
- `offline-draft.spec.ts`、`explorer-sidebar.spec.ts`（两处）：Composer 是 Tiptap，`toHaveValue` 换成 `expectComposerDraft` / `expectComposerText`。
- `explorer-sidebar.spec.ts` :341、:472：Osuna 的主题快捷键在 light → dark → auto 之间轮转，默认 auto 在浅色系统上按一下颜色不变；先固定成 light。
- `open-project-scroll.spec.ts`：Osuna 只留 GitHub Star 一个社区入口，按 `Star` 找（外链只指向本仓库）。
- `question-prompt-pagination.spec.ts:466`：Osuna 的忽略按钮是纯图标 X，「有文字 Dismiss」改为「X 图标可见」（加载中会换成转圈）。
- `usage-modal.spec.ts:868`：Osuna 日文里入口叫「プラン使用量」，改按 testID 打开。
- `composer-focus.spec.ts:88`：Osuna 代码块头部在代码前，三击段落的选区会包住复制按钮，Chromium 不把焦点交给选区里的元素；点复制前先清掉选区。
- `support/helpers/explorer-plugin-menu.ts`：上游 #7424 起 Explorer 的 + 菜单也列 Agent 与终端配置，期望列表补上。
- `support/helpers/custom-models.ts`：Osuna 提供方详情页在模型卡片前多几段，390 宽时卡片在首屏下面；断言前把搜索框纵向滚到顶部。

本机没跑、交 CI 的：`acp-provider-catalog`、`custom-model-removal`（提供方页会拉起真实 CLI 做模型探测）、`explorer-sidebar` 两条（快捷键在 macOS 上不触发）、Windows 的超时。

第二轮 CI 之后：

- `provider-detail/view.tsx`（Osuna 文件）：三处 `void refresh([provider])` 没接住失败。推送来的新快照会取消进行中的刷新（`push-router.ts` 的 `cancelQueries`，合并前就有），`CancelledError` 成了未处理的拒绝，开发版弹出错误层挡住页面，`custom-model-removal` 点不到删除按钮。三处补 `.catch`，失败由快照查询自己的状态承担。
- `agent-consecutive-turns.spec.ts:814`：用例只扣住第一个时间线响应，放行后客户端按设计再发一次 `after` 追赶请求，慢机器上带回的回复落进录帧窗口、列表跟到底部。改为同时扣住追赶响应，录帧结束后再放行；断言不变。本机 CPU 降速 6 倍改前 3/3 挂、改后 3/3 过。
- 偶发、重跑：app-tests 里 `logic-map/panel-surface.browser.test.tsx` 的 Reanimated「Failed to obtain animation index」未处理错误（8268 条全过，本机连跑 3 次干净）；server-tests (ubuntu) 的终端 OSC 等待超时；cli-tests 的 `EADDRINUSE`；`context-window-session-total.spec.ts:110` 等待超时。四项第一轮都通过。`file-explorer-context-actions.spec.ts:114` 第一轮重试后通过。

### 加进 `paseo/no-raw-pressable` 豁免名单的 Osuna 文件

上游第 4 段新加的「不许直接用 Pressable」检查照收。`.oxlintrc.json` 里单独一块，注释写明是 Osuna 合并上游 v0.12.0 时加入、待迁移。21 个，都在 `packages/app/src/` 下（`prd.md` 估计约 27，以实际报错为准）：

```text
agent-stream/turn-changed-files-card.tsx      components/usage/usage-session-list.tsx
agent-stream/turn-usage-segment.tsx           logic-map/canvas.tsx
api-endpoints/agent-section.tsx               price-table/litellm-price-group.tsx
api-endpoints/connection-form-sheet.tsx       provider-detail/header.tsx
api-endpoints/host-list-section.tsx           provider-detail/models.tsx
api-endpoints/models-section.tsx              screens/settings/appearance/font-picker-row.tsx
api-endpoints/request-extras-fields.tsx       screens/settings/mention-defaults-section.tsx
components/branch-switcher.tsx                subagents/dispatch-group.tsx
components/provider-catalog-list.tsx
components/usage/usage-details-card.tsx
components/usage/usage-overview-card.tsx
components/usage/usage-requests-table.tsx
components/usage/usage-segmented-control.tsx
```

上游名单的注释写「只许移出」，这一块违背它，维护者已知。

### 要写进下次发版更新日志的

这个 PR 不发版，`CHANGELOG.md` 没有变。发版时把下面这句搬进「行为变化」（工单 12）：

> 设了密码的主机，经中继（relay）连接现在也必须带密码，与直连一致；旧版 Osuna 与官方 Paseo 手机 App 里经中继添加、没有保存密码的主机会连不上，需要在 App 里重新添加主机并输入密码。（上游 #7668）

`SECURITY.md`、`public-docs/security.md`、`public-docs/security.zh-CN.md` 已随上游改为「中继客户端也必须带密码」。

材料里另记下的用户可见变化：

- 「添加提供方」无搜索词时按名称字母排序；搜索只匹配名称和 id，不再匹配描述（工单 03）。
- 插件注册的提供方不再给「移除」，写进配置的内置提供方（如 Hoplite）可以移除（工单 03）。
- 套餐用量较早的更新时间写天数（「30d ago」），不再写日期（工单 08）。
- 手机端聊天代码块没有语言标签头（新引擎原生端自己画代码块，工单 02）。
- 聊天 Markdown 块间距改为统一间距（窄 12、宽 16，工单 04）。

### 后续工单与留给维护者的

后续工单（任务目录还没建）：

- Pressable 迁移：上面 21 个文件迁到上游的按钮组件，会改设置页等处的按下态外观，届时截图验收（`prd.md`「代码规范检查」，工单 04）。
- 远端子 Agent 进派发组：连接的主机上建的子 Agent 不进派发组，派发组只列本机子 Agent。要做时选择器按 `serverId` + `agentId` 匹配，并经远端主机查归档子 Agent（维护者 2026-10-26 确认这次不补，工单 10）。

已有任务：`10-13-zh-relative-time-and-plan-labels`（侧栏与会话历史的相对时间 `now`、`13h`、`Oct 8`，工单 13）。

各工单记下、没有改的：

- `server/src/server/agent/mcp-parity.e2e.test.ts` 4 条失败在纯上游 `3fa625701` 上同样失败，是上游自己的缺陷，不在 CI 清单，不修（工单 06）。
- `e2e/browser/explorer-sidebar.spec.ts` 的 :341、:407、:472 三条「切换外观时保持 Explorer 挂载」本机挂，换回工单 07 改动前同样挂，不是这次引入（工单 07）。
- Explorer 标签行放不下时不跟随选中标签滚动，英文下更明显（工单 13）。launcher 的「编辑配置」没有图标位、「+」静止色对比度约 2.35:1（工单 07，上游原样）。
- 其余没传 `cancelLabel` 的原生确认框取消按钮在中文下仍是「Cancel」，main 上相同（工单 13）。
- zh-CN `editor.source`「源代码」与 `viewSource`「查看源码」两种说法，上游译文（工单 12 留给 13，工单 13 的记录里没有结论）。
- 「显示更多」14px、工作区行标题 13px，合并前就有；Markdown 预览把小图放大约 1.2 倍；计划卡片「你想如何继续?」半角问号、会话历史空状态带句号，main 上相同（工单 13）。
- 开发版控制台警告：`uniProps` 落到 DOM（unistyles 的 `withUnistyles`）、按钮套按钮、`importantForAccessibility`（`components/context-window-meter.tsx:111`）、`accessibilityElementsHidden`（上游的 `command-center.tsx`、`left-sidebar.tsx`）。只在开发版出现（工单 04、09、11）。

## Evidence

### 硬指标

```console
$ git rev-list --count 759532509..d34d17a90
328
$ git log b8d4f55e7..HEAD --merges --first-parent --format='%h %p'
c644c42f6 274385b24 d34d17a90
7e2a7ef83 2c350eeb2 30d8cb044
f44be7529 f98b93b1d 3fa625701
80515069f bba9d2374 cafe4b01c
a5eb7c89a 4633a4393 cc748dfe1
16d847b51 223d38be0 c517d07d6
f65422084 3fc36c0a8 e2f4948f9
$ git merge-base --is-ancestor 759532509 HEAD && git merge-base --is-ancestor d34d17a90 HEAD && echo ok
ok
$ git merge-base --is-ancestor origin/main HEAD && echo ok   # main 在此期间没有新提交
ok
$ git diff --quiet b8d4f55e7 HEAD -- CHANGELOG.md && echo same
same
$ grep -rn -- '— Paseo' packages/app/e2e | wc -l
0
```

每段合完逐项过的核对（工单 01、04、06、12 的「合并后核对」）：

- 更新源 `publish` 是 github / LFT-OXY / Osuna；`appId: com.chinhae.osuna.desktop`、`productName: Osuna`；`main.ts` 的 userData 固定不变；`mac-sign.js`、`OSUNA_MAC_SIGNING_SHA1`、Verify macOS signature 都在。
- `android-apk-release`、`deploy-app`、`deploy-website`、`deploy-relay` 只有 `workflow_dispatch`。装 Playwright 的作业都是 `ubuntu-24.04`。
- 13 个 `package.json` 版本号 `0.17.0`；锁文件差异能对应到上游的依赖（新 Markdown 渲染器、Expo 57、`@noble/*`）与工单 05 删掉的 DOM 预览依赖。`CHANGELOG.zh-CN.md` 是上游原样。
- 应用与 CLI 源码中指向上游站点的链接（全部 / 非测试）：合并前 app 73 / 1、cli 13 / 3；合并后 app 75 / 1、cli 13 / 3。多的 2 处在上游的 `components/markdown/renderer.test.ts` 测试样例里。
- 协议新增字段都是可选的（第 6 段的 `minimumSecurityMode`、`requireProtectedSecurity`、`relayProtectedSecurity`、`workspaceSortTimes` 等）；`mode` 枚举只加 `"all"`；协议现有测试断言未改。中继密码是行为变化，不是 schema 变化。
- `server/bootstrap.ts` 不含提供方名字。
- 翻译资源测试每段单独跑过并通过，上游新键九种语言齐全，zh-CN 按术语表核对。

测试：每段新增或改动的测试文件与冲突文件对应的测试逐个单独跑（第 1 段 241 个、第 5 段 162 + 82 个、第 6 段 131 个、第 7 段 19 个等，见各工单「测试」）。提供方类 Playwright 用例、要拉起真实 CLI 的 e2e、macOS 上的快捷键用例本机不跑，交 CI。每段对冲突涉及的测试文件比对「合并后删掉、且不在该段合并基点里」的行，Osuna 的只有上面列出的几条。

### 界面

截图在 [`.atw/tasks/10-26-merge-upstream-v0.13.0/screenshots/`](https://github.com/LFT-OXY/Osuna/tree/merge-upstream-paseo-updates/.atw/tasks/10-26-merge-upstream-v0.13.0/screenshots)，在这个分支上可以直接看。

- 工单 13 的 `13-*`：21 组、中英各一、共 42 张，全部 dev 桌面端（Electron）1280 宽实拍。对照表与验收点逐条结果在工单 13。
  - 「添加提供方」：`13-add-provider-dialog-{list,search-co,search-ho,add-failed}-*`
  - Hoplite 详情页：`13-provider-hoplite-detail-*`、`13-provider-hoplite-detail-menu-remove-*`
  - 设置 → 文件：`13-settings-files-*`
  - 侧栏：`13-sidebar-display-menu-{background-switch,sort-page}-*`、`13-sidebar-project-show-more-*`
  - 新建工作区：`13-new-workspace-host-menu-add-host-*`
  - Changes：`13-changes-all-changes-generated-collapsed-{top,bottom}-*`
  - Explorer：`13-explorer-tabs-session-history-*`、`13-explorer-launcher-open-*`
  - 聊天：`13-chat-codeblock-table-*`
  - Markdown 文件：`13-markdown-file-preview-relative-image-*`、`13-markdown-file-source-*`
  - 逻辑图：`13-logic-map-node-line-opens-source-*`
  - Claude 计划审批：`13-claude-plan-card-implement-with-auto-*`（mock 提供方的卡片，与 Claude 走同一个 `PermissionRequestCard`）
  - 终端：`13-terminal-after-image-paste-*`
- 套餐用量没有在 Electron 里拍：真实账号会把套餐数据截进公开仓库。证据是工单 08 的 `08-plan-usage-modal-{used,remaining,options}-1280-zh.png`、`08-usage-page-plan-card-1280-zh.png`（无头 Chromium + 夹具，只有中文）。
- 各工单的验收图：`03-*`（2）、`05-*`（2）、`07-*`（2）、`09-*`（2）、`11-*`（2，含文件分区有行的状态）、`chat-codeblock-table_reply_1280.png`。

截图验收点（`prd.md`「UI and Design」）：除「中文下新界面没有残留英文」不完全满足外都满足。残留的是其余确认框的「Cancel」、daemon 下发的计划审批按钮名与报错原文、相对时间，见上节与工单 13。

### 本机 macOS 包

按 `docs/release.md`「本地出一个 macOS 包」打 arm64 包（`CSC_IDENTITY_AUTO_DISCOVERY=false npm run build:desktop -- --publish never --mac --arm64`，ad-hoc 签名，只用于试装）。

```console
$ ls packages/desktop/release/mac-arm64/Osuna.app/Contents/Resources/builtin-plugins
antigravity-provider  claude-usage-source  codex-usage-source  copilot-usage-source
cursor-usage-source   grok-usage-source    hoplite-provider    kimi-usage-source
minimax-usage-source  muse-provider        opencode-go-usage-source  zai-usage-source
package.json  tsconfig.json
```

12 个插件目录与仓库 `plugins/` 一一对应，都在 asar 之外，每个都有 `paseo-plugin.json`、`index.server.ts` 与 `server/`。
打开核对（2026-10-27，按「本地出一个 macOS 包」用独立的 `PASEO_HOME`、端口 6783 与 userData 启动，关掉中继、MCP 与语音，维护者同意读 CLI 登录）：

- `daemon.log` 里 12 行 `Loaded plugin`，`pluginId` 与上面 12 个目录一一对应。
- 设置 → Providers →「添加提供方」搜 `hoplite` 出现 Hoplite 行：`14-packaged-add-provider-search-hoplite-1200-zh.png`。
- 侧栏套餐用量弹窗里 Claude、Cursor、Codex 都有用量数据。截图含账号信息，不进仓库。
- 看完退出，测试 daemon 随之停止，6767 上的正式版仍在监听，临时目录已删。

### CI

<!-- CI 待填 -->

### 平台

| Platform | Tested | Notes |
| --- | --- | --- |
| iOS | 否 | 免验收：没有原生测试环境。手机全屏写消息、可折叠屏布局、手机 Explorer 只跑了 typecheck 与相关单元测试 |
| Android | 否 | 免验收：没有原生测试环境 |
| Web | CI | Playwright 八个分片；工单 02、08 的无头 Chromium 截图 |
| Desktop macOS | 是 | dev 桌面端每段冒烟，工单 13 实拍 42 张；本机包核对见上 |
| Desktop Windows | CI | Windows 安装包与虚拟机里的安装验收由维护者自己做 |
| Desktop Linux | CI | Osuna 不发 Linux 包 |

版本错位：

- 旧 App 连合并后的 daemon：协议新增的都是可选字段与新 RPC，照常工作；例外是经中继连接设了密码的主机，旧 App 没保存密码会被拒（见上面的更新日志草稿）。
- 合并后的 App 连旧 daemon：新功能按 `server_info.features.*` 门控（如 `checkoutDiffAll` 不支持时 Changes 给升级提示，`hopliteProvider` 不支持时「添加提供方」给行内错误）。

## Merge Danger

**Door:** two-way

以 merge commit 并入，不 squash、不 rebase。出问题时 revert 这个 merge commit；revert 之后要再合同一段上游历史，得先 revert 那个 revert。

**Blast Radius:** 全应用

- 七段 328 个上游提交，daemon、应用、CLI、协议、中继与桌面打包都动了；依赖升到 Expo 57、React 19.2.3、React Native 0.86.3。
- 中继强制密码是对已配对设备的行为变化：设了密码、经中继添加且没有保存密码的主机升级后连不上，要重新添加。
- Expo 57 下从 `@react-navigation/native` 取导航钩子会在 Web 上崩，已加 lint 规则拦住；新写的页面照 `expo-router/react-navigation` 取。
- Changes 默认 All changes，大改动集的按文件复用在新模式下由新用例守着。
- 结束订阅写 `$PASEO_HOME/finish-subscriptions.json`，与 `agents/`、`config.json` 同目录，不需要迁移（工单 10）。
- 这次改到的上游文件（`settings-screen.tsx` 整份取 Osuna、`workspace-desktop-tabs-row.tsx`、`autocomplete-popover.tsx`、`usage/` 文案、`.oxlintrc.json` 的豁免块等）下次合并上游时会多几处冲突。
- 这个 PR 不发版：版本号与 `CHANGELOG.md` 没有变。并入后要手动删 worktree。
