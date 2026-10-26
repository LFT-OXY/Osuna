# 12 — 「固定登录到」成功用例本机固定失败：下拉选项在视口外

**What to build:** 验收时发现 `packages/app/e2e/browser/settings-provider-account-rotation.spec.ts:183`「Keep signed in to signs the CLI in to that account, and can be cleared」在本机连跑 3 次都挂在第 191 行（复查：实际是第 199 行，第二次打开点 `provider-accounts-keep-none`）：点 `provider-accounts-keep-<id>` 超时，Playwright 报 element is outside of the viewport。失败截图里视口 1280×900，「固定登录到」选择框在页面底部（y≈885），弹出的选项渲染在视口外。紧挨着的失败用例「a Keep signed in to that can't be saved…」做同样的点击却每次通过，区别是成功用例点击前多了 `await expect(trigger).toHaveText("Don't keep")`。先查清是测试写法问题，还是选择框贴近视口底部时弹层不向上翻、跑到屏外（后者用户也会碰到），再按查到的原因修。

**Blocked by:** -
**Status:** ready-for-agent
**Impl:** done

- [x] 写明原因：测试问题还是界面问题，有证据（截图或弹层定位代码）。
- [x] 若是界面问题：选择框贴近视口底部时，选项完整出现在视口内，宽 1280 与 390 各有截图。
- [x] 该用例本机连跑 3 次都通过；同文件其余用例仍通过。
- [x] 通过后勾上 `prd.md` Acceptance Criteria 的「每个会失败的界面操作，浏览器测试都覆盖成功与失败」（Claude 那边缺的几条用户 2026-10-26 认可由 Codex 覆盖）。

**原因（2026-10-26 查明）：** 两者都有。
- 测试：页面上方「Version」一节要等版本检查回来（约 1.5 秒）才出现，把选择框从 y=770 推到 y=878。第一次打开时页面还没排完、下方放得下；第二次打开时选择框已贴底。单独跑过、整份跑挂就是这个时间差。
- 界面：网页端 `Combobox` 只往下开（`packages/app/src/components/ui/combobox.tsx` 的 `buildFloatingMiddleware` 里 floating-ui 的 `flip` 只给原生端），贴底时选项整块画在窗口外，用户看到的是点了没反应（修前截图里弹层 top=905，窗口高 900）。另外 floating-ui 在网页端给往上开算的可用高度偏小（81px），只开 flip 会把列表压扁。
- 修法（用户选定改共用零件）：量出往下放不下、上方更宽时，这次打开改走已有的 top-start 测量定位，可用高度按锚点顶部自算；判断在 `combobox-placement.ts` 的 `shouldFlipDesktopUp`。用例先把选择框滚到窗口底边，两次打开都断言选项整块可见、未被弹层裁掉。
- 证据：`screenshots/keep-select-bottom-edge-open-1280.png`（往上开、三项完整）、`-390.png`（窄屏本来就用底部面板）。整份文件连跑 3 次 8/8。
- 未处理：弹层打开后页面若再被推动，弹层不跟着锚点走（所有下拉通用，不在本单）。
