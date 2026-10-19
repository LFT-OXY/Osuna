# 31 — 用户验收：用真实的 CLI 试一遍

**What to build:** 自动化测试全部用假上游和假登录。这张由用户用自己的真实账号与接口，经过内置中转站做最终验收。助手不在本机运行真的 Claude Code、Codex，只负责准备验收步骤。

**Blocked by:** 29, 30, 32
**Status:** ready-for-human
**Impl:** done

- [x] 真实的 Claude Code：在打开「自己能联网搜索」的接口上，WebSearch 搜得到带链接的结果；同一模型没有这样的接口时，Claude Code 收到「不能联网搜索」的说明。
- [x] 真实的 Codex（ChatGPT 登录）：开关前后开的对话在 `codex resume` 列表里是同一组；`/model` 里 ChatGPT 自带模型与接口模型都在，两种都能回复。
- [x] 保留 claude.ai 登录打开时，Claude Code 的语音与 `/usage` 套餐额度可用。
- [x] 结论（通过，或不通过以及看到的现象）记在本票的 Comments 里。

参考：prd.md「Acceptance Criteria」最后一项。

## Comments

**2026-10-19 用户验收（dev 桌面端，端口 6769，用户真实的 `~/.claude`、`~/.codex`；接口：chinhae 打开「自己能联网搜索」，test01 关着）**

- Claude Code 联网搜索 —— 通过。`claude-sonnet-5-5`（chinhae）调用内置 WebSearch 两次，拿到新浪、The Neuron、AI Weekly 等来源；回答末尾只列了来源标题、没印出网址（印不印由模型决定）。换成 `test01/gpt-6.1-sol` 后收到 `400 Web search is not available for test01/gpt-6.1-sol: no API endpoint that is on and serves this model has "Searches the web by itself" turned on in Osuna.`
- 保留 claude.ai 登录 —— 通过。`/usage` 的套餐额度与语音可用（用户确认）。
- Codex（ChatGPT 登录）对话同一组 —— 通过。开关前后开的对话都在 `codex resume` 列表里，关开关后仍在（用户确认）。
- Codex `/model` 两种模型 —— **不通过**。ChatGPT 自带模型在前、接口模型在后，两种都能回复；但接口模型只显示模型名，没有「接口标识/模型名」，两家的同名模型分不出。交给 32 号工单，修好后再勾本票「Codex」一项。
- 收尾：两个开关关掉后，`~/.codex/config.toml` 与开测前的备份逐字节一致（`model` 是手动改回的，见下）；`~/.claude/settings.json` 只多 Claude Code 自己记的 `modelSettings.claude-sonnet-5-5.effortLevel`。

观察（不影响结论）：

- dev 数据里留着上次用临时 `CODEX_HOME` 验收时「使用第三方接口」开着的记录，dev 一启动就照它接管了真实 `config.toml`，并删掉用户自己的 `model = "gpt-6-luna"`；关开关按旧记录还原，这一行回不来，手动补回。是测试环境残留，不是本任务功能的问题。
- 用户在 Codex 里用 `/model` 选了接口模型后（14:23），`config.toml` 里 Osuna 的 Codex 服务商表不见了；daemon 日志里 Osuna 没有删它。推测是 Codex 保存模型时去掉的，未核实。下次打开开关时 Osuna 会重写这张表。
- 关开关后 Codex 顶层 `model` 仍是用户在开关期间选的 `test01/gpt-6-luna`（ChatGPT 接法下 `model` 归 Codex，按设计不还原）；回到官方后这个名字不存在，用户得自己再选一次。验收时手动改回了 `gpt-6-luna`。

**2026-10-19 复看（32 号工单修复后）**

- Codex `/model` 显示名 —— 通过。32 号工单改成「模型名 (接口名)」后，用户在 dev 桌面端用真实 Codex 复看通过（见 32 号工单 Comments）。本票四项全部通过。

