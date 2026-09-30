# 价格表 / 每轮用量悬浮面板 UI 取值补充（1:1 原型用）

通用基准：`.atw/tasks/archive/2026-09/09-30-providers-settings-redesign/research/ui-tokens.md`（下文记作「基准」，`基准 §x.y` 指它的章节）。这里只补基准没有的内容。

路径默认相对 `packages/app/src/`，其他包写全路径。行号以当前 worktree（分支 `enhance-pricing-hover-panel`，0.13.0 之后）为准。

两条贯穿全文的规则：

- 没有显式 `lineHeight` 的 RN `<Text>`，Web 上行高是浏览器 `normal`，原型写 `line-height: normal`（见基准 §1.4 末条）。RN-web 的 Text 默认 `box-sizing: border-box`（`node_modules/react-native-web/dist/exports/Text/index.js:147`），`minHeight` 包含 padding。
- `fontVariant: ["tabular-nums"]` 在 Web 上输出为 `font-variant-numeric: tabular-nums`。

---

## 0. 本文用到的 token（亮 / 暗）

数值都来自基准 §1.1、§1.3、§1.6，这里只把两处界面用到的集中列出，方便对照。

| token | light | dark | 定义处 |
|---|---|---|---|
| surface0（聊天流、设置页底色） | `#fcfcfc` | `#0a0a0a` | `styles/theme.ts:538 / 684` |
| surface2（输入框底色） | `#f4f4f5` | `#171717` | `theme.ts:540 / 686` |
| surface3（StatusBadge 底色、骨架条） | `#e4e4e7` | `#262626` | `theme.ts:541 / 687` |
| surfaceCard（卡片、非毛玻璃浮层底色） | `#ffffff` | `#111111` | `theme.ts:545 / 692` |
| border | `#e4e4e7` | `#191919` | `theme.ts:554 / 701` |
| borderAccent（输入框 hover / 聚焦边框） | `#d4d4d8` | `#262626` | `theme.ts:555 / 703` |
| borderInput（输入框静止边框） | `#d4d4d8` | `#1e1e1e` | `theme.ts:550 / 697` |
| borderCardRow | `rgba(228, 228, 231, 0.5)` | `rgba(25, 25, 25, 0.5)` | border × `CARD_ROW_BORDER_ALPHA 0.5`，`theme.ts:260, 358` |
| foreground | `#27272a` | `#f5f5f5` | `theme.ts:534 / 698` |
| foregroundMuted | `#71717b` | `#818181` | `theme.ts:552 / 699` |
| foregroundExtraMuted（SettingsSection 数量） | `#a1a1aa` | `#555555` | `theme.ts:553 / 700` |
| accent（聚焦环、default 按钮） | `#1b4ed8` | `#346bf1` | `theme.ts:556 / 704` |
| statusDanger | `#9d433b` | `#d8847b` | `theme.ts:151 / 159` |
| statusWarning | `#7b5d39` | `#c09664` | `theme.ts:152 / 160` |
| interactionHighlight | `rgba(0, 0, 0, 0.06)` | `rgba(255, 255, 255, 0.08)` | `theme.ts:482 / 625` |
| shadowPopover | `rgba(0, 0, 0, 0.35)` | `rgba(0, 0, 0, 0.8)` | `theme.ts:402` |
| insetHighlight | `transparent` | `rgba(255, 255, 255, 0.04)` | `theme.ts:253, 368` |
| palette.amber[500] | `#f59e0b` | `#f59e0b`（两主题同色） | `theme.ts:90` |

尺寸 token：`spacing` 0.5→2、1→4、2→8、3→12、4→16、6→24、8→32（基准 §1.2）；`fontSize.sm 12`、`base 14`（基准 §1.4）；`borderRadius.base 4`、`borderRadius.full 9999`（`theme.ts:874, 879`）；`radius.md 8`、`radius.lg 10`（`theme.ts:886` 起）；`ICON_SIZE.sm 14`。

---

## 1. 价格表（设置 → 主机 → 价格表）

### 1.1 挂载位置与外壳

- 侧栏条目 `{ id: "usage", labelKey: "settings.hostSections.usage", icon: Gauge }`（`screens/settings-screen.tsx:214`），文案 zh「价格表」/ en「Price table」（`i18n/resources/en.ts:2213`）。
- 路由 `case "usage"` → `<HostPriceTablePage>`（`settings-screen.tsx:260-261`）→ `<View><PriceTableSection/></View>`（`screens/settings/host-page.tsx:347-359`）。页面上只有这一个 section。
- 内容列：padding 16，paddingTop 24，`maxWidth 720`，居中（`settings-screen.tsx:1803-1809`；基准 §3.1 引用的行号是 1677-1686，文件已漂移，数值未变）。页头图标为 `Gauge` 16，标题「价格表」（基准 §3.3）。

### 1.2 结构（`price-table/price-table-section.tsx:219-246`）

