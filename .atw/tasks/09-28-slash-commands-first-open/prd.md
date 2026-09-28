# 斜杠指令列表首开提速

父任务：`09-28-composer-slash-revamp`。规则来源：`docs/adr/0003-command-list-never-spawns.md`。

## Problem Statement

在一个刚打开、还没发过消息的 agent 里第一次输入 `/`，要等 1-3 秒 Command menu 才出现，这段时间屏幕上什么都没有。之后再打开就很快。草稿 agent（还没创建的新 agent）同样慢，有时更慢。

原因有三层：

- 客户端只在检测到 `/` 之后才去拉列表，拉取期间面板整个隐藏。
- daemon 没有指令列表缓存。Claude 的 agent 如果当前没有在跑的 CLI 进程，daemon 会为了取列表先启动 `claude` CLI、等它握手完成；草稿则是临时建一整个会话、取完列表再关掉。
- Codex 断开时会为了取列表重连 app-server；Pi 每次都向 CLI 发 RPC。

另外，Claude 的"哪些是 skill、哪些是命令"现在靠一份命令名单猜，`.claude/commands` 里的自定义命令会被误判成 skill；只能在本地终端用的命令（如 exit、statusline）也出现在菜单里。

## Solution

- 输入 `/` 后 Command menu 立刻出现，无论是老项目还是全新项目、已有 agent 还是草稿。
- daemon 为每个 provider + 工作目录维护一份指令目录（command catalog），由三路合并而成：
  1. provider 运行中进程上报过的完整列表，存盘，daemon 重启后仍在；
  2. 扫描 provider 的 skill / command 目录，刚装的 skill 马上出现；
  3. 代码里写死的内置命令，保证菜单永远不空。
- 取列表时绝不启动任何进程。只有进程本来就在运行时，才顺便向它要最新列表并更新缓存。
- 从没跑过进程的 provider + 目录，菜单先显示扫描结果和内置命令，底部加一行提示"发送一条消息后加载全部指令"。
- Composer input 获得焦点时就预取列表，打开菜单时直接用。
- Claude 改用 SDK 给出的 `skills` 名单区分 skill 与命令，并隐藏 SDK 标出的终端专用命令。

## User Stories

1. 作为用户，我想在已有 agent 里第一次输入 `/` 时菜单立刻出现，以便不用干等。
2. 作为用户，我想在草稿 agent 里输入 `/` 时菜单也立刻出现，以便新建 agent 前就能挑 skill。
3. 作为用户，我想在 daemon 重启后第一次输入 `/` 依然立刻看到完整列表，以便重启不影响使用。
4. 作为用户，我想在同一目录下新开的 agent 里直接看到之前该目录用过的完整列表，以便不必每个 agent 都先发一条消息。
5. 作为用户，我想刚装进 `~/.claude/skills` 或项目 `.claude/skills` 的 skill 下次输入 `/` 就出现，以便不用重启任何东西。
6. 作为用户，我想在从没用过的目录里输入 `/` 时至少看到扫描到的 skill 和内置命令，以便菜单不是空的。
7. 作为用户，我想在列表不完整时看到"发送一条消息后加载全部指令"的提示，以便知道插件和 MCP 的指令为什么还没出现。
8. 作为用户，我想在发送第一条消息之后再输入 `/`，看到包含插件、MCP 在内的完整列表，并且提示消失，以便确认列表已补全。
9. 作为用户，我想在一切都还没返回的极短时间里看到面板显示"加载中"，而不是什么都没有，以便知道操作已被接收。
10. 作为用户，我想只是点开或查看一个 agent 时不会因为指令列表而多出 CLI 进程，以便不浪费机器资源。
11. 作为 Claude 用户，我想让 `.claude/commands` 里的自定义命令归到"命令"而不是"技能"，以便分组正确、后续 chip 只针对真正的 skill。
12. 作为 Claude 用户，我想让 exit、statusline 这类只能在本地终端用的命令不出现在菜单里，以便不会选到用不了的命令。
13. 作为 Claude 用户，我想在会话中途 Claude 发现新 skill（`commands_changed`）后，下次打开菜单就能看到，以便列表跟上 CLI 的实际状态。
14. 作为 Codex 用户，我想在 app-server 断开时菜单仍然立刻显示缓存列表和 `~/.codex/prompts`、skills 目录里的条目，以便不因为取列表而重连。
15. 作为 Pi 用户，我想在 Pi 进程没在跑时看到缓存列表，以便不为了取列表去调 CLI。
16. 作为 OpenCode、Copilot 及其他 ACP agent 的用户，我想得到同样"先用缓存、进程在跑才刷新"的行为，以便各 provider 表现一致。
17. 作为用户，我想在一个缓存里存在、但已从磁盘删掉的 skill 于下次进程上报后消失，以便列表最终与实际一致。
18. 作为手机端用户，我想得到和桌面相同的立刻出现的菜单，以便远程使用同样顺畅。
19. 作为用新版 App 连旧 daemon 的用户，我想菜单照常工作、只是不显示"不完整"提示，以便版本不一致时不出错。
20. 作为用旧版 App 连新 daemon 的用户，我想菜单照常工作，以便不必同时升级两端。

