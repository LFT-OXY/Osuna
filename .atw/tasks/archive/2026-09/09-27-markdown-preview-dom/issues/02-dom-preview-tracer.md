# 02 — Web 端 DOM 预览主链路（原始 HTML、GFM、版式、消毒）

**What to build:** 在桌面 / Web 端打开 README 风格的 Markdown 文件，预览不再把 HTML 当文字：`<p align="center">` / `<h1 align="center">` 居中，一排徽章横着排、放不下自动换行，`<a>` 包着的徽章可点击；GFM 表格、任务列表、删除线正常；front matter 表格仍在正文上方；mermaid 图表照常渲染；文字可选中、长行自动换行不出横向滚动；`<script>`、事件属性、`javascript:` 链接、`iframe`、`style` 被剥掉且不执行。iOS / Android 预览保持现状。代码块本票先以等宽纯文本显示。

**Blocked by:** None — can start immediately
**Status:** ready-for-agent
**Impl:** done

## 范围

- Markdown 文件预览按项目已有的 `.web.tsx` / 默认文件约定拆分（先例：HTML 预览、mermaid host）：Web 版为新的 DOM 组件，默认文件保留现有 RN 渲染路径不变。
- DOM 管线移植自 t3code：react-markdown，remark 侧 GFM（及服务于代码块元信息的必要插件），rehype 侧 rehype-raw 解析原始 HTML，最后 rehype-sanitize 按白名单消毒。白名单基于默认 schema，保留 `align` 等排版属性，禁止脚本、事件属性、`style`、`iframe`，链接协议限于 http(s) / mailto / 相对路径 / 页内锚点；不带 t3code 特有协议与 codex directives。
- 新依赖 react-markdown、remark-gfm、rehype-raw、rehype-sanitize 只进 app 包。
- front matter 解析两端共用、行为不变；DOM 版以 DOM 元素重建同样外观的表格。
- mermaid fence 交给现有 web mermaid 渲染。
- 版式照搬 t3code 的 markdown 样式（间距、标题层级、列表、表格、引用、行内代码、代码块、分隔线、`img` 行内排列），颜色 / 字体 / 圆角全部换成项目主题 token，深浅色与主题切换正确；阅读宽度与留白沿用现有预览。
- 移植的源文件头部保留 t3code MIT 版权与许可声明。
- 对话、PR 评论、changelog、plan 卡片及 html-ish 改写层不动。

## 验收

- [x] `e2e/browser/file-editing.spec.ts` 新增 README 风格 fixture 用例（本票部分）：原始 HTML 不以文字出现；居中容器计算样式为居中；多个徽章图片纵坐标相同；`<script>` 未执行、事件属性被剥离、`javascript:` 链接不可用。
- [x] 现有「Markdown 预览刷新」「长行换行」用例保持不变并通过；预览 / 源代码切换与磁盘变更刷新照常。
- [x] GFM 表格、任务列表、删除线渲染正确；front matter 表格保留；mermaid 图表渲染。
- [x] 深浅色切换时正文、表格、引用颜色正确。
- [x] 现有 RN 渲染器相关测试（html-ish、renderer 等）不改断言、继续通过；原生端预览代码路径未改。
- [x] 移植文件保留 t3code MIT 声明。
- [x] app 包 typecheck、lint 通过。

## Comments

- 实现：`file-pane/markdown-preview/index.web.tsx`（外框、front matter、主题变量根节点）、`dom-markdown.web.tsx`（react-markdown 管线与 `pre` / `code` / `a` / `table` 覆盖）、`styles.web.ts`（移植的版式，只引用 `--md-*` 变量）。约定写入 `.atw/spec/app/frontend/styling.md`「Web-only styling」的 DOM markdown 段。
- 白名单即 `defaultSchema`，只把 `href` 协议收窄到 http / https / mailto。`mailto:` 能通过消毒，但点击无反应：两端 opener 都只放行 http(s)，与原 RN 预览一致。
- 未加「代码块元信息」插件：本票没有读取方，交给 04 连同头部一起加。
- 与 t3code 的偏差：表格去掉 `min-width: max-content`（t3code 拿它配合单元格截断，这里没有移植截断），改为按词换行、放不下再横向滚动；`th` / `td` 只在无 `align` 时左对齐，保证 GFM 列对齐生效；另补了浏览器默认样式的归零（`blockquote` 外边距、`hr`、`dl` / `details` / `figure` 外边距、`img` 的 `max-width`）。
- 间距按本票「版式照搬 t3code」保留 t3code 的 rem 值，没有换成 `theme.spacing` 刻度。它与 `docs/design.md` §14「刻度外间距」相冲突，已提给用户决定。h4–h6 用 t3code 的 14px（`body` 档），与 RN `markdown-styles.ts` 的 h4 `body-lg` 不同。
- 深浅色 e2e 用例在切换时整个面板会被重新挂载，所以它验证的是「颜色取自 token」，并不单独验证 `withUnistyles` 的响应式。
- 验证：README 用例、深浅色用例、原有「Markdown 预览刷新」「长行换行」用例本地通过；app 单测全绿（631 个文件）；app typecheck 与 lint 通过；桌面端尺寸下截图对照过 `README.zh-CN.md` 的深浅两色。
