# 参考项目：输入框行内块（2026-09-29）

源码在 `/Users/oxy/Documents/Configuration/dev-environment/demo/源码/`。

## 对比

| | codex-host | codeg | t3code |
|---|---|---|---|
| Web 编辑器 | 借用 Codex Desktop 的 ProseMirror 节点 | Tiptap 3，统一 `reference` 原子节点 | Tiptap 3，`composer-*` 原子节点 |
| 移动端 | 无 | 独立仓库，未看 | 自研 Expo 原生模块：iOS `UITextView` + `NSTextAttachment`，Android `EditText` + `ReplacementSpan`（约 2300 行 Swift/Kotlin，MIT） |
| 外观 | 强调色文字，agent 有图标 | 图标 + 彩色文字，无底色无描边 | 有底色有描边的 pill |
| 块的存储 | 文本里的链接 `[@Label](subagent://…)` | 文本：文件 `[label](file:///abs)`，skill `/id`（Codex `$id`），agent `[@label](codeg://agent/…)` | 文本：skill `$name`，文件/目录 `[basename](path)` |
| 协议结构化字段 | 无 | 无；daemon 从正文正则提取 agent 链接 | 有 `context` 字段但 skill/mention 不用 |
| 气泡 | Desktop 从文本解析链接 | 从文本解析，导入历史也能还原 | 从文本解析（已知 skill） |
| Skill 位置 | 第一个挪到开头，其余丢弃 | 原位，可多个 | 原位，可多个；Claude 由 daemon 把最后一个已知 skill 拆成 `/name 后文` |
| 草稿 | Desktop 负责 | Tiptap JSON | 纯字符串 |
| 队列/回退 | Desktop 负责 | 存 blocks，编辑时从文本重解析 | 纯字符串 |
| 手打转块 | — | 不转；粘贴链接转 | 手打 `$name ` 后跟空格即转 |
| Skill 显示名 | 原始名 | id | `displayName`，缺省 Title Case |

## 已知缺陷

- codeg：目录还原后当成文件；skill 显示名丢失。
- t3code：目录靠"basename 无 `.`"推断，`foo.zip` 目录会被当成文件。
- t3code 移动端基于 Expo 57 / RN 0.86，本仓库是 Expo 54 / RN 0.81.5。

## 关键文件

- codeg：`src/components/chat/composer/nodes/reference-node.ts`、`composer/reference-text.ts:102-138`、`src/components/message/user-message-segments.ts`、`src-tauri/src/acp/agent_mentions.rs`
- t3code：`apps/web/src/components/ComposerPromptEditorTiptap.tsx`、`packages/shared/src/composerInlineTokens.ts`、`apps/mobile/modules/t3-composer-editor/`、`apps/server/src/provider/Drivers/ClaudeSkillDispatch.ts`
- codex-host：`packages/shared-contracts/src/delegation-mention.ts`、`packages/host-runtime/src/delegation-mention-rewrite.ts`
