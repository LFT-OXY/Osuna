# 08 — composer 齿轮弹窗换成新外框

**What to build:** 从 composer 模型选择器的齿轮打开时，弹窗里是和设置页一样的详情。

- 弹窗头部：图标、名称、状态徽章、「刷新」、⋯ 和关闭。
- 内容区是同一套分组卡片（错误卡 → 继承提示 → 安装指引 → 第三方接口 → Models → 诊断）。
- 最大宽 640，测试 id 保持 `provider-settings-sheet`。
- 弹窗上不再叠子弹窗。第三方接口的新建和编辑表单除外，它是多字段表单，仍然是弹窗。

**Blocked by:** 07

**Status:** ready-for-agent
**Impl:** ready

- [ ] 从 composer 齿轮打开的弹窗显示新外框和同一套区块。
- [ ] 弹窗里的添加 Model、诊断、删除、刷新都能用，状态和设置页一致。
- [ ] 手机视口下仍是底部 sheet，层级正确。
- [ ] 更新 `provider-settings-refresh` e2e；断言不再出现子弹窗。
- [ ] `npm run typecheck`、`npm run lint`、改动涉及的测试文件都通过。
