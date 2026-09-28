# 01 — 从 Command menu 选中 skill 变成 Skill chip，点 × 删除，发送时拼回

**What to build:** 用户在 Command menu 选中 `kind: skill` 的条目后，正文里的 `/query`（连同紧随的一个空格）消失，光标留在原位，Attachment tray 最前面出现一个 Skill chip（立方体图标 + 原始名，浅蓝底、蓝描边、蓝字），同名不重复；点 × 删除；发送时消息为 `/a /b 正文`（只有 chip 也能发），发送或排队后 chip 清空；有 chip 时不识别客户端 / 插件客户端命令。选中命令仍按现状插入文字。见 PRD「状态与模型」「发送」「视图」。任务层面排在子任务"斜杠菜单美化"之后，沿用其立方体图标。

**Status:** ready-for-agent
**Impl:** done

**Blocked by:** None — can start immediately

- [x] Skill chip 纯逻辑模块：选中、去重、删除指定 / 最后一个、序列化
- [x] tray 在"有附件或有 chip"时显示，chip 在附件前；高度、圆角与附件 pill 对齐，长名截断
- [x] 颜色只用 `accent` / `accentBright` + 低不透明度底层，不新增 token
- [x] × 按 `docs/hover.md`：外层 View 悬停包络 + 内层 Pressable；`isHovered || isNative || isCompact`
- [x] 空消息判定改为"正文与 chip 都为空"；有 chip 跳过客户端命令识别
- [x] 测试 A1：参照 `agent-command-autocomplete.test.ts`、`submit.test.ts`
- [x] Electron 实测选两个 skill + 正文发送，transcript 为 `/a /b 正文`；`typecheck`、`lint` 通过
