# 11 — RPC-only 插件一帧都观察不到：`connect()` 排在 `evaluateBundle()` 之前

**What to build:** 让插件在 daemon 连接建立**之前**就能装上 `process.on("message")` 观察者，
或者改掉这条测试所断言的契约。现在插件注册观察者时，握手帧已经发完了。

**Impl:** ready
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

## 范围

- [ ] 确认 `createOsunaApi` / `DaemonClient` 在未 connect 时被 `contribute()` 使用的行为
- [ ] 定方向（A / B）并实施
- [ ] 验收：`cd packages/server && npx vitest run --maxWorkers=1 src/server/plugins/connection-demand.e2e.test.ts`
- [ ] 回归：`plugin-osuna-api.e2e.test.ts` 与 `lifecycle.e2e.test.ts` 仍全绿
- [ ] `npm run typecheck`、`npm run lint` 通过
