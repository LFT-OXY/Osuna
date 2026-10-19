# 01 — 取消归档续不上时只为「Codex 服务商不在」放回归档，工作区恢复照旧能用

**What to build:** 工作区恢复重新能用：工作区目录已删时「取消归档」续不上，Agent 仍算取消归档（10-16 任务之前的行为）。14 号工单「续不上就放回归档」只保留给续不上原因是 Codex 服务商不在（`codex_model_provider_missing`）的情况，这时报错和「挪动对话…」按钮照旧。

**Blocked by:** None
**Status:** ready-for-agent
**Impl:** ready

- [ ] `packages/app/e2e/browser/worktree-restore.spec.ts` 本机通过（尤其 226、237、440 三条）。
- [ ] `session-history-codex-model-provider.spec.ts` 里 Agent 页「取消归档」续不上、挪动后成功的用例仍通过；`codex-model-provider-move.e2e.test.ts` 里「取消归档失败仍是归档的」仍通过。
- [ ] 其他原因续不上时的行为有用例说明（Agent 取消归档、错误照旧返回）。
- [ ] `npm run typecheck`、`npm run lint` 通过，改到的测试文件本机通过。

参考：`packages/server/src/server/session.ts` 的 `handleRefreshAgentRequest`；`archive/2026-10/10-16-cli-wiring-web-search/research/implementation-notes.md` 14 节「取消归档失败放回归档」；worktree-restore.spec.ts 第 90 行起的注释。若认为别的改法更好（例如改测试），先停下问用户。