## Implementation Decisions

### daemon：指令目录（command catalog）

- 新增一个深模块，归 AgentManager 所有，对外只有一个查询入口：给定 provider、工作目录、可选的 agentId，返回 `{ commands, partial }`。已有 agent 与草稿都走这个入口；草稿不再建临时会话，也不再要求先有 model。
- 合并顺序与规则：
  - 若给了 agentId 且该 agent 的进程正在运行，取它的实时列表作为"上报列表"，并写回缓存。
  - 否则用磁盘缓存里该 provider + 目录的上报列表。
  - 再并入目录扫描结果与内置命令；同名时上报列表优先，扫描结果只补上报列表里没有的名字。
  - `partial` 为真，当且仅当这个 provider + 目录既没有实时列表也没有缓存的上报列表。
- 缓存按 provider + 规范化后的工作目录存，落在 `$PASEO_HOME` 下的一个 JSON 文件，遵循 `docs/data-model.md`：Zod 校验、原子写、无迁移，读到坏文件当作空缓存。
- provider 进程每次上报完整列表时覆盖该条缓存（见下）。
- 查询过程只读内存与本地文件，不发起任何进程或网络连接。
- 已存储但未加载的 agent 取列表时不加载、不恢复，只借用记录里的 provider 与工作目录查目录。
- 缓存文件 `$PASEO_HOME/command-catalog.json` 最多 200 条，按最近上报淘汰；内容不变时不重写。

### provider 侧接口

- provider client 新增"免进程发现"能力：给定工作目录，返回扫描所得条目加内置命令，不得启动进程或建立连接。
- provider session 的取列表改为"只看不启"：进程在运行则返回实时列表，否则返回"无"；原来会触发 `ensureQuery` / 重连的路径不再从取列表进入。
- provider session 在拿到完整列表时发出 `commands_changed` stream 事件（`{ type, provider, commands }`），AgentManager 在 `dispatchSessionEvent` 里按该 agent 的 provider + cwd 写入缓存，不转发给客户端。
- 各 provider 的三路来源：

| provider | 上报列表何时产生 | 免进程发现 | 内置命令 |
|---|---|---|---|
| Claude | 每条 init 消息（随 turn 到达）后读 `supportedCommands()`；收到 `commands_changed` 时直接用其 `commands` 覆盖；query 已启动但还没跑过 turn 时无上报列表 | 扫 `$CLAUDE_CONFIG_DIR`（默认 `~/.claude`）与 `<cwd>/.claude` 下的 `skills/*/SKILL.md` 和 `commands/**/*.md`，读 frontmatter 的 name、description、argument-hint；子目录命令名用 `:` 连接 | 现有 root-only 名单里经 SDK 可用的命令 + 合成的 `rewind` |
| Codex | app-server 已连接时的 `skills/list` 结果 | `~/.codex/prompts/*.md`（`prompts:` 前缀）与现有 skills 目录扫描（现在只作失败兜底，改为常规来源） | `compact`，以及启用时的 `goal` |
| Pi | 进程运行时的 `get_commands` | 无 | 现有 Pi 自处理的内置命令 |
| OpenCode | 会话所用服务已在运行时的 `command.list` | 无 | `compact`、`summarize` |
| Copilot / 其他 ACP、OMP | 已有的 `available_commands_update` / 更新事件缓存 | 无 | 无 |

- 同名的扫描结果以个人目录（`$CLAUDE_CONFIG_DIR`）优先于项目目录；`commands/` 下的符号链接子目录按目录处理；缺 description 时取正文第一行非空文本。
- Claude 内置命令即现有 10 个 root-only 命令加 `rewind`；SDK 0.3.246 的 `supportedCommands()` 实测 10 个都在，`agent-commands.real.e2e.test.ts` 逐项断言。
- 删除 `AgentClient.listCommands(config)`：它唯一的实现（OpenCode）为取列表启动服务，违反 ADR。工单 04 完成前，非 Claude 的草稿只得到发现结果（多为空）和 `partial: true`。
- Claude 的 `kind`：有上报列表时，名字在 init `skills` 名单里的为 `skill`，其余为 `command`；只有扫描结果时，来自 `skills` 目录的为 `skill`，来自 `commands` 目录的为 `command`。删除按名单猜的旧逻辑。
- Claude 隐藏 init `terminal_slash_commands` 里的命令，所有端一致。过滤只作用于上报列表；内置名单不经过滤，`agent-commands.real.e2e.test.ts` 断言每个内置命令都留在过滤后的上报列表里、`kind` 为 `command`。
- 已知限制：`commands_changed` 不带 `skills`，会话中途新增的 skill 在下一次 init（下一个 turn）前标为 `command`。
- Claude 的初始化与 `commands_changed` 都已在 SDK 消息流里，只需接入；SDK 版本见 `research/command-list-references.md`。

