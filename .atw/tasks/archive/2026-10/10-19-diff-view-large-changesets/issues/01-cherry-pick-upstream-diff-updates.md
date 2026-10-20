# 01 — 摘取上游修复：第一次改动后 Diff 不再更新

**What to build:** 把上游 be0acb293（#6745 "fix(app): keep Diff updates alive after the first edit"）原样摘进 Osuna。修好以后，干净的 checkout 第一次出现改动时，被隐藏的保留面板不再取消可见 Diff tab 的订阅，Changes 面板会跟着后续改动持续更新。后面测性能时，刷新必须是活的，所以这张排第一。

只摘这一条，不带上游 0.11.2 之后的其他提交（prd Out of Scope）。用 `git cherry-pick -x` 保留来源，便于以后合并上游时 git 认出是同一改动。

**Blocked by:** None
**Status:** ready-for-agent
**Impl:** done

- [x] be0acb293 的改动（push-router 与它的单测、新增的 changes-first-edit 浏览器用例）进入 Osuna，提交信息带上游来源。
- [x] 若有冲突，按上游意图解决，并在提交说明里写明解决了哪里。
- [x] push-router 单测通过；changes-first-edit 浏览器用例在本机 `packages/app` 下按单文件跑通过（跑不通且属于已知本机限制时，写明原因交 CI）。
- [x] typecheck、lint 通过。

**实现记录（2026-10-19）：** `git cherry-pick -x` 无冲突，提交 3c8f957da。push-router 单测 9/9 通过；typecheck、lint 通过。changes-first-edit 浏览器用例本机跑了 4 次：前 3 次（机器同时跑着别的任务）分别 1/3、2/3 过、失败点之一是编辑前「Committed」视图转圈超 10 秒，第 4 次 3/3 全过（45.6s）；撤掉修复的对照组 3/3 全挂。
