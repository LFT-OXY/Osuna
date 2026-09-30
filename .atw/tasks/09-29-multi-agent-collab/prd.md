# 多智能体协作：Agent mention 派发与子智能体实时卡片

前置任务 `09-29-composer-inline-blocks`（已归档）提供了行内块。术语见 `docs/glossary.md` 的 **Agent mention**、**Mention defaults**、**Routing block**、**Subagent**、**Agent profile**、**Inline block**；决策见 `docs/adr/0004-agent-mention-dispatched-by-parent-agent.md`、`docs/adr/0005-inline-blocks-live-in-message-text.md`。每条设计决策的来由与取舍在 `map.md` 的 Decisions so far 及其链接的 `map-issues/`；调研在 `research/`，原型在 `prototype/`。

## Problem Statement

用户想让几个智能体分工干一件事——"@Claude 写实现，@Codex 写测试"——现在做不到：

- 输入框只能 `@` 文件，选不了智能体；要多智能体协作，只能自己开几个标签、分别写任务、再把结果搬回来。
- 当前智能体即使能调用 `create_agent`，用户也没法指定派给谁、用什么模型和模式；父智能体自己挑，常常先花几轮查 `list_providers`，或者干脆改用它自己的原生子智能体。
- 子智能体派出去之后，时间线里只有一张通用工具卡，看不出它是不是还在跑、有没有卡在等批准，也点不进去；Subagents track 里有行，但和时间线里的调用对不上。
- 子智能体请求权限时，用户收不到任何提醒；现有通知反而教父智能体用 `respond_to_permission` 代批。
- provider 自己的子智能体（Claude、Codex、OpenCode、OMP）请求权限时，权限卡只出现在父面板，只读面板里看不到，track 里也不显示。

## Solution

- 在输入框的 `@` 列表里，智能体分组排在文件上面，列出 Providers 设置里已启用的 provider 和 Agent profile。选中后，正文当前位置出现一个 Agent mention 块。
- 发送时，消息照常发给当前智能体。daemon 从正文里认出 Agent mention，按 Mention defaults 或 Agent profile 解析出确定的 provider、模型、思考档位和模式，在发给 provider 的那份消息末尾追加 Routing block，要求当前智能体对每个 mention 各调用一次 `create_agent`。当前智能体写好各自的任务，把子智能体派出去；子智能体完成时，它照常收到完成通知，再汇总给用户。
- 设置 → Host → Agents 新增「提及智能体默认值」，每个已启用的 provider 一行，可以设模型、思考档位、模式；没设的项跟随 provider 默认。
- 当前智能体会话不能派发时（没注入 Osuna tools、provider 策略关掉了 `create_agent`、工具没接通），智能体分组置灰，并说明原因和开启入口。老 Host 提示更新。
- 时间线里，同一段输出中连续的 `create_agent` 调用合成一个**派发组**：组头显示按状态分段的计数，每行实时显示子智能体的状态和时长，点开就是子会话。provider 子智能体按同样的形态出现。
- 子智能体请求权限时，交给用户处理：派发组的行、Subagents track、工作区状态都显示等待批准，推送也会提醒，点开到子会话批准。父智能体收到的通知改成"等待用户批准"。provider 子智能体的权限可以在它的只读面板里批准。

## User Stories

