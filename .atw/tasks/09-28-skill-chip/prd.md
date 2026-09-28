# Skill chip

父任务：`09-28-composer-slash-revamp`。视觉参考：用户提供的图 2（形态为准，颜色换成主题蓝）。建议在 `09-28-slash-menu-restyle` 之后做。

## Problem Statement

在 Command menu 里选中一个 skill 后，它只是作为 `/atw-askme-with-docs ` 这样一串文字插进输入框，和用户接下来要写的正文混在一起：

- 看不出这是"一个被调用的 skill"，还是自己打的字；
- 想去掉它得手动删一长串字符；
- 想同时调用两个 skill，只能手动拼文字，容易拼错。

## Solution

- 在 Command menu 里选中一个 skill，输入框里的 `/xxx` 消失，Attachment tray 那一行最前面出现一个 Skill chip：立方体图标加 skill 原始名，浅蓝底、蓝色描边、蓝色文字。
- 可以选多个 skill，按选中顺序排列；同名的不会重复加。
- 删 chip：点 chip 上的 ×，或者在正文最开头按退格删掉最后一个 chip。
- 发送时 chip 按顺序拼回正文开头，变成 `/a /b 正文`，与现在手打的效果完全一样，daemon 不需要改。
- chip 跟草稿一起保存，切换 tab、重启 App 后还在。
- 选中的如果是命令（不是 skill），仍按现在的方式插入文字。

## User Stories

1. 作为用户，我想在 Command menu 里选中 skill 后看到一个块状 chip，以便清楚知道自己调用了哪个 skill。
2. 作为用户，我想让 chip 显示 skill 的原始名（如 `atw-askme-with-docs`），以便和我平时输入的名字一致。
3. 作为用户，我想让 chip 带立方体图标、用浅蓝底和蓝色描边，以便和正文、附件一眼区分。
4. 作为用户，我想让选中 skill 时输入框里已输入的 `/xxx` 自动消失，以便正文里不残留半截指令。
5. 作为用户，我想在正文中间输入 `/xxx` 并选中 skill 时，同样生成 chip 并从正文里拿掉 `/xxx`，以便行为一致。
6. 作为用户，我想在选中 skill 后光标仍在输入框、停在原来 `/xxx` 所在的位置，以便接着写正文。
7. 作为用户，我想连续选多个 skill 并按选中顺序排列，以便一次调用多个 skill。
8. 作为用户，我想在重复选中同一个 skill 时不出现第二个 chip，以便不会发出重复指令。
9. 作为用户，我想让 chip 排在附件前面、和附件共用一行，以便输入区高度稳定。
10. 作为桌面 / 网页用户，我想在鼠标悬停 chip 时看到 × 和 skill 描述，以便确认它是做什么的、并能删除。
11. 作为手机 / 平板用户，我想让 chip 的 × 始终可见，以便没有悬停也能删除。
12. 作为用户，我想点 × 删除对应的 chip，以便撤回某个 skill。
13. 作为用户，我想在光标位于正文最开头、没有选中文字时按退格删除最后一个 chip，以便用键盘撤回。
14. 作为用户，我想在正文不为空、光标不在开头时按退格只删文字，以便不会误删 chip。
15. 作为用户，我想在只有 chip、没写正文时也能发送，以便直接触发 skill。
16. 作为用户，我想发送后 chip 与正文一起清空，以便下一条消息从干净状态开始。
17. 作为用户，我想发送出去的消息等同于 `/a /b 正文`，以便 Claude 对开头的 skill 走完整展开，与手打一致。
18. 作为用户，我想在 agent 运行中发送时，消息进入排队区显示为拼好的纯文本，以便排队区行为不变。
19. 作为用户，我想让 chip 随草稿保存，切换 tab、切换工作区、重启 App 后仍在，以便不丢失已选的 skill。
20. 作为用户，我想在手动输入完整的 `/name ` 时它保持为文字、不自动变 chip，以便不出现意外的转换。
21. 作为用户，我想在选中命令（如 `/compact`）时照旧插入文字，以便带参数的命令能接着输入参数。
22. 作为用户，我想在有 chip 时正文里的 `/clear` 之类客户端命令不会被当作立即执行，以便不会因为 chip 加正文而误触发清空或退出。
23. 作为用户，我想在 skill 名很长时 chip 截断显示、悬停可见全名，以便一行里放得下。
24. 作为用户，我想在切换 provider 或模型后 chip 仍保留，以便不用重新选。
25. 作为深色主题与插件主题用户，我想让 chip 颜色随主题的 accent 变化，以便与主题协调。
26. 作为使用读屏的用户，我想让 chip 读作"Skill：名字"、× 读作"移除"，以便无障碍可用。