```
SettingsSection title「价格表」 trailing=controls                               220-224（基准 §5.1）
└ settingsStyles.card（surfaceCard，radius 14，1px border，overflow hidden）   225（基准 §4）
   ├ subtitle          仅 ready 时渲染                                         226
   ├ controlError      常驻，空串也占位                                         228-230
   └ PriceTableBody    loading / unavailable / error / empty / 表格            231-243, 264-326
```

- SettingsSection 新增了 `count` 属性：标题后跟一个数字，样式 sectionHeaderTitle（13/18/500）+ color foregroundExtraMuted（`components/settings/headings/settings-section.tsx:14-15, 51-53, 83-85`）。基准 §5.1 没写，分组方案里的「组头带数量」可以直接用它。价格表目前没传。

**trailing 控件组 controls**（`price-table-section.tsx:181-207, 329-337`）：row，align center，gap 8。依次：

1. 「自动更新」文字：12px，foregroundMuted，line-height normal
2. Switch（基准 §5.2）
3. Button ghost sm，左图标 lucide `RefreshCw` 14，文案「立即刷新」；刷新中 loading（图标位换 spinner）并改文案「刷新中…」（基准 §5.3）

**subtitle**（`338-343`）：12px，foregroundMuted，padding-x 16，padding-top 12，line-height normal。

**controlError**（`228-230`, `354-362`）：常驻两行高。12px，line-height 16.8（12×1.4），`min-height 33.6`（12×2.8，border-box，含 padding-top），padding-x 16，padding-top 8，color statusDanger，`numberOfLines={2}`。没有错误时也是 33.6px 的空白。

**非表格状态**（`264-287`, `344-353`）：

| 状态 | 样式 | 文案 |
|---|---|---|
| loading | 14px foregroundMuted，padding 16 | 正在加载价格表… |
| unavailable | 同上 | 连接到这台主机后可查看价格表。 / 更新这台主机后可查看价格表。 |
| error | 块：gap 8，align flex-start，padding 16；错误文字同 controlError 样式（含 min-height 33.6、padding-x 16、padding-top 8，叠在块的 padding 里）；下接 Button ghost sm「重试」 | daemon 原文 |
| empty | 同 loading | 这台主机还没有用过任何模型。 |

### 1.3 表格（`price-table-section.tsx:289-326, 363-383`）

```
ScrollView horizontal（Web 即 RN ScrollView，横向滚动条走全局细滚动条样式，基准 §2）
└ table: padding-x 12，padding-bottom 8
   ├ headerRow: row，align center，gap 6，padding-y 8
   │    模型 | 输入 | 缓存读 | 缓存写 | 输出 | 来源 | 操作
   └ PriceRow × N（每一行都带 border-top，第一行也有，所以表头下面有一条线）
```

表头单元格：12px，foregroundMuted，line-height normal；四个价格列 `text-align: right`，其余左对齐。

**列宽**（`price-table/price-columns.ts:16-28`）：

| 列 | 宽 | 其他 |
|---|---|---|
| gap（列间距） | 6 | `PRICE_COLUMN_GAP` |
| model | 154 | overflow hidden |
| price ×4 | 70 | 表头与数值右对齐 |
| source | 64 | padding-left 6 |
| actions | 120 | `ACTIONS_WIDTH`（注释：「自定义价格」按钮 101，保存 + 取消 116） |

合计：154 + 70×4 + 64 + 120 + 6×6 = 654，加 table 左右 padding 24 = 678；卡片内宽 720 − 32 − 2 = 686（`price-columns.ts:7-14` 注释写的就是这组数）。紧凑布局（<720）下卡片变窄，靠横向滚动。

### 1.4 PriceRow（`price-table/price-row.tsx`）

```
rowBlock: gap 4，padding-y 8，border-top 1px borderCardRow                     157-162
├ row: row，align center，gap 6                                                 163-167
│  ├ modelCell（宽 154，overflow hidden，竖排 gap 4）                          170-173
│  │   ├ 模型 id：12px foreground，单行省略                                     174-177
│  │   └ 仅 !priced：badgeRow(row) → StatusBadge warning「无价格数据 · 估算 $0」  57-61, 178-180
│  ├ priceCell × 4（宽 70）                                                     181
│  │   ├ 只读：12px foreground，右对齐；无 pricePerMillion 时「—」              75-77, 182-186
│  │   └ 编辑：FormTextInput size="sm"，keyboardType decimal-pad，无占位         143-152
│  ├ sourceCell（宽 64，padding-left 6）：12px foregroundMuted，单行            81-83, 187-191
│  └ actionsCell（宽 120）：row，align center，gap 4                            84-112, 192-197
│       只读：Button ghost sm「自定义价格」
│       编辑：Button default sm「保存」（loading）+ 仅已有价格时 Button ghost sm「取消」
└ error：12px statusDanger，line-height 16.8，min-height 16.8，单行；空串也占位   115-117, 198-204
```

