# 05 — 未安装的 Provider 不进入会话列表与错误提示

**What to build:** 用户没装 copilot（或其他 Provider）时，会话历史面板顶部不再出现"无法列出 copilot 的会话 / command not found"的警示。daemon 扇出列会话前先查 `client.isAvailable()`，未安装的直接跳过；已安装但列出失败的仍进 `providerErrors`。Import session 面板走同一条 RPC，同样不再显示未安装 Provider 的失败。

**Impl:** done
**Status:** ready-for-agent

**Blocked by:** 02

- [x] `listImportableSessions` 在 `providerEntries` 过滤后、发起列表前并行调用 `client.isAvailable()`，为 false 的 Provider 不列会话、不写 `providerErrors`；`isAvailable()` 抛错按"不可用"处理并只记 warn 日志
- [x] 已安装 Provider 的列表失败行为不变（仍进 `providerErrors`）
- [x] 协议不改；客户端不改
- [x] 测试：扩展 `import-sessions.test.ts` 或 agent-manager 的现有套件——一个不可用 Provider 与一个可用但抛错的 Provider 同时存在时，响应只含后者的错误且不含前者的会话
- [x] `npm run typecheck`、`npm run lint` 通过；`npm run build:server` 已跑
- [ ] 在 dev 桌面端确认警示消失（需重启用户正在运行的 dev 桌面端，未代为执行）
