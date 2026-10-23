# 06 — 中转站的账户余额：令牌与用户 ID

**What to build:** new-api 用户在「高级」里另填账户令牌和「用户 ID」，sub2api 用户另填登录令牌，就能看到整个账户的余额；sub2api 的 key 级地址另出 5 小时 / 1 天 / 7 天窗口。令牌粘错地址时提示该改用哪个地址并有「改用 …」按钮；缺用户 ID 时提示补上。AiHubMix 填了令牌就查账户余额。复制接口时令牌与 key 一样可沿用。

**Blocked by:** 05
**Status:** ready-for-agent
**Impl:** done

- [x] 新机密「账户令牌」存在 key 文件里，只有 daemon 读；客户端只看到有没有与打码，可显示原文（同 key 的读回）；保存请求可写可清；复制时按「沿用哪家」拷贝。新字段「用户 ID」存在余额设置里。
- [x] 令牌发法照 magpie（形如 JWT 加 `Bearer `，其余原样）。用户 ID 只在查余额时作为 `New-Api-User` 发出，接口请求头里已有的也认，二者都有以用户 ID 为准；聊天请求不带用户 ID。
- [x] new-api `success:false` 不论状态码都算令牌被拒，消息提到 New-Api-User 时加补用户 ID 的提示；填了账户级地址没填令牌时改查同站点的 key 级地址；令牌配 key 级地址时报错并给该改用的地址。
- [x] sub2api `/v1/usage` 的 `rate_limits` 出三个窗口（USD、带重置时间）；没有 `remaining` 时余额取窗口剩余的最小值。
- [x] AiHubMix 有令牌时查 `/api/user/self`，`data.quota / 500000`。
- [x] 端到端测试：以上各条；列表、读余额、查询余额的 RPC 回复与日志里没有令牌原文。
- [x] `docs/usage.md` 写进令牌与用户 ID 发给谁；`docs/data-model.md` 写进新机密与用户 ID。`docs/glossary.md` 收「账户令牌」「用户 ID」。
- [x] 9 种语言的新文字齐全。
- [x] 浏览器测试：「改用 …」按钮改好地址、缺用户 ID 的提示。
- [x] UI：编辑窗口高级区 / 令牌打码、令牌配错地址的提示与按钮 / 1280 与 390 — 「改用 …」不是蓝色链接。
- [x] UI：详情分区 / sub2api 余额加三个窗口 / 1280 与 390 — 窗口条与重置时间不重叠。

参考：prd 第 4、16、18 条，用户故事 10、12–20、50、65、66。

实现时凡本工单没写明的细节，先查 magpie `7597c132` 的做法并照做（出处见 `research/decisions.md`）；比 magpie 少做或更严一律不行，除非 prd 写明。
