# 04 — 其他 provider 统一遵守"不为列表启动进程"

**What to build:** Codex、Pi、OpenCode、Copilot 及其他 ACP、OMP agent（含草稿）请求指令列表时，全部走指令目录：只有进程或服务本来就在运行才向它取最新列表并写缓存，否则用缓存 + 免进程发现 + 内置命令，绝不为取列表重连或启动任何东西。见 PRD「provider 侧接口」表格。

**Status:** ready-for-agent
**Impl:** ready

**Blocked by:** 01

- [ ] Codex：免进程发现 = `~/.codex/prompts/*.md`（`prompts:` 前缀）+ 现有 skills 目录扫描（改为常规来源）；内置 `compact`、启用时 `goal`；app-server 断开时不再为列表重连
- [ ] Pi：仅进程运行时 `get_commands`；否则缓存 + 内置命令
- [ ] OpenCode：仅会话所用服务已在运行时 `command.list`；否则缓存 + `compact`、`summarize`
- [ ] Copilot / 其他 ACP、OMP：已有被动缓存接入指令目录的上报通道
- [ ] 测试：`codex-app-server-agent.test.ts`、`pi/agent.test.ts` 各补"不为列表重连 / 不调 CLI"断言；S1 补一个非 Claude provider 的草稿用例
- [ ] `typecheck`、`lint` 通过
