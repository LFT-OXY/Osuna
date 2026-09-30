# 01 — 预重构：把提供方详情内容抽成共用组件

**What to build:** 为后续所有工单铺路，界面和行为一点不变。

现在提供方详情的内容，也就是安装指引、第三方接口和模型区，都写死在提供方详情弹窗里。把这部分抽成一个独立的详情组件：它只接收 host 与 provider，外框交给调用方决定。现有弹窗改为用这个组件渲染内容，弹窗头部的搜索、底部栏、两个子弹窗暂时保持原样。

这张做完以后，设置页和 composer 入口打开的弹窗与改动前逐像素一致，后面的工单只需要往这个组件里加东西、换外框。

**Blocked by:** None — can start immediately

**Status:** ready-for-agent
**Impl:** done

- [x] 新的详情组件可以脱离弹窗单独渲染，入参只有 host 与 provider（以及外框需要的少量选项）。
- [x] 提供方详情弹窗改用这个组件渲染内容，从设置页和 composer 齿轮打开时，界面与改动前一致。
- [x] 现有的提供方列表测试、安装指引测试、第三方接口测试不改断言，全部通过。
- [x] 新增详情组件的 jsdom 测试文件，至少覆盖「未安装且有指引时显示安装指引」「Claude Code 与 Codex 显示第三方接口」「模型区显示已发现与自定义两组」。
- [x] `npm run typecheck`、`npm run lint`、改动涉及的测试文件都通过。

**Notes（实现时定下，用户已确认）：**

- 详情组件拆成 `provider-detail/index.tsx`（`ProviderDetailSurface`，纯 props，jsdom 测试对象）和 `provider-detail/view.tsx`（`ProviderDetail`，入参 `serverId`、`provider`、`modelQuery`）。安装指引与第三方接口的运行时视图在 unit 运行器里无法加载，由 view 经 `renderInstallGuide` / `renderApiEndpoints` 插槽注入。`modelQuery` 是弹窗头部搜索的过渡入参，06 把搜索移进 Models 卡片后删掉。
- 接受的临时差异 1：弹窗底部「刷新」和详情错误态「重试」各自持有 `useProvidersSnapshot` 的刷新进行中状态，互不同步；删除自定义模型后的刷新也不再让底部按钮显示进行中。07 移除底部栏后消失。没有为此改共享 hook。
- 接受的差异 2：「已发现模型」缓存按详情组件的挂载实例保存。桌面 Web 关闭弹窗会卸载内容，刷新未结束时重开会先显示加载，而不是旧列表。
