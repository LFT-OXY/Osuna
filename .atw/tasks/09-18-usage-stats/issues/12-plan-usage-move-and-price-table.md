# 12 — 套餐用量搬入「用量」页，主机设置页改为价格表区块

**What to build:** 套餐用量卡片出现在「用量」页左列底部（标题 "Plan usage · 已用" + 更新时间，沿用现有窗口条 / 余额条），主机设置页原来的位置变为价格表区块：段导航标签由 "Usage" 改为 "Price table"；卡片标题 + "每百万 token 美元 · LiteLLM 快照，N 小时前更新，M 个模型"，右上自动更新开关与「立即刷新」；表格列 模型 / 输入 / 缓存读 / 缓存写 / 输出 / 来源 / 操作，无价格行排前并带「无价格数据 · 估算 $0」pill、直接四格输入 + 保存，已计价行末「自定义价格」幽灵按钮展开四格；保存后「用量」页成本立即变化；多主机时按主机分组。套餐用量模块原有硬编码英文全部接入 i18n。

**Status:** ready-for-agent
**Impl:** ready

**Blocked by:** 05, 08

依据：spec 实现决策第 11、12 节；9、12、14 号决策票。

范围内：client 包的 `usage.pricing.list / refresh` 方法与 `usage.pricing.updated` 订阅；写覆盖表与开关走现有 `set_daemon_config` 整段替换；`settings.host.priceTable.*` 键；`settings.hostSections.usage` 值改为 "Price table" / 「价格表」；套餐用量 10 条 copy 迁 `usage.planUsage.*` 后删除 copy 文件，相对时间与 "left" 改为返回 `{ key, params }` 由组件层渲染，英文逐字不变；现有套餐用量 Playwright spec 改为在「用量」页定位卡片、断言文案不变。

- [ ] 接缝 3：现有套餐用量 spec 在新路由下通过（三个 provider 卡片、"1,234 left"、刷新重拉计数）。
- [ ] 接缝 3：主机设置页段导航显示 "Price table"；夹具里一个无价格模型排在表首带 pill；填入四列价格保存后，该行变为已计价、「用量」页大数字下的估算成本变化、「N 个模型无价格数据」提示消失。
- [ ] 接缝 3：关掉自动更新开关后 daemon 配置里 `autoUpdate=false`（通过 daemon client 读回）；点「立即刷新」后显示更新时间（fetch 由 worker daemon 的注入返回固定表）。
- [ ] 接缝 2：相对时间 / "left" 描述对象函数用例；资源测试通过，英文键值与原 copy 逐字相同。
- [ ] `npm run typecheck`、`npm run lint`，改动的测试与 Playwright spec 通过。
