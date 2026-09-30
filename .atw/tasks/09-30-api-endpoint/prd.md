# 第三方接口

父任务：`09-30-provider-install-and-api-endpoint`。决策来源见父任务的 `prd.md` 中「B 第三方接口」一节。生效方式与改文件的规则见 `docs/adr/0004-api-endpoint-rewrites-cli-config.md`，术语见 `docs/glossary.md` 的 **API endpoint** 词条。调研事实见父任务的 `research/`，包括 `claude-third-party.md`、`codex-auth-command.md`、`reference-projects.md`。

## Problem Statement

有些用户没有 Anthropic 或 OpenAI 的订阅，靠 OpenRouter 这类中转站或其他兼容接口使用 Claude Code 和 Codex。他们现在要么自己去搞清楚每个 CLI 该设哪些环境变量、改哪份配置文件、key 放在哪，要么在 Osuna 的 `config.json` 里手写自定义提供方，而且 Osuna 的界面上没有任何入口。

对新手来说，这里到处是坑：
- Claude Code 必须用 `ANTHROPIC_AUTH_TOKEN`，同时把 `ANTHROPIC_API_KEY` 置空；
- Codex 只认支持 Responses 接口的地址；
- 中转站不认官方模型 id；
- 改错一个配置文件，终端里的 CLI 也跟着坏掉。

用户需要在 Osuna 里填好 URL 和 key、挑好模型、测试一下能不能用，然后一键切换过去，也能一键切回官方。

## Solution

在 Claude Code 和 Codex 的提供方详情里新增「官方 / 第三方接口」两种模式。

- **保存接口**：用户可以保存多个第三方接口，每个包含名称、Base URL、API key，以及从上游拉取并勾选好的模型。Claude 另外可以选填 Opus、Sonnet、Haiku、Fable 四个模型映射。
- **key 只写不读**：保存以后，界面只显示「已设置」。
- **测试连接**：保存前可以测试。用户选一个模型，Osuna 从主机上直接向该接口发一条最小的对话请求，把结果告诉用户。
- **切换**：同一时间最多启用一个接口。
  - 启用时，Osuna 改写 CLI 自己的配置文件：Claude 是 `~/.claude/settings.json`，Codex 是 `~/.codex/config.toml`。在 Osuna 里开的会话和在终端里直接运行的 CLI 都会走这个接口。
  - 切回「官方」时，把这些文件恢复到接管前的样子。
  - Osuna 只动自己负责的那几个键，不碰 Codex 的 `auth.json`，也就不会动 ChatGPT 登录。
- **第三方模式下的界面变化**：
  - 模型选择器只列出勾选的模型；
  - 套餐用量旁标注当前走的是第三方接口；
  - 文件被外部改动时明确提示，绝不静默覆盖。

## User Stories

### 管理第三方接口

1. 作为用中转站的用户，我想在 Claude Code 的提供方详情里看到「官方 / 第三方接口」两种模式，以便知道 Osuna 支持第三方接口。
2. 作为用户，我想在 Codex 的提供方详情里同样看到这两种模式，以便两个 CLI 的用法一致。
3. 作为用户，我想新建一个第三方接口，填写名称、Base URL 和 API key，以便保存一套可以复用的配置。
4. 作为同时使用多家中转站的用户，我想保存多个第三方接口，以便不用每次重新填写。
5. 作为用户，我想在接口列表里看到每个接口的名称、地址和勾选的模型数量，以便区分它们。
6. 作为用户，我想看到当前启用的是哪个接口，或者当前是「官方」，以便知道 CLI 此刻走的是哪里。
7. 作为用户，我想编辑已经保存的接口，包括名称、地址、key、模型、映射，以便在中转站变更后更新配置。
8. 作为用户，我想删除不再使用的接口，以便列表保持整洁。
9. 作为用户，我想在删除当前启用的接口时，先看到确认提示，确认后 Osuna 自动切回官方再删除，以便 CLI 不会停在一个已经不存在的配置上。

### API key

10. 作为用户，我想让 API key 输入框是密码样式，以便旁边的人看不到。
11. 作为用户，我想在保存之后只看到「已设置」，而看不到 key 本身，以便手机丢了或屏幕被人看到时 key 不会泄露。
12. 作为用户，我想在编辑接口时把 key 输入框留空，就表示保留原来的 key，以便只改地址或模型时不用重新粘贴 key。
13. 作为用户，我想在编辑时填入新的 key 来替换旧的 key，以便处理 key 轮换。
14. 作为用手机远程管理主机的用户，我想让 key 只保存在主机上、从不发回任何客户端，以便 key 不出主机。

### 模型

