# 08 — 本机模板与自选图标

**What to build:** 本机模型服务一个地址就能配好；自定义接口能选图标。

- 本机模板（Ollama、LM Studio、oMLX、MLX-Serve）：不要 key；表单只有一个「服务地址」，改它只换各格式地址的协议、主机、端口（照 magpie `local_address.go`）。
- 「自定义」添加的接口可从内置图标里选一个，或选本机一张图片；daemon 存一份图片副本，经 RPC 取回（照 magpie 的 `file:` 图标）。接口新字段 `icon`。

**Blocked by:** 06
**Status:** ready-for-agent
**Impl:** done

- [x] 端到端：用本机模板保存，改服务地址的端口后各格式地址都换了端口、路径不变。
- [x] 端到端：上传的图标能经 RPC 取回；删掉接口后副本一起删。
- [x] 浏览器测试：本机模板添加；选内置图标；选图片的成功与失败（文件太大或格式不对）。
- [x] UI: 添加窗口 / 本机模板 / 窄窗口 390 — 只有一个服务地址框，没有 key 必填的提示。
- [x] UI: 接口列表 / 自选图标 / 桌面 1280 — 行上显示所选图标。
- [x] 新文案 9 种语言齐全，中文是真翻译，用词与 `docs/glossary.md` 一致，资源测试通过。
- [x] 截图用无头浏览器在临时目录里拍，不碰真实的 `~/.claude`、`~/.codex`（开工前确认用户已同意这种拍法）。
- [x] 新功能只在主机声明 `apiEndpointManagement` 时出现；协议新字段都可选，协议兼容测试通过。
- [x] `npm run typecheck`、`npm run lint` 通过，改到的测试文件本机通过。

参考：prd.md 第 7、8 条，用户故事 103、104；magpie `internal/provider/local_address.go`、app 图标选择。

实现时凡本工单没写明的细节，先查 magpie `7597c132` 的做法并照做；比 magpie 少做或更严一律不行，除非 prd 写明。
