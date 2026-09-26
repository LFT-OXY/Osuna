# 05 — 对话流：消息与正文

**What to build:** 对话流中的消息正文换成新风格：用户消息右对齐、最大宽度 80%、圆角 18、使用 message surface；agent 回复无背景，文字为主前景色约 86%，markdown 排版（段落、列表、行内代码、标题）改用新 Text 阶梯；代码块带语言标签与复制按钮，暗色下无边框。消息的时间戳与复制、编辑等操作在 hover 时出现，原生端常显。

**Blocked by:** 02 — Text、Row 组件与左侧栏
**Status:** ready-for-agent
**Impl:** done

- [x] markdown 样式单测随新设计更新并通过
- [x] 长回复与长代码块滚动和选中复制行为不变
- [ ] 移动端对话流同样应用新 token，无布局回退
- [x] 该区域 Electron 桌面端亮色与暗色截图与原型观感一致，截图作为证据附在本票 Comments
- [ ] 该区域中断言 CSS 值或几何尺寸的 e2e 已随设计更新，且在 CI 上通过
- [x] testID 与英文 UI 文案逐字未变
- [x] docs/design.md 等设计文档中对应章节已改写（改写过时内容，不在末尾追加）
- [x] typecheck 与 lint 通过

## Comments

### 2026-09-26 — 实现记录与视觉证据

Electron 桌面端证据：
- 启动方式：dev，`FORCE_COLOR=3 PASEO_LISTEN=127.0.0.1:6769 npm run dev --workspace=@getpaseo/desktop`；用临时脚本在 dev daemon 里建了一个 mock agent（`mockAssistantResponse` 给出列表、标题、行内代码、ts 代码块），Playwright CDP 截图并读计算样式。截图时指针悬停在用户消息上。
- 亮色：[对话流](../evidence/05-electron-light-chat.jpg)；暗色：[对话流](../evidence/05-electron-dark-chat.jpg)
- 计算样式（正文字号设置为 15）：
  - 用户气泡：宽 643 / 行宽 804（80%），圆角 18px；底色亮 `rgb(244, 244, 245)`、暗 `rgb(20, 20, 20)`。
  - 助手正文：`rgba(39, 39, 42, 0.86)` / `rgba(245, 245, 245, 0.86)`，15px / 24px。
  - 代码块：圆角 10px，底色 `surface2`；亮色描边 `rgb(228, 228, 231)`，暗色描边透明。
- 悬停后用户消息下方显示时间戳、回退、复制，未悬停时隐藏（`agent-message-submission` 断言 opacity 0）。

实现形态：
- 新增两个始终派生的角色：`foregroundProse`（前景色 86%）、`borderCodeBlock`（亮色 `border`，暗色 transparent）。所有主题都走派生。
- `contentTypeStep`（`styles/theme.ts`）：markdown 按 Text 阶梯的比例取字号和行高，基准是正文字号 `fontSize.content`，不是界面字号。这样"正文字号"设置仍然只管消息与 markdown。
  - 正文取 `prose` 一档。
  - 标题 h1–h5 依次为 title-lg / title / title-sm / body-lg / body，semibold，去掉了 h1/h2 的下划线；h6 为 muted，不再大写。
- 代码块（`HighlightedCodeBlock`）：
  - 顶部加一行头部：语言标签（micro、mono、muted）加常显的复制按钮（`icon-button-chrome` small）。头部标记为选中复制忽略，复制出的内容不带标签。
  - 内边距加在代码文本上，不另包一层 View。原因：选中复制按 `pre > code` 找代码，多包一层会让复制结果丢失围栏语言。第一次实现就踩到了这一点，e2e 抓住了。
  - 新增 `renderHeaderActions`：Mermaid web 源码视图的"查看图表"按钮移入头部。它原来绝对定位在右上角，与复制按钮重叠。
- 用户消息：
  - 底色 `surfaceMessage`，四角圆角 `radius["2xl"]`，内边距 `spacing[3]`；内容列 `maxWidth: 80%`。
  - 时间戳改用 `<Text variant="caption" color="foregroundMuted">`。
  - 新增 testID `user-message-bubble`，原有 testID 均未改。

审查后由用户确认的取舍：
- 助手回合页脚（复制、分叉、"已工作"）保持常显。它总结的是整轮回复，没有单一的悬停目标。用户故事 39 的悬停规则只落在用户消息上。
- 86% 正文色作用于所有 markdown（PR 评论、文件预览、plan card、changelog），不只助手消息。
- 与原型的几处数值差异按现有 token 与 t3code 保留：
  - 行内代码没有 1px 淡描边。
  - 亮色代码块底色为 `#f4f4f5`（t3code secondary），原型是 `#fafafa`。
  - 头部高 28（控件档），原型是 30。
  - 时间戳为 caption 12 + muted，原型是 11 + faint。
  - 气泡内边距四边 12（t3code p-3），原型是 10 / 14。

测试：
- 单测：`styles/markdown-styles.test.ts`（9 条）、`styles/theme.test.ts`（118 条），外加 `styles`、`components/markdown`、`utils/markdown-list`，共 19 个文件 209 条，全部通过。
- browser：`assistant-selection-copy`、`word-stream/text`、`ui/text`，共 75 条，全部通过。
- e2e 本地定向：
  - `agent-message-submission` 27 条，新增气泡圆角与 80% 宽度断言。
  - `assistant-selection-copy`：复制按钮改用 role 定位，并断言语言标签可见。
  - 另跑了 `agent-consecutive-turns`、`agent-message-rewind`、`agent-stream-ui`、`assistant-fork-menu`、`assistant-message-render-limit`、`chat-find`、`mermaid-fullscreen`、`mermaid-streaming`、`plan-card-markdown`、`rewind-menu.ui-contract`、`streaming-markdown`。
  - 以上全部通过。全量 e2e 待 CI。

未验证：移动端没有真机或模拟器截图。原生端与 Web 共用同一份样式工厂和 token，但本票没有原生端证据，所以对应的验收项没有勾选。