1. 作为用户，我想在输入框里输入 `@` 后先看到智能体分组、再看到文件分组，以便一眼找到可以提及的智能体。
2. 作为用户，我想在 `@` 后继续输入时两组同时过滤、智能体组仍在上面，以便用同一个入口快速选中智能体或文件。
3. 作为用户，我想智能体分组只列出我在 Providers 设置里启用的 provider，以便不会选到用不了的智能体。
4. 作为用户，我想在智能体分组里看到我配置的 Agent profile（带它自己的图标、颜色和名字），排在 provider 后面，以便直接派出我预先配好的角色。
5. 作为用户，我想选中智能体后正文当前位置出现一个带图标、显示 `@名字` 的块，以便看出哪段话是交给哪个智能体的。
6. 作为用户，我想同一个 provider 可以 @ 两次，每次派出一个新的子智能体，以便"@Claude 写实现，@Claude 写测试"能各自独立进行。
7. 作为用户，我想可以 @ 当前智能体自己的 provider，以便让同一种智能体并行处理多件事。
8. 作为用户，我想只放了 Agent mention、不写正文也能发送，以便快速派活。
9. 作为用户，我想在新建智能体的首条消息里就能 @ 智能体，以便一开局就分工。
10. 作为用户，我想在智能体运行中 steer 或排队的消息里也能 @ 智能体，以便随时追加分工。
11. 作为用户，我想发送后当前智能体对每个 mention 各派出一个子智能体，按 mention 所在位置分工，以便我的分工意图被照做。
12. 作为用户，我想派出的子智能体使用我在「提及智能体默认值」里设的模型、思考档位和模式，以便不同 provider 按我的偏好运行。
13. 作为用户，我想没设的项跟随 provider 自己的默认，而不是继承当前智能体的模式，以便子智能体不会意外带上不合适的权限模式。
14. 作为用户，我想 @ 一个 Agent profile 时，profile 里写了的字段优先，没写的再用该 provider 的提及智能体默认值，以便 profile 始终按它的定义运行。
15. 作为用户，我想我设的模型或档位失效时发送不被阻断，而是逐项回退到默认，以便 provider 更新了模型列表也不耽误派活。
16. 作为用户，我想被 @ 的 provider 已停用或 profile 已删除时，当前智能体告诉我这个 mention 无法启动以及原因，其余 mention 照常派出，以便我知道哪部分没做。
17. 作为用户，我想气泡里显示我发送的原文（含 Agent mention 块），看不到 daemon 追加的 Routing block，以便对话保持干净。
18. 作为用户，我想会话标题里的 Agent mention 和文件链接显示为 `@Claude`、`index.ts` 这样的名字，以便标题可读。
19. 作为用户，我想从 provider 历史导入的会话和导入选择器的预览里也看不到 Routing block，以便导入的内容和我当时看到的一致。
20. 作为用户，我想当前智能体没注入 Osuna tools 时，智能体分组置灰并提示"当前智能体未启用 Osuna tools"，附带去开启的入口，以便知道为什么不能用、怎么打开。
21. 作为用户，我想置灰提示按具体原因区分（全局未注入、Host 关闭了 MCP、provider 策略未允许、工具未接通），以便知道该去改哪里。
22. 作为用户，我想开启 Osuna tools 后，被告知需要重新加载当前智能体才生效，以便不会误以为开关没起作用。
23. 作为用户，我想新建智能体界面按所选 provider 预判能否派发并据此置灰，以便首条消息不会写了 mention 却派不出去。
24. 作为连着老 Host 的用户，我想智能体分组整组置灰并提示更新 Host，以便知道缺的是 Host 版本。
25. 作为用户，我想在设置 → Host → Agents 看到「提及智能体默认值」，每个已启用的 provider 一行，显示当前设置的摘要，以便一眼看清各 provider 的派发配置。
26. 作为用户，我想展开一行后用下拉分别设置模型、思考档位、模式，首项"默认（X）"显示此刻解析出的默认值，以便明白不设时会用什么。
27. 作为用户，我想每次选择立即保存，以便不用找保存按钮。
28. 作为用户，我想换模型后，不属于新模型的思考档位自动清回默认，并短暂提示，以便不会存下无效组合。
29. 作为用户，我想 provider 或模型不支持某一项时，对应下拉显示"不支持"并置灰，以便不做无效设置。
30. 作为用户，我想已存的值失效时，卡片上原样显示并标 ⚠ 与"不可用，将使用默认（X）"，以便知道发送时实际会用什么。
31. 作为用户，我想模型列表加载中或读取失败时看到相应状态，以便理解为什么暂时不能改。
32. 作为用户，我想一键"全部恢复默认"，以便撤掉某个 provider 的所有覆盖。
33. 作为用户，我想 Osuna tools 关闭时卡片仍可编辑，并提示这些设置在开启后生效，以便提前配好。
34. 作为用户，我想删除一个 provider 时它的提及智能体默认值随之清掉，以便配置里不残留孤儿项。
35. 作为用户，我想时间线里当前智能体派出的子智能体合成一个派发组，组头写"派出 N 个子智能体"和按状态分段的计数，以便一眼看出整体进度。
36. 作为用户，我想派发组的每行显示 provider 图标、标题、provider · 模型 · 模式、运行时长和状态，以便区分各个子智能体。
37. 作为用户，我想行上的状态和时长实时更新，以便不用点进去也知道谁还在跑。
38. 作为用户，我想点击一行就打开对应的子会话（桌面按"在侧栏打开"偏好，手机整页），以便查看或接管它。
39. 作为用户，我想 `create_agent` 还在执行时就看到一行"启动中"，以便知道派发已经开始。
40. 作为用户，我想子智能体被归档（或父智能体被归档）后，行仍显示最终状态并标"已归档"，以便回看历史时关联不丢。
41. 作为用户，我想子智能体被脱离后，行显示"已分离"，点开是普通根智能体，以便知道它已不受父智能体管理。
42. 作为用户，我想取消当前轮次后已派出的子智能体继续运行、行照常更新，以便取消回复不会误杀子任务。
43. 作为用户，我想不是由 Agent mention 触发、而是当前智能体自己决定调用的 `create_agent` 也显示为派发组，以便所有子智能体都看得见。
44. 作为用户，我想 Claude、Codex、OpenCode、OMP 自己的子智能体也以同样的行形态出现在时间线里，点开是只读面板，以便统一查看各种子智能体。
45. 作为用户，我想子智能体等待批准时，派发组的行显示"等待批准 · 工具名"、组头计数里出现"等待批准"，以便马上看出谁卡住了。
46. 作为用户，我想 Subagents track 的行在子智能体等待批准时显示等待批准的状态，以便在 track 里也能发现。
47. 作为用户，我想子智能体等待批准时，工作区在侧边栏上显示"需要批准"，以便不看这个工作区也能注意到。
48. 作为用户，我想子智能体请求权限时收到推送或系统通知，点开直达该子会话，以便及时批准。
49. 作为用户，我想子智能体完成或出错时不单独推送，由当前智能体汇总告诉我，以便不被重复打扰。
50. 作为用户，我想在 provider 子智能体的只读面板里看到并批准它的权限请求，以便不用回到父面板翻找。
51. 作为用户，我想当前智能体收到的子智能体权限通知写明"用户会在子会话里批准，不要代批"，以便它不会绕过我替子智能体批准。
52. 作为希望父智能体自主编排的用户，我想在明确授权后父智能体仍能用 `respond_to_permission` 代批，以便现有的自主编排用法不受影响。
53. 作为子智能体里的用户，我想在子智能体里也能 @ 智能体，以便分工可以继续向下拆。
54. 作为使用官方 Paseo App 或老客户端的用户，我想手打的 Agent mention 链接同样触发派发，以便各客户端行为一致。
55. 作为拿不到 tool call id 的父会话用户（如 Copilot/ACP 类），我想时间线退回通用工具卡而不是显示错误的关联，以便不被误导。

## Implementation Decisions

### 链接格式与共用解析器（protocol）

