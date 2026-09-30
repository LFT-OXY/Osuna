# 会话能否调用 `create_agent`：判定条件、生效时机、快照字段

调研日期 2026-09-29，对应票 `map-issues/04-dispatch-capability.md`。只读源码，未改产品代码。路径相对仓库根，`agent/` 指 `packages/server/src/server/agent/`。

## 结论

一个已加载会话能调用 `create_agent`，当且仅当**该会话启动时**满足：

1. 全局开关：`paseoToolsEnabled` 为真，即 `mcp.enabled && mcp.injectIntoAgents`（`packages/server/src/server/bootstrap.ts:1637-1648`）。
2. 按 provider ID 的策略：`paseoTools.enabled !== false` 且 `disabledTools` 不含 `create_agent`（`agent/paseo-tool-policy.ts:14-29`；目录注册时过滤，`agent/tools/paseo-tools.ts:582-584`）。
3. 交付通道真的接上了：
   - 原生通道（client 声明 `supportsNativePaseoTools`）：`launchContext.paseoTools` 里有 `create_agent`（`agent/agent-manager.ts:5218-5228`）。
   - MCP 通道：provider 启动配置里有 daemon 注入的内部 `paseo` MCP 服务器，并且会话 `capabilities.supportsMcpServers === true`（`agent/runtime-mcp-config.ts:30-58`，`agent/agent-manager.ts:5155-5167`）。

子智能体走同一条路径，按子 provider 的 ID 查策略。每次会话启动（create / resume / import / reload）判定一次就够：运行中改全局开关或策略都不影响已运行会话。唯一例外是用配置文件把 `daemon.mcp.enabled` 关掉：MCP 通道的会话会立即失去工具，原生通道不受影响。

默认值要注意：`daemon.mcp.injectIntoAgents` 未配置时是 **`false`**（`packages/server/src/server/config.ts:546-547`，`public-docs/mcp.md:18`）。`research/osuna-current-state.md` 写的"默认对所有 provider 开启"只对 provider 策略这一层成立（`docs/data-model.md:310-311`），全局开关默认是关的。所以新装用户默认会看到智能体分组置灰。

快照字段建议：在 `AgentSnapshotPayloadSchema` 顶层新增可选布尔字段（例如 `canCreateAgents`），由 daemon 在会话注册时算好。不要复用 `capabilities.supportsMcpServers`，也不建议塞进 `capabilities`。理由见第 3 节。

## 1. 判定条件逐项核对

### 1.1 全局开关

- `AgentManager.paseoToolsEnabled` 字段初值为 `true`（`agent/agent-manager.ts:768`、`822`），由 bootstrap 覆盖：先按 `mcpInjectIntoAgents` 设（`bootstrap.ts:1464`），开始监听后改为 `mcpEnabled && inject`（`bootstrap.ts:1637`），此后由两个配置字段的变更回调维护（`bootstrap.ts:1638-1648`）。
- 为假时 `prepareSessionConfig` 直接把策略写成 `{ enabled: false }`，也不注入 MCP URL（`agent/agent-manager.ts:5155-5167`）。`buildLaunchContext` 也不再构建原生目录（`agent/agent-manager.ts:5218-5228`）。
- 默认值：`config.ts:546-547` 在 CLI 和配置文件都没给值时解析为 `false`。`bootstrap.ts:543` 虽然有 `?? true`，但上游已经给出 `false`，走不到。app 的开关用 `config?.mcp.injectIntoAgents !== false` 渲染（`packages/app/src/screens/settings/host-page.tsx:882`），和 daemon 看到的是同一个值（`MutableDaemonConfigSchema` 里 `mcp.injectIntoAgents` 是必填布尔，`packages/protocol/src/messages.ts:273-277`）。
- `mcp.enabled` 不能从 app 改。patch schema 的 `mcp` 下只有 `injectIntoAgents`（`messages.ts:313`），只能通过配置文件热加载改（`daemon-config-store.ts:173-175` 的 `RELOADABLE_PATHS`）或用 CLI `--no-mcp`（`daemon-worker.ts:108-112`）。

### 1.2 Provider 策略