15. 作为用户，我想在填好 URL 和 key 后点「拉取模型」，让 Osuna 列出这个接口上的全部模型，以便不用手动抄模型 id。
16. 作为用 OpenRouter 的用户，我想在几百个模型里搜索并勾选我要用的几个，以便模型选择器保持简短。
17. 作为用户，我想只保存我勾选的模型，并且以后可以重新拉取、重新勾选，以便上游模型更新后跟得上。
18. 作为用户，我想在上游不支持列出模型时看到明确的提示，并且可以手动添加模型 id，以便这类中转站也能用。
19. 作为用户，我想从勾选的模型里指定一个默认模型，以便新开会话时直接用上它。
20. 作为 Claude Code 用户，我想选填 Opus、Sonnet、Haiku、Fable 四个模型映射，从勾选的模型里选，以便终端里使用 `/model opus` 这类别名、以及跑后台任务时，也走中转站能识别的模型。
21. 作为 Claude Code 用户，我想让没填的映射档位保持不写，以便我能自己决定映射哪些。

### 测试连接

22. 作为新手，我想在保存前点「测试连接」，以便在切换之前确认 URL、key 和模型都可用。
23. 作为用户，我想在测试时选择用哪个模型发请求，以便验证我真正要用的那个模型。
24. 作为用户，我想看到测试结果：成功或失败，失败时给出上游返回的错误信息或状态码，以便知道问题出在哪里。
25. 作为 Codex 用户，我想在接口不支持 Responses 协议时，从测试结果里看出来，以便知道这个地址不能给 Codex 用。
26. 作为用户，我想知道测试连接只验证接口本身，CLI 这一侧的问题（比如 Claude 的登录冲突）要到第一次真正对话时才会暴露，以便遇到问题时知道去哪里排查。

### 切换

27. 作为用户，我想一键启用某个第三方接口，以便 Claude Code 或 Codex 马上改走这个接口。
28. 作为用户，我想一键切回「官方」，以便恢复成接管前的配置，包括我以前手写在配置文件里的内容。
29. 作为有会话正在运行的用户，我想在切换前看到「N 个正在运行的会话会立即改用新配置」，以便决定是否现在切换。
30. 作为在终端里直接使用 `claude` 或 `codex` 的用户，我想让终端里的 CLI 也跟着切换，以便两边行为一致。
31. 作为有多个 ChatGPT 账号的用户，我想让切换完全不碰 Codex 的登录文件，以便我用 `codex login` 或其他工具切换账号时互不影响。
32. 作为用户，我想让 Osuna 切回官方时，不删掉 Codex 里为第三方准备的那段配置，以便之前在第三方模式下的 Codex 会话还能恢复。
33. 作为用户，我想在编辑并保存当前启用的接口后，新的配置立即生效，并且和切换时一样提示正在运行的会话会受影响，以便改动不用再手动切换一次。
34. 作为 Codex 版本过旧（低于 0.118.0）的用户，我想在启用时看到「请先升级 Codex」以及原因，以便知道为什么不能启用。

### 安全与外部改动

35. 作为自己手改过 `settings.json` 的用户，我想让 Osuna 只改它负责的那几个键，以便我的权限、hooks、插件设置都不受影响。
36. 作为用户，我想让 Osuna 在第一次改写某个文件前留一份完整副本，以便真出问题时能手动找回。
37. 作为用户，我想在配置文件格式损坏、无法解析时，看到 Osuna 拒绝写入并提示原因，而不是覆盖掉我的文件。
38. 作为同时用 cc-switch 或会手改配置的用户，我想在 Osuna 负责的键被外部改掉后，看到「已被外部修改」，并且可以选择「重新应用」或「切回官方」，以便 Osuna 显示的状态和实际一致，也不会被静默覆盖。
39. 作为 Codex 用户，我想在启用了会覆盖顶层配置的 Codex profile 时看到提示，以便知道为什么切换可能不生效。
40. 作为用户，我想在「官方」模式下，如果 CLI 自己的配置已经指向某个中转站，看到提示「当前 Claude 自身配置指向 X」，以便知道「官方」实际走的是哪里。

### 使用中的表现

41. 作为用户，我想在启用第三方接口后，Osuna 的模型选择器只列出勾选的模型，以便不会误选中转站不认识的官方模型。
42. 作为用户，我想在第三方模式下新开的会话，默认选中该接口的默认模型，以便不用每次手动选。
43. 作为用户，我想在切回官方后，模型选择器恢复成原来的官方列表。
44. 作为用户，我想在恢复一个「在另一种模式下创建」的会话时看到提示，比如「此会话创建于第三方接口 X，当前为官方，可能无法继续」，以便理解接下来可能出现的报错。
45. 作为有订阅的用户，我想在启用第三方接口时，套餐用量旁标注「当前使用第三方接口，此额度不代表实际消耗」，以便不误读额度。
46. 作为在 `config.json` 里手写了继承 Claude 的自定义提供方的用户，我想在 Claude 启用第三方接口时，在那些自定义提供方的行上看到提示，说明它们也会走当前接口，以便理解它们的行为变化。

