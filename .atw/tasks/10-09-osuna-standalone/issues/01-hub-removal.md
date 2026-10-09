# 01 — Hub 整体移除

**What to build:** 用户与贡献者在 Osuna 的任何一端都看不到 Hub：daemon 不再接受或发出 Hub 消息，CLI 没有 `hub` 子命令，权限表没有 `hub.execute`，文档与官网没有 Hub 页面与入口，CI 不再路由 Hub 测试。daemon 对旧的 hub-relationship 文件不读不删不提示。协议层直接删除、不打 COMPAT（地图 06 号票的五项边界）。

**Blocked by:** None — can start immediately
**Status:** ready-for-agent
**Impl:** ready

- [ ] 协议里 Hub 管理与执行的 7 对请求/响应、2 个会话事件、`clientType` 的 `"hub"`、`features.hubAgentRpc / hubRelationship`、Hub 关系状态 schema 全部删除，AOT 校验重生成；client 侧对应方法与类型同删
- [ ] `hub.execute` 从 daemon 权限集删除；操作权限表约 70 处备选权限只保留原有 workspace/daemon 权限，现有权限测试全绿、行为不变；创建 agent 处的判断与旧 Hub scope 兼容映射删除
- [ ] daemon Hub 模块、Hub 专用 agent 生命周期分发实例、`hub-e2e` 合成 provider 及其测试、CLI `hub` 子命令及其测试删除；`$OSUNA_HOME/hub-relationship*.json` 不被读写
- [ ] `docs/hub.md`、`public-docs/hub/` 整删；permissions / architecture / providers / testing / cli / security / connectivity / schedules / why 等页按 06 号票删节不删篇；`CLAUDE.md` 文档表删 Hub 行并改 permissions 描述；`.atw/spec` 两处提及删除
- [ ] 官网 Hub 路由、预渲染路由、重定向、页脚链接、首页 CTA、llms 条目、privacy / terms 的 Hub 段、hub-plans 与 hub 文档示例测试删除
- [ ] CI 的 `hub` 路径过滤器、`hub` 输出、`test:hub-cli-contract` 步骤与同名 package 脚本删除
- [ ] `npm run typecheck`、`npm run lint` 全绿；相关包的现有测试绿；仓库内 `hub` 的剩余命中仅为无关词义
