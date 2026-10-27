# 02 — 第一段适配：聊天 Markdown 与 Composer

**What to build:** 聊天消息用上游的新渲染器显示，Osuna 的样式（代码块语言标签头、复制按钮、语法主题着色）迁到上游新的样式位置；在电脑上看，聊天里的代码块与合并前一样。收下上游的全屏写消息（手机端与窄窗口的 Web / Electron）；输入仍是 Tiptap，测高模块不恢复。规格见 `prd.md`「Markdown」「Composer」，决定见 `research/discovery.md` 第 7 条。

**Blocked by:** 01
**Status:** ready-for-agent
**Impl:** done

- [x] Web 上聊天的代码块有语言标签头与复制按钮，按当前语法主题上色；高亮代码块组件的现有测试通过。
- [x] 上游新渲染器的跨段选择、表格横滑、代码块复制照收；上游渲染器的测试通过。
- [x] 手机端代码块失去语言标签头，接受，记在 `## Comments` 下供 PR 正文用。
- [x] 测高模块两端都不恢复；Web / Electron 紧凑宽度下草稿超过两行出全屏按钮（维护者 2026-10-26 决定，见 `## Comments`），上游全屏 e2e 在本机通过（只在 mac 上挂的快捷键与按钮焦点两条交 CI）；原生端 typecheck 与 Composer 相关单元测试通过。手机端免验收。
- [x] 上游新用例里按 textarea 读 Composer 的，改成读 contenteditable 的文字；Web 端 Tiptap 的浏览器测试通过。
- [x] typecheck 和 lint 通过；改到的测试文件逐个单独跑过并通过（不跑整套）。
- [x] 没有 Osuna 的断言被删除或放宽；必须跟着改的断言逐条记在 `## Comments` 下，供 14 写 PR 正文用。
- [x] UI：dev 桌面端 1280 宽 / 聊天里一条带代码块与表格的回复 — 截图上代码块有语言名与复制按钮、代码着色，表格完整显示。

## Comments

### 问过维护者的（2026-10-26）
- 上游带来约 20 条在浏览器手机宽度下测全屏写消息的 e2e。照 prd「Web 端不引入」它们在 CI 必挂、只能删。维护者选「网页窄窗口也给全屏」：Web / Electron 窗口窄到紧凑宽度、草稿超过两行时也给全屏按钮，上游这些用例保留并改成读 contenteditable。prd「Composer」与本工单验收随后改写。

### 聊天 Markdown
- Osuna 样式迁到 `components/markdown/styles.ts`：正文内容字号的 prose 档、86% 色调（foregroundProse）、标题走 Text 档位与 semibold、compact 只降标题档与收段距（字号不变，与上游 compact 用 base 字号不同）、代码块 surface2 + borderCodeBlock + radius.lg、引用块 surface1 底与 surface2 竖线、表格 radius.md 与 spacing[2] 单元格内边距、分割线上下 10。
- Web 代码块仍走 HighlightedCodeBlock，外框取值放在 `createCodeBlockFrameStyle`（语言标签头、复制按钮、语法主题着色保留）。
- 手机端代码块失去语言标签头：新引擎原生端自己画代码块，接受（prd「Markdown」）。
- 新引擎表达不了、因此没有迁的旧断言（`3fc36c0a8:packages/app/src/styles/markdown-styles.test.ts`）：shrink-and-wrap 一整条（flexShrink / minWidth / overflowWrap 是旧库的 RN 样式，新引擎在 Web 是 HTML 排版，长串换行由引擎负责）；Web 可选中一整条（userSelect 不在样式里，由渲染器容器 `WEB_CONTAINER` 统一给）；行内代码的 radius.sm 与 paddingHorizontal（新引擎 `code` 样式没有圆角、内边距字段，borderWidth 0 由 borderColor transparent 表达）；引用块的分边内边距（paddingTop 3 / paddingBottom 0）与右侧圆角（新引擎只有统一 padding 与单个 borderRadius；改为 padding spacing[3]、borderRadius 0 保住「左侧直角」；末尾段落的下边距由引擎的 last-child 规则清零，视觉上底部仍是 12）；原生端代码块的 paddingTop spacing[1]（只为给标签头让位，原生端没有标签头，改为统一 spacing[3]）。
- 已迁的断言（`renderer.test.ts`「Osuna Markdown typography」）：prose 字号行高与 86% 色调、标题档位与颜色字重、标题无下划线无大写变换、compact 降档、行内与块代码等宽字体与 code 字号、内容字号缩放、代码块外框、引用块。
- 按 Osuna 决定改的上游断言：`renderer.test.ts`「uses %s theme colours for tables and task labels」里 `list.color` 从 foreground 改为 foregroundProse（列表属于正文，Osuna 正文 86% 色调）。

