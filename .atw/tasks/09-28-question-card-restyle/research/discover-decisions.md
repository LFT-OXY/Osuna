# Discover：问题选择卡片美化

参考图：`research/reference.png`（用户提供的目标样式）。

## 现状

- 组件：`packages/app/src/components/question-form-card.tsx`（`QuestionFormCard`），挂载点 `packages/app/src/agent-stream/view.tsx:1575`（`request.kind === "question"` 分支）。
- 纯逻辑：`packages/app/src/components/question-form-card-core.ts`，单测 `question-form-card-core.test.ts`。
- 现有交互：多问题时顶部 tablist（header + 已答打勾）；选项左侧是单选圆点或多选方框；单选点中后自动跳到下一题，但仍要点底部"提交/下一步"才会发出；`allowOther` 或无选项时在选项下方常驻输入框；底部"忽略"（`dismissLabel` 可覆盖）+ 强调色主按钮。
- i18n：`message.question.{submit,next,answerPlaceholder,otherPlaceholder}`，9 个 locale 在 `packages/app/src/i18n/resources/`。
- e2e：helper `packages/app/e2e/support/helpers/questions.ts`（依赖 testID `question-form-card` / `question-form-current-question` / `question-form-primary-action`、role radio/checkbox/tab、`Question N of M`）；使用方 `question-prompt-pagination.spec.ts`、`agent-scroll-return.spec.ts`、`permission-steer.real.spec.ts`、`plan-approval.claude.real.spec.ts`。

## 与 docs 冲突、本次顺带改正

- 按钮是 `Pressable` 包 `Text` 手拼的：违反 `docs/design.md` §4、§14，改用 `<Button>`（`packages/app/src/components/ui/button.tsx`）。
- 用了 `useUnistyles()`：`docs/unistyles.md` 明令禁止，触碰即转换为 `StyleSheet.create((theme) => …)` 等替代方案。
- 悬停：`docs/hover.md`，只在 Pressable 自身样式上用 hovered；原生端无悬停。

## 服务端对"部分答案"的兼容性（已核对）

app 端把答案按 `header` 序列化；缺题时：

- Claude `claude/agent.ts:199-246`：缺失的键直接不写入 `normalizedAnswers`。
- Codex `codex-app-server-agent.ts:1218-1253`：缺失跳过；全部缺失返回 `null`。
- OpenCode `opencode-agent.ts:4842-4859`：缺失发 `[]`。
- Pi：只有单题（外加可选评论题）。

结论：单题跳过只改 app 端，不动协议。

## 用户决定

1. 单选：点击行即作答。单问题直接提交；多问题时进入下一题，最后一题点完即提交。去掉单选题的提交按钮。
2. 右上角 X：忽略整组（现有 dismiss 语义）。右下角「跳过」：只跳过当前题（留空进入下一题）；最后一题跳过即提交已有答案；单问题时跳过等同忽略。
3. 自由输入（allowOther）：作为编号的最后一行，点击后原地变成输入框，回车提交。无选项的纯文本题仍直接显示输入框。
4. 键盘操作（数字键/上下键/Esc）：本次不做，编号圆圈仅展示。
5. 多选：点击切换，选中时编号圆圈填强调色并打勾；右下角在「跳过」旁加「下一步/提交」按钮，仅多选题（及需要确认的输入）出现。
6. 选项文字：只保留圆圈编号，文字不重复「1.」；label 正常色，description 换行用 `foregroundMuted`。
7. 多问题：保留顶部 tablist，只调样式与新卡片一致；标题不加 `[header]` 前缀；单问题仍不显示 tablist。

## 待 spec 阶段确定的细节

- 全部题都被跳过时（没有任何答案）如何处理——建议等同 X 忽略，避免给 Codex 发 `null` 答案。
- 「跳过」文案的 i18n key 以及 9 个 locale 的翻译。
- 自由输入行展开后，输入框与"提交"按钮的关系（回车提交之外是否需要按钮，移动端软键盘无回车时的提交入口）。
- e2e helper 需按新 role/testID 调整。