- Agent mention 写在正文里：`[@名字](paseo://agent/provider/<providerId>)` 与 `[@名字](paseo://agent/profile/<profileId>)`，`<id>` 经 `encodeURIComponent` 编码，不加版本段，kind 段就是扩展位。provider id 满足 `^[a-z][a-z0-9-]*$`，profile id 是任意字符串。格式写进历史后不再改。
- 把 agent 链接的序列化、解析（前缀、编码、两种 kind）和整条链接的匹配规则（Markdown 链接模式、排除 `![` 与 `\[`）从 app 的行内块模块抽到 `packages/protocol/src/message-links.ts`，app 行内块模块与 daemon 共用：`findMarkdownLinks`（所有链接，含位置与去转义后的 label/target）、`formatMarkdownLink`、`parseAgentMentionLink` / `formatAgentMentionLink`、`parseAgentMentionHref` / `formatAgentMentionHref`、`isAgentMentionTarget`。解析时 provider id 须满足 `provider-config.ts` 的 `PROVIDER_ID_PATTERN`，profile id 非空且解码后不含 `/`；不满足的链接保持文字。app 的块类型从单个 `target` 改为 `target: { kind: "provider" | "profile"; id }`。旧的单段写法 `paseo://agent/<id>` 从未发版，不做兼容。
- 显示成块的链接就触发派发，包括代码块里的链接，与 app 解析器的行为一致。
- 旧气泡显示发送时的 label，不随 provider 或 profile 改名更新。块图标：provider 用 provider 图标；profile 用它的 `icon`，认不出时用该 provider 的图标，profile 已删除（或 daemon 配置还没到）时退回 `Bot`。

### 触发来源与 Routing block（server session 层）

- 只有客户端发来的用户消息会触发：`send_agent_message_request`（包括 steer 与 app 端排队出队后的发送），以及 `create_agent_request`、`agent.create.request`、`workspace.create.request` 的首条消息。MCP 的 `send_agent_prompt` 和 `create_agent`、schedule、完成通知等系统注入的消息都不触发，避免父智能体转发原文时连锁派发。不区分是哪种客户端发来的。
- 由 session 的处理函数负责：解析 mention、读 provider 快照、解析各 mention 的确定值、生成 Routing block 内容。生成函数作为运行选项 `resolveRoutingBlock` 传给 `startAgentRun`，`startAgentRun` 先按原文做带外命令判定，之后才调用它并追加 Routing block，带外命令因此不等快照：数组 prompt 追加一个独立的末尾文本块，字符串 prompt 追加 `\n\n` 加块。代码在 `packages/server/src/server/agent/routing-block.ts`。
- 整个会话不能派发时（快照可派发字段为 false）不附 Routing block，原文照发。
- 单个目标不可用（provider 未启用或不可用、profile 已删除、profile 的 provider 不可用）时照常发送，在块里对该 mention 写明无法启动的原因并要求告诉用户，不给 provider 和 settings，其余 mention 照常。
- Routing block 文本以原型 v2 定稿（节选自 `prototype/routing-prompt-v2.md`，链接形式已按新格式更新，并补上不可用行）：

```text
<paseo-system>
The user's message above mentions agents as links of the form [@Name](paseo://agent/...). Each mention asks you to start a new subagent for the part of the message it refers to. Start them now, before any other work:

1. {{label}} -> provider "{{provider}}/{{model}}", settings {{settingsJson}}
2. {{label}} -> cannot start: {{reason}}. Tell the user.

Rules:
- Call `create_agent` exactly once per numbered mention that can start, in the order listed. Two mentions of the same agent mean two separate subagents.
- Pass `provider` and `settings` exactly as listed. Do not change the model, mode, or thinking option. Do not call `list_providers`, `list_models`, or `inspect_provider` first; the values are already resolved.
- Do not do a mentioned part yourself, and do not hand it to your own subagent, task, or delegation tools, skills, or CLIs. Only `create_agent` counts.
- The subagent cannot see this conversation. Write `initialPrompt` so it stands alone: the goal, the relevant files and context, constraints, and what to report back.
- Keep `notifyOnFinish` at its default. You will be notified as each subagent finishes; then combine the results for the user.
- If a subagent asks for permission, the user approves it in that subagent's session. Do not answer it with `respond_to_permission`.
- Do any part of the message addressed to you (not to a mention) yourself, after the subagents are started.
</paseo-system>
```

- 某项确定值取不到时不写进块：`provider` 只写 id，`settings` 里省略该键。provider 快照状态为 `loading` 或 `error`（目录没取到）时照样派发，Mention defaults 配置了的项原样写入，没配的项不写（都没配就是只写 provider id、`settings` 为 `{}`）；只有未注册、已停用、`unavailable` 才算"无法启动"。这与 `validateAgentConfiguration` 把 `error` 算作不可用的口径不同，是有意的：目录读不到不等于 provider 用不了。
- 实测结果：Claude、Codex、Pi 共 18 次派发全部正确，v1 不按父 provider 置灰。

### Mention defaults 的存储与解析

