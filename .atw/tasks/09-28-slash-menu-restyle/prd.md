# 斜杠菜单美化

父任务：`09-28-composer-slash-revamp`。视觉参考：用户提供的图 3、图 4（图 4 的贴合形态为准）。

## Problem Statement

在 Composer input 里输入 `/` 弹出的 Command menu 看着简陋、也不好用：

- 每行只有 `/name` 加描述，没有图标，命令和技能混在一起，分不清。
- 列表倒序排列，最匹配的在最下面贴着输入框，和常见菜单的阅读方向相反。
- 选中某条命令时，列表上方还会叠一张详情卡，把内容重复一遍。
- 最大高度只有 220，skill 一多就要频繁滚动。
- 面板是一张与 Composer 分离的浮动卡片，和图 4 那种"从输入框里长出来"的整体感差很远。

输入 `@` 弹出的文件列表用的是同一个组件，同样有倒序与样式的问题。

## Solution

- Command menu 贴合 Composer 顶边：面板左右略微内缩，底部藏在 Composer 后面并渐隐，看起来像从输入框里长出来。
- 列表从上往下排，默认高亮第一项。
- 分成"命令""技能"两组，各有小标题；技能行用立方体图标，命令行用 `SquareSlash` 图标。
- 每行一行显示：图标、`/name`、弱化的描述（一行截断）、再弱一级的参数提示。
- 去掉详情卡。
- 最大高度约 300，且不超过 Composer 上方可用空间。
- `@` 文件列表换成同样的面板与行样式，保留文件 / 文件夹图标，不分组，同样从上往下排。

## User Stories

1. 作为用户，我想在 Command menu 里看到"命令"和"技能"两组，以便快速定位到 skill。
2. 作为用户，我想让技能行显示立方体图标、命令行显示斜杠图标，以便扫一眼就分清类型。
3. 作为用户，我想让列表从上往下排、第一项默认高亮，以便按正常阅读方向浏览、直接回车选第一个。
4. 作为用户，我想让描述在名字后面用弱化颜色一行显示、过长时截断，以便行高整齐、主次分明。
5. 作为用户，我想在描述后面看到更弱的参数提示（如 `<file>`），以便知道这个命令要不要带参数。
6. 作为用户，我想不再看到压在列表上方的详情卡，以便菜单干净、不重复。
7. 作为用户，我想让面板贴合 Composer 顶边、底部渐隐进输入框，以便菜单和输入框看起来是一体的。
8. 作为用户，我想在 skill 很多时面板高一些（约 300），以便少滚动。
9. 作为用户，我想在窗口很矮时面板不超出 Composer 上方可用空间，以便不被遮挡。
10. 作为用户，我想用上下方向键移动高亮、Enter 或 Tab 选中、Esc 关闭，以便全程用键盘操作。
11. 作为用户，我想在键盘移动高亮到可视区外时列表自动滚动跟上，以便高亮项始终可见。
12. 作为桌面 / 网页用户，我想在鼠标悬停时该行高亮，以便知道点下去选的是哪一项。
13. 作为用户，我想在过滤后某一组为空时不显示这个组的标题，以便不出现空分组。
14. 作为用户，我想在没有任何匹配时看到一行"没有匹配的指令"，以便知道不是卡住了。
15. 作为用户，我想让"加载中"和"发送一条消息后加载全部指令"这两行提示与新样式一致、且不可选中，以便不会误选提示行。
16. 作为用户，我想在输入 `@` 时看到同样面板和行样式的文件列表，以便两种菜单风格一致。
17. 作为手机 / 平板用户，我想得到同样分组、同样排序的菜单，行高适合手指点按，以便触屏上也好用。
18. 作为深色主题用户，我想让面板、渐隐和高亮在深色下同样协调，以便不突兀。
19. 作为使用插件主题的用户，我想让面板颜色随主题变化，以便和我的主题一致。

## Implementation Decisions

