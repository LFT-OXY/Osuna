# 05 — 计价：内置价格表、自动更新、自定义价格

**What to build:** 用量报表里每行都有估算成本：daemon 内置 LiteLLM 价格快照，启动 30 秒后与之后每 24 小时用条件 GET 拉最新表（可用配置关闭），用户通过 `set_daemon_config` 写自定义价格后成本立即重算；`usage.pricing.list` 列出用量里出现过的全部模型及其定价状态，`usage.pricing.refresh` 手动刷新，`usage.pricing.updated` 在表或覆盖变化后广播；未知模型成本 0、`priced=false`。

**Status:** ready-for-agent
**Impl:** doing

**Blocked by:** 02

依据：spec 实现决策第 8 节；`research/litellm-pricing.md`。

范围内：快照精简脚本与 LICENSE 原文、`PricingTable` 形状、缓存文件与新旧择取、调度（30 秒 / 24 小时 / 15 秒超时 / 失败 1 小时退避 / 304 只更 `fetchedAt`）、`features.usage.pricing.{autoUpdate, overrides}` 进可变配置 schema 与 `PASEO_USAGE_PRICING_AUTO_UPDATE`、`PricingOverride` 校验（精确匹配、每百万存储、唯一、非负、0 算已定价）、匹配顺序与结果缓存、三个 RPC / 广播、报表与 `models[].priced` 填值、`docs/release.md` 完成清单一行、`docs/usage.md` 的出站请求与隐私说明段。

- [ ] 接缝 2：匹配函数用例——覆盖表优先、原样 / 小写、Claude 归一化（`claude-sonnet-4.5` → `claude-sonnet-4-5`、`sonnet-4-5` 补前缀）、去日期后缀、剥 provider 路径、`/<末段>` 偏好序、未命中 `priced=false`；成本公式四列相乘、reasoning 不计价；表或覆盖变化后负缓存被清。
- [ ] 接缝 1：注入 fetch 返回固定 JSON → `usage.pricing.refresh` 结果 `updated`、缓存文件为四列精简格式；返回 304 → `not_modified` 且只更新 `fetchedAt`；抛错 / 非法 JSON → `failed` 且缓存不变。`autoUpdate=false` 时启动后推进时钟 24 小时不发请求；`=true` 时启动 30 秒后发一次、24 小时后再发一次。
- [ ] 接缝 1：`set_daemon_config` 写一条自定义价格 → 收到 `usage.pricing.updated`，`usage.report.get` 的 `estimatedCost` 立即按新价变化，`usage.pricing.list` 该模型 `priceSource="override"`；填 0 时 `priced=true`。
- [ ] 接缝 1：`usage.pricing.list` 的排序为 `priced=false` 在前、再按 `lastSeenAt` 倒序。
- [ ] 快照文件旁有 LiteLLM MIT LICENSE；刷新脚本可运行并产出与内置格式一致的文件。
- [ ] `npm run typecheck`、`npm run lint`，改动的测试文件通过。