- 行内状态：`priced === false` 的行一进来就是编辑态（草稿为四个空串，`price-table-section.tsx:313`），只有「保存」没有「取消」。
- 来源列文案：`table` → LiteLLM，`override` → 自定义，无价格 → 「—」（`price-table/pricing.ts:122-129`）。
- 行高（桌面）：只读行 = 8 + 文字行 + 4 + 16.8 + 8，文字行被 28 高的 ghost sm 按钮撑到 28 → 约 64.8；无价格行 modelCell 为「id + 4 + 徽标」两行，比按钮高，行高由它决定。
- 价格格子数值格式见 §3.4。

### 1.5 FormTextInput size="sm" 放进 70 宽的格子

几何与状态全部见基准 §5.7，这里只补它在价格格子里的实际效果：

| 项 | 桌面（≥720） | 紧凑（<720） | 来源 |
|---|---|---|---|
| 外框 | min-height 28，padding 3px 12px，radius 8 | min-height 32，padding 5px 12px | `components/ui/control-geometry.ts:146-153` |
| 字号 / 行高 | 14 / 20 | 同 | `control-geometry.ts:132, 162-165` |
| 底色 | surface2 `#f4f4f5` / `#171717` | 同 | `components/ui/form-field.tsx:252-254` |
| 边框 | 1px borderInput；hover borderAccent；聚焦 borderAccent + `outline: 2px solid accent; outline-offset: 1px` | 同 | `control-geometry.ts:235-250`，`form-field.tsx:190-210` |
| 输入文字 | foreground，padding 0，outline 无 | 同 | `form-field.tsx:274-282` |
| 格内可用文字宽 | 70 − 24 − 2 = **44px** | 同 | 推算 |

聚焦由 `onFocus` 置 `focused`，聚焦态优先于 hover（`control-geometry.ts:102-115`）。禁用 opacity 0.5，价格表没用到。

### 1.6 StatusBadge warning（`components/ui/status-badge.tsx:32-58`）

| 项 | light | dark |
|---|---|---|
| 容器 | row，center，gap 6，radius 9999，border 1px，padding 3px 8px | 同 |
| 边框色（border） | `#e4e4e7` | `#191919` |
| 底色（surface3） | `#e4e4e7` | `#262626` |
| 文字 | 12px，400，line-height normal，statusWarning `#7b5d39` | 同左，`#c09664` |

亮色主题下边框和底色同为 `#e4e4e7`，边框看不出来；暗色下 `#191919` 边框比 `#262626` 底色更深，看得出一圈。徽标高度 = 12px 的 normal 行高 + 6 + 2，精确值取决于系统字体。

---

## 2. 每轮用量段与悬浮面板

### 2.1 所在的 footer 行

聊天流底色 surface0（`agent-stream/view.tsx:1728-1731`）。

**TurnFooterRow**（`agent-stream/turn-footer.tsx:230-262`）：

| 层 | 样式 | 行 |
|---|---|---|
| streamItemWrapper | width 100%，`maxWidth 820`（`MAX_CONTENT_WIDTH`，`constants/layout.ts:15`），居中，padding-x 8 | 236-241 |
| turnFooterRow | margin-top 13（8 + 5） | 242-244 |
| turnFooterSlot | row，align center，align-self flex-start，min-height 24，padding-bottom 32（`TURN_FOOTER_BOTTOM_SPACING = SPACING[8]`） | 245-251, 26 |

已完成的轮：slot 里是 `AssistantTurnFooter`（`turn-footer.tsx:217-227`）。

**AssistantTurnFooter**（`components/message.tsx:553-583, 650-679`）：container row，align center，**gap 8**，flex-wrap wrap（手机上用量段换到第二行）。依次：

1. **复制按钮** TurnCopyButton（`message.tsx:979-992`, `1043-1064`，外加 `561-567` 的覆盖）：最终样式 padding 4（四边），margin-left −4，margin-top 0，align-self center；图标 lucide `Copy` 14（复制后 `Check` 14），静止 foregroundMuted，hover foreground。点击区 22×22。
2. **分叉菜单**（仅可分叉时）AssistantForkMenu（`components/assistant-fork-menu.tsx:76-96, 126-138`）：trigger padding 4，透明底，外包 align-self center；图标 lucide `Split` 14，静止 foregroundMuted，hover / 展开 foreground。它自带一个 Tooltip（delay 250，side top，offset 8，文字 12px foreground）。
3. **时长标签**（有 duration 或完成时间时）（`message.tsx:657-676`）：Pressable 包 labelWrapper（position relative）；两层 Text 叠放：
   - labelSizer：13px，foregroundMuted，opacity 0，内容取两种标签中较长的一个，用来撑宽度
   - labelOverlay：absolute，top 0，left 0，13px，foregroundMuted
   - 文案 `message.workedFor`：zh「已工作 {{duration}}」/ en「Worked for {{duration}}」（`zh-CN.ts:340`、`en.ts:340`）；Web hover 时换成完成时间（`formatMessageTimestamp`：当天「22:11」或「10:11 PM」，7 天内「星期三 22:11」，更早「2026年5月14日, 22:11」这类（日期与时间之间固定是英文逗号加空格，`utils/time.ts:146`），随系统语言，`utils/time.ts:120-147`）
   - line-height normal
