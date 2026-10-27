# 05 — 准备：删除 DOM 文件预览，逻辑图改走源码视图

**What to build:** 在合第五段之前单独提交：按 ADR 0016 删掉 Osuna 在 Web 上的 DOM Markdown 文件预览，Web 与 Electron 改用当前的共享渲染器；逻辑图带行号的节点在所有平台都打开源码视图并定位到那一行。这样第五段上游把 `file-pane` 改名 `file-panels` 时，这 13 个文件不再随改名冲突。规格见 `prd.md`「Markdown」，决定见 `research/discovery.md` 第 15、16 条与 ADR 0016。

**Blocked by:** 04
**Status:** ready-for-agent
**Impl:** done

- [x] Osuna 的 DOM 预览（Web 专用的渲染、样式、提示框、代码块、图片、链接、资源刷新、行号定位）与 prd「Markdown」列出的随之删除的测试已删除，同目录的上游文件还原成上游；删除的文件与用例清单记在 `## Comments` 下，供 PR 正文写明「Osuna 原有的测试不删除」的例外。
- [x] 只为 DOM 预览引入的依赖若别处不再使用，从 `package.json` 移除，`package-lock.json` 重新生成。
- [x] 逻辑图带行号的节点打开源码视图并定位到那一行，有测试；决定预览还是源码的逻辑里「预览可定位」只剩 false 一种。
- [ ] `.atw/spec/app/frontend/styling.md` 里讲 DOM 预览的那一节已改写或删除。
- [x] typecheck 和 lint 通过；改到的测试文件逐个单独跑过并通过（不跑整套）。
- [x] 除 prd「Markdown」列出的例外外，没有 Osuna 的断言被删除或放宽；必须跟着改的断言逐条记在 `## Comments` 下，供 14 写 PR 正文用。
- [x] UI：dev 桌面端 1280 宽 / 逻辑图点一个带行号的节点 — 截图上打开的是源码视图，停在那一行。

## Comments

### 删除的文件（「Osuna 原有的测试不删除」的例外，PR 正文要列）
`packages/app/src/file-pane/markdown-preview/` 下 13 个：`index.web.tsx`、`dom-markdown.web.tsx`、`styles.web.ts`、`github-alerts.ts`、`code-block.web.tsx`、`image.web.tsx`、`link.web.tsx`、`resource.ts`、`resources-context.web.ts`、`pipeline.ts`、`source-line.web.ts`，测试 `resource.test.ts`、`source-line.browser.test.tsx`。

同目录的 `index.tsx`、`document.ts`、`document.test.ts` 是上游文件，没有删，还原成上游 v0.12.0（`cafe4b01c`）原样（维护者 2026-10-26 同意）。`pane.tsx`、`panels/file-panel.tsx` 同样回到上游，`pane.tsx` 相对上游只差两处：import 多引一个 `filePreviewRenderKindForLocation`，`FilePreviewBody` 里算 `renderKind` 时改调它（评审后把 `isRenderablePreview`、`canTogglePreviewMode` 也还原成上游写法）。

第 5 段提醒：上游会删 `components/file-pane-render-mode.ts`，届时按 prd「逻辑图」与 `research/feature-overlap.md` 把 `filePreviewRenderKindForLocation` 和它的四个用例挪进 `file-panels` 里做同一决定的地方，不删用例。

### 随之删掉的 Osuna 断言（PR 正文要列）
- `document.test.ts`：5 个用例里各一行 `bodyStartLine`（正文起始行号，只给 DOM 预览滚到指定行用）。上游原有断言全部保留。
- `e2e/browser/file-editing.spec.ts`：整条删除 3 个只测 DOM 预览的用例（维护者 2026-10-26 同意），连同只给它们用的常量与辅助函数（`README_*`、`CENTERED`、`readSetWindowFlags`、`readBorderLeftColors`、`readNaturalWidth`、`readInnerHtml`、`readPlainClipboard`、`breakClipboardWrites`、`expectDiagramWithLabels` 的导入）：
  - "renders a README-style Markdown file as sanitized HTML with GFM"（徽章行居中、`<script>`/`onerror`/`style`/`javascript:` 被剥、`[!NOTE]` 提示框、表格与任务列表、mermaid、代码块语言标签/图标/着色/换行/复制与复制失败提示、相对图片与改盘刷新、缺图占位、页内锚点、仓库文件链接 chip 与行号定位）
  - "repaints Markdown prose, quotes, tables, and code when the color scheme changes"
  - "renders the five GitHub alerts with localized titles and distinct colors"
  该文件相对上游只剩 Osuna 原有的两处（光标颜色、提示框字体）。

### 跟着改预期的 Osuna 断言（PR 正文要列）
`components/file-pane-render-mode.test.ts` 的 `filePreviewRenderKindForLocation` 四个用例保留，函数去掉「预览能否滚到行」参数：
- "renders a Markdown line target marked for the preview, such as a node doc" 改名 "shows a Markdown line target marked for the preview, such as a node doc, in the source view"，预期 `"markdown"` → `null`。
- "falls back to source where the preview cannot scroll to a line" 原本的两条断言：Markdown 那条与上一条重复，并进上一条；HTML 那条拆成 "shows an HTML line target marked for the preview in the source view"，预期不变（`null`）。
- 另两个用例预期不变。

### 随之删除的翻译与依赖
- 九种语言的 `panels.file.markdownCodeBlock`（1 键）与 `panels.file.markdownAlerts`（5 键），只有 DOM 预览用。
- `packages/app/package.json` 去掉 `react-markdown`、`rehype-raw`、`rehype-sanitize`、`rehype-slug`、`remark-gfm`；`package-lock.json` 用 `npm install --package-lock-only` 重新生成，只少了 `rehype-raw`、`rehype-sanitize`、`hast-util-raw`、`hast-util-sanitize`、`hast-util-to-parse5`（其余三个包 website 还在用）。`@types/react-dom` 别的测试在用，保留。
- `components/highlighted-code-block.tsx` 的 `fenceLanguageToExtension` 取消导出（只有 DOM 预览从外面引用）。

### 验收截图（dev 桌面端 1280 宽，演示仓库 `/tmp/osuna-t05-demo`）
- `screenshots/05-logic-map-node-line-opens-source-electron-1280.png`：点逻辑图节点「Start session」（标题在 `spec/login.md` 第 50 行，首屏之外），打开源码视图，可见行从 23 起，状态栏 `Ln 50, Col 1`。
- `screenshots/05-markdown-file-shared-preview-electron-1280.png`：从文件树新开同一文件，走共享渲染器的预览，带「预览 / 源代码」切换，从文档顶部开始。
- 带行号打开时不显示「预览 / 源代码」切换，是上游原有行为（`canTogglePreviewMode = isRenderable && !location.lineStart`），本工单不改。