- daemon 配置 `providers.<id>.mentionDefaults: { model?, thinkingOptionId?, modeId? }`，三项都可选，缺省就是"默认"；读写沿用 `get_daemon_config` / `set_daemon_config`，不加新 RPC，支持热重载；删除 provider 时一并清除。patch 时整个 `mentionDefaults` 对象替换而不是深合并，省略某项即恢复默认；保存时不校验。
- 解析顺序：Agent profile 写了的字段 → 该 provider 的 Mention defaults → 运行时默认，逐字段取第一个仍然有效的层：profile 的值在目录里失效时先退到 Mention defaults，再退到运行时默认；某层写的模型已失效时，该层的档位一起作废（票 09 与用户确认）。profile 的 `featureValues` 非空时原样放进 `settings.features`，不校验。卡片不列 Agent profile，也不支持 feature。
- `@` 列表不列 id 写不成链接的 profile（空或含 `/`，只会出自手改配置）；profile 行的图标规则与块相同，认不出时画所属 provider 的图标，用 profile 的颜色。
- 运行时默认：模型取快照里 `isDefault` 的那个，没有就取第一个；档位取所选模型的 `defaultThinkingOptionId`；模式取 provider 快照的 `defaultModeId`，它不在快照模式列表里（或为空）时取第一个模式，与 app 新建界面一致；不继承父会话模式。选择函数与元数据生成共用。目录就绪时 daemon 总是写出目录里有的明确 `modeId`；provider 完全没有模式时不写。
- 发送时逐项回退，不阻断：模型不在快照目录里 → 默认模型及其默认档位；档位不属于所选模型 → 该模型的默认档位（模型为"默认"时按当时的默认模型校验）；模式不在快照模式列表里 → 运行时默认模式。快照未就绪时等待，受现有刷新超时约束；等待后仍未就绪或出错时配置值原样透传，这时没配 `modeId` 就写不出模式，是"总是写出 `modeId`"的例外（`create_agent` 本身也要等快照就绪）。
- 默认值只作用于 mention 新派出的子智能体，创建后用户仍可在子智能体标签里改。

### 可派发判定与协议字段

- 判定同时满足三层：全局 `mcp.enabled && mcp.injectIntoAgents`；该 provider 的 `paseoTools` 策略允许 `create_agent`；工具确实送进了会话（原生通道看会话绑定的工具目录；MCP 通道看是否注入了内部 paseo 服务器，且会话 `supportsMcpServers`）。OpenCode 必须看会话目录，manifest 不算数。
- 在会话 create、resume、import、reload 时判定一次，运行中改开关不影响已运行的会话，reload 后才生效。
- 原因码按 `mcp_disabled` → `tools_not_injected` → `create_agent_not_allowed` → `tools_not_delivered` 的顺序取第一个；能派发时不带原因码。已知缺口：用配置文件关掉 `mcp.enabled` 时 MCP 通道立即失效，但已运行会话的快照仍为 `true`（app 改不了这个开关，接受）。
- agent 快照顶层新增可选字段 `canCreateAgents: boolean` 和 `createAgentsUnavailableReason: string`，后者是 `z.string()`，不用 enum。v1 的原因码：`mcp_disabled`、`tools_not_injected`、`create_agent_not_allowed`（provider 策略）、`tools_not_delivered`（通道没接通，如 Pi 没装 adapter、generic ACP 不支持 MCP、OpenCode 目录里没有）。app 认不出的原因码用通用文案。
- provider 快照的每个 provider 条目加同名的预测字段，新建界面据此置灰；会话建好后，daemon 按实际判定结果决定附不附 Routing block。预测按全局开关、provider 策略和 client 声明的通道算，开关或策略改动后快照随即重推，不用重新加载。能否接 MCP 要起会话才知道的 provider（Pi，client 声明 `mcpServersDecidedPerSession`）只写开关与策略的原因码，通道不预测、不写字段，按可用处理（2026-09-30 与用户确认，取代原先"OpenCode 偏保守"的说法：OpenCode 走原生通道，可以准确预测）。
- `injectIntoAgents` 保持默认关闭。
- `server_info.features.agentMentions` 控制 `@` 智能体分组、提及智能体默认值卡片和 Routing block；`server_info.features.subagentCallLinks` 控制子智能体关联标签与工具名规范化，缺失时退回通用工具卡。两个开关分开。
- 所有新字段都是可选的，wire schema 不加 transform；不加新权限（发 prompt 属于 `workspace.write`，mention 不扩大调用方的能力）。

### 时间线存储、剥离与标题

- 时间线记发送前的原文：附加了 Routing block 时，原文经 `AgentRunOptions.submittedPrompt` 带到 `recordSubmittedPrompt`，对账按 `clientMessageId`，不比对文本。没附块的消息（包括用户自己写的、恰好以 `<paseo-system>` 块结尾的消息）实时记录时原样保留，不剥。已知代价：force hydrate、prime 与导入从 provider 历史重建时按形状剥，用户自己写在末尾的这种块会在重建后消失；历史里分不清是谁写的，接受。Routing block 只出现在发给 provider 的那份里。
- 新增"剥掉用户消息末尾 `<paseo-system>…</paseo-system>` 块"的函数 `stripTrailingRoutingBlock`（`agent/trailing-routing-block.ts`），按形状剥离、不看内容、不带版本，与现有的整条信封判定并列。只用在 provider 来源的文本：实时回显（含找不到对账记录的带 `clientMessageId` 回显）、force hydrate、prime、历史导入，以及导入选择器的标题与首条、末条 prompt 预览。它要求结尾的闭合标签，只能作用在原文上：折叠空白并截断预览的 provider（Claude、ACP、OMP、Pi）在各自的预览规范化函数里先剥再折叠；直接给原文的（Codex 的 thread preview）在投影层剥。
- 取会话标题时，把所有 Markdown 链接换成 label（agent → `@Claude`，文件 → `index.ts`，普通链接 → 链接文字）。这发生在共用的首行标题推导里，所以工作区的临时标题（自动命名结果出来之前显示的那个）同样换成 label。工作区自动命名与分支名生成的输入（`firstAgentContext.prompt`）保持原文。

### 子智能体关联（server adapter）

