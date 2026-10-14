# 两个 Agent 能不能接受带斜杠的模型名（票 01）

日期 2026-10-13。两条子调研分别读 Claude Code 官方文档（`code.claude.com/docs/en/<page>.md` 直链全文）与本仓库捆绑的 `@anthropic-ai/claude-agent-sdk` v0.3.246（捆绑 CLI 2.1.246）类型声明，以及 Codex 源码（`github.com/openai/codex` HEAD `90f00bd`，2026-10-13，浅克隆到 `/tmp/codex-src-ro/codex/` 只读）。本机未运行 `claude` / `codex`。

## 结论先行

| 项目 | 结论 | 依据 |
|---|---|---|
| Claude Code 接受 `kimi/kimi-k2.5` 这类带斜杠的模型名 | **能**。不做前置格式校验，官方文档有 `anthropic/claude-opus-4-8`、`my-gateway/claude-opus-5-5` 的斜杠示例；认不出的 ID 原样发送 | model-config.md:168、:821、:844-857；errors.md:5472 |
| 后台小任务（标题、摘要）请求什么模型名 | 用 `ANTHROPIC_AUTH_TOKEN` 认证时**跟主模型同名**；用 `ANTHROPIC_API_KEY` 时发默认 Haiku id；设 `ANTHROPIC_DEFAULT_HAIKU_MODEL` 可钉死 | llm-gateway-protocol.md:105；llm-gateway-connect.md:464 |
| `/model` 手动切换时的校验 | 对非别名的名字向 base URL 发一次最小探测请求，接口回 200 即通过 | errors.md:2333 |
| `count_tokens` | 走 `POST <base>/v1/messages/count_tokens`，10 秒超时，失败静默退回按字符估算；是唯一可选端点 | llm-gateway-protocol.md:43,53,222；二进制片段 |
| Codex 接受带斜杠的模型名 | **能**。`model` 是裸字符串，只拒绝空串；单段 `namespace/model` 还会剥前缀去找内置元数据 | config_toml.rs:168；session/mod.rs:738-742；models-manager/src/manager.rs:883-912 |
| Codex 不写模型目录时 | 模型照常可用，但 `/model` 只列内置 OpenAI 模型，且每轮发一条「未知模型，用回退元数据」警告 | manager.rs:545-553, 270-273；turn_context.rs:1395-1402 |
| Codex `model_catalog_json` | `config.toml` 顶层键，值为 JSON 文件绝对路径，启动时读一次；一旦提供，模型列表**完全以它为准**、不再访问远程 | config_toml.rs:404-406；core/src/config/mod.rs:2193-2220；model-provider/src/provider.rs:388-397 |
| Codex 请求体里的 `model` | `wire_api="responses"` 下 = 配置原文，无改写；`wire_api="chat"` 已被删除，写了直接解析报错 | core/src/client.rs:1072-1073；model-provider-info/src/lib.rs:105-133 |
| Osuna 自己的传参 | 两边都是字符串原样传（只 trim），无格式检查 | `providers/claude/agent.ts:1720-1726`；`providers/codex-app-server-agent.ts:367-376` |

**需绕开的点**：

1. Codex 必须由 Osuna 生成一份模型目录 JSON 并写 `model_catalog_json`，否则 `/model` 列表不含接口模型、每轮有警告。目录条目的必填字段见下文。
2. Claude Code 对不含 `claude-` 的名字按「自定义拼写」处理：默认按 200K 上下文、会发 `thinking: {type: "adaptive"}` 与 `output_config.effort` 字段。中转站转到不支持这些字段的上游时要剥掉或转换；可用 `CLAUDE_CODE_MAX_CONTEXT_TOKENS` 纠正窗口。
3. `[1m]` 后缀会在发送前被剥掉（model-config.md:913）；中转站不会收到它。
4. Claude Code 在 `ANTHROPIC_BASE_URL` 非官方时会关闭 MCP tool search 与 Remote Control（env-vars.md:147），属已知副作用。

