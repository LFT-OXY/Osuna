# 07 — Bedrock 与 Azure 模板

**What to build:** Amazon Bedrock、Azure OpenAI 也能从模板添加。

- Bedrock：用 Bedrock API key（不做 SigV4），10 个区域；Claude 走 Anthropic 格式、只发 `x-api-key`，其余走 Chat / Responses、发 Bearer；没有清单接口，用内置模型清单。
- Azure：填自己资源的地址，统一走 `/openai/v1`；key 放 `api-key` 头（Anthropic 格式例外，用 `x-api-key`）；先列 `deployments?api-version=2022-12-01`，失败再列 `/v1/models`。
- 这两种的认证头写法由 `templateId` 决定，中转站转发、测试、拉模型都照此。

**Blocked by:** 06
**Status:** ready-for-agent
**Impl:** ready

- [ ] 端到端：假 Bedrock 上游收到的认证头按格式正确；拉模型返回内置清单、不发清单请求。
- [ ] 端到端：假 Azure 上游收到 `api-key` 头；部署列表成功时用它、失败时退到 `/v1/models`。
- [ ] 浏览器测试：两种模板的添加成功与失败。
- [ ] UI: 添加窗口 / Bedrock 选区域 / 窄窗口 390 — 区域选择可见；Azure 地址框说明要填自己的资源地址。
- [ ] 新文案 9 种语言齐全，中文是真翻译，用词与 `docs/glossary.md` 一致，资源测试通过。
- [ ] 截图用无头浏览器在临时目录里拍，不碰真实的 `~/.claude`、`~/.codex`（开工前确认用户已同意这种拍法）。
- [ ] 新功能只在主机声明 `apiEndpointManagement` 时出现；协议新字段都可选，协议兼容测试通过。
- [ ] `npm run typecheck`、`npm run lint` 通过，改到的测试文件本机通过。

参考：prd.md 第 7 条，用户故事 10、11；magpie `internal/provider/presets.go:368-400`、`azure.go`、`test.go:452-477`、`account.go:160-172`。

实现时凡本工单没写明的细节，先查 magpie `7597c132` 的做法并照做；比 magpie 少做或更严一律不行，除非 prd 写明。
