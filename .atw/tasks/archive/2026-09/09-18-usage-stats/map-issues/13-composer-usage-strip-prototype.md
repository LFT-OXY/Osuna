# 13 — Composer 工具条本会话用量条原型

**Type:** prototype
**Blocked by:** None
**Status:** resolved

## Question

用 `atw-prototype` 在现有 `context-window-meter` 旁做一个可丢弃原型，确定：紧凑态显示哪几个数（↑输入 ↓输出 $成本 ⏱耗时）与格式（K/M 缩写、成本小数位）、移动端窄屏的折叠规则、hover/长按展开的按模型明细与墙钟时长、数据未回填时的占位。产出：原型路径 + 认可的形态描述。

## Answer

用户 2026-09-18 确认，原型 `prototype/composer-usage-strip.html`（第二版，`?variant=A` 为定稿；浮动条可切宽度 / 主题 / 状态 / 钉住弹层）。**本票修订访谈 Q10**：会话内用量不再做「Composer 工具条用量条」，改为两处——每轮用量在 turn footer，会话合计在上下文环形表的弹层。

### 1. turn footer：每轮 token 与估算成本（变体 A，文字常显）

- 位置：`AssistantTurnFooter`（`packages/app/src/components/message.tsx`）现有 "Worked for 6m 12s" 之后，同一行、同色（`foregroundMuted`）、同字号（`STREAM_METADATA_FONT_SIZE` 13px），以 " · " 分隔：`Worked for 6m 12s · ↑14.3K ↓4.6K · $0.17`。↑ = 非缓存输入，↓ = 输出（含推理）。
- hover（手机点按）弹层「本轮用量」：按模型表（模型 / 输入 / 缓存 = 缓存读 + 缓存写 / 输出（推理另注）/ 估算成本），多模型时加合计行；下方「耗时」与 "估算成本 · 按公开 API 价格计算"。hover 时该段落背景走 `interactionHighlight`，与 footer 现有 hover 换时间戳的行为并存（时间戳换的是 "Worked for" 段，本段不换）。
- 手机（紧凑布局）：footer 允许换行，用量段整体落到第二行；不缩减内容。
- 运行中的一轮：footer 仍是现有 loader + 秒表，不显示 token；轮结束后等 `usage.updated` 到达再补。
- 占位：轮已完成但日志行未到 → 骨架条（64×12）；无价格模型 → `$0.00` 点下划线 + 弹层琥珀 pill "无价格数据"；旧 daemon（`features.usage=false`）→ 只显示现有 "Worked for"，不加段落。
- 格式：token 用 K/M/B 一位小数（与 12 号票「用量」页一致；现有 `formatTokenCount` 是 `12k` 无小数，需新增或改造，环形表弹层的 `84k / 200k` 一并切换，否则同一屏两种缩写）。成本沿用 `formatSessionCost`（<$0.01 四位小数，否则两位）。耗时沿用 `formatDuration`。**假设**：token 格式未单独提问，按与「用量」页一致处理。

### 2. composer 环形表：上下文占用「环 + 84K / 200K」

- 位置不变（右侧控件区 28px 槽），环右侧加文字 `84K / 200K`（已用 / 模型上下文上限），12px `foregroundMuted`，hover 变 `foreground`；数字用 tabular-nums。手机上只留环（现有行为）。
- 弹层三段：上下文窗口（已用 %、`84K / 200K tokens · <模型>`）→ **本会话合计**（Token ↑↓、估算成本、轮次、Agent 运行、会话跨度）→ Plan usage（现有 `ProviderUsageTooltipSection` 原样）。旧 daemon 时「本会话合计」段显示灰 pill "需要更新主机"。
- 「本会话合计」的数据仍走 08 号票的 `usage.agent.get`，求和规则仍按 10 号票；运行中一轮的秒表叠加规则不变。**修订** 08/10 号票中 "Composer 用量条" 的措辞为 "环形表弹层的本会话合计"。

