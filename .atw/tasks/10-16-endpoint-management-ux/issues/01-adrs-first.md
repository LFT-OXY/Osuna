# 01 — 先写 ADR：接口顺序、用户设的请求改动、导入与按 CLI 的样子测

**What to build:** 在动代码前把三处决定写进 `docs/adr/`，后面的工单照着做：

- 改 ADR 0007：「裸模型名按接口创建顺序解析」改为按接口顺序（**Endpoint order**）：切换先后、裸模型名归属都按用户排的顺序；新建排在最后。
- 改 ADR 0008：中转站改请求原本只限模型名、认证和拒收后的改写；现在用户设的请求头、附加请求体、上游模型名、只用这种格式也改请求，用户的认证头盖过 Osuna 的，此时不触发「两个认证头被拒就改用一个」。
- 新写一篇：Osuna 自动读别的软件的配置（含 key，只读）、接收 `paseo://import` 导入链接、中转站记下 CLI 的请求头样本并「按 Claude Code / Codex 的样子测」。写明这是总任务第 15 条「身份如实」的例外、用户选定、理由（照 magpie，sub2api 一类「只允许某 CLI」的分组）、范围（按 Claude Code 只对中转服务）与防护（去掉的敏感头、只在用户点按钮时发、导入链接的拒收规则与确认框）。
- ADR 0007、0008 的被改处标出新的说法与日期；总任务 prd 第 15 条的注记链接到新 ADR。

**Blocked by:** None — can start immediately
**Status:** ready-for-agent
**Impl:** ready

- [ ] 三篇 ADR 写好，措辞与 prd 第 3、30、35、44 条一致，按 `CLAUDE.md`「Doc voice」写。
- [ ] `npm run format:files` 只格式化改到的文档。

参考：prd.md 第 3、30、35、44 条；decisions.md R1-Q4、R3-Q1、R3-Q2；ADR 0002、0007、0008。

实现时凡本工单没写明的细节，先查 magpie `7597c132` 的做法并照做；比 magpie 少做或更严一律不行，除非 prd 写明。