- daemon 读出 provider 侧的 tool call id，经工具执行上下文传给 `create_agent`，作为 daemon 自有的子智能体标签 `paseo.parent-tool-call-id` 写入，覆盖模型传入的同名键。来源：Claude `_meta["claudecode/toolUseId"]`、Codex `_meta.callId`、Pi `_meta["pi-mcp-adapter/toolCallId"]`、OpenCode 插件的 `context.callID`、OMP `toolCallId`。拿不到 id 就不写标签，不从工具结果里补。
  - 只在工具创建路径（MCP、OpenCode bridge、OMP host tool）剥掉模型传入的同名键；WebSocket 会话创建路径不剥，app e2e 靠它按标签种入子智能体。只有存在父智能体时才写，旧式 detached 创建不写。脱离（detach）保留这个标签。
- OpenCode、Pi、OMP 的 adapter 往时间线写条目时，统一把工具名规范成 `paseo.create_agent`、入参平铺（Pi 要拆掉 `{tool, args}` 这层）。app 只认标准写法。只改 `create_agent`，其他 Paseo 工具保持原名。Pi 没有指明 `paseo` 服务器的调用（代理里不带 `server` 的裸 `create_agent`、`toolPrefix: "none"` 的直连工具）不改名，退回通用工具卡。
- 各 adapter 在 provider 子智能体的权限请求 `metadata` 里补上子智能体 id：Codex 用 `threadId`，Claude 用 SDK 的 `agentID`，OpenCode 用 `sessionID`。OMP 没有来源，v1 不归属。不扩展 provider 子智能体描述符的 status。

### 子智能体权限的通知与提醒（server）

- 完成通知里的 needs permission 段全局改写为：用户会在子智能体的会话里批准，不要用 `respond_to_permission` 回应，除非用户明确让你管理这个子智能体的权限。`<permission-request>` 载荷照常附上。对所有 `notifyOnFinish` 的 `create_agent` 与 `send_agent_prompt` 生效，不区分是否由 mention 触发。
- attention 广播对带父标签的智能体，只放行 `permission` 原因（推送与系统通知，焦点目标是子智能体本身，沿用现有通知计划的压制规则），`finished` 与 `error` 仍然跳过。
- 同工作区的子智能体有待批准权限时，给祖先所在的工作区贡献"需要批准"档；`error` 与 attention 仍只留在 track。"需要批准"就是现有的 `needs_input` 桶，沿用它的 UI 文案（侧边栏状态点、track pill 的"1 needs input / 1 个需要输入"），不新增文案。实现为 `workspace-directory.ts` 的 `deriveSameWorkspaceDescendantBucket`：复用 `deriveAgentStateBucket` 并把 `requiresAttention` 置 false，只收 `needs_input` 与 `running`。
- 通知正文定稿（英文，原样发给父智能体）："The user will approve this in the subagent's session. Do not answer it with `respond_to_permission` unless the user explicitly asked you to manage this subagent's permissions."
- provider 子智能体的权限仍挂在父 agent 上，推送跳父会话，不做到只读面板的深链。

### `@` 列表智能体分组（app）

- `@` 列表智能体分组在上、文件在下，输入后两组同时过滤。provider 按 Providers 设置的顺序排列，Agent profile 排在后面；只列已启用的 provider，以及 provider 已启用的 profile。profile 行显示它的名字、图标和颜色，副文字写所属 provider。过滤匹配 provider 显示名、provider id、profile 名。
- 选中后，输入框（Web/Electron）插入 Agent mention 块；原生端插入链接文字（与 File mention 一致）。
- 置灰时整组条目仍可见但不可选，组顶显示一行原因说明：`tools_not_injected` → "当前智能体未启用 Osuna tools"，附去设置 → Host → Agents 开启的入口，并说明开启后需要重新加载当前智能体（新建界面改为只说"在设置 → Host → Agents 中开启"：预测随开关即时更新，没有要重新加载的智能体）；`mcp_disabled` → Host 已关闭 MCP；`create_agent_not_allowed` → 当前 provider 的 Osuna tools 策略未允许 `create_agent`；`tools_not_delivered` → 当前智能体无法调用 Osuna tools；认不出的原因码 → 当前智能体无法派发子智能体。老 Host（没有 `agentMentions`）整组置灰，提示更新 Host。新建界面按 provider 快照的预测字段置灰。
- 智能体分组出现在已加载会话的输入框里，以及新建界面（新建智能体标签、新建工作区、工作区设置对话框）的输入框里；新建界面按所选 provider 在该 cwd 的 provider 快照里的预测字段判定，没有预测字段时按可用处理。已收到 `agentMentions` 但会话快照没带 `canCreateAgents`（未加载的存档智能体、本地缓存）时按可用处理，发送会恢复会话，由 daemon 判定。
- 置灰组连同原因说明排在文件上面，列表放不下时打开后停在顶部，原因说明优先于第一个可选文件露出；按方向键后照常跟随高亮。只剩置灰行时 Enter 照常发送，与空列表一致。
- 所有新增文案补齐九种语言。

### 提及智能体默认值卡片（app）

