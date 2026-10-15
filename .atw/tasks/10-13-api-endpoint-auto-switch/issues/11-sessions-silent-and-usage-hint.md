# 11 — 会话无感与套餐用量提示

**What to build:** 会话不再记录「创建时的模式」：删除恢复旧对话时的模式提示模块、黄条，以及会话记录里的 `apiEndpointId` 读写（协议字段 `apiEndpointModeMismatch` 保留不发）。恢复旧对话不做任何检查与提示，请求由中转站按模型名路由，无路可走时的错误由 Agent 在对话里自然显示。套餐用量旁的提示：新客户端在总开关打开时显示「已启用第三方接口，此额度不代表实际消耗」（不点名）；老客户端照旧按投影那家点名。对应 prd R-D1、R-D2。

**Blocked by:** 03
**Status:** ready-for-agent
**Impl:** done

- [x] 模式提示模块与会话记录 `apiEndpointId` 读写已删除，在 server 与 app 两个包里搜 `apiEndpointId` 无业务代码命中；含该字段的旧会话文件仍能加载。（单元）
- [x] 恢复一段点名已删除接口的旧对话再发消息：界面无黄条、无提示；请求按同名换家成功，或由 Agent 显示包装后的错误。（e2e + Playwright 截图）
- [x] UI: 用量面板 / 总开关打开 / 桌面 1280 — 显示不点名提示；总开关关时不显示。
- [x] 老客户端（无能力标记）投影下的用量提示文案照旧点名。（组件测试）
- [x] 旧提示相关的翻译键删除，九种语言资源与守卫表同步。

**实现记录（2026-10-15）：**
- 旧会话文件仍能加载由 daemon e2e「an old record naming a deleted endpoint resumes without a notice and keeps working」证明（往记录里写回 `apiEndpointId` 后重启、恢复、发消息）。
- 界面截图走「归档 → 取消归档 → 发消息」：浏览器测试环境里 daemon 重启后 mock 会话加载不出来（去掉本票改动也一样），重启路径由上面的 daemon e2e 覆盖。截图 `screenshots/11-unarchived-old-session-no-notice-desktop-1280-en.png`。
- 用量提示只看快照 `activeApiEndpoint` 是否存在，显示不点名的 `usage.planUsage.apiEndpointsOnNote`；新 App 连旧主机也不点名（审查认定点名分支为范围外，已去掉）。老 App 的点名靠 daemon 继续在快照里下发 `activeApiEndpoint`（含名字），由 `api-endpoint-claude.e2e.test.ts`「enabling lists only the endpoint's models」断言，不是组件测试。原点名键 `usage.planUsage.apiEndpointNote` 随之成为孤儿，九种语言里已删。
- 旧主机已写进时间线的模式提示由 App 在 `reduceTimelineEvent` 丢弃（COMPAT(apiEndpointGateway)）。
- 用量页截图用 `createUsageFixtureRoots` 的假用量数据，不含本机真实用量。
