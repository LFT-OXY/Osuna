# 06 — `@` 列表智能体分组

**What to build:**
- `@` 列表的智能体分组在上、文件在下，输入后两组同时过滤；列出 Providers 设置里已启用的 provider，按设置顺序排列，过滤匹配显示名与 id。
- 选中后在 Web/Electron 输入框插入 Agent mention 块；原生端插入链接文字。
- 置灰：整组可见但不可选，组顶一行按原因码说明（`tools_not_injected` 附去设置 → Host → Agents 开启的入口，并说明开启后需重新加载当前智能体；其余原因码与未知原因码的文案见 spec）；老 Host（没有 `agentMentions`）整组置灰并提示更新 Host。
- 新文案补齐九种语言。
- `mock` provider 声明 `supportsMcpServers`，让 e2e 能测到可用状态。

**Blocked by:** 01, 02
**Status:** ready-for-agent
**Impl:** ready

- [ ] 浏览器 e2e：智能体分组在文件上方，过滤后两组同时收窄且智能体组仍在上面；选中插入块，发出的文本为 `paseo://agent/provider/<id>` 格式。
- [ ] 浏览器 e2e：`tools_not_injected` 时整组置灰、显示原因与开启入口；老 Host 显示更新提示。
- [ ] 只列已启用的 provider。
- [ ] 九种语言文案齐全。
- [ ] Electron QA 截图：可用与置灰两种状态。
- [ ] `npm run typecheck`、`npm run lint` 通过。
