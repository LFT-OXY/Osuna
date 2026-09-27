# 02 — Web 端 DOM 预览主链路（原始 HTML、GFM、版式、消毒）

**What to build:** 在桌面 / Web 端打开 README 风格的 Markdown 文件，预览不再把 HTML 当文字：`<p align="center">` / `<h1 align="center">` 居中，一排徽章横着排、放不下自动换行，`<a>` 包着的徽章可点击；GFM 表格、任务列表、删除线正常；front matter 表格仍在正文上方；mermaid 图表照常渲染；文字可选中、长行自动换行不出横向滚动；`<script>`、事件属性、`javascript:` 链接、`iframe`、`style` 被剥掉且不执行。iOS / Android 预览保持现状。代码块本票先以等宽纯文本显示。

**Blocked by:** None — can start immediately
**Status:** ready-for-agent
**Impl:** ready

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

- [ ] `e2e/browser/file-editing.spec.ts` 新增 README 风格 fixture 用例（本票部分）：原始 HTML 不以文字出现；居中容器计算样式为居中；多个徽章图片纵坐标相同；`<script>` 未执行、事件属性被剥离、`javascript:` 链接不可用。
- [ ] 现有「Markdown 预览刷新」「长行换行」用例保持不变并通过；预览 / 源代码切换与磁盘变更刷新照常。
- [ ] GFM 表格、任务列表、删除线渲染正确；front matter 表格保留；mermaid 图表渲染。
- [ ] 深浅色切换时正文、表格、引用颜色正确。
- [ ] 现有 RN 渲染器相关测试（html-ish、renderer 等）不改断言、继续通过；原生端预览代码路径未改。
- [ ] 移植文件保留 t3code MIT 声明。
- [ ] app 包 typecheck、lint 通过。
