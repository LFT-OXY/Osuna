# 会话历史面板：Explorer sidebar 列出项目内的 Provider session 并在终端恢复

**Status:** ready-for-agent
**前置任务:** `09-17-history-open-archived-agent`（Paseo 已拥有的会话点击后走 History 的打开逻辑，该逻辑当前有 bug）

## Problem Statement

用户在同一个项目里会用多个客户端跟 agent 对话：Paseo 里开的 tab、终端里直接跑的 `claude` / `codex`、其他 GUI 客户端。这些对话留在各 Provider 的本地日志里，Paseo 只认识自己创建过的 Agent session。左栏 History 只列 Paseo 的 agent，外部会话要先在 Import session 面板里找到再导入才能看见，而且导入后变成 Paseo 聊天 tab，不是当时的原生会话窗口。用户想要的是：站在当前项目里，一眼看到这个项目下所有 Provider session，不论谁启动的，点一下就回到那个会话。

## Solution

在 Explorer sidebar 新增 **Session history（会话历史）** 视图，与 Changes / Files / PR 并列。它列出当前 host 上与作用域相关的 Provider session，作用域三档：当前 workspace、当前 project、整个 host，默认 project。点击一行，在当前 workspace 新开一个终端 tab，直接以 resume 命令启动那个 Provider 的原生会话；再点同一行则聚焦已开的终端。Paseo 曾经拥有的会话（导入过或本来就是 Paseo 启动的）在行上标出，点击走 Paseo 自己的打开逻辑，不再起终端。行的右键 / 长按菜单提供"复制 resume 命令"和"导入为 Paseo agent"。

## User Stories

1. 作为用户，我想在 Explorer sidebar 打开"会话历史"视图，以便不离开 workspace 就看到这个项目的会话。
2. 作为用户，我想看到当前 project 下所有 workspace（含 worktree）的 Provider session，以便找到在别的 worktree 里跑过的对话。
3. 作为用户，我想把作用域收窄到当前 workspace，以便只看这个目录的会话。
4. 作为用户，我想把作用域放宽到整个 host，以便找到已经归档的 workspace 或项目外目录的会话。
5. 作为用户，我想让面板记住我上次选的作用域，以便下次打开不用再切。
6. 作为用户，我想看到终端里直接跑的 `claude`、`codex`、`opencode`、`pi`、`omp`、`copilot`、`hermes` 会话，以便不必先导入。
7. 作为用户，我想每行显示会话标题、Provider 图标、相对时间，以便快速认出是哪次对话。
8. 作为用户，我想在 project 与 host 作用域下看到会话所在目录相对项目根的路径，以便区分同名会话来自哪个 worktree。
9. 作为用户，我想点击一行就在当前 workspace 新开一个终端并恢复那个会话，以便回到当时的原生会话窗口。
10. 作为用户，我想重复点击同一行时聚焦已经打开的那个终端而不是再开一个，以便不产生重复进程。
11. 作为用户，我想看到 Paseo 曾经拥有的会话被标出来，以便知道它在 Paseo 里已有记录。
12. 作为用户，我想点击 Paseo 曾经拥有的会话时打开它的 Paseo tab（含已归档的），以便同一个会话只有一个主人。
13. 作为用户，我想通过右键或长按复制 resume 命令，以便在 Paseo 之外的终端里手动恢复。
14. 作为用户，我想通过右键或长按把一条外部会话导入为 Paseo agent，以便从手机继续这段对话。
15. 作为用户，我想在面板顶部搜索，以便在几十条会话里按标题或提示词找到目标。
16. 作为用户，我想列表按最后活动时间倒序，以便最近的对话在最上面。
17. 作为用户，我想打开视图、切回窗口时列表自动刷新，并有手动刷新按钮，以便看到刚在终端里结束的会话。
18. 作为用户，我想在 host 断开或 daemon 版本过旧时看到明确提示，以便知道该更新 host 还是等重连。
19. 作为用户，我想在某个已安装的 Provider 查询失败时仍看到其他 Provider 的会话，并被告知哪个失败了；没装的 Provider（如 copilot）不该出现在提示里，以便不用的 Provider 不打扰我。
20. 作为用户，我想在手机的紧凑布局下同样从 Explorer 覆盖层进入会话历史，以便手机上也能恢复会话。
21. 作为中文用户，我想面板里的全部界面文案都是中文，以便与其他界面一致。

## Implementation Decisions

### 协议（只加不改）

- `fetch_recent_provider_sessions_request` 新增可选布尔字段 `includeImported`。为 true 时 daemon 不再剔除已导入的会话。
- `RecentProviderSessionDescriptorPayload` 新增可选字段 `importedAgentId`：该 Provider session 对应的 Paseo agent id，未导入则缺省。daemon 在 `includeImported` 为 true 时填写。
- 同时新增可选字段 `importedAgentWorkspaceId`：该 agent 所属 workspace。History 的打开逻辑靠它落到 workspace tab 并固定；缺了它，已归档（不在 session store 里的）agent 会退到 host 级详情路由并丢掉 pin。ownership 标记之前的旧 agent 没有 workspace，此时缺省。
- `server_info.features` 新增能力位 `sessionHistory`。客户端一次性门控：能力位为假时视图显示"请更新 host"，不做回退路径。
- 不新增 RPC，沿用现有 flat 名称，因为这是已有 RPC 的字段扩展。

