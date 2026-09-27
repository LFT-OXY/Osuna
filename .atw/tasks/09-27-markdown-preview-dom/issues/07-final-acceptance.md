# 07 — 整体验收：README.zh-CN.md 与 t3code 对照

**What to build:** 在桌面端打开本仓库 `README.zh-CN.md`，预览效果与 t3code 对照一致：头部居中、徽章横排、`[!NOTE]` 为带图标与「注意」标题的提示块、截图正常显示、bash 代码块着色；并确认本次改动没有波及原生端与其他 markdown 渲染场景。

**Blocked by:** 03, 04, 05, 06
**Status:** ready-for-agent
**Impl:** ready

## 范围

- 以 FORCE_COLOR=3 启动 dev desktop，打开 `README.zh-CN.md`，深浅色各截一张图与 t3code 截图对照；发现的偏差在本票修正（仅限样式与接线层面，不扩大范围）。
- 逐条核对 PRD 的 Acceptance Criteria，确认各票测试接缝已补齐。
- 回归检查：对话消息、PR 评论、changelog、plan 卡片渲染无变化；原生端预览代码路径未改。

## 验收

- [ ] `README.zh-CN.md` 深浅色截图与 t3code 对照：居中、徽章横排、`[!NOTE]` callout、截图显示、bash 代码块着色。
- [ ] PRD Acceptance Criteria 全部勾选或注明交给 CI 的项。
- [ ] README 风格 e2e 用例完整并通过（本机跑不通时交给 CI 并注明）。
- [ ] 改动涉及的包 typecheck、lint 通过。
