# Journal - oxy (Part 1)

> AI development session journal
> Started: 2026-09-16

---

## 2026-09-17 工单 01 人工验收通过

- dev 桌面端验证时 Codex 一度没有输入框底色，根因是 `packages/desktop/scripts/dev-runner.mjs` 注入的 `FORCE_COLOR=1` 让 Codex 进入 16 色模式；daemon 应答本身 2.7 ms 内到齐。用 `FORCE_COLOR=3` 启动 dev desktop 后用户确认浅色/深色均正常。
- 待决定的后续项：dev-runner 的 FORCE_COLOR 泄漏是否单开一票；探测应答中的 `ESC[?0u` 来源未查明。

## 2026-09-17 工单 02 人工验收：Codex 不订阅 2031

- 浅色启动 Codex 正常，切深色后输入框仍白底，重启后变深色底。daemon 在深色下对 OSC 11 已回答深色值，推送链路无误。
- 字节检查：Codex 0.154.0、Claude Code 2.1.258 只含 `]11;?`，无 `?2031h`/`?996n`；Pi（`terminalColorSchemeNotificationsEnabled`）与 opencode 1.15.10 含 `?2031h`。
- 用户选择改验收对象为 Pi/opencode，PRD 与工单已改，研究文档补更正。

## 2026-09-17 工单 03 实现：对称内边距与对比度修正

- 内边距与对比度都放在共享 xterm 运行时：`contentInset` 由 web 宿主传 `SPACING[2]`，运行时以 border-box padding 缩进 host，FitAddon 只量 host 所以行列自然按内框算；对比度按主题深浅取 4.5/3，深浅口径与 daemon 的 `?996n` 相同（背景亮度低于前景即深），只在值变化时写入。
- 浅色 ANSI white/brightWhite 改为 `#71717a` / `#8a8a92`（对白底 4.8:1 / 3.4:1）。
- 审查处置：WebView 内边距按 PRD 排除；WebView 会随共享运行时得到对比度修正，已写进 PRD Out of Scope；深浅判定口径写进 PRD 与工单。留白放运行时而非组件是判断题，保留（PRD 把几何测试钉在 runtime 浏览器测试）。
- 环境：本机原缺 Playwright Chromium，已 `npx playwright install chromium`；runtime 浏览器测试不加载 xterm.css，`.xterm-screen` 几何无意义。
- 待人工验收：留白肉眼对称、浅色下 ANSI white 可读、深色高亮无变化。
