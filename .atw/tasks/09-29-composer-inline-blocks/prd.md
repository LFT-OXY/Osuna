# 输入框行内块：Skill block、File mention、Agent mention

本任务是 `09-29-multi-agent-collab` 的前置任务。术语见 `docs/glossary.md` 的 **Inline block**、**Skill block**、**File mention**、**Agent mention**、**Attachment tray**；决策见 `docs/adr/0005-inline-blocks-live-in-message-text.md`、`docs/adr/0002-rename-stops-at-app-identity.md`。调研：`research/composer-current-state.md`、`research/editor-libraries.md`、`research/reference-projects.md`。

## Problem Statement

从 Command menu 选中的 skill 现在是 Attachment tray 里的 Skill chip，从 `@` 列表选中的文件只是插入一段带引号的路径文字：

- Skill chip 和正文分在两处，看不出它和正文的关系；
- 文件引用混在正文里，看不出是一个被引用的文件还是自己打的字，也分不清文件和目录；
- 即将加入的 Agent mention 需要保留位置——"@Claude 写实现，@Claude 写测试"必须看得出哪段话对应哪个智能体，放进托盘就丢了位置；
- 发出去以后，用户气泡是纯文字，看不出当时引用了什么。

## Solution

- 从 Command menu 选中的 skill、从 `@` 列表选中的文件、目录、图片（以及后续 multi-agent 任务加入的智能体）都在输入框正文里显示为 **Inline block**：线性单色类型图标 + 名字，accent 色文字，无底色无描边（参考 Codex 与 codeg 的样式）。
- 块是原子的：光标只停在块前后，退格整块删除。
- Skill block 固定在正文开头；File mention 与 Agent mention 留在选中时的位置。
- 发送时块变回普通文字：Skill block 是开头的 `/name`，File mention 是 Markdown 链接 `[basename](相对路径)`，目录的链接目标以 `/` 结尾，Agent mention 是 `[@名字](paseo://agent/<provider 或 profile>)`。daemon 与协议不改。
- 用户气泡和 Queue track 的排队行从文本里认出这些写法，显示成同样的块；刷新、重载、从 provider 历史导入的会话都一样。
- 粘贴或拖拽进来的图片、文件仍在 Attachment tray，不变成块。
- 输入框里的块只在 Web 与 Electron 上做（ADR 0002：Osuna 不发布手机包）；原生端输入框保持文字输入，但气泡与 Queue track 同样显示块。

## User Stories

