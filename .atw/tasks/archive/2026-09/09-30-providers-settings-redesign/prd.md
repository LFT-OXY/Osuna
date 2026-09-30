# 提供方设置页重新布局

决策来源：`research/interview.md`（三轮访谈，决定编号 1–13）。视觉基准：`prototype/providers-redesign.html`（与真实 App 一比一的原型，浅色与深色、桌面 / 窄桌面 / 手机 / composer 弹窗共 16 个画面）。取值依据：`research/ui-tokens.md`（源码 token）和 `research/screens/`（真实 App 截图与计算样式）。

## Problem Statement

设置 → 主机 → Providers 现在是一张长卡片：每行挤着图标、名称、模型数或错误原文、状态点（或「如何安装」链接）、开关、⋯ 菜单和 ›。卡片下面还有一整节「添加 Provider」，把 ACP 目录铺开，把用户已有的提供方和可以添加的提供方混在同一页。

想看某个提供方的详情，只能点开一个弹窗。弹窗里依次堆着安装指引、第三方接口和模型列表，底部栏挤着「已更新」「添加 Model」「诊断」「刷新」四样东西；「添加 Model」和「诊断」又各自再弹一层弹窗。用户想对比两个提供方，要反复开关弹窗；弹窗里叠弹窗，也不知道自己在第几层。

错误同样看不清。OpenCode 启动失败时，错误原文被截在列表行里最多 3 行，手机上干脆不显示。开关提供方失败、删除自定义提供方失败、从目录添加失败，都用系统警告框提示，而在浏览器和桌面端这个警告框什么都不做，用户根本看不到失败。

## Solution

把提供方页改成页内「列表 + 详情」：

- **桌面端（内容区够宽）**：左边是 280 宽的提供方列表，右边是选中提供方的详情，两列整体居中；详情列最大宽 720。进入页面默认选中第一个提供方，选中项写进地址。
- **窄桌面和手机**：先显示列表，点一行推入全屏详情，返回回到列表。窄桌面的页头显示「Providers / {名称}」面包屑。
- **列表**：每行只放图标、名称、一行状态（状态点加文字）和启用开关。「添加 Provider」改成列表标题右侧的「+」，点开 ACP 目录弹窗；添加成功后关闭弹窗，并选中新加的提供方。
- **详情**：
  - 头部是图标、名称、状态徽章和模型数，右侧是「刷新」和 ⋯ 菜单。菜单里有「诊断」，自定义提供方另有「Remove provider」。
  - 下面按顺序排分组卡片：错误卡（出错时）、继承第三方接口的提示（继承 Claude Code 的自定义提供方）、安装指引（未安装时）、第三方接口（Claude Code 与 Codex）、Models、诊断。
  - 添加 Model 和诊断都在页面里就地展开，页面里不再有弹窗叠弹窗。
- **composer 模型选择器的齿轮**：仍然打开弹窗，弹窗里放和设置页同一个详情组件，只换外框。
- **会失败的操作**：开关、删除、从目录添加、添加 Model、运行诊断失败时，都在出错的位置显示可见的错误，直到用户重试或关闭。

## User Stories

### 列表与选择

1. 作为桌面端用户，我想在 Providers 页左侧一直看到全部提供方，以便随时切到另一个提供方，不用关弹窗。
2. 作为桌面端用户，我想进入 Providers 页时自动选中第一个提供方，以便右侧不会空着。
3. 作为桌面端用户，我想看到当前选中的那一行被高亮，以便知道右侧详情属于哪个提供方。
4. 作为用户，我想在每一行下面看到一行状态：可用时显示模型数，第三方接口启用时显示「第三方接口：{名称}」，其余情况显示「未安装」「错误」「已禁用」「正在加载」，以便扫一眼就知道每个提供方的情况。
5. 作为用户，我想看到状态点的颜色与状态一致（可用为绿，未安装为黄，错误为红，已禁用为灰，加载中为转圈），以便不读文字也能分辨。
6. 作为用户，我想直接在列表行上启用或停用提供方，并且点开关不会顺带选中这一行，以便批量开关时视图不跳动。
7. 作为用户，我想在开关失败时，在列表里看到失败原因并能关闭这条提示，以便知道操作没有生效。
8. 作为手机用户，我想看到带 › 的列表行，点一行推入这个提供方的全屏详情，返回回到列表，以便在小屏上也能逐个查看。
9. 作为窄窗口桌面用户，我想在窗口放不下两列时自动改成「列表 → 详情」的栈式布局，并在页头看到「Providers / {名称}」，点「Providers」回到列表，以便详情不会被挤成一条。
10. 作为用户，我想把某个提供方的详情页地址收藏或分享给自己，打开后直接选中这个提供方，以便下次直达。
11. 作为用户，我想在地址里的提供方不存在，或刚删掉了当前选中的自定义提供方时，自动回到第一个提供方（栈式布局下回到列表），以便不会停在空白页。
12. 作为用户，我想在主机未连接或正在加载时，看到和现在一样的一张空状态卡，以便知道为什么没有列表。

