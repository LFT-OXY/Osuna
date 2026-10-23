# 08 — 套餐窗口第一批：GLM、Kimi Code、MiniMax、OpenCode Go 与配速

**What to build:** 用 GLM Coding Plan、Kimi Code、MiniMax、OpenCode Go 套餐 key 的接口，详情分区列出每个窗口的名称、已用 / 剩余（和套餐用量其他地方用同一个选择）、进度条、「重置于」和配速；列表行显示剩得最少的那个窗口，同时有余额时也显示窗口。GLM 的 key 过期时提示去哪换。

**Blocked by:** 01
**Status:** ready-for-agent
**Impl:** done

- [x] 按主机名与路径认套餐，请求与取值照 magpie `planquota.go`（`research/decisions.md`「套餐窗口」）：GLM 的 MCP 月度放一旁；Kimi Code 的 `usage` 记为 7 天；MiniMax 非 general 桶加前缀放一旁、不限 / 用完；OpenCode Go 也认 `/inference/go`、0% 的重置时间丢弃、401 / 403 专门提示；GLM 401 或 1000–1005 的换 key 提示。
- [x] 套餐请求只带认证、`Accept: application/json`、`Accept-Language: en-US,en` 与 Osuna User-Agent，不带接口的自定义请求头。
- [x] 窗口沿用套餐用量现有的窗口形状；daemon 按 magpie `window_pace.go` 算配速填进窗口的配速字段，月窗口起点取一个自然月前。
- [x] 端到端测试：每家一个本机假服务，验证请求与窗口、重置时间、配速；GLM 过期提示；列表行取剩得最少的窗口。配速另有单元测试。（列表行在界面里挑，由界面单元测试与浏览器测试验，见 `research/decisions.md`。）
- [x] `docs/usage.md` 读余额一节写进套餐窗口的地址与所带内容。`docs/glossary.md` 收「配速」「重置于」。
- [x] 9 种语言的新文字齐全。
- [x] 浏览器测试：窗口显示、已用 / 剩余切换。
- [x] UI：详情分区 / GLM 两个窗口加放一旁的 MCP、MiniMax 多桶 / 1280 与 390 — 窗口条、重置时间、配速不重叠，复用套餐用量的窗口条。
- [x] UI：列表页 / 套餐 key 行 / 390 — 窗口小段不截断接口主名称。

参考：prd 第 1、2、10、28 条，用户故事 33–35、37、38、44、45、47、48。

实现时凡本工单没写明的细节，先查 magpie `7597c132` 的做法并照做（出处见 `research/decisions.md`）；比 magpie 少做或更严一律不行，除非 prd 写明。
