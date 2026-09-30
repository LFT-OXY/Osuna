# 视觉基准：价格表与每轮用量悬浮面板（DOM 量测）

取自 2026-09-30 的 dev Web（Expo 8081，daemon 6768，`.dev/paseo-home`），分支 `enhance-pricing-hover-panel`，headless Chromium，`locale: zh-CN`，亮/暗色用 `prefers-color-scheme` 切换（主题设置为"跟随系统"）。数值都是 `getComputedStyle` / `getBoundingClientRect` 的原始读数，rect 写作 `[x, y, w, h]`（CSS px）。原始 JSON 在 `research/tools/raw/`，脚本在 `research/tools/`。

截图（`research/screens/`）：

| 文件 | 内容 |
| --- | --- |
| `price-table-desktop-1280-light.png` / `-dark.png` | 1280×900，设置 → 主机 → 价格表，5 条"无价格数据"行 + LiteLLM 行，顶部开关与「立即刷新」 |
| `price-table-compact-390-light.png` | 390×844 紧凑布局，表格横向滚动 |
| `turn-usage-panel-reasoning-1280-light.png` / `-dark.png` | claude-opus-5-5 一轮，输出带「（240 推理）」，悬停打开；`-full.png` 为整屏 |
| `turn-usage-panel-plain-1280-light.png` / `-dark.png` | gpt-6-astra 一轮，无推理 token；`-full.png` 为整屏 |
| `turn-usage-panel-tap-390-light.png` | 390 宽触屏上下文（isMobile + hasTouch，DPR 3），点按用量段弹出 |

## 价格表（`host-page-price-table-card`）

几何在亮暗两套下完全一致，只有颜色不同。设置阅读列宽 688（卡片 x=456..1144）。

| 元素（取自） | 几何 / 排版 | 亮色 | 暗色 |
| --- | --- | --- | --- |
| 页面底色（`body` 及设置内容容器） | — | `rgb(252,252,252)` | `rgb(10,10,10)` |
| 侧栏底色（x=100 处首个不透明祖先） | 宽 320 | `rgb(250,250,250)` | `rgb(0,0,0)` |
| 分区标题「价格表」（section 内首个文字叶节点） | 13px / 500 / lh 18px | `rgb(113,113,123)` | `rgb(129,129,129)` |
| 「自动更新」标签 | 12px / 400 | `rgb(113,113,123)` | `rgb(129,129,129)` |
| 开关（`price-table-auto-update-switch`） | 命中区 32×32；轨道 32×18、圆角 9；滑块 14×14、圆角 7、阴影 `rgba(0,0,0,.25) 0 1px 2px` | 轨道开 `rgb(27,78,216)`，滑块 `#fff` | 轨道开 `rgb(52,107,241)`，滑块 `#fff` |
| 「立即刷新」按钮（`price-table-refresh`，ghost sm） | 103.6×28，圆角 8，padding 0 12，gap 8，1px 透明边框，背景透明 | 文字 14px/400 `rgb(113,113,123)`，图标 14×14 stroke `#71717b` | 文字 `rgb(129,129,129)`，stroke `#818181` |
| 卡片（`settingsStyles.card`，副标题的父节点） | 688 宽，圆角 14，1px 边框，无阴影，padding 0，`overflow: hidden` | 背景 `#fff`，边框 `rgb(228,228,231)` | 背景 `rgb(17,17,17)`，边框 `rgb(25,25,25)` |
| 副标题「每百万 token 美元 · LiteLLM 快照…」 | 12px/400，padding-top 12，padding-left 16，高 27 | `rgb(113,113,123)` | `rgb(129,129,129)` |
| 控件错误占位（`price-table-control-error`） | 12px，lh 16.8，min-height 33.6（空时也占位） | 文字色 `rgb(157,67,59)` | `rgb(216,132,123)` |
| 表头行（「模型」的父节点） | 654×31，padding 8 0，列 gap 6，表格左右 padding 12 | 无底色 | 无底色 |
| 表头单元格 | 12px/400；列宽 模型 154 / 价格 ×4 各 70（右对齐）/ 来源 64（padding-left 6）/ 操作 120 | `rgb(113,113,123)` | `rgb(129,129,129)` |
| 数据行块 `price-table-row-*` | padding 8 0，gap 4，顶边 1px；无价格行高 79.8，已定价行高 65.8（都含 16.8 的行内错误占位） | 顶边 `rgba(228,228,231,.5)` | `rgba(25,25,25,.5)` |
| 行内 flex（rowBlock 第一个子节点） | 无价格行高 42（模型名 + 徽标两行），已定价行高 28（由按钮撑高），`align-items: center` | — | — |
| 模型名 | 12px/400，列宽 154，超长单行省略 | `rgb(39,39,42)` | `rgb(245,245,245)` |
| 「无价格数据 · 估算 $0」徽标（StatusBadge warning，文字的父节点） | 130.2×23，圆角 9999，padding 3 8，1px 边框；文字 12px/400；位于模型名下方第二行（模型列 gap 4） | 背景 `rgb(228,228,231)`，边框 `rgb(228,228,231)`，文字 `rgb(123,93,57)` | 背景 `rgb(38,38,38)`，边框 `rgb(25,25,25)`，文字 `rgb(192,150,100)` |
| 价格输入框外框（`<input>` 的祖父节点） | 70×28，圆角 8，1px 边框，padding 3 12 | 背景 `rgb(244,244,245)`，边框 `rgb(212,212,216)` | 背景 `rgb(23,23,23)`，边框 `rgb(30,30,30)` |
| 价格输入框 `<input>`（`price-table-input-*`） | 44×20，14px/400，lh 20，outline none，无 placeholder | 文字 `rgb(39,39,42)` | `rgb(245,245,245)` |
| 「保存」按钮（`price-table-save-*`，default sm） | 53.8×28，圆角 8，padding 0 12，1px 同色边框；文字 14px/400 | 背景/边框 `rgb(27,78,216)`，文字 `#fff` | `rgb(52,107,241)`，文字 `#fff` |
| 已定价的价格数字 | 12px/400，右对齐，列宽 70 | `rgb(39,39,42)` | `rgb(245,245,245)` |
| 来源列「LiteLLM」/ 无价格行「—」 | 12px/400，宽 64，padding-left 6 | `rgb(113,113,123)` | `rgb(129,129,129)` |
| 「自定义价格」按钮（`price-table-edit-*`，ghost sm） | 95.5×28，圆角 8，padding 0 12，透明底与透明 1px 边框；文字 14px/400 | 文字 `rgb(113,113,123)` | `rgb(129,129,129)` |

