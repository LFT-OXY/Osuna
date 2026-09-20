# 08 — 批次 2 漏下的运行时契约：pid 锁文件名、插件 IPC 消息类型、timeline 步骤名

**What to build:** 批次 2（运行时标识符）把大部分 wire 与磁盘标识改到了 osuna，但漏下
四处。它们的共同点是**跨进程或跨版本的契约**：换名字的一方如果先动，另一方就认不出来。
和票 07 那种「只有维护者看得见的内部名」不是一回事，所以单独成票并排在发布演练之前。

**Impl:** done
**Status:** ready-for-agent

**Blocked by:** 04

## 四处（落地后修正为三处，见下）

- [x] **daemon 锁文件名** — `packages/server/src/server/pid-lock.ts:53` 返回
      `$OSUNA_HOME/paseo.pid`。**这处有升级风险，不能只改名**：正在跑的旧 daemon 持有
      `paseo.pid`，新版本只看 `osuna.pid` 就会认为没有实例在跑，于是同一个 home 起出两个
      daemon，抢同一个端口与同一份 agent 存储。改名必须连带读一次旧文件名：发现旧锁且进程
      还活着时，按「已有实例在跑」处理。
- [x] **插件进程 IPC 消息类型** — `plugin-process-protocol.ts` 的 `paseo_frame` /
      `paseo_close`，以及 `daemon-transport.ts`、`runtime.ts` 里的收发端。这是 daemon 与
      插件子进程之间的协议，两端在同一个仓库里，可以一次改完；但要确认没有第三方插件直接
      依赖这两个字面量（票 03 的插件契约改名已经把 `osuna-plugin.json` 定了下来，这里顺着
      同一条口径走）。
      **确认结果（补记，原文只打了勾没写证据）**：`osuna_frame`/`osuna_close` 只出现在
      `packages/server/src/server/plugins/` 下；`packages/plugin/src`（SDK）、13 个
      `plugin-examples/`、`public-docs/plugins/**` 全部零命中。子进程由 daemon 自己的 dist
      fork 出来（`runtime.ts:203`），两端同版本随 daemon 一起发布，不存在版本偏斜。
      **但要记一笔**：第三方插件代码可以用裸 `process.on("message")` 直接观察到这两个字面量
      —— 本仓库自己的夹具就是这么做的（`connection-demand.e2e.test.ts`）。所以它是一个
      「没有文档、但确实可达」的表面，不是完全私有的。
- [x] **worktree timeline 步骤名** — `worktree-bootstrap.ts` 产出的 `paseo_worktree_setup`
      （:360,371,381）**与同文件下方 30 行的 `paseo_worktree_terminals`（:408,423,437）**。
      工单初稿只写了前者，后者是审查抓出来的漏改 —— 它由 `buildTerminalsTimelineItem` 产出，
      与 setup 是同一种合成 `tool_call`，属于本条的范围。
      **工单初稿对代价的判断是错的，此处更正**：原文写「已存的历史条目改名后不再匹配」，
      实际不成立。app 侧所有消费方一律按 `detail.type` 分发，从不看 `name`
      （`tool-call-details.tsx`、`tool-call-detail-state.ts`、`tool-call-icon-name.ts`、
      `protocol/src/tool-call-display.ts`），历史条目改名后照常渲染，这笔代价是零。
      真正与 `name` 有关的是另一件事：`..._terminals` 的 `detail.type` 是 `"unknown"`，
      `buildToolCallDisplayModel` 会回落到 `humanizeToolName(name)`，所以它**在界面上直接
      显示原始名字**。不改的话，用户会在同一个 bootstrap 流程里看到「Paseo worktree
      terminals」紧挨着已改名的 setup —— 正是 cross-layer guide 说的「一个现代字面量挨着
      一个陈旧的，看上去像是故意的」。
- [x] **agent label key** — `paseo.parent-agent-id`、`paseo.open-agent-tab.`、
      `paseo.worktree`、`paseo.inputs`。这些 key 会落进 agent 快照并被 CLI 与 app 读取。

## 落地修正：`paseo.inputs` 不是 agent label，移出本票

工单把 `paseo.inputs` 和三个 agent label key 列在一起，这是个归类错误。`paseo.inputs`
（同族还有 `paseo.prompt`、`paseo.context`、`paseo.execution.id`）是 **Hub workflow 的
表达式命名空间**，不是 agent label：

- `packages/` 下没有 hub 包；`public-docs/hub/index.md` 明写 "This fork operates no Hub
  of its own"。Hub 是独立服务端。
- 全仓唯一的 `${{ }}` 生产点是 `packages/cli/src/commands/hub/init-plan.ts`，其余都是测试
  夹具。**仓内没有任何表达式求值器** —— 求值发生在 Hub 服务端。

所以这不是「两端都在本仓库、可以一次改完」的契约。改名只会让 CLI 生成的 workflow 在
Hub 的 bundle activation 阶段被拒。经用户决定：移出本票，写进 prd 的「不改」。

