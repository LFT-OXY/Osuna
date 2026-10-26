# 12 — 「固定登录到」成功用例本机固定失败：下拉选项在视口外

**What to build:** 验收时发现 `packages/app/e2e/browser/settings-provider-account-rotation.spec.ts:183`「Keep signed in to signs the CLI in to that account, and can be cleared」在本机连跑 3 次都挂在第 191 行：点 `provider-accounts-keep-<id>` 超时，Playwright 报 element is outside of the viewport。失败截图里视口 1280×900，「固定登录到」选择框在页面底部（y≈885），弹出的选项渲染在视口外。紧挨着的失败用例「a Keep signed in to that can't be saved…」做同样的点击却每次通过，区别是成功用例点击前多了 `await expect(trigger).toHaveText("Don't keep")`。先查清是测试写法问题，还是选择框贴近视口底部时弹层不向上翻、跑到屏外（后者用户也会碰到），再按查到的原因修。

**Blocked by:** -
**Status:** ready-for-agent
**Impl:** ready

- [ ] 写明原因：测试问题还是界面问题，有证据（截图或弹层定位代码）。
- [ ] 若是界面问题：选择框贴近视口底部时，选项完整出现在视口内，宽 1280 与 390 各有截图。
- [ ] 该用例本机连跑 3 次都通过；同文件其余用例仍通过。
- [ ] 通过后勾上 `prd.md` Acceptance Criteria 的「每个会失败的界面操作，浏览器测试都覆盖成功与失败」（Claude 那边缺的几条用户 2026-10-26 认可由 Codex 覆盖）。
