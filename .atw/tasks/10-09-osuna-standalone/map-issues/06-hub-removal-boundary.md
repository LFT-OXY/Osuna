# 06 — Hub 移除边界：daemon 与协议侧删到哪

**Type:** interview
**Blocked by:** None
**Status:** resolved

## Question

Hub 整体移除已定（Q8）。CLI `hub` 子命令与文档直接删没有争议；daemon 侧 `packages/server/src/server/hub/`（daemon-executions、execution-controller、relationship-controller/remote/retry 及测试）和协议里的 Hub 消息、`hub.execute` 等权限、`PASEO_HUB_URL` / `PASEO_HUB_API_KEY` 配置项要决定：

1. 全删，还是先停用再删？`docs/protocol-compatibility.md` 要求协议向后兼容；但 Osuna 1.0.0 之后唯一的旧客户端是 0.14.x 桌面端（它自带 daemon，升级即整体替换），网页端与安卓包都从 1.0.0 起步。推荐：协议里的 Hub 消息与权限**直接删除**，不打 COMPAT 标签——理由是没有需要兼容的旧客户端。需要用户确认这个判断（是否还有人在用 CLI 直连 0.14.x daemon？）。
2. `docs/permissions.md` 里 Hub authority 一节、`public-docs/hub/` 整目录、`SECURITY.md` 与 `public-docs/hub/security.md` 的 Hub 段落一并删除。
3. 设置页 / 主机页里是否有 Hub 入口或配对项（先在代码里核实再问）。

先用 `fast_context_search` / `codebase-memory-mcp` 把 Hub 的调用链与改动半径列出来，再带着清单访谈。

## Answer

访谈于 2026-10-09 结束，五项全部按推荐拍板。

1. **协议层直接删除，不打 COMPAT 标签。** 理由：0.14.x 桌面端自带 daemon、升级即整体替换；网页端与安卓包从 1.0.0 起步；`hub.*` 消息唯一发送方是已被移除的 Hub 服务。删除项：`HubManagementDaemon*` 4 对请求/响应、`HubExecutionAgentCreate/Validate/Control` 3 对及错误 schema、`SessionEventSubscription` 的 `hub.execution.agent.update/stream`、`clientType` 枚举的 `"hub"`、`server_info.features.hubAgentRpc / hubRelationship`、`HubRelationshipStatusSchema`、`messages.hub.test.ts`；`ws-outbound.aot.ts` 重生成。client 侧 `connectHub / updateHubPermissions / getHubStatus / disconnectHub / requireHubRelationshipSupport` 与 `clientType` 的 `"hub"` 同删。
2. **`hub.execute` 权限整体删除。** `DAEMON_PERMISSIONS` 去掉该值；`operation-permissions.ts` 约 70 处备选权限只保留原有 workspace/daemon 权限，行为不变；`session.ts` 创建 agent 处的 `hub.execute` 判断删；`authorization/index.ts` 的 `permissionsForLegacyHubScopes`（COMPAT semanticHubPermissions）删。无持久化风险：唯一带持久化权限的主体是 owner（拿全量），`hub.execute` 没有别的落盘点。
3. **`$OSUNA_HOME/hub-relationship.json`（含 `hub-relationship.invalid-*.json`）不碰、不删、不提示**，文档不提。与 Q6c"永不自动删除旧数据"一致。
4. **`hub-e2e` 合成 provider 随 Hub 模块删除**，含 `provider-policy.real.e2e.test.ts`，不保留为通用测试夹具。
5. **文档与官网删除边界**：
   - 整删：`docs/hub.md`、`public-docs/hub/` 21 个文件、`packages/cli/src/commands/hub/`、`packages/cli/tests/37-hub-deploy.test.ts`、`packages/server/src/server/hub/` 16 个文件、官网 `routes/hub.tsx`、`hub-plans.ts`、`hub-doc-examples.test.ts`。
   - 删节不删篇：`docs/permissions.md`（Hub 一节、权限表 `hub.execute` 行、`tunnel.manage` 行的"Hub"字样）、`docs/architecture.md`（"Paseo Hub" 一节与第 349 行）、`docs/providers.md:37`、`docs/testing.md:207`、`docs/refactors/session-decomposition-plan.md`、`public-docs/cli.md` Hub 节、`public-docs/security.md` "Hub identities" 节、`connectivity.md` / `schedules.md` / `why.md` 各一句、`CLAUDE.md` 文档表（删 `public-docs/hub/security.md` 行，改 `permissions.md` 描述）、`.atw/spec/server/backend/directory-structure.md` 与 `rpc-and-protocol.md` 两处提及。
   - 官网：`vite.config.ts` 预渲染路由、`server-entry.ts` 重定向、页脚链接、首页 CTA、`llms.ts` 条目、`privacy.tsx` / `terms.tsx` 的 Hub 段全删；privacy / terms 页面本身保不保留与首页样子归 10 号票。
   - CI 随带：`ci-paths.yml` 的 `hub` 过滤器、`ci.yml` 的 `hub` 输出与 `test:hub-cli-contract` 步骤、`packages/server/package.json` 同名脚本。
   - 票面原假设 `SECURITY.md` 有 Hub 段落不成立，该文件无需改动。

**核实事实**：app 没有任何 Hub 入口或配对项（仅 `command-center/results.test.ts` 一个测试引用），票面第 3 问无需决定。daemon 侧 `bootstrap.ts` 的 `hubAgentLifecycle` 是 Hub 专用的 `CreateAgentLifecycleDispatch` 实例，随删；`session.ts` 自己那份实例保留。