4. **用量段** `renderUsage()` → TurnUsageSegment（§2.2）

`STREAM_METADATA_FONT_SIZE = 13`（`components/message.tsx:187-189`，注释：介于 fontSize.sm 12 与 base 14 之间，没有 token）。

进行中的轮（`turn-footer.tsx:121-152, 252-261`）：row，高 24，gap 12；SyncedLoader 14（foreground，margin-left −2）+ 分叉菜单 + ShimmerText「工作中 {{duration}}」/「Working for {{duration}}」。没有用量段。

### 2.2 TurnUsageSegment（`agent-stream/turn-usage-segment.tsx`）

- host 不支持 `features.usage` 时整段不渲染（`35-37`）。
- 数据未到但该 agent 已有别的轮数据：显示骨架条 **64×12，radius 9999，surface3**（`53-57`, `192-197`）。
- 正常态（`64-86`, `169-189`）：

| 部分 | 样式 |
|---|---|
| segment（Pressable，也是 tooltip 触发器） | row，align center，radius 4（`borderRadius.base`），padding-x 2；hover 底色 interactionHighlight（`rgba(0,0,0,0.06)` / `rgba(255,255,255,0.08)`） |
| 文字 1 | `· ↑14.3K ↓4.6K · `（前后都有中点，含空格），13px，foregroundMuted，tabular-nums，line-height normal |
| 文字 2（成本） | 已计价：同文字 1；本轮有任一模型未计价（`turn.priced === false`）：同色同字号，外加 `text-decoration: underline dotted` |

中点「·」在用量段自己的文字里，和前面时长标签之间还有 container 的 gap 8。

### 2.3 悬浮面板内容（`turn-usage-segment.tsx:65-135, 198-265`）

Tooltip 参数：`delayDuration 0`、`enabledOnDesktop`、`enabledOnMobile`；`TooltipContent side="top" align="center" offset={8}`，**未传 maxWidth，取默认 280**。

```
tooltip（内层 View）：gap 4，min-width 280                                        198-201
├ tooltipTitle「本轮用量」：14px，foreground，margin-bottom 2                      202-206
├ 表头行 row：align center，gap 8                                                 207-211
│   模型(modelCell) | 输入 | 缓存 | 输出 | 估算成本(numberCell)  —— 12px foregroundMuted
├ 模型行 × N（row，同上）
│   modelCell：row，align center，gap 4，flex 1 1 0                                212-219
│     ├ 模型名：12px foreground，flex-shrink 1，单行省略                           238-242
│     └ 未计价时「无价格数据」：12px，amber[500] #f59e0b（两主题同色）              243-246
│   numberCell × 4：min-width 56，右对齐，tabular-nums；12px foreground（bodyCell） 220-232
├ 合计行（仅本轮用了 ≥2 个模型时）：「合计」+ 四格，12px foreground 500             233-237
├ durationRow：row，space-between，gap 8，margin-top 4                           247-252
│   「耗时」12px foregroundMuted | 时长 12px foreground tabular-nums               253-261
└ note「估算成本 · 按公开 API 价格计算」：12px foregroundMuted                      262-265
```

所有文字都没有显式 line-height，即 normal。

- 输出列有推理时写成 `4.6K （1.2K 推理）`：输出值 + 空格 + `message.turnUsage.reasoning`（zh 用全角括号，`turn-usage-segment.tsx:156-162`）。
- 列只有 `min-width 56`，每行是独立的 flex 行，某格内容超过 56 就只撑宽这一行的这一格，列就对不齐了。
- 缓存列 = cachedInput + cacheWrite（`usage/turn-usage.ts:103`）。

### 2.4 Tooltip 外壳（`components/ui/tooltip.tsx`）

**默认参数**（`433-448`）：`side "top"`、`align "center"`、`offset 6`、`maxWidth 280`。Tooltip 根（`228-243`）：`delayDuration 0`、`enabledOnDesktop true`、`enabledOnMobile false`。

**内容样式**（`574-581`）= `popoverSurfaceStyle(theme, { glass: false })`，再把 radius 改成 8，加 padding 4px 8px、zIndex 1000。展开后：

| 属性 | light | dark |
|---|---|---|
| background（`floatingSurfaceFill` 非毛玻璃分支 → surfaceCard，`styles/floating-surface.ts:17-20`） | `#ffffff` | `#111111` |
| border | `1px solid #e4e4e7` | `1px solid #191919` |
| border-radius | 8（`popoverSurfaceStyle` 给 10，`tooltip.tsx:577` 覆盖为 `radius.md`） | 8 |
| box-shadow（`floating-surface.ts:48`） | `0 16px 40px -18px rgba(0, 0, 0, 0.35), inset 0 1px 0 transparent` | `0 16px 40px -18px rgba(0, 0, 0, 0.8), inset 0 1px 0 rgba(255, 255, 255, 0.04)` |
| padding | 4px 8px | 同 |
| backdrop-filter | 无（glass:false 固定不透明，Web 也一样） | 无 |

