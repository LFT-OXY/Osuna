# 13 — 文档与决策记录

**What to build:** 把 `adr-draft.md` 定稿为 ADR 0007（文件名接现有最大号），按英文 ADR 口吻；ADR 0004 文首标 `superseded in part by ADR 0007`、被取代条目各加一句指向 0007、删除「记录会话创建时模式」「版本检查只覆盖 Osuna 跑的 codex」两条 Consequences，其余规则原文保留。按 09 票 Answer 的表逐项改写：`docs/custom-providers.md` 三处；`docs/glossary.md` API endpoint 词条重写、Custom provider 一句、新增 Gateway / Endpoint switch / Use API endpoints / Default model / Request format / Model family / Failover 与四个状态词；`docs/data-model.md` 第 9 节整表重写、删 `apiEndpointId` 行；`docs/protocol-compatibility.md` 若有 feature 清单则加一行；`THIRD_PARTY_NOTICES` 补齐借鉴文件、夹具与厂商图标的来源。`CLAUDE.md` 文档表不加行。遵守 `CLAUDE.md`「Writing docs」与「Doc voice」。对应 prd R-F1、R-F2。

**Blocked by:** 01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12
**Status:** ready-for-agent
**Impl:** done

- [x] ADR 0007 落盘，内容与 `adr-draft.md` 一致，无中文审稿提示残留；ADR 0004 标注与删改到位，保留的规则在 0007 里只链接不重述。
- [x] `docs/custom-providers.md` 三处、`docs/glossary.md` 词条、`docs/data-model.md` 两处、`docs/protocol-compatibility.md`（如有清单）按 `map-issues/09-adr-and-doc-rewrites.md` 的表逐项改完，表中每行在票内勾掉。
- [x] `THIRD_PARTY_NOTICES` 列出全部借鉴文件、搬来的夹具目录与厂商图标目录，与仓库实际一致。
- [x] `npm run format:files` 跑过改动的文档；`npm run typecheck`、`npm run lint` 通过；CI 全绿（Nix 两项常红不计）。手动触发的 CI 运行 38672543465 共 19 项全部通过。

## 09 票文档清单逐项

- [x] ADR 0004：文首 status 行；`auth.command` / 0.118 条、Claude 四个 env 键条、`ANTHROPIC_DEFAULT_*` 条加指向 0007；两条 Consequences 删除（另给 Official 保留专用表、专用表内容、改名前重读、确认框计数、自定义提供方跟随五处加指向）
- [x] `docs/custom-providers.md`「While an API endpoint is active」整节重写（改名「While Claude Code or Codex uses API endpoints」；「Its row…」一句删除，代码里自定义提供方那一行不显示接口）
- [x] `docs/custom-providers.md`「Claude settings.json model discovery」末段
- [x] `docs/custom-providers.md` Alibaba 段「API endpoints」改「Base URLs」并补一句
- [x] `docs/glossary.md` **API endpoint** 重写
- [x] `docs/glossary.md` 新词：Gateway、Endpoint switch、Use API endpoints、Default model、Request format、Model family、Failover、Endpoint status（Available / Cooling down / Needs a check / Off）
- [x] `docs/glossary.md` **Custom provider** 一句
- [x] `docs/data-model.md` 第 9 节整表重写（含目录树三行）
- [x] `docs/data-model.md` 删 `apiEndpointId` 行
- [x] `docs/i18n.md`：按表不改正文（守卫与旧键已在 11 / 12 票处理）
- [x] `THIRD_PARTY_NOTICES`：已存在，补齐 `gateway.ts`、三个 gateway 测试、`model-families.test.ts` 与 OpenAI Codex（Apache-2.0）一节；没有夹具目录
- [x] `docs/protocol-compatibility.md`：没有能力清单，不改
- [x] `CLAUDE.md` 文档表：不加行

