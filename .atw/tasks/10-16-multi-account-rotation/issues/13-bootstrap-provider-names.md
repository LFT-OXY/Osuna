# 13 — 通用启动代码里不能出现提供方名字（PR #32 服务端测试挂）

**What to build:** PR #32 的 CI 里 `server-tests (ubuntu-latest)` 与 `server-tests (windows-latest)` 都挂在同一条：`packages/server/src/terminal/agent-hooks/claude/claude.test.ts`「keeps provider names out of the generic server bootstrap」。这条测试把 `packages/server/src/server/bootstrap.ts` 转小写后断言不含任何 hook 提供方 ID；main（a75587c05）里一处 `claude` 都没有，本分支的多号轮换接线写进了 4 处：`claudeRuntime: () => config.agentProviderSettings?.claude`、`apiEndpointService.activeEndpointId("claude")`、`if (provider === "claude") broadcastProviderAccountsChanged()`，以及注释里的「Claude Code」。把只属于 Claude Code 的判断挪进 `provider-accounts/`（例如 bootstrap 只传通用的取设置、查当前中转端点、「某家的第三方接口开关变了」回调，由账号服务自己认 Claude），bootstrap 保持不认识任何提供方。行为不变。

同一次 CI 的 `playwright (shard 4/4)` 挂的是 `session-history-codex-model-provider.spec.ts:332`，与任务 `10-19-unarchive-refused-hint-flaky` 记的偶发同一症状（`agent-unarchive-error` 不出来），main 上也挂过，不在本单。

**Blocked by:** -
**Status:** ready-for-agent
**Impl:** done

- [x] `bootstrap.ts` 转小写后不含 `claude`、`codex` 等任何 `AGENT_HOOK_PROVIDERS` 的 ID；上面那条测试本机通过。
- [x] Claude Code「使用第三方接口」开关一动账号一节顶上的说明跟着变、Claude 运行设置照旧传进账号服务：原有覆盖这两处的测试仍通过。
- [x] 推送后 PR #32 的 server-tests 两项通过（playwright 若只挂上面那条已知偶发，重跑失败项）。
