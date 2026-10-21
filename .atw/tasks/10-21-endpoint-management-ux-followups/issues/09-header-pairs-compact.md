# 09 — 窄窗口里请求头的名和值看得出是一对

**What to build:** 窄窗口（390）下请求头每一对「名 / 值」上下两行，组与组之间的间距明显大于组内，或每对包进一个分组底框，一眼看出哪两行是一对。

**Blocked by:** None — can start immediately
**Status:** ready-for-agent
**Impl:** ready

- [ ] UI: 编辑窗口 / 请求头两行以上 / 窄窗口 390 — 看得出哪两行是一对；桌面 1280 的一行一对不变。
- [ ] 英文浅色、英文深色、中文浅色三版截图，用无头浏览器在临时目录里拍。
- [ ] `npm run typecheck`、`npm run lint` 通过，改到的测试文件本机通过。

参考：工单 08 视觉评审第 1 条，`screenshots/08-edit-dialog-headers-compact-390-*.png`。