### Daemon

- `listImportableProviderSessions` 按 `includeImported` 决定是否过滤，已导入的会话把 agent id 与 workspace id 写进 descriptor。已导入集合的采集逻辑复用现有实现；已归档记录也算主人，但活 agent 与归档记录共用同一 handle 时报活 agent。
- 扇出前先过一遍 `client.isAvailable()`：未安装的 Provider 直接跳过，既不列会话也不进 `providerErrors`；已安装但列出失败的仍进 `providerErrors`。理由：CLI 没装的会话无法 resume，列出来没有意义，而"没装"对不用它的用户不是错误。Import session 面板同一条 RPC，同样受益。
- 其余行为（cwd realpath 匹配、`since`、metadata 会话剔除、limit）不变。

### 客户端：视图与壳

- `ExplorerSidebarView` 新增 `"sessions"`，对应新的 tab target `session_history`。Panel manifest 标为仅 explorer 宿主、单例。
- 会话历史是 Explorer sidebar 的默认 tab 之一，与 Files / Changes 并列，不需要用户手动打开：新 workspace 的 explorer pane 种子里带它；已保存的旧布局在加载时补上（只补一次，用户关掉后不再自动出现）。
- 桌面端 tab rail 的上下文菜单、New Tab 启动器、紧凑布局的 Explorer 覆盖层分段控件都加入该视图，与 Files / Changes 同一目录来源。
- 视图是 directory-backed surface 的变体：数据按 `(serverId, 作用域, cwd 列表)` 取，不按 workspaceId；但"哪个终端 tab 属于哪条会话"是 workspace-owned 状态。

### 作用域

- 三档：`workspace` / `project` / `host`。持久化为一个全局、按设备的偏好，默认 `project`。
- `workspace`：一次请求，`cwd` = 当前 workspace 的 cwd。
- `project`：对当前 project 在当前 host 上的每个活动 workspace 的 cwd 各发一次请求，客户端合并并按 `providerId + providerHandleId` 去重。
- `host`：一次请求，不带 `cwd`。
- 每次请求 `limit` 取协议上限 200，`includeImported: true`。

### 数据与刷新

- 用 react-query 管理，查询键含 serverId、作用域、cwd 列表。
- 刷新时机：查询挂载、窗口重新获得焦点、手动刷新按钮。不轮询，不监听文件。
- 搜索在客户端进行，匹配标题、首条与末条提示词预览；不把 `query` 传给 daemon。
- 排序固定为 `lastActivityAt` 倒序。

### 行模型

- 只列出有 resume 命令模板的 Provider。模板表补 `copilot`：`copilot --resume=<id>`。
- 标题回退链：会话标题 → 首条提示词预览 → Provider 名称。
- 行内：标题、Provider 图标、相对时间；`project` 与 `host` 作用域下再显示 cwd 相对项目根的路径，cwd 在项目根之外时显示完整路径。
- `importedAgentId` 存在时显示"Paseo"标记。

### 点击行为

- 有 `importedAgentId`：调用与左栏 History 相同的打开逻辑（`navigateToAgent` 带 `workspaceId` 与 `pin: true`），不起终端。已归档 agent 的 tab 能否真正出现依赖前置 bug 任务修好。
- 无 `importedAgentId`：
  - 若本 workspace 已为该会话创建过终端且该终端仍在 daemon 的终端列表中，聚焦那个 tab。
  - 否则用现有终端创建通道创建终端：`cwd` 为会话的 cwd，`command` 与 `args` 来自模板表的 resume 项，终端名为会话标题，并携带当前主题的 view attributes。创建后记录 `providerHandleId → terminalId` 的映射。
- 映射存在客户端内存里，按 `serverId:workspaceId` 分桶；应用重启后丢失，下次点击会再开一个终端。这是有意的取舍，见 Further Notes。
- 终端进程退出后 tab 按现有终端行为处理，面板不做额外事。

### 次级动作

- 菜单入口遵循 `docs/hover.md` 与 `docs/menus.md`：桌面端悬停显示 kebab、右键打开；原生端长按。
- "复制 resume 命令"：复制模板生成的完整命令。
- "导入为 Paseo agent"：复用现有导入 RPC 与 `resolveImportTarget`（workspace 作用域视为 scoped listing），`importedAgentId` 存在时不显示。导入后去向：跨 workspace 与 Import session 面板相同（`useNavigateToImportedAgent`）；本 workspace 走本面板打开 agent 的同一条路（`navigateToAgent` 带 `workspaceId` 与 `pin: true`），与 Import session 面板的 `openWorkspaceTabFocused + navigateToTabId` 结果相同但不依赖 workspace screen 的局部回调。导入成功后重新拉取列表，让该行换上"Paseo"标记。
- 终端映射键用 `providerId:providerHandleId`（行 key），比单独的 handle id 更严格；点击时先向 daemon 列出本 workspace 的终端（`list_terminals_request` 带 `workspaceId` 时 daemon 聚合全部目录再按 workspaceId 过滤，所以会话 cwd 不在 workspace 目录下也能命中），终端已不存在则清理映射并新建。

