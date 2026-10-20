# 20 — 按 Claude Code / Codex 的样子测

**What to build:** 用「只允许某 CLI」的分组的用户能测 key 在那种分组里能不能用。

- 中转站每放行一次 Claude Code 或 Codex 的请求，就把请求头记成该 CLI 的最新样本：去掉认证、会话、线程、`anthropic-beta`、Cookie 等（照 magpie `test_as.go` 的名单），只存头不存正文，写法照持久化规范。
- 测试模型 RPC 加两种测法：按 Claude Code 只走 Anthropic 格式，只对模板分组是「中转服务」或用「自定义」添加的接口开放；按 Codex 走 Responses，没有就走 Chat，不限地址；还没有 Codex 样本时用 Osuna 已有的 ChatGPT 后端那套 Codex 请求头。没有 Claude Code 样本时拒绝，并说明要先用 Claude Code 经过一次中转站。
- 这是总任务第 15 条的例外，范围与理由以 01 号的新 ADR 为准。

**Blocked by:** 19, 01
**Status:** ready-for-agent
**Impl:** done

- [ ] 端到端：假 Claude Code 请求经过中转站后样本落盘，敏感头不在样本里；按 Claude Code 测时假上游收到样本里的头。
- [ ] 端到端：没有 Claude Code 样本时拒绝并给原因；官方地址的接口不提供按 Claude Code 测。
- [ ] 端到端：没有 Codex 样本时用 Codex 请求头那一套。
- [ ] 浏览器测试：两种测法的成功、失败与被拒。
- [ ] UI: 接口详情页 / 没有 Claude Code 样本 / 窄窗口 390 — 原因说明完整可读。
- [ ] 新文案 9 种语言齐全，中文是真翻译，用词与 `docs/glossary.md` 一致，资源测试通过。
- [ ] 截图用无头浏览器在临时目录里拍，不碰真实的 `~/.claude`、`~/.codex`（开工前确认用户已同意这种拍法）。
- [ ] 新功能只在主机声明 `apiEndpointManagement` 时出现；协议新字段都可选，协议兼容测试通过。
- [ ] `npm run typecheck`、`npm run lint` 通过，改到的测试文件本机通过。

参考：prd.md 第 5、30 条，用户故事 65–67；decisions.md R2-Q5、R3-Q1；01 号的新 ADR；magpie `internal/provider/test_as.go:14-126`。

实现时凡本工单没写明的细节，先查 magpie `7597c132` 的做法并照做；比 magpie 少做或更严一律不行，除非 prd 写明。
