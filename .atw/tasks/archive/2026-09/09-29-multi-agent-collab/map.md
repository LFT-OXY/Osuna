# Map — 多智能体协作：@ 智能体派发与子智能体实时卡片

## Destination

一份可直接切票的 `prd.md`：Agent mention 的协议接口（智能体块语义、发送请求字段、能力开关、可派发快照字段）、daemon 路由提示的文本与剥离规则、提及智能体默认值的存储与解析、时间线子智能体卡片的数据来源与形态、`@` 弹窗智能体分组的行为都已决定。到达标志：`/atw-spec` 能写满 Requirements 与 Acceptance Criteria，不留 TBD，然后走 stop ②。

## Notes

- 需求边界：`prd.md` 的「已定决策」（askme 2026-09-29，含 map 访谈对三条的修正）。map 只解决它没覆盖的设计问题，不重开已定项。
- 调研：参考项目 `research/reference-projects.md`；Osuna 现状 `research/osuna-current-state.md`。
- 前置任务 `09-29-composer-inline-blocks`（已归档，`.atw/tasks/archive/2026-09/`）提供了行内块的写法、解析、渲染与编辑器节点；Agent mention 只是其中一种块，本 map 只定智能体块的语义、`@` 分组与派发。
- ADR：`docs/adr/0004-agent-mention-dispatched-by-parent-agent.md`。术语：`docs/glossary.md` 的 **Agent mention**、**Subagent**；Paseo 子智能体点开是普通可交互标签，只读面板只用于 provider 子智能体。
- 每个 session 必读：`docs/protocol-compatibility.md`、`docs/rpc-namespacing.md`、`docs/agent-lifecycle.md`、`docs/providers.md`；UI 票加读 `docs/design.md`、`docs/hover.md`。
- 原型只做本地 HTML 静态文件，放 `prototype/`，只给路径，不发布。
- 研究票由子代理跑 `atw-research`，结果写 `research/<topic>.md`，票内 `## Answer` 只放结论与指针。
- 已查事实（2026-09-29，供各票起步）：`create_agent` 的 structuredContent 只有 Codex 原样保留，Claude/OpenCode 只剩带 `availableModes_count=` 前缀的文本；OpenCode 原生工具名 `paseo_create_agent` 不被 `getPaseoToolLeafName` 识别；provider 子智能体可按 `toolCallId` 与父时间线 `callId` 对上，app 端未保留该字段；track 写死 `requiresAttention:false`；daemon 无"本会话已注入 Osuna tools"字段；新建智能体偏好存在 app 端 AsyncStorage。

## Decisions so far

<!-- 一行一票：标题链接 + 一句结论 -->

