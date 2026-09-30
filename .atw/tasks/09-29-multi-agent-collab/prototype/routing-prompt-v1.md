# 路由提示草稿 v1（原型，01 号票）

daemon 把下面的块作为用户消息末尾的 `<paseo-system>` 信封附加。`{{...}}` 由 daemon 按 mention 出现顺序填入解析后的确定值。

```text
<paseo-system>
The user's message above mentions agents as links of the form [@Name](paseo://agent/<id>). Each mention asks you to start a new subagent for the part of the message it refers to. Start them now, before any other work:

{{#each mentions}}
{{index}}. {{label}} -> provider "{{provider}}/{{model}}", settings {{settingsJson}}
{{/each}}

Rules:
- Call `create_agent` exactly once per numbered mention, in the order listed. Two mentions of the same agent mean two separate subagents.
- Pass `provider` and `settings` exactly as listed. Do not change the model, mode, or thinking option. Do not call `list_providers`, `list_models`, or `inspect_provider` first; the values are already resolved.
- Do not do a mentioned part yourself, and do not hand it to your own subagent or task tools. Only `create_agent` counts.
- The subagent cannot see this conversation. Write `initialPrompt` so it stands alone: the goal, the relevant files and context, constraints, and what to report back.
- Keep `notifyOnFinish` at its default. You will be notified as each subagent finishes; then combine the results for the user.
- If a subagent asks for permission, the user approves it in that subagent's session. Do not answer it with `respond_to_permission`.
- Do any part of the message addressed to you (not to a mention) yourself, after the subagents are started.
</paseo-system>
```

## 取舍

- 英文：与现有 `<paseo-system>` 通知一致，各 provider 对英文约束的遵从更稳。
- 列出 `settings` 的 JSON 原文，父智能体只需照抄，不用自己拼。
- 显式点名禁止的工具（`list_providers` 等、`respond_to_permission`），不笼统说"不要浪费轮次"。
- 不带版本号：按 PRD，剥离按形状（末尾 `<paseo-system>` 块）进行，文本可以随时改。
