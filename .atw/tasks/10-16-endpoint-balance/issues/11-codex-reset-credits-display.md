# 11 — Codex 重置卡：显示次数与过期时间

**What to build:** ChatGPT 账号持有额度重置次数的 Codex 用户，在 Codex 的套餐用量卡片（侧边栏「套餐用量」与用量页）上看到「还有 N 次重置 · 最早 {时间} 过期」，悬停或展开看每张的过期时间；读不到过期时间时只显示次数。

**Blocked by:** None — can start immediately
**Status:** ready-for-agent
**Impl:** ready

- [ ] Codex 的套餐用量来源从已在请求的 `wham/usage` 回复里读 `rate_limit_reset_credits.available`；有次数时另 GET `wham/rate-limit-reset-credits`（同一份 Codex 登录，带账号 id 头，4 秒超时，失败只留次数），最早过期的在前、永不过期的在后；清单张数与次数不符时不列每张。新请求写 Osuna User-Agent。
- [ ] 套餐用量报告新增可选的「重置次数」：次数、最早过期时间、每张过期时间、是否按窗口计（智谱团队用，与 09 同一形状）。旧客户端不受影响。
- [ ] Codex 套餐用量来源已有的测试加用例：读次数、读清单、清单失败只留次数、张数不符不列每张、登录文件一字不改。
- [ ] `docs/usage.md` 写进重置清单这次请求（发往 `chatgpt.com`，带 Codex 的登录，套餐用量卡片读取时发）。`docs/glossary.md` 收「重置次数」。
- [ ] 9 种语言的新文字齐全。
- [ ] UI：套餐用量弹窗与用量页的 Codex 卡片 / 有重置次数 / 1280 与 390 — 次数与最早过期时间可见。

参考：prd 第 24 条，用户故事 68、69、73。

实现时凡本工单没写明的细节，先查 magpie `7597c132` 的做法并照做（出处见 `research/decisions.md`）；比 magpie 少做或更严一律不行，除非 prd 写明。