同一个元素上还叠着 frameStyle：`position absolute; top/left = 计算坐标（未算出前 -9999）; max-width = maxWidth`（`tooltip.tsx:498-508`；`FloatingSurface` 把 frameStyle 追加进同一个 Animated.View，`components/ui/floating.tsx:24-37`）。出现 / 消失各 80ms 淡入淡出（`FadeIn/FadeOut.duration(80)`，`tooltip.tsx:523-524`）。

**挂载**（Web，`tooltip.tsx:518-535`）：portal 到 `#overlay-root`（`position fixed; inset 0; pointer-events none`，`lib/overlay-root.ts:26-38`）→ 一层铺满的 View（absolute 0/0/0/0，`zIndex 20000` = `OVERLAY_Z.tooltip`，`tooltip.tsx:566-573`）→ 浮层。浮层本身 `pointerEvents="none"`，鼠标移不进面板；离开触发器（pointerleave / mouseleave / blur）就关。原生端用透明 `Modal`，点任意处关闭（`538-561`）。

**定位算法**（`132-226`, `454-488`）：

1. 打开后 `measureInWindow` 量触发器（Android 加状态栏高度）；浮层先在 -9999 处渲染，`onLayout` 量出自身宽高。
2. 显示区域 = `Dimensions.get("window")` 整个窗口（x 0，y 0）。
3. 翻转：side 为 top 且上方空间 < 浮层高、并且下方空间更大时翻到 bottom（左右同理）。
4. top：`y = trigger.y − contentHeight − offset`；bottom：`y = trigger.y + trigger.height + offset`。
5. align center：`x = trigger.x + (trigger.width − contentWidth) / 2`；start 左对齐，end 右对齐。
6. 夹紧：x 限制在 `[8, window.width − contentWidth − 8]`，y 限制在 `[8, window.height − contentHeight − 8]`。

**打开方式**：`isCompact`（窗口 <720）时 `enabled = enabledOnMobile`，并改成点按打开（`openOnPress`），包括窄窗口的 Web（`tooltip.tsx:251-263`, `353-367`）。桌面 hover 打开（delay 0 即刻），键盘聚焦也打开，程序恢复焦点不打开（`64-84`）。

**外框与内层宽度的冲突**：外框 `max-width 280` 是 border-box，扣掉 1+1 边框和 8+8 padding 后内容区只剩 262；内层 View 要 `min-width 280`，于是溢出外框右侧 18px。`onLayout` 量到的是外框的 280，按 280 居中，所以面板内容看起来整体向右偏。这和 `interview-decisions.md` 里记的根因一致；这里是按样式推算的，没有在浏览器里实测。

### 2.5 popoverSurfaceStyle 原样（glass:true，供对照）

菜单和 Combobox 用 glass:true，Web 上为 surfaceGlass `rgba(255,255,255,0.8)` / `rgba(17,17,17,0.8)` + `backdrop-filter: blur(12px) saturate(1.14)`，radius 10，其余同上表（`styles/floating-surface.ts:5, 17-25, 42-50`；Web 上 `GLASS_SURFACES_ENABLED = true`，`styles/glass-support.web.ts:2`）。tooltip 固定传 glass:false，注释说明理由：提示只有一两行字，透底反而难读（`tooltip.tsx:574`）。

---

## 3. 数据格式

### 3.1 `usage/format.ts`

| 函数 | 规则 | 示例 |
|---|---|---|
| `formatUsageTokensCompact(v)`（`14-22`） | 先四舍五入；≥1e9 `x.xB`，≥1e6 `x.xM`，≥1e3 `x.xK`，都是一位小数；<1000 原样整数；负数带 `-` | 640 → `640`；999 → `999`；2100 → `2.1K`；12000 → `12.0K`；188600 → `188.6K`；1234567 → `1.2M`；999950 → `1000.0K`（不进位成 M） |
| `formatTokenArrows(input, output)`（`25-27`） | `↑{compact(input)} ↓{compact(output)}`，中间一个空格 | (14312, 4580) → `↑14.3K ↓4.6K` |
| `formatSessionCost(v)`（`34-38`） | 非有限或 ≤0 → `$0.00`；<0.01 → 四位小数；否则两位 | 0 → `$0.00`；0.0065 → `$0.0065`；0.0042 → `$0.0042`；0.189606 → `$0.19` |

K / M / B 和 `$` 不随语言变（文件头注释 `1-6`）。

### 3.2 `utils/time.ts` 的 `formatDuration`（`153-170`）

