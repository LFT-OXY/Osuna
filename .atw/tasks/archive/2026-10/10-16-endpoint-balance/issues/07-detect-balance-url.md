# 07 — 自动识别余额地址

**What to build:** 编辑窗口「高级」区有「自动识别」：按下后 Osuna 用表单里的地址和 key 依次试 new-api 与 sub2api 的 key 级地址，试中就把地址和默认写法填进表单；都不中时就地写出两个地址各自的失败原因。只在按下时发，后台从不自动试。

**Blocked by:** 05
**Status:** ready-for-agent
**Impl:** done

- [x] 新 RPC 接受未保存的表单值，依次试 `/api/usage/token`、`/v1/usage`（拼在这家地址的站点根上：依 Chat、Anthropic、Responses 第一个 http(s) 地址的 origin，同 magpie `errKeyUsageWithToken` 与编辑器「改用 …」；`keyQueryOf` 那样保留路径前缀从接口地址推不出，见 `research/decisions.md`），取第一个回出可用读数的。
- [x] 进行中、成功、失败三种状态，失败信息留在原处直到重试或关掉。
- [x] 端到端测试：只有 new-api 中、只有 sub2api 中、都不中；daemon 不在列表读取或开机时发这两个请求。
- [x] `docs/usage.md` 写进「自动识别」（按下才发、试哪两个地址）。
- [x] 9 种语言的新文字齐全。
- [x] 浏览器测试：识别成功填入、都不中的提示。
- [x] UI：编辑窗口高级区 / 识别成功与都不中 / 1280 与 390 — 结果就地显示。

参考：prd 第 5 条，用户故事 21、22。

实现时凡本工单没写明的细节，先查 magpie `7597c132` 的做法并照做（出处见 `research/decisions.md`）；比 magpie 少做或更严一律不行，除非 prd 写明。
