# 01 — 两个 Agent 能不能接受带斜杠的模型名

Type: research
Status: resolved
Blocked by: None

## Question

模型名定为 `接口标识/模型名`（如 `kimi/kimi-k2.5`，决策 Q20）。要查清：

1. **Claude Code**：`model` 字段、`ANTHROPIC_MODEL`、`ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU,FABLE}_MODEL`、`/model` 命令、`--model` 参数，以及 Osuna 用的 Claude Agent SDK 的 `model` 选项，是否原样把含 `/` 的字符串发给 `ANTHROPIC_BASE_URL`，有没有白名单或格式校验；后台小任务（标题生成、子代理、`ANTHROPIC_SMALL_FAST_MODEL`）会请求什么模型名；`count_tokens` 什么时候调用。
2. **Codex**：`model` 含 `/` 时 app-server 与 TUI 是否接受；`model_catalog_json` 是什么、magpie 为何写它（`magpie/internal/agent/codex.go:30-62, 346-352`）、不写会怎样（`/model` 列表、未知模型的处理）；`model_providers.<id>` 的 `wire_api="responses"` 下模型名是否原样转发。Codex 是开源的（github.com/openai/codex），读源码。
3. Osuna 现有接线：`packages/server/src/server/api-endpoints/claude-settings-patch.ts` 与 `codex-config-patch.ts` 现在写哪些键、`packages/server/src/server/agent/providers/` 里创建会话时模型如何传给两个 CLI。

产出 `research/slash-model-ids.md`：每条结论附文档或源码出处；明确「能 / 不能 / 需绕开」，并列出绕开方案（例如模型名改用其他分隔符）。本机不运行需要登录的 CLI。

## Answer

- Claude Code：能。模型名不做前置格式校验，官方文档有带斜杠示例，认不出的 ID 原样发往 `ANTHROPIC_BASE_URL`；`/model` 手动切换时向接口发一次最小探测请求。用 `ANTHROPIC_AUTH_TOKEN` 认证时后台小任务跟主模型同名。
- Codex：能。`model` 是裸字符串、只拒空串；但必须由 Osuna 生成模型目录 JSON 并写 `model_catalog_json`，否则 `/model` 列表不含接口模型且每轮有「未知模型」警告。`wire_api` 只剩 `responses`。
- Osuna 自己两边都原样传参（只 trim）。
- 需绕开：Codex 模型目录；Claude 对非 `claude-` 名字会发 adaptive thinking / effort 字段，中转站转到不支持的上游时要剥掉；`[1m]` 后缀发送前被剥。
- 报告：`research/slash-model-ids.md`
