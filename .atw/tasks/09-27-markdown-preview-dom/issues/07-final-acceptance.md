# 07 — 整体验收：README.zh-CN.md 与 t3code 对照

**What to build:** 在桌面端打开本仓库 `README.zh-CN.md`，预览效果与 t3code 对照一致：头部居中、徽章横排、`[!NOTE]` 为带图标与「注意」标题的提示块、截图正常显示、bash 代码块着色；并确认本次改动没有波及原生端与其他 markdown 渲染场景。

**Blocked by:** 03, 04, 05, 06
**Status:** ready-for-agent
**Impl:** done

## 范围

- 以 FORCE_COLOR=3 启动 dev desktop，打开 `README.zh-CN.md`，深浅色各截一张图与 t3code 截图对照；发现的偏差在本票修正（仅限样式与接线层面，不扩大范围）。
- 逐条核对 PRD 的 Acceptance Criteria，确认各票测试接缝已补齐。
- 回归检查：对话消息、PR 评论、changelog、plan 卡片渲染无变化；原生端预览代码路径未改。

## 验收

- [x] `README.zh-CN.md` 深浅色截图与 t3code 对照：居中、徽章横排、`[!NOTE]` callout、截图显示、bash 代码块着色。
- [x] PRD Acceptance Criteria 全部勾选或注明交给 CI 的项。
- [x] README 风格 e2e 用例完整并通过（本机跑不通时交给 CI 并注明）。
- [x] 改动涉及的包 typecheck、lint 通过。

## Comments

- 本票没有代码改动，只做验收；相对 06 的提交没有 diff，所以没有再跑 `/atw-code-review`。
- 对照方式：仓库和 task 目录里都没有 t3code 的截图，本机的 T3 Code 正在使用中，没有去改它的界面状态。改为按本票列的五项（居中、徽章横排、`[!NOTE]` 提示块、截图显示、bash 着色）逐项目检，并对照 t3code 的样式源码。
- 桌面端截图（FORCE_COLOR=3 起 dev desktop，Playwright 通过 CDP 截图，语法主题 `one`，深浅色各一组）：头部居中、语言链接 chip 与五个徽章各自一行横排、`[!NOTE]` 为蓝色边线加 ⓘ 图标与「注意」标题、`[!NOTE]` 字样不外露、截图与四张手机图正常显示、bash 代码块注释 / 参数 / 字符串分色，头部有终端图标、换行和复制按钮。浅色下顶部 logo 看不见：`packages/website/public/logo.svg` 本身是 `fill="white"`，GitHub 上同样看不见，不是渲染偏差。
- 补了 01 未勾的两项：源代码视图打开 `.mise.toml`、`scripts/dev-app.sh` 着色正常；在 dev daemon 上用 haiku 起一个 agent 回 bash 代码块，对话里注释、参数、字符串分色（该 agent 与它新建的工作区留在 checkout 本地的 dev home 里）。
- 回归：对话 / PR 评论 / changelog / plan 卡片走的 `components/markdown/renderer.tsx` 与 `html-ish.ts` 在分支上未改；`highlighted-code-block.tsx` 只是把别名表挪到 `fence/language.ts`，取首词逻辑等价；原生端 `markdown-preview/index.tsx` 只改了 props 类型。
- 验证：`components/markdown`、`assistant-file-links`、`file-pane/markdown-preview`、`highlight-cache` 共 17 个单测文件 147 个用例通过；highlight 包 5 个文件 110 个用例通过；file-editing e2e 中 5 个 markdown 相关用例（README、刷新、长行换行、深浅色、五种提示块）本地通过；app 与 highlight typecheck 通过，排除 `.expo` 类型复核后改动文件无错误（剩 2 个错误在本分支未改的 `*.browser.test.tsx`）；改动文件 lint 0 警告。
- 顺带发现（main 上已有，不是本分支引入）：应用重新可见时文件面板会重读文件，读取期间 `preview-lifecycle/model.ts` 的 `read_pending` 不带旧预览，预览整块重挂载，滚动位置回到顶部。本票没有修改，需要的话另开任务。

