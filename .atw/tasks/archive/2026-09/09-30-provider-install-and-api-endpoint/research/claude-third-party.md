# Claude Code 接第三方端点（2026-09-29 调研）

## 认证优先级

来源：https://code.claude.com/docs/en/authentication 的 Authentication precedence 一节。优先级从高到低：

1. 云厂商（`CLAUDE_CODE_USE_BEDROCK` / `VERTEX` / `FOUNDRY`）
2. `ANTHROPIC_AUTH_TOKEN`，以 Bearer 方式发送
3. `ANTHROPIC_API_KEY`，以 x-api-key 方式发送
4. `apiKeyHelper`
5. `CLAUDE_CODE_OAUTH_TOKEN`
6. Anthropic profile
7. `/login` 登录的订阅账号

几条相关事实：

- 设置 `CLAUDE_CONFIG_DIR` 后，登录凭据（包括 macOS 钥匙串条目）按目录分开存放。
- 有人遇到过：环境里只要有 `ANTHROPIC_AUTH_TOKEN`，订阅账号的请求就会 401（anthropics/claude-code#33330）。
- OpenRouter 要求把 `ANTHROPIC_API_KEY` 显式置空，并建议先执行 `/logout`，因为登录缓存和 token 同时存在时，可能出现冲突警告或「找不到模型」（https://openrouter.ai/docs/cookbook/coding-agents/claude-code-integration ）。这一点**没有实测**。

## settings.json 与环境变量

- 官方文档写明：`settings.json` 的 `env` 块和 shell 环境变量冲突时，以 settings 为准；并且 `env` 的改动会**重新应用到正在运行的会话**（https://code.claude.com/docs/en/env-vars 的 Precedence 一节）。
- settings 的层级从高到低：托管 > 命令行 `--settings` > 项目 local > 项目 > 用户（https://code.claude.com/docs/en/settings ）。
  - Agent SDK 的 `settings` 选项等同于 `--settings`（`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1987-2003`，v0.3.246）。
- Osuna 启动 Claude 时加载 user、project、local 三层 settings（`packages/server/src/server/agent/providers/claude/agent.ts:151`）。

## OpenRouter

- `ANTHROPIC_BASE_URL=https://openrouter.ai/api`
- key 放在 `ANTHROPIC_AUTH_TOKEN`
- `ANTHROPIC_API_KEY=""`

## 模型别名

- `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU,FABLE}_MODEL` 只改写别名，**不改写完整 id**（https://code.claude.com/docs/en/model-config ）。
- HAIKU 还用于后台任务。在第三方网关上，如果没设 HAIKU，后台任务会改用主模型。
- `ANTHROPIC_SMALL_FAST_MODEL` 已废弃。
- `modelOverrides` 可以把完整 id 映射到网关 id。
- `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY` 只保留 id 里含 claude 或 anthropic 的模型。
- Osuna 目前默认传给 SDK 的是完整 id `claude-opus-5-5`（`packages/app/src/provider-selection/resolve-agent-form.ts:131`、`claude/agent.ts:3333`）。所以启用第三方接口时，选择器必须改为传真实 id。
- Osuna 会从 `~/.claude/settings.json` 读取模型并追加到选择器里（`claude/models.ts:79-141`），只读 settings.json，不读 settings.local.json。启用第三方接口时，要防止这些条目和勾选的模型重复出现。
