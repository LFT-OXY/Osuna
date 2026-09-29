# Pi 模型思考等级按 thinkingLevelMap 过滤

**Status:** ready-for-agent

## Problem Statement

用户在 Pi 的 `models.json` 里给每个模型配置了 `thinkingLevelMap`，声明这个模型支持哪些思考等级（值为 `null` 表示不支持）。Pi 自己的 TUI 会按这份配置只显示支持的档位，但 Paseo 对所有 `reasoning: true` 的 Pi 模型一律显示全部 7 档（off/minimal/low/medium/high/xhigh/max），默认 medium。结果：

- 用户在 Paseo 里能选到模型根本不支持的档位，比如 deepseek 只支持 off/high/max，界面却给了 7 档。
- 选了不支持的档位后，Pi 会悄悄改成最近的受支持档位，界面却还显示用户选的那档。比如选 Low，实际按 High 在跑。
- 在 Paseo 里切 Pi 模型时，Pi 会把档位重置成 Pi 设置里的默认值（按模型设置优先，其次全局默认），再收敛到新模型支持的范围。即使原档位新模型也支持，界面显示的档位也可能和实际生效的不一样。

Claude、Codex、OpenCode、Oh My Pi 都已经按模型给出各自的档位，只有 Pi 没有。

## Solution

Paseo 的 Pi 适配层读取 Pi 在模型列表里返回的 `thinkingLevelMap`，按 Pi 自己的规则算出每个模型支持的档位，只在界面上显示这些档位，默认档也落在其中。

在 Paseo 里切 Pi 模型时，保留用户当前的档位：新模型支持就继续用，不支持就按 Pi 的收敛规则换成最近的受支持档位。随后把 Pi 实际生效的档位同步回界面，让界面显示的始终是模型真正使用的档位。

## User Stories

1. As a Pi 用户, I want Paseo 里每个 Pi 模型只显示 `thinkingLevelMap` 允许的思考档位, so that 我不会选到模型不支持的档位。
2. As a Pi 用户, I want 映射为 `null` 的档位在 Paseo 里被隐藏, so that Paseo 和 Pi TUI 显示的档位一致。
3. As a Pi 用户, I want 没写进映射的 off/minimal/low/medium/high 默认可用, so that 我只需在映射里声明例外，和 Pi 的约定一样。
4. As a Pi 用户, I want xhigh 和 max 只在映射里显式配了值时才出现, so that 普通模型不会露出这两档。
5. As a Pi 用户, I want 完全没配 `thinkingLevelMap` 的推理模型显示 off 到 high 五档, so that 行为和 Pi 一致。
6. As a Pi 用户, I want 不支持推理的模型不出现思考档位选择器, so that 界面不给无意义的选项（保持现状）。
7. As a Pi 用户, I want 模型支持 medium 时默认选 medium, so that 已有模型的默认行为不变。
8. As a Pi 用户, I want 模型不支持 medium 时，默认档按 Pi 的收敛规则选（先往高处找，找不到再往低处找）, so that 默认档就是 Pi 拿到 medium 时实际会用的档位，比如 deepseek 默认 high。
9. As a Pi 用户, I want 新建 agent 的表单、composer、日程表单、agent profile 编辑里看到的都是过滤后的档位, so that 所有入口一致。
10. As a Pi 用户, I want 在 Paseo 里把运行中的 agent 从一个模型切到另一个同样支持当前档位的模型时，档位保持不变, so that Pi 设置里的默认档不会悄悄覆盖我的选择。
11. As a Pi 用户, I want 切到不支持当前档位的模型时，档位按 Pi 规则收敛到最近的受支持档位, so that agent 不会带着无效档位运行。
12. As a Pi 用户, I want 切模型后界面显示的档位就是 Pi 实际生效的档位, so that 我看到的就是模型真正用的档位。
13. As a Pi 用户, I want 切模型引起的档位变化能同步到所有连接的客户端和 agent 的持久化配置, so that 重连或恢复 agent 后档位依然正确。
14. As a Pi 用户, I want 通过 CLI 或 MCP 创建 agent 时传入模型不支持的档位会被拒绝并给出明确错误, so that 不会出现请求档位和实际档位不一致（沿用现有配置校验，档位列表过滤后自动生效）。
15. As a Pi 用户, I want 在 Paseo 里直接选档位后，界面显示的档位和 Pi 实际生效的一致, so that 即使 Pi 做了收敛，界面也不会显示错。
16. As a Pi 用户, I want 恢复或导入的 Pi 会话显示会话里记录的档位, so that 这次改动不影响已有会话的恢复（保持现状）。
17. As a Paseo 维护者, I want Pi 的档位判定和 Oh My Pi 的写法保持相似, so that 两个同源 provider 的代码易于对照。

