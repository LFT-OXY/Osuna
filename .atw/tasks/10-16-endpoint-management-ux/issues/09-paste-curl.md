# 09 — 粘贴 curl 自动填表

**What to build:** 往地址框或 key 框粘贴服务商文档里的 curl 命令，表单自动填好。

- 解析是表单模型里的纯函数，照 magpie `curlOf`：按 URL 结尾（`/chat/completions`、`/messages`、`/responses`）认格式，`respellURL` 得出地址；依次从 `Authorization: Bearer`、`x-api-key`、`api-key` 取 key；占位符判定；正文 `-d`、`--data*`、`--json` 里的 `model`；三种续行写法。
- 四条提示照 magpie（已填了哪些、URL 结尾认不出、地址里有占位符、key 只是占位符）。
- 用「自定义」添加时填地址、key、模型；用模板添加时只取 key。

**Blocked by:** 06
**Status:** ready-for-agent
**Impl:** ready

- [ ] 单元测试：magpie 的各类 curl 写法（含 PowerShell 的 `\"`、`^` 与反引号续行、各种占位符）解析结果一致。
- [ ] 浏览器测试：在地址框、key 框各粘贴一次；模板模式只填 key；四条提示各出现一次。
- [ ] UI: 添加窗口 / 粘贴 curl 后 / 窄窗口 390 — 提示条完整可读，填好的字段可见。
- [ ] 新文案 9 种语言齐全，中文是真翻译，用词与 `docs/glossary.md` 一致，资源测试通过。
- [ ] 截图用无头浏览器在临时目录里拍，不碰真实的 `~/.claude`、`~/.codex`（开工前确认用户已同意这种拍法）。
- [ ] 新功能只在主机声明 `apiEndpointManagement` 时出现；协议新字段都可选，协议兼容测试通过。
- [ ] `npm run typecheck`、`npm run lint` 通过，改到的测试文件本机通过。

参考：prd.md 第 10 条，用户故事 12–16；decisions.md R1-Q2 与「照 magpie 直接记下的细则」的 curl 一条；magpie app `curlOf`（app:14433-14530）。

实现时凡本工单没写明的细节，先查 magpie `7597c132` 的做法并照做；比 magpie 少做或更严一律不行，除非 prd 写明。
