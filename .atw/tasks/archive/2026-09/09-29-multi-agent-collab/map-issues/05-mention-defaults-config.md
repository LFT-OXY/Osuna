# 05 — 提及智能体默认值：daemon 配置形状、跨 provider 模式回退、profile 的处理

**Type:** interview
**Blocked by:** None
**Status:** resolved

## Question

设置 → Host → Agents 页每个已启用 provider 独立配置被提及时用的模型、思考档位（以及是否含模式），未配置项用 provider 运行时默认、由 daemon 解析。要定：(1) 配置存在 daemon 哪里、形状（按 provider 键；读写走 `set_daemon_config` 还是新 RPC）；(2) 配置项是否包含模式；若含或不含，跨 provider 的 mention 在"未配置"时模式回退到什么——现有 `create-agent-mode.ts:43-80` 规则是同 provider 继承父模式、跨 provider 非无人值守直接报错；(3) 已配置的模型被 provider 下线或思考档位不再支持时怎么办（静默回退运行时默认、还是报错提示）；(4) 自定义 profile 用自身配置，是否也允许在这张卡里覆盖；(5) daemon 写进路由提示的确定值取自哪里（provider 快照的 `isDefault` 模型、provider 默认档位）。

## Answer

2026-09-30 访谈定稿。参考项目对照见 `research/reference-projects.md`「补充：子智能体默认值的存储、回退与叠加」。

1. **存储与读写**：daemon 配置 `providers.<id>.mentionDefaults: { model?, thinkingOptionId?, modeId? }`（持久化在 `agents.providers.<id>.mentionDefaults`），三项都可选，缺省即"默认"。读写沿用 `get/set_daemon_config`，不加新 RPC；新字段可选，热重载；删除 provider 时随 `removeProviders` 一起清掉。app 端卡片与 `@` 智能体分组用同一个能力开关。
2. **含模式**：卡片三项：模型、思考档位、模式。默认值只作用于 mention 新拉起的子智能体，创建后用户仍可在子智能体标签里改。
3. **模式回退**：未配置时一律用目标 provider 快照的 `defaultModeId`，不继承父会话模式，不桥接无人值守模式（同 codeg）。daemon 总是写出明确 `modeId`，`create-agent-mode.ts` 的跨 provider 报错路径不会触发。
4. **失效值**：发送时逐项回退，不阻断发送——模型不在快照目录里 → 默认模型及其默认档位；档位不属于所选模型 → 该模型默认档位（模型为"默认"时按当时的默认模型校验）；模式不存在 → `defaultModeId`。快照未就绪或出错时配置值原样透传。卡片把失效项标成"不可用，将使用默认"。
5. **Agent profile**：PRD 中"自定义 profile"指 **Agent profile**（UI "Agent 配置"，`daemon.agentProfiles`），它进 `@` 列表，排在 provider 之后；provider 别名（`custom-providers.md` 的 profile）本身就是 provider。@ Agent profile 时逐字段叠加：profile 写了的字段 → 该 provider 的 mention defaults → 运行时默认；`featureValues` 原样放进 `settings.features`。卡片不列 Agent profile，也不覆盖它。
6. **feature**：v1 不进卡片，需要时用 Agent profile 的 `featureValues`。
7. **确定值来源**：模型取快照 `isDefault ?? models[0]`，档位取 `model.defaultThinkingOptionId`，模式取 `defaultModeId`，与 `metadataGeneration` 共用选择函数（`structured-generation-providers.ts:256-274`）。某项取不到就不写进路由提示（`provider` 只写 id，`settings` 省略该键）。解析时等快照就绪，受现有刷新超时约束。
8. **术语**：`docs/glossary.md` 新增 **Mention defaults**（zh-CN "提及智能体默认值"，禁用 "Delegation defaults"）；**Agent mention** 词条里的裸 "profile" 改为 **Agent profile**。