## Implementation Decisions

- **只改 Pi provider 和它的测试替身**，外加 `docs/providers.md` Pi 段落记录代码看不出的坑（Pi < 0.72 不报映射、`set_model` 会重置档位）。不改 protocol、不改 App：`thinkingOptions` / `defaultThinkingOptionId` 和 `thinking_option_changed` 都是现有字段和事件，App 已经按模型读取档位。
- **Pi 模型类型新增可选字段 `thinkingLevelMap`**：键为 Pi 档位，值为字符串或 `null`，整个字段可能缺失或为 `null`。
- **档位判定照搬 Pi 的 `getSupportedThinkingLevels`**：
  - `reasoning` 为假 → 不给档位（保持现状，不显示选择器）
  - 某档映射为 `null` → 不支持
  - `xhigh` / `max` 仅当映射值不是 `undefined` 时支持
  - 其余档默认支持
  - 显示顺序固定为 off, minimal, low, medium, high, xhigh, max
  - 映射把所有档都标成 `null`、算出空集时，按非推理模型处理，不给档位（Pi 此时收敛到 off）
- **收敛规则照搬 Pi 的 `clampThinkingLevel`**：请求档位受支持就用；否则从请求档位往更高档找第一个受支持的；再没有就往更低档找；都没有就取列表第一项。Paseo 只用它算目录里的默认档；切模型和设档位时不在 Paseo 侧预判，而是下发后回读 Pi 的实际状态。
- **默认档** = 收敛(medium)。选项里只有默认档带 `isDefault`。
- **没配映射时不做"回退全集"**。这和 Oh My Pi 不同：Oh My Pi 在旧版本不报数据时回退全集。代价是 Pi < 0.72 不报 `thinkingLevelMap`，这些老版本上 xhigh/max 会被隐藏。这个取舍是用户在 discover 阶段确认过的。
- **切模型对齐**：运行中的 Pi 会话切模型后，重新下发用户选择的档位（会话配置里的档位；从未选过则为启动默认档 medium，不用 Pi 状态回退出来的值），再读取 Pi 状态拿到实际生效的档位。更新会话内记录和配置；实际档位和切换前上报给界面的档位不同时，发出 `thinking_option_changed`。收敛后的档位会写回配置并持久化，之后切回支持原档位的模型时沿用收敛后的档位（例如 codex 选 low，切到 deepseek 变成 high，再切回 codex 仍是 high），和界面显示保持一致。做法参照 Claude 适配层在切模型时的档位对齐。
  - 切到没有受支持档位的模型（非推理模型，或映射把所有档都标成 `null`）时不重新下发、不回读，会话保留原来记录的档位（此时 runtime info 报记录值，不报 Pi 实际的 off）。非推理模型不显示档位选择器，保留记录值是为了切回推理模型时恢复用户原来的档位。这一取舍是用户在实现阶段审查后确认的。
  - 档位对齐尽力而为：模型已切成功后，重新下发或回读失败只记 warn 日志，`setModel` 仍算成功，避免 Pi 已换模型而 agent manager 仍记旧模型。用户在实现阶段审查后确认。
- **直接设档位对齐**：设置档位后读取 Pi 状态，会话内记录的是 Pi 实际生效的档位，不是请求值，`getRuntimeInfo` 返回实际档位。下发失败照常抛错；只有回读失败时记 warn 日志并记录请求值（与改动前一致）。因为 agent manager 在 `setThinkingOption` 返回后会用请求值覆盖 runtimeInfo，这一步只让会话自身状态正确。界面因档位列表已过滤，正常路径下请求值等于实际值，不改 agent manager。
- **不处理 Pi 的 `thinking_level_changed` 事件**：Pi 扩展、斜杠命令等 Paseo 之外途径的改档不在本次范围。
- 不改 Pi 会话启动参数的默认档逻辑：启动时仍传用户选择的档位，没选时传 medium，由 Pi 在启动时自行收敛。

