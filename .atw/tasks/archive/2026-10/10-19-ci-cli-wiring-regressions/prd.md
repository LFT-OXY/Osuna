# 修复线上检查：子任务 2 带进来的 4 组失败

来源：2026-10-19 把 `archive/2026-10/10-16-cli-wiring-web-search`（连同子任务 1）推送到 main（a5ed6d02f）后，CI 运行 39216198336 多出 4 组失败。此前最近十几次 CI 都没有这几组；上一次 main 的 CI（d8948dad2）server-tests 两个平台都是绿的。Nix、Nix Update Hash 是已知常红，不在本任务内。

在修复分支 `fix/ci-cli-wiring-regressions` 上做，经合并请求合回 main。合并后 CI 通过，就补勾 10-16-cli-wiring-web-search 的 prd.md 里「合入后 CI 通过」那一条。

## Problem Statement

1. **工作区恢复坏了**（playwright shard 4，`worktree-restore.spec.ts` 3 条，重试也挂）：10-16 任务 14 号工单让「取消归档」（`refresh_agent_request`）续不上时把 Agent 放回归档（`session.ts` 的 `handleRefreshAgentRequest`）。工作区恢复依赖原来的行为：工作区目录已删时取消归档会因 cwd 不在而续不上，但 Agent 仍算取消归档。现在 Agent 被放回归档，`archivedAt` 一直不为空。这是真实功能回归。
2. **启动代码出现提供方名字**（server-tests ubuntu 与 windows）：`src/terminal/agent-hooks/claude/claude.test.ts` 的「keeps provider names out of the generic server bootstrap」要求 `server/bootstrap.ts` 不含任何 agent hook 提供方 id。16 号工单在那里加了 `claudeManagedSettingsDir`。
3. **Windows 上 3 个测试**（server-tests windows）：
   - `cli-bypass.test.ts`「a file that can't be written leaves the request alone and keeps the time in memory」：期望启动时读文件报一条「Couldn't read…」，Windows 上没有（父路径是文件时 Windows 报的错误不是 ENOTDIR 一类）。
   - `login-shell-env.test.ts` 两条（「asks the login shell…」「also asks fish and nushell…」）：Windows 上读出空对象。
4. **上下文用量悬浮卡多拉一次**（playwright shard 2，`context-window-meter.spec.ts:245` 深色那条，重试也挂）：期望打开卡片只请求一次这个 Agent 的用量，实际两次，第二次没有预设回答，测试夹具报「The test scripts every agent usage request.」原因未查。

## Acceptance Criteria

- [x] 4 张工单都完成；改到的测试文件本机通过。
- [x] 合并请求的 CI 里上面 4 组都通过（Nix 两项除外）；偶发失败按 `rerun --failed` 重跑确认。
- [ ] 合回 main 后，补勾 `archive/2026-10/10-16-cli-wiring-web-search/prd.md` 的「合入后 CI 通过」。

## Out of Scope

- Nix、Nix Update Hash 两项常红。
- 只重跑就过的偶发失败（例如这次的 `model-search-in-provider.spec.ts:268`）。

## 收尾记录（10-19）

- PR #21 经 merge commit 合入 main（27f65d163）。PR 的 CI 里 4 组都通过；shard 4 新挂的 `session-history-codex-model-provider.spec.ts:362` 按用户决定 `rerun --failed` 后通过。
- 合并后 main 的 CI（39239955688）里同一 spec 的 332 连挂两遍，所以第三项（补勾 10-16 的「合入后 CI 通过」）没做。用户决定先归档本任务，这个问题另开 `10-19-unarchive-refused-hint-flaky` 查。