- `resolvePaseoToolPolicy` 每次调用都读 `daemonConfigStore.get().providers`（`bootstrap.ts:943-944`），用精确 provider ID 查 `agents.providers.<id>.paseoTools`（`paseo-tool-policy.ts:7-12`）。自定义 profile（如 `codex-lead` extends `codex`）按自己的 ID 查，不继承被扩展 provider 的策略（`docs/providers.md:67`）。
- `enabled: false` 使整个目录为空；`disabledTools` 按工具名过滤；`speak` 始终放行（`paseo-tool-policy.ts:14-25`）。
- 过滤在目录注册时进行：`registerTool` 遇到被禁的名字直接 return（`tools/paseo-tools.ts:581-584`），`create_agent` 在 `tools/paseo-tools.ts:1406-1407` 注册。`voiceOnly` 会提前返回、不注册 `create_agent`（`tools/paseo-tools.ts:1204-1206`），但生产代码里没有任何地方把 `voiceOnly` 设为 true（只在 `bootstrap.ts:1453` 透传），可以忽略。
- 会话启动时算出的策略存进 `paseoToolPolicies`（create `agent-manager.ts:1308`、resume `:1420`、import `:1480`、reload `:1604`，关闭时 `:3739` 删除）。MCP 请求按 `callerAgentId` 读这份存档（`bootstrap.ts:1472-1478`、`:1446-1448`）。

### 1.3 交付通道

`buildLaunchContext` 只在 client 声明 `supportsNativePaseoTools` 时构建原生目录（`agent-manager.ts:5218-5228`）。有原生目录时，`resolveProviderLaunchConfig` 会把内部 MCP 服务器剥掉（`agent-manager.ts:5231-5236`），避免工具重复。否则走 MCP：`withRuntimePaseoMcpServer` 注入 `paseo` HTTP 服务器，URL 带 `?callerAgentId=`（`runtime-mcp-config.ts:30-58`）。

两个边界情况：

- 用户自己配了一个叫 `paseo`、但不指向 `/mcp/agents` 的 MCP 服务器时，daemon 不注入（`runtime-mcp-config.ts:44`），这个会话就没有 Paseo 工具。
- `requireExternalMcpSupport` 只检查剥掉内部服务器之后的**用户** MCP 服务器（`agent-manager.ts:3576-3588`）。provider 不支持 MCP 时，daemon 注入的 `paseo` 服务器会被静默忽略，不报错。所以"注入了配置"不等于"工具可用"，还要看会话的 `supportsMcpServers`。

### 1.4 逐 provider 判定表

前提：全局开关已开，且该 provider ID 的策略允许 `create_agent`。

