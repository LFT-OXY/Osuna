# 08 — composer 齿轮弹窗换成新外框

**What to build:** 从 composer 模型选择器的齿轮打开时，弹窗里是和设置页一样的详情。

- 弹窗头部：图标、名称、状态徽章、「刷新」、⋯ 和关闭。
- 内容区是同一套分组卡片（错误卡 → 继承提示 → 安装指引 → 第三方接口 → Models → 诊断）。
- 最大宽 640，测试 id 保持 `provider-settings-sheet`。
- 弹窗上不再叠子弹窗。第三方接口的新建和编辑表单除外，它是多字段表单，仍然是弹窗。

- 弹窗头部的 ⋯ 复用 `ProviderDetailMenu`。删除状态按主机加提供方存在 `provider-detail/removal.ts`，弹窗里的详情也会显示同一个提供方在设置页删除失败的提示——用户已确认共享。
- 弹窗里删除成功后关闭弹窗（用户确认）。手机上「刷新」改为仅图标按钮。细节见 prd.md「composer 齿轮入口」。

**Blocked by:** 07

**Status:** ready-for-agent
**Impl:** done

- [x] 从 composer 齿轮打开的弹窗显示新外框和同一套区块。
- [x] 弹窗里的添加 Model、诊断、删除、刷新都能用，状态和设置页一致。（弹窗内删除没有 e2e：mock 提供方不是自定义提供方；删除走与设置页同一套 hook 与 store，`closeIfShowing` 有单测，见 PRD「composer 齿轮入口」）
- [x] 手机视口下仍是底部 sheet，层级正确。
- [x] 更新 `provider-settings-refresh` e2e；断言不再出现子弹窗。
- [x] `npm run typecheck`、`npm run lint`、改动涉及的测试文件都通过。
