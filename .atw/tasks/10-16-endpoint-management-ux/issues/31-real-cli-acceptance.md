# 31 — 真实 CLI 验收（用户自己做）

**What to build:** 在用户自己的环境里确认，改了模型设置以后，真的 Claude Code 和 Codex 照着工作。助手不在本机跑真的 CLI、不碰真实配置。

- 主会话准备验收清单：要改哪些设置、在 Claude Code / Codex 里看哪里（上下文、思考档位、压缩时机、Codex `/model` 的显示名与接口名显示方式）。
- 用户按清单操作并回报结果；不通过的开新工单。

**Blocked by:** 14, 29
**Status:** ready-for-human
**Impl:** ready

- [ ] 用户确认 Claude Code 按手改的上下文、回复上限、思考档位、压缩阈值工作。
- [ ] 用户确认 Codex 的 `/model` 显示名、思考档位、上下文符合设置，接口名显示方式三种都看过。
- [ ] 用户确认从自己真实的 CC Switch 或别的软件导入一次（可选，由用户决定）。

参考：prd.md 第 22、23 条与 Testing Decisions；总任务「登录相关」的测试约束。
