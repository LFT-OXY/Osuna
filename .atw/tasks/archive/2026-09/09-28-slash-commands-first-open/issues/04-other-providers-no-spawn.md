# 04 — 其他 provider 统一遵守"不为列表启动进程"

**What to build:** Codex、Pi、OpenCode、Copilot 及其他 ACP、OMP agent（含草稿）请求指令列表时，全部走指令目录：只有进程或服务本来就在运行才向它取最新列表并写缓存，否则用缓存 + 免进程发现 + 内置命令，绝不为取列表重连或启动任何东西。见 PRD「provider 侧接口」表格。

**Status:** ready-for-agent
**Impl:** done

**Blocked by:** 01

- [x] Codex：免进程发现 = `~/.codex/prompts/*.md`（`prompts:` 前缀）+ 现有 skills 目录扫描（改为常规来源）；内置 `compact`、启用时 `goal`；app-server 断开时不再为列表重连
- [x] Pi：仅进程运行时 `get_commands`；否则缓存 + 内置命令
- [x] OpenCode：仅会话所用服务已在运行时 `command.list`；否则缓存 + `compact`、`summarize`
- [x] Copilot / 其他 ACP、OMP：已有被动缓存接入指令目录的上报通道
- [x] 测试：`codex-app-server-agent.test.ts`、`pi/agent.test.ts` 各补"不为列表重连 / 不调 CLI"断言；S1 补一个非 Claude provider 的草稿用例
- [x] `typecheck`、`lint` 通过

**实现备注：**

- Codex、Pi、OpenCode 每个 turn 主动上报一次 `commands_changed`；ACP、OMP、插件 provider 在每次命令更新时上报。
- 删除 ACP 的 `waitForInitialCommands`（Cursor、Kiro、Trae 原先会等最多 10 秒）。
- 新增 `WorkspaceGitService.peekRepoRoot`，Codex 的发现只读已缓存的 git 快照。
- 插件 provider 也接入了上报通道，未上报时返回 null。它原本不在本工单列表里，审查时发现有同样的空列表覆盖缓存问题，所以一并处理。
