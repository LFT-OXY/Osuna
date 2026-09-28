# Composer 斜杠指令体验改造

## Problem Statement

在 agent 的 Composer 里用 `/` 调 skill 有三处不顺手：

- 第一次在某个 agent 里输入 `/`，要等 1-3 秒才出现 Command menu，期间什么也不显示，像没反应。
- Command menu 本身简陋：没有图标、没有分组，最匹配项贴在输入框上方的倒序排列，上面还压着一张详情卡。
- 选中 skill 后，它只是作为 `/atw-askme-with-docs` 这样的一串文字躺在输入框里，和正文混在一起，看不出这是一个"被调用的 skill"。

## Solution

拆成三个可独立验收的子任务：

| 顺序 | 子任务 | 做什么 | 依赖 |
|---|---|---|---|
| 1 | `09-28-slash-commands-first-open` | 指令列表三路合并、绝不为取列表启动进程；Composer 聚焦预取；面板立刻出现 | 无 |
| 2 | `09-28-slash-menu-restyle` | Command menu 改为贴合 Composer 顶边的分组列表 | 无（与 1 的提示行样式对齐，建议在 1 之后） |
| 3 | `09-28-skill-chip` | 从 Command menu 选中的 skill 变成 Attachment tray 里的 Skill chip | 2（沿用 2 的立方体图标与 skill 判定） |

每个子任务的细节写在各自的 `prd.md`。本文件只记跨子任务的约束与整体验收。

## User Stories

1. 作为用户，我想在任何 agent 里输入 `/` 后面板立刻出现，以便不再怀疑是不是卡了。
2. 作为用户，我想在菜单里一眼分清命令和技能，以便快速找到要的 skill。
3. 作为用户，我想让选中的 skill 以块状显示在输入框上方，以便和正文分开、清楚看到自己调用了什么。
4. 作为手机端用户，我想得到和桌面一致的菜单与 chip 体验，以便在哪个端用法都一样。

## Implementation Decisions

- 术语以 `docs/glossary.md` 为准：**Composer**、**Composer input**、**Attachment tray**、**Command menu**、**Skill chip**。
- 取指令列表绝不启动 provider 进程，见 `docs/adr/0003-command-list-never-spawns.md`。任何子任务都不得加"没缓存就启动 CLI"的兜底。
- skill 与命令的区分由 daemon 给出（协议已有的 `kind`）。子任务 1 让 Claude 的 `kind` 变准确；子任务 3 只让 `kind: "skill"` 变成 chip。
- 协议只做加法：`list_commands_response` 新增一个可选字段，由子任务 1 引入。
- 颜色只用现有 token，不新增主题角色。
- 三端（iOS、Android、Web、Electron）都覆盖，按 `CLAUDE.md` 的平台门控规则处理 Web 专属交互。

## Testing Decisions

- 各子任务按自己 PRD 的测试切入点写测试。
- 视觉效果（面板贴合、渐隐、chip 颜色）按 `docs/qa.md` 用 Electron 截图作为证据，参照记忆中的 Playwright CDP 截图流程。

## Out of Scope

- 已发送消息气泡里显示 chip。
- Command menu 的来源徽标（个人 / 项目 / 插件）。
- 行内富文本编辑器（Tiptap 一类）。
- 列表变化后主动推送到已打开的菜单。

## Further Notes

- 访谈记录：`research/discovery.md`；参考项目对比：`research/command-list-references.md`。
- 整体验收：三个子任务都归档后，在 Electron 与一个原生端各走一遍"新 agent → 输入 `/` → 选 skill → 发送"的流程，截图留证。
  - 2026-09-29 结果：Electron 已走通（Claude / Opus 5.5，`/shuorenhua` → Skill chip → 发送，transcript 为 `/shuorenhua 正文`，skill 正常展开；首次 `/` 150ms 内出现分组面板，发送后列表补全为完整 98 项）。原生端按用户决定本轮不测；原生常驻 × 截图与 Android 退格 / 选区时序仍未验证。
