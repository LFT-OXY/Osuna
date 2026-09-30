# 02 — 所有宽度统一为"列表 → 详情"两级

**What to build:** 在设置 → Providers 里，不管窗口多宽，都先只显示提供方列表，点一行推入这个提供方的详情页。宽屏的页头是「Providers / {名称}」面包屑，点「Providers」回到列表；手机仍然是返回键加刷新和 ⋯ 菜单。左右两列布局去掉，进入分区时也不再自动选中第一个提供方、改写地址。列表在宽屏上有最大宽度，和详情页一致。这张票不改列表里有哪些提供方，也不改行的内容。

**Blocked by:** None — can start immediately
**Status:** ready-for-agent
**Impl:** done

- [x] 宽屏打开 Providers 只显示列表；点一行进入详情页，地址带上这个提供方
- [x] 宽屏详情页的页头是面包屑，点「Providers」回到列表；浏览器后退也回到列表
- [x] 手机和窄屏的行为和现在一致
- [x] 地址里是一个不存在的提供方时，回到列表
- [x] 两列布局相关的代码和测试已经删除，没有留下孤儿代码
- [x] Playwright e2e 覆盖了宽屏的"列表 → 详情 → 返回"（原定的 jsdom 组件测试按 `docs/testing.md` 改为 e2e，见 prd.md Testing Decisions）
- [x] Web 和 Electron 宽屏都有截图验收
- [x] typecheck 和 lint 都通过
