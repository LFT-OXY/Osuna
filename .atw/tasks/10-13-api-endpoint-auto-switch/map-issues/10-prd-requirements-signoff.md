# 10 — 需求文档收口：需求条目、验收标准与用户确认

Type: interview
Status: resolved
Blocked by: 08

## Question

`prd.md` 的 Requirements 与 Acceptance Criteria 仍是 TBD。把 01–08 票已定的约束整理成可逐条验收的需求与验收标准（含 zh-CN 文案与 i18n 守卫、桌面端两种外壳与深浅主题的取证、老 App 投影照常可用、迁移不丢用户手写配置），用大白话逐条和用户过一遍，直到用户确认 `prd.md` 可以拿去切实现工单。

补充（09 票关闭后）：验收标准须把 `map-issues/09-adr-and-doc-rewrites.md` Answer 里的 13 项文档改写逐条纳入（ADR 0007 落盘、ADR 0004 标 superseded in part、词条、数据模型表、i18n 守卫表、`THIRD_PARTY_NOTICES`），ADR 内容以 `adr-draft.md` 为准。

## Answer

访谈三轮（2026-10-14），用户确认 `prd.md` 可以切实现工单。逐轮问答见 `research/decisions.md`「10 票」节。

- `prd.md` 的 Requirements 整理为六组 32 条（A 数据与迁移、B 中转站、C 协议转换、D 会话与提示、E 界面、F 文档与决策记录），Acceptance Criteria 32 条按同样分组加「收尾」，每条注明证据形式；09 票的 13 项文档改写全部纳入验收。
- 新定的规则（均已写进 `prd.md`，界面相关的同步进 `ui-direction.md`）：
  - 总开关前提改为「至少一家接口开着**且已选至少一个模型**」（修订 04 票 Answer 的「至少一家开着」）。
  - 默认模型失踪统一规则：删除接口、关接口开关、关模型小开关三种操作同样处理，改成最早开着接口的第一个已选模型，一个不剩则总开关自动关回官方（扩展 04 票只覆盖「删除」的条目）；只在导致某 Agent 回官方时弹确认。
  - 重新拉取保留已勾选、上游没了的加弱色小字、手动添加同样保留。
  - 自动检测 / 测试连接区分「key 无效」（401 / 403）与「未检测到」，测试连接按地址分别显示。
  - 换家、进入 / 退出冷却写 daemon 日志一行，界面不显示。
  - 「使用中」「已暂停」不进 `zhCNRetiredTermPattern`（「不使用中继」「计划已暂停」是别处合法用法），只删旧键。
  - Claude Code 后台小任务不分流便宜模型，进「不做」。
- 组织方式：一个任务切工单，不拆子任务（各部分不能独立上线）。真实 CLI 验收由用户用自己的接口做；其余全自动化；收尾沿用 CI 全绿 + merge commit 并入 main；原生端免验。
- 下一步：用户运行 `/atw-tickets` 切工单；`check.jsonl` 在切票时按 `prd.md` 与 `research/` 配置。