### 协议

- `list_commands_response` 的 payload 新增可选布尔字段 `partial`，缺省视为完整。只做加法，schema 保持纯净（无 transform / catch / preprocess），见 `docs/protocol-compatibility.md`。
- 不新增 RPC，不需要 `server_info.features` 门控：旧客户端忽略该字段，新客户端连旧 daemon 时拿不到字段就不显示提示。

### 客户端

- Composer input 获得焦点、且该 pane 处于活动状态时预取指令列表；已有的连接与 retained-panel 条件照旧。
- 打开 Command menu 时面板立刻显示：
  - 有缓存数据就直接显示，同时后台重新请求（daemon 从内存返回，代价很低），拿到后原地替换；
  - 完全没有数据时显示一行"加载中"，此时不提供可选项（否则 Enter 会选中被加载行挡住的命令）；
  - 去掉"加载中就隐藏面板"的现有条件；
  - 请求不了（如断线）且从没拿到过数据时，面板照旧不显示，避免"加载中"永不消失。
- 客户端缓存的新鲜期缩短到每次打开菜单都会重新请求一次，但重新请求期间保留旧数据，不闪空；重新请求失败也沿用旧列表，只有从没拿到过数据时才显示错误。
- 草稿的客户端缓存键只含 provider 与规范化工作目录，与 daemon 的指令目录一致；切换 model、mode 不换键。
- `partial` 为真时，在列表底部显示一行不可选的提示"发送一条消息后加载全部指令"。提示行的最终样式由子任务 `09-28-slash-menu-restyle` 统一，这里只需功能正确。
- 新文案进 i18n，所有现有语言都补齐。

## Testing Decisions

好的测试只看对外行为：给定磁盘与进程状态，查询返回什么、有没有启动进程；不断言内部缓存结构或调用次序。

- **S1 · AgentManager 的指令列表入口**，参照 `agent-manager.test.ts` 现有写法，用假的 provider client：
  - 有实时列表、只有缓存、只有扫描 + 内置三种状态下的合并结果与 `partial`；
  - 同名冲突时上报列表优先；
  - 缓存写盘后，新建一个 AgentManager 实例仍能读到（模拟 daemon 重启）；
  - 已有 agent 与草稿两条路径都不会调用 `createSession`、不会让假 session 进入"已启动"状态；
  - 坏的缓存文件被当作空缓存。
- **S2 · Claude provider client**，参照 `claude/agent.test.ts`（可注入 `queryFactory`）：
  - 进程未启动时取列表不调用 `queryFactory`；
  - 在临时目录建 `skills/x/SKILL.md` 与 `commands/a/b.md`，扫描得到 `x`（skill）与 `a:b`（command），frontmatter 字段正确；
  - 用假的 init 消息给出 `skills` 与 `terminal_slash_commands`，验证 `kind` 与隐藏；
  - 假的 `commands_changed` 之后，上报列表被覆盖。
- **协议字段**：在现有 `claude/agent-commands.e2e.test.ts`（假 daemon）里断言 `partial` 经 DaemonClient 到达客户端。
- **客户端**：在 `use-agent-commands-query.test.ts` 或现有 autocomplete 可见性的纯函数测试里，断言"无数据时可见并显示加载中""有旧数据时重新请求期间不隐藏"。
- Codex、Pi 的"不为列表重连 / 不调 CLI"在各自现有单测文件里补一条断言（`codex-app-server-agent.test.ts`、`pi/agent.test.ts`）。
- 只跑改动到的测试文件，不跑全量。

## Out of Scope

- 列表变化后主动推送到已打开的菜单；下次打开生效即可。
- 扫描 Claude 插件目录、`enabledPlugins`、MCP prompts；这些只来自进程上报。
- 来源徽标所需的 source 字段。
- Command menu 的视觉改版（子任务 `09-28-slash-menu-restyle`）。
- 改变发送时各 provider 对 `/name` 文本的处理方式。

## Further Notes

- 验收：
  - 以前打开过的 provider + 目录，输入 `/` 后菜单立刻显示完整列表，daemon 重启后同样如此。
  - 从未打开过的，菜单立刻显示扫描结果 + 内置命令 + 提示行；发一条消息后再打开，列表补全、提示消失。
  - 打开 Command menu 前后，`ps` 里不多出 `claude` 等 provider 进程。
- 行为变化需在 PR 说明里写明：Claude 的自定义命令从"技能"移到"命令"，行中间输入 `/` 时不再出现它们。
- 调研记录：父任务 `research/discovery.md`、`research/command-list-references.md`。
