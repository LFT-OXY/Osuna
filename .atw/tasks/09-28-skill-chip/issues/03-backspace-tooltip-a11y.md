# 03 — 退格删除、悬停提示与无障碍

**What to build:** 光标在正文最开头且无选区时按退格，删除最后一个 Skill chip（Web 与原生都支持），光标不在开头时退格只删文字；Web 悬停 chip 显示全名与描述；读屏把 chip 读作"Skill: 名字"、× 读作"移除"。见 PRD「视图」中退格、悬停提示、无障碍三条。

**Status:** ready-for-agent
**Impl:** done

**Blocked by:** 01

- [x] Web 在 textarea keydown、原生在 `onKeyPress` 捕获 Backspace，仅选区起止都为 0 时删 chip 并阻止默认行为
- [x] 悬停提示用现有 tooltip 组件；原生不做长按提示
- [x] 无障碍标签文案进 i18n，所有现有语言补齐
- [x] 测试 A3：vitest browser 覆盖 chip 在附件前、× 删除、开头退格删 chip、中间退格删文字
- [ ] Electron 浅色 / 深色截图（两个 chip + 一个附件）与原生端常驻 × 截图；`typecheck`、`lint` 通过
  - 已完成：Electron 浅色 / 深色截图、紧凑宽度 Web 常驻 × 截图、真实 Electron 退格 / 悬停 / 读屏名实测；`typecheck`、`lint` 通过。
  - 未完成：原生端截图（本机无模拟器 / dev client），Android 退格与选区时序待真机确认。