### 添加提供方

13. 作为用户，我想在 Providers 列表标题右侧看到「+」，点开 ACP 目录弹窗，以便页面里只放我已经有的提供方。
14. 作为用户，我想在目录弹窗的头部搜索，以便在几十个 ACP 提供方里快速找到想要的那个。
15. 作为用户，我想在目录里点「添加」后，弹窗自动关闭，列表里出现并选中新加的提供方（手机上直接推入它的详情），以便马上看到它装没装、有哪些模型。
16. 作为用户，我想在添加失败时，在目录弹窗里看到失败原因，弹窗不关闭，以便重试或换一个。
17. 作为手机用户，我想让目录从屏幕底部弹出，以便单手操作。

### 详情头部与菜单

18. 作为用户，我想在详情头部看到提供方的图标、名称、状态徽章，以及可用时的模型数，以便确认自己在看哪个提供方、它是否可用。
19. 作为用户，我想点头部的「刷新」重新检测这个提供方，并在刷新期间看到进行中的状态，以便装完 CLI 或改完配置后确认结果。
20. 作为用户，我想从头部的 ⋯ 菜单选「诊断」，页面滚动到诊断节并开始运行，以便排查问题时少找一步。
21. 作为自定义提供方的使用者，我想在 ⋯ 菜单里看到「Remove provider」，确认后删除，以便清理不用的提供方。
22. 作为用户，我想在删除失败时，在详情顶部看到失败原因，以便知道提供方还在。
23. 作为手机用户，我想让「刷新」和 ⋯ 出现在顶栏右侧，以便详情页的内容区留给卡片。

### 错误与提示

24. 作为 OpenCode 出错的用户，我想在详情最上方看到一张红色错误卡，标题是「{名称} 无法启动」，下面是完整的错误原文（等宽字体），再下面是「刷新」和「运行诊断」按钮，以便看清原因并马上动手排查。
25. 作为手机用户，我想同样看到这张错误卡，以便不用切到桌面端才知道错在哪。
26. 作为继承 Claude Code 的自定义提供方的使用者，我想在 Claude Code 启用了第三方接口时，在详情里看到一张黄色提示卡，说明这个提供方也会走那个接口，并且 Claude 的 settings.json 里的 env 优先，以便理解它实际连到了哪里。

### 安装指引与第三方接口

27. 作为新手，我想在未安装的 Claude Code、Codex、Pi、Oh My Pi 的详情里看到安装指引，默认选中主机的系统，以便照着命令安装。安装指引的内容和行为与上一个任务一致。
28. 作为 Claude Code 或 Codex 用户，我想在详情里看到「第三方接口」一节，行为与现在一致：官方与每个接口各占一行，启用中的显示「使用中」，其余显示「使用」，接口行可以编辑和删除，外部改动时显示提示与「重新应用」「切回官方」。以便只换位置，不用重新学。

### Models

29. 作为用户，我想看到标题为「Models」、旁边带总数的一节，右侧是「已更新 {时间}」和「添加 Model」，以便知道列表多新、从哪里补模型。
30. 作为用户，我想在 Models 卡片顶部直接搜索，以便在几十个模型里找到某一个。
31. 作为用户，我想看到「已发现」和「自定义 Models」两组，各带数量，以便分清哪些是 CLI 报告的、哪些是我自己加的。
32. 作为用户，我想在模型名称和 id 相同时只看到一次，以便列表不重复啰嗦。
33. 作为用户，我想点「添加 Model」后，卡片里就地展开一行输入框，自动聚焦，按回车或点「添加」提交，按 Esc 或点「取消」收起，以便不用再开一层弹窗。
34. 作为用户，我想在添加 Model 的过程中看到进行中的状态，失败时在输入行下方看到原因，成功后输入行收起、新模型出现在「自定义 Models」里，以便知道结果。
35. 作为用户，我想在自定义模型行的末尾删除它，以便清理手动加错的 id。
36. 作为用户，我想在没有检测到模型时看到「未检测到 Model」，在提供方已禁用时看到「已禁用。启用后 Osuna 才会检测它的 Models。」，以便知道为什么是空的。
37. 作为用户，我想在提供方启动失败、没有模型时，看到 Models 区说明「启动失败，没有检测到 Models。」，原因和「刷新」「运行诊断」在顶部的错误卡里，以便同一个错误只出现一次。

### 诊断

