# 05 — 关着时不问 Codex 登录方式，导入跳过 OpenCode 的登录

**What to build:** 开关关着时，Osuna 不起临时 Codex 去问 `account/read`，Codex 的登录方式按上次判断出的结果、没判断过就按接管记录里现在的接法算，所以关开关本身不会改写 Codex 的 `config.toml`；开回来后照常判断、按需重新接。关着时从别的软件导入接口不读 OpenCode 的 `auth.json`，导入窗口说「已关闭读取 CLI 登录凭证，OpenCode 没读」；CC Switch、Alma、Claude Code、Codex 的设置照常导入。

**Blocked by:** 01
**Status:** ready-for-agent
**Impl:** done

- [x] Codex 登录方式的读取经 01 的闸门；关着时读取器不被调用，走现有「判断不出就保持」路径；ADR 0010 的接法规则不变。
- [x] 导入扫描关着时走现有「不含 OpenCode」路径；扫描结果带可选的「OpenCode 没读」标记，导入窗口据此显示那句说明。
- [x] 9 种语言，中文是真翻译。
- [x] 测试：daemon 端到端（关着时打开 / 检查 Codex 的「使用第三方接口」，注入的登录方式读取器没被调用、`config.toml` 不因关开关而变，开回来后被调用；关着时导入扫描不读临时目录里的 OpenCode `auth.json` 且带标记，CC Switch 照常）；app 浏览器测试（导入窗口关着时的说明）。
- [x] UI: 导入窗口 / 开关关着 / 1280 与 390 — 来源列表上方有那句说明，其余来源照常列出。
