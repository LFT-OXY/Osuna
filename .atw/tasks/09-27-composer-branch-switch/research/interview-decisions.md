# 访谈决策记录（2026-09-27）

来源：/atw-askme-with-docs 访谈，全部为用户明确回答（多数为"按推荐"）。执行顺序：09-27-pi-hidden-context → 本任务 → 09-27-markdown-preview-dom。

## 事实（调研所得）

- 栏组件：`packages/app/src/composer/context-strip/index.tsx`（注释写明只读，无 Pressable）。术语已入 `docs/glossary.md`：**Composer context strip**。
- 数据：`context-strip/model.ts:16-27` `resolveComposerContext(gitStatus)`；`gitStatus` 来自 `composer/index.tsx:1363` `useCheckoutStatusQuery`（`git/use-status-query.ts`，`checkout_status_request` + 推送更新）。`composer/index.tsx:2476` 紧凑屏隐藏；`agent-panel.tsx:1628`、`composer/draft/workspace-tab.tsx:698` 传 `showContextStrip`。
- "本地"= Workspace kind `local_checkout`（非 git 目录也显示"本地"），`mainRepoRoot` 非空为 worktree。
- 切换能力已存在：
  - 协议 `checkout_switch_branch_request`（`packages/protocol/src/messages.ts:2406-2411`），服务端 `checkout-session.ts:555-591` → `git-mutation-service.ts:94-104` `checkoutExistingBranch`（脏树拒绝）→ `utils/checkout-git.ts:481-505`（远程分支自动 `checkout -b --track`）。
  - 列分支：`branch_suggestions_request`（limit ≤ 200）。
  - 客户端：`daemon-client.ts:4361` `checkoutSwitchBranch`、`:4554` `getBranchSuggestions`。
- 现成 UI：`packages/app/src/components/branch-switcher.tsx` `BranchSwitcher` + `hooks/use-branch-switcher.ts`（懒加载分支、错误含 "uncommitted" 时走"Stash 并切换"确认、切回时询问 stash pop）；唯一调用方 `git/diff-pane.tsx:632-639`。文案 `branchSwitcher.*`（`zh-CN.ts:1514-1531`）。
- 无"agent 运行中"检查；分支被其他 worktree 占用时无预检，git 报错经 `toCheckoutError` 变 `UNKNOWN`，toast 显示英文原文。
- 同一 cwd 可挂多个 workspace；分支是 Directory-backed 状态，切换影响同 cwd 所有 workspace。

## 已定

| # | 决策 | 结论 |
|---|---|---|
| 1 | 能力范围 | 复用 `BranchSwitcher`：本地 + 远程分支；不做新建分支（另开任务） |
| 2 | 脏工作区 | 沿用现有"Stash 并切换"流程 |
| 3 | 运行中 | 仅看**当前 agent** 是否运行；只在 context strip 入口置灰并提示原因；服务端与 Changes 面板不动 |
| 4 | Worktree 工作区 | 允许切换；分支被别的 worktree 占用时把 git 报错翻译成可读（i18n）提示；列表不预过滤 |
| 5 | 同 cwd 其他工作区 | 跟着变，不额外提醒 |
| 6 | "本地 / Worktree"标签 | 保持只读 |
| 7 | 草稿标签页 | 同样可切，始终可用 |
| 8 | 平台 | 以桌面 / Web 为准；紧凑屏维持隐藏 |
| 9 | 验收 | 桌面端在本地与 worktree 工作区各验：切本地分支、切远程分支、带未提交改动切换、agent 运行中尝试切换、草稿标签页 |

discover 阶段无未决问题。
