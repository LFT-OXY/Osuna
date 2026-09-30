# 09 — Agent mention 的协议接口

**Type:** interview
**Blocked by:** 04, 08
**Status:** resolved

## Question

在前置任务定下的写法上（ADR 0005：智能体块是正文里的 `[@显示名](paseo://agent/<target>)`，协议不加 `mentions` 字段，见 08 号票 Answer），定 Agent mention 的接口：(1) `target` 的命名空间：provider id 与 Agent profile id 怎么区分、会不会撞名（如前缀或另一段路径——现解析器拒绝解码后含 `/` 的 target，要改也只能在第一条带 mention 的消息写进历史之前改），profile 被改名或删除后旧气泡怎么显示；(2) daemon 从正文提取链接：解析器放哪（app 的 `inline-blocks/index.ts` 在 app 包里，daemon 要同一套规则——移到共享包还是 daemon 自写一份）、在哪一层提取并生成路由提示（发消息路径、新建会话首条消息路径、steer 与排队路径）、手打或从老客户端、官方 Paseo App 发来的同形链接是否同样触发派发；(3) 能力开关名（`server_info.features.*`）与老 Host 提示；(4) 可派发快照字段的名字与形状（取 04 号票结论）；(5) 按形状剥离末尾信封块的落点：`agent-manager.ts` 现有整条信封判定（`isSystemInjectedEnvelope` 四处调用）、各 provider 历史导入、标题生成；(6) 被提及 provider 未启用、不可用或 profile 被删时 daemon 的行为。(7) 新建会话首条消息带 mention（`create_agent_request`）时还没有 agent 快照可读，可派发怎么判：在 provider 快照上加一个预测字段，还是由 daemon 建好会话后兜底；(8) `mcp.injectIntoAgents` 默认关闭（`config.ts:546-547`），新用户的智能体分组默认是置灰的，是否在置灰提示里引导去 Host → Agents 页开启，或者改默认值。

## Answer

2026-09-30 访谈定稿。参考项目对照见 `research/reference-projects.md`「补充：mention 的线格式、触发来源、能力判定与路由块剥离」；发送路径事实来自本票调研（`session.ts:8059`、`agent-prompt.ts:92,115`、`agent-manager.ts:4667-4700`）。

1. **target 命名空间**：两段路径——`[@名字](paseo://agent/provider/<providerId>)`、`[@名字](paseo://agent/profile/<profileId>)`，不加版本段（kind 段即扩展位）。provider id 规则 `^[a-z][a-z0-9-]*$`，profile id 是任意字符串，不靠两者格式碰巧不重叠。旧气泡显示发送时的 label，不随改名更新；删掉的 profile 图标退回 `Bot`。ADR 0005 的链接格式已随之改。
2. **解析器**：agent 链接的序列化、解析（前缀、编码、两种 kind）和整条链接匹配规则（`LINK_PATTERN`、排除 `![`/`\[`）抽到 `packages/protocol/src/agent-mention-link.ts`，app `inline-blocks/index.ts` 与 daemon 共用（codeg 前后端两份已分叉）。显示成块的就触发，代码里的链接也算（app 解析器不排除代码）。
3. **触发来源**：只有客户端发来的用户消息——`send_agent_message_request`（含 steer、app 端排队出队）与 `create_agent_request`/`agent.create.request`/`workspace.create.request` 的首条消息。MCP `send_agent_prompt`/`create_agent`、schedule、结束通知等系统注入不触发（避免父智能体转发原文时连锁派发）。客户端来源（手打、老客户端、官方 App）不区分。
4. **提取与追加的层次**：session 处理函数（`handleSendAgentMessageRequest`、`createSessionAgent`）解析 mention、读快照、按 05 号票解析默认值、生成 **Routing block** 内容，作为运行选项传入 `startAgentRun`；`startAgentRun` 在 `tryRunOutOfBand` 之后追加（带外命令按原文识别，不带路由块）。数组 prompt 追加独立末尾文本块，字符串 prompt 追加 `\n\n` + 块。
5. **能力开关**：`server_info.features.agentMentions` 管 `@` 智能体分组、提及智能体默认值卡片、路由块；老 Host 智能体分组整组置灰并提示更新 Host，设置卡只显示更新提示。子智能体卡片另开 `subagentCallLinks`（`paseo.parent-tool-call-id` 标签 + 工具名统一为 `paseo.create_agent`），缺失时退回通用工具卡。
6. **可派发快照字段**：agent 快照顶层可选布尔（名从 04 号票，如 `canCreateAgents`）加可选 `z.string()` 原因码；app 按原因码给不同提示，认不出用通用文案。原因码取值留给 spec。
7. **新建会话首条消息**：provider 快照上加同形预测字段，新建界面据此置灰（OpenCode 偏保守，已接受）；daemon 建好会话后按实际结果决定附不附路由块。
8. **`injectIntoAgents` 默认值**：保持默认关闭；原因码为全局未开启时，置灰提示带去 Host → Agents 开启的入口。
9. **目标不可用**（provider 未启用/不可用、profile 已删或其 provider 不可用）：照常发送，路由块里对该 mention 写"无法启动：<原因>，告诉用户"，不给 provider/settings，其余 mention 照常；整个会话不能派发时不附路由块，原文照发。
10. **存储与剥离**：时间线记发送前原文——`recordSubmittedPrompt` 改记原文（对账按 `clientMessageId`，不比文本），路由块只存在于发给 provider 的那份。新写"剥末尾 `<paseo-system>` 块"函数（按形状，PRD 已定），与现有整条信封判定并列，用在：不带 `clientMessageId` 的实时回显（`agent-manager.ts:4395`）、force hydrate（`4014`）、prime（`4085`）、导入（`679`），以及导入选择器的 `firstPromptPreview`（现无过滤）。
11. **标题**：取标题时把所有 Markdown 链接换成 label（agent → `@Claude`、文件 → `index.ts`、普通链接 → 链接文字）；工作区自动命名与分支名输入保持原文。
12. **权限**：不加。发 prompt 与智能体控制同属 `workspace.write`，Hub 的生命周期归 `hub.execute`（`docs/permissions.md:26-30`），mention 不扩大调用方能力。
13. **术语**：`docs/glossary.md` 新增 **Routing block**。
