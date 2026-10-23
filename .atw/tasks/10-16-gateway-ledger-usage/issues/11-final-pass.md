# 11 — 收尾核对

**What to build:** 全部工单完成后，对照最终界面把文档、术语、版权声明、9 种语言和全套截图核一遍，确保各张工单之间用词一致、没有漏写。

**Blocked by:** 01, 02, 03, 04, 05, 06, 07, 08, 09, 10
**Status:** ready-for-agent
**Impl:** ready

- [ ] `docs/glossary.md`：新词条 **Gateway ledger**、**Price multiplier**、**Official**、**Requests**、**Output speed**、**Time to first token**、**Recent problems** 及货币与万 / 亿开关；改 **Usage**、**Usage source**、**Estimated cost**、**Failover**、**Endpoint status**；用词与界面一致。
- [ ] `docs/usage.md`、`docs/data-model.md` 与实现一致，没有重复段落；ADR 0014、0007 的标注与实现一致。
- [ ] `THIRD_PARTY_NOTICES` 覆盖借鉴的 magpie 文件，借鉴文件顶上有 MIT 声明。
- [ ] 9 种界面语言的 i18n 测试通过：键齐全，中文没有残留英文。
- [ ] 代码里没有伪造别的产品身份的地方（总任务实现决定第 15 条）。
- [ ] UI：prd「UI and Design」的界面验收清单逐条截图（1280 与 390），由主会话拍摄并给用户看过；跨页面的不一致在此修正，不重新设计。

参考：prd 第 31–34 条与 Acceptance Criteria。

实现时凡本工单没写明的细节，先查 magpie `7597c132` 的做法并照做（出处见 `research/decisions.md`）；比 magpie 少做或更严一律不行，除非 prd 写明。
