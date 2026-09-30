# 04 — 各 provider 会话能否调用 `create_agent` 的判定

**Type:** research
**Blocked by:** None
**Status:** resolved

## Question

`@` 弹窗要在当前会话不能派发时置灰智能体分组，daemon 需要在 agent 快照里给出这一位。查清：(1) 一个会话能调用 `create_agent` 的完整条件：全局 `mcp.enabled && mcp.injectIntoAgents`、按 provider 的 `paseo-tool-policy`（`enabled`、`disabledTools` 含 `create_agent`）、provider 是否支持 MCP 注入或原生 Paseo 工具（OMP 原生 host tools 是否含 `create_agent`；Pi 未装 pi-mcp-adapter 时；OpenCode bridge），以及子智能体会话是否同样注入；(2) 该判定在会话启动时算一次是否足够——全局开关或策略在会话运行中改动后是否对已运行会话生效；(3) 现有快照/能力字段（`capabilities.supportsMcpServers` 等）有无可复用的，新增字段放哪里最符合 `docs/protocol-compatibility.md`。产出 `research/dispatch-capability.md`。

## Answer

详见 `research/dispatch-capability.md`。

- **判定规则**（会话启动时算）：`mcp.enabled && mcp.injectIntoAgents`，加上该 provider ID 的 `paseoTools` 允许 `create_agent`，再加上交付通道已接通。原生通道（OMP、OpenCode bridge）看会话目录里有没有 `create_agent`；MCP 通道看是否注入了内部 `paseo` 服务器，且会话 `supportsMcpServers === true`（Claude、Codex、Copilot/ACP、装了 adapter 的 Pi）。Pi 没装 `pi-mcp-adapter`，以及 `supportsMcpServers:false` 的 generic ACP，都不能派发，而且不报错。Paseo 子智能体按子 provider 的 ID 走同一规则。
- **`injectIntoAgents` 默认是 `false`**（`config.ts:546-547`），不是"默认开启"。新装用户的智能体分组默认置灰。
- **生效时机**：在 create/resume/import/reload 时判定一次就够。运行中改全局开关或 provider 策略，都不影响已运行会话，要 reload 才生效。唯一例外是用配置文件关 `daemon.mcp.enabled`：MCP 通道立即 404，原生通道不受影响。
- **OpenCode 看到的工具不等于能调用的工具**：manifest 是不带策略的完整目录，必须按会话绑定的目录判定。
- **字段**：在 `AgentSnapshotPayloadSchema` 顶层加可选布尔（如 `canCreateAgents`），在 `registerSession` 时算好，随 `agent_state` 下发。不要复用 `capabilities.supportsMcpServers`，也不放进 `capabilities`（语义不符，且 app 的 replica-cache/比较键表是写死的）。如果要带原因，用 `z.string()`，不用 enum。
- **待 09 号票定**：`create_agent_request` 首条消息的 mention 没有快照可读，需要 provider 级的预测字段或 daemon 端兜底。
