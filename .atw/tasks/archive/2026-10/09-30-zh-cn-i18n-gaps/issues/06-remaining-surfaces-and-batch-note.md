# 06 — PR 面板、插件、会话页、侧栏零星迁移 + 批次记录

**What to build:** 简体中文下，以下文案显示中文：PR 面板的「动态」「评论操作」「已解决」「已过时」「讨论串操作」；插件界面的「选择插件主机」「插件」「关闭插件」「关闭」「插件主机离线」「此插件界面不可用」；插件面板的不可用提示；会话页的「此主机没有会话」「无法加载会话」；侧栏的「显示偏好」提示和标记工作区已读 / 未读失败的提示。新增的键在其他 7 种语言里填英文原文。`docs/i18n.md` 的 Progress 补一条本批次记录，概括本任务的 zh-CN 补译、术语统一、硬编码迁移和白名单测试。

**Blocked by:** 01

**Status:** ready-for-agent
**Impl:** done

- [x] 上述文案在中文下显示中文，英文界面文案不变
- [x] 本工单迁移的代表性英文字面量加入源码扫描清单，测试通过
- [x] 所有语言资源的键和英文一致，插值占位符一致
- [x] `docs/i18n.md` Progress 有本批次记录，格式与现有条目一致
- [x] 资源测试文件、typecheck、lint 通过
- [x] Electron 桌面端中文截图检查 PR 面板、插件界面、会话页、侧栏提示

**Notes:** PR 面板按用户确认的范围全部迁移，不止工单列出的 5 处：同文件的「添加到聊天」「全部添加到聊天」「复制」「暂无动态」「正在添加...」，检查区的摘要标题和计数行，以及 PR 状态徽标和活动动词。`checks-summary.ts` 的 `summarizeChecks` 只返回 `outcome`、`parts`、`total`、`groups`，文案由 `formatChecksHeadline` / `formatChecksCount` / `formatChecksGroupLabel(t, …)` 生成；中文的 `countLine.one/many` 写 `"{{parts}}"`，得到「3 项失败，21 项成功，1 项已跳过」。计数行现在是一整串，原来按状态分开的 testID（`pr-pane-check-failed` 等）随之删除，仓库里没有任何引用。`data.ts` 的 `getStateLabel` / `getActivityVerb` 改为返回已有的 `workspace.git.pr.states.*` / `activity.*` 键（`getStateLabelKey` / `getActivityVerbKey`），e2e 助手 `pr-pane.ts` 改读 `en.workspace.git.pr.states`。附加到聊天的 PR 上下文（`context-attachment.ts`）和相对时间（「2h ago」）保持英文。「Thread actions」译「讨论主题操作」，跟随已有的「讨论主题」，没有采用工单原文的「讨论串」；审查后把已有的 `activityLoadFailed` 从「活动」改为「动态」，与本工单的「动态」统一。按 `docs/i18n.md`「同一界面不留中英混排」，顺带迁移了侧栏工作区菜单的「标记为已读 / 未读」和会话页的「重试」「返回」「加载中...」（后两者复用 `common.back`、`common.loading`）。插件界面的关闭按钮提示复用 `common.actions.close`。`docs/i18n.md` 的批次记录编号为 Batch 5C，放在 5A（pt-BR）、5B（ko）之后。源码扫描清单没有收 `"Add to chat"`（会命中 `section-kit.tsx` 的注释）、`"Workspaces"`（会命中 `sidebar-workspace-list.tsx` 的注释）和 `"Plugin"`（前缀误匹配）。桌面端中文 QA 截图（`/tmp/qa06/`）：侧栏「工作区」标题和「显示偏好」提示、工作区菜单「标记为未读」、会话页选中离线主机时的「此主机没有会话」「返回」、插件界面「此插件界面不可用。」「关闭插件」「关闭」、PR 面板（临时克隆检出 PR #5 分支）的「已合并」「部分检查未通过」「3 项失败，21 项成功，1 项已跳过」、分组标题、「添加到聊天」「动态」「暂无动态」和检查区无障碍标签。以下文案在桌面端造不出触发条件，只由资源测试覆盖：标记已读 / 未读失败的提示、会话页「无法加载会话」（离线主机只报主机级错误）、插件面板不可用和「插件主机离线」、「选择插件主机」（需要多台主机装同一插件），以及 PR #5 没有评论，所以「评论操作」「讨论主题操作」「已解决」「已过时」也没截到。