38. 作为用户，我想在详情最底部看到「诊断」一节，说明它会检查什么，并有「运行诊断」按钮，以便需要时再运行，不打扰平时浏览。
39. 作为用户，我想在诊断运行期间看到「正在运行诊断...」，完成后在等宽代码面里看到完整输出，节标题右侧有运行时间、复制和重新运行，以便把结果贴给别人或再跑一次。
40. 作为用户，我想在诊断失败时看到「获取诊断失败」和原因，并能重试，以便知道不是没有输出而是出了错。

### composer 入口

41. 作为正在对话的用户，我想从模型选择器的齿轮打开当前提供方的详情弹窗，里面和设置页的详情一样，以便不离开工作区就能看模型、切第三方接口、补模型。
42. 作为这个弹窗的使用者，我想在弹窗头部看到名称、状态徽章、「刷新」和 ⋯，内容区是同样的分组卡片，以便两处用法一致。

### 外观与语言

43. 作为用户，我想让新页面在浅色和深色主题下都与设置页其他部分一致（卡片、行高、开关、按钮、弹窗玻璃效果），以便看不出是后加的。
44. 作为用户，我想让新增的文案使用我设置的语言，以便界面不混杂。

## Implementation Decisions

### 范围与兼容

- 只重排现有能力，也就是列表、启停、删除、ACP 目录、安装指引、第三方接口、模型、添加和删除自定义模型、诊断。不改 daemon，不改协议，不新增 RPC，也不新增能力门控。原有的门控（`providerRemoval`、`apiEndpoints`）照旧生效。
- 不做的能力见 Out of Scope。原型里也没有给它们占位。

### 路由

- 新增设置子路由「主机 / Providers / {provider}」，照搬项目页「项目列表 / 项目详情」的做法。它是和主机分区路由并列的独立路由名，不合并成 catch-all，也不用 `getId` 或 `dangerouslySingular` 之类的变通（`docs/expo-router.md` 中「Settings detail routes are separate siblings」一节）。动手前先读 `docs/expo-router.md` 全文。
- 宽屏（两列）：进入 Providers 分区时 redirect 到第一个提供方的子路由。点列表行用 replace 切换选中项，不在返回栈里堆积。
- 栈式（窄桌面与手机）：Providers 分区显示列表，点行用 push 进入子路由，返回回到列表。
- 地址里的提供方不存在时，宽屏 redirect 到第一个提供方，栈式回到列表。刚删掉当前选中的自定义提供方时同样处理。
- 选中项不再经过全局的 provider-settings store；这个 store 只留给 composer 齿轮入口。
- 路由是 `providers/index` 与 `providers/[provider]` 两个 sibling，照搬 `projects/index` 与 `projects/[projectId]`；`providers/index` 取代 `[hostSection]` 对 `providers` 的匹配。
- 栈式下地址的判定是纯函数 `resolveStackedProvidersView`（list / detail / missing）：列表未到或主机未连接时一律按列表处理，不判定地址。页头（窄桌面面包屑、手机 BackHeader）与正文经 `useStackedProvidersView` 共用这一判定；正文不是详情时页头退回分区标题。
- 两种布局的地址修正（宽屏 replace 到第一个、栈式回到列表）只在聚焦页执行：Stack 下层被盖住的设置页仍然挂载。
- 面包屑的「Providers」和手机返回都走 `returnFromSettings` → `dismissTo(Providers 分区)`；宽屏进入时地址是 replace 进来的，返回栈里可能没有分区页，此时 `dismissTo` 按 expo-router 的约定改为 replace。

### 布局判定

- 用一个纯函数，由内容区宽度决定「两列」还是「栈式」：内容区宽度 ≥ 16 + 280 + 24 + 400 + 16 = 736 时两列，否则栈式。紧凑判定（`useIsCompactFormFactor`）为真时一律栈式。
- 内容区宽度是设置详情区的实测宽度（`onLayout`），不能用「窗口宽 − 设置侧栏」估算：桌面端应用侧栏可以和设置页并排。量到之前不判定布局，页面不渲染、也不 redirect。
- 两列容器最大宽 1056（左右 padding 16、列表 280、间距 24、详情最大 720），在内容区里居中。Web 上列表列 sticky，跟着页面滚动时停在顶部；原生平板的两列不 sticky（`_web` 样式）。
- 这是 `docs/design.md` §7「设置详情页最大宽 720」的例外，也是 §9 列表+详情模式在设置页内部的一个用法。实现时改写 `docs/design.md` 对应段落，不新开 ADR：它可以低成本改回，不满足 ADR 的三个条件。

### 列表

- 保留 SettingsSection 「Providers」和卡片。标题右侧 trailing 放 ghost 仅图标按钮 `Plus`，无障碍名称是「添加 Provider」。
- 行用 `settingsStyles.row`（最小高 56）：
  - 左侧依次是 28 的图标框、名称（`rowTitle`）、状态行（6 的状态点，间距 6，caption muted 文字）；
  - 右侧是 Switch，栈式下 Switch 后面再跟 ›。
