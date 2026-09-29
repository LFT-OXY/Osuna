# 输入框与消息链路现状（2026-09-29）

路径相对 `packages/`。

## 输入框

- Web/Electron：react-native-web 的 `TextInput`，渲染为 `<textarea>`（`app/src/components/ui/text-input/text-input.web.tsx`），无 contentEditable；IME 组字靠 `compositionstart/end` 拦截。
- 原生：`text-input.native.tsx:141-170` 三路——有粘贴回调时 `@mattermost/react-native-paste-input`，底部弹层里 `BottomSheetTextInput`，其余 RN `TextInput`。
- 非受控：只用 `initialValue`，改文字靠 imperative `replaceText`/`reset`。
- 高度：`composer/input/height.web.ts`（镜像 textarea）与 `height.native.ts`。
- 无任何富文本依赖。RN 0.81.5、Expo SDK 54、Fabric 开启（`app/app.config.js:106`）。

## `@` 文件引用

- 选中后把 `@query` 换成带引号的相对路径 `"src/x.ts"`，不带 `@`、不补空格（`app/src/utils/file-mention-autocomplete.ts:43-51`）。
- 文件与目录只在候选项上区分（`hooks/use-agent-autocomplete.ts:121-124`），插入一致；图片不区分；无结构化数据，daemon 只收 `text`。

## Skill 与 provider

- 所有 provider 的 `parseSlashCommandInput` 只认开头第一个 `/name`（如 `server/src/server/agent/providers/codex-app-server-agent.ts:3939`、`opencode-agent.ts:4944`、`claude/agent.ts:2817`）。
- 多 chip 拼成 `/a /b 正文` 时，Codex、OpenCode 只调用 `a`，`/b 正文` 成为参数（现存问题）。
- Codex 会转成 `$skill` 并附结构化 `{type:"skill"}` 输入项（`codex-app-server-agent.ts:3981-4011`）。

## 草稿、排队、恢复

- 草稿 `input`：`text`、`attachments`、`skills?`、`cwd?`（`app/src/stores/draft-store/state.ts:138-144`），版本 5，AsyncStorage。
- 排队：内存 Map，`{ id, text, attachments }`，text 是拼好的纯文本（`app/src/stores/session-store.ts:420-423`、`composer/actions.ts:229-245`）；编辑排队项回填文字，chip 以 `/skill` 文字回来。
- 发送失败：恢复正文、附件、chip（`composer/submit.ts:75-81`）。
- 已发送消息无"编辑重发"；Rewind 只回填气泡文本（`app/src/components/rewind/composer-restore.tsx:17-25`）。

## 协议与时间线

- `send_agent_message_request`：`text`、`messageId?`、`activeTurnBehavior?`、`images?`、`attachments`（`protocol/src/messages.ts:1454-1464`）；`create_agent_request` 有 `initialPrompt?`、`images?`、`attachments`（`:1740-1761`）。无用户消息结构化元数据。
- 时间线 `user_message` 只有 `text`、`messageId?`、`clientMessageId?`（`protocol/src/agent-types.ts:372`）；images/attachments 不进时间线，气泡里的图片只来自客户端乐观行（推断：重载后丢失，未验证）。
- 导入历史只有文本（Claude `normalizeClaudeUserPromptText` 还原 `/cmd args`）。
- `<paseo-system>` 仅在整条消息为该信封时丢弃（`server/src/server/agent/agent-prompt.ts:210-222`），无末尾剥离。

## 气泡

- `UserMessage`（`app/src/components/message.tsx:381-533`），正文为纯 `<Text selectable>`，不走 markdown，`/skill`、路径无特殊渲染。
