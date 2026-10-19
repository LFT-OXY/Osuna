# 04 — 上下文用量悬浮卡只拉一次用量

**What to build:** 打开上下文用量悬浮卡时，这个 Agent 的用量只请求一次。CI 的 `packages/app/e2e/browser/context-window-meter.spec.ts:245`（深色）第 261 行期望 `[agentId]`，实际两次，第二次没有预设回答，夹具报「The test scripts every agent usage request.」（`e2e/support/helpers/context-window.ts:173`）。先查清多出的那次从哪来、是不是 10-16 任务（或子任务 1）的改动引起的，再修。

**Blocked by:** None
**Status:** ready-for-agent
**Impl:** done

- [x] 原因写进本票 Comments（哪次提交、哪段代码多发了请求）。
- [x] `context-window-meter.spec.ts` 本机通过，浅色、深色都过；连跑 3 次不挂。
- [x] 如果原因是测试本身的竞态而不是代码多发，先停下问用户再改测试。
- [x] `npm run typecheck`、`npm run lint` 通过，改到的测试文件本机通过。

## Comments

- 多出的请求是谁发的：CI 运行 39216198336 第二次尝试的 trace 里，顺序是 Composer 用量条先问一次（夹具排除）→ 悬浮卡问一次（`bf9aa4f8…`，第一张卡片已到）→ 悬浮卡的「套餐用量」段被重建，`useAgentUsage`（`usage/queries.ts`）又问一次。这条查询 `gcTime: 0` 且消费 `signal`，按上游设计卸载即丢、重挂必重取，所以第三次没有预设回答，夹具抛错，卡片停在「Loading plan usage...」（失败截图可见）。第一次尝试是同一件事发生在两张卡都到之后，所以断言看到两个 agentId。
- 哪次提交引起：没找到。`d8948dad2..a5ed6d02f` 没动悬浮卡、用量条、用量查询、`hover-card.tsx`、`context-window-details.tsx`；上一次 main 的 CI（d8948dad2）shard 2 这条通过；更早的失败 CI 里也没出现过。trace 里悬浮卡打开时正好收到一串 `providers_snapshot_update`（claude / codex 从 loading 变 ready），本机这一步早就结束，推测是时机撞上，未验证。
- 本机：浅色、深色各 1 次，深色 `--repeat-each=10` 共 12 次全过，复现不出来。
- 用户决定（10-19）：先当偶发处理，本票不改代码也不改测试；合并请求的 CI 里这条再挂就照惯例 `rerun --failed`，仍稳定挂再回来深挖。
- 没改代码，typecheck / lint 项不适用，勾掉。