- Agents 页的"Agents"区块之后，单独一个 section「提及智能体默认值」，说明放在标题的 info 提示里。每个已启用的 provider 一行：图标、名称，下面一行摘要（全未设时写"全部使用默认"，含失效值时摘要用警示色并带 ⚠）。展开后是模型、思考、模式三条标准设置行，控件用下拉；有覆盖时底部出现 ghost 按钮"全部恢复默认"。可以同时展开多行；手机与桌面同一结构。
- 即时保存，每次选择就写入该 provider 的 `mentionDefaults`。
- 下拉首项"默认（X）"用于清除覆盖，X 是此刻解析出的值；思考档位的默认项随当前生效的模型变化。
- 换模型后，已选档位不属于新模型 → 自动清回默认，并短暂提示"思考档位已随模型改回默认（X）"；新模型没有思考档位 → 思考下拉显示"不支持"并置灰，同时清掉已存的档位。provider 没有模式时，模式下拉同样处理。
- 失效值：触发器照样显示已存的原值，前面加 ⚠、描边用警示色；该行下写"<值> 不可用，将使用默认（X）"；打开下拉时原值排在最前，标"（不可用）"。
- 快照加载中 → 下拉置灰带小转圈，摘要写"加载模型列表..."；出错 → 下拉置灰、显示原值，另起红色一行写"无法读取模型列表，发送时原样使用已保存的值"。
- Osuna tools 关闭时卡片照常可编辑，顶部提示"Osuna tools 已关闭，@ 提及智能体暂不可用。这里的设置在开启后生效"。老 Host 只显示一行"更新 Host 后可以设置提及智能体默认值"。
- 有意保留"默认（X）"虚拟项，与 Agent profile 表单删掉"Provider default"的做法不同。
- 快照 `unavailable` 的 provider 照样列出，摘要写"Provider 不可用"，下拉置灰。保存进行中该 provider 的三条下拉置灰；失败时在该行底部显示"保存失败：<原因>"和"重试"，原因经 `extractFailureReason` 去掉 `requestType=` / `code=` 后缀。
- 展开指示用 `ChevronDown`，展开时转 180°；`ChevronRight` 在设计规范里表示跳转。卡片的显示与回退规则在 `packages/app/src/screens/settings/mention-defaults-model.ts`，与 daemon 的 `resolveAgainstCatalog` 同规则。

### 时间线派发组（app）

- 同一段助手输出里连续的子智能体调用（`paseo.create_agent` 且产出 Subagent，或 provider 子智能体调用）合成一个派发组；中间插进正文或其他工具调用就断开，另起一组。单个调用也是一个组，只有一行。组头写"派出 N 个子智能体"，后面按 track 的桶顺序分段计数（等待批准 / 失败 / 运行中 / 启动中 / 已完成），可以折叠。组头的 `needs_input` 段写"等待批准"，不沿用 pill 的"需要输入"：派发组的行只会因为权限请求进这个桶。两种工具调用细节级别下都合组；detailed 下其余调用照旧一条一行。
- 每行：provider 图标、标题（Paseo 子智能体取 `create_agent` 的 title，provider 子智能体取 description）、副行（provider · 模型 · 模式；provider 子智能体用描述符的 subtitle；等待批准时换成"等待批准 · 工具名"）、运行时长（运行中实时走，结束后定格）、状态标记。行数据与 Subagents track 同源；组和 track 的内容会重复，这一点接受。不显示子智能体的最后一条消息，不放批准按钮。
- 时长：从子智能体创建起算，完成后被再次唤醒时也算上中间的空闲。快照里没有结束时间，停下后按"最后一次更新 − 创建"近似；归档会把最后一次更新改成归档时刻，所以已归档的行不显示时长，行尾留空，最终状态看图标上的标记和副行的"已归档"。完成后再脱离或改名会让时长略偏大，这一点接受。
- 点击一行即打开，复用 track 的打开处理：Paseo 子智能体打开普通 agent 标签，provider 子智能体打开 `provider_subagent` 只读标签。派发组的行不再展开 provider 子智能体的活动日志，完整时间线在只读面板里。
- 关联：Paseo 子智能体按 `paseo.parent-tool-call-id` 标签，在 store 里找 callId 对得上、且父标签是本父智能体或已被脱离清空的智能体，不按 `parentAgentId` 找，这样脱离后也能找到。脱离会清掉父标签，所以已脱离的只能靠 callId 对；tool call id 由 provider 随机生成，不会撞到别的会话。代价是导入的会话会关联到原会话里已脱离的子智能体，这一点接受。provider 子智能体按父 agentId 加描述符的 `toolCallId` 找，app 要保留描述符上已有的 `toolCallId`。
- 过渡态：调用还在执行、store 里还没有这个子智能体时，用入参里的 provider 和 title 画一行"启动中"，不可点（降到半透明）。app 事先不知道 provider 有没有给 tool call id，所以拿不到 id 的调用执行中也先画"启动中"，调用结束、按标签查不到后才退回通用卡；打开历史会话时，已完成但还在按标签查询的调用同样先画"启动中"。调用完成后仍未命中，就按标签调一次 `fetch_agents` 并带上 `includeArchived`；查到已归档的，显示最终状态加"已归档"；还查不到就退回通用工具卡。
- 已脱离的子智能体，行上显示"已分离"（与 track 的"分离"同一个词，术语表不许同义词）。
- 退回通用工具卡的情况：拿不到 tool call id、老 Host（没有 `subagentCallLinks`）、导入的会话、不带 workspaceId 的顶层 `create_agent`（它不是 Subagent，也不进 track）。

### Subagents track 与只读面板（app）

- Paseo 子智能体行把待批准计数交给状态分桶，出现"等待批准"桶；`requiresAttention` 保持 false，不复活"已完成=待查看"。"等待批准"桶即 `needs_input`，pill 与行图标沿用它的现有文案与角标。`PaseoSubagentRow` 带 `pendingPermissionCount`；provider 行暂按 0 计，归属后由票 13 接上。行图标的需要输入角标带无障碍标签 `Agent needs input`（与 `Agent running` 同一写法），e2e 按它断言行状态。
- provider 子智能体行从父 agent 的待批准权限里，按 `metadata` 中的子智能体 id 计数。
- provider 子智能体只读面板：从父 agent 的待批准权限里取出归属本子智能体的项，显示权限卡并允许批准，回应仍走父 agentId。批准不算"写入会话"，与只读语义不冲突；面板仍然没有输入框。

