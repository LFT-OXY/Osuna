# 07 — Mention defaults 生效：daemon 配置与逐项回退

**What to build:**
- daemon 配置新增 `providers.<id>.mentionDefaults: { model?, thinkingOptionId?, modeId? }`，经 `get/set_daemon_config` 读写，热重载，删除 provider 时一并清掉。
- Routing block 按"Mention defaults → 运行时默认"逐字段解析；失效值逐项回退（模型不在目录 → 默认模型及其默认档位；档位不属于所选模型 → 该模型默认档位；模式不存在 → `defaultModeId`），不阻断发送；快照未就绪时等待（受刷新超时约束），出错时配置值原样透传。模式不继承父会话，daemon 总是写出明确的 `modeId`。
- 选择函数与元数据生成共用。

05 号票留下的缺口：provider 快照没有 `defaultModeId` 时，Routing block 的 `settings` 里不写 `modeId`，`create_agent` 会经 `ProviderSnapshotManager.resolveCreateConfig` 把父会话交给 provider 的 `resolveCreateConfig`，可能回落到父会话的模式，违背"模式不继承父会话"。本票要让 daemon 总是写出明确的 `modeId`。

**Blocked by:** 05
**Status:** ready-for-agent
**Impl:** ready

- [ ] daemon 测试：设了模型、档位、模式时 Routing block 用配置值；未设的项用运行时默认。
- [ ] daemon 测试：三种失效值各自回退；快照出错时原样透传。
- [ ] daemon 测试：`mentionDefaults` 经 `set_daemon_config` 写入后读回一致、不重启即生效；删除 provider 后配置消失。
- [ ] `npm run typecheck`、`npm run lint` 通过。
