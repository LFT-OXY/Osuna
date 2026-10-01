# 01 — 默认启用改为 Claude Code、Codex、Pi、Oh My Pi

**What to build:** 用户第一次用（config 里没写过任何 `enabled`）时，Claude Code、Codex、Pi、Oh My Pi 是启用的，Copilot 和 OpenCode 是停用的。已经在 config 里显式写过 `enabled` 的提供方保持原样，不做迁移。CHANGELOG 里要写明这次变化，以及怎么把 Copilot 和 OpenCode 重新打开。

**Blocked by:** None — can start immediately
**Status:** ready-for-agent
**Impl:** done

- [x] 全新配置下，快照里 claude、codex、pi、omp 的 `enabled` 为 true，copilot、opencode 为 false
- [x] config 里显式写了 `enabled: true` 的 copilot 或 opencode 仍然是启用的
- [x] 有 daemon e2e 测试覆盖上面两条
- [x] 其他依赖原来默认值的测试已经相应修改
- [x] `CHANGELOG.md` 里写了一句：Copilot 和 OpenCode 改为默认关闭，以及怎么重新启用
- [x] typecheck 和 lint 都通过
