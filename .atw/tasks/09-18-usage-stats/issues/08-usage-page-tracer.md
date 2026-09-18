# 08 — 「用量」页 tracer：侧栏项、总览卡与来源卡片

**What to build:** 侧栏出现「用量」项（可在外观设置里显示 / 隐藏），点开是照抄 TokenTracker 布局的「用量」页：桌面左 4 / 右 8 栅格骨架、手机单列；右列「用量总览」卡完整可用——周期页签（日 / 周 / 月 / 总计 / 自定义 + 两个日期输入）、‹ › 翻页、刷新按钮、回填 pill、72px 大数字、绿色估算成本与 "估算成本 · 按公开 API 价格计算"、来源分布条、来源卡片栅格（首张「全部」）、点卡展开模型明细、无价格模型的琥珀 pill 与「N 个模型无价格数据」提示。其余卡片位置先占位。9 种语言文案齐。

**Status:** ready-for-agent
**Impl:** ready

**Blocked by:** 05

依据：spec 实现决策第 9、12、13 节；原型 `prototype/usage-page.html`；12、14 号决策票。

范围内：client 包的 `usage.report.get` 方法与订阅 `usage.backfill.progress` / `usage.updated`；`features.usage` 门控（任一已连接主机支持即显示）；内建侧栏项列表加 `usage`；顶层路由（改前读 `docs/expo-router.md`）；按主机取数的 hook 与跨主机相加的纯函数（`summary` 直加、`days/months/trend/heatmapDays` 按 key 相加、`sources/models` 按键合并重排、`projects` 不合并带 `serverId`）——本票 UI 只展示单主机，合并函数先到位；`usage.updated` 去抖重拉、`backfill.progress` 只刷 pill、`done` 重拉；来源显示名与固定色表常量；周期 → `from/to` 与粒度的纯函数（周一起）；`usage.overview / usage.backfill / usage.common / usage.columns` 键 9 语言；数字千分位走 `Intl`、K/M/B 一位小数、成本两位。

- [ ] 接缝 3：worker daemon 根目录指向夹具（四家各一份），打开「用量」页：大数字为夹具总 token 千分位、估算成本、来源卡片四张 + 「全部」，占比与模型数正确；点 Claude Code 卡展开模型明细，再点收起。
- [ ] 接缝 3：切到「日」并按 ‹ 翻到夹具所在日，大数字变为当日值；「自定义」输入区间后页签文字变为区间；刷新按钮重拉。
- [ ] 接缝 3：扫描间隔调短，页面打开时能看到回填 pill「回填中 M / N」，完成后消失且数字刷新。
- [ ] 接缝 3：旧 daemon（现有旧 daemon 夹具）连接时侧栏无「用量」项；外观设置里关掉「用量」后侧栏消失。
- [ ] 接缝 2：跨主机合并函数用例（两份报表相加，`projects` 保持两行带 `serverId`）；周期 → 区间函数（周一起、跨年带年）；运行时拼键处 `i18n.exists()` 用例；资源测试通过。
- [ ] 暗色主题下配色正确（截图证据）。
- [ ] `npm run typecheck`、`npm run lint`，改动的测试与 Playwright spec 通过。
