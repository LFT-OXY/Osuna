# 01 — 先写决策记录：推翻 auth.json 规则与三处身份例外

**What to build:** 动代码之前先把要推翻的规矩写清楚。新写一篇 ADR：推翻 ADR 0004「`~/.codex/auth.json` is never read or written」与 ADR 0010「不靠读 `auth.json` 认登录」里与多号自动轮换冲突的部分，用「一个登录只有一个持有者」承接旧规则防的坑；记下总任务 Implementation Decisions 第 15 条的三处例外（Codex 续期用 Codex 的 OAuth 客户端身份、Codex 加号由 Osuna 自己跑 OAuth、查 Codex 额度保持上游的浏览器 User-Agent），写明由用户在访谈 Q6、Q7、Q14 选定；写明被否决的做法（在每号私有 `CODEX_HOME` 里起真的 Codex app-server 登录与续期）及理由。只改文档。

**Blocked by:** None
**Status:** ready-for-agent
**Impl:** done

- [x] 新 ADR 按 `docs/adr/` 的现有格式与编号写成，Context / Decision / Considered Options / Consequences 齐全，引用 `research/decisions.md` 的 Q6、Q7、Q14 与 magpie、Codex 源码出处。
- [x] ADR 0004、0010 里被取代的条目就地标出「被 ADR 00xx 取代」，不删原文。
- [x] 总任务 `prd.md` 的「身份」验收项加注：这三处是子任务 9 由用户选定的例外，指向新 ADR。
- [x] Claude 一侧写明不在例外里：登录由真的 `claude auth login` 完成，续期由 Claude Code 自己做。