- 选中行底色用 surface2，与悬停相同。原因：用 surface3 会和关闭状态的开关轨道同色，看不出开关。
- 状态行与详情头部徽章共用 `provider-detail/status.ts` 的判定，它是纯模块，返回 `{ key, params }` 文案描述，由组件经 `t` 渲染。
- 状态行规则（来自原型，按顺序判断，第一条命中即用）：

  | 条件 | 状态点 | 文字 |
  |---|---|---|
  | 已停用 | muted | 已禁用 |
  | 正在加载 | 转圈 | 正在加载 |
  | 出错 | danger | 错误 |
  | 可用且第三方接口启用中 | success | 第三方接口：{接口名} |
  | 可用 | success | {N} 个 Model |
  | 其他（未安装） | warning | 未安装 |

  模型数按现有规则只算可选模型。
- 从行里移除：错误原文、继承接口提示（移到详情）、「如何安装」链接、⋯ 菜单。
- 移除整节「添加 Provider」。
- 列表操作失败（开关）时，在卡片顶部插一行错误：caption statusDanger 显示原因，右侧 ghost「关闭」。样式照搬第三方接口区的 actionError 行，只有原因一行，不加标题。发起下一次开关时清掉。不再使用 `Alert.alert`。

### 详情组件

- 设置页两列、栈式详情页、composer 弹窗三处共用同一个详情组件。组件只接收 host 与 provider，外框由调用方决定：
  - 模块是 `packages/app/src/provider-detail/`：`index.tsx` 的 `ProviderDetailSurface` 只收 props，决定显示哪些区块；`view.tsx` 的 `ProviderDetail` 接快照、配置和主机能力。安装指引与第三方接口的运行时视图在 unit 运行器里无法加载，由 view 经 `renderInstallGuide` / `renderApiEndpoints` 插槽注入（工单 01）。
  - 页面外框：渲染头部块。头部块是 40 的图标框（圆角 10），名称用 title-sm，下面一行是 StatusBadge 加「{N} 个 Model」，右侧是 secondary sm「刷新」和 28 的 ⋯ 按钮。
  - 紧凑页面：「刷新」和 ⋯ 放到 BackHeader 右侧，改成仅图标按钮；页内头部块只保留图标、名称、徽章和模型数。头部块的操作区是 `renderActions` 插槽，手机上不传。
  - 弹窗外框：图标、名称、徽章、「刷新」、⋯ 放进弹窗头部（见「composer 齿轮入口」）。
- 区块顺序固定：错误卡 → 继承接口提示 → 安装指引 → 第三方接口 → Models → 诊断。每块是一个 SettingsSection，Alert 类区块除外。块与块之间保留 SettingsSection 默认的 24 间距。
- **错误卡**：Alert error。标题「{名称} 无法启动」（新增），下面是 daemon 返回的错误原文，等宽、可选中；再下面是 outline「刷新」和 outline「运行诊断」（`settings.providers.diagnostic.run`，05 新增，07 的诊断节复用）。仅在已启用且出错时显示。
  - 原文和按钮一起放在 Alert 的 children 里：`description` 只收字符串，用 `useMemo` 包 JSX 能躲过 lint，但仍是 JSX 经 prop 传递。
- **继承接口提示**：Alert warning。把现有 `inheritedNote` 拆成标题「也会走 Claude Code 启用的第三方接口 {名称}」和描述「Claude 的 settings.json 里的 env 优先于这个提供方的环境变量。」，两条都是新文案，取代原来的 `inheritedNote`。显示条件不变。
- **安装指引**、**第三方接口**：沿用现有组件和行为，只是从弹窗搬进详情。第三方接口的新建和编辑表单仍然是 AdaptiveModalSheet（多字段表单，按 `docs/design.md` §6 属于弹窗）。
- **Models**：
  - 模块是 `provider-detail/models.tsx` 的 `ProviderModelsSection`。搜索词和添加行是它自己的 state，详情按提供方给它加 key，换提供方时一起清掉；弹窗头部不再传查询进来。
  - 节标题「Models」（新增）后面跟总数（extra-muted，经 `SettingsSection` 的 `count`）；trailing 是 caption muted「已更新 {时间}」（每 10 秒重算）和 ghost「添加 Model」。
  - 卡片内依次是：搜索行（`Search` 16 加无边框输入，占位「搜索 Models」，有模型时才显示）→ 添加行（展开时）→「已发现 N」组 →「自定义 Models N」组。组标题行是 caption、medium、muted，数量右对齐。
  - 模型行沿用现有样式：名称 14、mono id 12、描述 12，单行省略。名称与 id 相同时只显示名称（新规则）。自定义模型行末尾是删除按钮。
  - 没有模型时按顺序判断：已禁用 →「已禁用。启用后 Osuna 才会检测它的 Models。」（新增）；加载中 → spinner 加「正在加载 Models...」；出错 →「启动失败，没有检测到 Models。」（新增 `models.startFailed`）；其余 →「未检测到 Model」。搜索无匹配沿用原文案。添加行展开时卡片里只放添加行，不放空状态。
  - 出错时 Models 区不再重复错误原文和「重试」：原文和「刷新」「运行诊断」只在顶部错误卡里（工单 06 的决定，用户确认）。`models.retry` / `models.retrying` 随之删除。
  - 原弹窗头部的搜索、底部栏、「添加自定义 Model」子弹窗全部移除。