### 文档

- `docs/agent-lifecycle.md`：改写完成通知中"调用方可以回应权限"的描述，以及 Workspace activity 一节（同工作区子智能体的待批准会冒到工作区状态）；修正过期内容（OMP 已不是 `child_session`；provider 子智能体清单补上 OMP；track 显示等待批准）；说明派发组与 `paseo.parent-tool-call-id`。
- `docs/providers.md`：新 provider 要提供 tool call id、规范化的 `paseo.create_agent` 工具名、权限 `metadata` 中的子智能体 id。
- `docs/glossary.md`：**Agent mention**、**Mention defaults**、**Routing block** 已写好；实现落地后补上 Code 指向。**派发组**只是 UI 形态，不进术语表。

## Testing Decisions

好的测试只看外部行为：给定用户消息、配置与快照，provider 收到了什么、快照和事件里出现了什么、界面显示什么、点了之后到哪里；不断言内部函数调用或组件 state。

- **接缝 1 · 进程内 daemon 集成测试（主测试层）**：进程内 daemon 夹具（`docs/ad-hoc-daemon-testing.md`）+ `DaemonClient` + `createTestAgentClients`。假 provider 开启 `supportsMcpServers`，用 `onStartTurn` 抓取 provider 收到的 prompt。测试扮演父智能体，带 `_meta` tool call id 调 `/mcp/agents?callerAgentId=<父>`，做法参照 `agent-mcp.e2e.test.ts`。覆盖：
  - Routing block：顺序、同 provider 多次、Mention defaults 解析与逐项回退、Agent profile 叠加、目标不可用时写原因、会话不能派发时不附、快照出错时原样透传；
  - 触发来源：steer、排队、新建首条会触发，MCP `send_agent_prompt`、schedule 不触发；带外命令仍按原文识别；
  - 时间线记原文，没附块的消息原样记录；标题里的链接换成 label；
  - 回显、hydrate、prime、导入与导入预览的剥离放在 `AgentManager` 单测（脚本化 session 的 `streamHistory`）与 provider 描述符、投影单测里，不进进程内 daemon 测试：假 provider 不往历史里写 `user_message`，为此改它会波及所有 daemon 测试；
  - 快照的 `canCreateAgents` 与原因码（全局未注入、MCP 关闭、策略未允许、通道没接通）、provider 快照的预测字段、`server_info.features` 的两个开关；
  - `create_agent` 带 tool call id 时子智能体得到 `paseo.parent-tool-call-id`，模型传入的同名键被覆盖；不带 id 时没有这个标签；
  - 子智能体请求权限：父智能体收到新的通知正文与载荷；客户端收到子智能体的 `agent_attention_required`，`finished`/`error` 仍然没有；工作区状态显示"需要批准"；
  - `mentionDefaults` 经 `set_daemon_config` 读写，删 provider 时清除。
  - 现有参照：`agent-mcp.e2e.test.ts`、`agent-prompt.test.ts`（完成通知与权限周期）、`daemon-e2e/` 下的 e2e、`agent-attention-policy.test.ts`、`workspace-same-cwd-isolation.e2e.test.ts`。
- **接缝 2 · 纯函数单元测试**：共用 agent 链接解析器（两种 kind、编码、含 `/` 的 id、排除 `![` 与 `\[`、序列化后再解析得到原结构）、剥末尾 `<paseo-system>` 块、标题链接换 label。参照 app 行内块模块现有的单测。
- **接缝 3 · 各 adapter 单元测试**（放进现有测试文件，不新开套件）：取 tool call id（Claude、Codex、Pi 的 `_meta`，OpenCode bridge 的 `context.callID`，OMP 的 `toolCallId`）；工具名规范成 `paseo.create_agent`，包括拆 Pi 的 `{tool, args}`；权限 `metadata` 补子智能体 id（Codex `threadId`、Claude `agentID`、OpenCode `sessionID`）。参照 `mcp-server.test.ts`、`opencode-bridge-adapter.test.ts`、`tool-name-normalization.test.ts`、OpenCode event translator 的测试、`permission-response.test.ts`。
- **接缝 4 · app Playwright 浏览器端到端 + 真实 daemon + `mock` provider**：`mock` provider 新增两个能力，一是声明 `supportsMcpServers`，二是一个脚本化 prompt，往时间线写一条带 callId 的 `paseo.create_agent` 工具调用；子智能体用 `seedParentWithSubagent` 按标签种入。覆盖：
  - `@` 智能体分组的排序、过滤、插入块、发送文本、各原因码的置灰文案与开启入口、老 Host 提示；
  - 提及智能体默认值卡片：即时保存（刷新后仍在）、思考档位联动与提示、失效值显示、全部恢复默认、Osuna tools 关闭提示；保存失败时界面上能看到可重试的错误。卡片的 e2e 不用 `mock`：daemon 拒绝保存 `providers.mock.*`（dev provider 不是内置 id，只放宽 `ProviderOverridesSchema` 会让生产 daemon 建 registry 时抛错），改用自定义 ACP provider（`e2e/support/fixtures/thinking-modes-acp.cjs`）。ACP 的模型共用一组档位，"换到没有档位的模型 → 不支持"只由 `mention-defaults-model.test.ts` 覆盖；
  - 派发组：组头计数、行状态实时变化、等待批准、点开去向、启动中、已归档、已分离、退回通用卡；
  - track 行的等待批准。
  - 参照：`composer-inline-blocks.spec.ts`、`composer-autocomplete.spec.ts`、`subagent-detach.spec.ts`、`archive-finished-subagents.spec.ts`、`agent-profiles-settings.spec.ts`、`creation-old-daemon.spec.ts`。
  - 纯选择逻辑（track 行待批准计数、派发组关联与切段）补进现有的 `subagents/select.test.ts`、`track-presentation.test.ts`；按连续调用成组的逻辑属于工具调用分组，测试在 `tool-calls/detail-level/projection.test.ts`。