### 跨平台

47. 作为手机端用户，我想在手机上完成新建、测试、切换第三方接口的全部操作，以便不用回到电脑前。
48. 作为 Windows 主机用户，我想让 Codex 读取 key 的方式在 Windows 上同样可用，以便功能不局限于 macOS 和 Linux。
49. 作为用户，我想看到界面文案使用我设置的语言，以便看懂每一步。

## Implementation Decisions

### 数据与存储

- 第三方接口是 daemon 端的数据，按主机保存。每条记录包含：id、所属提供方（`claude` 或 `codex`）、名称、Base URL、勾选的模型列表（id、可选的显示名）、默认模型 id（必须是列表中的一个）、Claude 的四档映射（可选）。
- 每个提供方记录当前启用的接口 id，没有启用就是「官方」。
- 全部放在 `$PASEO_HOME/api-endpoints/` 下，每个文件都是 0600（布局见 `docs/data-model.md` 第 9 节）：`endpoints.json`（接口与各提供方启用的接口）、`keys.json`、`takeover-claude.json` 与 `takeover-codex.json`（接管记录）、`codex-api-key`、`backups/`。
- **API key 与其他字段分开存放，放在 daemon 自己的私有文件里，权限 0600。**
  - key 不进入 `config.json` 的 `agents.providers`，因为 `get_daemon_config` 会把这部分原样返回给客户端。
  - 任何 RPC 都不返回 key。只返回「是否已设置」。
- Codex 的 key 另外保存为一个单独的 0600 文件 `codex-api-key`，供 `auth.command` 读取。全局只有一个，内容是专用表当前所属接口的 key，不带换行。`takeover-codex.json` 的 `providerTable.endpointId` 记录专用表属于哪个接口；切回官方后保留，删除该接口时连同 key 文件一起清掉。
- 「接管记录」同样由 daemon 私有保存，每个被管理的文件一份。内容包括：
  - 负责的每个键的原值，以及这个键原本是否存在；
  - 上次写入的值，用来检测外部改动；
  - 接管前整个文件的样子：不存在、空对象（留原文），或有内容；
  - 完整副本：从未改写过时为 null；首次改写时文件不存在则记为「没有副本」，之后不再补做。
- 数据持久化沿用 `docs/data-model.md` 的约定：Zod schema、原子写入、不做迁移。

### 协议

- 新增一组带点号命名空间的 RPC，遵循 `docs/rpc-namespacing.md`，前缀 `provider.api_endpoint.*`，schema 在 `packages/protocol/src/api-endpoint/rpc-schemas.ts`：
  - `list`：`{ provider }` → `{ provider, endpoints, activeEndpointId, error }`，`activeEndpointId: null` 即「官方」；
  - `save`：没有 `endpointId` 是新建（`apiKey` 必填），有则更新；`apiKey` 省略或空白表示保留原值 → `{ endpoint, error }`，`endpoint.hasApiKey` 代替 key。`modelMapping`（`{ opus?, sonnet?, haiku?, fable? }`）每次整份提交，省略即不映射；每档必须是勾选的模型之一，只有 Claude 能带，否则 `invalid_input`。哪些提供方有映射由协议里的 `apiEndpointHasModelMapping` 决定，App 与 daemon 共用；
  - `delete`：`{ provider, endpointId }` → `{ activeEndpointId, error }`；
  - `set_active`：`{ provider, endpointId | null }`，null 为切回官方 → `{ activeEndpointId, error }`；失败时回报的是真实的当前启用接口；
  - `fetch_models`：`{ provider, baseUrl, endpointId?, apiKey? }` → `{ models, error }`。`apiKey` 省略或空白且带 `endpointId` 时用已保存的 key；两者都没有返回 `invalid_input`；
  - `cancel`：`{ targetRequestId }` → `{ cancelled }`，取消同一连接上还在进行的上游请求（拉取模型与测试连接）；被取消的请求照常回一条 `cancelled` 错误。连接断开时 daemon 也会取消；
  - `test_connection`：`{ provider, baseUrl, endpointId?, apiKey?, modelId }` → `{ result, error }`。key 规则同 `fetch_models`，同为 `daemon.manage`，可用 `cancel` 取消。`result` 是上游给出的结论 `{ ok, status, durationMs, error }`：`status` 是 HTTP 状态码，没收到响应时为 null；`error` 是上游侧的失败。请求本身不成立（缺 key、缺模型、找不到接口、被取消）时 `result` 为 null，原因在外层 `error`；
  - 启用接口或切回官方；
  - 重新应用（处理外部修改时使用）。
