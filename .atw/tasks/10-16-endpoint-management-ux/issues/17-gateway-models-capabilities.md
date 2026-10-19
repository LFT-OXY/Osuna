# 17 — 中转站模型列表带能力信息

**What to build:** 读中转站 `/v1/models` 的程序拿得到模型资料。

- 每条带 `display_name`、`reasoning`、`supported_reasoning_levels`、`context_window`、`context_length`、`max_input_tokens`、`max_output_tokens`、`modalities`，值按 13 号的取值顺序（照 magpie `gateway.go:827-865`，Cursor 专用字段不加）。

**Blocked by:** 13
**Status:** ready-for-agent
**Impl:** ready

- [ ] 端到端：中转站 `/v1/models` 每条带上述字段，手改的值生效；已禁用的模型不在列表里（16 号做完后补这一条断言，或在 16 号里补）。
- [ ] 新功能只在主机声明 `apiEndpointManagement` 时出现；协议新字段都可选，协议兼容测试通过。
- [ ] `npm run typecheck`、`npm run lint` 通过，改到的测试文件本机通过。

参考：prd.md 第 25 条，用户故事 60；magpie `internal/gateway/gateway.go:827-865`。

实现时凡本工单没写明的细节，先查 magpie `7597c132` 的做法并照做；比 magpie 少做或更严一律不行，除非 prd 写明。
