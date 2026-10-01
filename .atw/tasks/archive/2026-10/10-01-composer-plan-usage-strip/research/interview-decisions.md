# 访谈结论（2026-10-01）

用户对两轮问题全部采纳推荐答案。

## 现状事实

- 目标位置是 `ComposerContextStrip`（`packages/app/src/composer/context-strip/index.tsx`），仅桌面/宽屏渲染（`composer/index.tsx:2662` 的 `!isCompactFormFactor`）。
- 套餐用量（Plan usage）取数 `useProviderUsage`（`packages/app/src/provider-usage/use-provider-usage.ts`），现在只在上下文圆环弹层打开时拉取；daemon 端缓存 5 分钟（`quota-fetcher/service.ts`）。
- 窗口 id：Claude `five_hour`、`weekly`、按模型的 scoped 周窗口（label `Weekly · <模型>`）；Codex `session`、`weekly`、`code_review`。label 是英文，来自 daemon。
- 颜色规则：服务端 `toneFromUsedPct` <70 ok、70–90 warning、>90 danger；客户端 `deriveTone` 兜底。

## 决策

| # | 决策 |
|---|---|
| Q1 | 放在 context strip 右侧、主机徽标之前；左侧工作区类型和分支不动。手机端不显示，套餐用量继续留在圆环弹层 |
| Q2 | 显示全部限额窗口，每项「小圆环 + 百分比 + 重置时长」；余额类（Extra usage、credits）不进窄栏 |
| Q3 | 只显示当前 Agent 所属提供方 |
| Q4 | 套餐小圆环复用现有 tone 阈值（绿/橙/红）；上下文圆环保持 <70% 灰色 |
| Q5 | 窄栏挂载时拉取，之后每 5 分钟刷新；重置倒计时本地每分钟更新 |
| Q6 | 悬停窄栏套餐区弹出完整套餐用量卡片；桌面端从圆环弹层移除套餐部分，手机端保留 |
| Q7 | 加载中、出错、主机过旧、提供方无套餐数据、第三方 API 接口：窄栏都不显示（说明的去处见 Q18） |
| Q8 | 上下文弹层美化先用 `atw-prototype` 出 2–3 个方向对比，再实现 |
| Q9 | 建任务，走 Medium 路径 |
| Q10 | 客户端按窗口 id 映射短名：`five_hour`/`session` →「5h」，`weekly` →「周」，scoped 周窗口只写模型名，`code_review` →「审查」；未知 id 回退 daemon label。悬停卡片仍用完整名 |
| Q11 | 单项格式 `◔ 周 45% · 4d`，完整「X 后重置」只在悬停卡片 |
| Q12 | 会在重置前用完的窗口改显示红字 `X后用完` |
| Q13 | 第一项前加当前提供方的小图标（复用现有提供方图标） |
| Q14 | 空间不足时的取舍（已被 Q17 修订） |
| Q15 | 原型同时覆盖窄栏（2–3 种排法）和弹层（2–3 个方向），同页对比 |
| Q16 | 去掉上下文部分的估算成本（提供方报告的 `totalCostUsd`），只保留本会话合计里的估算成本 |
| Q17 | 修订 Q14：分支名至少保留约 80px；再不够时依次隐藏末尾窗口段 → 套餐名段，第一个窗口段始终保留 |
| Q18 | 出错和第三方接口时窄栏保持安静；这两条说明在桌面端只出现在「用量」页面的套餐卡片，手机端在上下文弹层 |

## 原型结论（第 01 轮）

窄栏和弹层都选 03 分段仪表，详见 `../ui-direction.md`。
