# 24 — Codex 的强制 Subagent 模型、派 Subagent 时的完整清单、「Codex Subagent 可用任意模型」

**What to build:** Codex 设置页再加三样（照 magpie），让用户统一管住 Subagent 的花费，并让 GPT 主对话也能在接口模型上开 Subagent：

- **强制 Subagent 模型**：不写 Codex 配置，中转站把带 Subagent 标记的请求改成这个模型，不管主对话指定什么。怎么认出 Subagent 的请求照 magpie。
- **派 Subagent 时的模型清单补全**：请求里有 `spawn_agent` 工具、且它的说明里有 Codex 列出的那几个模型时，中转站在后面补上其余可选模型（最多 200 个），主对话就能选到接口的模型，而不是只有 5 个。
- **「Codex Subagent 可用任意模型」**（Switch）：照 magpie 把模型目录（以及 ChatGPT 接法下合并的清单）里模型的多 Agent 版本标成 v1。Codex 自己的 `multi_agent_v2` 开着（会盖过它）或读不到配置时，提示区提示，带「如何修复」。Osuna 不改 `multi_agent_v2`。

**Blocked by:** 10, 23
**Status:** ready-for-agent
**Impl:** ready

- [ ] 端到端：设了强制 Subagent 模型时，带 Subagent 标记的请求到达假上游时模型是它；主对话请求不变。
- [ ] 带 `spawn_agent` 的请求，工具说明里补上了其余模型（不超过 200 个）；不带的请求不变。
- [ ] 开关打开后，模型目录里接口模型标成 v1（API key 接法），ChatGPT 接法合并的清单同样；关掉后恢复。
- [ ] `config.toml` 里 `multi_agent_v2` 开着（表、内联、点号三种写法）时有提示；读不到配置时有另一条提示。
- [ ] 浏览器测试：保存成功与失败两种。
- [ ] UI: Codex 设置页 / 「可用任意模型」开着且被 multi_agent_v2 盖过 / 桌面 1280 — 提示与「如何修复」可见，开关是 Switch。
- [ ] 借鉴 magpie 的代码，文件头保留 MIT 声明；新文案 9 种语言齐全；截图用无头浏览器在临时文件夹里拍（用户 2026-10-18 已同意）。
- [ ] `npm run typecheck`、`npm run lint` 通过，改到的测试文件本机通过。

参考：prd.md 第 33、34 条；research/claude-code-wiring.md 第 2c 题；decisions.md Q14、Q29。