1. 作为用户，我想在 Command menu 里选中 skill 后，正文里出现一个带立方体图标的 Skill block，以便清楚知道自己调用了哪个 skill。
2. 作为用户，我想让 Skill block 显示 skill 的原始名，以便和我手打的名字一致。
3. 作为用户，我想在正文中间输入 `/xxx` 选中 skill 时，块出现在正文开头、`/xxx` 从原处消失、光标留在原处，以便接着写正文，同时 skill 仍对 agent 生效。
4. 作为用户，我想连续选多个 skill，它们按选中顺序排在开头，以便一次调用多个 skill。
5. 作为用户，我想重复选中同一个 skill 时不出现第二个块，以便不会发出重复指令。
6. 作为用户，我想光标不能移到开头 Skill block 的前面，以便不会在 skill 前面写出正文而让 skill 失效。
7. 作为用户，我想在 `@` 列表里选中文件后，正文当前位置出现一个带文件图标、显示文件名的 File mention，以便一眼认出这是被引用的文件。
8. 作为用户，我想选中目录时块用文件夹图标，以便区分目录和文件。
9. 作为用户，我想选中图片文件时块用图片图标，以便知道引用的是图片，同时明白它只是路径引用，图片内容不会发出去。
10. 作为桌面 / 网页用户，我想悬停 File mention 时看到它的相对路径，以便区分同名文件。
11. 作为桌面 / 网页用户，我想悬停 Skill block 时看到 skill 的全名与描述，以便确认它是做什么的。
12. 作为用户，我想选中块后自动补一个空格、光标停在块后，以便直接接着打字。
13. 作为用户，我想用方向键移动光标时整块跳过，以便光标永远不会停在块中间。
14. 作为用户，我想光标紧跟在块后按退格时整块删除，以便一键撤回引用。
15. 作为用户，我想选区覆盖了半个块时，删除或输入会把整块一起替换，以便不会留下半截块。
16. 作为用户，我想手打的 `/name`、`@path`、`[x](path)` 在输入框里保持文字，以便不会出现意外的转换。
17. 作为用户，我想粘贴外部文字时不会转成块，以便粘贴结果和剪贴板内容一致。
18. 作为用户，我想在输入框内部复制粘贴一段含块的内容时块仍是块，以便调整句子顺序时不丢引用。
19. 作为用户，我想粘贴或拖拽进来的图片、文件仍然出现在 Attachment tray，以便真正随消息发送的内容和引用分开。
20. 作为用户，我想在 Command menu 里选中命令（不是 skill）时照旧插入文字，以便带参数的命令能接着输入参数。
21. 作为用户，我想有 Skill block 时正文里的 `/clear` 之类客户端命令不会被立即执行，以便不会误触发清空或退出。
22. 作为用户，我想只有块、没写正文时也能发送，以便直接触发 skill 或引用文件。
23. 作为用户，我想 agent 收到的消息和我不用块手写的效果一致（开头 `/a /b`，文件是链接），以便 skill 展开与文件读取照常工作。
24. 作为用户，我想发送后用户气泡里同样显示这些块，以便回看时知道当时引用了什么。
25. 作为用户，我想刷新页面、重启 App、切换设备后气泡仍显示块，以便历史消息不会退化成链接文字。
26. 作为用户，我想从 provider 历史导入的会话里，气泡同样认出 skill、文件、智能体并显示成块，以便导入的会话和原生会话看起来一样。
27. 作为用户，我想在气泡里手打的开头 `/skill` 也显示成块（只要它是该 agent 的 skill），以便气泡如实反映 agent 实际收到的调用。
28. 作为用户，我想 agent 的 skill 列表拿不到时，开头的 `/name` 显示为文字，以便命令不会被误显示成 skill。
29. 作为用户，我想功能上线前的旧消息照旧显示，以便旧消息不出现错误的块。
30. 作为用户，我想气泡上的复制按钮复制的是实际发出的原始文本，以便复制结果可以原样再发。
31. 作为用户，我想 Queue track 里的排队消息显示成块，以便排队时也能看清每条消息引用了什么。
32. 作为用户，我想编辑排队消息时，内容回到输入框后块仍是块，以便修改时不丢引用。
33. 作为用户，我想发送失败时正文与块原样恢复，以便重发时不必重新选。
34. 作为用户，我想 Rewind 把消息放回输入框时块仍是块，以便修改后重发。
35. 作为用户，我想含块的草稿在切换 tab、切换工作区、重启 App 后仍在，并且手打的文字恢复后仍是文字，以便草稿与离开时一致。
36. 作为 Skill chip 的老用户，我想升级前保存在草稿里的 Skill chip 升级后变成开头的 Skill block，以便未发出的草稿不丢 skill。
37. 作为用户，我想切换 provider 或模型后块仍保留，以便不用重新选。
38. 作为用户，我想文件名很长时块截断显示，以便一行放得下。
39. 作为深色主题与插件主题用户，我想块的颜色随主题 accent 变化，以便与主题协调。
40. 作为中文用户，我想用输入法组字时 `@` 与 `/` 的触发、块的插入都正常，以便中文输入不出错。
41. 作为用户，我想 Enter 发送、Shift+Enter 换行、Command menu 与 `@` 列表的键盘导航、语音输入、输入框随内容长高等现有行为不变，以便换编辑器后操作习惯不受影响。
42. 作为用户，我想在 agent 面板、草稿 tab、新建工作区页、工作区设置弹窗里的输入框都能使用块，以便各处行为一致。
43. 作为手机浏览器用户，我想在网页版里同样使用块，以便手机网页与桌面网页一致。
44. 作为原生 App 用户，我想从 Command menu 选 skill 时在正文开头插入 `/name `、从 `@` 列表选文件时插入链接文字，以便原生端发出的消息与桌面端一致。
45. 作为原生 App 用户，我想气泡与 Queue track 同样显示块，以便在手机上回看历史时也能看清引用。
46. 作为使用读屏的用户，我想块读作"Skill：名字""文件：名字""文件夹：名字""图片：名字""智能体：名字"，以便无障碍可用。
47. 作为后续 multi-agent 功能的开发者，我想 Agent mention 的块类型、链接格式、解析、渲染与编辑器节点已经就绪，以便只需加上 `@` 智能体分组与派发。

## Implementation Decisions

