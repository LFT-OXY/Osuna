# 10 — 去掉横向分割线、Composer 控件图标对齐 t3

**What to build:** 两处跟 t3 对齐。第一处：工作区界面里的横向分割线全部去掉，层次改靠底色和留白，布局结构不变，面包屑栏与 tab 条仍是两行。第二处：Composer toolbar 的 Agent controls 按 t3 的规则上色，控件之间加分隔。

- **横线**：
  - 去掉：工作区头部（面包屑栏）底边线、tab 条底边线、Explorer sidebar 头部（tab 条）底边线。
  - 去掉：左侧栏导航块下方、sidebar callout 上方、底部工具栏上方三条横线。
  - 保留：diff 文件头的线。它吸顶、滚动时压在代码上，需要线把两者分开。
  - 保留：竖向分隔（侧栏与主区之间、分屏之间），不在本票范围。
- **Composer 图标**（t3：`ComposerControl.tsx`、`TraitsPicker.tsx`、`Icons.tsx`）：
  - provider 图标用品牌色：Claude 为 `#d97757`，其余为前景色，不再用弱色。
  - 快速模式开启时，闪电图标实心着色：Claude 下为同一橙色，其他 provider 为前景色；关闭时保持弱色。
  - 控件文字从弱色提到次一级文字色，改用 medium 字重；普通图标仍是弱色。
  - 模型、推理强度、模式之间加 16 高的细竖线，窄宽度时隐藏。

**Blocked by:** 04 — 工作区外框；07 — Composer；08 — Explorer sidebar 与 diff
**Status:** ready-for-agent
**Impl:** done

- [x] 上述横线全部去掉，分组靠底色与留白仍然清楚；紧凑布局与分屏无布局回退
- [x] Composer 四项调整生效；Claude 与非 Claude provider 各有截图
- [x] 该区域 Electron 桌面端亮色与暗色截图与 t3 观感对照，截图作为证据附在本票 Comments
- [ ] 该区域中断言边框或颜色的 e2e 已随设计更新，且在 CI 上通过
- [x] testID 与英文 UI 文案逐字未变
- [x] docs/design.md 对应章节已改写（§5 pane chrome 的"一条底边线"规则等），不在末尾追加
- [x] typecheck 与 lint 通过

## Comments

### 2026-09-27 — 实现记录与视觉证据

实现前与用户确认的决定：
- 控件文字保持 `foregroundMuted`，只改成 medium。Osuna 文字三级是 `foreground` / `foregroundMuted` / `foregroundExtraMuted`，控件文字原本就是 `foregroundMuted`。t3 默认主题里控件文字用的 `secondary-label` 和图标用的 `muted-foreground` 同值（亮 `#71717b`、暗 `#818181`），正好等于 `foregroundMuted`。所以按 t3 取值，颜色不变，没有新增 token。

去掉的横线：
- 工单列出的：工作区头部（两处 `ScreenHeader` 传 `borderless`）、桌面 tab 条、紧凑布局 tab 行、Explorer tab rail（桌面分隔 View 与紧凑 overlay 头部）、左侧栏导航块下方、底部工具栏上方、sidebar callout 上方。
- 审查中按"全部去掉"补上的：`PaneContentToolbar`（diff、文件、会话历史、PR 等 pane 工具栏）、浏览器 pane 工具栏与错误行、子代理面板副标题头、Changes 面板 Commits 区顶线、终端错误行。两个错误行改用 `surface1` 底色区分。
- 保留：diff 文件头（吸顶，压在代码上）；竖向分隔；终端原生键盘条的顶线（贴键盘的输入附件，底色与终端相同）；sidebar callout 错误态的红色上边线。后者是错误态唯一的视觉信号（Rosetta 警告、更新失败），属于状态，不是分隔线。
- 设置页、插件页等非工作区屏幕的 `ScreenHeader` 仍画底线，不在本票范围。

