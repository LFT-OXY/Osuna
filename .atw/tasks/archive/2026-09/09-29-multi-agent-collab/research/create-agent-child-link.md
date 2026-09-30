# `create_agent` 工具调用 ↔ 子智能体的关联手段

调研日期 2026-09-29。对应票 `map-issues/02-create-agent-call-to-child-link.md`。
本机版本：Claude Code 2.1.280、codex-cli 0.156.1、opencode 1.15.10、omp 18.1.18、pi-mcp-adapter 3.0.0、`@modelcontextprotocol/sdk` 1.29.0（`packages/server/package.json:81`）。
没有改产品代码，没有重启 daemon。上游证据来自本机二进制里的字符串（`strings`）、本机安装的包源码，以及 GitHub 上对应 tag 的源码。

## 结论

- 五个 provider 在执行 Paseo 工具时都能拿到 provider 侧的 tool call id，而且这个 id 就是父时间线里该条目的 `callId`。Claude、Codex、Pi 通过 MCP `tools/call` 的 `params._meta` 传过来；OpenCode 和 OMP 不走 MCP，id 出现在它们各自的原生工具调用上下文里。
- daemon 现在把这些 id 全部丢掉了：MCP 服务端只转发了 `signal`，OpenCode 插件没有转发 `context.callID`，OMP 路由忽略了 `request.toolCallId`。
- **推荐方案 (1)**：daemon 把 callId 作为 daemon 自有标签写到子智能体上，app 用 (父智能体, callId) 做关联。不需要改协议 schema，重载后仍然成立，而且子智能体一创建就能关联上，不必等工具结果回来。
- 方案 (2)（解析工具结果）可作为 daemon 内部的补位手段，用在拿不到 id 的调用上。方案 (3)（启发式匹配）不采用。

## 1. daemon 侧现状：id 在哪里被丢掉

| 路径 | 使用该路径的 provider | 现状 |
| --- | --- | --- |
| MCP HTTP `/mcp/agents?callerAgentId=…`（`runtime-mcp-config.ts:46-56`，路由挂在 `bootstrap.ts:1470-1591`，无状态模式，每个请求新建 server 和 transport） | Claude、Codex、Pi（以及 ACP 类 provider） | `mcp-server.ts:44-47` 的处理函数能拿到 `RequestHandlerExtra`，但只转发了 `{ signal }` |
| OpenCode bridge 插件（`opencode/bridge-plugin.mjs:31-55` → `bridge.ts:197-220`） | OpenCode（有 bridge 时 `supportsNativePaseoTools`，见 `opencode-agent.ts:1417-1420`；`agent-manager.ts:5218-5227` 会去掉 MCP 注入，改用原生工具目录） | 插件只 POST `args`，用到了 `context.sessionID`，没有带 `context.callID` |
| OMP host tools（`omp/host-tools.ts:186-213`） | OMP（`omp/agent.ts:466`） | `OmpRpcHostToolCallRequestSchema` 已经解析出必填字段 `toolCallId`（`omp/rpc-types.ts:186-194`），但 `executeCall` 没有把它往下传 |

`PaseoToolExecutionContext`（`tools/types.ts:4-7`）只有 `signal` 和 `sendUpdate` 两个字段，`create_agent` 处理函数（`paseo-tools.ts:1406-1535`）也没有 context 参数。这里要补一个可选字段，例如 `providerToolCallId`，再一路传到 `createAgentCommand`。

MCP SDK 本身支持读取：`@modelcontextprotocol/sdk` 1.29.0 的 `RequestHandlerExtra._meta` 取自 `request.params?._meta`（`dist/esm/shared/protocol.js:321`，类型在 `shared/protocol.d.ts:189`）。`RequestMetaSchema` 是 `z.looseObject`（`dist/esm/types.js:45`），自定义 key 会保留下来。

## 2. 各 provider 能提供什么（一手证据）

### Claude Code：`_meta["claudecode/toolUseId"]`

- 在 Claude Code 2.1.280 二进制里，MCP 工具的 `call()` 先构造 `{...mcpRequestMeta, "claudecode/toolUseId": toolUseId, …}`，然后调用 `client.callTool({name, arguments, _meta})`。`toolUseId` 取自 `ie.toolUseId ?? qi(Ce)`，也就是 `tool_use` 块的 id。复现命令：`strings /opt/homebrew/Caskroom/claude-code@latest/2.1.280/claude | grep 'claudecode/toolUseId'`，能看到常量 `DJr="claudecode/toolUseId"`、构造处 `{"claudecode/toolUseId":j}`，以及 `callTool({name:r,arguments:n,_meta:s},…)`。
- Osuna 把同一个 `tool_use` id 用作时间线 `callId`：运行中条目见 `claude/agent.ts:5198-5215`，结果条目见 `claude/agent.ts:5219-5227`，两处都取 `block.tool_use_id`。
- Osuna 的 Claude provider 调用的是系统里装的 `claude` 二进制（`claude/agent.ts:1494`、`1685`），所以实际行为取决于用户安装的 CC 版本。**哪个版本开始带这个字段没有查到**，已知 2.1.280 有。

