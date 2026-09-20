# 11 — RPC-only 插件一帧都观察不到：`connect()` 排在 `evaluateBundle()` 之前

**What to build:** 让插件在 daemon 连接建立**之前**就能装上 `process.on("message")` 观察者，
或者改掉这条测试所断言的契约。现在插件注册观察者时，握手帧已经发完了。

**Impl:** done
**Status:** ready-for-agent

**Blocked by:** None

## 现在的失败

`packages/server/src/server/plugins/connection-demand.e2e.test.ts:71`

```
AssertionError: expected {} to deeply equal { status: 1 }
```

测试名是 "an RPC-only plugin receives no agent, project or provider data" ——
它要证明的是 RPC-only 插件**只**收到 `status`，不该收到 agent / project / provider 数据。
实得 `{}`：一帧都没收到，包括本该收到的那一帧。断言的方向因此完全没被验证到。

## 定位

`packages/server/src/server/plugins/plugin-process.ts:255-280` 的 `initialize()`：

```ts
await daemonClient.connect();      // :266  ← 握手在这里完成，status 帧此时已送达
settingsStore = ...
evaluateBundle(message.bundle);    // :272  ← 插件的 contribute() 在这里才运行
```

插件的 `process.on("message", observe)` 写在 `contribute()` 里（见该测试夹具
`connection-demand.e2e.test.ts` 内联的插件源码），也就是在 `evaluateBundle` 内部注册。
等它装上时，`connect()` 期间到达的帧已经派发完毕，Node 的 `message` 事件不会重放。

来源是上游 `18aaec277 fix(client): keep daemon connections lean by default (#4470)` ——
同一个 commit 既写了这条测试，也改了连接时机。

## 与票 08 无关（已验证）

票 08 把插件 IPC 的 `paseo_frame`/`paseo_close` 改名成 `osuna_*`。这条红不是它造成的：

- 在 clean tree 上（未含票 08 任何改动，只补了下面那条 requirements）复现一致。
- `plugin-osuna-api.e2e.test.ts:320-336` 用裸 `process.send({type:"osuna_frame"})` 做了一次
  完整的收发握手并通过（3/3），证明帧通道本身是通的。

票 08 顺带修掉了挡在前面的另一处批次 3 遗留：该夹具清单原本是 `{ id: "quiet" }`，
缺 `requirements.osuna`，会在 range check 阶段直接装不上。补上之后才暴露出本票这条。

## 需要先做的决定

- **A. 把观察者注册提前到 `connect()` 之前**，即 `evaluateBundle` 先于 `connect`。
  风险：`contribute()` 里若有代码依赖已连接的 `osuna` API，会拿到未连接的 client。
  需要先确认 `createOsunaApi(daemonClient)` 在未连接时的行为。
- **B. 承认握手帧不可观察**，把断言改成「除 status 外什么都不该收到」的等价写法
  （例如让插件在 RPC 里主动查一次，而不是靠观察握手）。
  代价：这条测试原本想钉的「连接默认是 lean 的」就少了一个正向证据。

不要只把 `{ status: 1 }` 改成 `{}` —— 那会让这条测试变成永真断言：无论连接是否 lean，
一个装不上观察者的插件都会得到 `{}`。

## 同一条测试里的第二处红：legacy 夹具其实是个现代客户端

把 `{ status: 1 }` 修绿之后，第 73 行才第一次被执行到，并且也是红的：`legacyTypes`
期望含 `project.update` / `providers_snapshot_update` / `agent_stream`，实得只有
`status` 与 `get_daemon_config_response`。已在**未含本票任何改动**的树上复现，与重排无关。

原因不在产品代码，在夹具：daemon 的全部 legacy 广播路径都先短路于
`delivery.isModern(source)`，而它的来源是 `session.ts` 的 `updateClientCapabilities` 里的 
`capabilities?.[CLIENT_CAPS.ownedSubscriptions] === true`。客户端的 `capabilities`
是覆盖合并进 `DEFAULT_CLIENT_CAPABILITIES`（其中 `ownedSubscriptions: true`）的，所以
只否定 `explicit_event_subscriptions` 的那个夹具仍被判成现代客户端，这条断言从上游
写下来就没有通过过。`owned-subscriptions.e2e.test.ts:1514` 的 legacy 客户端正是
`{ owned_subscriptions: false, explicit_event_subscriptions: false }`。

