# 02 — 合进 main（用户确认）

**What to build:** 开合并请求把分支以 merge commit 合进 main；合并后由用户决定删不删旧分支与 worktree，再从更新后的 main 开新的 worktree 做后续工单。

**Blocked by:** 01
**Status:** ready-for-human
**Impl:** done

- [x] 合并请求开在 `LFT-OXY/Osuna`，目标 main，CI 通过后以 merge commit 合并（合并由用户确认，或明确授权 AI 代做）。
- [x] 合并后本地 main 已更新；旧分支与 worktree 的删除经用户确认（删远端分支由用户手动执行）。
- [x] 后续工单在从新 main 开的分支上进行。

参考：prd.md 用户故事 3、8；「PR 合并后自动归档」已由用户关闭，合并后 worktree 不会自动删除。

## Comments

- 2026-10-21：用户本人在 GitHub 上以 merge commit 合并 PR #25（合并提交 e4b629a），本地 main 已同步到 e4b629a。用户同意：后续工单在从新 main 开的分支 `greet-user-await-task`（worktree `~/.paseo/worktrees/0x9u2djy/boring-dugong`，Osuna 开 worktree 时按会话标题自动起的名，原定名 `endpoint-ux-followups` 没用上）上做，没进 main 的工单 01 记录已带过来；新分支就绪后删旧分支与旧 worktree（jealous-bedbug），远端分支由用户在 GitHub 上删。