- 失败放在响应的 `error: { code, message } | null` 里，不走 `rpc_error`。`code` 在线上是字符串，老客户端遇到新码照常显示 message。已有的码：`unsupported_provider`、`invalid_input`、`not_found`、`config_unparsable`、`codex_version_unsupported`；上游请求另有 `upstream_error`（非 404/405 的状态码，message 形如 `GET <url>: HTTP 401: <上游信息>`）、`upstream_unreachable`、`upstream_timeout`、`models_unsupported`、`cancelled`；测试连接的结果里另有 `protocol_unsupported`（地址上没有 CLI 需要的协议）；意外错误为 `unknown`（例如找不到 codex 可执行文件）。App 把 `config_unparsable`、`codex_version_unsupported`、`models_unsupported`、`upstream_timeout`、`protocol_unsupported` 换成本地化文案，后面接 daemon 原文；`cancelled` 不显示；其余只显示 daemon 原文。
- `provider` 在线上是字符串而非枚举；daemon 只接受已支持的内置提供方，其余返回 `unsupported_provider`。
- 状态查询返回四类信息：
  - 当前模式；
  - 文件的健康状态：正常、已被外部修改、无法解析、Codex 版本不足、Codex profile 会覆盖；
  - 「官方」模式下 CLI 自身配置实际指向的地址；
  - 受影响的正在运行的会话数。
- 能力门控：`server_info.features` 新增 `apiEndpoints`。App 只在主机声明了这个能力时显示「第三方接口」模式；老主机上不显示，也不提供降级路径（`docs/protocol-compatibility.md`）。
- 新增字段全部可选。wire schema 保持纯净：不用 transform、catch 或 preprocess。
- 接口状态变化后（启用、切回、编辑当前启用的接口、检测到外部修改），daemon 触发一次对应提供方的快照刷新，客户端的模型选择器由此更新。

### 改写 CLI 配置（服务端核心）

规则以 ADR 0004 为准，这里只写模块边界。

- **两个纯函数补丁模块**：输入文件原文、要写入的目标值、接管记录，输出新的文件内容和更新后的接管记录，或者一个明确的错误（无法解析、冲突）。
  - Claude 补丁作用于 `settings.json`。负责的键：
    - `env.ANTHROPIC_BASE_URL`
    - `env.ANTHROPIC_AUTH_TOKEN`
    - `env.ANTHROPIC_API_KEY`，第三方模式下置为空字符串
    - `env.ANTHROPIC_MODEL`，写入默认模型
    - 四个 `env.ANTHROPIC_DEFAULT_*_MODEL`，只写用户填了的档位
    - `permissions.deny` 里的一条 `"WebSearch"`，用来关闭第三方不支持的 WebSearch。Claude Code 没有关它的环境变量，只能用权限规则；只有 daemon 自己加的这条才归它所有，用户原有的同名规则切回后保留。
  - Codex 补丁作用于 `config.toml`。负责的键：
    - 顶层 `model_provider` 和 `model`
    - 一个专用的 `[model_providers.<Osuna 专用 id>]` 表，包含 name、base_url、`wire_api = "responses"`，以及 `auth` 的 command、args、timeout_ms
  - Osuna 专用的 Codex provider id 是 `osuna_api_endpoint`：带下划线，而自定义提供方 id 只能是 `[a-z][a-z0-9-]*`，所以不会和请求级注入的 id 重复；也不是 Codex 的保留 id。全局只有这一张专用表，内容是最后启用的那个接口。
  - 专用表整块生成、放在文件末尾；顶层键原地替换值（行尾注释保留），原本没有就插在最后一个顶层键之后，没有顶层键就放在文件开头。原值按文件里的写法（含引号）记录，恢复时原样放回。
  - 官方模式下编辑专用表所属的接口：只重写专用表和 key 文件，不动顶层键，旧会话恢复时拿到新的 URL 和 key。
- **TOML 必须用能保留格式的方式改写**，用户原有的注释和排版不能丢。选定 `toml-eslint-parser`：按节点位置拼接文本，同时做 TOML 1.0 严格校验；每次拼完再解析一遍，拼不出合法文件（例如 `model_providers` 是内联表）就按 `config_unparsable` 拒绝。它不认 BOM，先摘下再放回。否决的方案及理由见 ADR 0004。
  - 已知限制：删除接口拿掉末尾的专用表时，文件末尾的多个空行会收成一个；原文件末尾没有换行时，删除后会多出一个换行。