### 块模型与编解码（新深模块，替换 Skill chip 纯逻辑模块）

- 块的种类：`skill`（name、description?）、`file`（path、entryKind：`file` | `directory`）、`agent`（provider 或 profile 标识、显示名）。图片不是独立种类，是 `file` 按扩展名显示图片图标。
- 输入框内容的结构是分段列表：文字段与块段交替。发送、气泡、排队、草稿都以这个结构为界面。
- 序列化：
  - Skill block 按顺序拼成开头的 `/a /b`，与正文之间一个空格；只有块时就是块串。正文开头的换行保留，只去掉正文开头的空格与末尾空白。
  - File mention：`[basename](相对路径)`；目录目标以 `/` 结尾；路径含空格、括号等时用 CommonMark `<…>` 包目标。路径相对工作区 cwd。
  - Agent mention：`[@显示名](paseo://agent/<provider 或 profile>)`。scheme 按 ADR 0002 用 `paseo`。
- 解析（气泡、Queue track 中无结构的旧项、Rewind 共用）：
  - `[label](path)` 且 label 等于 path 的 basename → File mention；目标末尾 `/` 为目录。label 与 basename 不等时保留为文字。不限定相对路径：`[x.ts](/abs/x.ts)`、`[docs](docs)` 也是 File mention。带 URL scheme 的目标（`https://…`）保留为文字。裸目标允许一层成对括号（`app/(tabs)/index.tsx`）。
  - `[@label](paseo://agent/…)` → Agent mention；`@` 后名字为空时保留为文字。
  - 按 CommonMark，`![…](…)`（图片）与 `\[…](…)`（转义）不是链接，保留为文字。
  - 正文开头连续的 `/name` 或 `$name`，且 name 在该 agent 当前 skill 列表中 → Skill block；列表拿不到或不在列表中时保留文字。`$name` 是 Paseo 发给 Codex 时改写出的形式，从 Codex 历史导入时原样回来；序列化仍写 `/name`。取舍：非 Codex 会话以 `$已知 skill` 开头时同样显示为块，只影响显示。
  - 开头块与块、块与正文之间的那一个空格是分隔符，解析时丢弃，渲染时补回（后面紧跟换行或制表符时不补）。
  - 旧消息中带引号的 `"path"` 不解析。
- 选中 skill：从正文移除当前 `/query`（连同紧随的一个空格），块追加到开头块串末尾（同名去重），光标回到原 `/query` 所在位置。只有 `kind === "skill"` 的 provider 条目走这里；命令、客户端内置命令、插件命令保持文本替换。
- 选中文件 / 目录：把当前 `@query` 替换为块并补一个空格。
- 有 Skill block 时跳过客户端命令与插件客户端命令识别，沿用 Skill chip 行为。已落地（工单 05）：
  - 输入框里每个开头 Skill block 后跟一个空格（`leadingSkillSegments`），输入框文字即发出的 `/a /b 正文`；发送一律从分段结构序列化（`resolveOutgoingMessage`），用户删掉分隔空格也照样写一个。
  - 气泡解析出的分段结构不带分隔空格，输入框的带；Rewind 与 Queue track 经 `splitLeadingSkillBlocks` / `leadingSkillSegments` 互转。
  - 输入框内部粘贴进来的 Skill block 移到开头块串末尾（同名去重），其余原位插入。
- 空消息判定：文字段与块段都为空才算空。

### Web / Electron 编辑器

- 用 Tiptap 3 替换 Web 端的 textarea，作为 Composer 文字输入的 Web 实现，通过 Metro 平台扩展名与原生实现分开；Electron 走同一 Web 实现。已落地（工单 02）：
  - `composer/input/text-input.web.tsx`（Tiptap）与 `text-input.tsx`（原生，转出共享 `EditingTextInput`），对外仍是 `EditingTextInputHandle` 与 RN 回调形状，另加可选 `getSelection()` 读实时选区（原生没有，退回最近一次选区事件）。只有 Composer 换了，查找、重命名等共享文本输入不动。
  - 文档固定为一个段落，换行是 `hardBreak`。
  - 未被 Composer 拦下的 Enter 与 Shift+Enter 都插入换行；Cmd/Ctrl+Enter 不换行（交给 Composer 排队或发送）。程序替换文字（`replaceText` / `reset`）不进撤销栈。
  - 高度不再用 textarea 镜像测量：编辑器随内容自己长高，到最大高度后在根元素内部滚动；原生端同样只给 `minHeight` / `maxHeight`。
  - 粘贴只取 `text/plain`；Composer 在捕获阶段先收走图片并 `preventDefault`，编辑器看到后不再插入。拖放一律交给外层 file drop。
  - 一次插入的多行文字（Playwright `fill`、系统文本替换）按换行拆成 `hardBreak`，替换范围取 DOM 选区，因为 ProseMirror 要等异步的 `selectionchange` 才同步选区。粘贴同样取 DOM 选区（工单 04 补上：全选后按方向键立刻粘贴，原先会覆盖整段）。
  - Web 包体积增量：未压缩 +402 KB，gzip +115 KB，brotli +95 KB。