- [`create_agent` 调用与所产子智能体的关联手段](map-issues/02-create-agent-call-to-child-link.md) — 五个 provider 都能拿到与父时间线 `callId` 相同的 tool call id：Claude 在 `_meta["claudecode/toolUseId"]`，Codex 在 `_meta.callId`（0.148 起），Pi adapter 在 `_meta["pi-mcp-adapter/toolCallId"]`（3.0 起），OpenCode 在插件的 `context.callID`，OMP 在 `toolCallId`；daemon 现在全部丢掉了。推荐：daemon 取到 id 后，给子智能体写自有标签（如 `paseo.parent-tool-call-id`，覆盖模型传入的同名键），app 按"父 agentId + callId"在 agent store 里关联；只加能力开关，不改 wire schema；实时和重载都成立，导入会话退回通用卡。按文本解析、按时间或 prompt 匹配两种方案不采用。详见 `research/create-agent-child-link.md`。
- [各 provider 会话能否调用 `create_agent` 的判定](map-issues/04-dispatch-capability.md) — 能否派发要同时满足三层：全局 `mcp.enabled && mcp.injectIntoAgents`、provider 的 `paseoTools` 策略没关掉 `create_agent`、工具确实送进了会话（原生通道看会话工具目录，MCP 通道看是否注入了 paseo 服务器且 `supportsMcpServers`）。结论在会话启动或 reload 时算一次，运行中改开关不影响已运行会话。Claude/Codex/Copilot/ACP/OMP 能；Pi 要装 adapter；OpenCode 必须看工具目录（策略关了模型仍能看到工具）。建议在快照顶层加可选布尔字段（如 `canCreateAgents`），不复用、也不放进 `capabilities`。注意 `injectIntoAgents` 默认关闭。详见 `research/dispatch-capability.md`。
- [子智能体"等待批准"的数据来源](map-issues/03-subagent-permission-source.md) — Paseo 子智能体的 `pendingPermissions` 已经随 host 级 active 订阅进入 app store，track 只要给行加上待批准计数（`requiresAttention:false` 保持不变），不改协议。Claude/Codex/OpenCode/OMP 的 provider 子智能体权限都落在父 agent 上，要靠各 adapter 在请求 `metadata` 里补子智能体 id 才能归属：Codex 有 `threadId`；Claude 的 `agentID`、OpenCode 的 `sessionID` 现在被丢掉；OMP 没有来源。只读面板接入时，要按"父 agentId + 子 id"重组权限列表。现有权限通知要求父智能体代批，和 PRD 冲突，转 10 号票。详见 `research/subagent-permission-source.md`。
- [路由提示的写法与各父 provider 的遵从度实测](map-issues/01-routing-prompt-compliance.md) — 提示以 `prototype/routing-prompt-v2.md` 定稿（英文，末尾 `<paseo-system>` 块按出现顺序列出每个 mention 的 `provider/model` 与 `settings` JSON，禁止改值、先查 `list_*`、改用原生子智能体或委派 skill/CLI、代批）；Claude/Codex/Pi 实测 18/18 派发正确，v1 不置灰任何父 provider。Pi 的派发入参被 adapter 包成 `{tool, args}`，07 号票要拆。详见 `prototype/results.md`。
- [提及智能体默认值：daemon 配置形状、跨 provider 模式回退、profile 的处理](map-issues/05-mention-defaults-config.md) — 存 `providers.<id>.mentionDefaults: {model?, thinkingOptionId?, modeId?}`，走 `set_daemon_config`；未配置项取快照默认（模式用 `defaultModeId`，不继承父会话）；失效值发送时逐项回退、卡片标"不可用"；PRD 的"自定义 profile"指 Agent profile，进 `@` 列表，按 profile → mention defaults → 运行时默认逐字段叠加；feature 不进卡片。
- ["提及智能体默认值"设置卡原型](map-issues/06-mention-defaults-card-prototype.md) — 选方案 B：独立 section，每 provider 一行摘要、点开是模型/思考/模式三条标准设置行，即时保存；首项"默认（X）"；换模型时不合法的档位自动清回默认并短暂提示；失效值原样显示加 ⚠ 与"将使用默认（X）"；Osuna tools 关闭时照常可编辑加顶部提示，老 Host 只显示一行"更新 Host"。原型 `prototype/mention-defaults-card.html`。
- [时间线子智能体卡片原型](map-issues/07-subagent-card-prototype.md) — 选方案 C「派发组」：连续的子智能体调用合成一组，组头按状态分段计数，每行显示图标、标题、副行、时长、状态，点击即打开（复用 track 的 handler）；不显示最后一条消息，不放批准按钮；app 按 `paseo.parent-tool-call-id` 标签找子智能体（脱离后仍能关联），在 store 里找不到时按标签带 includeArchived 查一次，显示已归档；未入库时显示"启动中"；拿不到 call id、老 Host、导入会话、顶层创建都退回通用卡；非标准工具名由 daemon adapter 统一规范成 `paseo.create_agent`。原型 `prototype/subagent-card.html`。
- [等待 `09-29-composer-inline-blocks` 的 spec 确认](map-issues/08-await-inline-blocks-spec.md) — 前置任务已实现归档：智能体块就是正文里的 `[@显示名](paseo://agent/<target>)`，协议与 daemon 不改，`mentions` 字段作废，由 daemon 从正文提取；`target` 是唯一扩展位（不透明字符串，不能含 `/`），provider 与 profile 怎么区分还没定，格式一写进历史就冻结，转 09 号票；原生端输入框插入链接文字，四端气泡都显示块。
- [Agent mention 的协议接口](map-issues/09-mention-protocol.md) — 链接写成 `paseo://agent/provider/<id>` 与 `paseo://agent/profile/<id>`，解析器抽到 `packages/protocol` 前后端共用，显示成块即派发；只有客户端发来的用户消息触发（含 steer、排队、新建首条），session 层解析、`startAgentRun` 在带外命令判定后追加 Routing block，目标不可用时在块里写原因；开关 `agentMentions` 与 `subagentCallLinks` 分开；快照加可派发布尔加原因码，provider 快照加预测字段，`injectIntoAgents` 仍默认关、提示里给开启入口；时间线记原文，末尾块只从 provider 回放、导入与预览里剥；标题把 Markdown 链接换成 label；不加新权限。
- [子智能体请求权限时的父会话通知与用户提醒](map-issues/10-subagent-permission-notice.md) — 权限通知正文全局改成"用户在子会话批准，勿用 `respond_to_permission`，除非用户明确授权"，载荷照附、不区分 mention 来源；`broadcastAgentAttention` 对子智能体只放开 `permission` 原因（推送/系统通知，指向子会话），`finished`/`error` 仍静默；同工作区子智能体的待批准向上汇总成工作区"需要批准"档；provider 子智能体提醒仍跳父会话，不做只读面板深链。

## Not yet specified

- （已清空：`@` 分组交互细节、测试接缝与文档归属都已写进 `prd.md`，2026-09-30。）

## Out of scope

- @ 已在运行的智能体；兄弟子智能体互通与专门评审机制；追踪父智能体是否照做；Pi 实时子时间线；Grok 一等 provider；子智能体开 worktree（均见 `prd.md` 已定决策）。
- 不带 workspaceId 的顶层 `create_agent` 渲染为子智能体卡片（map 访谈 Q6：不是 Subagent，不进 track）。