- **补丁的输出要稳定**：同样的输入永远得到同样的输出，文件里不相关的字节不变。
- JSON（`settings.json`）用 `jsonc-parser` 的 `modify` 只改被编辑的属性，插入处那一行按文件自身的缩进重排。
- 写 CLI 配置文件时原子替换并保留原权限位，不动所在目录的权限；新建的文件按 0600 创建。接管前文件不存在、切回官方后只剩空对象时，删除该文件；接管前是空对象时，按原文逐字节还原。
- **文件写入服务**负责：
  - 确定文件位置：分别遵循 daemon 环境里的 `CLAUDE_CONFIG_DIR` 和 `CODEX_HOME`，默认是 `~/.claude` 和 `~/.codex`。确定方式沿用终端 agent hooks 安装器的做法。
  - 首次写入前做一次完整副本。
  - 计算 hash，重读文件后再做原子替换，最多重试 3 次。
  - 一个文件解析失败时，所有文件都不写。
  - 检测外部改动。
- **切换的原子性**：Codex 切换涉及 `config.toml` 和 key 文件两处。先写 key 文件，再写 `config.toml`。`config.toml` 写入失败时，状态保持为切换前的模式。
- **`auth.command` 的生成**：
  - macOS / Linux：使用系统自带的读文件命令（`/bin/cat`），参数是 key 文件的绝对路径。
  - Windows：使用 PowerShell 的绝对路径，参数为 `-NoProfile -Command` 加读文件的写法，`timeout_ms` 调大。
  - 生成逻辑是一个纯函数，按平台输出 command 和 args。
- **Codex 版本检查**：启用前复用现有的 Codex 版本探测（按 `config.json` 里配置的 codex 命令执行 `--version`），低于 0.118.0 或无法解析版本就返回 `codex_version_unsupported`，消息里带探测到的原始输出。只查 Osuna 使用的 codex；终端里 PATH 上的 codex 若是另一个旧版本，查不到。
- **Codex profile 检查**：启用前检查当前生效的 profile 是否覆盖了负责的顶层键。如果覆盖了，就标为健康状态之一，并给出提示。

### 上游请求

- 拉取模型、测试连接都**由 daemon 在主机上发起**，key 不经过客户端。
- **拉取模型**（`server/api-endpoints/upstream-models.ts`）：先请求 `<base>/v1/models`，失败再请求 `<base>/models`。返回格式兼容 `data[].id` 和 `models[].slug` 两种，显示名取 `display_name` 或 `name`，按 id 去重；`has_more` + `last_id` 时带 `after_id` 翻页，最多 20 页。认证方式：
  - Claude 接口同时带 Bearer、`x-api-key` 和 `anthropic-version`；
  - Codex 接口带 Bearer。
  - 两个地址都失败时，非 404/405 的状态码优先报 `upstream_error`，都连不上报 `upstream_unreachable`，其余报 `models_unsupported`。上游错误信息中出现的 key 先替换成 `***`，再截断到 300 字（先截断会把 key 切成两半，前半截替换不掉）。
  - 超时是两个地址共用的 15 秒（`ApiEndpointServiceOptions.upstreamTimeoutMs`）；超时后不再试第二个地址。拉取不进串行队列，慢的上游不挡切换。
  - 编辑时改了 Base URL 而 key 留空，照样用已保存的 key 去新地址拉取，和保存时「只改地址不用重新粘贴 key」一致；该 RPC 与保存同为 `daemon.manage`。
- **测试连接**（`server/api-endpoints/upstream-connection.ts`）：用 CLI 实际使用的协议，发一条最小请求：
  - Claude：`POST <base>/v1/messages`，Anthropic Messages，`max_tokens: 1`。只带 Bearer 和 `anthropic-version`，不带 `x-api-key`，和 Claude Code 用 `ANTHROPIC_AUTH_TOKEN` 时一致；
  - Codex：`POST <base>/responses`（base 按 Codex 规则补 `/v1`），OpenAI Responses，不带 `store`、`previous_response_id`，也不带 `max_output_tokens`（Codex 自己不发，有的中转站会拒绝）。
  - 结果返回：成功或失败、HTTP 状态码、上游错误信息（规则同拉取模型），以及耗时。
  - 判定：405，或 404 且错误体只是框架默认回复（非 JSON、或信息以 `Not Found` / `Invalid URL` 开头），报 `protocol_unsupported`；2xx 但响应体不是该协议的对象（`type: "message"` / `object: "response"`）也是 `protocol_unsupported`；其余非 2xx 报 `upstream_error`，404「模型不存在」属于这一类。
  - 超时 30 秒（`ApiEndpointServiceOptions.connectionTestTimeoutMs`），比拉取模型长，因为要等模型真正回一句话。不进串行队列。
