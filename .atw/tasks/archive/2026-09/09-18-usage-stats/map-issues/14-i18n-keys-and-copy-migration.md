# 14 — i18n 键的分组与 provider-usage copy.ts 迁入方式

**Type:** interview
**Blocked by:** None
**Status:** resolved

## Question

12 号票已定全部文案清单（总览、统计面板、热力图、趋势、Plan usage、数据明细三页签、会话行、Host 筛选、回填 pill、设置页价格表区块）。定：`usage.*` 命名空间下的分组（按区块还是按类型）、复用已有键（如 schedules 的周期词、hosts 的主机状态词）还是新建、`packages/app/src/provider-usage/copy.ts` 的英文硬编码迁入 i18n 的键名与 9 语言补齐方式、来源显示名（"Pi · Anthropic"）与后端名固定表是否进 i18n。参考 `docs/i18n.md` 与 `f994fdea9`（schedules i18n）的做法。

## Answer

用户 2026-09-18 两轮访谈确认（全部采纳推荐）。

### 依据的事实

- 现有约定：一个产品面一个顶层命名空间，面内按区块分组（`schedules.screen / form / cadence`）；跨面不复用，各面自带 "Try again" / "Update the host to …"，只有 `common.actions.*` 是共享池。`i18n/resources.test.ts` 强制 9 语言键集合一致、每语言与英文相同字串 < 25%、插值占位符一致；`.atw/spec/app/frontend/component-guidelines.md` 已写明纯函数返回 `{ key, params }`、单复数用 `{one, many}` 两键、运行时拼键要 `i18n.exists()` 测试、英文逐字不变。
- 待迁英文不止 `provider-usage/copy.ts`（10 条）：`provider-usage/format.ts` 有 "resets 3h" / "resetting now" / "just now" / "3d ago"，`card.tsx` 有 "left"，`message.tsx:646` 的 "Worked for …" 至今硬编码。daemon 返回的 `displayName` / `planLabel` / 窗口 `label` 是 daemon 输出，不译。
- `settings.hostSections.usage: "Usage"` 是主机设置页 Plan usage 所在段的导航标签，Plan usage 搬走后与新侧栏「Usage」页撞名。
- zh-CN 现有 `contextWindow.sessionCost` 译作「会话费用」，英文 "Session cost" 无 Estimated 限定，与术语表冲突。
- RN 0.81.5 / Expo 54 默认 Hermes，`Intl.NumberFormat` / `Intl.DateTimeFormat` 双端可用，`formatRange` 不保证；全 app 目前零处 `Intl`。Arabic 不启用 RTL，方向问题不存在。
- `e2e/browser/provider-usage-settings.spec.ts` 按英文 "Refresh" / "Error" / "1,234 left" 与 daemon 文案定位 Plan usage 卡片；spec 现在打开的是主机设置页，Plan usage 搬到「用量」页后 spec 要改路由（实现票的事）。

### 决定

