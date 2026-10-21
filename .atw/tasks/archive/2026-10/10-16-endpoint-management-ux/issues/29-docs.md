# 29 — 文档收尾

**What to build:** 把本任务改动的行为写进项目文档。

- `docs/usage.md`「Outbound requests」：每天刷新清单（发给每家开着的接口、带 key、何时发、随开关关掉）、厂商状态页（不带认证的公开 GET、何时发、随开关关掉）。
- `docs/data-model.md`：接口与主机的新字段、CLI 请求头样本文件、导入忽略记录、自选图标副本。
- `THIRD_PARTY_NOTICES`：核对覆盖所有借鉴的 magpie 文件与拷入的图标。
- `docs/glossary.md`：按最终界面核对本任务的词条（访谈时已写入）。
- `docs/custom-providers.md` 等提到接口添加方式的地方按新流程更新。
- 按 `CLAUDE.md`「Writing docs」：改写过时的部分，不往末尾追加。

**Blocked by:** 03, 04, 05, 06, 07, 08, 09, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28
**Status:** ready-for-agent
**Impl:** done

- [x] 文档与最终行为一致，`npm run format:files` 只格式化改到的文档。

参考：prd.md Acceptance Criteria 的「文档」一项；`CLAUDE.md`「Writing docs」「Doc voice」。

实现时凡本工单没写明的细节，先查 magpie `7597c132` 的做法并照做；比 magpie 少做或更严一律不行，除非 prd 写明。
