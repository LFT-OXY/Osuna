# 隐藏 Pi 的不可见扩展消息与 skill 展开全文

## Problem Statement

在本仓库里用 Pi 开会话，只发一句「你好」，时间线里就会出现一大段本不该给人看的文字：
`<workflow-state>`、`<session-overview>`、SESSION CONTEXT / DEVELOPER / GIT STATUS……
它被渲染成一条助手回复，`<session-overview>` 还被当成 markdown 标题放大显示。每一轮都来
一遍，真正的回复被淹没在后面。

这段文字是仓库里的 Pi 扩展（ATW）在每轮开始前注入给模型的运行时上下文。扩展在发出时
已经明确声明了 `display: false` —— 它自己就说了「这条别显示」。Pi 自己的界面遵守这个声明，
OMP（Pi 的 fork）在 Osuna 里也遵守（`5e47cff58`），唯独 Osuna 的 Pi 适配层完全没看这个字段，
把所有 custom 消息都当成助手文本推上了时间线。

第二个现象来自同一个适配层：用 `/skill:xxx 参数` 调 skill 时，Pi 会把整份 skill 正文展开成
`<skill name=".." location="..">…正文…</skill>` 再接上参数，作为用户消息存进会话。实时发送时
时间线显示的是 daemon 记录的 canonical 原文，看不出问题；但一旦走历史回放（daemon 重启、
会话恢复、导入），这条用户消息就以整份 skill 正文的样子出现，几百行的 SKILL.md 直接铺在
对话里。

`docs/timeline-sync.md` 早已约定「系统注入的 prompt 不出现在 Paseo 时间线」—— 这两处都是
违背既有约定的 bug，不是新需求。

## Solution

- Pi 的 custom 消息只要声明了 `display: false`，时间线上就不出现，实时和历史回放两条路
  都一样。没声明、或声明 `display: true` 的 custom 消息保持现状，照常显示为助手文本 ——
  扩展命令的输出（`#1290` 修的那类）仍然看得见。
- Pi 用户消息如果是 skill 展开块，时间线把它还原成用户当初敲的 `/skill:xxx 参数`
  （没有参数就是 `/skill:xxx`）。不做「点开看 skill 正文」。这和 Claude Code 把
  `<command-name>` 还原成 `/cmd` 是同一种处理。
- 只改 Pi。Claude Code、Codex 目前没有证据表明有同样的问题，不动；OMP 已经遵守
  `display`，只核对它对 skill 展开的处理，有同样问题才一并修。

## User Stories

1. 作为在本仓库用 Pi 的开发者，我希望发「你好」之后时间线里只有我的消息和助手的回复，这样我不用在一堆注入文本里找回复。
2. 作为同一个开发者，我希望每一轮都不会再冒出 `<workflow-state>` 块，这样长会话不会被重复的上下文刷屏。
3. 作为同一个开发者，我希望 `<session-overview>` 不再被渲染成一个大标题，这样时间线的视觉层级是对的。
4. 作为 Pi 扩展作者，我希望我声明 `display: false` 的消息在 Osuna 里和在 Pi 自己的界面里表现一致，这样我不需要为 Osuna 另写一套逻辑。
5. 作为 Pi 扩展作者，我希望我没声明隐藏的消息（比如扩展命令的输出）在 Osuna 里仍然可见，这样用户能看到命令结果。
6. 作为 Pi 扩展作者，我希望 `display: true` 与不写 `display` 效果相同，这样默认行为不会因为显式写了默认值而改变。
7. 作为重启 daemon 后重新打开 Pi 会话的开发者，我希望历史里同样看不到注入上下文，这样回放与实时看到的是同一份时间线。
8. 作为导入一个旧 Pi 会话的开发者，我希望历史回放里也按同样规则隐藏，这样旧会话不会突然冒出一堆上下文块。
9. 作为用 `/skill:xxx 参数` 调 skill 的开发者，我希望回放历史时看到的是 `/skill:xxx 参数` 这一行，而不是整份 skill 正文，这样对话仍然可读。
10. 作为同一个开发者，我希望不带参数调 skill 时看到的是 `/skill:xxx`，这样不会留下多余空格或空行。
11. 作为同一个开发者，我希望参数里有多行文字时完整保留，这样我当初写的补充说明不会丢。
12. 作为同一个开发者，我希望实时发送时看到的也是 `/skill:xxx 参数`，这样实时与回放一致。
13. 作为同一个开发者，我希望正常的用户消息（哪怕里面恰好提到 `<skill` 字样）原样显示，这样只有真正的 skill 展开块才会被还原。
14. 作为隐藏的 custom 消息触发了一次自主轮次的用户，我希望该轮次照常开始和结束，这样隐藏内容不会让会话卡在「运行中」。
15. 作为发出扩展命令、但没有触发 agent 轮次的用户，我希望该轮照常完成，这样现有的扩展命令流程不受影响。
16. 作为用 Claude Code、Codex 或 OMP 的开发者，我希望这些 provider 的时间线行为不变，这样一个 Pi 的修复不会波及别处。
17. 作为 fork 或复制会话历史的用户，我希望隐藏的注入上下文不会被带进 fork 的历史，这样新会话不会一开始就看到这些块。
18. 作为维护者，我希望「custom 消息是否可见」的判定只写一处、实时与回放共用，这样两条路不会再次分叉。
19. 作为维护者，我希望 skill 展开块的还原也只写一处、实时与回放共用，这样格式变化时只需要改一个地方。
20. 作为维护者，我希望 Pi 的 custom 消息类型如实声明 `customType` 与 `display`，这样类型系统能提示我这些字段存在。
21. 作为下一个接入 Pi 类 provider 的人，我希望 `docs/providers.md` 写明 custom 消息的 `display` 约定，这样不会再漏一次。

