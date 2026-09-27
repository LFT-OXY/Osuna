# 06 — 仓库内链接 chip、页内锚点与外链

**What to build:** 预览里指向仓库内其他文件的链接显示为带文件图标的 chip，点击在新的文件标签打开目标文件（带 `#L12` 之类行号时定位到该行）；点击 `#section` 这类页内锚点滚动到对应标题；外链仍用浏览器打开。

**Blocked by:** 05
**Status:** ready-for-agent
**Impl:** ready

## 范围

- 在 05 的资源解析纯函数上补齐链接分类：仓库内文件（相对 / 绝对，可带行号）、页内锚点、外链、越出工作区的路径。
- 仓库内文件链接渲染为带 Material 文件图标的 chip，点击在新文件标签打开；带行号时沿用现有 assistant 文件链接的定位能力。
- 标题生成 GitHub 风格的 slug id；`#anchor` 在预览滚动容器内滚动到对应标题。
- 其余链接走现有的外链打开方式。

## 验收

- [ ] 纯函数单测补充：锚点、带行号链接、越出工作区链接各自分类正确。
- [ ] README 风格 e2e 用例补充断言：点击仓库内 `.md` 链接 chip 打开对应文件标签；点击锚点后目标标题滚动进可视区。
- [ ] 外链点击仍用浏览器打开，不在应用内导航。
- [ ] app 包 typecheck、lint 通过。

## Comments

- 来自 02：`defaultSchema` 会给 `id` / `name` 加 `user-content-` 前缀（clobber），页内锚点 `#foo` 需要去掉前缀后再匹配，或自行生成标题 slug id。`MarkdownLink` 目前对所有点击 `preventDefault`，只把 `^https?://` 交给 `openExternalUrl`，相对链接与锚点暂时点击无反应。`mailto:` 同样无反应，本票如要支持，需要同时改 app 与桌面端 opener 的协议白名单。
- 来自 05：分类函数是 `file-pane/markdown-preview/resource.ts` 的 `resolveMarkdownResource`，它读取的上下文来自 `MarkdownPreviewResourcesContext`（`resources-context.web.ts`，由 `DomMarkdown` 提供）。目前它会先截掉 `?` / `#` 后缀，并把 `#…` 直接判为 `unsupported`。补锚点与 `#L12` 时，需要保留 fragment 并新增分类。现有的 `external` 只认 http(s) 与 `data:image/`，链接要支持 `mailto:` 时也得在这里处理。`MarkdownImage` 把非 `external` / `workspace_file` 的结果一律显示为占位，新增分类不会影响图片。
