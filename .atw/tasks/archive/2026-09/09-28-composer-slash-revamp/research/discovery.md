# 发现记录：Composer 斜杠指令体验

## 现状事实

- Composer 输入是纯文本：Web 为 RN-web `<textarea>`（`packages/app/src/components/ui/text-input/text-input.web.tsx`），原生为 RN `TextInput`。无任何行内 token/chip；附件以 pill 形式在输入上方的 Attachment tray（`renderAttachmentTray`，`packages/app/src/composer/index.tsx`）。
- 斜杠列表组件 `packages/app/src/components/ui/autocomplete.tsx` + 定位 `autocomplete-popover.tsx`，与 `@` 文件提及共用。现状：无图标/徽标/分组，`above-input` 时倒序（`autocomplete-utils.ts`），maxHeight 220，选中命令时列表上方有详情卡。
- 首开慢的成因：
  1. 懒加载：仅在检测到 `/` 后才启用 `useAgentCommandsQuery`（`hooks/use-agent-autocomplete.ts:418-425`），加载期间面板隐藏（`isVisible` 要求 `!isCommandsLoading`）。
  2. Claude：`listCommands()` 走 `ensureQuery()`，无活跃进程时会拉起 `claude` CLI 并等待初始化握手（`packages/server/src/server/agent/providers/claude/agent.ts:2736`、`ensureQuery` ~3092）。
  3. daemon 对指令列表无缓存；草稿路径 `agentManager.listDraftCommands` 缓存未命中时建临时会话再关闭（`agent-manager.ts:1135-1171`）。
  4. 客户端 React Query：会话 staleTime 60s、草稿 Infinity；provider 快照变化时整体失效。
- Claude SDK `SlashCommand` 只有 `name/description/argumentHint`，无来源字段（`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:7876`）。
- 协议 `AgentSlashCommandSchema` 有 `kind: "command" | "skill"`（`packages/protocol/src/messages.ts:6316`）。Claude 的 kind 是名单启发式：`CLAUDE_ROOT_ONLY_COMMANDS` 之外都算 skill。
- 发送：选中后文本替换为 `/name `，原样作为用户消息发给 daemon，由各 provider 展开。行内（非开头）`/` 只筛出 skill。
- 设计约束：禁止新增硬编码色值；新颜色须作为 `deriveThemeRoles` 派生角色加入（`docs/design.md`）。

## 参考：t3code

- Tiptap 行内原子节点 `composer-skill`，序列化为 `$name`；chip 用 em 单位、紫色 accent 11% 底 / 34% 边框、立方体图标。
- 斜杠菜单平铺无分组，贴合 composer 顶边（玻璃面板，底部渐隐），`max-h-72`，行 = 名称 + 截断描述 + 来源徽标。
- skill 列表随 provider 快照预取、落盘，打开菜单无请求。

## 第一轮决定（用户采纳推荐）

1. 父任务 + 三个子任务：首开提速、菜单美化、Skill chip。
2. chip 放在输入区上方一行（非行内富文本）；发送时拼回 `/name ` 前缀。三端通用。
3. 只有 `kind === "skill"` 变 chip；命令保持文字。
4. chip 显示原始名（如 `atw-askme-with-docs`）+ 立方体图标，悬停显示描述。
5. 提速：daemon 按 provider+cwd 缓存并落盘、先返回缓存后台刷新；composer 聚焦预取；加载中显示面板。不改为直接扫目录。覆盖已有 agent 与草稿。
6. 菜单：贴合 composer 顶边（图 4 形态），自上而下排序、默认高亮第一项，maxHeight 约 300。
7. 分组「命令 / 技能」带小标题；本轮不做来源徽标；去掉详情卡，参数提示并入行内。
8. 共用组件整体换新（`@` 列表随之变化）；iOS/Android/Web/桌面全覆盖。

## 第二轮决定

9. 允许多个 chip，按选中顺序拼成 `/a /b 正文`，同名去重。
10. 正文中间选中 skill 同样转 chip，并从正文移除。
11. 手打 `/name ` 不自动转 chip，只有菜单选中才转。
12. 删除：chip 带 ×（Web 悬停显示，原生/紧凑常显）+ 光标在正文开头且无选区时退格删最后一个 chip。
13. 草稿新增 `skills` 字段持久化；排队消息与编辑重发保持纯文本，不反向解析。
14. 已发送消息气泡不渲染 chip，本轮范围只限输入框。
15. chip 不新增颜色角色，用已有 token（待确认：`surface3` + `border` 中性外壳）。
16. chip 与附件共用 Attachment tray 一行，chip 在前。
17. 待定：后台刷新策略（见第三轮）。
18. 菜单行图标：技能 = 立方体，命令 = `SquareSlash`，`@` 列表保留文件/文件夹图标。
19. 术语表已新增 **Skill chip**、**Command menu**，并更新 **Attachment tray**（`docs/glossary.md`）。

## 第三轮决定

15. chip 颜色：`accent` 蓝色低透明度（约 10%）底层 + 蓝色描边 + `accentBright` 图标与文字。不新增颜色角色。
20. 验收：新旧项目输入 `/` 后面板都立刻出现；有缓存直接出列表，无缓存显示加载中。

## 第四轮决定（参考项目对比见 command-list-references.md）

17. 列表三路合并，绝不为取列表启动任何进程：
    - CLI 报告的列表（init / `supportedCommands` / `commands_changed`）按 provider+cwd 落盘缓存；
    - 扫目录补齐：`~/.claude/skills|commands` 与项目 `.claude/skills|commands`；
    - 写死内置命令（`/compact`、`/rewind` 等）。
    菜单打开时 daemon 从内存直接返回合并结果。取代第一轮第 5 条中"后台刷新会拉起 CLI"的部分；"composer 聚焦预取""加载中面板"保留。
21. 全新 provider+cwd 无缓存时：先显示扫描结果 + 内置命令，底部提示"发送一条消息后加载全部指令"。
22. Claude 用 init `skills` 精确区分 skill/命令（替代名单猜测），扫描所得按所在目录判定；隐藏 `terminal_slash_commands`。
23. 所有 provider 统一遵守：Codex 用缓存 + 扫 `~/.codex/prompts` 与 skills 目录，不再为列表重连 app-server；Pi 仅进程运行时询问；ACP 维持被动缓存；草稿不再建临时会话。

## 收尾决定

24. 写 ADR：`docs/adr/0003-command-list-never-spawns.md`（已写）。
25. `list_commands_response` 新增可选字段表示列表是否完整（旧客户端忽略；新客户端连旧 daemon 视为完整、不显示提示）；`terminal_slash_commands` 全端隐藏。

访谈结束，用户确认共识。下一步：用户运行 `/atw-spec` 写父任务与三个子任务的 prd.md。
