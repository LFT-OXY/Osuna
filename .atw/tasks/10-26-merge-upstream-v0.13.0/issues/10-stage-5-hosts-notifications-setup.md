# 10 — 第五段适配：连接的主机、结束通知与 setup

**What to build:** 连接的主机照收：主机清单、`hosts.*` RPC、能力位、CLI `host` 子命令、Paseo 工具的 `serverId` 与 `list_hosts`，与 Osuna 在同文件加的父工具调用标签、逻辑图工具、`agentMentions` 能力位两边都留。子 Agent 的报告与结束通知合成一条，Osuna 的权限文案（由用户在子会话里批准、未授权别用 respond_to_permission）在新文件里，上游的 `serverId` 与「主机不可达」原因同时保留。Routing block 接到上游新的「发送已准备好的 prompt」与「首个 prompt」两条路径上，仍在末尾。工作区 setup 用上游重写的流程，Osuna 在新建 Agent 里加的 Routing block 解析与父工具调用标签挂到新流程上。远端子 Agent 不进派发组，记为后续工单。规格见 `prd.md`「连接的主机与 Agent 间消息」「工作区 setup」。

**Blocked by:** 06
**Status:** ready-for-agent
**Impl:** ready

- [ ] `subagent-permission` 的 daemon e2e 通过，证明结束通知里的权限文案没丢。
- [ ] 经两条新路径发出的 prompt 末尾仍有 Routing block，有测试（ADR 0004）。
- [ ] 新建 Agent 经上游的新 setup 流程后仍带父工具调用标签，派发组对本机子 Agent 照常工作，有测试。
- [ ] 结束订阅的持久化位置与 Osuna 数据目录的关系已核实，结论记在 `## Comments` 下。
- [ ] 「远端子 Agent 进派发组」的后续工单已记在 `## Comments` 下，供 14 写进 PR 正文。
- [ ] typecheck 和 lint 通过；改到的测试文件逐个单独跑过并通过（不跑整套）。
- [ ] 没有 Osuna 的断言被删除或放宽；必须跟着改的断言逐条记在 `## Comments` 下，供 14 写 PR 正文用。
