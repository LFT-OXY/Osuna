# Pi 思考等级：Pi 自身规则与 Paseo 现状

调研日期：2026-09-29，本机 Pi 版本 `@earendil-works/pi-coding-agent` 0.87.1。

## Pi 侧（一手来源：本机安装包）

- `thinkingLevelMap` 于 Pi 0.72.0（2026-05-01）引入，替代旧的 `compat.reasoningEffortMap`（CHANGELOG 第 1776–1788 行）。
  值为字符串 = 映射到供应商的参数值；值为 `null` = 该档不支持，隐藏且循环切换时跳过。
- `max` 档是后来加的可选档，位于 `xhigh` 之上（CHANGELOG 第 946 行）。
- 判定规则 `getSupportedThinkingLevels`（`node_modules/@earendil-works/pi-ai/dist/models.js:554`）：
  - `reasoning` 为假 → 只有 `["off"]`
  - 某档映射为 `null` → 不支持
  - `xhigh` / `max` 必须映射为非 `undefined` 才支持
  - 其余档（off/minimal/low/medium/high）未出现在映射里时默认支持
- 超出范围时的收敛规则 `clampThinkingLevel`（同文件 566 行起）：从请求档位开始往更高档找第一个受支持的档；找不到再往下找（未读完整段，实施时再核）。
- `setThinkingLevel`（`dist/core/agent-session.js:1752`）会先收敛再生效，档位变化时发 `thinking_level_changed` 事件；切模型时 `_getThinkingLevelForModelSwitch` 也会收敛。
- RPC：
  - `get_available_models` 返回 `modelRuntime.getAvailableSnapshot()` 的完整模型对象，**包含 `thinkingLevelMap`**（已用 `pi --mode rpc` 实测）。
  - `get_available_thinking_levels` 只针对当前会话的当前模型，不能用于模型目录。
  - `get_state` 返回 Pi 实际生效的 `thinkingLevel`。

本机配置下 Pi 实际支持的档位（按上面规则推算）：

| 模型 | thinkingLevelMap | 支持的档位 |
|---|---|---|
| openai-codex/gpt-6-* | minimal=null，其余有值 | off, low, medium, high, xhigh, max |
| 3oxy-deepseek/* | minimal/low/medium/xhigh=null，high/max 有值 | off, high, max |
| xai/grok-4.5 | 无 | off, minimal, low, medium, high |

## Paseo 侧现状

- `packages/server/src/server/agent/providers/pi/agent.ts:1200` `mapPiModel`：`reasoning` 为真就给全部 7 档 `PI_THINKING_OPTIONS`，默认 `medium`；不读 `thinkingLevelMap`。
- `pi/rpc-types.ts:74` `PiModel` 类型没有 `thinkingLevelMap` 字段。
- `agent.ts:1716` `setThinkingOption`：`lastKnownThinkingOptionId` 记的是请求档位，不是 Pi 收敛后的档位。
- `agent.ts:1473` `getRuntimeInfo` 会刷新 `get_state`，但 `resolveThinkingOptionId` 优先用 `lastKnownThinkingOptionId`，所以 Pi 的实际档位被盖掉。
- `agent.ts:1699` `setModel`：切模型后不核对 Pi 是否收敛了档位。
- Pi 适配层不处理 `thinking_level_changed` 事件。
- `agent-manager.ts:1994` `setAgentThinkingOption`：session 返回后，用**请求值**覆盖 `runtimeInfo.thinkingOptionId`（在 drain 事件之后），所以 session 在 set 过程中发的 `thinking_option_changed` 会被覆盖。
- `agent-configuration-validator.ts:47`：创建/配置时会拒绝不在模型 `thinkingOptions` 里的档位。过滤之后，CLI/MCP 传不支持的档位会被这里拦住。
- App 端 `composer/agent-controls/utils.ts:100` `resolveEffectiveThinking`：当前档位不在新模型选项里时，**显示**回退到 `options[0]`，不代表 Pi 真实档位。

## 可复用的先例

- Oh My Pi：`providers/omp/map-omp-model.ts` 已按模型过滤档位；旧版本不报数据时回退全部 7 档；默认档 = 上报的默认值（在集合内）否则第一个。
- Claude：`providers/claude/agent.ts:2439` `reconcileThinkingOptionForModel` 切模型后档位不支持时改档并发 `thinking_option_changed`。

## 兼容性

- 仓库没有声明 Pi 最低版本；现有 COMPAT 注释里仍兼容 ≤0.83 的行为。
- Pi < 0.72 不报 `thinkingLevelMap`，与"0.72+ 的模型没配映射"在 RPC 数据上无法区分（jq 读到的都是 null/缺失）。