### Codex app-server：`_meta.callId`

- 在 `rust-v0.156.1` 的 `codex-rs/core/src/mcp_tool_call.rs` 里，`build_mcp_tool_call_request_meta` 往 request meta 写入 `"callId": call_id`，还有 `x-codex-turn-metadata`、thread/session id 等（该文件 1293-1343 行，调用处在 515-526 行）。<https://github.com/openai/codex/blob/rust-v0.156.1/codex-rs/core/src/mcp_tool_call.rs#L1293-L1343>
- `codex-rs/rmcp-client/src/rmcp_client.rs` 的 `call_tool` 把 meta 放进 `rmcp_params.meta`（新协议会话）或 `PeerRequestOptions.meta`，也就是 `params._meta`（同一 tag 的 806-880 行）。
- app-server 的 `ThreadItem::McpToolCall { id: payload.call_id }`（`codex-rs/app-server-protocol/src/protocol/thread_history.rs:795-796, 853-854`）。Osuna 的 `callId: item.id`（`codex/tool-call-mapper.ts:900-921`）。所以 `_meta.callId` 就等于时间线 `callId`，历史线程也用同一个值。
- 从哪个版本开始有：逐个 tag 查 `"callId"`，`rust-v0.147.0` 没有，`rust-v0.148.0` 开始有（本次用 `gh api …/contents/…?ref=<tag>` 核对）。

### OpenCode：插件上下文里的 `context.callID`（运行时有，类型里没有）

- 插件类型 `@opencode-ai/plugin` 1.15.13 的 `ToolContext` 只声明了 `sessionID/messageID/agent/directory/worktree/abort/metadata/ask`，没有 `callID`（本机 `~/.cache/opencode/packages/oh-my-openagent@latest/node_modules/@opencode-ai/plugin/dist/tool.d.ts:2-24`）。
- 但 opencode 1.15.10 二进制里，会话工具上下文的构造是 `{sessionID, abort, messageID, callID:_.toolCallId, extra, agent, messages, metadata, ask}`，插件工具拿到的是 `{...dA, ask, directory, worktree}`，完整展开了这个上下文。所以插件在运行时**能读到** `context.callID`。复现：`strings …/opencode | grep 'callID:_.toolCallId'`，以及插件包装处 `SA={...dA,ask:…,directory:V.directory,worktree:V.worktree}`。
- 时间线 `callId: part.callID`（`opencode-agent.ts:424-435`），和上面是同一个 `toolCallId`。
- 风险：`callID` 不在公开类型里，属于未文档化的行为，OpenCode 升级时可能改掉。插件读不到时应当按"无 id"处理。
- 另一个可用的通道：插件返回值里的 `metadata`（现在是 `{ paseoTool }`，见 `bridge-plugin.mjs:50-54`）会存进 OpenCode 的 tool part `state.metadata`，Osuna 把它透传到时间线条目的 `metadata`（`opencode/tool-call-mapper.ts:56, 66`）。插件可以把 `agentId` 放进这里，重放历史时也还在。这属于方案 (2) 的变体。

### OMP：`host_tool_call.toolCallId`

- omp 18.1.18 发出的帧是 `{type:"host_tool_call", id, toolCallId, toolName, arguments}`，它自己的校验要求 `typeof e.toolCallId === "string"`（`strings ~/.bun/bin/omp | grep host_tool_call`）。
- Osuna 时间线 `callId: toolCallId`：直播见 `omp/agent.ts:1842-1923, 2093-2108`，历史见 `omp/message-history.ts:203`。
- 结果里 `details = structuredContent`（`omp/host-tools.ts:260-271`），所以 agentId 在 `details` 里可以直接读到。

### Pi（经 pi-mcp-adapter）：`_meta["pi-mcp-adapter/toolCallId"]`

