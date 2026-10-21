# 25 — 厂商状态页提示

**What to build:** 官方服务出故障时在接口行上看得到。

- 新 RPC 返回各厂商状态：daemon 查 Anthropic（`status.claude.com`）、OpenAI（`status.openai.com`）、Moonshot（`status.moonshot.cn`）的 `/api/v2/summary.json`，缓存 5 分钟；DeepSeek 只给链接。「价格表自动更新」关着时不发，返回「未开启」。
- 客户端只在「第三方接口」页或用量页开着时每 5 分钟调一次；接口按各格式地址的主机名对上厂商。
- 接口行上「{厂商} 官方报告服务异常」与「状态页 ↗」。

**Blocked by:** 02
**Status:** ready-for-agent
**Impl:** done

- [x] 端到端：假状态页返回降级时 RPC 报降级；5 分钟内不重复请求；开关关着时不发请求。
- [x] 浏览器测试：降级时行上出提示与链接；正常时不出；RPC 失败时不影响列表。
- [x] UI: 接口列表 / 官方报告异常 / 桌面 1280 与窄窗口 390 — 提示与「状态页 ↗」可见，不是蓝色链接，不挤掉主名称。
- [x] 新文案 9 种语言齐全，中文是真翻译，用词与 `docs/glossary.md` 一致，资源测试通过。
- [x] 截图用无头浏览器在临时目录里拍，不碰真实的 `~/.claude`、`~/.codex`（开工前确认用户已同意这种拍法）。
- [x] 新功能只在主机声明 `apiEndpointManagement` 时出现；协议新字段都可选，协议兼容测试通过。
- [x] `npm run typecheck`、`npm run lint` 通过，改到的测试文件本机通过。

参考：prd.md 第 38 条，用户故事 87–89；decisions.md R1-Q15、R2-Q9；magpie `internal/upstream/upstream.go:43-124`。

实现时凡本工单没写明的细节，先查 magpie `7597c132` 的做法并照做；比 magpie 少做或更严一律不行，除非 prd 写明。
