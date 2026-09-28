# 访谈结论：思考等级滑条

来源：2026-09-28 `/atw-askme-with-docs` 访谈。提供方/模型拆分与彩色图标在 `09-28-provider-model-split`，品牌色表在那个任务里补齐。

## 已定决策

- 平台：桌面/Web 与紧凑布局（手机 sheet）都做。
- 触发器：工具栏上现有的「🧠 High ∨」触发器不变，点开的浮层从列表换成滑条。
- 浮层内容：只显示当前档位名（option `label`）和滑条，不显示 description。
- 档数：等于当前模型的思考选项数；松手才生效，拖动经过的档位不逐一切换。
- 兜底：选项超过 6 个时退回现在的列表。
- 渐变：已填充部分从品牌色的浅色版渐变到品牌色本身；没有品牌色的提供方（以及黑白品牌色的 Pi、Copilot）用蓝紫兜底（参考图 4）。
- 粒子动效：填充区内有漂浮光点，档位越高，光点越多、越活跃；系统开启「减少动态效果」时关闭粒子。用 reanimated 实现。

## 代码事实

- 当前思考选择：`DesktopAgentControlsContent` 里的 `AgentControlTrigger` + `Combobox`（`packages/app/src/composer/agent-controls/index.tsx:1062-1101`），选项渲染器为 `ThinkingComboboxOption`（`:1569`）。紧凑布局在 `SheetAgentControlsContent`（`:1203` 起）。
- 数据：`thinkingOptions` 是有序的 `AgentSelectOptionSchema` 数组 `{id, label, description?, isDefault?, metadata?}`，另有 `defaultThinkingOptionId`（`packages/protocol/src/messages.ts:372-378, 422-423`）。
- 品牌色：`getProviderBrandColor`（`packages/app/src/components/provider-icons.ts:37`）。本任务开工时如果 `09-28-provider-model-split` 还没合入，表里只有 Claude 有品牌色，其余走蓝紫兜底。
- `packages/app/src/components/ui` 下目前没有现成的 slider 组件。