### 状态

- host 未连接：复用现有"host 已断开"包装态。
- 能力位缺失：显示"更新 host"提示。
- 列表为空：空态文案区分"该作用域没有会话"与"搜索无结果"。
- `providerErrors` 非空：列表上方一条可收起的警示，逐个列出 Provider 名与原始错误；不翻译原始错误。未安装的 Provider 不会出现在这里（daemon 侧已跳过）。

### 文案

- 全部通过 i18n 资源，九个 locale 同步补 key，跑资源平价测试。

## Testing Decisions

好的测试只断言外部行为：给定 daemon 返回的 descriptor 与 Paseo 侧状态，面板显示什么行、点击后调用了哪个 RPC、带什么参数。不断言内部 store 形状。

接缝，从高到低，尽量只用前两个：

1. **面板组件 + 假 DaemonClient**：仿照 `import-session-sheet.test.tsx`，渲染视图并注入实现了 `fetchRecentProviderSessions` / `createTerminal` / `importAgent` 的假 client，覆盖：三档作用域发出的请求参数、去重、搜索过滤、排序、Paseo 标记、点击创建终端的 `cwd/command/args`、重复点击聚焦、无模板 Provider 被过滤、providerErrors 展示、能力位缺失态。
2. **daemon 列表函数**：扩展 `import-sessions.test.ts`，覆盖 `includeImported` 为真时不过滤且 `importedAgentId` 正确、为假时行为不变。
3. 协议 schema：现有消息 schema 测试加新字段的解析与旧 payload 兼容。
4. 纯函数：resume 命令模板表加 copilot 用例；`explorer-sidebar.test.ts` 与 `panel-manifest.test.ts` 加新视图。

不新增 Playwright 浏览器用例；如需 UI 证据按 `docs/qa.md` 截图。

## Out of Scope

- Orca 式的本地文件扫描器与更多 agent（gemini、cursor、kimi 等）。后续独立任务。
- 行内分支、模型、消息数、token 数。
- 跨 host 的"全部"作用域。
- 排序切换、按 Provider 分组。
- 拖拽会话到某个 pane 恢复。
- 删除会话、打开日志文件、打开 cwd。
- Paseo 内"跳回原 pane"以外的活会话状态（如运行中指示）。
- 修复 History 打开已归档 agent 的 bug（前置任务）。

## Further Notes

- **Codex 的可见性**依赖那台 host 装有 codex CLI：daemon 通过起 app-server 查询线程列表。没装时 daemon 跳过它，面板不列会话也不提示。
- **"未安装"的判定就是 `client.isAvailable()`**：它同时覆盖 CLI 不在 PATH 与自定义 command 路径配错两种情况，后者也会被静默跳过。理由：两者都无法 resume，而 Provider 配置错误已有"设置 → Provider 诊断"这条专门通道，不该由会话历史面板来报。
- **终端映射不持久化**的原因：终端本身在 daemon 侧存活并可跨重启恢复，但把 `providerHandleId → terminalId` 写进持久化布局需要在终端被 daemon 回收时同步清理，成本高于收益。重启后再开一个终端是可接受的退化。
- **同一会话双主人**的规避：Paseo 曾拥有的会话一律走 Paseo 打开逻辑，避免 Paseo 与终端同时 resume 同一个 Claude 会话导致两份日志互不可见。
- 术语见 `docs/glossary.md` 的 **Provider session** 与 **Session history**；本任务的发现与决策记录在 `research/discovery.md`。

## 验收标准

- [ ] 桌面端 Explorer sidebar 默认就有"会话历史"tab（新 workspace 与旧布局都有），紧凑布局的 Explorer 覆盖层同样可达。
- [ ] 作用域三档可切换并在重启后保留；默认 project。
- [ ] project 作用域列出该 project 在当前 host 上所有活动 workspace 的会话，无重复。
- [ ] 在终端里直接跑的 `claude` 会话出现在列表中；点击后当前 workspace 出现新终端 tab，进程为 `claude --resume <id>`，cwd 为会话目录。
- [ ] 同一行再次点击聚焦已有终端，不新建。
- [ ] 已导入的会话带"Paseo"标记，点击打开其 Paseo tab。
- [ ] 右键 / 长按菜单可复制 resume 命令、可导入为 Paseo agent。
- [ ] 搜索按标题与提示词预览过滤；列表按最后活动倒序。
- [ ] 某已安装 Provider 失败时其他 Provider 的会话仍显示，并可看到失败原因；未安装的 Provider 不出现在警示里。
- [ ] 旧版 daemon 下显示"更新 host"提示，无报错。
- [ ] 中文界面下面板文案全部为中文；资源平价测试通过。
- [ ] `npm run typecheck`、`npm run lint` 通过；上述接缝 1 与 2 的测试通过。
