# 从 Composer context strip 切换分支

## Problem Statement

Composer 底下那条 Composer context strip 显示着「本地 / Worktree」和当前分支名，看起来像是
能点的，其实是只读的 —— 点上去什么都不会发生。想换分支，得先知道「切换分支」藏在 Changes
面板的工具栏里，打开右侧栏、切到 Changes、再点那里的分支名。

更别扭的是，整条链路其实早就做好了：协议有切换分支的 RPC，服务端会校验分支、处理只有远程
分支时自动建跟踪分支，前端有一个可搜索的分支下拉 `BranchSwitcher`，脏工作区时还有「Stash
并切换」与切回后恢复 stash 的流程。只是它只接在 Changes 面板一处，用户眼前最显眼的那个分支
名反而用不上。

另外两个现有缺口会在入口变显眼之后被放大：

- 切换时不看 agent 是否正在运行。agent 跑到一半工作区文件突然被换掉，它读到写到的都不再
  是它以为的那个分支。
- 在 worktree 工作区里切到一个已被别的 worktree 检出的分支时，git 拒绝后前端弹出的是一条
  英文原始报错，用户看不出发生了什么。

## Solution

- Composer context strip 上的分支名变成可点击的触发器，点开就是现有的 `BranchSwitcher`
  下拉：可搜索，列出本地与远程分支，选中即切换；脏工作区沿用现有「Stash 并切换」确认与
  切回后恢复 stash 的询问。
- 当前 agent 正在运行时，触发器置灰，悬停提示原因；agent 结束后自动恢复可用。
- 草稿标签页（还没发出的新 agent）里同样可切，不受任何 agent 运行状态影响 —— 这时切分支
  就是在决定「从哪个分支开始干活」。host 断开时与其他入口一样置灰。
- worktree 工作区也能切；目标分支已被别的 worktree 检出时，提示改成一句可读的本地化文案。
- 「本地 / Worktree」标签保持只读。
- 紧凑屏上这条栏本来就不显示，维持现状。

## User Stories

1. 作为在桌面端用 agent 的开发者，我希望点 Composer 底下的分支名就能切分支，这样我不用去翻右侧栏的 Changes 面板。
2. 作为同一个开发者，我希望点开后看到的是可搜索的分支列表，这样分支很多时我能快速找到目标。
3. 作为同一个开发者，我希望列表里同时有本地与远程分支，这样同事推上来的分支我也能直接切过去。
4. 作为同一个开发者，我希望切到只有远程存在的分支时自动建好跟踪分支，这样我不用先去终端 fetch / checkout。
5. 作为同一个开发者，我希望当前分支在列表里有勾选标记，这样我知道自己现在在哪。
6. 作为同一个开发者，我希望选中当前分支时什么都不发生，这样误点不会触发多余的操作。
7. 作为有未提交改动的开发者，我希望切换时被问到要不要先 stash，这样我的改动不会丢也不会被带到别的分支上。
8. 作为同一个开发者，我希望切回原分支时被问到要不要恢复刚才的 stash，这样来回切换不需要手动管 stash。
9. 作为 agent 正在跑的开发者，我希望分支触发器是置灰的，这样我不会在 agent 读写文件时把分支换掉。
10. 作为同一个开发者，我希望悬停在置灰的触发器上能看到原因，这样我知道要等 agent 结束而不是以为坏了。
11. 作为同一个开发者，我希望 agent 一结束触发器就恢复可用，这样我不需要刷新页面。
12. 作为在草稿标签页准备新 agent 的开发者，我希望能先切到目标分支再发消息，这样新 agent 一开始就在对的分支上。
13. 作为同一个开发者，我希望草稿里的分支触发器始终可用，这样不会被别的 agent 的运行状态误伤。
14. 作为在 worktree 工作区里的开发者，我希望同样能切分支，这样 worktree 不会比本地 checkout 少一个能力。
15. 作为同一个开发者，我希望切到一个已被别的 worktree 检出的分支时，看到的是一句我能看懂的中文提示，这样我知道该去那个 worktree 里操作。
16. 作为在 Changes 面板里切分支的开发者，我希望遇到同样的 worktree 冲突时也看到同一句可读提示，这样两个入口表现一致。
17. 作为在同一个目录上开了多个工作区的开发者，我希望在一个工作区里切完分支后，其他工作区显示的分支也跟着更新，这样界面不会显示过期的分支名。
18. 作为同一个开发者，我希望切完分支后侧栏、标题、Changes 面板都立刻反映新分支，这样我不需要手动刷新。
19. 作为 detached HEAD 状态下的开发者，我希望这条栏仍然不显示分支触发器，这样不会出现一个没有名字的按钮。
20. 作为在非 git 目录里工作的开发者，我希望这条栏里没有分支触发器，这样不会出现无法使用的控件。
21. 作为连接断开时的开发者，我希望分支触发器不会发出注定失败的请求，这样我不会看到一串报错。
22. 作为用键盘操作的开发者，我希望分支触发器能被聚焦并用回车打开，这样不用鼠标也能切分支。
23. 作为用读屏器的开发者，我希望触发器的无障碍标签读出当前分支，置灰时读出不可用，这样我能理解它的状态。
24. 作为看着「本地 / Worktree」标签的开发者，我希望它仍然只是说明，不会因为点到而跳走，这样这条栏上只有一个可操作的东西。
25. 作为手机上使用的开发者，我希望界面维持现状，这样这次改动不会给紧凑屏增加新的控件。
26. 作为维护者，我希望 Composer context strip 和 Changes 面板用的是同一个 `BranchSwitcher`，这样切换行为只有一套实现。
27. 作为维护者，我希望「触发器是否可用、为什么不可用」由一个纯函数给出，这样它能被单测覆盖。

