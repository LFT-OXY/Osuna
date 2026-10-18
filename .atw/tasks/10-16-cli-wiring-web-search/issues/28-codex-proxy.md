# 28 — Codex 经代理连不上中转站时的提示与绕开

**What to build:** 电脑开着 HTTP 代理时，Codex 发给本机中转站的请求也会交给代理；代理不转回本机时每一轮都 502，用户找不到原因。做完后，Osuna 查出这种情况并告诉用户原因和改法；Osuna 自己开的 Codex 直接绕开代理。

- **算出 Codex 会走哪个代理**（照 Codex 自己的规则与 magpie）：登录 shell 的 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY`；macOS 与 Windows 的系统代理；`NO_PROXY` 只认精确 IP 或网段；Codex 配置开了 `respect_system_proxy` 时按它的路径。
- **探测**：经这个代理请求中转站的根路径（3 秒超时）。直连能通、经代理不通时，提示区报「代理不转发」，写明代理地址与来源；「如何修复」按代理来自环境变量、Windows 设置、其他三种情况给出（magpie 的三种说法）。
- **绕开**：Osuna 自己起的 Codex 进程，环境里的 `NO_PROXY` 加上 `127.0.0.1`（已有值时追加）。终端里的 Codex 只提示。
- 读环境、读系统代理经 27 号工单的「进程与命令」适配器（哪张先做，哪张建它）；探测在测试里打本机一个不转发的假代理。
- 这次探测是 daemon 主动发出的请求，用 Osuna 自己的身份；写进 `docs/usage.md` 由 30 号工单做。

**Blocked by:** 03
**Status:** ready-for-agent
**Impl:** done

- [ ] 端到端：假环境里 `HTTP_PROXY` 指向本机一个不转发的假代理 → 提示「代理不转发」，修复说明是「环境变量」那一种；`NO_PROXY=127.0.0.1` 时不提示；`NO_PROXY=localhost` 时照样提示（Codex 不认这种写法）。
- [ ] 纯逻辑用例覆盖代理来源的判断：环境变量大小写、系统代理、`NO_PROXY` 的各种写法、`respect_system_proxy`。
- [ ] Osuna 起的 Codex 进程环境里 `NO_PROXY` 含 `127.0.0.1`，原有的值保留。
- [ ] UI: Codex 设置页 / 代理不转发 / 桌面 1280 — 提示写明代理地址、来源与「如何修复」。
- [ ] 借鉴 magpie 的代码，文件头保留 MIT 声明；新文案 9 种语言齐全；截图用无头浏览器在临时文件夹里拍（用户 2026-10-18 已同意）。
- [ ] `npm run typecheck`、`npm run lint` 通过，改到的测试文件本机通过。

参考：prd.md 第 5、38 条；research/claude-code-wiring.md 第 8 题「Codex 侧：代理不转发本机请求」；decisions.md Q18。