## Testing Decisions

- 好的测试只看外部行为：模型目录里每个模型给出的档位和默认档；会话公开接口（切模型、设档位、取 runtime info、订阅事件）的可观察结果。不断言内部字段或私有函数。
- 测试切入点只有一个：Pi provider 的现有测试文件，通过 `FakePi` 驱动 Pi 客户端的模型目录和 Pi 会话。不新建测试文件，不新增 npm 脚本或 CI 任务。
- `FakePi` 需要一处小扩展：设档位（含切模型后的重新下发）时，能按测试脚本改写会话状态里的生效档位，用来模拟 Pi 的收敛。
- 需要覆盖的行为：
  - 目录：带映射的模型（含 `null` 档和显式 xhigh/max）、没配映射的推理模型（字段为 `null` 和字段缺失两种）、非推理模型、不支持 medium 的模型的默认档（往高收敛和往低收敛两种）、档位全为 `null` 的模型
  - 切模型：新模型支持当前档位时档位不变、不发事件；不支持时收敛并发出 `thinking_option_changed`，runtime info 返回收敛后的档位
  - 经过非推理模型、或所有档都为 `null` 的模型，再切回推理模型：恢复原档位，不发事件
  - 会话以非推理模型启动、未选过档位，切到推理模型：下发 medium 并通知界面
  - 失败路径：切模型后重新下发失败时切模型仍成功；设档位后回读失败时记录请求值
  - 设档位：Pi 收敛后 runtime info 返回实际档位
- 可参照的现有测试：同文件里 "updates model and thinking through Pi runtime commands" 和 "discovers models from a short-lived Pi session in the requested cwd"；Oh My Pi 的 `map-omp-model` 测试；Claude 适配层切模型对齐档位的测试。
- 只跑改动的测试文件，外加 typecheck 和 lint。

## Out of Scope

- 监听 Pi 的 `thinking_level_changed`，同步 Paseo 之外途径的改档。
- 让 Paseo 的默认档跟随 Pi 设置里的 `defaultThinkingLevel` 或按模型的默认档。
- 修改 agent manager 在设档位后用请求值覆盖 runtimeInfo 的通用逻辑。
- Oh My Pi 及其他 provider 的档位逻辑。
- App 端档位显示的回退逻辑（当前档位不在列表里时显示第一项）。
- 兼容 Pi < 0.72 的推断逻辑，以及为此加的 COMPAT 分支。

## Further Notes

- 调研细节、Pi 源码出处、本机配置推算结果见 `research/pi-thinking-levels.md`。
- 验收可用本机配置人工核对：openai-codex/gpt-6-* 应为 off/low/medium/high/xhigh/max，3oxy-deepseek/* 应为 off/high/max 且默认 high，xai/grok-4.5 应为 off/minimal/low/medium/high。

## Acceptance Criteria

- [x] Pi 模型目录中，推理模型的档位列表等于按 Pi 规则由 `thinkingLevelMap` 算出的集合，顺序固定
- [x] 没配 `thinkingLevelMap` 的推理模型只给 off/minimal/low/medium/high
- [x] 非推理模型、以及映射后没有任何受支持档位的模型，不给档位
- [x] 默认档为收敛(medium)，且是列表中唯一 `isDefault` 的项
- [x] 运行中的 Pi 会话切到支持当前档位的模型后，档位保持不变，不发 `thinking_option_changed`
- [x] 切到不支持当前档位的模型后，档位变为 Pi 实际生效的收敛档位，发出 `thinking_option_changed`，runtime info 返回该档位
- [x] 设档位后 Pi 会话的 runtime info 返回 Pi 实际生效的档位
- [x] 切到非推理模型或没有受支持档位的模型时不重新下发档位；再切回推理模型时恢复原档位
- [x] 以非推理模型启动的会话切到推理模型时，下发用户选择的档位或 medium，而不是 off
- [x] 切模型后档位对齐失败不影响切模型成功；设档位后回读失败时记录请求值
- [x] 以上行为在 Pi provider 现有测试文件中有测试覆盖并通过
- [x] 不改 protocol 和 App 代码
- [x] typecheck 与 lint 通过