## Implementation Decisions

### 触发器

- Composer context strip 的分支段替换为 `BranchSwitcher`。窄条外观保持不变（分支图标 +
  caption 字号的 muted 文字），只增加可点击的反馈（悬停 / 按下态、指针光标），不为此改变
  窄条高度或版式。`BranchSwitcher` 目前只提供 Changes 面板的工具栏样式触发器，这里需要一个
  与窄条一致的紧凑外观；以参数形式让同一个组件支持两种外观，不复制组件。
  - 实现：`BranchSwitcher` 的 `appearance?: "toolbar" | "strip"`（默认 toolbar）。strip 形态的
    触发器是分支图标 + caption 弱色文字，外框与悬停 / 按下 / 打开高亮复用
    `toolbarLabelTriggerStyle`，两侧 `-spacing[1]` 负边距让文字位置与只读时一致；窄条仍高 28px。
  - strip 形态的 tooltip 向上弹、下拉用 `desktopPlacement="top-start"` 向上展开（窄条贴着
    Composer 底边，向下会被窗口底部截住）。
- `BranchSwitcher` 增加「不可用」状态与原因文案：不可用时触发器置灰、不响应点击与键盘、
  tooltip 显示原因，无障碍标签标明不可用。Changes 面板不传这个状态，行为不变。
  - 实现：`disabledReason?: string | null`（已本地化的原因，非空即不可用）。置灰是
    `opacity[50]`，`Pressable disabled`（web 上 `aria-disabled=true`、移出 tab 序）；无障碍标签
    为 `branchSwitcher.currentBranchUnavailable`「Current branch: {{branchName}}. {{reason}}」。
- 分支名为空（detached HEAD）或不是 git checkout 时不渲染触发器，与现有窄条行为一致。
- 「本地 / Worktree」段保持只读，不加交互。

### 可用性判定

