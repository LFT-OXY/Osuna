# 03 — GitHub 提示块与本地化标题

**What to build:** 预览里 `> [!NOTE]` / `[!TIP]` / `[!IMPORTANT]` / `[!WARNING]` / `[!CAUTION]` 渲染成带图标和标题的提示块，五种各有颜色与图标，`[!NOTE]` 这类标记文字不再外露；标题跟随界面语言（中文为「注意 / 提示 / 重要 / 警告 / 小心」）。

**Blocked by:** 02
**Status:** ready-for-agent
**Impl:** ready

## 范围

- 移植 t3code 的 GitHub alerts remark 插件：标记大小写不敏感、独占一行才识别，标记行不显示；放行提示块所需的 data 属性进消毒白名单。
- 五种提示块颜色取自项目主题 token 中语义对应的角色，深浅色正确；图标用项目现有的 lucide 图标。
- 标题文案走 i18n，所有 locale 补齐。

## 验收

- [ ] README 风格 e2e 用例补充断言：提示块以 note 角色渲染、显示本地化标题、`[!NOTE]` 文字不出现。
- [ ] 五种提示块在深浅色下颜色与图标可区分。
- [ ] 所有 locale 都有五个标题的翻译（i18n 完整性检查如有则通过）。
- [ ] app 包 typecheck、lint 通过。