- `pi-mcp-adapter` 3.0.0 定义了 `TOOL_CALL_ID_REQUEST_META_KEY = "pi-mcp-adapter/toolCallId"`（`~/.pi/agent/npm/node_modules/pi-mcp-adapter/utils.ts:345-354`）。直连工具和 `mcp` 代理工具都会带上（`direct-tools.ts:306-329`、`proxy-modes.ts:1613-1636`）。
- CHANGELOG 3.0.0（2026-09-26）写明这是新增项，"Direct tools, the `mcp` tool, and `mcp__<server>` tools send it. `mcpScript` calls do not"（`CHANGELOG.md:31`）。**3.0.0 之前的版本不带这个字段**。
- 时间线 `callId` 用的是 Pi 的 `toolCallId`（`pi/history-mapper.ts:220`），和 meta 里的值相同。
- 顺带发现：3.0.0 不再读 `<agent dir>/mcp.json`，但 `--mcp-config` 仍然可用（`CHANGELOG.md:20`）。Osuna 通过 `mcpConfigPath` 传临时配置（`pi/agent.ts:2658-2671`），应该不受影响，但没有实测。

### 汇总

| provider | 传 id 的通道 | 等于时间线 callId | 版本前提 | 历史重放时 callId 稳定 |
| --- | --- | --- | --- | --- |
| Claude | `_meta["claudecode/toolUseId"]` | 是 | 2.1.280 已验证，最低版本未知 | 是（JSONL 里的 `tool_use.id`） |
| Codex | `_meta.callId` | 是 | ≥ 0.148.0 | 是（`thread_history.rs` 用 `call_id`） |
| OpenCode | 插件 `context.callID`（未文档化） | 是 | 1.15.10 已验证 | 是（`part.callID`） |
| OMP | `host_tool_call.toolCallId` | 是 | 18.1.18 已验证，Osuna schema 要求必填 | 是 |
| Pi | `_meta["pi-mcp-adapter/toolCallId"]` | 是 | adapter ≥ 3.0.0 | 是 |

## 3. 方案比较

### (1) daemon 把 callId 记到子智能体上（推荐）

做法：

1. 在各路径取出 id：MCP 路径在 `mcp-server.ts` 从 `context._meta` 里按 `claudecode/toolUseId`、`callId`、`pi-mcp-adapter/toolCallId` 的顺序读取。OpenCode 插件把 `context.callID` 作为请求头或路径参数带给 bridge。OMP 把 `request.toolCallId` 传下去。然后通过 `PaseoToolExecutionContext.providerToolCallId` 交给 `create_agent`。
2. 写入 daemon 自有标签，例如 `paseo.parent-tool-call-id`。写入位置在 `create-agent/intent.ts:30-36` 和 `PARENT_AGENT_ID_LABEL` 同一处，并且要**覆盖**模型通过 `labels` 参数传进来的同名键，防止被伪造。
3. app 端识别出 `create_agent` 条目后，在 agent store 里找 `parentAgentId === 当前智能体 && labels[key] === item.callId` 的子智能体。app 端的 Agent 已经带 `labels`（`packages/app/src/stores/session-store.ts:101`），Subagents track 也是从同一个 store 取数据（`subagents/select.ts:70-97`），这就满足了"与 track 同源"的要求。

评估：

- **实时**：provider 先把 `tool_use` 流给时间线（运行中条目），然后才发 `tools/call`；子智能体创建时就带着标签，会随 agent 目录流到 app，这时工具调用还在运行，卡片就能挂上子智能体。不用等结果。工具结果丢失时关联依然存在，比如父轮次在调用途中被取消。
- **重载 / daemon 重启**：标签持久化在 agent 记录里；父时间线从 provider 历史重建时，callId 和直播时一致（见上表），所以成立。
- **导入会话（Import）**：导入会生成新的父 agent id，旧子智能体上的 `paseo.parent-agent-id` 对不上，按 (父, callId) 关联会失败。provider 历史里本来就没有 Paseo 子智能体的导入会话，自然也无从关联。v1 可以接受这时退回通用工具卡。若要支持，可以改成只按 callId 关联（各 provider 的 call id 实际上全局唯一），但这没有验证过。
- **协议**：标签是现有的 `Record<string,string>`，不需要改 wire schema。能力开关按功能契约加一个 `server_info.features.*`（名字由 spec 定），app 只在这一处判断。
- **缺口**：拿不到 id 的调用（CC 旧版本、Codex < 0.148、Pi adapter < 3.0.0、ACP 类 provider、OpenCode 以后去掉 `callID`）不会有标签。可以接受退化为通用卡，也可以用方案 (2) 在 daemon 内补位。

### (2) 从工具结果里解析 agentId

