# 05 — Routing block 派发：provider mention、原文入时间线、剥离与标题

**What to build:**
- 客户端发来的 `send_agent_message_request`（含 steer 与排队出队）正文带 provider 类 Agent mention 时，session 层解析 mention、读快照、按运行时默认（快照 `isDefault` 模型、模型默认档位、`defaultModeId`）生成 Routing block，作为运行选项传入 `startAgentRun`；带外命令判定之后再追加（数组 prompt 追加末尾文本块，字符串追加 `\n\n` + 块）。文本以 spec 中的原型 v2 定稿为准，取不到的项不写。
- 会话 `canCreateAgents` 为 false 时不附；provider 未启用或不可用时，该 mention 写"无法启动：原因"。MCP `send_agent_prompt`、schedule、通知注入不触发。
- 时间线记发送前原文（`recordSubmittedPrompt` 按 `clientMessageId` 对账）；新增按形状剥用户消息末尾 `<paseo-system>` 块的函数，用在 provider 来源的文本：实时回显（含找不到对账记录的带 `clientMessageId` 回显）、force hydrate、prime、历史导入、导入选择器的标题与首条、末条 prompt 预览。
- 会话标题里的 Markdown 链接换成 label；工作区自动命名与分支名输入保持原文。
- 做完后在输入框里手打链接文字即可端到端演示派发。

**Blocked by:** 01, 02
**Status:** ready-for-agent
**Impl:** done

- [x] daemon 测试（假 provider `onStartTurn`）：单个、同 provider 两次、多个 provider 的 Routing block 顺序与内容正确；steer 与排队出队同样附加；带外命令按原文识别且不附块。
- [x] daemon 测试：会话不能派发时原文照发、不附块；provider 未启用时该行写原因，其余照常；MCP `send_agent_prompt` 与 schedule 不附块。
- [x] 时间线不带 Routing block（daemon 测试）；回显、hydrate、prime、导入与导入预览不带 Routing block（`AgentManager`、provider 描述符与投影单测，理由见 PRD Testing Decisions）。
- [x] 标题里的 agent、文件、普通链接显示为 label。
- [x] 剥离函数与标题链接替换有纯函数单测。
- [x] `npm run typecheck`、`npm run lint` 通过。
