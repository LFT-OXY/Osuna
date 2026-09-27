# 访谈决策记录（2026-09-27）

来源：/atw-askme-with-docs 访谈，全部为用户明确回答。执行顺序：09-27-pi-hidden-context → 09-27-composer-branch-switch → 本任务。决策 1、3 已写入 `docs/adr/0001-markdown-file-preview-dom-renderer-with-lezer.md`。

## 事实（调研所得）

### Osuna 现状
- 预览链路：`file-pane/pane.tsx:177-188` → `file-pane/markdown-preview/index.tsx`（front matter）→ `components/markdown/renderer.tsx` `MarkdownRenderer`（`react-native-markdown-display@7` + `markdown-it@10`，`utils/markdown-parser.ts` 中 `html: false`）。预览只传 `source`，无文件路径 / cwd / client / onLinkPress。
- 原始 HTML 由 `components/markdown/html-ish.ts` 改写：`<p align>` 因切段失配原样输出（`:319-323`、`:472-477`）；每个 `<a><img>` 单独成块纵向堆叠（`:108-117`，`renderer.tsx:275-283`）；`align` 从不读取；`<img>` 仅放行 http(s)/data（`:30`）；markdown 图片相对路径被拼成 `https://…`（库默认 `defaultImageHandler`）。
- 无 GitHub alerts 实现；相对 .md 链接走 `openExternalUrl`。
- 对话消息共用 `MarkdownRenderer` 底层，但自带 rules / parser（`message.tsx:1252-1270`、`utils/assistant-markdown-parser.ts`），且已有相对图片链路：`utils/assistant-image-source.ts` → `assistant-image/file-acquisition.ts`（`daemon-client.readFile`）→ `use-assistant-image.ts` / `attachments/use-attachment-preview-url.ts`。
- 同一渲染器还被 PR 面板、changelog、plan-card 使用。预览链路无 `.web/.native` 分支；DOM 先例：`file-pane/html-preview.web.tsx`、mermaid `host.web.tsx`。
- 高亮：`packages/highlight`（Lezer + CodeMirror，`parsers.ts:29-88`），缺 bash/sh/zsh/console、toml、sql、diff、dockerfile、ini 等；swift/dart 已通过 `@codemirror/legacy-modes` 接入。代码块组件 `components/highlighted-code-block.tsx`（别名表 `:44-57`），头部只有语言文字 + 复制。高亮包还被 CodeMirror 编辑器 / 源码视图、服务端 `diff-highlighter.ts`、语法主题设置（`highlight/src/themes.ts`，`styles/syntax-token-styles.ts`）使用。
- 文件图标：`components/material-file-icons.ts` + `file-icon-svg.ts`（见 `docs/file-icons.md`）。
- 受影响测试：`html-ish.test.ts`、`renderer.test.ts`、`part-groups.test.ts`（仅在改动共享路径时）。

### t3code 参考（`/Users/oxy/Documents/Configuration/dev-environment/demo/源码/t3code`，MIT）
- `apps/web/src/components/ChatMarkdown.tsx`：remark `remarkGfm → remarkGithubAlerts → … → remarkPreserveCodeMeta → remarkNormalizeLinksAndTagInlineCode`；rehype `rehypeRaw → rehypePreserveImageSourceMeta → rehypeSanitize(CHAT_MARKDOWN_SANITIZE_SCHEMA :468-489)`。
- alerts：`apps/web/src/markdown-github-alerts.ts`；渲染 `ChatMarkdown.tsx:2808-2824`，配置 `GITHUB_ALERT_PRESENTATIONS :517-551`（标题硬编码英文）。
- 代码块：`MarkdownCodeBlock :937-1080`（语言图标、wrap、copy、shell 的 Run in terminal）。
- 链接 / 图片：`FileMarkdownPreview.tsx`（imageBaseDir）、`markdown-links.ts`、`packages/client-runtime/src/markdownImages.ts`、`MarkdownFileLink` chip。
- 样式：`apps/web/src/index.css` `.chat-markdown`（约 1386-1920 行；`img { display: inline-block }` 使徽章横排）。

## 已定

| # | 决策 | 结论 |
|---|---|---|
| 1 | 路线 | 新增 `markdown-preview/index.web.tsx` DOM 渲染，移植 t3code 插件链（gfm、GitHub alerts、rehype-raw、rehype-sanitize），保留 MIT 声明；原生端保留现有 RN 渲染器 |
| 2 | 范围 | 只替换文件预览；对话、PR 评论、changelog、plan-card 不动 |
| 3 | 高亮 | **不用 Shiki**：给 `packages/highlight` 补 bash/shell/zsh、toml、sql、diff、dockerfile、ini（legacy-modes），DOM 版把 token 输出为带主题色的 `<span>`，跟随用户语法主题；对话代码块、源码视图顺带受益 |
| 4 | 全局换 Shiki | 不做（用户认为太麻烦） |
| 5 | 相对资源 | 完全按 t3code：相对图片（markdown 与 `<img>`）经现有 `readFile` 链路显示；仓库内文件链接渲染为带图标 chip，点击在新文件标签打开；页内锚点跳转；外部链接用浏览器打开 |
| 6 | alerts 标题 | 走 i18n（NOTE/TIP/IMPORTANT/WARNING/CAUTION → 注意/提示/重要/警告/小心） |
| 7 | 图标 | 语言图标与文件 chip 用项目自带 Material 图标，不引入 `@pierre/trees` |
| 8 | 代码块头部 | 语言图标 + 换行开关 + 复制；不要 Run in terminal |
| 9 | 样式 | 版式照搬 t3code `.chat-markdown`，颜色 / 字体用项目主题 token，支持深浅色；HTML 白名单沿用 t3code schema |
| 10 | 平台 | 以桌面 / Web 为准，原生不退化 |
| 11 | 验收 | 桌面端打开本仓库 `README.zh-CN.md` 对照 t3code 截图：居中、徽章横排、`[!NOTE]` callout、截图显示、bash 代码块着色 |

discover 阶段无未决问题。
