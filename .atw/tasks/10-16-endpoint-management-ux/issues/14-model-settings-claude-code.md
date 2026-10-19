# 14 — 模型设置写进 Claude Code

**What to build:** 手改的模型资料对 Claude Code 也生效。

- 上下文、回复上限、思考档位、压缩阈值写进 Claude Code 的设置，写法照 magpie（`CLAUDE_CODE_MAX_CONTEXT_TOKENS`、`CLAUDE_CODE_MAX_OUTPUT_TOKENS`、`CLAUDE_CODE_AUTO_COMPACT_WINDOW`、`CLAUDE_CODE_MODEL_CAPABILITIES`），按 ADR 0004 的自有键规则记录与恢复原值。
- 先核对 Osuna 现在写的 `[1m]` 与两个环境变量和 magpie 的写法是否重复，以 magpie 为准合并；合并后不手改任何设置时，写进 Claude Code 的效果与现在一致或按 magpie 更准。实现记录写明核对结果。

**Blocked by:** 13
**Status:** ready-for-agent
**Impl:** ready

- [ ] 端到端（临时 `CLAUDE_CONFIG_DIR`）：手改的四项写进 Claude Code 设置；关掉「使用第三方接口」后恢复原值。
- [ ] 端到端：不手改时写进的值与改动前对照，差异只来自照 magpie 的合并，并在实现记录里列出。
- [ ] 新功能只在主机声明 `apiEndpointManagement` 时出现；协议新字段都可选，协议兼容测试通过。
- [ ] `npm run typecheck`、`npm run lint` 通过，改到的测试文件本机通过。

参考：prd.md 第 23 条，用户故事 58；ADR 0004；magpie `internal/agent/claude.go:249-355`。

实现时凡本工单没写明的细节，先查 magpie `7597c132` 的做法并照做；比 magpie 少做或更严一律不行，除非 prd 写明。
