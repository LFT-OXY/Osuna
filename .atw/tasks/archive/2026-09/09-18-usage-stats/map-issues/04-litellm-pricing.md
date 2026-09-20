# 04 — LiteLLM 价格表的结构、体积、许可与 Paseo 出站策略

**Type:** research
**Blocked by:** None
**Status:** resolved

## Question

拉取 `https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json`，确定：(1) 条目结构，四列单价的字段名（`input_cost_per_token`、`output_cost_per_token`、`cache_read_input_token_cost`、`cache_creation_input_token_cost` 等）与单位（每 token 还是每百万）；(2) 条目数与文件体积，精简为四列后的体积，是否适合内置到 server 包；(3) 模型 key 的命名惯例（带 provider 前缀 `anthropic/`、`openrouter/` 等）与参考项目 `matcher.js` 七级匹配、`normalizeClaudeModel` 的必要性；(4) LiteLLM 的许可证是否允许内置快照；(5) Paseo 的出站请求先例：`docs/product.md` 的无遥测承诺与 `quota-fetcher` 拉各家接口的边界，daemon 定时拉一个公开 GitHub raw 文件是否需要设置开关以外的说明。产出 `research/litellm-pricing.md`。

## Answer

详见 `research/litellm-pricing.md`（数字附命令与原始输出）。要点：

1. **结构与字段**：顶层 `{modelKey: {...}}`，首键 `sample_spec` 是样例要跳过。四列字段名确认：`input_cost_per_token`、`output_cost_per_token`、`cache_read_input_token_cost`、`cache_creation_input_token_cost`，**单位是美元/每 token**（`claude-sonnet-4-5` 为 `3e-06` = $3/MTok），转每百万乘 1e6 并十位小数取整。OpenAI 全系无 `cache_creation` 字段（缺省按 0）。四列之外有长上下文分档（`*_above_200k_tokens`）与 Claude 1h 缓存写入（`cache_creation_input_token_cost_above_1hr`），四列方案会对这两类低估，记为已知偏差。
2. **体积**：2026-09-18 快照 4306 条、2,793,090 字节；只留四列后 3696 条、444,558 字节（gzip 38 KB），适合内置到 server 包。`raw.githubusercontent.com` 返回 ETag，刷新用条件 GET 可拿 304。
3. **key 惯例**：629 条裸键、118 种前缀；**Anthropic/OpenAI 直连模型是裸键**（`anthropic/` 前缀 0 条，`openai/` 4 条），`anthropic/claude-sonnet-4-5` 直接查会 miss。Claude 裸键版本用横线（`claude-opus-4-8`）、网关键用点（`openrouter/anthropic/claude-sonnet-4.5`），带日期与不带日期并存但不成对。归一化最小集：小写 → `normalizeClaudeModel` 三条规则（点↔横线、`sonnet-4-5` 补 `claude-`、版本/档位倒序还原）→ 去 `-YYYYMMDD` 重试 → 剥 provider 路径重试；Pi/OMP 有后端 provider 时先试 `<provider>/<model>`。七级里的 curated 别名/子串与第 6 级反向子串不建议做，Q17 的"无价格模型可直接填"兜底。
4. **许可证**：仓库根 LICENSE 为 MIT（仅 `enterprise/` 例外，价格表不在其中），可内置快照；义务是附版权与许可声明，沿仓库先例在快照目录旁放 LICENSE 原文（如 `packages/highlight/src/astro/LICENSE`）。
5. **出站策略**：`docs/product.md:46` 承诺的是不上报用户数据，不是不联网。现有 quota-fetcher 是**客户端按需触发**（`provider.usage.list.request`）、仅以凭证存在为门槛、无 config 开关、5 分钟缓存、15 秒超时；价格表拉取则是 daemon **自发定时**的第一个出站 GET，无先例。结论：开关必要（沿 `daemon.<x>.enabled` + `PASEO_*` 环境变量模式，默认开）；开关之外还需在文档写明"用量功能唯一网络请求是拉公开价格表、不含用户数据、可关、离线用内置快照"，请求用 ETag 条件 GET + 超时 + 失败退回陈旧缓存→内置快照的降级链（参考项目 `litellm-fetcher.js:107-164`），磁盘缓存只存四列。