修法是让夹具名副其实（补 `owned_subscriptions: false`），不是放宽断言。

## 重排的连带后果（审查发现，已一并处理）

- **插件监听器排到了 transport 前面 —— 审过之后判定不必处理，只记进注释。**
  transport 的 `process.on("message")` 在 `connect()` 里才注册，`evaluateBundle` 提前后
  插件的观察者就排在它前面。一度改成模块加载期的扇出监听器让 daemon 侧永远在最前，
  但那条路走不通：顺序买不到任何可观测行为（抛错的监听器无论排第几，都会以
  `uncaughtException` 结束插件子进程，这个进程没有装 `uncaughtException` 处理器），
  而扇出又必须逐个 `try/catch` 才不会连带中止主调度器，那个 catch-all 本身违反
  `.atw/spec/server/backend/error-handling.md`，还把「抛错即进程死亡、daemon 能观察到」
  变成一行日志。已回退，代价写在 `initialize()` 的注释里。
- **`connect()` 失败时 `contribute()` 的 cleanup 成了孤儿。** 重排前连接失败时
  `contribute()` 还没跑，无副作用；现在它已经跑完，`initialize().catch` 里补上了
  cleanup 调用，否则进程外副作用（定时器、子进程、外部连接）不会被回收。

## 审查修复的测试缺口（已知）

`.atw/spec/server/backend/testing.md` 要求「a test that runs the branch」，这两条都跑不到：

- **`connect()` 失败时跑 cleanup**：这条分支不是「测不了」，是**进不去**。
  `DaemonClient.connect()` 共四处 `rejectConnect`：disposed、closed、transport 构造抛错，
  以及 `handleDisconnect` 且不再重连那一处（`packages/client/src/daemon-client.ts:6423`）。
  插件带 `reconnect: { enabled: true }`，第四处对它不可达，连接失败走重连而不是 reject。

`initialize().catch` 现实中的唯一入口是 `evaluateBundle` 抛错（`contribute()` 先
`on(...)` 再返回非函数就能进）。那时 `cleanup` 还是 null，但 `releaseContribution()`
会多做一次 `hooks.close()` —— 旧代码在这条路径上不释放 hook 注册。这是一处行为改善，
没有加测试：父进程收到 `fatal` 后直接 terminate 子进程，进程内释放与否在外部不可观测。

另记一处等价重排：`shutdown()` 里 `hooks.close()` 随 `releaseContribution()` 挪到了
tombstone 循环之后。两者之间没有 await，交错不可观测。

## 范围

- [x] 确认 `createOsunaApi` / `DaemonClient` 在未 connect 时被 `contribute()` 使用的行为
      —— `contribute()` 只拿到 `{handle, registerProvider, registerSettings, on, before}`
      五个纯本地注册函数，`osuna` 只在 RPC 调用期注入，A 方向的那条风险不成立
- [x] 定方向（A / B）并实施 —— 取 A：`await daemonClient.connect()` 下移到
      `evaluateBundle` 之后。`settingsStore` 赋值相对 `evaluateBundle` 未动，但相对
      握手前移了（原本在 `connect()` 之后构造）；它只往父进程 `send`，不经 daemon 连接
- [x] 验收：`cd packages/server && npx vitest run --maxWorkers=1 src/server/plugins/connection-demand.e2e.test.ts`
- [x] 回归：`plugin-osuna-api.e2e.test.ts` 与 `lifecycle.e2e.test.ts` 仍全绿
      —— 实际跑了整个 `src/server/plugins`（重排的爆炸半径），20 passed / 1 skipped，
      191 tests passed / 3 skipped
- [x] `npm run typecheck`、`npm run lint` 通过