**顺带修掉批次 4 的一处误改**：批次 4 的文档扫描把 `public-docs/` 里 7 处 `paseo.inputs`
改成了 `osuna.inputs`，而同族的 41 处 `paseo.prompt` / `paseo.context` / `paseo.execution.id`
原封未动，`public-docs/hub/configuration/hub-yml.md:83` 因此在同一句话里自相矛盾。已全部
回滚为 `paseo.*`，52 处现已一致，并在 `init-plan.ts` 生产点留了注释说明为什么不跟着改。

`paseo.worktree` 按用户决定改成 `osuna.worktree`。记录一笔：它全仓**只有一处读取**
（`packages/cli/src/commands/agent/inspect.ts`），没有任何写入方，即 `osuna agent inspect`
的 `Worktree` 字段恒为 `null`。本票只改名不动行为，是否删除留给后续。

## 落地时发现并修掉的两处批次 3 遗留（挡住本票验收）

`plugin-osuna-api.e2e.test.ts` 在 clean tree 上就是红的（2 个用例），而它是唯一覆盖
daemon ↔ 插件子进程链路的 e2e，不修就无法验证本票的帧改名。经用户同意就地修掉：

- **解构改了、函数体没改。** 批次 3 把插件 SDK 的 `ctx.paseo` 改成 `ctx.osuna`，handler
  的解构模式变成 `{ osuna }`，但函数体里仍然是 `paseo.workspaces.create(...)`，运行时
  `paseo is not defined`。5 处。因为插件源码写在模板字符串里，**typecheck 与 lint 都看不见**
  —— 正是 `cross-layer-thinking-guide.md`「Object property shorthand hides a rename」那一类。
- **夹具清单没有 `requirements.osuna`。** `connection-demand.e2e.test.ts` 的 quiet 插件清单
  是 `{ id: "quiet" }`，批次 3 之后会被 range check 拒装（这是批次 3 的预期行为）。已补上
  `requirements: { osuna: ">=0.8.0" }`。

## 不在本票范围

`packages/client/src/daemon-client.ts` 的 `paseo.ws.*` trace span 名是纯内部遥测，归票 07。

Hub 表达式命名空间 `paseo.prompt` / `paseo.inputs` / `paseo.context` / `paseo.execution.id`
—— 由 Hub 服务端拥有，见上。

**`connection-demand.e2e.test.ts` 仍有 1 个用例是红的，与本票无关 → 已开票 11。**
补上 requirements 之后插件能装上了，但断言 `counts` 期望 `{ status: 1 }`、实得 `{}`，
即 RPC-only 插件一帧都没收到。已在 clean tree 上单独验证过与帧改名无关。根因定位到
`plugin-process.ts:266` 的 `await daemonClient.connect()` 排在 `:272` 的 `evaluateBundle()`
之前，插件的观察者注册时握手帧已经发完。见票 11。

- [x] 验收：起一个旧 home（里面有 `paseo.pid`）再启动新 daemon，确认识别出已有实例而不是
      起出第二个 —— 由 `pid-lock.test.ts` 新增的两个用例覆盖：旧锁进程活着时拒绝启动且
      不写 `osuna.pid`，旧锁已被遗弃时正常启动且不删除旧文件（不写迁移代码）
- [x] 验收：装一个插件并确认 daemon ↔ 插件子进程的帧收发仍通 ——
      `plugin-osuna-api.e2e.test.ts` 3/3 通过（走真实 fork 子进程与 session socket）
- [x] `npm run typecheck`（5 个包）、`npm run lint`（0 warning / 0 error）通过。
- [x] `npm test` 全量：**7 处红，逐条在 clean tree 上复跑过，没有一处由本票引入**。
      方法：`git stash -u` 后跑同一批，再 pop 后跑同一批，结果逐条比对。

      | 用例 | 判定 | 归属 |
      | --- | --- | --- |
      | `server/workspace-service-port-allocator` | macOS `/var` → `/private/var` 符号链接，断言比较未解析路径 | 环境，与改名无关 |
      | `server/bootstrap-provider-availability` | 本机缺 codex 二进制，provider 列表少一项 | 环境，与改名无关 |
      | `server/workspace-git-service.observation` | 单独跑绿（改动前后都绿），仅全量并行下红 | flaky |
      | `server/file-observer/index` | 同上 | flaky |
      | `app/plugins/timeline/view.test.tsx` | `ReferenceError: paseo is not defined`，批次 3 半改的第三个实例 | **票 12** |
      | `app/tool-calls/detail-level/projection.test.ts` | MCP 工具名夹具停留在 `paseo_*`，`isOsunaToolName` 不再匹配 | **票 12** |
      | `cli/commands/daemon/pair.test.ts` | `appBaseUrl` 改 `?? null` 后无下游收尾（`62d0e9a52`） | **票 10** |

      另有 `server/plugins/connection-demand.e2e.test.ts` → **票 11**，不在默认 `npm test`
      路径里（`test:integration` 的清单不含它），需 `test:e2e` 才跑到。

      **记一笔教训**：本票落地过程中曾把 `npm test` 的输出管道给 `tail -120`，只看到最后
      120 行，前面 6 处红全被截掉，据此错误地报告过「全量只有一处红」。长输出要落盘再筛，
      不要用 tail 当过滤器。
