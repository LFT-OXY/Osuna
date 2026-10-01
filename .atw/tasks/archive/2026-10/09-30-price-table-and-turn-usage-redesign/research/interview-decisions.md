# 访谈结论（2026-09-30）

## 已查到的事实

- 每个模型的价格来源只有三态：`priceSource` 为 `null`（无价格）、`"table"`（LiteLLM）、`"override"`（自定义价格）。协议：`packages/protocol/src/usage/types.ts` 的 `UsagePricingModelSchema`。
- 设了自定义价格后 `matchedKey` 变成覆盖项的模型名（`packages/server/src/server/usage/pricing/matcher.ts:100`），客户端无从得知 LiteLLM 是否也有价格，所以分组只能按当前来源。
- LiteLLM 价格表可能是内置快照（`table.source = "snapshot"`）或联网缓存（`"cache"`），价格本身无差别；「线上」不是准确的组名。
- 现有价格表 UI：`packages/app/src/price-table/`（`price-table-section.tsx`、`price-row.tsx`、`price-columns.ts`），7 列固定宽度、横向滚动；只有保存/取消，没有移除自定义价格的入口。
- 悬浮面板歪斜根因：`TooltipContent` 默认外框 `maxWidth = 280`（`packages/app/src/components/ui/tooltip.tsx:440`），面板内层 `minWidth: 280` 再加外框左右内边距，内容溢出外框；定位按外框宽度居中导致偏移；带推理的行把「（N 推理）」拼进输出列，列宽逐行不同导致不对齐。面板代码：`packages/app/src/agent-stream/turn-usage-segment.tsx`。

## 用户关注点

- 用户来这个设置页的原因：用了 LiteLLM 查不到价格的模型，需要自定义。「一进来就看到某模型价格」不是诉求。
- 价格表的痛点：输入框对不齐、行太密没层次、按钮样式和整体观感差。

## 决定

| # | 问题 | 决定 |
| --- | --- | --- |
| Q1 | 分组规则 | 两组，按价格来源：「自定义」组 = 无价格 + 已自定义；「LiteLLM 价格」组 = 其余。保存后行留在原组。 |
| Q2 | LiteLLM 组名 | 「LiteLLM 价格」；快照/联网与更新时间留在副标题。 |
| Q3 | 排列 | 自定义组在上、默认展开；LiteLLM 组在下、默认折叠，组头带数量。 |
| Q4 | 自定义组为空 | 显示一行「所有模型都有价格」。 |
| Q5 | 流程 | 必须先做本地 HTML 原型，两组各给两种视觉方案对比，确认后再实现。 |
| Q6 | 歪斜症状 | 不单独确认；重设计时给面板单独定宽，根因一并消除。 |
| Q7 | 悬浮面板改动程度 | 重新设计，并包含：层次分明（表头/合计/耗时/脚注分层），推理从输出列挪出。 |
| Q8 | 手动添加未出现过的模型 | 这次不做。 |
| Q9 | 移除自定义价格 | 要做；移除后回到 LiteLLM 价格或无价格。 |
| Q10 | LiteLLM 组的行 | 每行保留不显眼的「自定义」操作（桌面悬停出现，原生/窄屏常显），点后该模型进入自定义组；展开后提供搜索框。 |
| Q11 | 价格表原型两方案 | 方案一「对齐表格」：统一宽度右对齐输入框、表头标单位 $/M、行高加大、组间留白。方案二「卡片」：自定义组每模型一张卡，模型名+来源徽标，四个带标签输入框 2×2，操作在卡片右下；LiteLLM 组为紧凑只读列表。 |
| Q12 | 悬浮面板原型两方案 | 方案一「总览+明细」：顶部大字本轮估算成本，一行总输入/输出/耗时；每模型两行（名称+成本 / 输入·缓存·输出·推理小字）；底部脚注。方案二「精修表格」：固定列宽，推理独立一列（无推理时隐藏），表头/合计/耗时分隔线分层。移动端沿用点按弹出。倾向方案一。 |
| Q13 | 任务 | 已建本任务；原型只留本地文件，不发布。 |
| Q14 | 价格表方案 | 方案一「对齐表格」，含原型里的「N 个待填写」徽标、待填行淡琥珀底、手机上自动更新与刷新单独成卡。 |
| Q15 | 悬浮面板方案 | 方案一「总览+明细」。 |

## 原型

`prototype/price-and-usage.html`（源码 `prototype/src/`，`python3 prototype/build.py` 重新合成）；选中的画面：价格表 A1–A4、AM，悬浮面板 U1–U3、UM；截图 `prototype/shots/`。
真实基准：`research/baseline-dom.md`、`research/screens/`、`research/ui-tokens-supplement.md`。

## 文案与术语

- 组名：「自定义价格」/ Custom prices（放无价格与已自定义的模型），「LiteLLM 价格」/ LiteLLM prices。已写入 `docs/glossary.md` 的 Price table、Custom price 条目。
- 无价格的状态沿用术语表已有的「无价格数据」/ No price data，不引入原型里的「未定价」「待定价」「无价格」等同义词；「N 个待填写」徽标同理改为「N 个无价格数据」或等价写法，在 PRD 里定稿。
- 新增文案：移除自定义价格（Remove custom price）、所有模型都有价格（空态）。
