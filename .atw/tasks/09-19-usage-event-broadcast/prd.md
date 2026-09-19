# usage 事件广播语义与 CI 分类收口

## 背景

`09-18-usage-stats` 合入后，`feat/usage-stats` 上第一次完整 CI（run 35444049119）红了 8 个
job。其中 `server-tests (ubuntu-latest)` 的两条是本功能引起的真回归：

```
src/server/hub/relationship-controller.test.ts > an authenticated browser socket ...
Expected: "hub.management.daemon.connect.response"
Received: "usage.backfill.progress"
```

链路追到底：

1. `packages/server/src/server/bootstrap.ts:1366` 起，三个 usage 事件
   （`usage.backfill.progress` / `usage.updated` / `usage.pricing.updated`）
   都走 `wsServer.broadcast(wrapSessionMessage(...))`。
2. `websocket-server.ts:939` 的 `broadcast` 对每个 session 调 `session.publish()`。
3. `session.ts:8361` 的 `emit()` 交给 `emitSubscribedEvent()`，这一层**是**按订阅过滤的 ——
   三个事件都已正确登记在 `sessionEventCategory()`（`session.ts:8544-8546`）。
4. 但 `emitSubscribedEvent` 末尾有条 COMPAT 兜底：没有显式订阅的 socket 落到
   `wantsEvent()` → `legacyWantsEvent()`（`session.ts:8574`），而那里
   `default: return true`。三个 usage 事件都落在 default，于是**任何没声明订阅的
   socket 都会收到它们**。

Hub 的测试 socket 正是这种：它只发管理 RPC，从不订阅事件，却断言 socket 上收到的
消息序列恰好是三条响应。daemon 启动时的回填进度插了队，断言就崩了。windows 侧
没撞上，是竞态窗口的差别，不是平台差异。

app 端消费这三个事件用的是 `client.observeEvents([...])`（`use-usage-report.ts`），
即订阅模型。也就是说这三个事件从来没有需要兼容的老客户端 —— 它们随 v0.8.2 首次出现。

## 要做的

1. **修正广播语义。** 三个 usage 事件在 `legacyWantsEvent()` 里显式返回 `false`：
   只送给显式订阅的 socket。这既让 Hub 测试恢复绿，也让服务端与 app 的消费模型对齐。
2. **拿 main 的基线 CI 给其余失败分类。** `main` 从未跑过 CI（fork 的 Actions 今天才
   开），所以没有基线，无法区分「本来就红」和「这轮弄红的」。已在 main 上
   workflow_dispatch 了 run 35445391971。基线回来后逐条比对，新增的修掉，既有的
   单独记账。

待分类的 7 条：

| Job                      | 失败点                                                                      |
| ------------------------ | --------------------------------------------------------------------------- |
| `playwright 2/4`         | `explorer-plugin-menu.spec.ts:10`                                           |
| `playwright 3/4`         | `plugin-theme.spec.ts:51`、`settings-navigation.spec.ts:115`                |
| `playwright 4/4`         | `import-session-flow.spec.ts:125`、`terminal-protocol-query.spec.ts:41`     |
| `cli-tests 3/3`          | `daemon/lifecycle.e2e.test.ts`，`SyntaxError: Unexpected end of JSON input` |
| `desktop-tests (ubuntu)` | `test:e2e:browser-tabs`                                                     |

抽查过 `import-session-flow`：失败在 provider 报错横幅缺失，与 usage、与侧栏改动都
不沾边，倾向既有问题，但不靠倾向下结论，等基线。

`format` 与 `lint` 起初被记为「既有欠账」，**这是错的**。main 的基线（run 35445391971）
两项都绿：那批文件在 main 上根本不存在，是本分支的 `d1cfc4c3e`（引入 ATW 工作流）带进来的。
152 个格式问题里 137 个在 `.claude/` `.agents/` `.pi/`、12 个在 `.atw/`、2 个在
`docs/agents/`，全部由 ATW 管理；28 条 lint 错误全在 `.pi/extensions/atw/index.ts`
与两份 `course.js`。剩下 1 个是 `docs/design.md` —— Paseo 自己的文档，被分支提交
`e2b139b28` 弄乱的，直接格式化即可。

## 不做的

- 不动 `wsServer.broadcast` 本身，也不改其它事件的兜底行为。那条 COMPAT
  （`COMPAT(ownedSubscriptions): added in v0.8.0, remove implicit event delivery after 2027-03-09`）
  管着一批真有老客户端的事件，到期一起拆，不在这里提前动。
- 不动协议：三个事件的 schema、`sessionEventCategory()` 的登记都不变。
- 不把 ATW 管理的文件改成符合本仓风格。`atw update` 会按上游写回来，下次更新 CI 照旧红，
  而 28 条 lint 里 `complexity of 40`、`Too many nested callbacks (5)` 这类等于重写
  `.pi/extensions/atw/index.ts`，那是 fork 上游。改为让 `.oxfmtrc.json` 与 `.oxlintrc.json`
  忽略这些目录。
- daemon 侧是否移除 `trend` 聚合，是另一个决定（记在 `09-18-usage-stats` 的 10 号票）。

## 验收标准

1. `npx vitest run src/server/hub/relationship-controller.test.ts --bail=1` 在
   `packages/server` 下通过。
2. 新增用例证明这三个事件不会送到未订阅的 socket，且仍会送到已订阅的 socket ——
   两个方向都要断言，只断言前者会让「事件根本没发出去」也通过。
3. `feat/usage-stats` 上重跑 CI：`server-tests` 双平台绿。
4. 其余 7 条各有归属：新增的已修且绿，既有的写进本任务的收尾记录，含 main 基线
   run 的编号作为依据。
5. `npm run typecheck` 通过；改动文件 `lint` / `format` 通过。