## Implementation Decisions

### 状态与模型

- 新增一个 Skill chip 纯逻辑模块（深模块），负责：
  - 选中 skill 时：从正文中移除当前 `/query` 区间（连同紧随的一个空格），返回新正文、新光标位置与追加后的 chip 列表（同名去重，保持顺序）；
  - 删除指定 chip、删除最后一个 chip；
  - 发送时序列化：`chips.map(c => "/" + c.name).join(" ")`，正文非空时再接一个空格与正文；只有 chip 时结果就是 chip 串。
- 只有 `kind === "skill"` 的条目走 chip 分支（`resolvePickedSkillChip`，`hooks/use-agent-autocomplete.ts`）；命令、客户端内置命令、插件命令保持现有文本替换。找不到当前 `/query` 时选中 skill 只追加 chip，不动正文。
- 模块：`composer/skill-chips.ts`（`pickSkillChip`、`appendSkillChip`、`removeSkillChip`、`removeLastSkillChip`、`serializeSkillChips`、`resolveSkillChipSubmission`）。
- chip 数据：`{ name, description? }`。description 只用于悬停提示，来自选中时的列表条目。

### 草稿持久化

- 草稿输入在 `text`、`attachments` 之外新增可选字段 `skills`（chip 列表）。schema 里设为可选，旧草稿读出时视为空；不升级草稿版本号，不写迁移。
  - `SkillChipSchema` 定义在 `composer/skill-chips.ts`，`SkillChip` 由它推导；持久化 schema（`migration.ts`）与规范 schema（`state.ts`）都引用它。
  - 读取用 `selectDraftSkillChips(record)`，非活跃或旧草稿返回空列表；"是否有内容"统一用 `stores/draft-store/state.ts` 的 `hasDraftContent`。
  - Composer 通过 `skillChips` / `onChangeSkillChips` 两个 props 读写，来自 `useAgentInputDraft`。
- 草稿"是否活跃"的判定把 chip 计入：只有 chip 没有正文也算活跃草稿。
- chip 属于 Workspace-owned state，按现有草稿键隔离，不串到同 `cwd` 的其他工作区。
- 排队消息与"编辑后重发"只保存拼好的纯文本，不反向解析成 chip。

### 发送

- 提交时先把 chip 与正文序列化成一条消息，再走现有提交流程；空消息判定改为"正文与 chip 都为空才算空"。
- 有 chip 时跳过客户端内置命令与插件客户端命令的识别，整条消息按普通消息发送；在 Command menu 里选中立即执行的客户端命令（如 `/clear`）也改为插入文字。
- 只有 chip 时，Composer 以 `hasExternalContent` 告诉 `MessageInput` 有待发内容，发送与排队（`queueComposerInput`）都据此放行。
- 发送成功或进入排队后，chip 与正文、附件一起清空；发送失败时按现有逻辑恢复正文，chip 同样恢复。`preserve-and-lock` 模式下正文不清空，chip 也不清空。
- 以上由 `submitAgentInput`（`composer/submit.ts`）统一处理：入参是正文与 `skillChips` / `setSkillChips`，内部用 `serializeSkillChips` 拼出外发消息；失败时正文恢复为不带前缀的原文，chip 恢复为原列表。
- 工单 01 的过渡状态：chip 存在 Composer 本地、按 `serverId:agentId` 标记归属；发送失败时正文恢复为拼好的 `/a /b 正文`、chip 清空。工单 02 改为随草稿存取并恢复成 chip。

