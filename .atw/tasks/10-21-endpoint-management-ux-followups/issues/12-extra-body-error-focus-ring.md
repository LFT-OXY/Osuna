# 12 — 附加请求体出错时焦点框与错误框不叠在一起

**What to build:** 附加请求体输入框出错（如写了保留字段）且正处于输入状态时，蓝色焦点外圈和红色错误框同时出现、叠在一起。按 `docs/design.md` 的输入框状态规则定一种显示（例如出错时焦点圈也用错误色），全应用的输入框同样处理。

**Blocked by:** None — can start immediately
**Status:** ready-for-agent
**Impl:** ready

- [ ] UI: 编辑窗口 / 附加请求体有保留字段且在输入 / 桌面 1280 与窄窗口 390 — 只看到一种状态的边框，错误一眼可辨。
- [ ] 英文浅色、英文深色、中文浅色三版截图，用无头浏览器在临时目录里拍。
- [ ] `npm run typecheck`、`npm run lint` 通过，改到的测试文件本机通过。

参考：工单 08 视觉评审第 4 条，`screenshots/08-edit-dialog-headers-*.png`。
