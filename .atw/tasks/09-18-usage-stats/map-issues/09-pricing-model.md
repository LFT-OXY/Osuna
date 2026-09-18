# 09 — 计价：内置快照、自动更新、用户覆盖与匹配顺序

**Type:** interview
**Blocked by:** 04
**Status:** resolved

## Question

定：内置快照的精简格式与放置位置；自动更新周期、缓存文件位置、失败回退、设置开关的存放（config.json 字段名）；用户覆盖表 schema（模型 id 精确/前缀匹配、四列单价、可选仅对某来源生效）与 RPC；匹配顺序（覆盖 > 精确 > 归一化 > 前缀剥离 > 未命中）；未知模型的 UI 标记；估算成本在存储行里落盘还是查询时按当前价重算（价格变了历史成本要不要变）。

## Answer

访谈一轮九题，全部按推荐通过（2026-09-18）。

**不重开的前提**：成本不落盘、查询时按当前价格表算（07 号票）；`reasoning` 是 output 子集不单独计价，成本 = input×输入价 + cachedInput×缓存读价 + cacheWrite×缓存写价 + output×输出价；长上下文分档、Claude 1 小时缓存写入 1.6 倍价、OpenAI 服务档位一律不算，记为已知偏差（04 号票）。

1. **内置快照**：放 `packages/server/src/services/usage/pricing/`，同目录附 LiteLLM 的 MIT LICENSE 原文。快照与磁盘缓存共用 `PricingTable` 形状：`{ _meta: { source, fetchedAt, etag, license }, models: { <key>: { input, cachedInput, cacheWrite, output } } }`，单价保持 LiteLLM 的美元/每 token 原值，UI 显示时乘 1e6 并按十位小数取整。精简规则：跳过 `sample_spec`，只留四列，四列全空的条目丢弃，缺列写 `null` 计价按 0，不保留 `litellm_provider`。
2. **快照刷新**：手动脚本 `packages/server/scripts/refresh-pricing-snapshot.ts`，发版前跑，`docs/release.md` 完成清单加一行。不做 CI 自动提交。
3. **自动更新调度**：daemon 启动后延迟 30 秒检查一次（缓存缺失或 `fetchedAt` 超过 24 小时才发请求），之后每 24 小时一次；`If-None-Match` 条件 GET，304 只更新 `fetchedAt` 不落盘；超时 15 秒；失败 1 小时后再试，成功后回到 24 小时，失败只记一条 `info`。响应不是合法 JSON 或条目形状异常视同失败，不覆盖缓存。
4. **缓存文件**：`$PASEO_HOME/usage/pricing-cache.json`，原子写，格式同快照。启动时取缓存与内置快照中 `fetchedAt` 较新者；缓存解析失败则删除并用快照。加进 `docs/data-model.md` 目录树。
5. **配置字段**：`features.usage.pricing.autoUpdate: boolean`（默认 true）与 `features.usage.pricing.overrides: PricingOverride[]`；环境变量 `PASEO_USAGE_PRICING_AUTO_UPDATE=0|1` 启动时覆盖。两者都是运行时安全字段，加进 `MutableDaemonConfigSchema` 与 `pickSupportedPatchFields`，app 用现成的 `set_daemon_config_request` 改。不放 `daemon.*`。
6. **覆盖表 schema**：`PricingOverride = { model: string, pricePerMillion: { input, cachedInput, cacheWrite, output }, note?: string }`。只做精确匹配（trim + 不分大小写），不做前缀匹配，不限定来源；config.json 里存每百万 token，加载时换成每 token；`model` 在数组内唯一，重复以后者为准；四列非负，允许 0（算已定价）；删除 = 从数组移除。
7. **RPC**：
   - 读 `usage.pricing.list.request`（无参）→ `{ table: { fetchedAt, source: "cache" | "snapshot", autoUpdate }, models: [{ model, cli, backend, priced, priceSource: "override" | "table" | null, matchedKey, pricePerMillion | null, lastSeenAt }] }`，`models` 为用量数据里出现过的全部 (model, cli, backend)，`priced=false` 在前、再按 `lastSeenAt` 倒序。
   - 写：覆盖表与 `autoUpdate` 走 `set_daemon_config_request` 整段替换，不另起 RPC。
   - 手动刷新 `usage.pricing.refresh.request`（无参）→ `{ result: "updated" | "not_modified" | "failed", fetchedAt, error | null }`，忽略 `autoUpdate` 开关。
   - 广播 `usage.pricing.updated`（无 payload），价格表或覆盖表变化后发；不复用 `usage.updated`。
8. **匹配顺序**（命中即停，结果按 model 缓存在内存，表或覆盖变化时连负缓存一起清空）：覆盖表精确 → 价格表候选键序列，每个候选先原样再小写：原始 id → Claude 归一化（`claude-(sonnet|opus|haiku|fable)-X.Y` 点转横线、`sonnet-4-5` 补 `claude-`）→ 去 `-YYYYMMDD` 后缀 → 剥 provider 路径取末段再走前两步 → 末段仍未命中则在所有以 `/<末段>` 结尾的键里按固定偏好序挑（`anthropic, openai, gemini, deepseek, zai, moonshot, xai, mistral, groq, openrouter`，都不在则字典序最小）→ 未命中四列 0、`priced=false`。不做反向子串匹配、不按 Pi/OMP 后端名拼前缀（后端名是用户自定义端点名）、不剥推理档位后缀。存储与展示永远用原始 model id。
9. **未知模型 UI**：行级成本灰色 `$0.00` 加「无价格数据」标签；汇总卡片估算成本下方加「N 个模型无价格数据」可点跳到价格表区块，`N` 由客户端从报表 `models[].priced` 派生。样式归 12 号原型票。

**未单独提问、按默认处理**：覆盖表是每台 Host 自己的 `config.json`，跨 Host 不同步，多 Host 时价格表区块按 Host 分组（形态归 12 号票）；价格表只有 USD。

**否决的替代方案**：CI 自动刷新快照；不刷新快照；`daemon.usage.*` 归属；前缀匹配与来源限定的覆盖；语义化的 `usage.pricing.override.set` 写 RPC；字典序挑剥前缀后的候选键；反向子串匹配；未知模型显示 `—`。

术语：`docs/glossary.md` 新增 **Price table** 与 **Custom price**。

## Comments

- 2026-09-18，由 12 号票修订：价格表区块**放在主机设置页**（替代搬走的 Plan usage 区块），不在「用量」页；区块形态见 `map-issues/12-usage-page-prototype.md`。RPC 与配置不变。
