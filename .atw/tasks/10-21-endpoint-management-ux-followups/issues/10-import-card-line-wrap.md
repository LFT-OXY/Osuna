# 10 — 导入窗口卡片折行不以分隔点开头

**What to build:** 「从其他软件导入」窗口里每条的说明（来源 · 地址 · key · 模型数）放不下折行时，新的一行不以「·」开头：按片段整段折行，或把分隔点留在上一行末尾。

**Blocked by:** None — can start immediately
**Status:** ready-for-agent
**Impl:** done

- [x] UI: 导入窗口 / 窄窗口 390 — 折行后每行都不以「·」开头，中英文都是。
- [x] 英文浅色、英文深色、中文浅色三版截图，用无头浏览器在临时目录里拍。
- [x] `npm run typecheck`、`npm run lint` 通过，改到的测试文件本机通过。

参考：工单 08 视觉评审第 2 条，`screenshots/08-import-dialog-compact-390-*.png`。