1. **命名空间**：顶层新建 `usage`，按区块分组：`overview`（周期页签 `period.{day,week,month,all,custom}`、大数字、来源分布、来源卡片、模型展开、`range` / `rangeSingle`、`sourceCardA11y`）/ `stats` / `heatmap`（含 `cellA11y`）/ `trend`（含 `barA11y`、堆叠维度切换）/ `planUsage` / `details.{daily, monthly, projects}` / `sessionRow` / `hostFilter` / `backfill` / `columns`（各表共用列名：总计、输入、输出、缓存、推理、会话、轮次、估算成本）/ `common`（仅跨区块且不属任何表列的词："估算成本 · 按公开 API 价格计算"、"无价格数据" pill）。不按类型分。
2. **复用 vs 新建**：周期页签、主机状态词（需要更新主机 / 未计入 / N 台计入 / 全部主机）在 `usage` 下新建；重试用 `common.actions.retry`；刷新在 `usage` 下自建；**不往 `common` 加新词**。
3. **会话内两处 UI 不进 `usage`**：turn footer 段放 `message.turnUsage.*`（含自建 `columns.{model,input,cache,output,estimatedCost,total}`，不跨引 `usage.columns`）；"Worked for" 一并迁为 `message.workedFor: "Worked for {{duration}}"`，`formatDuration` 的 "6m 12s" 按 `formatTimeAgo` 先例保持英文。环形表弹层新增段放 `contextWindow.sessionTotal.*`；同时修正现有键：英文 `sessionCost` → "Estimated cost {{cost}}"、zh-CN「估算成本 {{cost}}」，9 语言同步；`tokens` 键的小写 "tokens" 不动；`contextWindow.accessibility` 扩成含已用 / 上限文字。
4. **价格表**：键放 `settings.host.priceTable.*`（与 `settings.host.skills` 并列）；`settings.hostSections.usage` 键名不改、值改为英文 "Price table" / zh-CN「价格表」，术语表里 Usage 只指侧栏页。
5. **copy.ts 迁入**：全部 10 条迁到 `usage.planUsage.*`（title / refresh / refreshing / loading / empty / errorTitle / hostUnavailable / hostUpgradeRequired / clientUnavailable / tooltipLoading），`retry` 改用 `common.actions.retry`，删除 `copy.ts`；`clientUnavailable` 虽是 `throw new Error` 消息也进（最终显示在 Alert 里）。`format.ts` 的相对时间与 `card.tsx` 的 "left" 改为返回 `{ key, params }` 描述对象、组件层渲染；"3h" 一类单位缩写保持英文，只译外壳。英文值逐字不变，`provider-usage-settings.spec.ts` 是守卫。
6. **来源显示名与后端名表**：不进 i18n。客户端常量 `usage/source-labels.ts`：CLI 名（Claude Code / Codex / Pi / OMP）、后端 id → 显示名（anthropic → Anthropic、openai → OpenAI、xai → xAI、github → GitHub Copilot、ollama → Ollama、google → Google …）、未知 id 首字母大写兜底、" · " 分隔符。跨 Host 合并在客户端按 `(cli, backend)` 做，显示名表放客户端与之对应。i18n 只管「全部」卡、"{{count}} 个模型"（`modelsOne / modelsMany`）等外壳文字。
7. **9 语言补齐**：沿 schedules 先例，9 个语言文件各内联，一次提交；不用 `plugin-settings.ts` 式单文件，不先留英文占位。翻译由实现票 agent 一次写齐，zh-CN 由用户 QA 校对，其余 7 语言以资源测试为守卫。估算 `usage` 150–200 条 + `message` / `contextWindow` / `settings.host.priceTable` 约 40 条。
8. **数字与日期本地化**：千分位、百分比、日期、月份标签、星期短名按当前 UI 语言走 `Intl.NumberFormat` / `Intl.DateTimeFormat(lang, { weekday: "short" })`，不写 9×7 个星期键；K/M/B 缩写（一位小数）、"$" 前缀、成本小数位固定不随语言变（与 turn footer 同屏同形）。日期区间用两端各自格式化 + 键 `usage.overview.range: "{{from}} – {{to}}"`（同一天 `rangeSingle`），不用 `formatRange`；是否带年由纯函数按是否跨年返回参数。实现票在 iOS / Android 真机各做一次 Intl 冒烟。
9. **zh-CN 术语**：Plan usage → 「套餐用量」；Token 保留拉丁 "Token"（句中小写 tokens 跟随现有写法）；turn → 「轮次」作名词、「第 N 轮」作序数；heatmap → 「热力图」；Estimated cost → 「估算成本」。已写入 `docs/glossary.md`。
10. **规则性决定（不另议）**：单复数 `{one, many}` 两键带 `{{count}}`；运行时拼出的键（周期页签、主机状态 pill、来源卡、后端名兜底）加 `i18n.exists()` 测试；四处图形（热力图格、趋势柱、来源卡、环形表）都建 a11y 键，语序交给翻译。

### 对其他票的修订

- 13 号票 / 08 号票中 "Composer 用量条" 一律指环形表弹层「本会话合计」，其文案键在 `contextWindow.sessionTotal.*`。
- 12 号票"价格表挪到主机设置页"的段名：`settings.hostSections.usage` 显示为 "Price table"。

### 否决的替代方案

按类型（labels / actions / errors）分组——无先例；跨命名空间引用 `usage.columns` 给 footer 用——耦合两面；`plugin-settings.ts` 式 9 语言单文件——会让 usage 成为唯一不在 en.ts 里的英文命名空间；后端名进 i18n——9 语言同值拖低 25% 阈值且无翻译价值；`Intl.DateTimeFormat.formatRange`——Hermes 不保证。
