# 04 — DOM 代码块：Lezer 着色与头部（语言图标 / 换行 / 复制）

**What to build:** 预览里的代码块按语言着色（含 01 新增的 bash、toml 等），颜色跟随设置里选的语法主题并随深浅色即时切换；代码块头部显示语言图标与语言名，可一键切换自动换行、一键复制。无语言代码块以等宽纯文本显示，不被错误着色。

**Blocked by:** 01, 02
**Status:** ready-for-agent
**Impl:** done

## 范围

- DOM 代码块用高亮包的 token 输出，每个 token 渲染为带语义角色的片段，颜色取自当前语法主题；切换语法主题或深浅色即时生效。不引入 Shiki（见 ADR 0001）。
- fence 语言名解析复用 01 补齐后的别名表，与对话代码块保持一致。
- 无语言、未知语言、或超过现有高亮尺寸上限的代码块以等宽纯文本显示。
- 头部：语言图标（项目自带 Material 文件图标，按语言映射到代表性文件名取图标）+ 语言名、换行开关、复制按钮。换行默认关闭（横向滚动），状态只在当前代码块内有效。
- 不做「Run in terminal」按钮；mermaid fence 仍走现有 mermaid 渲染。

## 验收

- [x] README 风格 e2e 用例补充断言：bash 代码块内存在着色片段；复制按钮可复制内容；换行开关切换后代码块换行状态改变。
- [x] 无语言代码块无着色片段、以等宽字体显示。
- [x] 切换语法主题与深浅色后代码块颜色随之变化（人工验证）。
- [x] 语言图标对 bash、ts、json 等常见语言显示正确。
- [x] app 包 typecheck、lint 通过。

## Comments

- 来自 02：02 没有加 t3code 的 `remarkPreserveCodeMeta`（把 fence 元信息写成 `data-code-meta`），加它时要同时在 `PREVIEW_SANITIZE_SCHEMA.attributes.code` 放行 `dataCodeMeta`。代码块目前由 `dom-markdown.web.tsx` 的 `MarkdownPre` 输出为带 `data-pmono` 的纯 `<pre>`，mermaid 已在同一处分流。
- 实现：`file-pane/markdown-preview/code-block.web.tsx` 的 `MarkdownCodeBlock`（头部结构移植自 t3code，保留 MIT 声明）；`dom-markdown.web.tsx` 的 `MarkdownPre` 把非 mermaid 的 `pre > code` 交给它。token 来自 `highlightToKeyedLines`，带样式的渲染为 `<span data-syntax="<role>">`；颜色经 `--md-syntax-<role>` 取 `theme.colors.syntax`，这个值已按语法主题与深浅色解析好。约定写入 `.atw/spec/app/frontend/styling.md` DOM markdown 段的「Code blocks」。
- 别名表：`LANGUAGE_ALIASES` / `fenceLanguageToExtension` 从 `highlighted-code-block.tsx` 挪到 `components/markdown/fence/language.ts`，对话代码块与预览共用，行为不变；取首词改为复用 `getMarkdownFenceLanguage`。
- 图标：取 `x.<高亮键>`，另用 `REPRESENTATIVE_EXTENSIONS` 把 `zsh` / `shell` / `console` / `mjs` / `cjs` / `htm` / `mdx` / `properties` 借到同类扩展名。`dockerfile` / `diff` / `patch` 在 `EXTENSION_TO_ICON` 里没有对应项，退回通用图标。补 SVG 属于文件树图标的改动，本票没有做。
- 取舍：没有加 `remarkPreserveCodeMeta` 与 fence 标题，因为头部只要求图标加语言名，没有地方读取元信息。无语言的代码块也保留头部，但只放换行和复制两个按钮。换行按钮用新 i18n 键 `panels.file.markdownCodeBlock.wrapLines`（9 个 locale 已补齐）；复制沿用 `message.actions.copyCode` / `copied`。
- 复制失败（审查提出）：Web 端 expo-clipboard 会回退到 `execCommand`，失败时可能返回 `false` 而不抛错，所以返回 `false` 和抛错都按失败处理，弹 `workspace.tabs.toasts.copyFailed` 提示。对话代码块的 `CopyButton` 有同样缺口，本票没有改。
- 测试：README 用例新增四个代码块，断言语言标签、三种不同图标、comment/string 着色片段、换行开关、复制成功与失败提示、无语言块的纯文本与等宽字体。深浅色用例设 `syntaxTheme: "catppuccin"`，并断言 Latte/Mocha 两套注释色。不用 `github`，因为它和主题内置色相同，证明不了读取了设置。
- 验证：file-editing e2e 全文件 20 个用例本地通过；app 单测 652 个文件全绿；app typecheck 与改动文件的 lint 都通过；深浅色截图目视确认着色、图标与按钮态。「切换语法主题」由 e2e 以非默认主题的精确色值覆盖，没有在设置页手动切换。
