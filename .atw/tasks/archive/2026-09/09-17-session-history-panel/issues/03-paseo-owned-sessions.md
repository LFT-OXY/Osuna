# 03 — Paseo 曾拥有的会话：协议扩展与跳转

**What to build:** 曾被 Paseo 导入或由 Paseo 启动的会话也出现在列表里，行上带"Paseo"标记；点击这类行不再起终端，而是走与左栏 History 相同的打开逻辑，导航到那个 agent 并固定 tab。连到旧版 daemon 时面板显示"更新 host"提示而不是报错。

**Impl:** done
**Status:** ready-for-agent

**Blocked by:** 01

- [x] 协议：`fetch_recent_provider_sessions_request` 加可选 `includeImported`；descriptor 加可选 `importedAgentId` 与 `importedAgentWorkspaceId`（审查发现：History 的打开逻辑需要 workspaceId，否则已归档 agent 退到 host 详情路由丢 pin）；`server_info.features` 加 `sessionHistory` 能力位。全部可选，wire schema 保持纯净，旧 payload 仍可解析
- [x] daemon：`includeImported` 为 true 时不剔除已导入会话并填写对应 agent id 与 workspace id（活 agent 优先于同 handle 的归档记录）；为 false 或缺省时行为与现在完全一致
- [x] 客户端请求带 `includeImported: true`；有 `importedAgentId` 的行显示"Paseo"标记
- [x] 点击带标记的行调用与 History 相同的 agent 打开逻辑（导航并固定 tab），不创建终端
- [x] 能力位为假时视图显示"更新 host"态，不发请求，无回退路径；回退相关代码点打 `COMPAT` 标记
- [x] 测试：daemon 列表函数（两种 includeImported 取值）、协议 schema 新字段与旧 payload 兼容、组件测试的标记与跳转分支、能力位缺失态
- [x] `npm run typecheck`、`npm run lint` 通过；改了 protocol 后先 `npm run build:client`
- [ ] 备注：已归档 agent 的 tab 能否真正出现取决于前置任务 `09-17-history-open-archived-agent`，本票只保证调用了同一条逻辑
