# 01 — 中转站收 Pi / OMP 的请求

**What to build:** 内置中转站多一个 OpenAI Chat 入口，并能凭中转站口令认出 Pi、OMP。Pi / OMP 打 Chat、Responses、Anthropic 三个入口中的任一个，都和 Claude Code、Codex 一样选接口、换真 key、翻译格式、自动切换、粘在同一家、记进账本。本工单不改界面，由测试程序扮演 Pi / OMP 验证。

**Blocked by:** None — can start immediately
**Status:** ready-for-agent
**Impl:** ready

- [ ] 服务端「支持第三方接口的提供方」扩到 Claude Code、Codex、Pi、OMP：Pi、OMP 各有一个中转站口令（生成方式同现有两家）；按两家穷举的表都扩到四家；界面与协议的开放留给 02。
- [ ] `POST /v1/chat/completions` 只收本机回环、不带转发头的请求，网页来的回 403；其他未知路径仍回 404。
- [ ] 认调用方靠口令：带 Pi 口令打三个入口都认成 Pi，带 OMP 口令都认成 OMP；口令对不上照 ADR 0010 按 User-Agent；Chat 入口仍认不出时按 Pi 记。
- [ ] 补推理档位时按这次请求所在入口的格式，不按 Agent 的默认格式（Pi 打 Chat、Responses、Anthropic 都对）。
- [ ] Chat 请求翻译到 Anthropic、Responses、Chat 三种上游都能用；流式回复按 Chat 格式回，含思考、工具调用、用量；被拒、拒答、断流时回 Chat 格式的错误；一家失败时自动切换。
- [ ] 只装工具、没有内容的 system / developer 消息：工具按名字去重并入顶层 `tools`，这条消息丢掉（照 magpie `message_tools.go`）。
- [ ] 直转给 Chat 上游时 `developer` 改成 `system`。
- [ ] 中转站认得的会话头加上 `x-session-affinity`；带同一会话头的请求粘在同一家。
- [ ] 账本的 Agent 取值扩到 Pi、OMP；Chat 回复的回复编号记写回给 CLI 的 Chat `id`。
- [ ] 测试：daemon 端到端测试（先例：中转站测试、Claude Code / Codex 接入测试）覆盖以上每一条；Chat 翻译套件、粘性套件加用例。
- [ ] 文档：ADR 0007 补上 Pi、OMP 走 Chat 入口；ADR 0010 补上 Chat 入口与按口令认 Pi / OMP；借鉴 magpie 的文件顶上留 MIT 声明，`THIRD_PARTY_NOTICES` 补上。

参考：prd「中转站：Chat 入口」，用户故事 1–11。

实现时凡本工单没写明的细节，先查 magpie `7597c132` 的做法并照做（出处见 `research/decisions.md`，源码在 `/tmp/magpie-7597`，不在就重新克隆 yetone/magpie 切到该提交）；比 magpie 少做或更严一律不行，除非 prd 写明。测试绝不读写真实的 `~/.pi`、`~/.omp`，不运行真的 Pi / OMP。