- 由 Composer context strip 的模型层给出：输入为 git 状态、是否草稿、当前 agent 是否在运行、
  host 是否连接；输出为「是否显示触发器」「是否可用」「不可用原因」。纯函数，放在现有
  `resolveComposerContext` 同一个模型里扩展。
  - 实现：`resolveBranchSwitch(context: ComposerContext, conditions: BranchSwitchConditions)
    → { kind: "hidden" } | { kind: "enabled" } | { kind: "disabled"; reason: "agent-running" |
    "host-disconnected" }`，`BranchSwitchConditions = { agent: "draft" | "idle" | "running";
    isHostConnected: boolean }`（草稿与运行中用一个三态表达，不可能同时为真）。
  - 判定顺序：没有分支名 → hidden；host 断开 → disabled(host-disconnected)，草稿同样；
    agent 为 running → disabled(agent-running)；其余 enabled。
  - Composer 里草稿取自 `resolveAgentControlsMode(agentControls) === "draft"`，运行中取自
    `selectAgentTurnPresentation(...).isActive`。原因文案 key：
    `composer.context.branchSwitchAgentRunning` / `branchSwitchHostDisconnected`。
- 「运行中」只看**当前这个 agent** 的运行状态，不汇总同目录下的其他 agent。
- 草稿没有运行中的 agent，不因运行状态置灰（host 断开时仍置灰，见上）。
- 拦截只在这个入口：服务端的切换处理与 Changes 面板不加运行中检查。

### 数据接线

- Composer 把工作区 id、工作区目录、host 与当前 agent 的运行状态传给 Composer context strip；
  这些 Composer 与 agent 面板 / 草稿标签页都已持有，不新增查询。
  - 实现：工作区目录用 Composer 的 `cwd`（与窄条显示的 `useCheckoutStatusQuery` 同源，切换成功
    后失效的正是这条查询）；工作区 id 为空时退回 `cwd`，与 Changes 面板
    `model.workspaceId ?? model.cwd` 一致 —— 它只作分支建议 / stash 列表的查询缓存键，git 操作
    一律走目录。
- 切换走现有 `useBranchSwitcher` 链路：懒加载分支建议、`checkout_switch_branch_request`、脏树
  时的 stash 确认与切回恢复询问、成功后的 checkout 状态失效。

### worktree 占用提示

- 切换失败且 git 报错表明目标分支已被别的 worktree 检出时，把原始报错替换为本地化文案
  （带上占用它的 worktree 路径，能从报错里取到时）。识别放在 `useBranchSwitcher` 的错误处理
  中，与现有「uncommitted → stash 确认」的识别并列，因此 Changes 面板一并受益。
  - 实现：`parseBranchCheckedOutElsewhere(message) → { worktreePath: string | null } | null`
    （`git/branch-switcher-operations.ts`），匹配 git ≥ 2.42 的「is already used by worktree at
    '<path>'」与旧版「is already checked out at '<path>'」。直接切换与「Stash 并切换」后的切换
    两条失败路径都经过它。文案 key：`branchSwitcher.checkedOutElsewhereAt`（带
    `{{worktreePath}}`）/ `branchSwitcher.checkedOutElsewhere`。
- 其余错误仍按现状显示原始信息。
- 分支列表不预先过滤或标注被占用的分支；不新增协议字段。
- 文案补齐所有 locale。

### 不动的部分

- 协议、服务端切换与 stash 处理。
- Changes 面板的触发器外观与行为（除共享的 worktree 占用提示外）。
- 新建分支：不做，另开任务。
- 紧凑屏：窄条仍隐藏。

## Testing Decisions

好的测试只断言用户可观察的行为：窄条上能不能点、点开后能不能切到目标分支、切完界面显示
什么、不可用时看到什么；不断言组件内部调用了哪个 hook。

测试接缝（均为现有接缝；本 spec 一并请用户确认）：

