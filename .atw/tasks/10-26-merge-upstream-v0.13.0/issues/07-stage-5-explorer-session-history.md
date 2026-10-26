# 07 — 第五段适配：Explorer 三端统一与会话历史

**What to build:** 手机、平板、电脑用上游统一的那套 Explorer，Osuna 的会话历史标签在三端都在：手机默认预置会话历史，从会话历史开终端后切回 Agent；launcher 的主次顺序两边合并。标签底色以上游的新函数为底，换回 Osuna 的悬停与选中色值，没有关闭按钮的标签不留关闭位。手机上逻辑图第一次自动打开只加进 Explorer 的标签、不弹出。`docs/explorer-sidebar.md` 以上游为底并入会话历史与逻辑图两节。规格见 `prd.md`「Explorer」，裁决见 `research/feature-overlap.md` 3.2 第 18、19 条与 Q5。

**Blocked by:** 06
**Status:** ready-for-agent
**Impl:** ready

- [ ] 会话历史标签在桌面与手机的默认标签里，有测试。
- [ ] 手机上从会话历史开终端后切回 Agent，有测试。
- [ ] 标签底色用 Osuna 的悬停与选中色值，没有关闭按钮的标签不留关闭位，有测试。
- [ ] 手机上逻辑图第一次自动打开只加标签、不弹出 Explorer，有测试；桌面行为不变。
- [ ] `docs/explorer-sidebar.md` 已以上游为底并入会话历史与逻辑图两节。
- [ ] typecheck 和 lint 通过；改到的测试文件逐个单独跑过并通过（不跑整套）。
- [ ] 没有 Osuna 的断言被删除或放宽；必须跟着改的断言逐条记在 `## Comments` 下，供 14 写 PR 正文用。
- [ ] UI：dev 桌面端 1280 宽 / Explorer 标签栏与 launcher 展开 — 截图上有会话历史标签，标签的高度、圆角、选中态与工作区标签是同一种。
