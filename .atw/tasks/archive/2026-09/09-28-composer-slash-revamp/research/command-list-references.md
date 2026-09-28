# 参考项目：斜杠列表的来源与加载

| 项目 | 列表来源 | 加载时机 | 缓存 | 是否为列表启动进程 |
|---|---|---|---|---|
| t3code | Claude：扫 `<config>/skills`、`<cwd>/.claude/skills`；Codex：app-server `skills/list` | composer 挂载时后台刷新 per-cwd 快照 | provider 快照落盘；per-cwd 快照内存（每 provider 16 个）；PubSub 推送 | 否（Claude） |
| desktop-cc-gui (ccgui-next) | 只扫目录：`.claude/commands/**/*.md`、各 `skills/*/SKILL.md`（Claude/Codex/`~/.agents`/Codex 插件） | 工作区打开即预取 | 内存 per workspace，60s TTL，旧值先用 | 否；无内置命令、无 Claude 插件、无 MCP |
| openchamber | 写死的内置命令 + OpenCode `command.list` + skill（OpenCode `skill.list` ∪ 目录扫描） | 首次输入 `/` 才拉（`command.list` 会拉起 MCP，故意不预取）；内置命令立刻显示 | 内存 per directory，5s TTL；OpenCode `command.updated`/`skill.updated` 事件推送失效 | 否 |
| codex-host | 只用运行中进程报告的列表（Claude：`initializationResult().commands`、init `skills`、`commands_changed`）+ 少量写死内置 | composer 挂载、切 agent、打开菜单 | 内存 per agent+cwd（LRU 64），进程每次报告即覆盖；1s 超时 | 否，明文规则"绝不为列表开会话"；无缓存时显示内置 + 提示"发送一条消息以加载全部指令" |

## 共识

- 四个项目都不为了取列表启动进程。
- 打开菜单时读的是本地已有数据（目录扫描结果或缓存），不现场请求。
- 写死一份内置命令，保证任何时候菜单不空（openchamber、codex-host）。

## Claude SDK 可用而 Osuna 未用的信号（`@anthropic-ai/claude-agent-sdk` 0.3.246 `sdk.d.ts`）

- init 系统消息带 `skills: string[]`（:4852）——可精确区分 skill 与命令，替代 `CLAUDE_ROOT_ONLY_COMMANDS` 名单猜测。
- init 带 `terminal_slash_commands`（:4850）——绑定本地终端的命令，注释建议远程/手机 UI 隐藏。
- `commands_changed` 系统消息（:3181）——会话中列表变化的全量推送。
- Osuna `providers/claude/*.ts` 均未使用以上三者。
