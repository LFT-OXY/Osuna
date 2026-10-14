# 01 — 主机级接口数据模型、旧数据迁移与老 App 投影

**What to build:** 第三方接口改为整台主机共用（名称、自动生成且不显示的标识、一把 key、最多三个格式地址、已选模型、Claude 档位映射、接口开关），每个 Agent 只存「使用第三方接口」总开关与一个光秃秃的默认模型名。旧格式文件读时换算、写时升级。通讯协议原地扩展并加能力标记 `apiEndpointGateway`，新增「设置总开关与默认模型」「接口开关 + 立刻恢复」两条消息；没有能力标记的客户端（含官方 Paseo 手机 App）得到单接口投影，照旧能看、能切、能存。本票里打开总开关仍按现有方式直接改写 CLI 配置（指向第一个地址、写真实 key），03 票再改为指向中转站。对应 prd R-A1～R-A6（R-A5 的自动检测消息归 08、拉模型 / 测试连接改形归 09）。

**Blocked by:** None — can start immediately
**Status:** ready-for-agent
**Impl:** done

- [x] 用旧格式 `endpoints.json`（两个 Agent 各若干接口、各有一家「当前启用」）启动 daemon：列表返回主机级接口，原启用的两家开着、两个 Agent 总开关打开、默认模型等于旧默认模型，其余已关闭；地址落在对应格式栏（claude → Anthropic，codex → OpenAI Responses）；首次写入后文件变为新格式、旧字段消失；损坏的文件不被改写也不被删除，日志有报错。（e2e）
- [x] 总开关只在至少一家接口「开着且已选至少一个模型」时允许打开（接口全关、唯一开着的一家一个模型都没勾，两种拒绝各一例）；打开且未选默认模型时自动得到最早建的开着接口的第一个已选模型。（e2e）
- [x] 默认模型失踪统一规则：删除接口、关接口开关、关模型小开关后，默认模型改成最早开着接口的第一个已选模型；一个能用的模型都不剩时该 Agent 总开关自动关、CLI 配置还原。（e2e）
- [x] 不带 `features.apiEndpointGateway` 的客户端：`list` 得到单接口投影、模型列表只有去重后的光秃秃模型名、`isModelListAuthoritative` 随总开关；`set_active(id)` 打开总开关、开这一家、不关别的；`set_active(null)` 关总开关；老 `save` 的 `baseUrl` 按 provider 落进对应格式栏；`delete` 按失踪规则级联。（e2e）
- [x] `packages/protocol` 的接口消息测试与 wire-compat 测试通过：新字段全部可选，旧消息样本仍能解析；新消息命名符合 `docs/rpc-namespacing.md`。
- [x] 现有 App 界面在本票之后行为不变（它还没有新能力标记，走投影）：现有 `api-endpoint-*` 四个 e2e 与 App 接口组件测试全部通过。
- [x] 每家接口有自动生成、锁定、不出现在任何响应可见字段里的标识；每家 key 单独存放、权限 0600。