- **添加 Model（就地）**：
  - 展开后一行是 FormTextInput sm（自动聚焦，占位沿用「例如 openai/gpt-5」）、default sm「添加」、ghost「取消」；回车提交，Esc 收起。
  - 提交中按钮显示「正在添加...」并禁用。
  - 失败时在输入行下方显示 caption statusDanger「保存 Model 失败」加原因，输入保留。
  - 成功后收起，并刷新该提供方。成功的判定是配置写入成功；刷新不阻塞收起，新模型经配置先出现在「自定义 Models」里。
  - 空 id 或已在自定义 Models 里的 id 不提交（「添加」禁用，回车无效）。
  - 已知限制：桌面端 composer 弹窗在 window 捕获阶段接管 Esc（`lib/overlay-root.ts`），输入框收不到，按 Esc 会关掉整个弹窗；设置页和手机上 Esc 收起添加行。
  - 写入方式沿用现有 `additionalModels` 配置补丁。
- **诊断（就地）**：
  - 未运行时是一行卡片：左侧说明「查看 {名称} 的命令来源、解析路径、版本和可用状态。」（新增），右侧 outline「运行诊断」（新增，带 `FileText` 图标）。
  - 运行中显示「正在运行诊断...」。
  - 完成后显示 ScrollableCodeSurface（等宽 12/18，横向滚动，不折行）；节标题 trailing 是运行时间（time-ago）、复制和重新运行两个仅图标按钮。
  - 失败时显示「获取诊断失败」加原因和重试（outline「重试」，`common.actions.retry`）。原因为空时显示「未知错误」；主机没有连接也走失败态，不静默。
  - 输出为空时显示「没有可用诊断」，trailing 只留时间和重新运行，不给复制。
  - 重新运行时输出换成「正在运行诊断...」，不保留旧输出。
  - 复制与重新运行是 ghost sm 仅图标 `Button`（`Copy`、`RotateCw`），不手工画 Pressable。复制成功 toast「已复制 诊断」，失败 toast「复制诊断失败」。
  - ⋯ 菜单里的「诊断」和错误卡的「运行诊断」滚动到这一节并触发运行；诊断节自己的「运行诊断」「重新运行」「重试」只运行、不滚动。
  - 原「诊断」子弹窗移除，composer 弹窗的底部栏一并移除。08 之前 composer 弹窗没有独立的「刷新」（错误卡里仍有），07 与 08 一起交付。
  - 状态在 `provider-detail/diagnostic.ts`：按主机加提供方分键的 store，`idle | running | ready{output, ranAt} | failed{message}`，同一提供方同时只跑一次。手机上 ⋯ 在顶栏、诊断节在正文，两处不在同一棵组件树，所以和删除状态一样不用组件 state。结果留在 store 里：离开详情再回来、或在 composer 弹窗里看同一个提供方，都显示上次结果和运行时间。
  - 「滚到这一节」是同一 store 里的请求计数 `reveals`：入口每点一次加一，诊断节看到计数变化（挂载时的值不算）就把自己滚进视野。滚动在「运行中」那一刻发生，此时诊断节只有一行，页面可能滚到底，输出到达后向下增长。
  - 滚动只在 Web（含 Electron）：`provider-detail/reveal.web.ts` 找最近的可滚动祖先改 `scrollTop`（不用 `scrollIntoView`，它会连带滚动外层容器）。原生端 `reveal.ts` 不滚动：拿不到设置页外层 ScrollView 的 ref。诊断照常运行，用户自己下滑看结果（用户确认的取舍）。
  - 入口的接线是 `provider-detail/view.tsx` 的 `useProviderDiagnosticActions(serverId, provider)`，返回 `run`（就地运行）和 `diagnose`（滚动加运行）；页内头部块、手机顶栏、详情内容三处共用。