- 真实 provider 的 `.real.e2e` 不作为验收，只在本地选跑（Claude、Codex 的派发与 tool call id 抓取）。原生端没有模拟环境，按惯例免验收。
- 手动 QA 按 `docs/qa.md`，在 Electron 上截图留证：`@` 分组（可用、置灰）、设置卡（浅色、深色）、派发组（运行中、等待批准、已完成）。

## Acceptance Criteria

- [ ] Web 与 Electron 的 `@` 列表中，智能体分组排在文件上方，只列已启用的 provider 和 provider 已启用的 Agent profile，两组同时过滤；选中后插入 Agent mention 块，发出的文本符合 `paseo://agent/provider/<id>` / `paseo://agent/profile/<id>` 格式。
- [ ] agent 链接的解析与序列化只有 `packages/protocol` 里一份，app 与 daemon 共用。
- [ ] 客户端发来的用户消息（普通发送、steer、排队出队、三种新建请求的首条消息）带 Agent mention 时，provider 收到的消息末尾有 Routing block，内容按 mention 顺序列出解析好的 provider、模型、settings，或写明无法启动的原因；MCP、schedule、通知注入的消息不触发。
- [ ] Mention defaults 按"profile → Mention defaults → 运行时默认"逐字段叠加；失效值发送时逐项回退，不阻断；模式不继承父会话。
- [ ] 会话不能派发时不附 Routing block；快照带 `canCreateAgents` 与原因码，provider 快照带预测字段；`server_info.features` 有 `agentMentions` 与 `subagentCallLinks`。
- [ ] 时间线、气泡、刷新、hydrate、导入与导入预览都不显示 Routing block；会话标题里的链接显示为 label。
- [ ] `@` 智能体分组按原因码置灰并显示对应文案与开启入口；新建界面按预测字段置灰；老 Host 提示更新。
- [ ] 设置 → Host → Agents 的「提及智能体默认值」卡片：即时保存、"默认（X）"首项、思考档位联动、"不支持"置灰、失效值显示、加载与出错状态、全部恢复默认、Osuna tools 关闭提示、老 Host 提示，都与 06 号票原型一致；删除 provider 时清掉它的配置。
- [ ] 带 tool call id 的 `create_agent` 产出的子智能体带 `paseo.parent-tool-call-id`（覆盖模型传入的值）；OpenCode、Pi、OMP 的时间线工具名统一为 `paseo.create_agent`，入参平铺。
- [ ] 时间线派发组：连续调用合组、组头分段计数、行实时状态与时长、点开去向、启动中、已归档、已分离、各种退回通用卡的情况都与 07 号票原型一致；Claude、Codex、OpenCode、OMP 的 provider 子智能体按同样的行形态显示。
- [ ] 子智能体等待批准时：派发组的行与组头、Subagents track、工作区状态都显示等待批准；推送指向子会话；`finished`/`error` 不推送。
- [ ] 父智能体收到的权限通知正文改为"用户在子会话批准，除非明确授权否则勿代批"，载荷照附。
- [ ] provider 子智能体的权限（Codex、Claude、OpenCode）能在只读面板里看到并批准；OMP 不归属。
- [ ] 所有新文案九种语言齐全；`docs/agent-lifecycle.md`、`docs/providers.md` 已按"文档"一节更新。
- [ ] 四层测试通过，QA 截图附在交付说明里；`npm run typecheck`、`npm run lint` 通过。
- [ ] 原生端插入链接文字、气泡显示块，无崩溃。（没有原生端模拟环境，只有单测覆盖，按惯例免实机验收）

## Out of Scope

- @ 已在运行的智能体。
- 兄弟子智能体之间互通、专门的评审机制。
- 追踪父智能体是否照 Routing block 做（没派发或改用原生子智能体），以及 daemon 拦截代批。
- Pi 的实时子时间线；Grok 作为一等 provider。
- 子智能体开 worktree（与父共用 workspace 和 cwd）。
- 不带 workspaceId 的顶层 `create_agent` 渲染为子智能体卡片。
- 派发组显示子智能体的最后一条消息，或在组里直接批准。
- provider 子智能体权限推送深链到只读面板；OMP provider 子智能体的权限归属。
- 导入会话的派发组关联（导入会换新的父 id）。
- 提及智能体默认值里的 feature 设置；卡片里列出或覆盖 Agent profile。
- 子智能体调用深度上限。
- 原生端输入框显示块。

## Further Notes

- `injectIntoAgents` 默认关闭，新装用户的智能体分组默认置灰，所以置灰提示里的开启入口是必经路径。
- 仍存疑、实现时要核实的点：Claude Code 从哪个版本开始带 `toolUseId`；OpenCode 的 `context.callID` 没有文档；Pi adapter 3.0 起才带 id；Claude 的 `agentID` 与 task id 是否同值；Codex 子线程审批与 OMP UI 请求是否真实发生。拿不到 id 时一律退回通用卡。
- Pi 派发前固定多出 4 次 adapter 代理调用，这是 adapter 的行为，不处理。
- 01 号票的附带发现（不在本任务范围）：Paseo 快照标注的 Pi 默认模型与 Pi 自身设置的默认值不一致；Claude Code 首连 Paseo MCP 时协议版本被拒后回退，每次在日志里报 error。
- 官方 Paseo 手机 App 连 Osuna daemon 时，气泡显示链接原文。
