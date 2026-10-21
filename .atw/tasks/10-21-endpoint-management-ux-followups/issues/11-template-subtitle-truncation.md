# 11 — 宽窗口模板列表的副标题少截断

**What to build:** 桌面 1280 下模板列表三列，副标题常被截断（如「Token Plan · pay as y…」）。让副标题读得全：允许两行，或改成两列；先查 magpie `7597c132` 的模板列表怎么排并照做。偏口味，动手前先拿截图给用户选。

**Blocked by:** None — can start immediately
**Status:** ready-for-agent
**Impl:** ready

- [ ] UI: 模板列表 / 默认 / 桌面 1280 — 区域、套餐类副标题能读全；窄窗口 390 不变。
- [ ] 英文浅色、英文深色、中文浅色三版截图，用无头浏览器在临时目录里拍；方案经用户选定。
- [ ] `npm run typecheck`、`npm run lint` 通过，改到的测试文件本机通过。

参考：工单 08 视觉评审第 3 条，`screenshots/08-template-list-*-desktop-1280-*.png`。
