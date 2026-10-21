# 取消归档续不上时，线上检查里提示偶尔不出来

## Goal

合并 10-19-ci-cli-wiring-regressions 后，session-history-codex-model-provider.spec.ts 的 332、362 两条（取消归档一个 Codex 服务商被删的 Agent，应弹出错误与「挪动对话」）在线上 Linux 上时挂时过、重试也挂，本机复现不出来；查清原因再修

## Requirements

- TBD

## Acceptance Criteria

- [ ] TBD

## Notes

已知线索（10-19，discover 时从这里接着查）：

- 三次 CI：PR #21 第一次（39228975975）362 连挂两遍、重跑 shard 4 通过；合并后 main（39239955688，27f65d163）332 连挂两遍。修复前 a5ed6d02f 的 CI（39216198336）两条都过，只有这一个对照。
- 症状一样：`unarchiveUntilRefused` 点「Unarchive」后 `agent-unarchive-error` 一直不出来，归档提示消失，最后页面是「Workspace unavailable」、侧栏「No projects yet」；浏览器控制台有 `Unknown agent '<id>'`（viewed timeline synchronization failed）。失败截图与 trace 在 CI 产物 playwright-results-4。
- 可疑改动：ea9d6e10a（工单 01）让 `handleRefreshAgentRequest`（`session.ts`）只在 `isCodexModelProviderMissing` 时放回归档。照代码看这两条的报错应当就是服务商不在，按理不受影响，未证实。
- `session.ts` 里 `reloadOrResumeAgentForRefresh` 的注释提到取消归档先发布记录、Agent 页可能抢先加载（`ensureAgentLoaded` 共用进行中的加载）；时机竞争是候选方向。
- 本机（macOS）重建 server dist 后整个 spec 跑 40+ 次全过。注意浏览器测试的 daemon 用 `packages/server/dist`，改 server 后要先 `npm run build:server`。
- CI 的 trace 里 WebSocket 没被拦截，看不到 daemon 消息；要看实际报错得在 CI 上加临时日志或上传 daemon.log。
