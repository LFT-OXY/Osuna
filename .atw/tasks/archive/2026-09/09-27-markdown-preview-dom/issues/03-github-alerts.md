# 03 — GitHub 提示块与本地化标题

**What to build:** 预览里 `> [!NOTE]` / `[!TIP]` / `[!IMPORTANT]` / `[!WARNING]` / `[!CAUTION]` 渲染成带图标和标题的提示块，五种各有颜色与图标，`[!NOTE]` 这类标记文字不再外露；标题跟随界面语言（中文为「注意 / 提示 / 重要 / 警告 / 小心」）。

**Blocked by:** 02
**Status:** ready-for-agent
**Impl:** done

## 范围

- 移植 t3code 的 GitHub alerts remark 插件：标记大小写不敏感、独占一行才识别，标记行不显示；放行提示块所需的 data 属性进消毒白名单。
- 五种提示块颜色取自项目主题 token 中语义对应的角色，深浅色正确；图标用项目现有的 lucide 图标。
- 标题文案走 i18n，所有 locale 补齐。

## 验收

- [x] README 风格 e2e 用例补充断言：提示块以 note 角色渲染、显示本地化标题、`[!NOTE]` 文字不出现。
- [x] 五种提示块在深浅色下颜色与图标可区分。
- [x] 所有 locale 都有五个标题的翻译（i18n 完整性检查如有则通过）。
- [x] app 包 typecheck、lint 通过。

## Comments

- 实现：`file-pane/markdown-preview/github-alerts.ts`（移植 t3code 插件，保留 MIT 声明；为过 lint 复杂度上限拆成 `readLeadingText` / `stripMarkerLine`，逻辑与原件等价）；`dom-markdown.web.tsx` 的 `MarkdownBlockquote` 从 `node.properties.dataAlert` 取类型，渲染 `role="note"` 的 div；消毒白名单只加了 `blockquote` 的 `dataAlert`。约定写入 `.atw/spec/app/frontend/styling.md` 的 DOM markdown 段。
- 颜色（经用户确认）：note 用 `palette.blue[600]`（亮）/ `palette.blue[400]`（暗），各主题固定，不用 `accentBright`：强调色随主题变，在 Claude 暗色下与 caution 几乎同色，在 zinc 下接近白色。tip / important / warning / caution 用 `statusSuccess` / `statusMerged` / `statusWarning` / `statusDanger`。important 借用 `statusMerged` 是有意为之，这样五种颜色的明度和饱和度保持一致。
- 图标：lucide-react-native 传 `color="currentColor"`，web 端描边取标题颜色（已核对计算样式）；标题字重用 `fontWeight.medium`（结构性标签档）。
- 标题 i18n 键 `panels.file.markdownAlerts.{note,tip,important,warning,caution}`，9 个 locale 都已补齐；fr 的 "Important" 与英文同形，不影响完整性检查。
- 与 t3code 一样，手写的 `<blockquote data-alert="note">` 也会渲染成提示块。
- 测试：README 用例补了 note 角色、"Note" 标题、`[!NOTE]` 不外露的断言；新增用例在 zh-CN 下验证五个标题、每块一个图标、行内 aside 保持普通引用、深浅色下左边线的精确颜色。图标之间是否不同没有断言，靠映射表保证。
- 验证：file-editing e2e 全文件 20 个用例本地通过；app 单测 652 个文件全绿；app typecheck 与改动文件的 lint 都通过；深浅色截图目视确认五种可区分。
