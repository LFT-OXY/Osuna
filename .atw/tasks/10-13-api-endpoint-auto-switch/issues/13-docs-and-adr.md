# 13 — 文档与决策记录

**What to build:** 把 `adr-draft.md` 定稿为 ADR 0007（文件名接现有最大号），按英文 ADR 口吻；ADR 0004 文首标 `superseded in part by ADR 0007`、被取代条目各加一句指向 0007、删除「记录会话创建时模式」「版本检查只覆盖 Osuna 跑的 codex」两条 Consequences，其余规则原文保留。按 09 票 Answer 的表逐项改写：`docs/custom-providers.md` 三处；`docs/glossary.md` API endpoint 词条重写、Custom provider 一句、新增 Gateway / Endpoint switch / Use API endpoints / Default model / Request format / Model family / Failover 与四个状态词；`docs/data-model.md` 第 9 节整表重写、删 `apiEndpointId` 行；`docs/protocol-compatibility.md` 若有 feature 清单则加一行；`THIRD_PARTY_NOTICES` 补齐借鉴文件、夹具与厂商图标的来源。`CLAUDE.md` 文档表不加行。遵守 `CLAUDE.md`「Writing docs」与「Doc voice」。对应 prd R-F1、R-F2。

**Blocked by:** 01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12
**Status:** ready-for-agent
**Impl:** ready

- [ ] ADR 0007 落盘，内容与 `adr-draft.md` 一致，无中文审稿提示残留；ADR 0004 标注与删改到位，保留的规则在 0007 里只链接不重述。
- [ ] `docs/custom-providers.md` 三处、`docs/glossary.md` 词条、`docs/data-model.md` 两处、`docs/protocol-compatibility.md`（如有清单）按 `map-issues/09-adr-and-doc-rewrites.md` 的表逐项改完，表中每行在票内勾掉。
- [ ] `THIRD_PARTY_NOTICES` 列出全部借鉴文件、搬来的夹具目录与厂商图标目录，与仓库实际一致。
- [ ] `npm run format:files` 跑过改动的文档；`npm run typecheck`、`npm run lint` 通过；CI 全绿（Nix 两项常红不计）。