- **URL 归一化与 Codex CLI 保持一致**：去掉末尾的斜杠；Codex 的 base_url 如果不以 `/v1` 结尾，就补上 `/v1`，和现有自定义 Codex 提供方的处理方式相同。
- 所有上游请求都设置超时，并且可以取消。测试连接的界面文案要写明：它只验证接口本身，不验证 CLI 这一侧。

### 提供方快照与模型选择

- 第三方模式下，Claude 和 Codex 提供方快照里的模型列表，就是当前接口勾选的模型，传给 CLI 的是这些模型的真实 id。默认模型就是该接口的默认模型。官方模型列表不显示。
- 第三方模式下，Claude 从 `settings.json` 读取追加模型的逻辑，不能再产生重复或多余的条目。
- 回到官方模式后，恢复现有逻辑。
- 覆盖点只有一个：`ApiEndpointService.activeModels(provider)`。快照刷新时用它整份替换提供方自己的目录；`AgentManager` 在请求没带模型时也从它选默认模型，所以 CLI、MCP、定时任务不带模型新建会话，同样用接口的默认模型。
- 第三方模式下，快照条目带可选字段 `isModelListAuthoritative: true`，表示列表就是全部可用模型。老客户端忽略这个字段，老主机不发它，按非权威处理，不需要能力门控。
- App 记住的模型（偏好或新建会话的初始值）不在权威列表里时，改用列表的默认模型，不改写记忆。已经打开的新建会话草稿也一样：快照变成权威列表后，表单里不在列表中的模型换成默认模型，只改表单。非权威列表（官方模式）仍保留列表外的 id，新模型可能还没进目录。参考项目的对比见 `research/remembered-model-across-modes.md`。
- 列表权威时，提交新会话不写回模型，因为提交时分不清表单里的模型是回退值还是记忆值。新建定时任务在选择时不写偏好、提交时才写，它的表单知道模型是不是用户手动选的：没手动选过就不写回，手动选的照常写回。编辑已保存的定时任务照常写回。手动选模型、套用 profile 照常按表单解析出的模型记下；切换提供方写回的是原来记住的 id，不改写记忆。这些和官方模式一致。
- 编辑已保存的定时任务不做替换：已保存的模型不在权威列表里也原样保留，不按当前接口悄悄改掉。新建定时任务表单里，用户在启用接口前手动选过的模型同样原样保留（手动选择不被覆盖），和新建会话草稿的迁移不同，这是有意的边界。
- **已知限制**：第三方模式下，用户在选择器里选过模型，或在运行中的会话里选过思考档位（会连同当前模型一起记下），接口的模型就会进入偏好。另外，第三方模式下打开的新建会话草稿，切回官方后表单仍停在接口的模型上（官方列表不是权威列表，不做迁移）。这两种情况下，接口的模型 id 都会被带给官方 CLI，需要用户手动再选一次。只有按模式分开记忆才能根治，本任务不做。

### Agent session 记录与提示

- 每个 Agent session 的持久化记录里新增一个可选字段：创建时所处的模式（接口 id，或者「官方」）。老记录没有这个字段，视为「官方」。
- 恢复会话时，如果记录的模式和当前模式不同，就在会话里提示一次。
- 切换前统计受影响的会话：该提供方下状态为运行中的 Agent session 数量。

### App

- 在提供方详情面板里新增「官方 / 第三方接口」模式区和接口列表，仅限 Claude Code 和 Codex，并且只在主机声明了 `apiEndpoints` 能力时显示。每个接口的操作有：启用、编辑、删除。
- 新建和编辑表单遵循 `docs/forms.md`，用非 React 的表单模型。字段为：名称、Base URL、API key（只写）、拉取模型（可搜索勾选）、默认模型、手动添加模型 id；Claude 另有映射区。
  - 拉取到的列表按 id 和显示名搜索，只画前 50 条，其余提示用搜索缩小，表单里不嵌套滚动。重新拉取保留已勾选的模型；上游没列出的已勾选模型照样保留。
  - 「使用的模型」列表放勾选和手动添加的模型，在这里指定默认模型；取消勾选默认模型时默认顺延到剩下的第一个，指向它的映射档位清空。
  - 映射每档是一个下拉，选项为「不映射」加勾选的模型。
  - 拉取中可以取消；关闭表单也会取消。取消后晚到的结果不生效。