- **e2e：`e2e/browser/branch-switcher.spec.ts`**（最高接缝，真实 daemon + 真实 git 仓库）。
  新增用例：从 Composer context strip 切换到本地分支、切换到仅远程存在的分支，断言窄条与
  工作区显示的分支随之更新；带未提交改动时走 stash 确认。复用
  `e2e/support/helpers/branch-switcher` 里现有的辅助函数，必要时为窄条入口加一个同风格的辅助。
  - 实际落地 4 个用例：本地分支（断言窄条、标题、侧栏行、Changes 面板、磁盘分支）；仅远程
    分支（断言窄条、磁盘分支、upstream 为 `origin/<branch>`）；未提交改动（两次确认框的完整
    文案、stash 后工作区干净、切回后改动恢复）；目标分支被另一 worktree 占用（toast 为本地化
    全文且含路径，窄条与磁盘仍在原分支）—— 最后一个是 `docs/testing.md`「Fallible user
    actions」要求的失败覆盖。
  - 辅助：`branch-switcher.ts` 新增 `expectComposerContextStripBranch`、
    `switchBranchFromComposerContextStrip`（与 Changes 入口共用选分支步骤）；`workspace.ts` 新增
    `leaveBranchOnlyOnRemote`、`readUpstreamBranch`、`checkOutBranchInLinkedWorktree`。
- **单测：Composer context strip 模型（`context-strip/model.test.ts`）**。覆盖可用性判定：
  git checkout 且有分支 → 可用；当前 agent 运行中 → 不可用并给出原因；草稿 → 始终可用；
  detached HEAD / 非 git / 未加载 → 不显示；host 断开 → 不可用。
- **单测：worktree 占用报错识别**。识别逻辑抽成纯函数，与现有 `branch-switcher-operations`
  测试放在同一处：git 的「already checked out / used by worktree」两种措辞都能识别并取出路径，
  无关报错不误判。
- 「agent 运行中置灰」在 e2e 里依赖真实 provider 跑起来，成本高，由模型单测覆盖判定、
  桌面端手动验收覆盖呈现。
- 本地只跑改到的测试文件；e2e 在本机跑不通时交给 CI（见项目记忆里 macOS 下 e2e 的已知问题）。

## Out of Scope

- 新建分支（基于当前 HEAD 创建并切换）。
- 服务端层面的「运行中禁止切换」，以及按同目录所有 agent 汇总运行状态。
- 分支列表中标注 / 过滤被其他 worktree 占用的分支。
- 「本地 / Worktree」标签的交互。
- 紧凑屏（手机）上的分支切换入口。
- 切换分支前对同目录其他工作区的额外提醒。

## Acceptance Criteria

- [ ] 桌面端本地 checkout 工作区：点窄条上的分支名打开可搜索的分支下拉，选中本地分支后窄条、侧栏、标题显示新分支。
- [ ] 选中仅远程存在的分支时自动建跟踪分支并切换成功。
- [ ] 有未提交改动时出现「Stash 并切换」确认；切回原分支时询问是否恢复 stash。
- [ ] 当前 agent 运行中触发器置灰，悬停显示原因；agent 结束后自动恢复可用。
- [ ] 草稿标签页中触发器可用，切换后发出的新 agent 在新分支上工作。
- [ ] worktree 工作区可切分支；目标分支被其他 worktree 检出时显示本地化提示（Changes 面板同样）。
- [ ] detached HEAD、非 git 目录时不显示分支触发器；「本地 / Worktree」点击无反应。
- [ ] 触发器可键盘聚焦与打开，无障碍标签含当前分支与不可用状态。
- [ ] 窄条外观与高度不变；Changes 面板的分支切换行为不变（除共享的 worktree 占用提示）。
- [ ] 紧凑屏界面无变化。
- [ ] 新增文案补齐所有 locale。
- [ ] 上述测试接缝的用例补齐并通过；改动涉及的包 typecheck 与 lint 通过。

## Further Notes

- 访谈与调研记录：`research/interview-decisions.md`（含各处代码位置）。
- 术语：Composer context strip 已写入 `docs/glossary.md`；Branch 的 UI 用语为「Switch branch」。
- 同批次：`09-27-pi-hidden-context`（先做）、`09-27-markdown-preview-dom`（后做）。
- 同目录多工作区一起变是 Directory-backed 语义，访谈中决定不额外提醒。