Composer：
- 品牌色：`getProviderBrandColor`（`components/provider-icons.ts`），只有 `claude` 有值 `#d97757`。`ModelProviderGlyph` 加了 `tone="brand"`，桌面 toolbar 触发器和紧凑模型触发器使用它，没有品牌色的 provider 用 `foreground`。自定义 provider 不会显示 Claude 图标，因此也不会拿到橙色，这与 t3 只认 `claudeAgent` 一致。
- 快速模式：高亮类型从 yellow 改为 `providerBrand`，开启时换成实心的 `FastModeOnIcon`，桌面 toolbar 与 sheet 两处都生效。没有加 t3 的 `opacity-80`，因为工单只写了"实心着色"。
- 文字 medium：桌面控件标签、provider 选择器、模型选择器 toolbar 标签、紧凑触发器的模型名。紧凑触发器里推理强度那段小字仍是 normal，它是 `foregroundExtraMuted` 的次级提示。
- 竖线：`AgentControlSeparator` 为 1×16、左右各 2、`border` 色。位置由 `resolveComposerSeparators` 决定，只在 full 密度显示。`resolveFullFloor` 计入了竖线宽度（每条 9，含间距），原有密度测试中 430 的临界用例改成 450。
- design.md §14 与 spec 的禁止清单登记了品牌色这一例外。

Electron 桌面端证据：
- 方式：接入已在运行的 dev 桌面端，用 Playwright CDP 截图并读取计算样式。紧凑布局用 CDP 模拟 420 宽。
- 截图：
  - 暗色：[Claude，快速模式开启](../evidence/10-electron-dark-claude-fast-on.jpg)、[Codex](../evidence/10-electron-dark-codex.jpg)、[Explorer 打开，快速模式关闭](../evidence/10-electron-dark-explorer.jpg)
  - 亮色：[Claude，快速模式开启](../evidence/10-electron-light-claude-fast-on.jpg)、[Codex](../evidence/10-electron-light-codex.jpg)、[Explorer 打开](../evidence/10-electron-light-explorer.jpg)、[紧凑 420 宽](../evidence/10-electron-light-compact.jpg)
- 计算样式（暗色、Codex）：标签 `font-weight: 500`，颜色 `rgb(129, 129, 129)`；provider 图标填充 `rgb(245, 245, 245)`；两条竖线为 1×16、`rgb(25, 25, 25)`、左边距 2px；tab 条 `border-bottom-width: 0px`。
- 与 t3 对照：竖线尺寸对应 t3 `ComposerControlSeparator` 的 `mx-0.5 h-4`，快速模式图标着色对应 `TraitsPicker` 的 `fill-current` 规则，品牌色 `#d97757` 一致。
- 窄宽度：在 1000 宽且 Explorer 打开时，Composer 切到紧凑触发器，没有竖线；1020–1250 宽仍为 full。condensed 档只出现在分屏窄 pane 中，这次没有截图，由 `layout.test.ts` 覆盖（非 full 档不显示竖线）。

审查（两个轴共四轮）：
- 第一轮：
  - Standards 硬性：品牌色 hex 未登记为 §14 例外，已登记；styling.md 的 Composer 段落后，已改写。
  - Spec：浏览器 pane 工具栏和子代理面板头仍有线，已去掉。
- 第二轮：
  - Standards 硬性：design.md 的"图标只有两个例外"与 plan / auto-accept 的蓝绿不符，已改写；quality-guidelines 与 component-guidelines 的禁止清单没有同步例外，已同步。
  - Spec：Commits 区顶线、终端错误行，已去掉。
- 第三轮：
  - Spec：浏览器错误行，已去掉。
- 第四轮：两轴均无新问题。
- 采纳的判断性意见：
  - 紧凑触发器改用 `ModelProviderGlyph`，去掉重复的取色兜底。
  - §5 的规则限定为"Workspace chrome"。
- 未采纳的判断性意见：
  - `getToggleFeatureIcon` 留在 `index.tsx`：`utils.ts` 不引入 RN 图标。
  - `AgentControlSeparator` 保留 `visible` prop，用来压住 lint 的 complexity 上限。
  - 竖线样式直接用几何常量：它同时供宽度预算使用，保持单一来源。
  - provider 与 feature 成对传参，未合并。
  - `model-sheet` 的 `ProviderIcon` 解析两次，未改。

测试：
- 先写失败测试再实现（红→绿）：`layout.test.ts`（竖线出现条件、宽度预算、位置函数）、`utils.test.ts`（快速模式映射到 `providerBrand`）、`provider-icons.test.ts`（品牌色）。
- 最终对受影响目录定向运行 102 个文件、730 条，全部通过。
- 没有 e2e 断言这些边框或颜色。全量 e2e 待 CI，对应验收项没有勾选。

检查：`packages/app` 的 typecheck（`tsgo --noEmit`）无错误；改动文件 lint 为 0 warning、0 error；改动文件已逐个用 `format:files` 格式化。

未验证：
- 原生端（iOS / Android）没有真机或模拟器证据。
- 分屏 condensed 档没有截图。