- **⋯ 菜单**：DropdownMenu，align end，宽 220。菜单项是「诊断」（`FileText`）；自定义提供方且主机支持 `providerRemoval` 时，加分隔线和 destructive「Remove provider」（`Trash2`）。删除仍走现有 `confirmDialog`；失败时在详情顶部显示 Alert error，不再用 `Alert.alert`。
  - 组件是 `provider-detail/header.tsx` 的 `ProviderDetailMenu`，收 `providerSource` 和 `hostSupportsRemoval`，自己判定有没有删除项；`placement` 区分页内头部块（28 的按钮）和手机顶栏（顶栏图标按钮尺寸）。
  - 删除状态在 `provider-detail/removal.ts`：按主机加提供方分键的 store，`idle | removing | failed`。手机上 ⋯ 在顶栏、失败提示在正文，两处不在同一棵组件树，所以不用组件 state。确认框弹出期间就是 `removing`，菜单项显示「正在删除...」。
  - 删除失败的 Alert 标题复用 `settings.providers.remove.errorTitle`，描述是原因，带 outline「关闭」；重试删除时也清掉。删除成功后提供方从快照消失，由页面的地址修正回到第一个提供方或列表；composer 弹窗里删除成功则关闭弹窗（见「composer 齿轮入口」）。
  - 「诊断」和错误卡的「运行诊断」走 `useProviderDiagnosticActions` 的 `diagnose`，见上面「诊断（就地）」。`DiagnosticSubSheet` 已删除。

### ACP 目录弹窗

- 用 AdaptiveModalSheet（桌面居中卡片宽 520，紧凑是底部 sheet），标题沿用 `providerCatalog.title`，搜索放在弹窗头部，占位「搜索 providers」。内容是现有目录列表的行，目录列表原来自带的搜索框改为读取弹窗头部的查询。
- 添加进行中沿用「正在添加」加 spinner。成功后关闭弹窗，并导航到新提供方的子路由（宽屏 replace，栈式 push）。失败时在弹窗内容顶部显示可见错误，弹窗不关闭。
- 弹窗是 `screens/settings/provider-catalog-dialog.tsx` 的 `ProviderCatalogDialog`，自己持有配置写入和快照刷新；列表只管开关弹窗，`onAdded` 里关弹窗再走 `onSelectProvider`。「+」和弹窗只在主机已连接时出现，与原来整节的显示条件一致。
- 错误是 Alert error：标题复用 `settings.providers.addErrorTitle`，描述是错误原文。重试或关闭弹窗时清掉。
- 添加成功的判定是配置写入成功。导航前先等快照刷新，让新提供方先进列表，否则两种布局的地址修正会把它当成不存在的提供方；刷新失败不算添加失败，照常关闭并导航，列表随 daemon 的快照推送补上。
- 添加进行中关掉弹窗，丢弃这次的结果：不导航，也不把错误留给下次打开。

### composer 齿轮入口

- 全局 provider settings 宿主保留，测试 id `provider-settings-sheet` 不变；弹窗内容换成详情组件的弹窗外框，desktopMaxWidth 640。
- 弹窗头部（`components/provider-diagnostic-sheet.tsx`）：
  - `leading` 是 28 的图标框（`ProviderIconFrame size="sm"`，样式复用 `settingsStyles.rowIconFrame`）；
  - 标题是名称，徽章经 `SheetHeader.titleAccessory` 紧跟在标题同一行（`subtitle` 会另起一行，和原型不符）；
  - `actions` 是 `provider-detail/view.tsx` 的 `ProviderDetailActions`（「刷新」加 ⋯），设置页头部块也用它；
  - 头部不显示模型数，与原型一致。
- 紧凑（底部 sheet）下「刷新」改为 ghost sm 仅图标按钮（无障碍名称仍是「刷新」）：390 宽时文字按钮会把名称挤成省略号。这与紧凑页面顶栏改仅图标的做法一致。
- 弹窗内容 `contentStyle` 设 gap 0、paddingBottom 0：区块自带 24 的下边距，不再叠加 sheet 默认的 16 间距；最后一块的下边距充当底部留白。
- 删除（用户确认的两条）：
  - 删除失败的提示按主机加提供方共享，设置页留下的失败提示在弹窗里也显示，任一处关闭或重试都会清掉。
  - 删除成功后关闭弹窗，回到模型选择器。`useProviderDetailHeader(serverId, provider, { onRemoved })` 在写入成功后调用 `onRemoved`；宿主经 store 的 `closeIfShowing({ serverId, provider })` 只关仍在显示的同一个提供方，删除期间换开了别的提供方时不关。
- 原来叠在它上面的两个子弹窗（添加 Model、诊断）随就地展开一并移除。第三方接口表单仍然叠在它上面，这是 §6 允许的多字段表单。
- 测试：`provider-settings-refresh.spec.ts` 断言头部「刷新」和 ⋯、⋯「诊断」后输出进入视口、没有子弹窗（桌面与手机视口各一条）；`closeIfShowing` 在 `provider-settings-store.test.ts` 覆盖。弹窗内的删除没有 e2e：mock 提供方不是自定义提供方，删除路径由 `provider-removal.spec.ts`（设置页）和 `removal.test.ts` 覆盖。