- 测试连接先弹出模型选择，再展示结果：「测试连接」区的下拉按钮列出「使用的模型」，选一个就发请求，测试中可以取消；结果一行写成功或失败、HTTP 状态码、耗时和模型，失败时下面接上游原因。字段说明写明它只验证接口本身，并提示可以在终端试 `/logout`。改了 Base URL 或 key 后，旧结果作废，进行中的测试取消。「不支持协议」的文案同时提示检查 Base URL，因为裸 404 也可能只是地址填错。
- 以下操作需要二次确认：切换、编辑当前启用的接口、删除当前启用的接口。确认框写明受影响的正在运行的会话数，以及「终端里的 CLI 也会切换」。
- 健康状态的展示：
  - 「已被外部修改」时，提供「重新应用 / 切回官方」两个按钮；
  - 「无法解析」「版本不足」「profile 覆盖」时，显示原因和建议。
- 「官方」模式下，如果 CLI 自身配置指向了第三方，就显示一句提示。
- 套餐用量区域：对应提供方启用了第三方接口时，显示一条标注。
- 继承 `claude` 的自定义提供方：Claude 启用第三方接口时，在这些提供方的行上显示提示。
- i18n：9 种语言齐全。URL、模型 id、上游错误信息都不翻译。

## Testing Decisions

- 好的测试只断言外部可观察的行为：RPC 的输入输出、磁盘上文件的最终内容、界面上出现的状态和入口。不断言内部数据结构，也不断言调用顺序。
- **硬性约束：任何测试都不读写开发者真实的 `~/.claude` 和 `~/.codex`，不运行真的 `claude` 或 `codex`，不访问真实的上游服务。**
- **主测试层：进程内 daemon 测试工具**（`docs/ad-hoc-daemon-testing.md`）。
  - 测试环境：临时 `PASEO_HOME`；通过 `CLAUDE_CONFIG_DIR` 和 `CODEX_HOME` 指向临时目录；一个本地假上游 HTTP 服务，提供模型列表和对话端点，并且能配置成返回错误；一个只会打印版本号的假 `codex` 可执行文件。
  - 以客户端身份调用新的 RPC，覆盖以下场景：
    - 创建和更新接口时，响应和列表查询里都不出现 key；
    - 拉取模型的两种地址回退、两种返回格式、上游不支持列出模型；
    - 测试连接的成功、401、模型不存在、协议不符；
    - 启用 Claude 和 Codex 接口后，文件中负责的键符合预期，其余字节不变；
    - 切回官方后，负责的键恢复原值，Codex 的专用 provider 表保留；
    - 外部改动负责的键后，状态变为「已被外部修改」，之后「重新应用」和「切回官方」都能按预期工作；
    - 文件无法解析时，所有文件都不写；
    - Codex 版本不足时拒绝启用；
    - 删除当前启用的接口时，先恢复官方配置；
    - 编辑当前启用的接口后，立即重写文件；
    - 快照里的模型列表随模式切换；
    - 老客户端看不到新能力，也不会受影响。
  - 参照现有的 daemon e2e 测试和进程内测试工具的写法。
- **补丁纯函数测试**：覆盖大量边界情况，包括原有的键和值、空值、缺失、注释和格式保留、与用户的其他键共存、恢复到「原本不存在」、结果稳定、冲突检测、无法解析。参照终端 agent hooks 安装器里 Claude 和 Codex 设置读写的测试（「保留用户无关的 hooks」这类用例）。
- **`auth.command` 生成与执行测试**：一条普通的 server 单元测试，执行生成出来的命令，断言输出与 key 文件的内容完全一致。这条测试在 CI 现有的 `server-tests (windows-latest)` 任务里自动跑 Windows 版本。本机运行时，只会在临时文件上执行系统的读文件命令。
- **协议契约测试**：新 RPC 的请求和响应能正常解析；`server_info` 缺少 `apiEndpoints` 时视为不支持。参照现有 `messages` 协议测试里各功能的写法。
- **App**：
  - 表单模型和面板状态派生写成纯函数测试。覆盖：key 留空表示保留、校验、映射的可选项只能来自勾选的模型、按健康状态和模式派生出的展示状态、需要确认的场景。
  - 界面排版按 `docs/qa.md` 截图验收，覆盖桌面端浅色和深色主题下的：模式区、表单、拉取和勾选模型、测试结果、确认框、「已被外部修改」。
  - 原生端按项目惯例不做实机验收。
- i18n 跑现有的多语言键一致性测试。
- 只运行改动涉及的测试文件，全量测试交给 CI。

## Out of Scope

- Pi、Oh My Pi、OpenCode、Copilot 的第三方接口。
- 中转站预设。
- 多个官方账号的管理与切换。
- 官方与第三方并存，也就是同一时间在不同会话里分别使用。
- 通过调用 CLI 来测试连接。
- 在测试连接或切换时自动执行 `/logout`。
- 用量页按第三方接口单独统计来源或价格。第三方接口的消耗目前会算进官方来源，并按官方价格估算，这是已知限制。
- 从 cc-switch 等工具导入配置，或者与它们同步。
- 后台持续监听文件变化。只在展示状态和执行写入时检测外部改动。
- 自动还原完整副本。完整副本只供手动找回。

