# 10 — 统计面板、热力图与使用趋势

**What to build:** 「用量」页左列三张卡可用：统计面板（7 天 / 30 天 / 30 天内活跃日均 / 会话数四格、Top 3 模型、开始使用日、活跃天数）；热力图（固定最近 26 周、手机 20 周、周一起、5 级绿阶明暗两套、悬停显示日期与 token、右上时区标签、底部「少…多」）；使用趋势（`react-native-svg` 自绘堆叠柱，按来源 / 按模型 tiny 分段切换，日周期按小时、周 / 月 / 自定义按天、总计按月，未来日灰色矮柱，4 条网格线，页脚首尾日期）。

**Status:** ready-for-agent
**Impl:** done

**Blocked by:** 08

依据：spec 实现决策第 9 节；原型 `prototype/usage-page.html` 左列；12、14 号决策票。

- [x] 接缝 2：热力图分级函数（level 0–4，182 天矩阵按周一起排列，缺日补 0）、趋势点序列函数（按粒度补齐空 key、未来日标记）、统计面板派生函数（活跃日均、活跃天数、开始使用日）全值用例。
- [x] 接缝 3：夹具数据下热力图对应日期格子 level 正确且悬停文案含 token 数；趋势切「按模型」后柱段按模型着色；切到「日」后 x 轴变为小时；统计面板四格与 Top 3 模型文字正确。
- [x] 星期短名与月份标签按 UI 语言走 `Intl.DateTimeFormat`，切到 zh-CN 后为中文。
- [x] 热力图格、趋势柱有 a11y 键；`usage.stats / usage.heatmap / usage.trend` 键 9 语言；资源测试通过。
- [x] 暗色主题截图证据。
- [x] `npm run typecheck`、`npm run lint`，改动的测试与 Playwright spec 通过。

**验收时被移除：** 用户判定「使用趋势」卡片不需要，整卡连同只服务它的客户端代码一起删了
（`usage-trend-card.tsx`、`usage/trend.ts`、`usageTrendGroupColor` / `usageModelColor` /
`usageSourceRefFromKey`、`resolveUsageTrendGranularity`、`stackBy` 请求参数与查询键、
`merge.ts` 的 trend 合并、9 语言的 `usage.trend.*`、e2e 的趋势步骤）。本票另两张卡
（统计面板、热力图）不受影响，验收项保持原样。

daemon 侧没动：`UsageReportSchema.trend` 是必填响应字段，`packages/server/src/server/usage/report.ts`
仍在算趋势点。要不要一并从协议和 daemon 里拿掉是另一个决定 —— 那是删必填响应字段，
得按 `docs/protocol-compatibility.md` 单独过一遍。
