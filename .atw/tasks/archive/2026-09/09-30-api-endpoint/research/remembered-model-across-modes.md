# 切换接口后「记住的模型」怎么处理：参考项目对比

问题：第三方模式下模型选择器只列接口勾选的模型，但 App 记住的上次模型（如官方的 `claude-opus-5-5`）不在列表里时，`resolve-agent-form.ts` 的 `resolveModelField` 会原样保留并发给 CLI（`resolve-agent-form.test.ts:794` 把这当作有意行为）。切回官方时反过来，记住的 `relay/*` 会发给官方 CLI。

源码均在 `/Users/oxy/Documents/Configuration/dev-environment/demo/源码/`，以下行号由只读调研代理核对。

| 项目 | 模型怎么生效 | 记住的模型按什么维度 | 不在当前列表时 | 切回原配置 | 启动时校验 |
|---|---|---|---|---|---|
| cc-switch | 只写 CLI 配置，不传 `--model` | 不记 | 切换时作为负责的键清掉 | 按目标行重写，官方行 `env: {}` | 无 |
| desktop-cc-gui | 写配置 + 每次传 `--model` | 按 CLI，全局一份 | 目录标为 authoritative 时静默回退第一项并写回存储 | 整份还原备份 | 无 |
| openchamber | 每次发送带 provider+model | 按目录/会话/agent | 自动选中的回退默认；手动选的保留 | 按会话记忆恢复 | 只查非空 |
| orca | 每次传 `--model` | 按 agent 全局 | 仅 authoritative 的 agent（Grok）丢弃；Claude/Codex 原样放行 | 无 | 仅 Grok |
| t3code | 每次会话传模型 | 按 provider 实例 | 显示/发送时解析：Claude/Codex 回退默认，记忆本身不改 | 能恢复，因为记忆按实例存 | 仅前端解析 |
| codeg | 写配置 + 连接时传偏好 | 按 agent 类型 | 后端拿 agent 当场给的列表比对，不在就不下发，交给 CLI 默认；记忆不删 | 模型键不恢复 | 后端比对 |

证据：
- cc-switch：`src-tauri/src/live/floor.rs:30,61-69,116`，`live/project/claude.rs:89`，`services/provider/claude_direct.rs:5`，`src/config/claudeProviderPresets.ts:80-81`。
- desktop-cc-gui：`src/features/chat/components/use-engine-models.ts:229-238`（回退并写回），`src-tauri/src/engine/models/mod.rs:296-304,337-346`（authoritative），`src-tauri/src/engine/mod.rs:1038-1041`（无校验）。
- openchamber：`packages/ui/src/stores/useConfigStore.ts:274-307`，`components/chat/ModelControls.tsx:715-741,1049-1110`。
- orca：`src/shared/native-chat-session-option-defaults.ts:106-119`，`src/shared/agent-session-option-catalog-grok.ts:82`，`src/shared/agent-session-option-catalog-claude-codex.ts:213-214`。
- t3code：`apps/web/src/modelSelection.ts:289-325`，`packages/shared/src/model.ts:323`，`apps/web/src/composerDraftStore.ts:488-489,1219-1247,2921-2982`。
- codeg：`src-tauri/src/acp/connection.rs:8195-8216,8547-8557`，`src/lib/selector-prefs-storage.ts:7-10,144-182`。

## 共同点

- 没有一家报错或提示，都是静默处理。
- 回退的前提是「这份列表可信」：desktop-cc-gui 和 orca 用 authoritative 标记，t3code 对 Claude/Codex 默认可信。列表不可信时（orca 的 Claude/Codex、openchamber 手动选的模型）原样放行，这和 Osuna 现在官方模式的做法一样。
- 能在切回时恢复的只有 t3code 和 codeg：解析只影响这次发送，不改写记忆。t3code 按实例记忆，所以两个方向都不串。
- 服务端兜底只有 codeg 一家：拿当前可用列表比对，不在就不下发。