## Implementation Decisions

### 可见性判定

- 判定规则：custom 消息的 `display` 严格等于 `false` 时隐藏，其余（`true`、缺省、非布尔）
  一律可见。与 OMP 的 `shouldDisplayOmpCustomMessage` 语义完全一致。
- 判定抽成 Pi 适配层内的一个函数，实时路径（agent session 处理 `message_end` 的 custom 分支）
  与历史回放（history mapper 的 custom 分支）都先过它，不可见就不产生任何 timeline 事件。
- 隐藏只影响「是否产生 timeline 条目」，不影响轮次生命周期：custom 消息触发或处于某个轮次时，
  `turn_started` / `turn_completed` 的推进与现在一致。
- 不按 `customType` 或标签名（`<workflow-state>` 等）过滤。可见性是扩展自己声明的意图，
  Osuna 不和 ATW 的具体格式绑定。
- 历史回放已有的 `hooks.mapCustomMessage` 扩展点保留：可见性判定先于它执行，被隐藏的消息
  不再交给 hook。

### skill 展开块还原

- 识别格式与 Pi 运行时生成和解析的格式一致：整段文本从头匹配
  `<skill name="…" location="…">\n…\n</skill>`，其后可选跟 `\n\n` 与参数，匹配到结尾。
  只有整段完全符合时才还原；不符合（包括正文里只是提到 `<skill`）原样显示。
- 还原结果：`/skill:<name>`，有参数时为 `/skill:<name> <参数>`，参数原样保留（含换行）。
- 还原发生在 Pi 适配层生成 `user_message` 之前，实时路径（提交用户条目的回显）与历史回放
  （history mapper 的 user 分支）共用同一个函数。
- 实时路径中，被 daemon 与 canonical 行关联上的回显本就不会派发；这里的还原是为了在回显
  没有被关联时也不漏出全文。
- 不新增 timeline 条目类型、不改协议、不改 app 端渲染。

### 类型

- Pi 的 RPC 类型里 custom 消息补上可选的 `customType: string` 与 `display: boolean`，与 Pi
  运行时的 `CustomMessage` 定义对齐。

### 文档

- `docs/providers.md` 的 Pi/OMP 段补一句：custom 消息遵守 `display: false`；Pi 的 skill 展开块
  在时间线上还原为 `/skill:<name> 参数`。

### 不动的部分

- Claude Code、Codex、OMP 的映射逻辑（OMP 仅核对 skill 展开，有同样问题才一并修）。
- 协议、daemon 的 canonical 提交行机制、app 端时间线渲染。
- `.pi/extensions/atw` 扩展本身 —— 它的声明是对的，错在消费方。

## Testing Decisions

好的测试只断言外部可观察的行为：给定 Pi 发出的事件或历史条目，时间线上出现（或不出现）
哪些条目、是什么文字；不断言内部函数被怎么调用。

两个测试接缝，都是现有的，已与用户确认：

- **Pi agent session（实时路径）**：沿用 `pi/agent.test.ts` 的假 Pi 进程（`pi/test-utils`），
  发事件后断言 timeline 与生命周期事件。覆盖：
  - `display: false` 的 custom `message_end` 不产生任何 timeline 条目；
  - 同一条消息在一个自主轮次里时，轮次照常开始、结算；
  - 在一个斜杠命令轮次里时，轮次照常完成；
  - `display` 缺省与 `display: true` 仍产生 `assistant_message`（现有
    "surfaces Pi extension command messages…" 与 "settles an autonomous turn…" 两条用例保持不变、
    继续通过）；
  - 提交用户条目的回显文本是 skill 展开块时，产生的 `user_message` 文本为 `/skill:name 参数`；
    无参数时为 `/skill:name`；多行参数完整保留。
- **Pi history mapper（回放路径）**：沿用 `pi/history-mapper.test.ts`。覆盖同一组规则：
  隐藏的 custom 不产生事件、可见的 custom 仍为助手文本（现有
  "replays non-notice custom messages as assistant text…" 保持不变）、skill 展开块的用户消息
  还原、形似但不完全符合格式的用户消息原样保留。
- 先例：OMP 的同类修复（`5e47cff58`）在 `omp/agent.test.ts` 与 `omp/history-mapper.test.ts`
  各加了用例，结构可直接参照。
- 本地只跑改到的测试文件；全量由 CI 验证。

## Out of Scope