| 输入 ms | 输出 |
|---|---|
| 负数 / 非有限 | `0s` |
| 47 000 | `47s`（<60s 向下取整秒） |
| 120 000 | `2m` |
| 132 000 | `2m 12s` |
| 3 600 000 | `1h` |
| 3 900 000 | `1h 5m`（≥1h 不显示秒） |

单位字母不翻译，zh 下读作「已工作 2m 12s」「耗时 … 2m 12s」。

### 3.3 `usage/turn-usage.ts` 数据形状

```ts
// summarizeTurnUsage(turn) → footer 那一行（55-74）
interface TurnUsageTotals { input: number; output: number; estimatedCost: number; priced: boolean }
// input = turn.totals.input（不含缓存），output = turn.totals.output（已含推理，不再相加）

// buildTurnUsageBreakdown(turn) → 面板表格（76-120）
interface TurnUsageAmounts { input; cache; output; reasoning; estimatedCost; priced }   // 都是 number，priced 是 boolean
interface TurnUsageModelRow extends TurnUsageAmounts { model: string }
interface TurnUsageBreakdown { rows: TurnUsageModelRow[]; total: TurnUsageAmounts | null }
// rows 来自 turn.byModel，顺序同 daemon；cache = cachedInput + cacheWrite
// rows.length < 2 时 total = null（只用一个模型就不显示合计行）
```

上游 `UsageAgentTurn`（`packages/protocol/src/usage/types.ts:260-275`）：`cli`、`backend|null`、`sessionId`、`turnKey`、`turnId|null`、`userMessageIds[]`、`startedAt`、`endedAt`、`durationMs`、`byModel: {model, totals, estimatedCost, priced}[]`（`80-87`, `214`）、`totals: {input, cachedInput, cacheWrite, output, reasoning}`（`11-18`）、`estimatedCost`、`priced`。`turn.priced` = 所有模型都已计价（`packages/server/src/server/usage/agent-report.ts:188`）。

**原型示例（按 §6 的真实价格算出）**：

| 模型 | input | cachedInput | cacheWrite | output | reasoning | 估算成本 | 面板显示（输入 / 缓存 / 输出 / 成本） |
|---|---|---|---|---|---|---|---|
| claude-sonnet-4-5 | 14 312 | 182 400 | 6 200 | 4 580 | 0 | 0.189606 | `14.3K` / `188.6K` / `4.6K` / `$0.19` |
| claude-haiku-4-5 | 2 100 | 12 000 | 0 | 640 | 0 | 0.0065 | `2.1K` / `12.0K` / `640` / `$0.0065` |
| 合计（两行都在时） | 16 412 | 194 400 | 6 200 | 5 220 | 0 | 0.196106 | `16.4K` / `200.6K` / `5.2K` / `$0.20` |
| gpt-5-codex（单模型轮） | 8 420 | 51 200 | 0 | 3 120 | 1 856 | 0.048125 | `8.4K` / `51.2K` / `3.1K （1.9K 推理）` / `$0.05` |
| glm-4.6（无价格） | 任意 | | | | | 0 | 成本 `$0.00`，footer 成本加点状下划线，面板模型名后「无价格数据」 |

对应 footer：`· ↑16.4K ↓5.2K · $0.20`、`· ↑8.4K ↓3.1K · $0.05`。

### 3.4 价格表数值 `formatPriceCell`（`price-table/pricing.ts:40-46`）

非有限 → `—`；0 → `0`；否则 `toFixed(6)` 后去掉末尾 0 和小数点；去完是 `0` 就显示 `<0.000001`。例：3 → `3`，0.3 → `0.3`，3.75 → `3.75`，0.125 → `0.125`。进入编辑时输入框用同样的字符串预填（`buildPriceDraft`，`57-65`）。

价格表副标题（`pricing.ts:141-154`，`usage/relative-time.ts:11-24`）：zh「每百万 token 美元 · LiteLLM 快照，3 小时前更新，12 个模型」，en「$ per million tokens · LiteLLM snapshot, updated 3h ago, 12 models」。时间片段：<1 分钟「刚刚」/`just now`，然后「N 分钟前」/`Nm ago`、「N 小时前」/`Nh ago`、「N 天前」/`Nd ago`（`zh-CN.ts:3295-3300`、`en.ts:3462-3467`）。时间戳解析失败时 ago 为「—」。不管 `table.source` 是 `cache` 还是 `snapshot`，文案都写「LiteLLM 快照」。

行顺序：daemon 把无价格的排前面，其余按 `lastSeenAt` 倒序，再按模型名（`packages/server/src/server/usage/pricing/service.ts:166-185`）；客户端按模型名（不分大小写）去重，保留先出现的（`pricing.ts:102-110`）。

---

## 4. 文案

### 4.1 `settings.host.priceTable.*`（`zh-CN.ts:2729-2762`，`en.ts:2887-2920`）