| Provider | 通道 | 证据 | 能否调用 `create_agent` |
| --- | --- | --- | --- |
| Claude | MCP | `providers/claude/agent.ts:321` `supportsMcpServers: true`；`:3329-3330` 把 `mcpServers` 交给 SDK | 能 |
| Codex | MCP | `providers/codex-app-server-agent.ts:219`；`:5182-5187` 写入 `mcp_servers`，thread start 和 resume 都用（`:3906`、`:4062`、`:5154`） | 能 |
| Copilot | MCP（ACP） | `providers/copilot-acp-agent.ts:25-30`；`providers/acp-agent.ts:2707-2709` 在 `supportsMcpServers` 为真时把 HTTP 服务器传给 ACP `session/new` | 能（前提是 Copilot 接受 ACP 的 HTTP MCP 服务器，见"仍存疑"） |
| Cursor / Kimi / Kiro / Trae 等 ACP | MCP（ACP） | 默认 `DEFAULT_ACP_CAPABILITIES.supportsMcpServers: true`（`providers/acp-agent.ts:230-235`）；`provider-registry.ts:804-817` | 能（同上存疑） |
| 自定义 generic ACP | MCP（ACP），可关 | `params.supportsMcpServers` 可覆盖（`providers/generic-acp-agent.ts:21-23`、`:162-166`）；为 false 时 `acpMcpServers()` 返回空（`acp-agent.ts:2708`）。内置目录里 Factory Droid 预设为 false（`packages/app/src/data/acp-provider-catalog.ts:170`） | `supportsMcpServers` 为真时能，否则不能 |
| OpenCode | 原生（bridge 插件） | client 在有 bridge 时声明 `supportsNativePaseoTools: true`（`providers/opencode-agent.ts:1419`）；会话绑定 `launchContext.paseoTools`（`:1565-1575`）；工具调用经 bridge 按会话执行（`providers/opencode/bridge.ts:199-218`）。bridge 在 bootstrap 里总会创建（`agent/provider-runtime.ts:22-36`，`provider-registry.ts:219-221`） | 能。但**模型看到的工具清单不等于可调用**，见下文 |
| OMP | 原生 host tools | `providers/omp/agent.ts:462-467` `supportsMcpServers: false, supportsNativePaseoTools: true`；`:2229-2237` 用 `setOmpHostTools` 注册已过滤目录；`omp/host-tools.ts:33-46` 每个工具 `loadMode: "essential"` | 能。原生目录是否含 `create_agent` 完全由策略决定 |
| Pi，装了 `pi-mcp-adapter` | MCP（adapter） | `providers/pi/agent.ts:2863-2874` 探测到 adapter 才写 `--mcp-config`；会话 capability 取 `mcpConfig !== null`（`:216-218`、`:2684`） | 能（经 adapter 暴露，模型侧调用形态见"仍存疑"） |
| Pi，没装 adapter | 无 | `prepareMcpConfig` 返回 null（`pi/agent.ts:2871-2873`），会话 `supportsMcpServers: false`；Paseo 生成的 Pi 扩展只挂事件和内部命令，不注册工具（`createPiPaseoExtensionFile`，`pi/agent.ts` 同名函数） | 不能，而且不报错 |
| 插件 provider | MCP | `agent/plugin-provider.ts:1515-1523` `supportsMcpServers: true, supportsNativePaseoTools: false`；`:1559` 转交 `mcpServers` | 取决于插件是否消费 `mcpServers`，daemon 无从得知 |
| mock / mock-slow | 无 | `providers/mock-load-test-agent.ts:54`、`providers/mock-slow-provider.ts:20` | 不能（仅开发用） |

**OpenCode 的工具清单与可调用性不一致。** 插件的工具清单来自 bridge 的全局 manifest（`bridge-plugin.mjs:23-31` 拉 `/tools`）。这份 manifest 是**不带策略**的完整目录：`createAgentToolCatalog({})`（`bootstrap.ts:1460-1462`）。按会话执行时只认绑定的 `binding.tools`：

- 会话没拿到目录（全局关或策略 `enabled:false`）：模型仍然看得到 `paseo_create_agent`，调用返回 403 "Paseo tools are disabled for this session"（`bridge.ts:207-211`）。
- 策略只禁了 `create_agent`：调用时 `executeTool` 抛出 "Paseo tool not found"（`tools/paseo-tools.ts:602-605`），bridge 返回 500（`bridge.ts:176-181`）。

所以 OpenCode 必须按"会话绑定的目录里有没有 `create_agent`"判定，不能按模型看到的工具判定。

### 1.5 子智能体会话

- MCP `create_agent` 走 `createAgentCommand`，最终调用 `agentManager.createAgent`（`tools/paseo-tools.ts:1443-1476`，`create-agent/create.ts:183-188`），进同一个 `createAgentInternal` → `prepareSessionConfig` → `buildLaunchContext`（`agent-manager.ts:1299-1316`）。子会话没有任何跳过注入的分支。
- 策略按**子** provider ID 解析，不继承父会话的策略（`docs/providers.md:67`）。从父会话继承的只有同 provider 时的 `providerOptions`（`tools/paseo-tools.ts:645-653`）。
- 结论：Paseo 子智能体按同一规则判定，与父会话能否派发无关。provider 自己的子智能体（OMP task、Claude Task 等）不是 Paseo 会话，没有输入框，不在本判定范围内。

## 2. 启动时算一次够不够

够。按事件逐项核对：

