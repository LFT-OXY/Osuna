# 03 — 窄窗口完整显示 key

**What to build:** 在编辑窗口点「显示」后，长 key 在窄窗口里也能读全，中英文一样；隐藏状态不变。

**Blocked by:** 02
**Status:** ready-for-agent
**Impl:** done

- [x] 浏览器测试：一个 100 字符以上的 key 显示后完整可见（不被按钮挡住或截断），隐藏后恢复打码。
- [x] UI: 编辑窗口 / key 已显示 / 窄窗口 390 — 100 字符以上的 key 在英文与中文下都完整可读，「显示 / 隐藏」是描边按钮。
- [x] 截图用无头浏览器在临时目录里拍，不碰真实的 `~/.claude`、`~/.codex`。
- [x] `npm run typecheck`、`npm run lint` 通过，改到的测试文件本机通过。

参考：prd.md 用户故事 9；原任务工单 05 未勾项。
