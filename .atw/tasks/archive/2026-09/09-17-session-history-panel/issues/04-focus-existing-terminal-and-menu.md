# 04 — 重复点击聚焦已有终端与次级菜单

**What to build:** 同一条会话再次点击时聚焦本 workspace 里已为它打开的终端 tab，而不是再起一个进程；行的悬停 kebab、右键、原生长按菜单提供"复制 resume 命令"和"导入为 Paseo agent"，后者复用现有导入流程并在会话已属于 Paseo 时隐藏。

**Impl:** done
**Status:** ready-for-agent

**Blocked by:** 03

- [x] `providerId:providerHandleId → terminalId` 映射存客户端内存（`session-history/internal/resume-terminals.ts`），按 `serverId:workspaceId` 分桶；应用重启后不保留
- [x] 再次点击：映射存在且该终端仍在 daemon 终端列表中则聚焦其 tab；终端已不存在则清理映射并新建
- [x] 菜单入口遵循 docs/hover.md 与 docs/menus.md：桌面悬停显示 kebab、右键打开；原生长按
- [x] "复制 resume 命令"复制模板生成的完整命令，复制成功走现有 toast
- [x] "导入为 Paseo agent"复用现有导入 RPC 与导入后导航；`importedAgentId` 存在时不显示
- [x] 文案走 i18n，九个 locale 同步
- [x] 测试：组件测试覆盖聚焦已有终端、终端消失后重建、两个菜单动作调用的 RPC 与剪贴板内容、导入项的隐藏条件
- [x] `npm run typecheck`、`npm run lint` 通过
