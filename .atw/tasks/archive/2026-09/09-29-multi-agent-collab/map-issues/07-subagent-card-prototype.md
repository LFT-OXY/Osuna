# 07 — 时间线子智能体卡片原型

**Type:** prototype
**Blocked by:** 02, 03
**Status:** resolved

## Question

时间线里子智能体实时卡片应长什么样、怎么交互，覆盖两种来源：经 `create_agent` 派出的 Paseo 子智能体（点开是普通可交互标签）和 provider 子智能体（Claude/Codex/OpenCode/OMP，点开是只读面板）。要定：卡片字段（provider 图标、标题、状态、运行时长、等待批准徽标、最后一条消息或摘要）、与现有 `SubAgentDetailSection` 日志展开的关系、点开去向（手机与桌面）、子智能体被归档或父轮次取消后的呈现、数据尚未关联上时（02 号票的方案下可能出现）的过渡态。另要定（02 号票遗留）：拿不到 tool call id 的调用（旧版 Claude Code、Codex 0.148 之前、Pi adapter 3.0 之前、ACP 类 provider）是退回通用工具卡，还是由 daemon 从工具结果里补标签；已归档的子智能体是否仍在 app store 里，历史卡片能否显示（先核实）；Pi 直连工具名、Pi 经 pi-mcp-adapter 时的 `paseo.create_agent`（入参包成 `{tool: "paseo_create_agent", args}`，见 01 号票）与 OMP 裸名 `create_agent` 在 app 端怎么识别。做本地 HTML 静态原型放 `prototype/`，用户看后拍板。

## Assets

- 原型：`prototype/subagent-card.html`（`?variant=A|B|C&scenario=…`，右侧控制台切场景与策略）

## Answer

用户 2026-09-30 选方案 C（派发组），其余按原型"待拍板"里的推荐。

- **形态**：同一段助手输出里连续的子智能体调用合成一个派发组；中间插进正文或其他工具调用就断开，另起一组。单个调用是一个只有一行的组。组头写"派出 N 个子智能体"，后面按 track 的桶顺序分段计数（等待批准 / 失败 / 运行中 / 启动中 / 已完成），可以折叠。每行：provider 图标、标题（Paseo 取 `create_agent` 的 title，provider 子智能体取 description）、副行（provider · 模型 · 模式；provider 子智能体用描述符的 subtitle；等待批准时换成"等待批准 · 工具名"）、运行时长（运行中实时走、结束后定格）、状态标记。和 Subagents track 用同一份行数据；组和 track 内容有重复，这一点接受。
- **不显示最后一条消息**：快照里没有，要显示就得逐个订阅子时间线。
- **等待批准**：只报状态，不放批准按钮；用户点开进子会话批准。provider 子智能体靠 adapter 在权限 `metadata` 里补子 id 来归属（03 号票）；OMP 没有来源，v1 不显示。
- **与 `SubAgentDetailSection` 的关系**：派发组的行点击即打开，不再展开。provider 子智能体的活动日志不在组里显示，只读面板里有完整时间线（这一条是按 C 的形态推出来的）。
- **点开去向**：复用 track 的 `handleOpenSubagent` / `handleOpenProviderSubagent`：桌面按"在侧栏打开"偏好，手机整页导航。Paseo 子智能体打开普通 agent 标签，provider 子智能体打开 `provider_subagent` 只读标签。
- **关联查找**：app 按 daemon 写的 `paseo.parent-tool-call-id` 标签在 `session.agents` 里找，不按 `parentAgentId` 找，这样脱离后的子智能体也找得到（detach 只清 parent 标签和打开标签页的标记，`agent-manager.ts:731`）。provider 子智能体按 (父 agentId, `toolCallId`) 找，app 要保留描述符上已有的 `toolCallId`。
- **过渡态**：`create_agent` 还在执行、store 里还没有这个子智能体时，用入参里的 provider/title 画一行"启动中"，不能点开。调用完成后仍未命中，就按标签调一次 `fetch_agents({labels, includeArchived: true})`；还查不到就退回通用工具卡。
- **取消轮次**：子智能体不停，行照常实时更新。
- **已归档 / 父已归档**：active 目录不含已归档 agent（`session.ts:5415`），按上一条按标签查一次，显示最终状态加"已归档"，点开是带归档 callout 的 agent 页。
- **已脱离**：行显示"已独立"，点开是普通根 agent。
- **拿不到 tool call id**（Copilot/ACP 类父会话、旧版 CLI）：退回通用工具卡，daemon 不从工具结果补标签。
- **工具名**：daemon 在 OpenCode/Pi/OMP adapter 往时间线写条目时，统一规范成 `paseo.create_agent`，入参平铺（Pi 要拆掉 `{tool, args}` 这层）；app 只认标准写法。
- **其余退回通用卡的情况**：老 Host（没有关联能力开关）、导入会话、不带 workspaceId 的顶层 `create_agent`。

原型：`prototype/subagent-card.html`（`?variant=C` 是选中的方案）。