| key | zh-CN | en |
|---|---|---|
| title | 价格表 | Price table |
| subtitle | 每百万 token 美元 · LiteLLM 快照，{{ago}}更新，{{models}} | $ per million tokens · LiteLLM snapshot, updated {{ago}}, {{models}} |
| modelCountOne | 1 个模型 | 1 model |
| modelCountMany | {{count}} 个模型 | {{count}} models |
| autoUpdate | 自动更新 | Auto-update |
| refresh | 立即刷新 | Refresh now |
| refreshing | 刷新中… | Refreshing... |
| refreshFailed | 无法刷新价格表。 | Could not refresh the price table. |
| autoUpdateFailed | 无法切换自动更新。 | Could not change auto-update. |
| unavailable | 连接到这台主机后可查看价格表。 | Connect to this host to see the price table. |
| upgradeRequired | 更新这台主机后可查看价格表。 | Update the host to see the price table. |
| loading | 正在加载价格表… | Loading the price table... |
| empty | 这台主机还没有用过任何模型。 | No models have been used on this host yet. |
| unpriced | 无价格数据 · 估算 $0 | No price data · estimated $0 |
| customPrice | 自定义价格 | Custom price |
| save | 保存 | Save |
| saveFailed | 无法保存这个价格。 | Could not save this price. |
| invalidPrice | 四列都要填数字。 | Enter a number in all four columns. |
| columns.model | 模型 | Model |
| columns.input | 输入 | Input |
| columns.cacheRead | 缓存读 | Cache read |
| columns.cacheWrite | 缓存写 | Cache write |
| columns.output | 输出 | Output |
| columns.source | 来源 | Source |
| columns.actions | 操作 | Actions |
| source.table | LiteLLM | LiteLLM |
| source.override | 自定义 | Custom |
| source.none | — | — |

错误行的拼法：本地化句子 + 空格 + daemon 原因（`price-table-section.tsx:46-49`），即「无法保存这个价格。 {daemon 原因}」；daemon 没给原因时只有前半句。取消按钮用 `common.actions.cancel`（取消 / Cancel），重试用 `common.actions.retry`。

### 4.2 `message.turnUsage.*`（`zh-CN.ts:347-362`，`en.ts:347-362`）

| key | zh-CN | en |
|---|---|---|
| title | 本轮用量 | Turn usage |
| total | 合计 | Total |
| duration | 耗时 | Duration |
| note | 估算成本 · 按公开 API 价格计算 | Estimated cost · priced at public API rates |
| unpriced | 无价格数据 | No price data |
| reasoning | （{{tokens}} 推理） | ({{tokens}} reasoning) |
| accessibility | 本轮用量：输入 {{input}}，输出 {{output}}，{{cost}} | Turn usage: {{input}} in, {{output}} out, {{cost}} |
| columns.model | 模型 | Model |
| columns.input | 输入 | Input |
| columns.cache | 缓存 | Cache |
| columns.output | 输出 | Output |
| columns.cost | 估算成本 | Cost |

同一行里的相关键：`message.workedFor` 已工作 {{duration}} / Worked for {{duration}}；`message.workingFor` 工作中 {{duration}} / Working for {{duration}}（两文件 `340-341`）。

---

## 5. 协议字段（`packages/protocol/src/usage/types.ts`）

```ts
// 164-171：每百万 token 的美元价
UsagePricePerMillion = { input: number≥0; cachedInput: number≥0; cacheWrite: number≥0; output: number≥0 }

// 189-195
UsagePricingTableInfo = {
  fetchedAt: string;                 // ISO 时间
  source: "cache" | "snapshot";      // 联网缓存 / 内置快照
  autoUpdate: boolean;
}

// 197-208：用量里出现过的一个模型，以及它今天解析到的价格
UsagePricingModel = {
  model: string;
  cli: "claude" | "codex" | "pi" | "omp";
  backend: string | null;            // Pi / OMP 的后端
  priced: boolean;
  priceSource: "override" | "table" | null;
  matchedKey: string | null;         // 命中的价格表键；自定义价时为覆盖项的模型名
  pricePerMillion: UsagePricePerMillion | null;   // !priced 时为 null
  lastSeenAt: string;
}

// 179-184：写回 daemon 配置的覆盖项
UsagePricingOverride = { model: string(min 1); pricePerMillion: UsagePricePerMillion; note?: string }
```

RPC `usage.pricing.list.response` 的 payload：`{ requestId, table: UsagePricingTableInfo, models: UsagePricingModel[] }`（`packages/protocol/src/usage/rpc-schemas.ts:81-89`）。`usage.pricing.refresh.response` 的 payload：`{ requestId, result: "updated" | "not_modified" | "failed", fetchedAt, error: string | null }`（`98-107`，result 枚举见 `types.ts:210`）。

---

## 6. 示例数据（`packages/server/src/server/usage/pricing/snapshot.json`）

