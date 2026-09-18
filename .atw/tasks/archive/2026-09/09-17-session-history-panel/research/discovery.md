# 发现记录（2026-09-17 访谈）

## 现状事实

- 左栏 History（Sessions 屏，`packages/app/src/screens/sessions-screen.tsx`）只列 Paseo 自建 agent（含归档），数据来自 `fetch_agent_history`；点击 → `navigateToAgent({pin:true})`（`components/agent-list.tsx:358-376`）。不含外部会话。
- 外部会话链路：`fetch_recent_provider_sessions`（`packages/protocol/src/messages.ts:1378`，descriptor `:913`：providerId/providerLabel/providerHandleId/cwd/title/firstPromptPreview/lastPromptPreview/lastActivityAt）→ `import_agent`（`:1783`）。daemon 扇出 `agent-manager.ts:969-1005`，业务层 `import-sessions.ts:119-176`（按 cwd realpath 过滤、剔除已导入）。
- Provider 发现方式：Claude 扫 `~/.claude/projects/**/*.jsonl`（`providers/claude/agent.ts:6132`）；Pi/OMP 扫各自 sessions 目录；Codex 起 app-server 走 `thread/list`（`codex-app-server-agent.ts:7128-7175`）；OpenCode 走 SDK；ACP 走 `session/list`。
- 客户端已有 resume 命令模板：`packages/app/src/utils/provider-command-templates.ts`（codex/claude/hermes/pi/omp/opencode），用于 tab 菜单"复制 resume 命令"（`workspace-screen.tsx:2710`）。
- Explorer sidebar 视图：`workspace-tabs/explorer-sidebar.ts:9` `ExplorerSidebarView = "changes" | "files" | "pr"`；panel manifest `panels/panel-manifest.ts`；directory-backed 边界见 `docs/architecture.md:381-405`。
- Orca 对应物 AI Vault：作用域 workspace/project/all（`src/shared/ai-vault-types.ts:42`）、点击默认新开终端跑 `cd <cwd> && <agent> --resume <id>`（`src/shared/ai-vault-resume-command.ts:193`）、活会话按 provider session id 匹配到原 pane 后改为跳转（`ai-vault-original-pane-index.ts`）、无文件监听，聚焦/手动刷新（`ai-vault-session-refresh.ts`）。

## 已定决策

- 落点：Explorer sidebar 新视图 "Session history"，directory-backed，按 `(serverId, cwd)`。
- 作用域：workspace / project / 全部（仅当前 host）三档，默认 project，记住上次选择。
- 发现：复用 `fetch_recent_provider_sessions`，不做文件扫描器（后续独立任务）。
- 点击：在当前 workspace 新开终端 tab，执行 `cd <cwd> && <resume 命令>`；重复点击聚焦已有终端 tab（按 providerHandleId）。
- 已被 Paseo 打开/导入的会话：照常显示并标"已在 Paseo 打开"，点击跳到原 tab。
- 只列有 resume 模板的 Provider；补 copilot 模板 `copilot --resume=<id>`。
- 行内：标题 + Provider 图标 + 相对时间 + 相对项目根目录（仅 project/全部作用域）。不做分支/模型/消息数。
- 次级动作：复制 resume 命令、导入为 Paseo agent。
- 搜索框（客户端过滤标题与提示词预览）；固定按最后活动倒序。
- 刷新：打开视图、窗口重获焦点、手动按钮；不轮询。
- 术语：Provider session / Session history 已写入 docs/glossary.md。

## 关联 bug（不属于本任务）

- History 点击已归档 agent 后跳到 workspace 但 tab 不打开；导入的会话同样。排查中。
- 终端恢复实现：`create_terminal_request` 已支持 `cwd/command/args`（`packages/protocol/src/messages.ts:2922-2929`），与终端配置文件同一路径直接起进程；不拼 shell 字符串。
- 已归档 Paseo agent 对应的 Provider session：视为 Paseo agent，走 History 相同的"打开已归档 agent"逻辑；Q13 bug 修复是本任务前置。
- 前置任务：`09-17-history-open-archived-agent`（候选根因与验证步骤见其 research/trace.md）。
