# 22 — 请求头、附加请求体与 key 放在哪个头

**What to build:** 接入要求特殊的中转服务。

- 接口新字段 `headers`、`extraBody`、`keyHeader`（缺省 `both`）。
- 请求头对这家所有请求生效：中转站转发、测试连接、自动识别、拉模型、测试模型。用户的头在 Osuna 填的之后写，大小写不同也算同名；`anthropic-beta` 按逗号合并去重、CLI 原有的在前；用户填了认证头时不触发 ADR 0008 的「两个认证头被拒就改用一个」。
- 附加请求体对 Messages、Chat、Responses 生效，直连与互译后都算，只数 token 的请求不带；保留字段、`!` 覆盖、`${sessionId}`（取会话头，没有就由首条用户消息推导；测试与识别用 `osuna-test-` 加随机串）照 magpie `extrabody.go`；保存时拒收含保留字段的，表单当场提示。
- key 头：两个都放 / 只放 x-api-key / 只放 Bearer，只对第三方 Anthropic 地址显示与生效。
- 模板可提示的额外请求头（06 号带的数据）在这里显示成提示。

**Blocked by:** 19
**Status:** ready-for-agent
**Impl:** done

- [ ] 端到端：用户头覆盖认证头、`anthropic-beta` 合并；拉模型、测试连接、测试模型也带这些头。
- [ ] 端到端：附加请求体的补字段与 `!` 覆盖、`${sessionId}` 同一对话每轮相同；含保留字段时保存被拒并给原因。
- [ ] 端到端：key 头三种下假上游收到的头正确；用户填了认证头时被拒不再改单头重发。
- [ ] 浏览器测试：三项设置的成功与失败（含保留字段提示）。
- [ ] UI: 编辑窗口 / 请求头与附加请求体 / 桌面 1280 与窄窗口 390 — 编辑区可用，保留字段提示就地显示，模板提示的头可见。
- [ ] 新文案 9 种语言齐全，中文是真翻译，用词与 `docs/glossary.md` 一致，资源测试通过。
- [ ] 截图用无头浏览器在临时目录里拍，不碰真实的 `~/.claude`、`~/.codex`（开工前确认用户已同意这种拍法）。
- [ ] 新功能只在主机声明 `apiEndpointManagement` 时出现；协议新字段都可选，协议兼容测试通过。
- [ ] `npm run typecheck`、`npm run lint` 通过，改到的测试文件本机通过。

参考：prd.md 第 32–35 条，用户故事 74–80、105；decisions.md R1-Q8 与「照 magpie 直接记下的细则」；ADR 0008（01 号改过的版本）；magpie `account.go:211-258`、`extrabody.go`、`authheader.go`。

实现时凡本工单没写明的细节，先查 magpie `7597c132` 的做法并照做；比 magpie 少做或更严一律不行，除非 prd 写明。