- 块是 inline、atom 的节点，NodeView 不可编辑；方向键整块跳过；退格、Delete、选区删除整块处理；开头 Skill block 之前不可放光标（工单 05：空选区落在最后一个开头 Skill block 之前一律移到它后面，因此开头块只能从最后一个往前退格删，选区删除不受限）。已落地（工单 03）：
  - Composer 看到的文字就是发出去的文字：`getText()`、`onChangeText` 与所有偏移都按序列化写法计，块在编辑器里只占一个位置，两者经 `composer/input/editor-text.web.ts` 换算。发送与草稿、排队项的 `text` 因此不用改；块的结构另存在分段结构里（工单 04，见下文「草稿、排队、失败恢复、Rewind」）。
  - 编辑器的选区另报 `blockBoundary`（光标前最后一个块的结束偏移），`@` 与 `/` 的识别不往回越过它，块的链接目标里的 `@`、` /` 不会打开列表。
  - Composer 以整段文字替换内容（补全命令、语音、清空、草稿恢复）时，编辑器只改与当前文字不同的那一段，没碰到的块保留，碰到的块整块变成新文字。
  - 选中文件走 `insertInlineBlock(block, range)`：`@query` 后面已经是空格时沿用它，不补第二个；这次替换进撤销栈，撤销回到 `@query`。
- 外观照 codeg：线性单色图标（立方体、文件、文件夹、图片、provider 图标）+ accent 色名字，`caption` 级字号，无底色无描边，名字过长截断；不新增 token。
- Web 悬停：File mention 显示相对路径，Skill block 显示全名与描述；按 `docs/hover.md` 的规范实现，紧凑宽度不出提示。
- 保持 Composer 现有能力不变：IME 组字、Enter 发送与 Shift+Enter 换行、Command menu 与 `@` 列表的触发与键盘导航、粘贴/拖拽图片与文件进 Attachment tray、语音输入插入、随内容长高与最大高度、placeholder、聚焦快捷键、`preserve-and-lock` 提交锁定。Composer 改文字的调用点仍用 imperative handle 的整段文字替换（靠上面的差异替换保块），另加 `insertInlineBlock`；分段结构在草稿、排队这些要跨卸载保存的地方才出现（工单 04）。
- 粘贴外部文字一律按纯文字插入；输入框内部复制粘贴保留块；从输入框复制到外部时剪贴板是序列化文本。粘贴只读 `text/plain`，所以编辑器默认写的 HTML 用不上：选区含块时由编辑器接管复制与剪切，`text/plain` 写序列化文字，另写 `application/x-paseo-inline-segments`（分段结构 JSON，粘贴时逐字段校验）；不含块时仍走编辑器默认。在别的工作区的输入框里粘贴同样还原成块，路径不随 cwd 改写。
- 覆盖所有使用 `Composer` 的界面：agent 面板、草稿 tab、新建工作区页、工作区设置弹窗。

### 原生端

- 输入框保持现有 `TextInput`。选中 skill：在正文开头插入 `/name `（去重，不重复插入已在开头的同名）；选中文件 / 目录：插入序列化链接文字加空格。工单 05 落地时，"开头"指开头连续的已知 skill `/x `（skill 名随选中从 Command menu 的命令列表带下来），新 skill 追加在其后，与 Web 的选中顺序一致；开头不是已知 skill 的 `/x`（如 `/usr/bin/foo`）排在新 skill 之后。
- Attachment tray 里的 Skill chip 渲染与相关逻辑删除。
- 气泡与 Queue track 使用共用渲染器显示块。

### 气泡与 Queue track

