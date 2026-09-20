# 08 — 批次 2 漏下的运行时契约：pid 锁文件名、插件 IPC 消息类型、timeline 步骤名

**What to build:** 批次 2（运行时标识符）把大部分 wire 与磁盘标识改到了 osuna，但漏下
四处。它们的共同点是**跨进程或跨版本的契约**：换名字的一方如果先动，另一方就认不出来。
和票 07 那种「只有维护者看得见的内部名」不是一回事，所以单独成票并排在发布演练之前。

**Impl:** ready
**Status:** ready-for-agent

**Blocked by:** 04

## 四处

- [ ] **daemon 锁文件名** — `packages/server/src/server/pid-lock.ts:53` 返回
      `$OSUNA_HOME/paseo.pid`。**这处有升级风险，不能只改名**：正在跑的旧 daemon 持有
      `paseo.pid`，新版本只看 `osuna.pid` 就会认为没有实例在跑，于是同一个 home 起出两个
      daemon，抢同一个端口与同一份 agent 存储。改名必须连带读一次旧文件名：发现旧锁且进程
      还活着时，按「已有实例在跑」处理。
- [ ] **插件进程 IPC 消息类型** — `plugin-process-protocol.ts` 的 `paseo_frame` /
      `paseo_close`，以及 `daemon-transport.ts`、`runtime.ts` 里的收发端。这是 daemon 与
      插件子进程之间的协议，两端在同一个仓库里，可以一次改完；但要确认没有第三方插件直接
      依赖这两个字面量（票 03 的插件契约改名已经把 `osuna-plugin.json` 定了下来，这里顺着
      同一条口径走）。
- [ ] **worktree timeline 步骤名** — `worktree-bootstrap.ts:360,371,381` 产出的
      `paseo_worktree_setup`。它会进 agent timeline 并被 app 读取渲染；已存的历史条目改名
      后不再匹配，代价与批次 2 的 stash 前缀、票 04 的 MCP 工具名同类，记录即可。
- [ ] **agent label key** — `paseo.parent-agent-id`、`paseo.open-agent-tab.`、
      `paseo.worktree`、`paseo.inputs`。这些 key 会落进 agent 快照并被 CLI 与 app 读取。

## 不在本票范围

`packages/client/src/daemon-client.ts` 的 `paseo.ws.*` trace span 名是纯内部遥测，归票 07。

- [ ] 验收：起一个旧 home（里面有 `paseo.pid`）再启动新 daemon，确认识别出已有实例而不是
      起出第二个
- [ ] 验收：装一个插件并确认 daemon ↔ 插件子进程的帧收发仍通
- [ ] `npm run typecheck`、`npm run lint`、全量单测通过
