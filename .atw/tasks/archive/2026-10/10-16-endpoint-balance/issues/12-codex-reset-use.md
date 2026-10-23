# 12 — Codex 重置卡：用掉一次

**What to build:** Codex 卡片上有「用掉一次重置」：先弹确认框写明用掉后不能撤回；确认后 Osuna 用掉最早过期的那张，显示结果（几个窗口从头开始 / 没有窗口用过所以留着这张 / 已没有重置 / 这张已经用过），卡片随即更新。

**Blocked by:** 11
**Status:** ready-for-agent
**Impl:** done

- [x] 套餐用量来源的注册接口新增可选操作「用掉一次重置」，只有 Codex 的来源实现：先读清单挑最早过期的那张（读不到就不用并说明），再 POST `wham/rate-limit-reset-credits/consume`，正文带这张的 id 与随机 UUID v4 幂等 id；回 `code` 与 `windows_reset`；之后清掉这个账号的缓存并重读。Osuna User-Agent。
- [x] 新 RPC 在 `usage.` 下（带点命名，ADR 0006），参数是报告 ID，返回结果代码与说明；新能力位 `server_info.features.planUsageResets`，没有它时不显示按钮。
- [x] 进行中、成功、失败三种状态；失败信息留在原处直到重试或关掉。
- [x] Codex 来源的测试：挑最早过期的、幂等 id、四种结果代码、清单读不到就不用、登录文件一字不改。浏览器测试用假的套餐用量来源：确认框、取消不发、成功与失败。
- [x] `docs/usage.md` 写进用掉重置的请求，写明这是 Osuna 用 CLI 的登录改变账号状态（不改登录本身）、只在用户确认后发；`docs/plugins.md` 写进注册接口的新操作。
- [x] 9 种语言的新文字齐全。
- [x] UI：Codex 卡片 / 按钮、确认框、结果 / 1280 与 390 — 确认框写明不能撤回，主要操作不被遮住。

参考：prd 第 25–27 条，用户故事 70–72、76。

实现时凡本工单没写明的细节，先查 magpie `7597c132` 的做法并照做（出处见 `research/decisions.md`）；比 magpie 少做或更严一律不行，除非 prd 写明。