- 现状：`create_agent` 返回的 `content: []` 加上 `structuredContent`（`paseo-tools.ts:1515-1532`）。`addModelVisibleStructuredContent` 会把它序列化成"`availableModes_count=N`、`availableModes_ids=…`、空行、JSON"（`paseo-tool-serialization.ts:18-63`）。所以文本**已经包含 agentId**，只是有前缀，app 的 `parseJsonText` 解析会失败（`protocol/src/paseo-tool-call-detail.ts:306-321`）。
- 各 provider 拿到的形态：
  - Codex：`mcpToolCall.result` 保留了 `structuredContent`。
  - Claude：时间线 output 是 `{ output: "<带前缀文本>" }`（`claude/agent.ts:5294-5303`）。
  - OpenCode：插件把 `content` 拼成文本（`bridge-plugin.mjs:97-104`）。
  - OMP：`details` 里有结构化数据。
  - Pi：带前缀的文本（`details` 里是否有结构化数据未验证）。
- 优点：不依赖 provider 版本，五家都有；历史重放时结果随 provider 历史回来，所以成立。
- 缺点：
  - 只有结果到了才能关联。
  - app 要按每个 provider 的 output 形态去解析一段给模型看的文本，把模型可见格式变成了 app 的契约，而且得去掉前缀。
  - 工具名也要全部识别：OpenCode 的 `paseo_create_agent`、OMP 的裸名 `create_agent`（`omp/host-tools.ts:33-45`，`resolveToolCallName` 原样返回，见 `omp/tool-call-detail.ts:291-300`）、Pi 直连工具名，目前 `getPaseoToolLeafName` 都不认（`protocol/src/tool-name-normalization.ts:62-81`）。
  - 结果丢失或父轮次取消时，就关联不上了。
- 更好的用法是放在 daemon 内部做补位：父时间线出现已完成的 `create_agent` 条目、但子智能体没有标签时，daemon 解析自己的输出格式，给子智能体补上标签。这样 app 仍然只有方案 (1) 这一条路径。

### (3) app 按父子关系、创建时间、initialPrompt 匹配

- 同一个 provider 可以被 @ 多次（PRD 已定），prompt 可能相同，有歧义。时间线时间戳归 daemon 所有，重放时 provider 可能带原始时间戳（`docs/architecture.md:377`），和子智能体的 `createdAt` 未必能对上。父智能体也可能不经过 @ 调用 `create_agent`。这个方法不可靠，**不采用**。

### (4) 其它

- **(4a) daemon 反写父时间线条目**：条目上已有可选字段 `tool_call.metadata`（`protocol/src/messages.ts:724-730`），或者给 `sub_agent` detail 加一个可选 `agentId`。问题是时间线条目来自 provider 流，重放时由 daemon 重新生成，每次都得按子智能体标签重新合并，本质上还是 (1)，只是把关联挪到了 daemon 做，改动面更大。另外改成 `sub_agent` detail 会让旧 app 看到的样子从通用 MCP 卡变成日志卡。不推荐作为 v1。
- **(4b) OpenCode 插件在返回的 `metadata` 里写 agentId**：只覆盖 OpenCode，属于 (2) 的变体。

## 4. 实施要点（留给 spec）

- `PaseoToolExecutionContext` 新增 `providerToolCallId?: string`。三条路径各自取值；取值逻辑放在 `mcp-server.ts`、`bridge.ts`、`host-tools.ts` 这几个边界，工具本身不用管是哪个 provider。
- 标签名、能力开关名、app 端识别 `create_agent` 的工具名集合（`mcp__paseo__create_agent`、`paseo.create_agent`、`paseo_create_agent`、OMP 裸名 `create_agent`）由 spec 定。OMP 用裸名判断时要限定 provider，免得和别的工具重名。
- 要决定拿不到 id 的调用怎么办：退化为通用卡，或者由 daemon 用方案 (2) 补标签。

## 仍存疑

- Claude Code 从哪个版本开始带 `claudecode/toolUseId`；Osuna 没有设 CC 的最低版本。
- OpenCode 的 `context.callID` 没进公开类型，以后版本可能变。
- Pi adapter 3.0.0 刚发布（2026-09-26），旧版本不带 id。另外 Pi 直连工具的工具名和结果里的 `details` 结构都没有实测。
- 没有做端到端实测：没有在 dev daemon 上实际抓 `tools/call` 请求体，结论都来自源码和二进制字符串。实施时建议先打开 `mcpDebug`，或用各 provider 的真实 e2e 测试确认一次。
- app store 是否始终包含已归档的子智能体（`archivedAt` 行），会影响卡片在历史里能否显示；本次没有核实。
