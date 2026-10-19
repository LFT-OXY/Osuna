# 04 — 上下文用量悬浮卡只拉一次用量

**What to build:** 打开上下文用量悬浮卡时，这个 Agent 的用量只请求一次。CI 的 `packages/app/e2e/browser/context-window-meter.spec.ts:245`（深色）第 261 行期望 `[agentId]`，实际两次，第二次没有预设回答，夹具报「The test scripts every agent usage request.」（`e2e/support/helpers/context-window.ts:173`）。先查清多出的那次从哪来、是不是 10-16 任务（或子任务 1）的改动引起的，再修。

**Blocked by:** None
**Status:** ready-for-agent
**Impl:** ready

- [ ] 原因写进本票 Comments（哪次提交、哪段代码多发了请求）。
- [ ] `context-window-meter.spec.ts` 本机通过，浅色、深色都过；连跑 3 次不挂。
- [ ] 如果原因是测试本身的竞态而不是代码多发，先停下问用户再改测试。
- [ ] `npm run typecheck`、`npm run lint` 通过，改到的测试文件本机通过。
