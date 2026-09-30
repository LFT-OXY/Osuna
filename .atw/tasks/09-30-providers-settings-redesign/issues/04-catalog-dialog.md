# 04 — 「+」ACP 目录弹窗

**What to build:** 页面里只放用户已有的提供方。

- 移除「添加 Provider」整节。
- Providers 列表标题右侧加一个 ghost 仅图标「+」（无障碍名称「添加 Provider」），点开 ACP 目录弹窗。弹窗桌面端居中、手机上从底部弹出；标题沿用目录标题，搜索放在弹窗头部，目录列表读取这个查询。
- 点「添加」时沿用「正在添加」加 spinner。成功后关闭弹窗，并导航到新提供方的子路由：宽屏 replace，栈式 push。
- 失败时错误显示在弹窗内容顶部，弹窗不关闭；不再用 `Alert.alert`。

**Blocked by:** 02

**Status:** ready-for-agent
**Impl:** done

- [x] Providers 页不再有「添加 Provider」一节；列表标题右侧的「+」打开目录弹窗。
- [x] 弹窗头部搜索能过滤目录。
- [x] 添加成功后弹窗关闭，列表出现并选中新提供方（手机上推入它的详情）。
- [x] 添加失败时弹窗内显示可见错误，弹窗保持打开，可以重试。组件测试覆盖成功和失败。
- [x] 更新 `acp-provider-catalog` e2e 和设置页 e2e 辅助函数，改走「+」弹窗。
- [x] `npm run typecheck`、`npm run lint`、改动涉及的测试文件都通过。
