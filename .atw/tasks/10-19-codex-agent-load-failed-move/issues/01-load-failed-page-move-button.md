# 01 — 加载失败页认出「Codex 服务商不在」，给说明和挪动按钮

**What to build:** daemon 重启后打开一个没归档、因 Codex 服务商不在而续不上的 Codex Agent 时，Agent 页不再只写「Failed to load agent」，而是用界面语言说明原因，并给出「挪动对话…」按钮，打开 10-16 任务的挪动对话框；挪好后重试，Agent 能正常打开。其他原因的加载失败照旧。

**Blocked by:** None
**Status:** ready-for-agent
**Impl:** ready

- [ ] 端到端：daemon 重启后拉取这种 Agent 的时间线，回复里带 `codex_model_provider_missing` 码；挪到夹具里存在的服务商后，再拉取成功。
- [ ] 浏览器测试：Agent 页显示说明与「挪动对话…」按钮；挪动成功后 Agent 正常打开；挪动失败时错误留在原处。其他原因的加载失败仍是原来的页面。
- [ ] 协议：新字段可选，旧客户端照旧看到「Failed to load agent」。
- [ ] UI: Agent 页 / Codex 服务商不在 / 桌面 1280 与窄窗口 390 — 说明完整可读，按钮不被遮住、不是蓝色链接。截图用无头浏览器在临时文件夹里拍，不碰真实的 CLI 配置。
- [ ] 新文案（如有）9 种语言齐全，中文是真翻译。
- [ ] `npm run typecheck`、`npm run lint` 通过，改到的测试文件本机通过。

参考：prd.md；`archive/2026-10/10-16-cli-wiring-web-search` 的 14 号工单与 `research/implementation-notes.md` 14 节（`toAgentResumeWireError`、`ArchivedAgentCallout` 那一处的做法）。
