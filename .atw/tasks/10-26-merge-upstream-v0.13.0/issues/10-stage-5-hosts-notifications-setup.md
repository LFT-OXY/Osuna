# 10 — 第五段适配：连接的主机、结束通知与 setup

**What to build:** 连接的主机照收：主机清单、`hosts.*` RPC、能力位、CLI `host` 子命令、Paseo 工具的 `serverId` 与 `list_hosts`，与 Osuna 在同文件加的父工具调用标签、逻辑图工具、`agentMentions` 能力位两边都留。子 Agent 的报告与结束通知合成一条，Osuna 的权限文案（由用户在子会话里批准、未授权别用 respond_to_permission）在新文件里，上游的 `serverId` 与「主机不可达」原因同时保留。Routing block 接到上游新的「发送已准备好的 prompt」与「首个 prompt」两条路径上，仍在末尾。工作区 setup 用上游重写的流程，Osuna 在新建 Agent 里加的 Routing block 解析与父工具调用标签挂到新流程上。远端子 Agent 不进派发组，记为后续工单。规格见 `prd.md`「连接的主机与 Agent 间消息」「工作区 setup」。

**Blocked by:** 06
**Status:** ready-for-agent
**Impl:** done

- [ ] `subagent-permission` 的 daemon e2e 通过，证明结束通知里的权限文案没丢。
- [ ] 经两条新路径发出的 prompt 末尾仍有 Routing block，有测试（ADR 0004）。
- [ ] 新建 Agent 经上游的新 setup 流程后仍带父工具调用标签，派发组对本机子 Agent 照常工作，有测试。
- [ ] 结束订阅的持久化位置与 Osuna 数据目录的关系已核实，结论记在 `## Comments` 下。
- [ ] 「远端子 Agent 进派发组」的后续工单已记在 `## Comments` 下，供 14 写进 PR 正文。
- [ ] typecheck 和 lint 通过；改到的测试文件逐个单独跑过并通过（不跑整套）。
- [ ] 没有 Osuna 的断言被删除或放宽；必须跟着改的断言逐条记在 `## Comments` 下，供 14 写 PR 正文用。

## Comments

### 范围：结束通知的新文件在第 6 段才进来
- 上游把结束通知搬进 `agent/finish-subscriptions/internal/notification.ts`、重启后仍送达（#7683 `21e7ccb03`）在 v0.13.0-beta.2，即第 6 段；当前分支只到第 5 段。本段结束通知仍在 `server/agent/agent-prompt.ts` 的 `setupFinishNotification`，Osuna 的权限文案在 `agent-prompt.ts:513`，`agent-prompt.test.ts`「finish notifications survive permission responses」断言原文。
- 本段的结束通知已带上游的 `serverId`（`agent-prompt.ts:510` 的 `Server:` 行与权限请求里的 `serverId`）；上游「主机不可达」「主机被移除」两种原因（`host unreachable`、`host removed`）在第 6 段的新文件里才有。把 Osuna 文案搬进新文件、同时收下这两种原因，交给工单 12 合第 6 段时做（已在 12 的 `## Comments` 记下），合完再跑一次 `subagent-permission.e2e` 与 `agent-prompt.test.ts`。