## Acceptance Criteria

- [ ] 在支持 `apiEndpoints` 的主机上，Claude Code 和 Codex 的提供方详情里都有「官方 / 第三方接口」模式区，可以新建、编辑、删除多个接口。老主机上不显示这个模式区。
- [ ] 任何 RPC 响应和客户端存储里都拿不到 API key。编辑时 key 留空，保存后原 key 保持不变。
- [ ] 拉取模型支持 `/v1/models` 和 `/models` 两个地址，以及两种返回格式。上游不支持时，可以手动添加模型 id。只保存勾选的模型。
- [ ] 测试连接用选中的模型发出一条最小请求，展示成功或失败、状态码和上游错误。界面说明它只验证接口本身。
- [ ] 启用 Claude 接口后，`settings.json` 里只有负责的键发生变化，`ANTHROPIC_API_KEY` 为空字符串。切回官方后，这些键恢复原值，包括恢复「原本不存在」的状态。
- [ ] 启用 Codex 接口后，`config.toml` 里只有负责的键和专用 provider 表发生变化，注释和格式保留，`auth.json` 一个字节都不变。切回官方后，顶层键恢复原值，专用表保留。
- [ ] Codex 版本低于 0.118.0 时，拒绝启用并说明原因。生成的读取 key 命令在 macOS、Linux、Windows（CI）上输出都与 key 文件一致。
- [ ] 首次写入前留有完整副本。配置文件无法解析时，所有文件都不写。负责的键被外部改动后，显示「已被外部修改」，「重新应用」和「切回官方」两个选项都能正常工作。
- [ ] 切换、编辑当前启用的接口、删除当前启用的接口，都需要二次确认，确认框写明受影响的正在运行的会话数，以及终端里的 CLI 也会切换。删除当前启用的接口时，先恢复官方配置。
- [ ] 第三方模式下，模型选择器只列出勾选的模型，新会话默认使用接口的默认模型。切回官方后恢复原有列表。
- [ ] 恢复在另一种模式下创建的会话时，显示一次提示。
- [ ] 启用第三方接口时，套餐用量旁显示标注。「官方」模式下，如果 CLI 自身配置指向第三方，显示提示。继承 `claude` 的自定义提供方的行上，显示会被覆盖的提示。
- [ ] 所有测试都没有触碰真实的 `~/.claude` 和 `~/.codex`，没有运行真的 CLI，也没有访问真实的上游服务。
- [ ] 相关测试文件和 i18n 一致性测试通过，`npm run typecheck` 和 `npm run lint` 通过。CI 的 Windows server 测试通过。
- [ ] 桌面端浅色和深色主题下，都有 Testing Decisions 中列出的各个界面的截图。
- [ ] ADR 0004 补写了 TOML 库的选择。实现中如有推翻 ADR 的地方，同步修改 ADR。`docs/custom-providers.md` 中与本功能相关的说明已更新。

## Further Notes

- **测试连接的局限**：它是 daemon 直接发出的 HTTP 请求，查不出 CLI 这一侧的问题。例如：
  - Claude 已经登录订阅账号、同时又写入了 token 时，可能出现的冲突；
  - Codex 在多轮对话里带 `previous_response_id`，被无状态的端点拒绝。

  这些问题会在第一次真实对话时暴露。遇到时，提示用户可以尝试在终端执行 `/logout`。
- **已知副作用：继承 `claude` 的自定义提供方会被覆盖**。`settings.json` 的 `env` 优先级高于进程环境变量，所以 Claude 启用第三方接口后，这些自定义提供方也会走当前接口。本任务只加提示，不改变这一行为。
- **正在运行的会话会立即生效**：Claude Code 会把 `settings.json` 的 env 改动重新应用到正在运行的会话上，所以切换时正在运行的 Claude 会话会立刻换到新的后端。Codex 正在运行的会话是否立即生效，以 Codex 的实际行为为准，确认框按「可能受影响」措辞。
- **多张工单的建议切分顺序**（供 `/atw-tickets` 参考）：
  1. 补丁纯函数与 TOML 库选型；
  2. 数据存储与 key 私有文件；
  3. RPC 与能力门控；
  4. 上游拉取模型与测试连接；
  5. 切换与外部改动检测；
  6. 快照与模型选择；
  7. Agent session 模式记录与提示；
  8. App 模式区与接口列表；
  9. App 表单、拉取模型与测试连接；
  10. App 确认框、健康状态与各处提示；
  11. 文档与 ADR 收尾。
