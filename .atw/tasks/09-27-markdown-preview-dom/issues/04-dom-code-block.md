# 04 — DOM 代码块：Lezer 着色与头部（语言图标 / 换行 / 复制）

**What to build:** 预览里的代码块按语言着色（含 01 新增的 bash、toml 等），颜色跟随设置里选的语法主题并随深浅色即时切换；代码块头部显示语言图标与语言名，可一键切换自动换行、一键复制。无语言代码块以等宽纯文本显示，不被错误着色。

**Blocked by:** 01, 02
**Status:** ready-for-agent
**Impl:** ready

## 范围

- DOM 代码块用高亮包的 token 输出，每个 token 渲染为带语义角色的片段，颜色取自当前语法主题；切换语法主题或深浅色即时生效。不引入 Shiki（见 ADR 0001）。
- fence 语言名解析复用 01 补齐后的别名表，与对话代码块保持一致。
- 无语言、未知语言、或超过现有高亮尺寸上限的代码块以等宽纯文本显示。
- 头部：语言图标（项目自带 Material 文件图标，按语言映射到代表性文件名取图标）+ 语言名、换行开关、复制按钮。换行默认关闭（横向滚动），状态只在当前代码块内有效。
- 不做「Run in terminal」按钮；mermaid fence 仍走现有 mermaid 渲染。

## 验收

- [ ] README 风格 e2e 用例补充断言：bash 代码块内存在着色片段；复制按钮可复制内容；换行开关切换后代码块换行状态改变。
- [ ] 无语言代码块无着色片段、以等宽字体显示。
- [ ] 切换语法主题与深浅色后代码块颜色随之变化（人工验证）。
- [ ] 语言图标对 bash、ts、json 等常见语言显示正确。
- [ ] app 包 typecheck、lint 通过。

## Comments

- 来自 02：02 没有加 t3code 的 `remarkPreserveCodeMeta`（把 fence 元信息写成 `data-code-meta`），加它时要同时在 `PREVIEW_SANITIZE_SCHEMA.attributes.code` 放行 `dataCodeMeta`。代码块目前由 `dom-markdown.web.tsx` 的 `MarkdownPre` 输出为带 `data-pmono` 的纯 `<pre>`，mermaid 已在同一处分流。
