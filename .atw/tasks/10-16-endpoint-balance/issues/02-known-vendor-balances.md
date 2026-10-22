# 02 — 其余已知厂商的余额

**What to build:** 用 Kimi（Moonshot）、OpenRouter、硅基流动、阶跃、Command Code、Ollama Cloud、AiHubMix 的接口，什么都不用填，列表行与详情分区就显示余额；DeepSeek 的多币种都列出、有余额的在前，总额下分「赠送 / 充值」；OpenCode Zen 的接口分区写「这家不给 key 查余额，请去它的控制台看」。

**Blocked by:** 01
**Status:** ready-for-agent
**Impl:** ready

- [ ] 每家的地址、取值、币种照 magpie（`research/decisions.md`「按地址认的厂商余额」）：Moonshot `.cn` ¥ / `.ai` $；OpenRouter 总额减已用；硅基流动 410 或 code 20092 说「接口已下线，去控制台看」；阶跃含代金券；Command Code 三项 credits 之和；Ollama Cloud 没有购买余额时不出这一项；AiHubMix 不填令牌查 `/dashboard/billing/remain`，值小于 0 时说 key 没设上限、提示填账户令牌（填令牌的情况在 06）。
- [ ] DeepSeek 多币种「 · 」拼接、有余额的在前、同组按币种代码排；「赠送 / 充值」拆分照 magpie 最新版 `readDeepSeekSplit`。
- [ ] OpenCode Zen 的说明照 magpie 最新版 `errOpenCodeNoBalance`，归入「这家不给查余额」。
- [ ] 端到端测试：每家一个本机假服务，验证请求地址、认证头、User-Agent 与取到的值和币种；以上特殊情况各一例。
- [ ] 端到端测试补上「这家不给查余额」（`not_offered`）一例：OpenCode Zen 是第一家能产出它的（从 01 移来，01 时 DeepSeek 产不出这一类）。
- [ ] `docs/usage.md` 读余额一节列出这些厂商的地址。
- [ ] 9 种语言的新文字齐全。
- [ ] UI：详情分区 / DeepSeek 两种币种加赠送与充值、OpenCode Zen 说明 / 1280 与 390 — 各项一行，币种符号正确。

参考：prd 第 1、2、9、16 条，用户故事 2–10、46、51。

实现时凡本工单没写明的细节，先查 magpie `7597c132` 的做法并照做（出处见 `research/decisions.md`）；比 magpie 少做或更严一律不行，除非 prd 写明。
