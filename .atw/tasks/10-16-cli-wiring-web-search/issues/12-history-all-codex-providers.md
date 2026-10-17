# 12 — 会话历史列出所有 Codex 服务商的对话

**What to build:** Codex 把每段对话记在开它时用的 Codex 服务商名下，只列当前那一个的对话。做完后，Osuna 的会话历史一处列出所有 Codex 服务商名下的对话，每条标出它属于哪个 Codex 服务商。

- Osuna 列 Codex 对话时，请 Codex 列出所有服务商名下的（`thread/list` 带全部服务商），每条带上它的 Codex 服务商（提供方会话列表的新可选字段）。
- 会话历史在 Codex 的行上显示它的 Codex 服务商。
- 旧客户端照常工作。
- 一次性核实：在临时 `CODEX_HOME` 里用真的 Codex，确认不同服务商名下的对话都列得出来。不碰用户的 `~/.codex`，不登录。

**Blocked by:** 03
**Status:** ready-for-agent
**Impl:** ready

- [ ] 端到端：用夹具准备记在两个不同 Codex 服务商名下的对话，列表里两条都有，各带自己的服务商。
- [ ] 新字段可选，协议兼容测试通过。
- [ ] UI: 会话历史 / 有两个 Codex 服务商的对话 / 桌面 1280 — 每行能看出它的 Codex 服务商，不挤掉标题。
- [ ] UI: 会话历史 / 同上 / 窄窗口 390 — 服务商标签不遮住行内操作。
- [ ] 一次性核实的结果写进实现记录。
- [ ] 新文案 9 种语言齐全，用词与 `docs/glossary.md`「Codex 服务商」一致；截图用无头浏览器在临时文件夹里拍（用户 2026-10-18 已同意）。
- [ ] `npm run typecheck`、`npm run lint` 通过，改到的测试文件本机通过。

参考：prd.md 第 20 条；research/codex-wiring.md 第 1、11 题与 13.4 (d)；decisions.md Q11、Q33。
