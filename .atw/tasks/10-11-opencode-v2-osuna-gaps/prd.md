# OpenCode 2.x 路径补齐 Osuna 独有行为

来源：合并上游 v0.10.0 – v0.10.3（[PR #15](https://github.com/LFT-OXY/Osuna/pull/15)）时核实出的缺口，核实过程在任务 `10-10-merge-upstream-v0.10.3`（归档后在 `.atw/tasks/archive/2026-10/` 下）的 `issues/05-merge-stage-4-v0.10.2-opencode-v2.md`「OpenCode 2.x 上缺失的 Osuna 行为」。这份文件只记下要解决的问题，还没有做需求访谈，开工前先走 discover。

## Problem Statement

上游为 OpenCode 2.x 另写了一套路径（`packages/server/src/server/agent/providers/opencode/v2/`），那次合并按上游的原样收下。Osuna 加在 1.x 路径（`opencode-agent.ts`、`opencode/`）上的几个行为在 2.x 路径上没有，装了 OpenCode 2.x 的用户会遇到：

| 行为 | 2.x 上的现状 | 用户看到的 |
| --- | --- | --- |
| `create_agent` 的父工具调用归属 | 缺。1.x 的插件 `opencode/bridge-plugin.mjs` 把工具调用编号放进 `X-Paseo-Tool-Call-Id` 请求头，`opencode/bridge.ts` 读出来；2.x 的插件 `opencode/v2/bridge-plugin.mjs` 不带这个头 | 2.x Agent 派发出去的 Subagent 不挂在发起它的那次工具调用下面 |
| Subagent 权限请求的归属 | 缺。1.x 给子会话的权限请求与问题表单加 `providerSubagentPermissionMetadata(子会话 id)`；2.x 的 `v2/permissions.ts` 发出的请求不带 `metadata` | Subagent 的权限请求看不出是哪个 Subagent 发的 |
| 向指令目录上报指令列表 | 缺。1.x 每轮开始后发 `commands_changed`；`opencode/v2/` 下没有任何地方发 | 同目录新会话的 `/` 菜单在用户对一个运行中的 2.x Agent 打开过 `/` 菜单之前，只有两条内置指令并带「发送一条消息后加载全部指令」 |
| 取列表失败时的返回 | 不同。1.x 请求失败返回 `null`，指令目录给出上次记下的列表；2.x 的 `v2/commands.ts` 请求失败时抛错 | 服务还在但请求失败时，`/` 菜单是错误与空列表 |
| 取列表不等待 | 不同。2.x 的 `commands()` 先等位置就绪（`v2/readiness.ts` 的 `waitForLocationReady`，最长 30 秒） | 别的操作刚触发重连时打开 `/` 菜单，要等新服务就绪 |

没有实测、要先核实的两条：

- `paseo.create_agent` 的工具名规范在 2.x 上走的是与 1.x 共用的 `opencode/tool-call-mapper.ts`，读代码是有的，没有 2.x 专门的用例，没有实测。
- 一键升级执行的是 `opencode upgrade`。2.x 的命令行是否保留这个子命令，代码里看不出来。

## Constraints

- [ADR 0003](../../../docs/adr/0003-command-list-never-spawns.md)：取指令列表不启动进程、不重连。2.x 会话的 `listCommands()` 已在那次合并里改成服务不在就返回 `null`（`opencode/v2/session.ts`），这里的改动不能把重连加回来。
- `opencode/v2/` 目前与上游不同的只有 `session.ts` 的 `listCommands()`，以及 `agent.test.ts` 里守着它的一条用例。每多改一处，下次合并上游就多一处冲突；改法要尽量贴着上游的结构，并写进 `docs/release.md`「踩过的坑」。
- 本机的 OpenCode 是 1.x。2.x 的实测需要一台装了 OpenCode 2.x 的机器，提供方的登录不在本机测。

## Acceptance Criteria

- [ ] TBD — discover 之后写。