所有文字的 `font-family` 都是 `system-ui, -apple-system, "system-ui", "Segoe UI", Roboto, Helvetica, Arial, sans-serif`，数字列没有 `tabular-nums`。

紧凑宽度 390：分区 x=16、宽 358；卡片 358 宽、圆角 14、`overflow: hidden`；表格放在横向滚动容器里（rect `[17, 204.6, 356, 1833.9]`，`scrollWidth 678 / clientWidth 356`，`overflow-x: auto`，`scrollbar-width: thin`），首屏只露出 模型 / 输入 / 缓存读 三列。副标题折成两行（高 42）。

## Turn footer 用量段（`turn-usage-segment`）

| 元素（取自） | 值 | 亮色 | 暗色 |
| --- | --- | --- | --- |
| 用量段 Pressable | 高 16，圆角 4，padding 0 2；与「已工作 Ns」同行，footer 行 gap 8、高 22 | 静止背景透明；悬停 `rgba(0,0,0,.06)` | 悬停 `rgba(255,255,255,.08)` |
| 用量段文字 `· ↑2 ↓529 · ` 与 `$0.11`（两个 Text） | 13px/400，`tabular-nums` | `rgb(113,113,123)` | `rgb(129,129,129)` |
| 「已工作 7s」 | 13px/400 | `rgb(113,113,123)` | `rgb(129,129,129)` |

## 每轮用量悬浮面板

结构：portal 根（`position: fixed`，1280×900）→ 绝对定位覆盖层 → **外框**（FloatingSurface，`position: absolute`，`max-width: 280`）→ **内层 View**（`styles.tooltip`，`min-width: 280`，gap 4）→ 标题 / 表头行 / 模型行 / [合计行] / 耗时行 / 脚注。

| 元素（取自） | 值 | 亮色 | 暗色 |
| --- | --- | --- | --- |
| 外框（「本轮用量」的祖父节点） | `box-sizing: border-box`，宽 280，圆角 8，1px 实线边框，padding 4 8，z-index 1000，`overflow: visible`，`pointer-events: none` | 背景 `#fff`，边框 `rgb(228,228,231)`，阴影 `rgba(0,0,0,.35) 0 16px 40px -18px, rgba(0,0,0,0) 0 1px 0 inset` | 背景 `rgb(17,17,17)`，边框 `rgb(25,25,25)`，阴影 `rgba(0,0,0,.8) 0 16px 40px -18px, rgba(255,255,255,.04) 0 1px 0 inset` |
| 标题「本轮用量」 | 14px/400，margin-bottom 2 | `rgb(39,39,42)` | `rgb(245,245,245)` |
| 表头（模型 / 输入 / 缓存 / 输出 / 估算成本） | 12px/400，行 gap 8；数字列 `min-width: 56` 右对齐 | `rgb(113,113,123)` | `rgb(129,129,129)` |
| 数据行单元格、模型名 | 12px/400 | `rgb(39,39,42)` | `rgb(245,245,245)` |
| 合计行 | 本次没取到（见文末） | — | — |
| 耗时行（「耗时」/「7s」） | 12px/400，margin-top 4，`space-between` | 标签 `rgb(113,113,123)`，值 `rgb(39,39,42)` | 标签 `rgb(129,129,129)`，值 `rgb(245,245,245)` |
| 脚注「估算成本 · 按公开 API 价格计算」 | 12px/400 | `rgb(113,113,123)` | `rgb(129,129,129)` |

