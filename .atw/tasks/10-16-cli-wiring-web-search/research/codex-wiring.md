# Codex 接内置中转站的接法：事实核对

调研日期 2026-10-17。只查事实，不做取舍、不写推荐。没有运行 `codex`、`claude`，没有读写 `~/.codex`、`~/.claude`、magpie 的数据目录或钥匙串；外部源码只在新建的临时目录里用 grep / sed / cat 读。

## 读的版本

- Osuna：`main` @ `d8948dad29d9`（2026-10-17，合并 PR #20 之后）。
- Codex：`openai/codex` `main` @ `ce0323f2f2d3b25e82806cd555237da3db4e1897`（2026-10-17 04:02 UTC，"Support typed content in contextual prompt fragments (#54776)"），`--depth 1` 克隆。最近的正式版 tag 是 `rust-v0.163.0`（指向提交 `83086188ae06`），最近的预发布是 `rust-v0.164.0-alpha.3`。下文行号按 main；第 1、2、3（内置 openai 默认地址、WebSocket）、4、5 题的关键几处又在 `rust-v0.163.0` 的同名文件上比对过，内容一致，行号相同或只差几行。
- magpie：`yetone/magpie` @ `7597c13237c6eaecba89b478771f2f1d244108e4`（2026-10-16）。

引用写法：`codex:` 后的路径相对 `codex-rs/`；`magpie:`、`osuna:` 相对各自仓库根；`…/codex-app-server-agent.ts` 指 `osuna:packages/server/src/server/agent/providers/codex-app-server-agent.ts`。

标注：「源码核实」读过源码；「文档所说」来自文档、代码注释或提交说明；「推断，未核实」没有直接证据或没有运行验证。

---

## Codex 本身

### 1. 列线程时怎么按服务商过滤

app-server `thread/list`（Osuna 用的就是它）：

- 参数 `modelProviders`（`ThreadListParams.model_providers: Option<Vec<String>>`）。协议注释：设了就只返回记在这些服务商名下的线程；传了但为空数组则包括全部服务商。`codex:app-server-protocol/src/protocol/v2/thread.rs:1421-1424`（源码核实）
- 不传（省略或 null）：只列 app-server 自己配置里的当前服务商 `self.config.model_provider_id`。唯一例外是带了 `parentThreadId` / `ancestorThreadId`，这时不按服务商过滤。`codex:app-server/src/request_processors/thread_processor.rs:2681-2694,5788-5798`（源码核实；rust-v0.163.0 同处第 5797 行相同）
- "当前服务商"取值：托管 requirements 的 `model_provider` > 调用方覆盖 > config.toml 顶层 `model_provider` > `"openai"`。`codex:core/src/config/mod.rs:3955-3958`（源码核实）
- 旧 rollout 没记服务商的，提取元数据时按当时的默认服务商补上。`codex:state/src/extract.rs:46-48`（源码核实）
- 按 id 读的 `thread/read` 不按服务商过滤，当前服务商只用来填返回值的缺省。`codex:app-server/src/request_processors/thread_processor.rs:3050-3066`（源码核实）
- 列出、读出的每条 Thread 都带 `modelProvider` 字段。`codex:app-server-protocol/src/protocol/v2/thread_data.rs:242-243`（源码核实）

终端 `codex resume`：

- 选择器、`--last`、按名字查，都按"历史服务商"过滤：命令行 `-c model_provider=…` 或 `--profile` 指定的优先，否则读生效配置的 `model_provider`，缺省 `openai`；作为 `thread/list` 的 `modelProviders: [这一个]` 发出去。`codex:tui/src/app_server_session/provider_selection.rs:8-23,26-38,40-65`；`codex:tui/src/resume_picker.rs:688-695,2106-2125`；`codex:tui/src/lib.rs:867-940`（源码核实）
- `--all` 只取消"当前目录"过滤并显示 CWD 列，不管服务商；选择器里的 Cwd / All 切换也只切目录。`--include-non-interactive` 额外列 exec、app-server 来源。没有"列出全部服务商"的开关。`codex:cli/src/main.rs:354-378`；`codex:tui/src/resume_picker.rs:1913-1934`（源码核实）
- `codex resume <UUID>` 用 `thread/read` 按 id 找，不按服务商过滤；`codex resume <名字>` 按历史服务商过滤。`codex:tui/src/lib.rs:818-865`（源码核实）
- 来源：默认只列 Cli、VSCode 来源。`codex app-server`（Osuna 起的就是它）建的线程来源记为 VSCode，所以 Osuna 建的对话会出现在终端选择器里，仍受服务商与目录过滤。`codex:tui/src/lib.rs:807-816`；`codex:cli/src/main.rs:1282-1292`；`codex:app-server/src/filters.rs:55-58`（源码核实；没有运行看实际结果）

### 2. 服务商记在哪；恢复时用哪个；记的服务商不在了会怎样

记在三处：

- rollout 第一行 `session_meta` 的 `payload.model_provider`（`SessionMeta.model_provider`）。`codex:protocol/src/protocol.rs:3297`（源码核实）
- rollout 里的 `ThreadSettingsApplied` 事件（线程设置快照，字段 `model_provider_id`）。这种事件会写进 rollout；恢复线程时 Codex 会马上用当前生效的设置写一条，哪怕之后没有新的一轮。`codex:protocol/src/protocol.rs:2337-2339`；`codex:rollout/src/policy.rs:139`；`codex:core/src/session/mod.rs:1721-1725`（源码核实；rust-v0.163.0 的 policy.rs:139 相同）
- 状态库 `state_<n>.sqlite` 的 `threads.model_provider`（建了索引）。从 rollout 提取时先取 session_meta 的值，再被后面的 `ThreadSettingsApplied` 覆盖。`codex:state/migrations/0001_threads.sql:7,25`；`codex:state/src/extract.rs:106-108,162-166`（源码核实）

恢复时用哪个：

- app-server `thread/resume`：请求里没有 `model`、没有 `modelProvider`，`config` 里也没有 `model`、`model_reasoning_effort` 时，取状态库里这条线程记的模型和服务商作为覆盖；有其中任何一项，就两者都不取，改用请求值或当前配置。状态库里没有这一行时也用当前配置。`codex:app-server/src/request_processors/thread_processor.rs:235-252,279-288,4110-4163,4460-4496`（源码核实；rust-v0.163.0 第 245 行相同）
- 托管 requirements 里的 `model_provider` 压过以上一切。`codex:core/src/config/mod.rs:3955`（源码核实）
- 终端 `codex resume <id>`：TUI 默认"按线程恢复"，不发模型和服务商；只有命令行带了 `-m`、`-c model=` / `model_provider=` / `model_reasoning_effort=`、所选 profile 设了这些、或别的启动参数覆盖了 model / model_provider 时，才把当前配置的模型和服务商显式发出去。"显式服务商"只认命令行层和 profile 层，config.toml 本体里的 `model_provider` 不算。`codex:tui/src/app/config_persistence.rs:31-56`；`codex:tui/src/app_server_session.rs:354-363,2194-2260`；`codex:tui/src/app_server_session/provider_selection.rs:8-23`（源码核实）

记的服务商在 config 里已不存在：