### 3. 每轮数据源：日志解析时另存每轮行（修订 07）

现状：`turn_completed.usage` 只有 Claude（SDK result，按轮）与 ACP 带、Codex 带的是上下文口径、OpenCode 为空，且 timeline 不持久化；07 的 15 分钟桶没有每轮归属。决定：daemon 解析四家日志时，在桶行之外**另落每轮行**（键含 `(cli, sessionId, turnKey, model)`），新增 `usage.agent.turns.list` RPC 供 footer 取数；四家一致、历史轮也有。否决：按需重解析会话文件（57MB 大文件打开慢）；只用实时事件（历史轮与 Codex/OpenCode 无数据，且与「用量」页口径不一致）。每轮行 schema、四家 turnKey、与客户端 timeline 轮次的对齐方式、RPC 形状归 15 号票。

### 否决的替代方案

第一版「Composer 工具条用量条」（环形表右侧 ↑↓$⏱ 常显）——用户否决：token 与耗时是每轮信息，归 turn footer；footer 变体 B（只显成本）与 C（细 pill）——用户选 A。

## Comments

- 2026-09-18：原型已建，`prototype/composer-usage-strip.html`（静态 HTML，双击打开；假数据按 08 号票 `usage.agent.get` 响应形状）。骨架照现有 composer 右侧控件区 `[环形表 28px 槽][语音][发送]`，用量条紧贴环形表右侧，样式取 `toolbar-label-trigger`（12px 灰字、hover 走 `interactionHighlight`）；弹层沿用 `context-window-meter` 现有 tooltip 三段：上下文 → 本会话用量（按模型表 + 轮次 / Agent 运行 / 会话跨度）→ Plan usage。`?variant=A|B|C`：A 全量四数（↑ ↓ $ ⏱）/ B 成本+耗时 / C token+成本。浮动条切 桌面·手机 390 / 亮·暗 / 数据状态（已结算·运行中·回填中·新会话·无价格·旧主机）/ token 格式（12.3K 一位小数 vs 现有 12k）/ 成本小数位（2 vs 3）/ 钉住弹层。等用户反馈后写 Answer。
- 2026-09-18（用户反馈 1）：**位置放反了**。每轮 token 与估算成本应跟在 turn footer 的 "Worked for Xm Ys" 之后；composer 环形表位置只管上下文占用，并要把「模型上下文上限」与「已用量」以文字显示出来。原型已重写为第二版（同一文件）：footer 段三变体 A 文字常显 "· ↑14.3K ↓4.6K · $0.17" / B 只显 "$0.17"、hover 展开 token / C 两枚 18px 细 pill；composer 三变体 "◔ 84K / 200K" / "◔ 42% · 84K/200K" / "◔ 84K of 200K"；两处各有 hover 弹层（本轮按模型明细 + 耗时；上下文 + 可选「本会话合计」+ Plan usage）。状态：已结算 / 运行中 / 待结算（轮已完成、日志行未到 → 骨架）/ 无价格 / 旧主机。此反馈修订访谈 Q10（"Composer 工具条扩成 ↑↓$⏱"）与 08/10 号票中 `usage.agent.get` 的用途，待 Answer 时一并写回。
- 2026-09-18（数据源事实，供决定）：每轮 token 目前**没有**现成来源——`turn_completed.usage` 只有 Claude（SDK result，按轮）与 ACP 带、Codex 带的是上下文口径、OpenCode 为空，且 timeline 不持久化它；07 号票的存储是 15 分钟桶，无每轮归属。footer 每轮用量需新增数据路径（候选：每轮行落盘 / daemon 按需重解析会话文件 / 只用实时流事件不管历史）。

- 2026-09-18，由 15 号票定稿：每轮数据路径为每轮行 + `usage.agent.turns.list`，客户端按 `turnId` → 首条 user_message `messageId ∈ userMessageIds` 两级匹配，匹配不上不显示用量段。见 `map-issues/15-turn-usage-rows-and-rpc.md` 第 3、4 节。
