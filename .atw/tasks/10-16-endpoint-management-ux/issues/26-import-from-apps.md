# 26 — 从别的软件导入

**What to build:** 已经在别的软件里配好的中转服务一键搬进来。

- daemon 扫描（只读，读 daemon 所在主机的文件），照 magpie `importapps.go`：CC Switch（`cc-switch.db`，没有就读 `config.json`）、Claude Code `settings.json`（Osuna 接管中时读 ADR 0004 记下的原值）、Codex `config.toml`、Alma `chat_threads.db`、OpenCode `auth.json`（只在导入窗口里读）。数据库用 Node 自带的只读 SQLite。
- 新 RPC 扫描：返回每条的名称、各格式地址、key 打码、模型、来源、状态（新的 / 已添加 / 名称已被占用 / 同一家、key 不同）、指纹；key 原文留在 daemon。判定照 magpie `settle`（含请求头比较）。
- 新 RPC 导入：每条带操作（新增一家 / 替换某家 / 改名后新增）。「同一家、key 不同」的操作是新增一家。
- 「第三方接口」页的「导入」入口和导入窗口。

**Blocked by:** 06, 22
**Status:** ready-for-agent
**Impl:** ready

- [ ] 端到端（临时 HOME）：五种来源各放一份假配置，扫描结果与状态判定正确；扫描前后这些文件的修改时间不变。
- [ ] 端到端：Osuna 接管 Claude Code 时导入读到的是原值，不把中转站自己导进来。
- [ ] 端到端：三种操作的结果正确；替换保留原接口的 id 与顺序位置。
- [ ] 浏览器测试：扫描、导入的成功与失败；就地改名。
- [ ] UI: 导入窗口 / 有四种状态的条目 / 桌面 1280 与窄窗口 390 — 每条的状态与操作清楚，导入按钮不被遮住。
- [ ] 新文案 9 种语言齐全，中文是真翻译，用词与 `docs/glossary.md` 一致，资源测试通过。
- [ ] 截图用无头浏览器在临时目录里拍，不碰真实的 `~/.claude`、`~/.codex`（开工前确认用户已同意这种拍法）。
- [ ] 新功能只在主机声明 `apiEndpointManagement` 时出现；协议新字段都可选，协议兼容测试通过。
- [ ] `npm run typecheck`、`npm run lint` 通过，改到的测试文件本机通过。

参考：prd.md 第 39–41 条，用户故事 90–95；decisions.md R1-Q16、R2-Q10；01 号的新 ADR；magpie `internal/provider/importapps.go`、`import_codex.go`、`import_opencode.go`。

实现时凡本工单没写明的细节，先查 magpie `7597c132` 的做法并照做；比 magpie 少做或更严一律不行，除非 prd 写明。