### 几何读数

opus 一轮（带推理），1280 桌面，悬停：

| 元素 | rect |
| --- | --- |
| 触发段 `turn-usage-segment` | `[530.2, 404, 114.73, 16]`，中心 x = 587.57 |
| 外框 | `[447.56, 272, 280, 124]`，中心 x = 587.56；内容盒 x = 456.56 … 718.56（宽 262） |
| 内层 View（内容） | `[456.56, 277, 280, 114]`，右缘 736.56；`scrollWidth = clientWidth = 280` |
| 表头 模型 / 输入 / 缓存 / 输出 / 估算成本 | x = 456.56(w24) / 488.56 / 552.56 / 616.56 / 680.56（后四列 w56） |
| 数据行 模型格 / 输入 / 缓存 / 输出 / 成本 | x = 456.56(**w0**) / 464.56 / 528.56 / 592.56(**w80，h30，折两行**) / 680.56 |
| 耗时值「7s」 | `[722.72, 357, 13.84, 15]`，右缘 736.56 |

gpt-6-astra 一轮（无推理），1280：触发段 `[519.13, 260, 135.13, 16]`（中心 586.70），外框 `[446.69, 143, 280, 109]`（中心 586.69），内层 `[455.69, 148, 280, 99]`（右缘 735.69，外框右缘 726.69）。表头与数据列对齐，但模型列只有 24 宽，`gpt-6-astra` 显示成 `g…`。

390 触屏点按（opus 一轮）：触发段 `[148.2, 621, 114.73, 16]`（中心 205.57），外框 `[65.56, 489, 280, 124]`（中心 205.56），内层 `[74.56, 494, 280, 114]`（右缘 354.56，外框右缘 345.56）。列宽与桌面相同：模型格宽 0，输出格 80×30。

## 结论：面板为什么是"歪的"

1. **内容比外框宽 18px，整体右移 9px。** 外框是 `border-box`，`maxWidth` 默认 280（`packages/app/src/components/ui/tooltip.tsx` 的 `TooltipContent`），扣掉 1px 边框和 8px 左右 padding 后，内容盒只剩 262。内层 `styles.tooltip` 写的是 `minWidth: 280`（`turn-usage-segment.tsx`），于是内层 280 宽从 x=456.56 排到 736.56，超出内容盒右缘（718.56）18px，超出外框边线（727.56）9px。外框 `overflow: visible`，溢出部分画在边框外面。外框本身是居中的：外框中心 587.56，触发段中心 587.57，误差 0.01px。但内容中心在 596.56，比触发段偏右 9px；左侧留白 9px（1 边框 + 8 padding），右侧是 −9px。截图里「估算成本」「$0.11」「7s」都压过右边框，这就是"歪"。你的第一条推测成立。
2. **列宽预算只给模型列留了 24px。** 内层 280 = 模型列 + 4×56（数字列 `minWidth`）+ 4×8（gap），模型列 `flexBasis: 0; flexGrow: 1` 只能分到 24px。没有推理 token 时列能对齐，但模型名被截成 `g…`。
3. **有推理 token 的行错位更严重。** 输出格文字「529 （240 推理）」撑到 80px 并折成两行（行高 30，其余行 15）。多出的 24px 全部从模型列扣掉，模型格宽 0，模型名完全不可见。输入、缓存两列比表头左移 24px（表头 488.56 / 552.56，数据 464.56 / 528.56）。输出列右缘仍在 672.56，看起来对齐，成本列（680.56）不受影响。你说"带推理的行输出列变宽导致列不对齐"方向对，但错位的是它左边的输入、缓存两列，模型名也被挤没了；输出列自己的右对齐边没有动。

这三点在 390 触屏下读数相同，与视口宽度无关。

## 没取到的内容

- **多模型面板和合计行**：dev home 里所有带用量的轮次（opus、haiku、gpt-6-astra 的 7 轮）都是单模型。`buildTurnUsageBreakdown` 在单模型时 `total: null`（`packages/app/src/usage/turn-usage.ts:92-119`），所以合计行没渲染出来。按源码，合计行是 `theme.fontSize.sm` + `fontWeight.medium` + `foreground`，没有实测。拿到已有用量段后没有再新建 agent。
- **面板里的「无价格数据」药丸**：没有找到未定价模型的用量轮次（pi/deepseek 两个 agent 没有用量段）。按源码是 `palette.amber[500]`、`fontSize.sm`，没有实测。
- **390 暗色点按截图**：在打开状态下切换配色方案，面板会关闭，所以只留了亮色。暗色的颜色值在桌面暗色量测里都有。
- **价格表紧凑宽度暗色、按钮 hover 态**：没有要求，没有截取。