## 一、Claude Code

### 模型名取值与校验

- `model` 设置 / `--model` / `ANTHROPIC_MODEL` 接受「别名或完整模型名」，非 Anthropic 时是「provider 自己的标识符」（model-config.md:11-23；settings-reference.md:1091-1097；cli-reference.md:108；env-vars.md:180）。同页原话："`ANTHROPIC_BASE_URL` changes where requests are sent, not which model answers them."
- 别名表：`default`、`best`、`fable`、`sonnet`、`opus`、`haiku`、`sonnet[1m]`、`opus[1m]`、`opusplan`（model-config.md:30-40）。
- 优先级：`/model` > `--model` > `ANTHROPIC_MODEL` > settings `model` > `ANTHROPIC_DEFAULT_MODEL`（model-config.md:118-124）。
- 不前置校验："Claude Code doesn't check it up front, and a mistyped value produces [There's an issue with the selected model] on the first request."（model-config.md:168）
- `/model <name>`：非别名时"verifies it with a minimal API request"，错误通常就是你的接口的回答；含空格等不可能是模型 ID 的名字直接报错（errors.md:2333）。网关下只有空串会得到 "not a recognized model id"。
- 未识别 ID 照样发："Claude Code still sends the request with the ID as you configured it, and doesn't exit or switch models."，只在 stderr 记 `[claude-code:unrecognized_model]`，在 `modelOverrides` 加同名条目可消音（errors.md:5472；model-config.md:987）。
- 斜杠示例：`anthropic/claude-opus-4-8`（model-config.md:821）、`my-gateway/claude-opus-5-5`（:844,857，并说 "you can use any string your API endpoint accepts"）、Bedrock ARN 直接作 `ANTHROPIC_MODEL`（amazon-bedrock.md:342）。
- 不以 `claude-` 开头的 ID 按 provider/custom spelling 处理（model-config.md:811）。
- 四个档位 `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU,FABLE}_MODEL`："Each value must be a full model name, or the equivalent identifier for your API provider."（model-config.md:861）；`_NAME` / `_DESCRIPTION` 在网关下有效，`_SUPPORTED_CAPABILITIES` 无效（:936；llm-gateway-protocol.md:224）。
- SDK：`Options.model?: string`（sdk.d.ts:1784）、`fallbackModel?: string`（逗号分隔多个，:1526）、`setModel(model?: string)`（:2459）、`supportedModels(): ModelInfo[]`（:2552；`ModelInfo.value` 是"Model identifier to use in API calls"，:1247-1286）。只有子代理工具参数 `model?: "sonnet"|"opus"|"haiku"|"fable"` 是联合类型（sdk-tools.d.ts:685），不影响配置。

### 后台小任务

- `ANTHROPIC_SMALL_FAST_MODEL` 已弃用，改用 `ANTHROPIC_DEFAULT_HAIKU_MODEL`（env-vars.md:183；model-config.md:874）；2.1.246 二进制仍含该变量名字符串 17 处（单一来源）。
- 网关下后台任务模型："The main model, or the default Haiku model when `ANTHROPIC_API_KEY` or `apiKeyHelper` supplies an Anthropic Console key and `ANTHROPIC_AUTH_TOKEN` is unset"（llm-gateway-protocol.md:105）。Osuna 现有接线用 `ANTHROPIC_AUTH_TOKEN` 且把 `ANTHROPIC_API_KEY` 置空（`claude-settings-patch.ts:67-70`），所以后台任务跟主模型。
- 后台请求种类：会话标题（sessions.md:166，`CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1` 可关）、`--resume` 摘要、`/usage`（costs.md:354-361）、hook agent 默认 Haiku（sdk.d.ts:5758）。`CLAUDE_CODE_GATEWAY_HINT_HEADERS=1` 时每个请求带 `x-claude-code-request-class: main|subagent|workflow|compaction|auxiliary`（llm-gateway-protocol.md:140-149），中转站可据此区分。
- `CLAUDE_CODE_SUBAGENT_MODEL` 接受别名或完整名；子代理定义里的 `model` 与 spawn 时传的值优先（env-vars.md:399）。