- 配置加载直接失败，错误文本 ``Model provider `<id>` not found``，app-server 回 JSON-RPC 错误 `failed to load configuration: …`。没有退回当前服务商的逻辑：整个 codex-rs 只有这一处和子 Agent 恢复那一处报这个错，子 Agent 那处同样报错、不退回。`codex:core/src/config/mod.rs:3959-3969`；`codex:app-server/src/request_processors/config_errors.rs:16-35`；`codex:core/src/agent/control/spawn.rs:466-477`（源码核实；rust-v0.163.0 的 config/mod.rs:3946 相同）
- 显式指定另一个服务商恢复后，恢复时写的设置快照带新服务商，状态库会把这条线程改记到新服务商名下。（推断，未核实：写入与提取两段源码各自读过，整条链路没跑）

### 3. 顶层 openai_base_url

版本与状态：

- 由提交 `4b9d5c8c1b`「Add openai_base_url config override for built-in provider (#12031)」加入（2026-03-13）。提交说明：用它取代常被误设的 `OPENAI_BASE_URL` 环境变量，缺这个键时退回环境变量并提示已废弃。（文档所说：GitHub 提交说明）
- 第一个包含它的正式版是 `rust-v0.115.0`（2026-03-16 发布）：GitHub compare 显示该提交相对 `rust-v0.114.0` 为 diverged、相对 `rust-v0.115.0` 为 ahead；`rust-v0.114.0` 的 `core/src/config/mod.rs` 里没有这个键，`rust-v0.115.0` 第 1367 行有。（源码核实：compare API 与两个 tag 的原始文件）
- 当前 main 的 codex-rs 里，除 network-proxy 外已没有读 `OPENAI_BASE_URL` 环境变量的地方。（源码核实：grep）
- 不是实验键：名字不带 `experimental_`，字段注释是 "Base URL override for the built-in `openai` model provider."，schema 里也没有实验标记。`codex:config/src/config_toml.rs:430-431`；`codex:core/config.schema.json:7966-7969`（源码核实）

作用范围：

- 它被写进内置 openai 服务商的 `base_url`。`codex:core/src/config/mod.rs:3946-3953`；`codex:model-provider-info/src/lib.rs:526-529,660-664`（源码核实）
- 实际请求地址 = 服务商的 `base_url`；没有时才按登录方式取默认：ChatGPT 一类登录（Chatgpt、ChatgptAuthTokens、Headers、AgentIdentity、PersonalAccessToken）默认 `https://chatgpt.com/backend-api/codex`，其余（API key）默认 `https://api.openai.com/v1`。所以设了 `openai_base_url`，ChatGPT 登录和 API key 登录都改去这个地址。`codex:model-provider-info/src/lib.rs:80,427-445`（源码核实；rust-v0.163.0 第 80 行相同）
- 账号、用量这类 ChatGPT 后端接口走另一个键 `chatgpt_base_url`（缺省 `https://chatgpt.com/backend-api/`），不受 `openai_base_url` 影响。`codex:core/src/config/mod.rs:4575-4577`（源码核实）

请求路径（都是 base_url 加相对路径，源码核实）：

- `POST {base}/responses`，`Accept: text/event-stream`（SSE）。`codex:codex-api/src/endpoint/responses.rs:134-148`
- 同一地址的 WebSocket（`/responses`，http→ws、https→wss）。`codex:codex-api/src/endpoint/responses_websocket.rs:464`；`codex:codex-client/src/provider.rs:91-102`
- `GET {base}/models?client_version=<版本>`。`codex:model-provider/src/models_endpoint.rs:44-45`；`codex:codex-api/src/endpoint/models.rs:37-44`
- `POST {base}/alpha/search`（独立搜索，见第 6 题）。`codex:codex-api/src/endpoint/search.rs:15`
- 另有 `memories/trace_summarize`、`realtime/calls`。`codex:codex-api/src/endpoint/memories.rs:32-34`；`codex:codex-api/src/endpoint/realtime_call.rs:62-64`
- 不设 `openai_base_url` 的 ChatGPT 登录即 `https://chatgpt.com/backend-api/codex/responses` 等。

ChatGPT 登录时请求带的头（内置 openai 服务商）：

- `Authorization: Bearer <ChatGPT access token>`、`ChatGPT-Account-ID: <账号 id>`；FedRAMP 账号另加 `X-OpenAI-Fedramp: true`。API key 登录是 `Authorization: Bearer sk-…`，没有账号 id。`codex:model-provider/src/bearer_auth_provider.rs:31-47`；`codex:model-provider/src/auth.rs:307-325`（源码核实）
- `originator`：进程级取值为 `CODEX_INTERNAL_ORIGINATOR_OVERRIDE` 环境变量 > 第一个"会改身份"的 app-server 客户端名 > `codex_cli_rs`。每条线程还有自己的 originator（特定 metrics 服务名 > rollout 记的 > 父线程的 > 环境变量 > 进程级），和进程级不同时覆盖请求头。`codex:login/src/auth/default_client.rs:42-43,64-83,125-139`；`codex:app-server/src/request_processors/initialize_processor.rs:130-133,166-185`；`codex:core/src/thread_manager.rs:393-405,1945-1985`（源码核实）
- `User-Agent: <originator>/<Codex 版本> (<系统> <版本>; <架构>) <终端信息>`；"会改身份"的客户端再加 ` (<clientInfo.name>; <version>)`。`codex:login/src/auth/default_client.rs:152-175`；`codex:app-server/src/request_processors/initialize_processor.rs:131,192-194`（源码核实）
- Osuna 用 `clientInfo.name = "codex_app_server_daemon"` 初始化，这个名字在 Codex 的"不改身份"名单里，所以 Osuna 起的 Codex 用默认 originator `codex_cli_rs`，UA 不加后缀。终端 TUI 的客户端名是 `codex-tui`。`codex:app-server/src/request_processors/initialize_processor.rs:19,132`；`osuna:…/codex-app-server-agent.ts:156-163`；`codex:tui/src/lib.rs:527,754`（源码核实）
- 内置 openai 固定带 `version: <Codex 版本>`；环境变量非空时带 `OpenAI-Organization`（取 `$OPENAI_ORGANIZATION`）、`OpenAI-Project`（取 `$OPENAI_PROJECT`）。`codex:model-provider-info/src/lib.rs:397-423,539-554`（源码核实）
- 会话相关：`session-id`、`thread-id`、`x-client-request-id`（等于线程 id）、子 Agent 的 `x-openai-subagent`；`x-codex-beta-features`、`x-codex-turn-state`、`x-codex-window-id`、`x-codex-turn-metadata`、`x-codex-parent-thread-id`，有时 `x-oai-attestation`、Responses Lite 头。`codex:codex-api/src/requests/headers.rs:5-31`；`codex:codex-api/src/endpoint/responses.rs:86-93`；`codex:core/src/client.rs:1455-1480,2466-2493`；`codex:core/src/responses_metadata.rs:382-410`（源码核实）
- 管理端要求数据驻留时 `x-openai-internal-codex-residency`；ChatGPT 工作区路由生效时 `x-openai-account-routing-override`。`codex:model-provider-info/src/lib.rs:41,447-453`；`codex:model-provider/src/workspace_routing.rs:12,71-75`（源码核实）
- 请求体：ChatGPT 一类登录 + 服务商是 OpenAI（按名字 "OpenAI" 判断）+ 功能 `enable_request_compression`（稳定、默认开）时，请求体用 zstd 压缩。`codex:core/src/client.rs:1734-1739`；`codex:features/src/lib.rs:1436-1439`；`codex:model-provider-info/src/lib.rs:616-618`（源码核实）。Osuna 中转站已按 `Content-Encoding` 解 zstd。`osuna:packages/server/src/server/api-endpoints/gateway/request-body.ts:11-12`（源码核实）

和接法相关的其他内置 openai 行为：

- WebSocket：内置 openai `supports_websockets: true`，Codex 先试 Responses-over-WebSocket；握手得到 426 立刻改走 HTTP，否则重试次数用尽才改走 HTTP，并在对话里给一条 "Falling back from WebSockets to HTTPS transport" 警告。Osuna 现在的专用表没写这个键（缺省 false）。`codex:model-provider-info/src/lib.rs:199,561`；`codex:core/src/client.rs:1111-1119,1620-1625`；`codex:core/src/responses_retry.rs:119-136`（源码核实；rust-v0.163.0 的 lib.rs:561 相同）。magpie 对 WebSocket 握手回 426。`magpie:internal/gateway/codex_backend.go:63-67`（源码核实）
- "ChatGPT 后端专用"的一组行为，只在服务商是内置 openai、且 base_url 为空或以 `/backend-api/codex` 结尾时打开：ChatGPT 工作区路由（可能改写请求的 origin）、Codex 专用响应头与 guardian 计费元数据、实验上下文 / token budget。`codex:model-provider-info/src/lib.rs:620-627`；`codex:model-provider/src/provider.rs:216-247`；`codex:model-provider/src/workspace_routing.rs:39-77`；`codex:core/src/client.rs:1189-1238`；`codex:core/src/session/token_budget.rs:21-33`（源码核实）。magpie 的地址以 `/backend-api/codex` 结尾，源码注释说正是为了让 Codex 继续把它当 ChatGPT 后端。`magpie:internal/gateway/codex_backend.go:29-35`（文档所说）
- 远程压缩（remote compaction）只给名字是 "OpenAI" 的服务商（或 Azure）打开；Osuna 专用表的名字是 "Osuna"。`codex:model-provider/src/capabilities.rs:31-40`；`osuna:packages/server/src/server/api-endpoints/codex-config-patch.ts:22`（源码核实）

### 4. 能不能让内置 openai 带上可识别的东西

- `[model_providers.openai]` 不能写：配置解析直接报错 "model_providers contains reserved built-in provider IDs: `openai`. Built-in providers cannot be overridden. Rename your custom provider (for example, `openai-custom`)."，整份配置加载失败。保留 id 有 amazon-bedrock、amazon-bedrock-runtime、openai、ollama、lmstudio；只有两个 bedrock 允许改 base_url、auth、http_headers、aws。所以给内置 openai 加 `http_headers`、`env_http_headers`、`query_params` 的路走不通。`codex:config/src/config_toml.rs:67-73,929-952,986-995`；`codex:model-provider-info/src/lib.rs:691-731`（源码核实；rust-v0.163.0 的 config_toml.rs:948 相同）
- 内置 openai 自带的 `env_http_headers`（`OpenAI-Organization` ← `$OPENAI_ORGANIZATION`、`OpenAI-Project` ← `$OPENAI_PROJECT`）是唯一能从外面加的头，取决于 Codex 进程的环境变量。Osuna 起 app-server 的环境由 Osuna 决定；终端里的 codex 只有用户自己 export 了才带。`codex:model-provider-info/src/lib.rs:397-423,544-554`；`osuna:…/codex-app-server-agent.ts:7288-7310`（源码核实）。这两个头会随请求发往上游，ChatGPT 后端怎么对待它们没核实。（推断，未核实）
- `openai_base_url` 里的路径段会保留：拼法是"base 去掉末尾 `/` + `/` + 路径"，最后才追加服务商的 `query_params`。写在 base_url 里的查询串会被拼成 `…?x=y/responses`，不会作为查询参数保留。内置 openai 的 `query_params` 是 None。`codex:codex-client/src/provider.rs:55-77`；`codex:model-provider-info/src/lib.rs:538`（拼法源码核实；查询串的实际请求形状是推断）
- config.toml 是终端和 Osuna 共用的，写在里面的 `openai_base_url` 两边一样。CLI 有 `-c key=value` 覆盖并会传给 app-server（`codex:cli/src/main.rs:1282-1292` 的 root_config_overrides）；Osuna 现在只用 `app-server [--enable goals]` 启动。`osuna:…/codex-app-server-agent.ts:7293-7296`（源码核实）。用 `-c openai_base_url=…` 让 Osuna 自己起的进程走另一个地址是否生效，没验证。（推断，未核实）
- 其他能拿来认的信号（只列存在什么）：
  - `CODEX_INTERNAL_ORIGINATOR_OVERRIDE` 环境变量能改 originator 和 UA 前缀。`codex:login/src/auth/default_client.rs:43,64-68`（源码核实）。Osuna 的注释写明特意用"不改身份"的客户端名，免得在提供方用量记录里显示成 Paseo。`osuna:…/codex-app-server-agent.ts:156-158`（文档所说）
  - 每个请求都带 `thread-id`、`session-id`；Osuna 知道自己线程的 id。`codex:codex-api/src/requests/headers.rs:5-14`（源码核实）
  - `turn/start` 的 `responsesapiClientMetadata` 会并入请求体 `client_metadata["x-codex-turn-metadata"]`。`codex:app-server-protocol/src/protocol/v2/turn.rs:200-215`（源码核实）。同一份元数据还有一个 `x-codex-turn-metadata` 请求头的兼容投影，客户端给的字段会不会出现在头里没核实。`codex:core/src/responses_metadata.rs:228-232,382-399`
  - originator 不能可靠区分来源：线程的 originator 以 rollout 记的为准，终端建的线程被 Osuna 恢复时，请求头里仍是建它的那个（如 `codex-tui`）。`codex:core/src/thread_manager.rs:393-405,1954`（取值顺序源码核实；实际请求是推断）

### 5. ChatGPT 登录时 /model 列表从哪来；model_catalog_json 是否生效

- 配了 `model_catalog_json`：直接用这个文件作完整目录（静态，不拉远程），不分登录方式。字段注释 "When set, this replaces the bundled catalog for the current process"；config 键注释 "applied on startup only. Per-thread `config` overrides are accepted but do not reapply this (no-ops)"。所以 ChatGPT 登录时是替换、不是合并：ChatGPT 自带模型不在 /model 里，除非文件里列了。`codex:model-provider/src/provider.rs:388-398`；`codex:core/src/config/mod.rs:1052-1054,2198-2228,4222`；`codex:config/src/config_toml.rs:404-406`（源码核实；rust-v0.163.0 的 provider.rs:393 相同）
- 没配：ChatGPT 一类登录会远程拉 `GET {base}/models?client_version=…`（5 秒超时），缓存在 `$CODEX_HOME/models_cache.json`（TTL 300 秒，缓存身份包含 base_url 与登录）；远程列表里有可见模型且是 ChatGPT 账号时只用远程列表，否则和内置清单合并。`codex:models-manager/src/manager.rs:34-35,653-700`；`codex:model-provider/src/models_endpoint.rs:44-45,84-89`；`codex:model-provider/src/models_identity.rs:13-41`；`codex:protocol/src/auth.rs:54-63`（源码核实）
- API key 登录：只有服务商是内置 openai 且 base_url 为空（或服务商配了 `model_catalog_url`）、功能 `api_key_model_discovery`（稳定、默认开）时才拉远程。设了 `openai_base_url` 后 base_url 不为空，就不再拉，/model 只剩内置清单。`codex:model-provider/src/models_endpoint.rs:212-216`；`codex:models-manager/src/manager.rs:653-679`；`codex:features/src/lib.rs:1417-1421`（源码核实）。magpie 注释里有同一说法（#322）。`magpie:internal/agent/codex.go:38-43`（文档所说）
- magpie 在 ChatGPT 旁路时不写 `model_catalog_json`（注释："a catalog file would stand in for the list magpie hands out"），由中转站的 `/backend-api/codex/models` 合并两边（第 8 题）；还会把 `~/.codex/models_cache.json` 的 `fetched_at` 改成 1970 年，让 Codex 重拉。`magpie:internal/agent/codex.go:984-993,1704-1729`（源码核实）。magpie 文档说 Codex 启动时读模型列表，切换后要重启。`magpie:docs/reference.md:1996`（文档所说）

### 6. web_search 相关（只列位置）

- 顶层 `web_search = "disabled" | "cached" | "indexed" | "live"`，缺省 cached；旧功能开关 `web_search_cached`、`web_search_request` 兜底；沙箱完全放开时偏向 live。`codex:config/src/config_toml.rs:474-476`；`codex:protocol/src/config_types.rs:376-382`；`codex:core/src/config/mod.rs:2741-2752,3152-3185,3907-3908`（源码核实）
- `[tools] web_search = { context_size, allowed_domains, location }`；旧的布尔写法仍能解析但被忽略。`codex:config/src/config_toml.rs:697-705,724-746`；`codex:protocol/src/config_types.rs:440-444`（源码核实）
- 发出的托管搜索工具：`{"type": "web_search", external_web_access, indexed_web_access, filters, user_location, search_context_size, search_content_types}`；cached → `external_web_access: false`，live → true，indexed → true 加 `indexed_web_access: true`；模型标了 TextAndImage 时带 `search_content_types`。源码里不再发 `web_search_preview`，只在 rollout-trace 的分类里认这个名字。`codex:tools/src/tool_spec.rs:33-53`；`codex:core/src/tools/hosted_spec.rs:14-46`；`codex:protocol/src/openai_models.rs:334-338`；`codex:rollout-trace/src/tool_dispatch.rs:266`（源码核实）
- 服务商能力里的 `web_search` 对所有服务商都是 true，只有 `external_web_access` 能用 `[model_providers.<id>.capabilities]` 关。`codex:model-provider/src/capabilities.rs:11-50`（源码核实）
- 独立搜索：`web` 命名空间下的 `run` 工具（web.run），由 Codex 本地扩展执行，调 `POST {base}/alpha/search`。要求服务商是内置 openai、或带 `x-openai-actor-authorization` 头、或 `supports_standalone_web_search = true`，且 web_search 不是 disabled；每轮还要 `features.standalone_web_search`（开发中、默认关）或模型 `use_responses_lite` 才启用；启用后不再发托管 web_search。内置 openai `supports_standalone_web_search: true`。`codex:ext/web-search/src/tool.rs:41`；`codex:ext/web-search/src/extension.rs:45-52`；`codex:core/src/tools/spec_plan.rs:697-713,1199-1207`；`codex:features/src/lib.rs:1262-1265`；`codex:codex-api/src/endpoint/search.rs:15`；`codex:model-provider-info/src/lib.rs:202,562`（源码核实）
- magpie 在 `/backend-api/codex/alpha/search`、`/v1/alpha/search`、`/alpha/search` 接搜索。`magpie:internal/gateway/codex_backend.go:81-92`；`magpie:internal/gateway/gateway.go:651-652`；`magpie:internal/gateway/codex_search.go:25`（源码核实）

---

## magpie

### 7. 三种登录方式各写什么；断开时删什么、留什么

判断依据：magpie 读 Codex 的 `auth.json`（或 macOS 钥匙串里的同一份）看有没有 access token，以此认定"登录了 ChatGPT"。`magpie:internal/agent/codex.go:1815-1831`（源码核实）。Osuna 的 ADR 0004 规定 `auth.json` 不读不写。`osuna:docs/adr/0004-api-endpoint-rewrites-cli-config.md:17`（文档所说）。app-server 有 `account/read`，返回 `account`（apiKey / chatgpt{email, planType} 等）与 `requiresOpenaiAuth`，但它只在当前生效服务商要求 OpenAI 登录时才报账号——当前服务商是 Osuna 专用表时报不出。`codex:app-server-protocol/src/protocol/common.rs:1475`；`codex:app-server-protocol/src/protocol/v2/account.rs:22-36,557-562`；`codex:model-provider/src/provider.rs:510-522`（源码核实）

"sign-in" 设置有三个值（`magpie:internal/agent/codex.go:1448-1483`；`magpie:docs/subsystems/agent-wiring.md:96`）：

- ChatGPT（缺省 `""`），"旁路"（beside the sign-in）：
  - 写：顶层 `openai_base_url = http://127.0.0.1:<端口>/backend-api/codex`；选了模型时写 `model`；整张 `[model_providers.magpie]`（`name = "magpie"`、`base_url = <网关>/v1`、`wire_api = "responses"`、`experimental_bearer_token = <网关 key>`、内联 `http_headers = { x-openai-actor-authorization = "magpie" }`），注释说这张表是给"当初在 magpie 服务商上开的线程"用的。
  - 删：顶层 `model_provider`、`model_catalog_json`，让 Codex 回到内置 openai、用中转站给的模型列表。
  - 另外：先把原来的 model / effort / provider / catalog 存进 magpie 自己的 stash；CC Switch 的服务商表也指向 magpie；把 `models_cache.json` 标成过期。
  - `magpie:internal/agent/codex.go:389-409,966-1001,1091-1129,1704-1729`（源码核实）
  - 例外：Codex app 把这个 ChatGPT 账号"扣住"（额度和 credits 都用完）时，app 什么都不发，magpie 临时改成下面的"服务商模式"（stash 标 `codex.out`），账号有余量后再改回旁路。`magpie:internal/agent/codex.go:964-1001,1145-1186`；`magpie:docs/subsystems/agent-wiring.md:67,96`（源码核实，文档所说）
- 一直 ChatGPT（`chatgpt`）：同上，但账号被扣住时也不切服务商模式。`magpie:internal/agent/codex.go:651-660`；`magpie:docs/subsystems/agent-wiring.md:96`（源码核实）
- magpie API（`api`），"服务商模式"：
  - 写：`[model_providers.magpie]`（同上）、顶层 `model_provider = "magpie"`、`model_catalog_json = <magpie 写的目录文件>`（`~/.codex/magpie-models.json`）、`model`，以及 `openai_base_url = <…/backend-api/codex>`（用户没写或原本就是 magpie 的才写）。注释：在内置 openai 上开的旧线程重开后选 magpie 模型，也要发到 magpie，而不是 ChatGPT 后端（#259）。
  - Codex 自带模型在这种模式下改成经 magpie 的 ChatGPT 账号服务（`codexOwnViaMagpie`）。
  - `magpie:internal/agent/codex.go:928-962,1002-1035`；`magpie:docs/reference.md:1979-1983`（源码核实，文档所说）
- 没登录、或用 API key 登录：一律走服务商模式（API key 登录时 Codex 不拉模型列表，内置模型会带着那个 key 直连 OpenAI，#322）。从别的机器连网关的 Codex（WSL NAT、`MAGPIE_ADDR` 非回环）也一律服务商模式，因为旁路会把 ChatGPT 令牌发到要求具名 key 的路径而 401（#2145）。`magpie:internal/agent/codex.go:30-53,308-327`；`magpie:docs/subsystems/agent-wiring.md:96`（源码核实，文档所说）

断开、换回原生模型时：

- 删：`unroute` 去掉 `[agents] default_subagent_model` 里 magpie 的值；`openai_base_url` 是 magpie 的才删；`model_provider` 是 magpie 时删 `model_provider` 与 `model_catalog_json`；然后把 stash 里存的原 provider、catalog、effort 写回。`Unwire` 再把模型恢复成接入前的，或删掉 magpie 的模型。选"Codex 原生默认"（`set("")`）删 `model`、`model_provider`、`model_catalog_json` 和 magpie 的 `openai_base_url`。`magpie:internal/agent/codex.go:441-450,661-667,893-925,928-946,1062-1089`（源码核实）
- 留：`[model_providers.magpie]` 永远不删——源码里没有删这张表的代码，`Sync` 发现配置点名 magpie 却没有表时还会写回。注释原文的意思：线程保持开始时的服务商，在 magpie 上开的线程没有这张表就再也打不开（"Model provider `magpie` not found"）；`model_provider = "magpie"` 而没有表，会让 Codex 整个配置都加载不了。`magpie:internal/agent/codex.go:54-63,441-450,1145-1153`；`magpie:docs/reference.md:1982-1987`（源码核实，文档所说）
- 断开后打上 disconnected 标记，magpie 自己不再写回任何东西，包括多号 failover 的 `openai_base_url`。`magpie:internal/agent/codex.go:745-748`；`magpie:docs/subsystems/agent-wiring.md:36`（源码核实，文档所说）
- 没"连接"magpie、但 magpie 里开着多个 Codex 的 ChatGPT 账号时，magpie 也会写 `openai_base_url`（failover），让 Codex 自带模型的请求在当前号没额度时转到下一个号；用户手写的 `openai_base_url` 不碰；magpie 正常退出时撤掉，被杀或崩溃时留着。`magpie:internal/agent/codex.go:749-808`；`magpie:docs/reference.md:1542-1552`；`magpie:docs/subsystems/agent-wiring.md:97`（源码核实，文档所说）

### 8. magpie 中转站怎么处理经 openai_base_url 过来、带 ChatGPT 令牌的请求

认调用方：

- 本机回环来源、不带代理转发头（Forwarded、X-Forwarded-For、X-Real-IP、Cf-Connecting-IP、True-Client-IP、Tailscale-User-Login）就算本机；本机请求不要 magpie 的 key，注释原文 "Loopback takes any token"。只有从别的机器来、或带了 magpie 具名 key 形式（`sk-magpie-…`）的请求才按 key 认人；网页经 DNS 重绑定打到回环的另有拦截。`magpie:internal/gateway/lan.go:246-284,337-353,394-405,494-521,547-575`（源码核实）
- 不靠 key 认出 Codex：`/backend-api/codex/` 这条路由专给 Codex；agent 名按 `User-Agent` 认（每个 agent 的专用 key `Token-<id>` 优先）。处理链是 `counted(corsGuard(callerGuard(withCaller(keyLimited(mux)))))`。`magpie:internal/gateway/gateway.go:60-81,678,685`（源码核实）

请求 ChatGPT 自带模型（模型名不带 `/`）：

- 缺省原样转发到 `https://chatgpt.com/backend-api/codex` + 原路径 + 原查询串，除逐跳头、`Host` 和 magpie 的账号选择头外，所有请求头原样带上，即用户的 `Authorization`（ChatGPT 令牌）与 `ChatGPT-Account-ID`。`Authorization` 以 `Bearer sk-` 开头（API key 登录）时转到 `https://api.openai.com/v1`（`/models` 除外）。`magpie:internal/gateway/codex_backend.go:684-715,795,1118-1120,1211-1217`；`magpie:internal/provider/account.go:998`（源码核实）
- magpie 里开着多个 Codex 的 ChatGPT 账号（或调用方的 key 被限定了账号、模型）时，改按 `codex/<模型>` 走 magpie 自己的路由：先用 Codex 登录的那个号，没额度或被限流就换下一个号，签名换成那个号的令牌与账号 id。`magpie:internal/gateway/codex_backend.go:181-182,626-666,796-810`（源码核实）
- 其他：WebSocket 握手回 426；用户禁用的自带模型就地拒绝；子 Agent 可被挪到设定的模型；标题、描述、预测这类小请求可另行转发。`magpie:internal/gateway/codex_backend.go:63-67,96-143`（源码核实）

请求第三方模型（模型名带 `/`，即 magpie 目录 id）：

- 交给通用服务流程（`serveAgent`），用那一家的 key 签名；发给上游的头里只带 Codex 的身份头（User-Agent、originator、session-id、thread-id、部分 x-codex-* 头），注释写明 "Never the key it was given, nor its sign-in's attestation"——用户的 ChatGPT 令牌不发给第三方。`/responses/compact` 对 magpie 模型直接拒绝。`magpie:internal/gateway/codex_backend.go:145-160`；`magpie:internal/gateway/gateway.go:3689-3735,3859-3879`；`magpie:internal/provider/account.go:189-229`（源码核实）

/models 怎么合并：

- 用 Codex 带来的头（即用户令牌）去拉 ChatGPT 后端的 `/models`，等 3 秒（注释：Codex 自己只给 5 秒）；401 / 403 原样回给 Codex；拉不到就用上次缓存的条目。然后按用户在 magpie 里勾选、隐藏、禁用的规则筛 ChatGPT 自带模型，再把 magpie 的模型追加在后面，返回 `{"models": [...]}`，ETag 由两边合成。`magpie:internal/gateway/codex_backend.go:1219-1378`（源码核实）

### 9. 会话在服务商之间迁移（internal/sessions/codex_provider.go）

- 背景注释：Codex 的历史和 resume 选择器只列当前服务商的会话；rollout 的 `session_meta` 与状态库的线程行都记着服务商；经 CC Switch 开的会话在 Codex 改用 magpie 后就从列表里消失（#887）。`magpie:internal/sessions/codex_provider.go:27-35`（文档所说）
- 做法：按会话 id 找到它的 rollout 文件（含压缩的孪生文件），一分钟内被写过的拒绝（`ErrActive`，`ActiveWindow = time.Minute`）；先把每个文件复制到 `<magpie 目录>/trash/codex-provider/<时间>-<id>/files/`，写 `move.json`（id、from、to、时间、文件对照）；再把每个文件里每条带 `model_provider` 的 `session_meta` 改成目标服务商（其余字节不动；写到旁边的临时文件、fsync、保留修改时间、改名覆盖；zstd 压缩的照样压回去）；最后对每个 `state_*.sqlite` 执行 `UPDATE threads SET model_provider = ? WHERE id = ?`（库里没有 threads 表就跳过）。文件改到一半失败，用副本把已改的文件恢复。`magpie:internal/sessions/codex_provider.go:191-290,381-396,398-478,480-500`；`magpie:internal/sessions/manage.go:69`（源码核实）
- 撤销：再迁回原服务商（注释："moving it back to the provider it had is the undo"）。没有 `model_provider` 的 session_meta（子 Agent 段、老版本）不改，所以迁回后文件和原来一样。`magpie:internal/sessions/codex_provider.go:33-35,377-381`（文档所说）
- 触发：用户在 Sessions 页手动选，GUI 接口 `POST /api/sessions/codex-provider`，一次可多条。`magpie:internal/gui/sessions_manage.go:285-317`（源码核实）
- 只改 `session_meta` 行，不改 rollout 里 `ThreadSettingsApplied` 事件带的 `model_provider_id`。`magpie:internal/sessions/codex_provider.go:381-396`（源码核实）。Codex 从 rollout 提取元数据时这些事件会覆盖服务商（`codex:state/src/extract.rs:162-166`），所以状态库重建后可能变回原服务商。（推断，未核实）

### 10. magpie 文档写到的已知问题与限制（均为文档所说）

- 线程保持开始时的服务商；在 magpie 服务商上开的线程没有表就打不开，所以表写了就留着；`model_provider = "magpie"` 没有表时 Codex 整个配置加载失败，magpie 下次同步时写回。`magpie:docs/reference.md:1982-1987`；`magpie:internal/agent/codex.go:54-63`
- CC Switch 的 OpenAI 镜像表（另一个 id、`name = "OpenAI"`、`requires_openai_auth`、没有 base_url）不受 `openai_base_url` 影响：在它上面开的线程重开后直连 ChatGPT，选了 magpie 模型会被拒，magpie 看不到这个请求（#1796）；magpie 旁路时把这种镜像的 base_url 也指过来，撤出时还原。把线程挪到别的服务商靠 Sessions 页的 Move（#887）。`magpie:docs/subsystems/agent-wiring.md:98`
- Codex app 与正在跑的 `codex app-server` 只在启动时读登录和 base URL，已开的要重开才换；magpie 退出时撤掉 failover 写的 `openai_base_url`，没有会话在用时顺手重启 app-server，有会话在用就一直连着已经不在的网关，直到用户重启；magpie 被杀或崩溃时 failover 留在配置里。`magpie:docs/reference.md:1548-1552`；`magpie:docs/subsystems/agent-wiring.md:97`
- Codex 启动时读模型列表，切换后要重启。`magpie:docs/reference.md:1996`
- Codex 的 HTTP 客户端会让发往 127.0.0.1 的请求走 `HTTP_PROXY` / 系统 HTTP 代理 / `ALL_PROXY`；`NO_PROXY` 里只有精确 IP 或 CIDR 能把回环排除（`127.*`、`localhost` 不行），代理不转发时每轮 502；magpie 会探测、提示，这时也不写 failover。`magpie:docs/subsystems/agent-wiring.md:94`
- magpie API 模式下 Codex 的 `getAuthStatus` 没有 token，Codex 的 Chrome 控制不能用（#1824）；从别的机器连网关的 Codex 不能旁路（#2145）。`magpie:docs/subsystems/agent-wiring.md:96`
- ChatGPT 账号被 Codex app 扣住时，app 什么都不发，magpie 临时改成服务商模式，app 因此离开 ChatGPT 状态（durable threads、remote control 没了）；只是某个窗口到 100% 但还有 credits 不算。`magpie:docs/subsystems/agent-wiring.md:67,96`；`magpie:docs/reference.md:1988-1995`
- 用户自己写的 `openai_base_url` 保留不动。`magpie:docs/reference.md:1548`；`magpie:docs/subsystems/agent-wiring.md:97`

---

## Osuna

### 11. 列会话、恢复会话时传给 app-server 的服务商参数

`codex-app-server-agent.ts` 不读"使用第三方接口"开关的状态（文件里没有引用 api-endpoints 的代码），所以下面的参数在开、关两种情况下完全一样，差别只来自 `~/.codex/config.toml` 当时的内容。（源码核实：grep）

- 提供方会话列表（导入用，`listImportableSessions`）：每次新起一个 app-server，发 `thread/list`，参数 `{limit, sortKey: "updated_at", cwd?, modelProviders?, cursor?}`。内置 Codex 不传 `modelProviders`；只有 `extends: "codex"` 的自定义提供方传 `[自定义提供方 id]`。代码注释已写明 "Codex records each thread under the model provider that ran it and, unless told otherwise, lists only the provider its own config selects."。`osuna:…/codex-app-server-agent.ts:1008-1056,7389-7415`（源码核实）
- 新建线程 `thread/start`：`{model, cwd, approvalPolicy?, sandbox?, developerInstructions?, config?, ephemeral?, approvalsReviewer?}`，不传 `modelProvider`。`config` = Codex 提供方选项（approval_policy、sandbox_mode、sandbox_workspace_write、web_search、features）+ 自定义提供方的 `model_provider` / `model_providers` + `mcp_servers`。`osuna:…/codex-app-server-agent.ts:5352-5397`；`osuna:packages/server/src/server/agent/providers/codex/options.ts:37-60`（源码核实）
- 恢复线程 `thread/resume`（交互式恢复；先 `thread/loaded/list` 看是否已加载）：`{threadId, developerInstructions?, config?}`，不传 `model`、`modelProvider`，config 里也没有 `model`、`model_reasoning_effort`，所以 Codex 按线程记的模型和服务商恢复（第 2 题）。失败时抛 `Failed to resume Codex thread <id>: <Codex 的错误>`。连接时先恢复、再读历史。`osuna:…/codex-app-server-agent.ts:3672-3676,4083-4123`（源码核实）
- 每轮 `turn/start` 带 `model`（Agent 记录里的模型；没有时取 config 的 `model`，再没有取 `model/list` 的默认）、`effort`、`serviceTier`。`turn/start` 协议有 `model` 字段，没有服务商字段。`osuna:…/codex-app-server-agent.ts:4199-4231,5256-5320`；`codex:app-server-protocol/src/protocol/v2/turn.rs:170-303`（源码核实）
- 只看历史（`history` 用途的恢复）只发 `thread/read`，不 resume，不受服务商影响。`osuna:…/codex-app-server-agent.ts:2172-2177,3639-3644,3989-3999`；`osuna:docs/agent-lifecycle.md:123-128`（源码核实，文档所说）

### 12. codex-config-patch.ts：开关打开写什么、关掉怎么恢复、专用表什么时候删

- 负责的键：顶层 `model_provider`、`model`、`model_catalog_json`，以及整张 `[model_providers.osuna_api_endpoint]`。`osuna:packages/server/src/server/api-endpoints/codex-config-patch.ts:4-10,16,20`（源码核实）
- 打开（`applyCodexApiEndpoint`）：首次接管时记下三个顶层键原来的写法（含引号的原文），没有的记"不存在"；三个键原地替换，或插在最后一个顶层键后面：`model_provider = "osuna_api_endpoint"`、`model = <这个 Agent 的默认模型>`、`model_catalog_json = <Osuna 的目录文件路径>`；先删掉旧的同名表（含旧版本的 auth.command 子表），再在文件末尾追加 `name = "Osuna"`、`base_url = http://127.0.0.1:<端口>/api-endpoint-gateway/v1`、`wire_api = "responses"`、`experimental_bearer_token = <Codex 的中转站口令>`；改完重新解析，不合法就整个拒绝。`osuna:…/codex-config-patch.ts:79-126,392-410`；`osuna:packages/server/src/server/api-endpoints/service.ts:101-102,1164-1205`（源码核实）
- 关掉（`restoreCodexOfficial`）：三个顶层键按接管记录恢复原写法，原来没有的删掉；删掉专用表（连同追加时补的空行）；接管前文件不存在、恢复后又空了就删文件。`osuna:…/codex-config-patch.ts:128-152`；`osuna:…/service.ts:1207-1227`（源码核实）
- 专用表什么时候删：关开关时就删（ADR 0007 起）；daemon 启动时若是官方模式，还会清掉旧版本（v0.15）在官方模式下留着的表和 key 文件。`osuna:…/codex-config-patch.ts:154-162`；`osuna:…/service.ts:636-652,1229-1257`；`osuna:docs/adr/0007-api-endpoints-route-through-daemon-gateway.md:17`（源码核实，文档所说）。ADR 0004 原本的规则是关开关只还原顶层键、表留到删除接口为止，理由正是"Codex 按服务商 id 分组会话，删表会让第三方会话无法恢复"，ADR 0007 改成了删表。`osuna:docs/adr/0004-api-endpoint-rewrites-cli-config.md:22`（文档所说）
- 口令：每个开着的 Agent 一个随机口令；关开关时不再发口令（即作废），再打开发新的。`osuna:…/service.ts:1385-1400`（源码核实）
- 中转站只认本机回环来源（且不带 forwarded、x-forwarded-for、x-real-ip）+ `Authorization: Bearer` 或 `x-api-key` 里的口令，对上哪个 Agent 的口令就是哪个 Agent；只服务 `/v1/messages`、`/v1/responses`、`/v1/messages/count_tokens`、`GET /v1/models`、`/api/hello`，其余 404。`osuna:packages/server/src/server/api-endpoints/gateway/gateway.ts:105-106,151-195,1090-1126`（源码核实）
- Osuna 不写 `openai_base_url`，只在状态检查里读它，用来显示官方模式下 CLI 实际指向哪里。`osuna:…/codex-config-patch.ts:233-249`（源码核实）

---

## 综合

### 13. 两个推断是否成立；能解决的做法及事实层面的后果

#### 13.1 推断一「开关前后开的 Codex 对话互相看不见」

- Osuna 的提供方会话列表（导入用）：成立。Osuna 不传 `modelProviders`（第 11 题）→ app-server 只列 config.toml 当前的 `model_provider`（第 1 题）；开着时是 `osuna_api_endpoint`（第 12 题），关掉后恢复成原值，原来没写就是 `openai`。所以开着时只看到经中转站开的对话，关掉后只看到 openai 名下的。（各段源码核实；没有运行验证）
- Osuna 里已有的 Agent：不受这个列表影响，Agent 记录存在 Osuna 自己的存储里（`osuna:packages/server/CLAUDE.md:172`，文档所说）；只看历史走 `thread/read`，也不受服务商影响（第 11 题）。受影响的是"继续对话"，见推断二。
- 终端：`codex resume` 选择器、`--last`、按名字都只列当前生效服务商，`--all` 不放开服务商——同样成立（第 1 题）。`codex resume <UUID>` 能找到任一服务商的线程。

#### 13.2 推断二「关掉开关后，经中转站开的旧对话续不上」

- 成立，Osuna 与终端都是：关掉时表被删（第 12 题）→ 恢复时 Codex 用线程记的 `osuna_api_endpoint`（第 2 题；Osuna 的 resume 不带覆盖，第 11 题）→ 配置加载失败 ``Model provider `osuna_api_endpoint` not found``（第 2 题）→ Osuna 报 `Failed to resume Codex thread …`；终端 `codex resume <UUID>` 同样报这条错，除非加 `-c model_provider=…`、`-m` 之类的显式覆盖（第 2 题）。（各段源码核实；没有运行验证）
- 即使表还留着：表里的口令在关开关时已作废（第 12 题），请求到中转站会是 401；daemon 没在跑时连接被拒。（口令作废源码核实；请求结果为推断）

#### 13.3 反方向（顺带查到的）

- 开关打开后，打开前在 openai 名下开的对话：Osuna 恢复、终端 `codex resume <UUID>` 都按线程记的 `openai` 恢复（第 2 题），请求直接发给 OpenAI / ChatGPT，不经过中转站——内置 openai 的地址只有 `openai_base_url` 能改，而 Osuna 不写它（第 3、12 题）。（源码核实）
- 如果这时 Osuna 每轮 `turn/start` 带的是接口模型名（Agent 记录里没存模型、取了 config 的 `model` 时会这样，第 11 题），这个模型名会被发给 OpenAI。（推断，未核实）

#### 13.4 能解决的做法与事实层面的后果

**(a) 照 magpie：ChatGPT 登录时只写 `openai_base_url`**

- ChatGPT 登录：
  - 新对话记在 `openai` 名下（不写 `model_provider`），开关前后在 Osuna 列表、终端选择器里都是同一组。（推断，依据第 1、2 题）
  - 开着时所有 `openai` 线程（新的、旧的）都经中转站；Codex 自带模型的请求要由中转站转给 chatgpt.com，magpie 是原样带用户令牌转（第 8 题）。
  - /model 列表要由中转站合并：不能再写 `model_catalog_json`，否则 ChatGPT 自带模型从 /model 消失（第 5 题）。
  - 地址以 `/backend-api/codex` 结尾，Codex 才继续把它当 ChatGPT 后端（工作区路由、专用头、实验上下文等）；内置 openai 会先试 WebSocket，中转站回 426 才立刻改走 HTTP；请求体是 zstd 压缩的，Osuna 已能解（第 3 题）。
  - 中转站会经手用户的 ChatGPT access token 和账号 id（第 3 题）。
  - 关掉开关后：用过接口模型的 `openai` 线程，恢复时线程记的模型是接口模型名，会被发到 chatgpt.com（推断：会被拒；ADR 0007 第 42 行已接受同类后果）。开着时 daemon 不在，连 ChatGPT 自带模型也用不了（推断，同 ADR 0007 第 43 行）。
  - 换号（子任务 9）：Codex 自带模型的请求带着当前号的令牌经过中转站，中转站能换成另一个号的令牌再转，这就是 magpie 的 failover / codexAccounts（第 7、8 题）。
  - 判断登录方式：magpie 读 auth.json（ADR 0004 不允许）；不读的话可用 app-server `account/read`，内置 openai 生效时能读出账号（第 7 题）。
- API key 登录：`openai_base_url` 同样把 API key 的请求改到中转站，带着用户的 `sk-` key（第 3 题）；Codex 不再拉模型列表，/model 只有内置清单，接口模型不在里面（第 5 题）。magpie 对这类用户改用自己的服务商表（第 7 题），对话照旧按服务商分组。
- 未登录：内置 openai 要求 OpenAI 登录，没登录时请求不带任何鉴权头（`codex:model-provider/src/auth.rs:197-222`，源码核实）；magpie 对这类用户也用服务商表（第 7 题）。
- 中转站认调用方：要变。现在只认每个 Agent 的口令（第 12 题），ChatGPT 令牌、`sk-` key、没有鉴权头都会 401；`/backend-api/codex/…` 路径和 Codex 格式的 `/models`（`{"models": [...]}`）现在都不服务（第 12 题）。magpie 的认法是"本机回环就收，按路由和 UA 认 Codex"（第 8 题）。内置 openai 不能加自定义头，能区分 Osuna 起的进程的只有环境变量带出的 `OpenAI-Organization` / `OpenAI-Project`、按进程的 `-c` 覆盖、线程 id 等（第 4 题）。
- 终端 codex：config.toml 共用，终端 Codex 自带模型的请求也经中转站；已经在跑的 Codex app / app-server 要重启才换地址（magpie 文档，第 10 题）。

**(b) 迁移会话（magpie 的 Move）**

- 三种登录无差别：只改记录、不改接法；迁过去的对话出现在目标服务商的列表里，恢复时用目标服务商（第 2、9 题）。迁到一个当时不存在的服务商，恢复照样报 not found（第 2 题）。
- Osuna 要写 `~/.codex/sessions/**`（及 `archived_sessions/**`）和 `state_*.sqlite`；ADR 0004 只规定了 config.toml、settings.json 的改写规则。（文档所说）
- magpie 只改 `session_meta`，rollout 里 `ThreadSettingsApplied` 带的旧服务商不动，状态库从 rollout 重建时可能变回去（第 9 题，推断）；magpie 拒绝改一分钟内写过的会话（第 9 题）。
- 中转站认调用方：不用变。终端：读的是同一份 rollout 和状态库，结果相同。

**(c) 关掉后保留服务商表（ADR 0004 原规则；magpie 也是表写了就留）**

- 三种登录无差别：表用 `experimental_bearer_token`，与登录无关。`codex:model-provider/src/auth.rs:292-303`（源码核实）
- 解决 not found：关掉后 Osuna、终端恢复旧对话时配置能加载（第 2 题）。但请求发往表里的中转站地址和口令：口令已作废 → 401；daemon 没在跑 → 连接被拒；端口换了 → 连不上（启动时的对账只在开关开着时改写配置，`osuna:docs/adr/0007-api-endpoints-route-through-daemon-gateway.md:24`；`osuna:…/service.ts:648-651`）。（口令作废源码核实；请求结果推断）
- 重新打开开关时表被改写成新口令；Codex 恢复线程时重新加载配置（`codex:app-server/src/request_processors/thread_processor.rs:4177-4192`），所以开着时旧对话能续。（推断，未核实）
- 不解决列表：关掉后当前服务商是 `openai`，列表和选择器照样只列 `openai`（第 1 题）。
- 中转站认调用方：要让关掉后的旧对话能用，口令得在关掉后继续有效，或换认法。终端同 Osuna。

**(d) Osuna 列表时传全部服务商（`thread/list` 带 `modelProviders: []`）**

- 只改 Osuna 的提供方会话列表：两边的对话，以及用户自己或 CC Switch 等其他服务商表上的对话都列出来；每条带 `modelProvider`，可以标注（第 1 题）。
- 不改恢复：仍按线程记的服务商（第 2 题），关掉后 osuna 线程照样 not found，开着时 openai 线程照样直连 OpenAI（13.3）。
- 三种登录无差别；中转站不用变；终端 `codex resume` 不受影响（TUI 没有列全部服务商的参数，第 1 题）。

**(e) 恢复时显式指定服务商（`thread/resume` 传 `modelProvider`；终端 `codex resume <id> -c model_provider=…`）**

- app-server 一收到显式服务商（或模型）覆盖，就不取线程记的模型和服务商，两者一起改用请求值或当前配置（第 2 题）；恢复时写的设置快照会把线程改记到新服务商（第 2 题，推断）。
- 开着时：可把 openai 线程续到 `osuna_api_endpoint`（经中转站）。关掉时：可把 osuna 线程续到 `openai`，模型也得换成官方模型；ChatGPT 登录、API key 登录能继续，未登录的不行（内置 openai 要求登录，第 3 题）。
- 中转站不用变。终端用户要自己加 `-c model_provider=…`（TUI 只认命令行层、profile 层的显式服务商，第 2 题）。

**(f) magpie 实际是组合用的**：ChatGPT 登录时旁路写 `openai_base_url`；没登录、API key、账号被扣住、从别的机器连时用服务商表；表写了就不删；另有手动的 Move 迁移；多号时即使没"连接"也写 `openai_base_url` 做换号（第 7、9 题）。

---

## 没能核实的地方

- 全部结论来自读源码，没有在真实 Codex 上跑过开关前后的列表、恢复（按禁令不运行 codex）。
- 用户本机实际装的 Codex 版本未知。main 与 rust-v0.163.0 在关键几处一致；更老的版本（Osuna 的选项按 0.143+ 维护）没有逐一核对。
- "显式服务商恢复 → 写设置快照 → 状态库改记到新服务商"这条链路只读了两端源码。
- magpie 迁移后，Codex 在什么情况下会从 rollout 重新提取元数据、会不会因 `ThreadSettingsApplied` 把服务商改回去，没核实。
- ChatGPT 工作区路由在 `openai_base_url` 指向本机且以 `/backend-api/codex` 结尾时，会不会把请求 origin 改到 ChatGPT 的工作区后端、从而绕过中转站：只读到"会改 origin"和"只在这种地址下启用"，触发条件（app-server 的账号读取）没读完。
- `-c openai_base_url=…` 按进程覆盖、或 `thread/start` 的 `config.openai_base_url` 按线程覆盖是否生效，没验证。
- `responsesapiClientMetadata` 的字段会不会出现在 `x-codex-turn-metadata` 请求头里，没核实。
- ChatGPT 后端对 `OpenAI-Organization` / `OpenAI-Project` 等附加头、对经本机转发的请求怎么反应，没核实。
- 未登录时用内置 openai，TUI 与 app-server 的实际表现（是否先要求登录、请求是否发出）只核实到"不带鉴权头"。
- Osuna 自己的 Agent 列表来自 Osuna 存储，依据是文档，没逐行跟代码；开关打开后续旧 openai 对话时，`turn/start` 带的模型是不是接口模型名，取决于 Agent 记录里存没存模型，没跟到底。
- magpie 文档说"Codex 启动时读模型列表"，与 Codex 源码里 5 分钟 TTL 的模型缓存（运行中会不会重拉）是什么关系，没核实。