- 用户气泡正文改为共用的"块文本"渲染器（`inline-blocks/view.tsx` 的 `InlineBlockText`）：解析文本，块显示为与输入框相同的图标 + accent 文字，四端一致；仍可选中文字。
- 气泡里块名是 `accentBright`、字重 normal，字号取 `contentTypeStep(fontSize.content, "caption")`，随 Content size 设置缩放（`.atw/spec/app/frontend/styling.md`「Conversation」）。
- 解析需要的 skill 列表取该 agent 当前的命令列表查询结果（`useAgentSkillNames`）：`AgentStreamView` 与 Queue track 挂载时以预取观察者请求，只对 session store 里存在的 agent 请求（草稿 tab、provider 子智能体面板不请求）；未加载时按文字显示，加载后重新渲染；`partial` 列表按已加载使用。
- 复制按钮复制原始文本。
- Queue track 的排队行用同一渲染器。Web 排队项带分段结构，按它渲染，手打的 `/skill` 发出前保持文字；原生端排队项没有分段结构，按文字解析，手打的已知 `/skill` 在排队行显示为块（原生端手打的链接与插入的链接文字本就无法区分，已确认接受）。

### 草稿、排队、失败恢复、Rewind

- 草稿输入新增可选的分段结构字段 `segments`；`text` 仍保存序列化文本。只在含块时保存；有分段结构时以它恢复，恢复后手打文字仍是文字。只改文字的写入（原生端、程序替换）丢弃旧的分段结构。字段可选，不升版本号，不写迁移。已落地（工单 04），契约见 `.atw/spec/app/frontend/state-management.md`「Unsent Composer content keeps its segments」。
- 旧草稿的 `skills` 字段读取时转成开头的 Skill block，标 `COMPAT(skill-chip-draft)`；新写入的草稿不再写 `skills`（工单 05）。
- "是否有内容"与活跃草稿判定计入块：块按链接写法计入 `text`，只有块的草稿 `text` 不为空，`hasDraftContent` 不需另判。
- 排队项保存分段结构（发出的消息的结构：输入框内容按文字同样 trim，开头 Skill block 与分隔空格原样保留）；编辑排队项时按结构恢复到输入框，替换输入框原有内容。
- 发送失败按提交前的分段结构恢复；新建工作区页交给草稿 tab 自动建 agent 失败时同样按分段结构写回（`MessagePayload.segments` → `PendingWorkspaceDraftSubmission.segments`）。
- Rewind 从气泡文本解析后写回输入框：File mention、Agent mention 与开头的已知 skill 都成块；仍只在输入框为空时写入。
- 旧草稿的 `skills` 迁移走草稿存储既有的 legacy 路径：`CanonicalDraftInputSchema` 不再有 `skills`，带它的记录启动时交给 `migrateDraftInput` 改写（见 `docs/data-model.md` Draft Store）。

### 协议与 daemon

- 协议、daemon 都不改；发送的仍是 `text`。老 Host 不需要能力开关。
- multi-agent 任务里原定的 `mentions` 字段作废，改由 daemon 从正文提取 Agent mention 链接（归该任务）。

### 分工

- 本任务提供 Agent mention 的块类型、链接格式、解析、渲染、编辑器节点与 provider 图标（输入框节点视图经 `InlineBlockServerIdContext` 拿到 serverId，工单 04 补上；图标在测试环境被桩掉，这一点只有类型检查覆盖）；`@` 列表的智能体分组、置灰、daemon 提取与派发归 `09-29-multi-agent-collab`。本任务里 Agent mention 只会经解析出现（气泡、Rewind），输入框暂无插入入口。

### 无障碍

- Web 上标签挂在块的容器上，原生挂在名字 Text 上（见 `.atw/spec/app/frontend/component-guidelines.md`「Accessible names」）。文案：Skill、文件、文件夹、图片、智能体五种，九种语言。

## Testing Decisions

好的测试只看外部行为：给定选中项与键盘操作，得到什么块、发出什么文本、气泡显示什么；不断言编辑器内部状态或组件 state。

- **A · Playwright 浏览器端到端（主测试层）**，参照 `composer-autocomplete.spec.ts`、`agent-message-submission.spec.ts`、`agent-message-rewind.spec.ts`，用 mock agent 工作区与注入的命令列表：
  - 选 skill、文件、目录后输入框出现对应块；正文中间选 skill 时块出现在开头；
  - 方向键跳过块，退格整块删除；
  - 发送后 agent 收到的文本等于序列化写法；
  - 气泡显示块，刷新页面后仍显示；
  - 手打的 `/skill` 在输入框里是文字，切 tab 回来仍是文字；选中产生的块切 tab 回来仍是块；
  - 排队行显示块，编辑排队项后回到输入框仍是块；
  - Rewind 后输入框里是块；
  - 复制按钮复制原始文本。
