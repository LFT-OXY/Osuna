# 01 — Claude 列表改走指令目录，不再启动 CLI

**What to build:** 在一个空闲（没有运行中 CLI 进程）的 Claude agent 或 Claude 草稿里请求指令列表时，daemon 立刻从指令目录（command catalog）返回"缓存的上报列表 + 目录扫描 + 内置命令"的合并结果，全程不启动 `claude` CLI、不建临时会话；daemon 重启后缓存仍在。响应带上新的可选字段 `partial`，标明列表是否缺少进程上报的部分。见 PRD「daemon：指令目录」「provider 侧接口」「协议」三节与 `docs/adr/0003-command-list-never-spawns.md`。

**Status:** ready-for-agent
**Impl:** done

**Blocked by:** None — can start immediately

- [x] AgentManager 拥有指令目录，对外一个查询入口（provider、工作目录、可选 agentId → `{ commands, partial }`）；已有 agent 与草稿都走它，草稿不再要求先有 model、不再 `createSession`
- [x] 缓存按 provider + 规范化工作目录存于 `$PASEO_HOME` 下的 JSON（Zod 校验、原子写、坏文件视为空缓存）
- [x] Claude client 提供免进程发现：扫 `$CLAUDE_CONFIG_DIR`（默认 `~/.claude`）与 `<cwd>/.claude` 的 `skills/*/SKILL.md`、`commands/**/*.md`，读 frontmatter；子目录命令名以 `:` 连接；并入内置命令（现有 root-only 中 SDK 可用者 + `rewind`）
- [x] Claude session 取列表"只看不启"：进程运行中返回实时列表并写回缓存，否则不触发 `ensureQuery`
- [x] 同名时上报列表优先；`partial` 当且仅当既无实时列表也无缓存上报列表时为真
- [x] 协议 `list_commands_response` 新增可选 `partial`，schema 保持纯净；DaemonClient 能读到
- [x] 测试：S1（`agent-manager.test.ts` 风格，含"新实例读回缓存""不创建会话""坏文件"）、S2（`claude/agent.test.ts`，断言不调用 `queryFactory`、临时目录扫描结果）、`claude/agent-commands.e2e.test.ts` 断言 `partial` 到达客户端
- [x] `npm run typecheck`、`npm run lint` 通过；只跑改动的测试文件