### 请求体与端点

- Anthropic Messages 格式端点：`/v1/messages`、`/v1/messages/count_tokens`（可选）；`HEAD /api/hello` 预热探测可拒绝；`GET /v1/models?limit=1000` 仅在 `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1` 时（llm-gateway-protocol.md:43-60, 267-327）。
- 不认识的模型名被当作"current models"，请求体会带 adaptive thinking、effort、context management 字段（llm-gateway-protocol.md:99-105, 216）；网关应把 `anthropic-*` 头和请求体字段原样透传（:165-171）。
- 相关开关：`CLAUDE_CODE_MAX_CONTEXT_TOKENS`、`CLAUDE_CODE_ALWAYS_ENABLE_EFFORT`、`CLAUDE_CODE_DISABLE_THINKING`、`ENABLE_TOOL_SEARCH`、`CLAUDE_CODE_AUTO_COMPACT_WINDOW`（env-vars.md:213,279,322,471；llm-gateway-connect.md:540）。
- `ANTHROPIC_AUTH_TOKEN` 作为 `Authorization: Bearer <token>`（env-vars.md:143）；`ANTHROPIC_CUSTOM_HEADERS` 需 v2.1.227+（:153）。
- 官方立场：不支持把 Claude Code 路由到非 Claude 模型（llm-gateway.md:13），但协议上不阻止。

## 二、Codex

### 模型名

- 配置类型全是 `Option<String>`（config_toml.rs:168；profile_toml.rs:25；core/src/config/mod.rs:638,2679；CLI `-m` shared_options.rs:22-23）；合并只做 `model.or(cfg.model)`（mod.rs:4083）；会话启动只拒绝空串（session/mod.rs:738-742）。
- 未知模型 → 回退元数据不报错（models-manager/src/model_info.rs:98-135，272K 窗口，`used_fallback_model_metadata: true`）。
- 元数据查找：先最长前缀匹配，再对**单段** `namespace/model` 剥前缀重试，namespace 只能是 `[A-Za-z0-9_-]`；`ns1/ns2/x` 走回退（manager.rs:883-912；单测 manager_tests.rs:817-870）。返回的 `slug` 始终是配置原文（manager.rs:914-926）。
- 用回退元数据的副作用：每轮一条 Warning 事件（turn_context.rs:1395-1402）；step 切换的 `check_legacy_model_safety` 对回退模型返回 Err（step_activation.rs:88-100）。

### `model_catalog_json`

- 定义：`config.toml`（及 profile 文件）顶层键，`Option<AbsolutePathBuf>`，"applied on startup only"（config_toml.rs:404-406）；也可由 managed `requirements.toml` 强制（config_requirements.rs:170,1660-1662）。
- 读取：`serde_json::from_str::<ModelsResponse>`，空列表报错 "must contain at least one model"（core/src/config/mod.rs:2193-2220，调用 :4203）。
- JSON 结构 `{"models":[ModelInfo,…]}`（protocol/src/openai_models.rs:851-857）。**必填字段**（无 serde default）：`slug`、`display_name`、`supported_reasoning_levels`（数组）、`shell_type`、`visibility`（`"list"|"hide"|"none"`）、`supported_in_api`、`priority`、`support_verbosity`、`truncation_policy`（`{mode, limit}`）、`experimental_supported_tools`（数组）。模板取内置 `codex-rs/models-manager/models.json` 一条；测试 config_tests.rs:9834-9860 正是这么做的。
- 提供后 → `StaticModelsManager`，列表完全以它为准，不访问远程（model-provider/src/provider.rs:388-397；manager.rs:804-838）。
- 不提供时（自定义 provider、有 `base_url`、无 `model_catalog_url`）：不打 `/v1/models`（models_endpoint.rs:213-216；manager.rs:545-553,660-665），列表退回内置 `models.json`（manager.rs:270-273）；TUI `/model` 当前模型不在列表时只是显示名退回原字符串（tui/src/chatwidget/model_popups.rs:82-96）；配置里写的模型照常使用。
- 官方文档第二来源：developers.openai.com/codex/config-reference 表格行 `model_catalog_json`；config-advanced 示例 `model_catalog_json = "/Users/me/.codex/model-catalogs/deep-review.json"`。
- magpie 写它的原因正是上面两条：让 `/model` 列出接口模型并消掉警告。