- **B · 块编解码纯逻辑单元测试**，替换 Skill chip 的纯逻辑测试，参照其现有测试与 `@` 文件补全的测试：
  - 序列化：多 skill + 正文、只有块、文件 / 目录 / 含空格括号的路径、Agent mention；
  - 解析：各种合法写法、label 与 basename 不等、未知 skill、skill 列表缺失、旧 `"path"`、Claude 导入还原出的 `/cmd args`、Codex 导入的开头 `$name`、图片与转义写法；
  - 序列化后再解析得到原结构；
  - 选中 skill 的移除 `/query`、去重、光标位置；选中命令不产生块；
  - 有 Skill block 时不识别客户端命令。
- **C · 草稿存储**，参照现有 draft-store 的持久化、状态与迁移测试：带分段结构的草稿写入再读出一致；旧 `skills` 字段读出为开头的 Skill block；只有块的草稿是活跃草稿。
- 手动 QA，按 `docs/qa.md` 在 Electron 上截图留证：中文输入法组字；浅色、深色主题各一张（含三种块）；悬停路径提示；一张原生端气泡显示块的截图（没有原生端模拟环境，用户 2026-09-30 确认免做）。报告 Web 包体积增量。

## Acceptance Criteria

- [ ] Web 与 Electron 上从 Command menu 选 skill、从 `@` 列表选文件 / 目录 / 图片，输入框正文里出现对应图标 + 名字的块，外观与参考图一致（无底色、accent 文字）。
- [ ] Skill block 固定在开头、按选中顺序、同名去重；正文中间选中时光标留在原处。
- [ ] 块是原子的：方向键整块跳过，退格与选区删除整块处理，光标不能到开头 Skill block 之前。
- [ ] 手打与粘贴的外部文字不转成块；输入框内部复制粘贴保留块。
- [ ] 粘贴、拖拽的图片与文件仍进 Attachment tray；Attachment tray 不再显示 Skill chip。
- [ ] 发出的文本符合序列化规则，daemon 与协议无改动。
- [ ] 用户气泡与 Queue track 按解析规则显示块，刷新后不变；导入的 Claude / Codex 会话同样显示块；旧消息不受影响。
- [ ] 复制按钮复制原始文本。
- [ ] 草稿、排队编辑、发送失败恢复保留块且手打文字仍是文字；Rewind 写回块；旧草稿 `skills` 转为 Skill block。
- [ ] IME、Enter / Shift+Enter、菜单键盘导航、语音输入、自动长高、提交锁定等现有行为无回归。
- [ ] 原生端选 skill 插入开头 `/name `、选文件插入链接文字，气泡与 Queue track 显示块，原生端无崩溃。（没有原生端模拟环境，只有单测覆盖；用户 2026-09-30 确认免实机验收）
- [ ] 所有使用 `Composer` 的界面都可用；五种块的无障碍标签九种语言齐全。
- [ ] A、B、C 三层测试通过；QA 截图与包体积增量附在交付说明里；`npm run typecheck`、`npm run lint` 通过。

## Out of Scope

- 原生端输入框里显示块（移植 t3code 的 Expo 原生编辑模块另开任务）。
- Skill 留在正文中间原位生效，以及多 skill 在 Codex / OpenCode 上只生效第一个的问题（另开任务）。
- 手打 `/name`、`@path` 或粘贴链接自动转块。
- Skill 显示名美化（Title Case、provider displayName）。
- `@` 列表的智能体分组、派发、daemon 提取 Agent mention（归 `09-29-multi-agent-collab`）。
- 块里显示图片缩略图。
- 协议字段、daemon 改动、老 Host 能力开关。
- 已发送消息的"编辑重发"（仓库没有此功能，Rewind 除外）。

## Further Notes

- 官方 Paseo 手机 App 连 Osuna daemon 时，气泡会显示链接原文（ADR 0005 已记录）。
- 链接格式已写进历史消息，改格式意味着旧消息不再显示块。
- 落地后 `docs/glossary.md` 中 **Attachment tray** 的 Code 引用与 Skill block 的代码指向需要随实现更新。
