# 07 真实 Agent 验收记录

环境：dev 桌面端（`.dev/paseo-home`，端口 6769），工作区 `~/Downloads`，2026-10-19。

## Claude Code

- 第一次失败：Agent 回复"read_logic_map / update_logic_map 不存在"。原因是 dev 数据里"启用 Osuna 工具"（`daemon.mcp.injectIntoAgents`）从没存过，daemon 默认按关处理（`packages/server/src/server/config.ts` 的 `?? false`），Agent 拿不到任何 Osuna 工具。Agent 没有手改 `map.json`，留下空图 `untitled-3233be2c`。
- 用户在设置里开启 Osuna 工具、新开对话后成功：`~/Downloads/docs/logic-maps/untitled-4d91e689/`，标题"用户登录（含密码错误与账户锁定）"，40 节点 / 44 连线，顶层 20 个，子图"密码错误处理"9 个、"账户解锁"11 个；9 个失败步骤标 `failure`；spec 框架判为 none，40 个节点都有完整自有文档；回复列出了增、改、删的节点。
- 用户在界面上确认正常：图自动刷新、进入子图与面包屑、点节点开文档并蓝框。
- 结论：通过（前提是开启 Osuna 工具，见问题 1）。

## Codex

- 2026-10-20：`~/Downloads/docs/logic-maps/untitled-7398bbdf/`，标题"找回密码：验证码过期与连续输错"，43 节点 / 54 连线，顶层 7 个，子图 send 12、verify 14、reset 10；14 个失败步骤标 `failure`；spec 框架判为 none。用户在界面上确认图出现、更新、点节点正常。
- 问题：只有 3 个子图节点写了自有文档，其余 40 个节点 `doc` 为空，违反"没有 spec 框架时每个节点写完整节点文档"。10:31 复查仍是 3 份，算 provider 未按说明块行事（见问题 3）。

## Pi

- 2026-10-20：`~/Downloads/docs/logic-maps/untitled-57ee2dc9/`，标题"邮箱注册流程（含邮箱占用与验证码过期）"，20 节点 / 30 连线，全在顶层（正好 20 个，没用子图）；7 个失败步骤标 `failure`；spec 框架判为 none。用户确认界面正常。
- 问题：只有 7 个节点有自有文档，13 个节点 `doc` 为空，同问题 3。

## 发现的问题（另开工单）

1. Osuna 工具关着时，逻辑图开关照样能开、说明块照样发，用户要等 Agent 自己报"没有工具"才知道。应像 @ 提及 Agent 那样，在开关旁提示"需要先在设置 → 主机 → Agent 中启用 Osuna 工具"，或不发说明块。
2. 已核实，不是问题：`config.ts` 对没存过的 `injectIntoAgents` 解析成 `false`，`createInitialMutableDaemonConfig` 的 `?? true` 因此不生效，设置页读到的也是 `false`，两边一致。默认关是上游（getpaseo/paseo）的既有行为，不改。
3. Codex、Pi 都没给每个节点写文档（Codex 43 个里 3 个有，Pi 20 个里 7 个有），Claude Code 40 个全有。说明块里"没有 spec 框架时每个节点写完整节点文档"对这两个 provider 约束不够。可能的改法：说明块把"每个节点都要有文档"写得更硬；或 `update_logic_map` 在没有 spec 框架时对缺文档的节点返回提醒。
