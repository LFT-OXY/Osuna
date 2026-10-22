# 13 — 收尾：统一检查画面与文档

**What to build:** 所有工单做完后，把本任务的各个画面放在一起检查一遍，修掉画面之间不一致的地方（不重新设计），拍齐 prd「UI and Design」清单要求的验收截图给用户看；核对文档是否齐全。

**Blocked by:** 01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12
**Status:** ready-for-agent
**Impl:** ready

- [ ] 1280 与 390、浅色与深色下，列表页、详情分区的各种状态、编辑窗口高级区、Codex 重置卡与确认框的截图齐全，由主会话拍摄并给用户看过。
- [ ] 中文界面新文字全是中文，用词与 `docs/glossary.md` 一致，没有「额度」作标签；英文界面没有露出翻译键名；开关是 Switch，次要操作不是蓝色链接。
- [ ] `docs/glossary.md` 的 **Balance**、**Plan usage** 按最终界面核对，本任务的界面名词都已收录。
- [ ] `docs/usage.md`「Outbound requests」覆盖本任务的全部新请求；`docs/data-model.md` 覆盖新字段、新机密、主机开关、上次读数文件。
- [ ] 借鉴 magpie 的文件头有 MIT 声明，`THIRD_PARTY_NOTICES` 覆盖。
- [ ] 9 种语言的 i18n 测试通过。

参考：prd UI and Design、Acceptance Criteria、第 31–33 条。

实现时凡本工单没写明的细节，先查 magpie `7597c132` 的做法并照做（出处见 `research/decisions.md`）；比 magpie 少做或更严一律不行，除非 prd 写明。
