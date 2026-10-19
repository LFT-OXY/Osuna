# 02 — 启动代码里不出现提供方名字

**What to build:** `packages/server/src/server/bootstrap.ts` 里不再出现任何 agent hook 提供方 id（16 号工单加的 `claudeManagedSettingsDir` 一类），照 2026-09-30 提交 48411967a「bootstrap 不再出现提供方名字」的做法挪到第三方接口服务或改名。行为不变。

**Blocked by:** None
**Status:** ready-for-agent
**Impl:** ready

- [ ] `src/terminal/agent-hooks/claude/claude.test.ts` 的「keeps provider names out of the generic server bootstrap」本机通过。
- [ ] 托管设置目录的测试替换（`test-utils/paseo-daemon.ts` 默认用临时托管目录）照旧生效；`api-endpoint-claude.e2e.test.ts` 里云平台开关与托管设置的用例通过。
- [ ] `npm run typecheck`、`npm run lint` 通过，改到的测试文件本机通过。
