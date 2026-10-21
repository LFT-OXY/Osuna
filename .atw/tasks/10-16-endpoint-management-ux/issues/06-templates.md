# 06 — 模板：厂商与中转服务

**What to build:** 点「+」先出模板列表，选一家只贴 key。

- 模板清单由 daemon 持有、随版本内置、经新 RPC 发给客户端（prd 第 6、7 条）：照 magpie `presets.go`，去掉 5 个决策模型、Remote magpie、Google Vertex；Google Gemini 官方等子任务 7；Bedrock、Azure 归 07 号工单，本机模板归 08 号。每个模板有分组、各格式地址、区域或套餐、「去拿 key」链接、官网、models.dev id、可提示的额外请求头（提示本身在 22 号工单显示）。
- 接口新字段 `templateId`、`region`。
- 添加流程：模板列表（搜索；厂商 / 中转服务 / 本机三组；第一项「自定义」即现在的空白表单；搜不到时空状态）；国际站与中国站合成一行，表单里切「国际 / 中国」；有套餐的切「套餐」；切换时只保留 key；表单顶上「去拿 key ↗」跟着区域或套餐变。
- 接口页「再加一家」：用同一模板打开新表单，名称避让用 05 号的规则。
- 图标：从 magpie `icons` 目录拷入模板用到的图标，按模板 id 取，取不到用名称首字；模型家族已有图标照旧；拷入的文件与借鉴的模板清单记进 `THIRD_PARTY_NOTICES`，借鉴文件头保留 MIT 声明。
- 主机没声明新能力位时，「+」直接打开现在的表单。

**Blocked by:** 02
**Status:** ready-for-agent
**Impl:** done

- [x] 端到端：模板清单 RPC 返回的模板数与分组符合 prd 第 7 条的收录范围（不含 Bedrock、Azure、本机，由 07、08 号补）。
- [x] 端到端：用模板保存的接口地址与模板一致，记下 `templateId` 与 `region`；切换区域后保存，地址换成那个区域的。
- [x] 浏览器测试：选模板、切区域 / 套餐（key 保留）、「去拿 key」链接随之变化、「再加一家」、「自定义」走老表单；搜索与空状态。
- [ ] UI: 模板列表 / 默认 / 桌面 1280 与窄窗口 390 — 三组、搜索框、「自定义」在第一项、品牌图标清楚。
- [x] UI: 添加窗口 / 有区域与套餐的模板 / 窄窗口 390 — 两个切换和「去拿 key ↗」都可见，不是蓝色链接。
- [x] 新文案 9 种语言齐全，中文是真翻译，用词与 `docs/glossary.md` 一致，资源测试通过。
- [x] 截图用无头浏览器在临时目录里拍，不碰真实的 `~/.claude`、`~/.codex`（开工前确认用户已同意这种拍法）。
- [x] 新功能只在主机声明 `apiEndpointManagement` 时出现；协议新字段都可选，协议兼容测试通过。
- [x] `npm run typecheck`、`npm run lint` 通过，改到的测试文件本机通过。

参考：prd.md 第 6–9 条，用户故事 1–9、25；decisions.md R1-Q3、R2-Q2；magpie `internal/provider/presets.go`、app `pairTile`。

实现时凡本工单没写明的细节，先查 magpie `7597c132` 的做法并照做；比 magpie 少做或更严一律不行，除非 prd 写明。