### 视觉

- 遵循 `docs/design.md`，全部复用现有组件和 token：SettingsSection、settingsStyles、Switch、Button 的 default/secondary/outline/ghost、StatusBadge、Alert、SegmentedControl、FormTextInput、DropdownMenu、AdaptiveModalSheet、ScrollableCodeSurface。不新增设计 token。
- 数值以 `research/ui-tokens.md` 和原型为准。原型里的 CSS 只作视觉参照，不要照搬进代码。
- 提供方图标用 `resolveProviderGlyph({ tone: "brand" })`，与 Composer 工具栏和模型列表一致（验收时用户决定，原型画的是单色）：有彩色 SVG 的用彩色版（Codex、Oh My Pi，及目录里的 Kimi、Kiro、MiniMax、Gemini），有品牌色的用单色加品牌色（Claude `#d97757`），其余是前景色单色。列表行、详情头部和 composer 弹窗头部共用 `provider-detail/icon-frame.tsx` 的 `ProviderIconFrame`。

### 文案

- 新增的键：
  - 「Models」节标题；
  - 状态行「第三方接口：{名称}」；
  - 错误卡标题「{名称} 无法启动」；
  - Models 区出错时的空状态「启动失败，没有检测到 Models。」；
  - 继承提示的标题和描述（取代 `inheritedNote`）；
  - 已禁用时的空状态；
  - 诊断节说明和「运行诊断」；
  - 「添加 Provider」按钮的无障碍名称（复用 `settings.providers.addProvider`）；
  - 列表错误行的「关闭」（复用 `common.actions.dismiss`）。
- 写在 `en.ts`，其余 8 种语言同步补齐。
- 这次改动之后不再被引用的键一并删除，只删因本次改动变成孤儿的：「如何安装」入口的两个键、`inheritedNote`、子弹窗专用的标题等。实现时以代码引用为准核对。07 新增 `diagnostic.description`，删了 `diagnostic.button`、`diagnostic.refreshingAccessibility`。06 删了 `models.addCustomTitle`、`models.modelId`、`models.retry`、`models.retrying`。05 已删 `install.howTo`、`install.howToFor`、`apiEndpoints.inheritedNote`、`updateErrorTitle`，以及只剩测试在用的 `hasProviderInstallGuide`。09 按「任务开始前（a9e5781a6）有字面引用、现在没有」比对 en.ts 全部键，本任务没有留下新的孤儿；en.ts 里另有 5 个无引用键（`modelSelector.defaultModel`、`modelSelector.editProfiles`、`providerCatalog.actions.installed`、`providerCatalog.actions.cancel`、`providerCatalog.errors.unableToInstall`）在任务开始前就没人用，不属于本任务，未删。

## Testing Decisions

- 好的测试只断言外部可见的行为，比如显示哪几块、点了之后出现什么、失败时用户看到什么，不断言组件层级和样式细节（`docs/testing.md`）。
- **测试接缝**（尽量少，优先用已有的）：
  1. **列表组件测试**，扩展现有的提供方列表 jsdom 测试：
     - 每种状态的状态行文字和状态点；
     - 第三方接口启用时显示接口名；
     - 点开关不触发选中；
     - 开关失败时出现错误行、能关闭；
     - 「+」打开目录；
     - 行里不再出现「如何安装」和 ⋯。
  2. **详情组件测试**（`provider-detail/index.test.tsx`，测 `ProviderDetailSurface`；先例是安装指引和第三方接口的 jsdom 入口测试）：
     - 各状态下显示哪些区块、顺序如何（出错、未安装、已禁用、第三方接口启用、继承 Claude Code）；
     - ⋯ 菜单项按自定义与否变化；
     - 菜单「诊断」触发运行；
     - 添加 Model 的提交中、成功、失败；
     - 诊断的未运行、运行中、成功（复制的就是显示的输出）、空输出、失败；
     - 删除失败时顶部出现错误；
     - 名称与 id 相同的模型只显示一次。
  3. **纯函数单测**：布局判定（宽度 → 两列或栈式，含 736 边界和紧凑优先）；选中项解析（地址里的 provider 存在、不存在、列表为空）。
  4. **浏览器 e2e**（Playwright，真实 daemon）：
     - 更新受影响的四个 spec：ACP 目录添加改走「+」弹窗；删除改走详情 ⋯ 菜单；设置页 Providers 卡片断言；composer 齿轮弹窗（`provider-settings-sheet` 不变，确认不再有子弹窗）。
     - 新增一条宽屏选择和深链：点行后地址变化、直接打开子路由会选中对应提供方。
     - 新增一条手机推入和返回。
     - 宽屏和手机各一步：⋯「诊断」后诊断输出出现在视口里（`settings-providers-split.spec.ts`），覆盖 Web 的滚动和手机顶栏到正文的跨树传递。
     - 会失败的操作按 `docs/testing.md` 各补一条失败路径的可见断言；无法用真实 daemon 稳定造出失败的，在组件测试里覆盖，并在测试旁注明原因。
