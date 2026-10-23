# 14 — 补验收核对查出的测试缺口

**What to build:** 整体验收核对（3.1）发现三条验收标准缺测试证据。只补测试和规格文字，不改功能；补测试时若发现功能真有错，停下来告诉用户，不顺手改。

**Blocked by:** 13
**Status:** ready-for-agent
**Impl:** done

- [x] 用户故事 56：daemon 端到端测试证明「自动刷新余额与套餐用量」与「价格表自动更新」互不牵连——关掉一个，另一个照常。
- [x] 详情页「刷新」：浏览器测试覆盖进行中状态，以及刷新失败后失败信息留在原处、直到重试（`docs/testing.md`「Fallible user actions」）。
- [x] sub2api、credit grants、Kimi Code、MiniMax、OpenCode Go、Ollama Cloud 套餐窗口、Z.ai 的请求断言 `User-Agent: Osuna/<version>`；腾讯云请求断言不带 `Accept`（与 `docs/usage.md` 一致）。
- [x] 机密不泄露补测：腾讯 SecretId / SecretKey 不出现在列表与读余额的回复和日志里；火山的日志断言加上 AccessKey ID；上次读数文件里没有账户令牌与云账号密钥。
- [x] 两项都不给的旧形状保存，留着已存的云账号密钥。
- [x] 浏览器测试的封条（`packages/app/e2e/support/daemon-upgrade-seal.mjs`）加上 `https://chatgpt.com/` 兜底。
- [x] prd 验收标准「令牌、云账号密钥不出现在任何 RPC 回复与日志里」写明唯一例外：编辑窗口的「显示」按需取回原文（需要 `daemon.manage` 权限），`docs/data-model.md` 已这样写。

参考：prd Acceptance Criteria、Testing Decisions；验收核对提交 `a2fb13f1a`。

实现时凡本工单没写明的细节，先查 magpie `7597c132` 的做法并照做（出处见 `research/decisions.md`）；比 magpie 少做或更严一律不行，除非 prd 写明。