### Composer 与手机全屏
- 测高模块两端都没恢复：上游 `height.native.ts` 只返回 `{ minHeight, maxHeight }`，Osuna 的 input.tsx 早已内联同样的值，全屏编辑不用它别的东西。Web 的行数改由 `composer/input/rendered-lines.web.ts` 量 Tiptap 段落（文档固定单段落，换行是 hardBreak，粘贴多段也只会是一个 `<p>`），原生端沿用上游的隐藏 Text + onTextLayout。
- 移植自上游 #6531 及后续：全屏进出与发送 / 排队 / 听写 / 实时语音前退出全屏、全屏时总显示「发送」、输入框紧凑宽度右侧 36 的全屏按钮预留带、断点重挂载时保留光标与聚焦意图、鼠标驱动才恢复焦点（isPaneFocused）、`composer/index.tsx` 传 editingSession 与 submissionError。
- Osuna 侧为全屏做的适配：`ComposerSurfaceStack`（输入框 + 上下文条）全屏时撑满并隐藏上下文条；Tiptap 根节点的内边距（全屏按钮预留带）点下去聚焦编辑器，与 textarea 一致。
- 新增用例：`state.test.ts`「leaves fullscreen only when something is queued」；`text-input.web.browser.test.tsx`「keeps its editing handle and selection across a rerender during composition」（上游 textarea 写法按 contenteditable 改写）。

### 按 Osuna 结构改的上游 e2e（供 14 写 PR 正文）
- `composer-whitespace`、`new-workspace-composer-draft`、`new-workspace-dictation-submit`、`new-workspace-launch-terminal`：29 处 `toHaveValue(X)` 换成 `expectComposerText(同一 locator, X)`，期望值不变。
- `composer-whitespace` 两条高度上限（≤160）量 `[data-composer-input]` 外框：Tiptap 可编辑区随内容长高，滚动与上限在外框上。
- `support/helpers/composer.ts`：`selectComposerDraftRange` / `expectComposerDraftSelection` 用 Tiptap 选区（文字偏移 t ↔ 编辑器位置 t+1）；`recordVisibleComposerGeometry` 量外框。
- `composer-email-mentions`：选中文件后草稿从上游的 `"README.md"` 改为 Osuna 行内块（编辑器显示 `README.md ` 且只有一个块）；全屏里光标位置改用 `readComposerInput` 读。
- `composer-focus`「focusing the feed preserves … code copy controls」：复制按钮按名字 `Copy code` 找（Osuna 代码块头部也带 ignore 标记，原定位会匹配两个元素）。

### 本机跑测试的结果
- 单元：`renderer.test.ts`、`state.test.ts` 共 149 条；composer 目录 29 个单元测试文件逐个通过；浏览器：`text-input.web.browser.test.tsx` 38 条、`assistant-selection-copy/content.browser.test.ts`、`thinking-slider`、`tracks-panel` 通过（先挪走旧的 Vite 预构建缓存）。
- e2e（本机 browser 项目）：`composer-whitespace` 13/13；`composer-email-mentions`、`composer-focus`、`new-workspace-composer-draft`、`new-workspace-launch-terminal` 通过，除下面两条。
- Osuna 原有用例回归（本机 browser 项目）：composer-agent-mentions、composer-attachments、composer-autocomplete、composer-inline-blocks、composer-plan-usage-strip、composer-control-density、new-workspace-launch-composer、assistant-selection-copy 共 51 通过、1 条原本就标了 skip。
- 只在本机挂、交给 CI：`new-workspace-dictation-submit`「dictation shortcut leaves retained fullscreen…」按 Control+d，mac 的绑定是 Cmd+D；`composer-focus`「…code copy controls」断言点复制后焦点离开聊天区，mac 版 Chromium 点按钮不给按钮焦点（事件记录：无 focusin、mousedown 未被阻止）。
- 截图：`screenshots/chat-codeblock-table_reply_1280.png`（无头 Chromium 1280×800，与 Electron 同一份 Web 代码，回复由 e2e 的模拟 Agent 给出）。

### 评审
- Standards：底线守卫 29 行全是 `toHaveValue` → `expectComposerText` 等值替换，工单允许；判断项：原生测行留在 input.tsx 的运行时分支里（保持上游写法以减少以后合并冲突，未改）、input.tsx 新增英文注释照搬上游（同上）、全屏预留 36 未具名（上游原值，未改）；已改：renderers.web.tsx 多余的转发函数、`exitFullscreen` 改为必填。
- Spec：已补迁可表达的旧断言（标题无下划线 / 大写变换、代码等宽字体），不可表达的逐条记在上面；本节 Comments 已写。
- Visual：三项验收满足；语言名与注释偏淡、复制图标不显眼是 Osuna 现有配色，本工单未改。