### 请求体与 wire_api

- `ResponsesApiRequest.model = model_info.slug.clone()`（core/src/client.rs:1072-1073），即配置原文；WebSocket 路径同（codex-api/src/common.rs:279-309）。
- `WireApi` 只剩 `Responses`，`"chat"` 反序列化报错并指向 discussions/7782（model-provider-info/src/lib.rs:100-133）；官方文档："`responses` is the only supported value"。

### app-server

- `thread/start` 的 `model: Option<String>`、`model_provider: Option<String>`、实验性 `allow_provider_model_fallback: bool`（app-server-protocol v2/thread.rs:62-71），处理端直接透传，不校验（thread_processor.rs:1150-1153,1511-1513）；CLI/TUI 默认 `allow_provider_model_fallback=false`（thread_manager.rs:314）。
- `model/list` 返回当前 ModelsManager 的目录，经 `show_in_picker`（`visibility == list`）过滤（catalog_processor.rs:280-331；app-server/src/models.rs:8-14）。

### 鉴权

- `env_key` → `experimental_bearer_token` → 二者皆无且 `!requires_openai_auth` 则不发 Authorization 头（model-provider/src/auth.rs:197-222,292-304）；`[auth]`（命令取 token，Osuna 现用）不能与 `env_key` / `experimental_bearer_token` / `requires_openai_auth` 同用（lib.rs:376-392）。`requires_openai_auth` 默认 false，留默认即跳过登录（lib.rs:190-196）。内置 `openai`、`ollama`、`lmstudio` id 保留不可覆盖。

## 三、Osuna 现有接线

- Claude：`api-endpoints/claude-settings-patch.ts:67-75` 写 `ANTHROPIC_BASE_URL`、`ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_API_KEY=""`、`ANTHROPIC_MODEL=默认模型`、已映射档位的 `ANTHROPIC_DEFAULT_<TIER>_MODEL`；`permissions.deny` 加 `"WebSearch"`（:151-160）。
- Codex：`api-endpoints/codex-config-patch.ts:60-110` 写顶层 `model_provider = "osuna_api_endpoint"`、`model`，专用表 `[model_providers.osuna_api_endpoint]` 整块追加到文件末尾（`auth.command` 读 0600 key 文件，见 ADR 0004）。**目前不写 `model_catalog_json`。**
- 会话创建：Claude `providers/claude/agent.ts:1720-1726` 把 `config.model` trim 后原样交给 SDK `query` 的 `model`；Codex `providers/codex-app-server-agent.ts:367-376` `normalizeCodexModelId` 只 trim；两边都无格式检查。

## 没查到 / 单一来源

- 文档没有一句直接写"任意字符串原样发往 `ANTHROPIC_BASE_URL`"，是由"不前置校验 + 未识别 ID 照样发 + `ANTHROPIC_CUSTOM_MODEL_OPTION` 任意字符串"三条推出的。
- 官方斜杠示例都内嵌 `claude-`；完全不含 `claude-` 的斜杠名（`kimi/...`）只有"按自定义拼写处理"的推论性描述，实现时须用假上游 e2e 实测。
- `/model` 探测请求的端点与请求体形态文档只说 "a minimal API request"。
- `count_tokens` 是否在压缩前调用：未查到。
- `model_catalog_json` 的字段级说明只有源码（`ModelInfo` 结构体 + 内置 `models.json`）一处来源。
- `wire_api="chat"` 删除的版本号未找到。
