# 06 — 仓库内链接 chip、页内锚点与外链

**What to build:** 预览里指向仓库内其他文件的链接显示为带文件图标的 chip，点击在新的文件标签打开目标文件（带 `#L12` 之类行号时定位到该行）；点击 `#section` 这类页内锚点滚动到对应标题；外链仍用浏览器打开。

**Blocked by:** 05
**Status:** ready-for-agent
**Impl:** done

## 范围

- 在 05 的资源解析纯函数上补齐链接分类：仓库内文件（相对 / 绝对，可带行号）、页内锚点、外链、越出工作区的路径。
- 仓库内文件链接渲染为带 Material 文件图标的 chip，点击在新文件标签打开；带行号时沿用现有 assistant 文件链接的定位能力。
- 标题生成 GitHub 风格的 slug id；`#anchor` 在预览滚动容器内滚动到对应标题。
- 其余链接走现有的外链打开方式。

## 验收

- [x] 纯函数单测补充：锚点、带行号链接、越出工作区链接各自分类正确。
- [x] README 风格 e2e 用例补充断言：点击仓库内 `.md` 链接 chip 打开对应文件标签；点击锚点后目标标题滚动进可视区。
- [x] 外链点击仍用浏览器打开，不在应用内导航。
- [x] app 包 typecheck、lint 通过。

## Comments

- 来自 02：`defaultSchema` 会给 `id` / `name` 加 `user-content-` 前缀（clobber），页内锚点 `#foo` 需要去掉前缀后再匹配，或自行生成标题 slug id。`MarkdownLink` 目前对所有点击 `preventDefault`，只把 `^https?://` 交给 `openExternalUrl`，相对链接与锚点暂时点击无反应。`mailto:` 同样无反应，本票如要支持，需要同时改 app 与桌面端 opener 的协议白名单。
- 来自 05：分类函数是 `file-pane/markdown-preview/resource.ts` 的 `resolveMarkdownResource`，它读取的上下文来自 `MarkdownPreviewResourcesContext`（`resources-context.web.ts`，由 `DomMarkdown` 提供）。目前它会先截掉 `?` / `#` 后缀，并把 `#…` 直接判为 `unsupported`。补锚点与 `#L12` 时，需要保留 fragment 并新增分类。现有的 `external` 只认 http(s) 与 `data:image/`，链接要支持 `mailto:` 时也得在这里处理。`MarkdownImage` 把非 `external` / `workspace_file` 的结果一律显示为占位，新增分类不会影响图片。
- 实现：`resolveMarkdownResource` 新增 `anchor` 分类（`#…` 解码后的 id，裸 `#` 仍是 `unsupported`）；`workspace_file` 改为 `{ kind } & WorkspaceFileLocation`，GitHub 行号片段（`#L12`、`#L12-L20`，复用 `@/assistant-file-links` 导出的 `parseLineFragment`）落到 `lineStart` / `lineEnd`，其他片段丢弃。链接组件在 `link.web.tsx` 的 `MarkdownLink`；`MarkdownPreviewResources` 增加 `openWorkspaceFile`，由 `FilePanel` 把 pane context 的 `openFileInWorkspace` 传给 `FilePane`。约定写入 `.atw/spec/app/frontend/styling.md` DOM markdown 段的「Links」。
- 标题 slug：新增依赖 `rehype-slug@^6`（与 website 包同版本，lockfile 只多一行），放在 rehype-raw 之后、sanitize 之前，所以 id 形如 `user-content-<slug>`。点击 `#foo` 时依次匹配 `user-content-foo`、`foo` 及其小写形式，`name` 属性也算，脚注链接因此也能跳转。只改预览滚动容器的 `scrollTop`，不改 URL hash。
- 坑：RN Web 的 ScrollView 在 DOM 节点上换掉了 `scrollTo`，`scrollTo({ top })` 静默无效，只能赋值 `scrollTop`。`scrollIntoView` 会连带滚动外层 overflow 容器，也没用。
- 自行做的取舍（spec 未逐条规定）：
  - chip 保留作者写的链接文字，前面加 Material 文件图标（t3code 是用文件名替换文字）。
  - 包着图片的仓库内链接不画成 chip，只接管点击。
  - 打开方式用 `disposition: "main"`，在当前 pane 新建或显现文件标签，不遵循「在侧边 pane 打开」偏好。
- 留给后续：
  - `mailto:` 仍是点了没反应，要支持需同时改 app 与桌面端 opener 的协议白名单。
  - `other.md#section` 只打开文件，不定位到小节。
  - 越出工作区的链接点了没反应。
  - 链接到目录（`packages/app`）也会渲染成 chip，打开后文件标签显示读取失败，与 t3code 行为一致。
- 审查：Standards 维度提的 `useCallback` 无 memo 受益者一条与 oxlint `react-perf/jsx-no-new-function-as-prop` 冲突，以 lint 为准保留；其余已改（类型复用 `WorkspaceFileLocation`、经 `assistant-file-links` 入口导入、去掉重复的 http 正则与取文件名逻辑、改名）。
- 验证：`resource.test.ts` 15 个用例通过；file-editing e2e 全文件 20 个用例本地通过，审查修改后又重跑了 README 与刷新两个用例；app 单测 632 个文件全绿；app typecheck 与改动文件的 lint 都通过。