- 改造的是 Composer 专用的列表与定位组件（`Autocomplete` 与 `AutocompletePopover`），它们只被 Composer 使用；不新建组件，不另起一套菜单。
- 分组依据是 daemon 给出的 `kind`（`command` / `skill`）；客户端内置命令与插件命令归入"命令"组。组顺序：命令在上、技能在下。组内沿用现有的匹配排序。
- 去掉 `above-input` 时的倒序与"默认选最后一项""滚动到底"的行为，改为自上而下、默认第一项、滚动到顶。`@` 列表同样适用。
- 高亮：键盘与悬停共用同一个高亮状态（`useAutocomplete` 的 `onHighlight`），高亮行用 `interactionHighlight`；悬停按 `docs/hover.md`「A highlight the keyboard also moves」实现：外层 View 监听 `onPointerMove`、不处理离开，指针离开列表后高亮留在原处；原生端没有悬停。
- 滚动跟随：高亮落在某组第一行时，组标题一起滚进视野。行与标题的布局缓存绑定到选项 `kind:id` 签名，签名变化时整体重挂列表（Web 的 `onLayout` 只在尺寸变化时触发）。
- 行规格沿用 `docs/design.md` 的菜单行：桌面 30、紧凑布局 40（`MENU_ITEM_HEIGHT`），行距面板边 4，`radius.sm`。文字层级：名字 `foreground`、描述 `foregroundMuted`、参数提示 `foregroundExtraMuted`；图标 16、`foregroundMuted`。
- 组标题用 `caption` 级文字、`foregroundMuted`、`medium` 字重（`docs/design.md` §3：命名一组的文字用 medium），不可选中；提示行（加载中 / 出错 / 列表不完整 / 无匹配）同样不可选中，且不在选项里，键盘导航自然跳过它们。
- 面板外观：
  - Web / Electron 用与 Composer 相同的玻璃表面，原生用不透明 `surfaceCard`（`GLASS_SURFACES_ENABLED` 已处理）。
  - 上方两角 `radius["3xl"]`，与 Composer 一致；描边用 `borderComposer`。
  - 左右相对 Composer 内缩，内缩量与 Composer context strip 相同。
  - 面板底边伸到 Composer 顶边之下被遮住，面板内容在底部约 16 的范围内渐隐。
  - 最大高度 300，且受 Composer 上方可用空间约束；键盘弹出时跟随（现有 Reanimated 跟随逻辑保留）。
- 去掉详情卡；参数提示并入行内。
- 定位仍走现有的 Portal / floating-panel host，遵守 `docs/floating-panels.md` 的生命周期与 Android 规则。
- 不新增颜色 token；新文案进 i18n，所有现有语言补齐：组标题 `agentAutocomplete.groups.commands` / `skills`；出错行前缀 `agentAutocomplete.error`（原先硬编码 `Error:`）。无匹配沿用已有的 `agentAutocomplete.noCommands`，只把 zh-CN 改成"没有匹配的指令"，其他语言原文已是"未找到命令"。

## Testing Decisions

好的测试只看用户可见行为：看到哪些行、哪行高亮、按键后选中了什么；不断言样式数值或内部 state。

- **A3 · vitest browser 组件测试**，参照 `composer/input/text-input.web.browser.test.tsx` 与 `composer/agent-controls/thinking-slider.browser.test.tsx`，渲染 Command menu 组件并喂入混合的命令与技能：
  - 出现两个组标题，命令组在上；某组过滤后为空时标题不出现；
  - 行按自上而下顺序渲染，第一行默认高亮；
  - 方向键移动高亮、跳过提示行，Enter 选中高亮项并回调；
  - 无匹配时显示无匹配提示；加载中 / 不完整提示可见且不可选；
  - `@` 模式下不出现组标题，文件与文件夹行按顺序渲染。
- 现有 `autocomplete-utils.test.ts` 中关于倒序的断言随行为改动更新。
- 视觉（贴合、渐隐、内缩、深色）按 `docs/qa.md` 用 Electron 截图留证：浅色与深色各一张，含命令与技能两组；再附一张 `@` 列表。

## Out of Scope

- 来源徽标（个人 / 项目 / 插件）。
- 列表数据来源与加载速度（子任务 `09-28-slash-commands-first-open`）。
- 选中 skill 后变成 chip（子任务 `09-28-skill-chip`）；本子任务里选中行为保持现状，只改列表外观与顺序。
- 显示名美化（如 `codebase-design` → "Codebase Design"），名字按原样显示。

## Further Notes

- 验收：Electron 浅色 / 深色截图与图 4 形态一致；键盘全流程可用；原生端（iOS 或 Android 任选其一）截图显示分组与排序正确。
- 参考实现：t3code 的 `ComposerCommandMenu` 与 `ComposerBanner.Surface`，摘要见父任务 `research/discovery.md`。