- Pi 的 prompt template（`/template 参数`）展开：模板展开后没有包裹标记，无法可靠还原，
  不在本任务。
- skill 调用的可展开卡片（「已加载 skill：xxx」点开看正文）：访谈中决定不做。
- Claude Code、Codex 的 hook 注入与 skill 显示：目前 Claude 的 skill 正文已被丢弃、只剩 Skill
  工具卡片；Codex 的 hook item 按现有映射被丢弃、`$skill` 显示为 `$name 参数`。没有证据表明
  有问题，不动。
- 修改 ATW 扩展的注入方式。
- 给隐藏内容提供任何调试查看入口。

## Acceptance Criteria

- [ ] 在本仓库用 Pi 发「你好」，实时时间线里不出现 `<workflow-state>`、`<session-overview>` 或其正文。
- [ ] 同一会话在 daemon 重启 / 重新打开后的历史回放里同样不出现。
- [ ] 用 `/skill:xxx 参数` 调一次 skill，实时时间线与历史回放里该条用户消息都显示为 `/skill:xxx 参数`；不带参数时为 `/skill:xxx`。
- [x] 不带 `display` 或 `display: true` 的 Pi custom 消息（扩展命令输出）仍显示为助手文本。
- [x] 隐藏的 custom 消息不影响轮次开始 / 结束，会话不会卡在运行中。
- [x] 普通用户消息（包括只是提到 `<skill` 的文本）原样显示。
- [x] `pi/agent.test.ts`、`pi/history-mapper.test.ts` 覆盖上述规则，原有用例不改断言、继续通过。
- [x] OMP 的 skill 展开处理已核对，结论记录在任务里（见下文「OMP 核对结论」；有问题，但按用户决定另开任务）。
- [x] Claude Code、Codex 的映射代码无改动。
- [x] `docs/providers.md` 写明 custom 消息的 `display` 约定与 skill 展开块还原。
- [x] 改动涉及的包 typecheck 与 lint 通过。

## 实现落点

- `pi/rpc-types.ts`：custom 消息补 `customType?: string`、`display?: boolean`。
- `pi/history-mapper.ts` 导出两个共用函数（与已被实时路径复用的 `getUserMessageText` 同处）：
  - `shouldDisplayPiCustomMessage(message)`：`message.display !== false`。
  - `restorePiSkillCommand(text)`：正则与 Pi `parseSkillBlock` 相同
    （`/^<skill name="([^"]+)" location="[^"]+">\n[\s\S]*?\n<\/skill>(?:\n\n([\s\S]+))?$/`），
    命中返回 `/skill:<name>` 或 `/skill:<name> <args>`，否则原文返回。参数不再 trim——Pi 展开时已 trim。
- 实时路径：`PiRpcAgentSession.handleMessageEnd` 的 custom 分支先过可见性判定，
  `completeTurn` 不受影响；`handleSubmittedUserEntryMarker` 用还原后的文本生成 `user_message`。
  steer 关联仍按原文 `entry.text` 匹配：`/skill:` 输入会被 `parseSlashCommandInput` 识别为斜杠命令，
  `steerActiveTurn` 对斜杠命令直接返回 `unavailable`，skill 永远不会进入 steer 匹配。
- 回放路径：`PiHistoryMapper.mapUserMessage` 还原 skill 块；`mapCustomMessage` 先判定可见性再交给 hook。

## OMP 核对结论（2026-09-27）

问题存在，但形态与 Pi 不同，用户决定本任务不修、另开任务：

- OMP 17.3.3 的 RPC 模式下，`/skill:name args` 由 `tryRunRpcSkillCommand`
  （`@oh-my-pi/pi-coding-agent/src/modes/rpc/rpc-mode.ts`）以 custom 消息发出：
  `customType: "skill-prompt"`、`display: true`、`attribution: "user"`、`details: { name, path, args, lineCount }`，
  正文是 `[IMPORTANT: User invoked the "name" skill; …]` + 整份 skill + `User: args`。没有 `<skill>` 包裹。
  `skills.enableSkillCommands` 默认开启。
- Osuna 的 OMP 适配层（`omp/agent.ts` `handleMessageEnd`、`omp/message-history.ts` `mapCustomMessage`）
  把它当可见 custom 消息映射成 `assistant_message`：实时和回放都把整份 skill 正文显示为助手回复，
  回放里还缺少用户那条 `/skill:name` 行。
- 修复需要按 `customType`/`attribution`/`details` 映射成 `user_message`，并处理实时路径与 daemon canonical
  用户行的关联去重；另外 `handleMessageEnd` 在 `!activeTurnHasUserMessage` 时会 `completeTurn`，
  skill 轮次是否被提前结算尚未验证。

## Further Notes

- 访谈与调研记录：`research/interview-decisions.md`（含证据会话文件、各处代码位置）。
- 同批次任务：`09-27-composer-branch-switch`、`09-27-markdown-preview-dom`，本任务先做。
- 用户最初描述为「调用 skill 会全文显示」；截图中实际是 ATW 注入上下文。两者在本任务中一并处理。