- 只运行改动涉及的测试文件，不跑整个套件；全量交给 CI。
- 截图验收按 `docs/qa.md`：桌面端（Electron）宽屏、窄窗栈式、composer 弹窗，浅色和深色，和原型逐屏对照。原生端按项目惯例注明免验收。截图、差异说明、受影响 e2e 与单测的运行输出记在 `qa/README.md`。

## Out of Scope

- CLI 版本号和「可更新」提示、认证状态和账号套餐、模型显示或隐藏（含「全部隐藏 / 全部显示」）、在界面里编辑可执行文件路径 / 环境变量 / 启动参数 / 显示名称。以上都需要 daemon 或协议改动，另开任务。
- 第三方接口的新建和编辑表单本身，以及它的确认框。
- ACP 目录的数据和安装逻辑。
- 安装指引的命令内容。
- 模型选择器（composer 里的 model browser）本身的布局，只改它的齿轮打开的内容。
- 主机选择、其他设置分区的布局。

## Acceptance Criteria

- [x] 桌面端宽窗口下，Providers 页左边是列表、右边是详情，进入页面默认选中第一个提供方，地址指向它的子路由；点其他行切换详情和地址，返回键不会逐个回退选中项。
- [x] 直接打开某个提供方的子路由会选中它；地址里的提供方不存在时回到第一个提供方（栈式下回到列表）。
- [x] 内容区放不下两列时（窄桌面）改为「列表 → 详情」栈式，页头显示「Providers / {名称}」，点「Providers」回到列表；手机上点行推入全屏详情，返回回到列表。
- [x] 列表行只有图标、名称、状态行和开关（栈式另有 ›），状态行符合规则表；点开关不改变选中项；开关失败时列表里出现可关闭的错误行。
- [x] 「添加 Provider」整节消失；列表标题右侧的「+」打开 ACP 目录弹窗；添加成功后弹窗关闭，并选中新提供方；添加失败时弹窗内显示错误、不关闭。
- [x] 详情区块按「错误卡 → 继承接口提示 → 安装指引 → 第三方接口 → Models → 诊断」出现，各自只在规定的条件下显示；安装指引和第三方接口的行为与改动前一致。
- [x] ⋯ 菜单有「诊断」；自定义提供方（且主机支持删除）另有「Remove provider」。删除确认后提供方消失，并按规则回到第一个；删除失败时详情顶部显示错误。
- [x] 添加 Model 和诊断都在页面里就地展开，提交中、成功、失败三种状态都能在原位看到；设置页和 composer 弹窗里都不再有子弹窗。
- [x] composer 模型选择器的齿轮打开的弹窗显示同一套详情区块，头部有名称、徽章、「刷新」和 ⋯。
- [x] 提供方设置相关的界面里不再调用 `Alert.alert`。
- [x] 新增文案 9 种语言齐全，本次改动产生的孤儿键已删除，i18n 一致性测试通过。
- [x] `docs/design.md` 的 §7 / §9 写明这一页的宽度例外和两列 / 栈式的切换条件。
- [x] 列表与详情的组件测试、布局与选中项的纯函数单测、受影响和新增的浏览器 e2e 都通过；`npm run typecheck` 和 `npm run lint` 通过。
- [x] 桌面端宽屏、窄窗、composer 弹窗在浅色和深色下都有截图，并与原型逐屏对照；原生端注明免验收。

## Further Notes

- 以下 4 处是做原型时定下的，用户确认原型时一并认可：
  - 选中行用 surface2；
  - 名称与 id 相同只显示一次；
  - 新增的几条文案；
  - `inheritedNote` 拆成标题加描述。
- 宽屏下点行用 replace、栈式用 push，这是写规格时补的默认做法：宽屏切换选中项更像切标签，不应该让返回键逐个回退。
- 开关、删除、添加失败改为界面内可见的错误，是 `docs/testing.md`「Fallible user actions」的要求；现有实现用 `Alert.alert`，它在 RN Web 上什么都不做，所以浏览器和桌面端过去看不到这些失败。
- 原型的截图基准和取值方法见 `research/`；原型源码在 `prototype/src/`，`prototype/build.py` 合成单文件，`prototype/tools/` 是截图和交互检查脚本（要复制到 `packages/app` 下才能解析 playwright）。
