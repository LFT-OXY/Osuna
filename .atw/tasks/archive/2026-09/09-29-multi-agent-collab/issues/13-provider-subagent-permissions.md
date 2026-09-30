# 13 — provider 子智能体权限归属与只读面板批准

**What to build:**
- Codex（`threadId`）、Claude（SDK `agentID`）、OpenCode（`sessionID`）adapter 在 provider 子智能体的权限请求 `metadata` 里补上子智能体 id；OMP 没有来源，不归属。不扩展描述符的 status。
- track 行与派发组的行按该 id 从父 agent 的待批准权限计数，显示等待批准。
- 只读面板从父 agent 的待批准权限里取出归属本子智能体的项，显示权限卡并允许批准，回应走父 agentId；面板仍无输入框。
- `docs/providers.md` 补上"权限 `metadata` 带子智能体 id"。

**Blocked by:** 12
**Status:** ready-for-agent
**Impl:** done

- [x] adapter 单测：三个 provider 的权限请求 `metadata` 带子智能体 id。
- [x] 只读面板显示并能批准归属本子智能体的权限；父面板行为不变。
- [x] track 行与派发组行显示 provider 子智能体的等待批准；OMP 不显示。
- [x] `docs/providers.md` 已更新。
- [x] `npm run typecheck`、`npm run lint` 通过。