### 核对结果
- 连接的主机：`websocket-server.ts:2022-2035` 同时宣告 `connectedHosts`、`hostMultiplexing`、`agentMentions`、`subagentCallLinks`；`paseo-tools.ts` 里上游的 `list_hosts`（:1382）与 Osuna 的 `registerLogicMapTools`（:1374）、`parentToolCallId`（:1667）都在；CLI 有 `commands/host/`。
- Routing block 的两条新路径：`sendPreparedPromptToAgent`（`agent-prompt.ts:376`，客户端发消息经 `sendPromptToAgent` 进来）与 `startCreatedAgentInitialPrompt`（:424，经上游新 setup 的 `create.ts` `sendInitialPrompt`）都把 `resolveRoutingBlock` 交给 `startAgentRun`，追加在末尾。
- 新 setup 流程：上游 #7473 `fbd90cb88` 把 setup 收归工作区，session 创建不再建 worktree；MCP 创建仍经 `createPaseoWorktree`，标签在 worktree 建好后由 `withParentToolCallIdLabel` 写入（`create.ts:317`）。派发组（`selectDispatchSubagents`，`app/src/subagents/select.ts`）只在当前主机的会话里按 `PARENT_TOOL_CALL_ID_LABEL` + 父 Agent 匹配子 Agent；同文件给 Subagents track 用的 `selectSubagentsForParent` 才读父主机地址标签。
- 结束订阅的持久化（读上游 `d34d17a90`，未合入）：`createJsonFinishSubscriptionStore(config.paseoHome)` 写 `$PASEO_HOME/finish-subscriptions.json`（`finish-subscriptions/internal/json-store.ts:18`，`bootstrap.ts:1421`）。Osuna 的 `resolvePaseoHome` 与上游 v0.13.0 逐字相同（`PASEO_HOME` 或 `~/.paseo`），所以它和 `agents/`、`config.json`、上游的 `hosts.json` 在同一目录：正式版 `~/.paseo`，本仓库 dev 是 `.dev/paseo-home`，互不串。Osuna 没有同名文件，桌面 userData 不受影响，不需要迁移。

### 新加的测试（都先改坏代码确认会挂，再还原）
- `agent-prompt.test.ts`「a prompt wrapped in the sender envelope still ends with the Routing block」：带发送者信封的消息经 `sendPromptToAgent` → `sendPreparedPromptToAgent`，提供方收到「信封 + 空行 + Routing block」，时间线记信封原文。这条测的是函数约定：生产里客户端发消息（`session.ts:8640`）不带发送者，Agent 间消息（`websocket-server.ts:760`）不带 Routing block，两者不会在这条路径上同时出现；真实路径以 `agent-mention-routing-block.e2e` 为准。
- `create.test.ts`「session create from another agent ends the enveloped first prompt with the Routing block」：别的 Agent 发起的新建会话，首个 prompt 同样是信封在前、Routing block 在末尾。这是真实组合：`session.ts:4783` 在请求带 `callerAgentId` 时同时传发送者与 `resolveRoutingBlock`。
- `create.test.ts`「mcp create in a new worktree labels the child with the caller's tool call id」：MCP 在新 worktree 里建子 Agent，存盘与快照都带 `PARENT_TOOL_CALL_ID_LABEL`。

### 跟着改的 Osuna 断言（供 14 写 PR 正文）
- `daemon-e2e/agent-mention-routing-block.e2e.test.ts`「MCP send_agent_prompt and schedule fires never get a Routing block」：上游 #7561 `d0568f9f1` 起 Agent 间消息先排队、安静两秒后才投递，原用例在工具返回后立刻数提供方收到的消息，数到 0。在原断言前加一句等待（`expect.poll` 到有消息，照同文件 MCP create_agent 用例的写法），断言本身一行未改。没有删除或放宽任何断言。

### 跑过的测试（逐个文件）
- `agent-prompt.test.ts`、`create-agent/create.test.ts`：32 条通过。
- `daemon-e2e/subagent-permission.e2e.test.ts` 3、`agent-mention-routing-block.e2e.test.ts` 22、`subagent-call-links.e2e.test.ts` 3、`connected-hosts/hosts.e2e.test.ts` 22（另 1 条要真 SSH，按环境跳过）、`agent/mcp-server.test.ts` 196、`agent/paseo-tool-policy.test.ts` 2、app `subagents/select.test.ts` 35：全部通过。
- `npm run typecheck` 全仓通过；改到的测试文件 lint 通过。

### 后续工单（供 14 写进 PR 正文）
- 远端子 Agent 进派发组：在连接的主机上建的子 Agent（带上游 `PARENT_SERVER_ID_LABEL`、按 `AgentAddress` 打开）不进 Osuna 的派发组，派发组只列本机子 Agent（`agent-panel.tsx` 给派发组包了本机地址）。要做时，派发组的选择器按地址（`serverId` + `agentId`）匹配，并经远端主机查归档子 Agent。维护者 2026-10-26 确认这次不补。