### 视图

- chip 渲染在 Attachment tray 中、排在附件之前；tray 在"有附件或有 chip"时显示。tray 内各项垂直居中，所以与 50 高的附件 pill 同一行时 chip 居中。
- 外观取原型变体 B，定于 2026-09-28；原型在 `prototype/skill-chip-styles` 分支。起因是 48 高的 chip 被用户评为又大又丑。不新增 token：
  - 小号方角 pill，总高 24（含上下 1px 描边），`radius.md` 圆角，左内边距 6、右内边距 8，最宽 260，名字过长时截断；
  - 底色用 `accent`，经一层不透明度 0.07 的底层实现，不影响文字不透明度；
  - 描边是另一层 `accent` 1px 边框，不透明度 0.3（`composer/skill-chip-pill.tsx`）；
  - 立方体图标 12（`ICON_SIZE.xs`）与名字都用 `accentBright`，名字 `caption` 级（12）、medium，不带 `/`。
- ×：不浮在 chip 外，而是替换图标的位置，尺寸相同，所以出现时 chip 宽度不变。Web 端按 `docs/hover.md` 的规范——外层普通 View 用 `onPointerEnter` / `onPointerLeave` 作悬停包络，内部独立 Pressable 负责点击；可见性 `isHovered || isNative || isCompact`，原生与紧凑布局常显 ×、不显示图标。
- 悬停提示显示全名与描述（Web）；原生端不做长按提示。
- 退格删除：Web 在 textarea 的 keydown、原生在 `onKeyPress` 捕获 Backspace，仅当选区起止都在 0 时删除最后一个 chip 并阻止默认行为。
- 无障碍：chip `accessibilityLabel` 为"Skill: 名字"，× 为"移除"，文案进 i18n。× 的文案 `composer.attachments.removeSkill` 已随工单 01 加入。
- 立方体图标与 Command menu 技能行共用同一个图标。

## Testing Decisions

好的测试只看外部行为：给定正文、光标与选中项，得到什么正文、什么 chip、发出什么消息；不断言组件内部 state。

- **A1 · Skill chip 纯逻辑**，参照 `utils/agent-command-autocomplete.test.ts` 与 `composer/submit.test.ts`：
  - 开头与中间的 `/query` 选中 skill 后被移除、光标位置正确；
  - 同名去重、顺序保持；
  - 选中命令不产生 chip；
  - 序列化：多 chip + 正文、只有 chip、只有正文三种；
  - 删除指定 chip、删除最后一个 chip；
  - 有 chip 时不识别客户端命令。
- **A2 · 草稿持久化**，参照 `stores/draft-store/persistence.test.ts` 与 `state.test.ts`：含 chip 的草稿写入再读出一致；没有 `skills` 字段的旧草稿能读出且 chip 为空；只有 chip 的草稿是活跃草稿。
- **A3 · vitest browser**，参照 `composer/input/text-input.web.browser.test.tsx`：
  - 渲染 Composer input 与 Attachment tray，放入两个 chip 与一个附件，chip 在附件之前；
  - 点 × 删除对应 chip；
  - 光标在开头按退格删除最后一个 chip，光标在中间按退格只删文字。
- 视觉按 `docs/qa.md` 用 Electron 截图留证：浅色、深色各一张，含两个 chip 加一个附件；再附一张原生端截图显示常驻 ×。

## Out of Scope

- 已发送消息气泡里显示 chip。
- 手动输入 `/name ` 自动转 chip。
- 排队消息与编辑重发反向解析成 chip。
- 行内（文字中间）显示 chip 的富文本编辑器。
- 显示名美化（首字母大写）。
- 新增颜色 token。
- daemon 或协议改动。

## Further Notes

- 验收：Electron 上选两个 skill → 输入正文 → 发送，transcript 里的用户消息为 `/a /b 正文`；切 tab 再回来 chip 仍在；×与退格都能删除；原生端同样可选、可删、可发送。
- 术语见 `docs/glossary.md` 的 **Skill chip**、**Attachment tray**、**Command menu**。
