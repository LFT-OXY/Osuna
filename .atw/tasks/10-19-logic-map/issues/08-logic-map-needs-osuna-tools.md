# 08 — Osuna 工具没开时，逻辑图开关给出提示

**What to build:** 逻辑图靠 Osuna 自己的 MCP 工具（`read_logic_map` / `update_logic_map`）读写图。主机关着"启用 Osuna 工具"（`mcp.injectIntoAgents`）、主机关了 MCP，或当前 Agent 拿不到 Osuna 工具时，输入框的逻辑图开关旁要直接说明原因，并给出"去开启"入口，做法与 @ 提及 Agent 的不可用提示一致（`packages/app/src/hooks/use-agent-autocomplete.ts` 按 `tools_not_injected` / `mcp_disabled` / `tools_not_delivered` 给文案，草稿与运行中的 Agent 文案不同）。这种情况下 daemon 不再附加逻辑图说明块，免得 Agent 被要求用它没有的工具。开关本身的开、关和已有的图不受影响。来源：07 真机验收，dev 数据里没存过这个设置，daemon 默认按关处理，Claude Code 回复"工具不存在"（`research/07-real-agent-acceptance-notes.md` 问题 1）。

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

**Impl:** ready

- [ ] 工具不可用时，开关旁显示原因和"去开启"入口；草稿和运行中的 Agent 分别用对应文案（运行中的要提示开启后重新加载 Agent）。
- [ ] 工具不可用时发给 provider 的消息不带逻辑图说明块，工具可用时照常带；daemon 测试覆盖两种情况。
- [ ] 浏览器测试：工具不可用时提示可见、点"去开启"跳到设置 → 主机 → Agent；工具可用时不显示提示。
- [ ] UI：桌面 1280 宽 / 输入框工具栏 / 工具不可用时的提示——截图显示提示文字完整，不挤压模型和模式控件。
- [ ] 新增文案 zh-CN、en 齐全。
- [ ] `npm run typecheck`、`npm run lint` 通过；本票新增或修改的测试文件单独跑通过。
