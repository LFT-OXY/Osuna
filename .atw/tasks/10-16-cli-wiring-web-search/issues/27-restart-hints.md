# 27 — 改完提示要重开谁；Codex 后台进程自动重启

**What to build:** 每次改写 CLI 配置后和读状态时，提示区列出还在用旧设置的副本，每类说明怎么重开，新设置才能真正生效：

- Osuna 自己正在运行的会话，按提供方计数。
- 在最近一次改写之前启动的终端 Claude Code、Codex 进程。
- Codex 共用的后台 app-server（按它的进程记录文件判断启动时间）：没有客户端连着时，Osuna 用这个 `CODEX_HOME` 执行 `codex app-server daemon restart`，并说明已重启；有客户端连着时只给出这条命令。
- 照实说明：Claude Code 新写入的环境变量会立刻用上，但删掉的变量、模型和思考档位要重开会话才生效。
- 列进程、执行重启命令都经可替换的「进程与命令」适配器，测试用假实现（沿用现有的假 CLI 脚本做法）。28 号工单的代理探测也用这个适配器，哪张先做，哪张建它。

**Blocked by:** 03
**Status:** ready-for-agent
**Impl:** done

- [x] 端到端（假适配器）：改写之后，早于改写启动的终端 Claude Code、Codex 进程各列一条；之后启动的不列。
- [x] 后台 app-server 早于改写启动、没有客户端连着 → 执行了重启命令（假实现记录到），提示说明已重启；有客户端连着 → 不执行，提示里有命令。
- [x] Osuna 正在运行的会话按提供方计数出现在提示里。
- [x] 测试不运行真的 `codex app-server daemon restart`，不读真实的进程表。
- [x] UI: Codex 设置页 / 有要重开的副本 / 桌面 1280 与窄窗口 390 — 每类一行，写明怎么重开，命令完整可见。
- [x] 借鉴 magpie 的代码，文件头保留 MIT 声明；新文案 9 种语言齐全；截图用无头浏览器在临时文件夹里拍（用户 2026-10-18 已同意）。
- [x] `npm run typecheck`、`npm run lint` 通过，改到的测试文件本机通过。

参考：prd.md 第 36、37 条；research/claude-code-wiring.md 第 8 题与第 9 题「改完提示要重开谁」；decisions.md Q17。
