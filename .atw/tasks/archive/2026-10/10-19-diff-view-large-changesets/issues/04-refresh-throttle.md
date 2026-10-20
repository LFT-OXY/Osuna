# 04 — Agent 狂改时最多每秒更新一次

**What to build:** Agent 连续改文件时，Changes 面板最多每秒更新一次；改动一停，最后一次的结果在 150ms 防抖后马上推出。界面这边也最多每秒处理一次推送，这样连着还没升级的旧 daemon 时也有效。

- daemon：`CheckoutDiffManager` 在现有 150ms 防抖之外加节流。同一个 target 两次推送至少隔 1 秒，结尾一次照常推出。现有的「正在算时又来变化就排队一次」不变。
- 客户端：收到的 diff 推送合并成每秒最多处理一次（用最后一份），并保留结尾那一次。

**Blocked by:** 02
**Status:** ready-for-agent
**Impl:** done

- [x] daemon 用例（fake timers，现有 `checkout-diff-manager.test.ts` 写法）：连续变动 5 秒，推送间隔都 ≥1 秒；变动停下后，结尾那次在约 150ms 后推出；只变一次时，延迟和改前一样。
- [x] 客户端用例（现有 `push-router.test.ts` 或订阅层测试）：1 秒内的多次推送只处理最后一份；结尾那份不丢。
- [x] 用 02 的场景复测模拟 Agent 那 1 分钟的长任务次数与最长一次，数字追加进 `research/baseline.md`。
- [x] typecheck、lint 通过。