| 运行中的变更 | 已运行会话 | 证据 |
| --- | --- | --- |
| 关 `mcp.injectIntoAgents`（app 可改） | **不受影响**。MCP 会话的 provider 配置里仍有 URL，端点只检查 `mcpEnabled`，并用启动时存下的策略建目录。原生会话持有已构建的目录对象 | `bootstrap.ts:1645-1648` 只改 `mcpBaseUrl` 和 `paseoToolsEnabled`，只影响下一次 `prepareSessionConfig`；端点检查见 `bootstrap.ts:1507-1509`；策略来源 `bootstrap.ts:1476-1478` |
| 开 `mcp.injectIntoAgents` | 原本没工具的会话**仍然没有**，要 reload 或重建 | 同上。`public-docs/mcp.md:20` 写明 "Start a new agent or reload an existing one after changing injection settings" |
| 改 `agents.providers.<id>.paseoTools` | 不受影响，仍用 `paseoToolPolicies` 里的存档 | `resolvePaseoToolPolicy` 只在 `prepareSessionConfig` 调用（`agent-manager.ts:5156`）；`docs/data-model.md:318-320` 写明 "configuration changes affect the next session rather than an already-running one" |
| 配置文件把 `daemon.mcp.enabled` 关掉（app 改不了） | **MCP 通道立即失效**：`/mcp/agents` 返回 404。原生通道（OMP、OpenCode）不经过这个端点，继续可用 | `bootstrap.ts:1507-1509`、`:1638-1644`；OMP 直接执行目录（`omp/host-tools.ts:66-73`），OpenCode 走 bridge（`bridge.ts:199-218`） |
| reload / resume / import / daemon 重启 | 重新判定 | 四条路径都重新调用 `prepareSessionConfig` 并覆盖 `paseoToolPolicies`（`agent-manager.ts:1402-1420`、`:1473-1480`、`:1570-1604`）；reload 失败会回滚旧策略（`:1643-1649`） |

实现提示：

- 判定值只在会话注册时变化。每次注册都会从 `session.capabilities` 重建 `ManagedAgent`（`agent-manager.ts:3659`），并在 `registerSession` 末尾通过 `emitState` 推送快照（`:3535-3545`），所以在注册时算好、写进 `ManagedAgent`，就能随现有 `agent_state` 自动下发，不需要新的推送时机。
- Pi 的 adapter 探测按 cwd 在启动时做（`pi/agent.ts:2877-2893`），它的结果只能从会话的 `capabilities.supportsMcpServers` 读，不能从 client 读（client 固定为 false，`pi/agent.ts:212-214`、`:2640`）。所以判定要在会话创建**之后**、用 `session.capabilities` 算。
- 建议的判定式（在 `createAgentInternal` / resume / import / reload 拿到 `session` 之后）：
  - 原生：`launchContext.paseoTools?.getTool("create_agent") !== undefined`；
  - 否则：`providerLaunchConfig.mcpServers` 里有内部 `paseo` 服务器，且 `session.capabilities.supportsMcpServers === true`，且 `isPaseoToolEnabled(policy, "create_agent")`。
- `mcp.enabled` 在运行中被关掉的情况：可以在 `bootstrap.ts:1638` 的回调里对 MCP 通道的会话重算并重发状态，也可以接受这段时间的快照是旧值（这个开关 app 改不了，只能改配置文件）。前者更准，后者更省事，需要取舍。

## 3. 快照字段放哪里

### 现有字段能不能复用

- `capabilities.supportsMcpServers` 不行。它表示 provider 会话接不接受 MCP 配置，不表示 Paseo 工具已注入：全局关闭时 Claude 仍然是 true；OMP 能派发却是 false（`omp/agent.ts:465`）；Pi 只要有用户自配的 MCP 服务器、装了 adapter，也会是 true。
- `capabilities.supportsNativePaseoTools` 不行。它是 client 的能力，只在 OMP 和 OpenCode 上出现，表示走哪条通道，不表示注入与否。这个键目前会经 `catchall(z.boolean())` 上线（`messages.ts:464-480`、`agent-projections.ts:135`）。
- 快照里没有别的字段能表达"本会话已注入 Osuna tools"，与 map.md Notes 的已查事实一致。

### 建议：顶层可选字段

在 `AgentSnapshotPayloadSchema`（`packages/protocol/src/messages.ts:908-937`）顶层加一个可选布尔字段，比如 `canCreateAgents: z.boolean().optional()`，用 `server_info.features.agentMentions`（名字由 09 号票定）做一次性能力门控。