快照 `_meta.fetchedAt = 2026-09-18T18:38:36.107Z`，存的是每 token 美元价。换算方式与 daemon 相同：`× 1e6` 再 `toFixed(10)`（`pricing/table.ts:94-101`）。上游缺失的列存为 `null`，daemon 按 0 计价并下发 `0`（`pricing/matcher.ts:172-183`，`service.ts:366-373`），所以价格表里显示 `0`，不显示「—」。

**有价格（直接命中快照键，`priceSource = "table"`，来源列显示 LiteLLM）**，单位 $/M：

| 模型 | 输入 | 缓存读 | 缓存写 | 输出 | 表格显示 |
|---|---|---|---|---|---|
| claude-sonnet-4-5 | 3 | 0.3 | 3.75 | 15 | `3` `0.3` `3.75` `15` |
| claude-opus-4-1 | 15 | 1.5 | 18.75 | 75 | `15` `1.5` `18.75` `75` |
| claude-haiku-4-5 | 1 | 0.1 | 1.25 | 5 | `1` `0.1` `1.25` `5` |
| claude-opus-4-5 | 5 | 0.5 | 6.25 | 25 | `5` `0.5` `6.25` `25` |
| gpt-5 | 1.25 | 0.125 | null → 0 | 10 | `1.25` `0.125` `0` `10` |
| gpt-5-codex | 1.25 | 0.125 | null → 0 | 10 | `1.25` `0.125` `0` `10` |
| gpt-5-mini | 0.25 | 0.025 | null → 0 | 2 | `0.25` `0.025` `0` `2` |
| gemini-2.5-pro | 1.25 | 0.125 | null → 0 | 10 | `1.25` `0.125` `0` `10` |
| gemini-2.5-flash | 0.3 | 0.03 | null → 0 | 2.5 | `0.3` `0.03` `0` `2.5` |

**无价格（`priced = false`，来源「—」，行默认进入编辑态）**：

| 模型 id | 快照直接键 | 快照里带网关前缀的同名键 |
|---|---|---|
| glm-4.6 | 无 | `zai/glm-4.6`、`openrouter/z-ai/glm-4.6`、`cerebras/zai-glm-4.6` 等 |
| qwen3-coder-plus | 无 | `openrouter/qwen/qwen3-coder-plus` |
| kimi-k2-turbo-preview | 无 | `moonshot/kimi-k2-turbo-preview` |
| deepseek-v3.2-exp | 无 | `openrouter/deepseek/deepseek-v3.2-exp`、`novita/deepseek/deepseek-v3.2-exp` |

这四个裸 id 确实查不到价格：matcher 对不含 `/` 的 id 只查直接键及其 Claude / 去日期拼写，不做后缀匹配（`pricing/matcher.ts:110-114`），查不到就返回未计价。只有 id 本身带网关前缀（如 `zai/glm-4.6`）时才会走后缀匹配（`116-122`）。通过 Z.AI、百炼这类 Claude 兼容接口使用时，CLI 记录的就是裸 id，所以这组名字适合做示例。

如果想要连带前缀也完全搜不到的名字，下面几个在快照键里做子串搜索也为 0：`kimi-for-coding`、`doubao-seed-code`、`longcat-flash-chat`。

---

## 7. 设置页内容列宽与紧凑断点

基准已有，这里只引用：

- 内容列 `maxWidth 720`，padding 16，paddingTop 24（基准 §3.1；当前位置 `screens/settings-screen.tsx:1803-1809`）。
- 断点 `xs 0 / sm 576 / md 720 / lg 992 / xl 1200`（`styles/unistyles.ts:6-12`），紧凑 = `xs || sm`，即窗口宽 <720（`constants/layout.ts:42-45`；基准 §0）。
- 聊天流内容列 `MAX_CONTENT_WIDTH = 820`（`constants/layout.ts:15`），基准没写，见 §2.1。

---

## 8. 未能解析或需注意的点

- line-height 为 `normal` 的文字（表头、价格数值、footer 13px 文字、面板所有文字、StatusBadge）没有源码数值，精确像素取决于系统字体。StatusBadge 和各行的精确高度同样受影响。
- §2.4 里「外框 280 与内层 min-width 280 冲突导致右偏 18px」是按样式推算的，没有在浏览器里实测。
- `formatMessageTimestamp` 的非当天格式由 `Intl` 和系统语言决定，表里的中文示例是按 zh-CN 推断的，没有实际运行。
- RN-web 横向 ScrollView 的滚动条外观走全局样式（基准 §2），价格表没有显式设置 `showsHorizontalScrollIndicator`，默认显示；这一点没有实测。
- lucide 图标 `RefreshCw`、`Copy`、`Check`、`Split` 只给名字，path 按 lucide-react-native 0.546.0 取（与基准 §9 相同处理）。
- 基准 §3.1 引用的 `settings-screen.tsx` 行号已漂移（1677-1686 → 1803-1809），数值未变；基准其他行号没有逐一复核，本文用到的 theme 行号已抽查一致。
