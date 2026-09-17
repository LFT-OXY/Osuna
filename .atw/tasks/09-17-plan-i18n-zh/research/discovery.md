# 发现记录（2026-09-17 访谈）

## 现状事实

- zh-CN 资源 `packages/app/src/i18n/resources/zh-CN.ts:238` `plan: "Plan"` 未译；全文件约 165 个 key 值仍为英文（`grep -n ': "[^"]*[A-Za-z][^"]*"' zh-CN.ts | grep -v '[一-龥]'`）。
- daemon 下发英文：Claude 模式 `providers/claude/agent.ts:322-346`、计划审批按钮 `:1085-1114`（Reject/Implement）；Codex `codex-app-server-agent.ts:1030-1048`（Dismiss/Implement）、`:3733-3735`（title "Plan"、description）、`codex-feature-definitions.ts:24-30`；OpenCode `opencode-agent.ts:222-231`；Copilot `copilot-acp-agent.ts:66`。
- 客户端 `agent-stream/view.tsx:1425-1428`：`request.actions` 非空即原样渲染 label；`agent-controls/labels.ts:31` 只格式化不翻译；features 开关直接用 `feature.label`（`composer/agent-controls/index.tsx:1342`）。
- `docs/i18n.md`：agent 输出、daemon 输出不翻译；组件用 `useTranslation()`，纯函数用 `i18n.t`；平价测试 `packages/app/src/i18n/resources.test.ts`。

## 已定决策

- 范围：计划卡片标题/审批按钮 + Composer 模式选择器与 Plan 开关（含 Mode/Features/Thinking 标题）+ zh-CN 全部未译 key。计划正文不翻。
- 方式：daemon payload 新增可选稳定标识（action kind / mode key / feature id），客户端按标识查 i18n，`label` 作回退并打 `COMPAT` 标记。协议只加不改。
- 补译例外：仅品牌名与作为命令出现的词保留英文；Commit/Merge/Checks/Reviews 译为提交/合并/检查/评审。