为什么符合 `docs/protocol-compatibility.md`：

- 新字段 `.optional()`，不收窄、不改已有字段。旧 app 的 `z.object` 默认剥掉未知键，能正常解析。旧 daemon 不发这个字段，新 app 先看 feature 开关，开关为假就提示更新 Host，不做降级（`docs/protocol-compatibility.md` "The feature contract"）。
- 用纯结构声明，不用 `.default()` / `.transform()`。

为什么不放进 `capabilities`（虽然 `catchall(z.boolean())` 在协议层也能兼容）：

- 语义不对：`capabilities` 在 server 端就是 `session.capabilities`（`agent-manager.ts:3659`），表示 provider 能力。要写进去就得在投影层混入 daemon 状态。
- app 端有两处硬编码的键表会漏掉它：replica-cache 用 `z.strictObject` 逐键存 capabilities（`packages/app/src/runtime/replica-cache/index.ts:173-184`、`:610-625`）；`AGENT_CAPABILITY_FLAG_KEYS` 用于变更比较（`packages/app/src/agent-stream/view.tsx:305-315`）。放在顶层同样要在 replica-cache 里加字段，但语义清楚，不会被误当成 provider 能力。

如果 UI 需要区分原因（全局没开、provider 策略禁用、Pi 没装 adapter、需要 reload），可以再加一个可选 `z.string()` 原因字段。**不要用 `z.enum`**：以后加一个枚举值，旧 app 就会解析失败。PRD 目前只有一条提示文案"当前智能体未启用 Osuna tools"，v1 只用布尔就够。

未加载的存档智能体（`buildStoredAgentPayload`，`agent-projections.ts:204-245`）不带这个字段。它的 capabilities 本来就是占位默认值（`supportsMcpServers: false`）。对这种智能体发消息会先 resume，resume 时会重新判定。

## 仍存疑

- **新建会话首条消息的 mention。** PRD 要求 `create_agent_request` 的首条消息也支持 mention，但此时会话还不存在，也就没有快照可读。可选方案：(a) 在 provider snapshot 条目（`ProviderSnapshotEntrySchema`，`messages.ts:426-439`）加一个可选的预测字段，由 daemon 按全局开关、策略和 client 能力算。Pi 的 adapter 按 cwd 探测，只能给出"未知"。(b) daemon 创建后发现不能派发，就丢弃路由提示并给出提示。(c) app 用 daemon 配置自己推断（会在 app 端复制 daemon 的判定逻辑，不推荐）。需要 09 号票决定。
- **OpenCode 插件什么时候拉 manifest。** manifest 在插件初始化时拉一次（`bridge-plugin.mjs:23-31`）。OpenCode 是在服务器启动时加载插件，还是按项目目录的实例懒加载，源码里看不出来（这是 OpenCode 的内部行为）。如果共享服务器是在全局开关关闭时启动的，插件拿到的是空 manifest；之后打开开关，新会话虽然绑定了目录，模型也可能看不到任何 `paseo_*` 工具。建议实现时用 `opencode-bridge.local.e2e.test.ts` 的思路补一个"先关后开"的用例来核实。
- **ACP 系 provider 是否接受 HTTP MCP 服务器。** Paseo 不看 agent 在 initialize 中返回的 `mcpCapabilities`，一律发送 HTTP 服务器（`acp-agent.ts:3294-3333`，仓库里没有读取 `mcpCapabilities` 的代码）。Copilot、Cursor 等实际是否接受，只能实测。
- **Pi adapter 的模型侧调用形态。** `pi-mcp-adapter` 可能把 MCP 工具放在一个代理工具后面，而不是作为直接工具暴露（测试里出现过 `directTools` 配置，`pi/agent.test.ts:2999`）。能调用，但路由提示能否让模型可靠地找到 `create_agent`，要看 01 号票的实测。
- **插件 provider** 是否消费 `mcpServers`，daemon 无法判断。按 `supportsMcpServers: true` 视为能派发，可能误报。
- 判定式只保证工具在目录里且通道已接上，不涵盖 provider 侧的工具权限审批（例如 Claude 对 MCP 工具弹出的权限请求）。这属于 03 号票的范围。
