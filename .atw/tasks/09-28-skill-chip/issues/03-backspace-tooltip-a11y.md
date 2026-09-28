# 03 — 退格删除、悬停提示与无障碍

**What to build:** 光标在正文最开头且无选区时按退格，删除最后一个 Skill chip（Web 与原生都支持），光标不在开头时退格只删文字；Web 悬停 chip 显示全名与描述；读屏把 chip 读作"Skill: 名字"、× 读作"移除"。见 PRD「视图」中退格、悬停提示、无障碍三条。

**Status:** ready-for-agent
**Impl:** ready

**Blocked by:** 01

- [ ] Web 在 textarea keydown、原生在 `onKeyPress` 捕获 Backspace，仅选区起止都为 0 时删 chip 并阻止默认行为
- [ ] 悬停提示用现有 tooltip 组件；原生不做长按提示
- [ ] 无障碍标签文案进 i18n，所有现有语言补齐
- [ ] 测试 A3：vitest browser 覆盖 chip 在附件前、× 删除、开头退格删 chip、中间退格删文字
- [ ] Electron 浅色 / 深色截图（两个 chip + 一个附件）与原生端常驻 × 截图；`typecheck`、`lint` 通过
