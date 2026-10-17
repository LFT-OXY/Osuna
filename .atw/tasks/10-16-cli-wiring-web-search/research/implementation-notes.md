# 实现记录

## 02 中转站认调用方；关掉开关后会话和旧对话照样能用

### 对照 magpie（7597c132）的结论

认调用方的逻辑在 `packages/server/src/server/api-endpoints/gateway/callers.ts`（`judgeCaller`），纯逻辑用例在同目录 `callers.test.ts`，用例取自 magpie 的 `lan_rebind_test.go`、`cors_test.go`、`lan_test.go`、`agent/useragent_test.go`。

**拒收规则**，按 magpie 的处理顺序（`lanGuard` → `corsGuard`）：

| 规则 | magpie 出处 | Osuna |
| --- | --- | --- |
| 不是回环来源（127.0.0.0/8、::1、映射成 IPv6 的 127.x） | `lan.go` `local` | 一样，403 |
| 带转发头：Forwarded、X-Forwarded-For、X-Real-IP、Cf-Connecting-IP、True-Client-IP、Tailscale-User-Login（空值不算） | `lan.go` `forwardHeaders`、`proxied` | 名单一样。magpie 在共享时放行带 key 的、`MAGPIE_TRUST_PROXY=1` 时也放行，Osuna 没有共享和信任代理，一律 403 |
| DNS 重绑定：带浏览器标记（Origin、Sec-Fetch-Site、Sec-Fetch-Mode、`Mozilla/` 开头的 UA）且 Host 不是本机的名字，又没带口令 | `lan.go` `rebound`、`fromBrowser`、`ownHost` | 本机的名字：IP、localhost、5 个容器宿主机名、`os.hostname()`（去掉 `.local` 后比，带不带 `.local` 都算）。magpie 另认的 `MAGPIE_PUBLIC_URL`、`MAGPIE_ADDR` 的主机名 Osuna 没有对应设置，不认 |
| 别处的网页（http/https 的 Origin，既不在本机也不是请求自己的源） | `cors.go` `foreignPage` | 一样，带口令也拒。magpie 放行用户在设置里列出的网页和 usemagpie.ai 读主题，Osuna 都没有 |
| `Origin: null`（沙箱 iframe、file:// 页面）没带口令 | `cors.go` `corsGuard` | 一样 |
| localhost 子域名上的网页没带口令（Windows 上 tauri.localhost、wails.localhost 除外） | `cors.go` `localhostSubdomain` | 一样 |

magpie 在上述地方要的是「启用的网关 key」（用户建的具名 key），它发给各 Agent 的 `magpie-<agent>` 是公开值、不算 key。Osuna 发给每个 Agent 的口令是 32 字节随机值，网页猜不到，所以在这些地方带了 Osuna 的口令就算数。

拒收一律按 Agent 自己的协议回 403（`permission_error`）。中转站挂载点挪到 daemon 的 Host 白名单与 CORS 中间件之前（`bootstrap.ts`）：否则默认配置下重绑定形式的请求先被白名单以 `{"error":"Invalid Host header"}` 拒掉，不是 Agent 认得的格式；中转站自己按 magpie 的规则拦重绑定，也不再收到 daemon 给本机网页加的 CORS 头（magpie 对没列出的网页同样不给）。

**认是哪个 Agent**：先看口令（Authorization 的 Bearer 与 x-api-key 都读，空的跳过，两个头放了不同值时认得的那个算数，同 magpie `callerKeys`），对不上再看 User-Agent，规则同 magpie `agentOf` / `usage.AgentOf`：产品名取第一个 `/` 或空格之前、小写，先整个比 id 与别名，再比开头。

| Agent | 整个等于（magpie 的 ID + Aliases） | 开头（magpie 的 UA 字段） |
| --- | --- | --- |
| Claude Code | `claude`、`cc`、`claude-code` | `claude-cli`、`claude-code`（`agent/claude.go:1874-1875`） |
| Codex | `codex` | `codex`、`acp-extension-codex`（`agent/codex.go:1057-1058`） |

magpie 另认的 Claude Desktop（`Mozilla/… Claude/…`）、Claude Science（`X-Anthropic-Surface: operon`）和其余几十个 Agent，Osuna 的中转站只服务 Claude Code 与 Codex，不认。

**口令和 User-Agent 都认不出时按路径**（Osuna 自己的补充，magpie 不需要知道是哪个 Agent 才能选路）：`/v1/messages` 与 `/v1/messages/count_tokens` 是 Claude Code，`/v1/responses` 是 Codex。Agent 只影响 Claude 档位名映射和 Codex 的 auto-review、记忆整理跟上一轮走，按请求格式猜是最贴近的。08 号工单加的 ChatGPT 后端路径照 ADR 0010 认作 Codex。

### 口令与 Codex 服务商表

- 口令发了就一直用：开着却没有的补一个，关掉不删，再打开沿用（`service.ts` `nextGatewayTokens`）。
- 关掉 Codex 的开关只还原三个顶层键，`[model_providers.osuna_api_endpoint]` 留着（`codex-config-patch.ts` `restoreCodexOfficial`）。接管前文件不存在的，关掉后文件里只剩这张表；用户连表也删了、什么都不剩时才删文件。
- daemon 启动时 Codex 开关关着：文件里有这张表就改指这次的端口和 Codex 的口令（`refreshCodexProviderTable` + `service.ts` `refreshKeptCodexTable`），没有就不写，用户删了不写回。旧版本（v0.15）关开关时留下的 auth.command 表同样换成指向中转站的（原来是删掉），这样记在它名下的旧对话也能续；那时的口令已作废，没有 Codex 口令就补一个，先落口令文件再替换 config.toml。随之删掉了不再用的 `removeCodexProviderTable` 与 `removeLegacyCodexLeftovers`。
- 官方模式下的这张表不进健康检查，接管记录也不记它：启动时直接对照文件内容判断要不要改写。

## 03 设置页的提示区

### 线上形状

- 列表响应新增可选 `agentIssues`，按 provider 索引、两个 Agent 都给（与请求的 provider 无关，Codex 页共用 Claude 页那份缓存）。每条 `{ code, params?, message }`：`not_through_gateway`（file、keys）、`config_unparsable`（file、detail）、`codex_profile_override`（file、profile、keys）。app 按 code 翻译，认不出的照英文 `message`。老的 `health` 原样保留，老客户端照旧看到 `modified_externally`。
- 「重新应用」是 `set_agent_settings` 新增的可选 `reapply: true`（与 `enabled: true` 一起），设置没变也重写 CLI 配置；「切回官方」就是 `enabled: false`；「保留当前设置」是新 RPC `provider.api_endpoint.keep_current_settings.*`：先忘掉接管记录（备份留着），再关开关，commit 里的切回官方因此不改文件；关着时调用什么都不做。
- 能力位 `apiEndpointCliWiring`（`COMPAT(apiEndpointCliWiring)`，本任务所有新界面共用）。没声明时提示区不显示，区块底部一行请用户更新主机。

### 什么算「不再经过中转站」

| Agent | 被外部改了就算的负责的键 | magpie（`applied.go` `Drift`、`claude.go` / `codex.go` 的 `Check`） |
| --- | --- | --- |
| Claude Code | `env.ANTHROPIC_BASE_URL`、`env.ANTHROPIC_AUTH_TOKEN` | 同：`wiringOff` 查这两个；另查托管设置的地址、云平台开关（16 号工单）、保留 claude.ai 登录时口令该空（18 号工单） |
| Codex | `model_provider`、`model_catalog_json`、`[model_providers.osuna_api_endpoint]`（地址、口令、wire_api、name） | 同：`model_provider` 不是 magpie 的、目录不是 magpie 的、服务商表不指向网关都报 `unwired`；`openai_base_url` 与镜像服务商表归 ChatGPT 接法那几张工单 |

- 其余负责的键（Claude 的 `model`、`modelPicker`、模型提示变量、WebSearch 禁止规则；Codex 的 `model`）被改，本张保持现有判断：只进 `health` 的 `modified_externally`，不进提示区。magpie 对模型字段另有做法：从一个 magpie 模型换到另一个不算，换成 Agent 自己的模型报 `replaced`（「模型被换掉」），交 21 号工单；模型提示、`/model` 列表这类派生字段 magpie 不查，只在 Reapply 时重写。
- magpie 的 `unwired` 只在 Agent 当前模型是 magpie 的时候才查（`Drift` 里 `Check` 前的 `isMagpie(get())`）；Osuna 以接管记录为准，开关开着就查。
- magpie 的 Keep 只删 `applied.json` 记录、不动开关（magpie 没有开关）；Osuna 照 ADR 0012 关掉开关、忘掉接管记录。

### 保留当前设置后的 Codex 模型目录

`config.toml` 被外部改了 `model_provider` 但仍写着 Osuna 的 `model_catalog_json` 时，「保留当前设置」后 Codex 还会读这个目录文件。关开关原本会删掉它，Codex 就读不到了；现在 config.toml 还写着它时，关开关与 daemon 启动对账都不删（`service.ts` `codexConfigNamesCatalog`）。正常切回官方会把 `model_catalog_json` 改回原值，目录照旧删除。

被外部改走的 Osuna 服务商表：「保留当前设置」时在 `takeover-codex.json` 记下 `tableKept`，daemon 启动不再按 ADR 0010 改写它，直到再打开开关（写接管记录时这个标记随之去掉）；代价是记在这张表名下的 Codex 对话续到用户自己的地址（ADR 0012）。「切回官方」照旧不动表、下次启动改回指向中转站。

### 测试 daemon 的升级封条

浏览器用例点中过「Upgrade to …」按钮，测试 daemon 在本机执行了 `brew upgrade --cask claude-code@latest` 又被中途杀掉。现在所有 e2e 测试 daemon（`isolated-host-daemon.ts`）经 `NODE_OPTIONS=--import` 预加载 `e2e/support/daemon-upgrade-seal.mjs`：npm registry 的版本查询回 404（不出升级按钮），brew、`update` / `upgrade` 子命令、安装脚本、`npm -g` 换成立刻以 1 退出的进程。点行改用 `clickProviderRow`（点左上角）。核实：起一个隔离 daemon，版本检查全部 `npm registry answered 404`，直接发 `provider.upgrade claude` 得到 `command_failed`、输出 `blocked by the e2e upgrade seal`，`/opt/homebrew/bin/claude` 不变。

## 04 「自己能联网搜索」开关；Claude Code 的搜索

### 线上与存储

- 接口的字段叫 `searchesWeb`（magpie 叫 `searches`）。列表与 `save` 响应总带布尔值；`save` 请求省略即保留原值（老客户端、官方 Paseo 手机 App 保存时不会关掉它）。`endpoints.json` 只在打开时存 `searchesWeb: true`，关着就没有这个键，旧文件照常读。
- 界面挂在已有的能力位 `apiEndpointCliWiring` 上，没有另加；没声明的主机不显示这一区。只有 Chat 地址的接口不显示。
- 开关切换就走一次整份 `save`（带上当前的模型、手动模型与档位映射），失败原因留在开关下面（`rowError`），下次切换时清掉；保存中开关禁用并显示「正在保存…」。

### settings.json

- 「至少一家开着的接口在 Anthropic 或 Responses 地址上打开了开关」才放开（`gateway/web-search.ts` `someEndpointSearchesWeb`）；只有 Responses 地址、打开了开关的也算数（PRD 第 7 条），但它的搜索要等 06 号工单才交得出去，在那之前这个模型的搜索得到下面的 400。
- 放开时只拿掉 Osuna 写的那条（`webSearchDeny.added` 为真时），因它新建、现在空了的 `deny` 与 `permissions` 一并收走；记录随即记成「不归 Osuna」，之后再要禁止时按当时的文件重新判断要不要新建容器。用户自己写的 `"WebSearch"` 一直不动。
- 这个条件进了 `cliFingerprint`，变了就重写；启动对账（只比地址与口令）不管它，因为它只随 RPC 改变。

### 中转站

- 认搜索子请求：Anthropic 请求的 `tools` 里有 `type` 以 `web_search` 开头、没有 `input_schema` 的工具（照 magpie `anthropic.go` 读服务端工具那段）。只对 `/v1/messages` 起作用；Codex 的 `web_search` 归 05 号工单。
- 候选在 `resolveGatewayRoute` 选出的同一模型候选里筛：打开了开关、有 Anthropic 地址；筛出的候选只保留 Anthropic 地址，于是只会原样直通，不会因为某个格式被拒而换成翻译（翻译会剔掉搜索工具）。之后的排序、粘性、冷却、自动切换照旧。
- 一家都没有：400 `invalid_request_error`，文字 `Web search is not available for <模型>: no API endpoint that is on and serves this model has "Searches the web by itself" turned on in Osuna.`，不问任何上游。
- 直通对非 Claude 模型照旧去掉 system 里的计费行（magpie 同样）；e2e 用 Claude 模型名验证 tools 与 system 原样到达。

## 05 Codex 的搜索工具按开关保留或拿掉

### 对照 magpie（7597c132）的结论

- **工具**：magpie 对不会搜的那家不直通，在客户端自己的协议上重建请求，重建时 `searchesFor` 为假就不写搜索工具（`gateway.go` 的 `ownAPI` 与 `searchesFor` 那段；测试 `search_own_api_test.go` `TestSearchOfferedStaysOnTheClientsAPI` 断言请求体里没有 `web_search`）。会搜的那家原样直通。
- **什么时候算要了搜索**：magpie 只对 `searchAsked` 成立的请求重建（`search.go` `searchAsked`，`gateway.go` 的 `ownAPI` 那段）：请求带着 `type` 以 `web_search` 开头的工具，且 `tool_choice` 不是没列它的 `allowed_tools`（`responses.go` 读 `allowed_tools` 那段，`r.WebSearch = r.WebSearch && webSearch`）。不成立的请求照常直通，一个字不改，连 `allowed_tools` 排除掉的 `web_search` 工具也原样带着。
- **历史里的 `web_search_call`**：magpie 解析 Responses 的 `input`（`responses.go` 读 items 的 switch）没有这一项的分支，所以只有在重建时它才被丢掉；同一个对话里搜索前的说明、引用搜索的回答照常保留。没要搜索的请求、发给会搜的那家的请求都原样带着。Osuna 照做：只在要了搜索时，不会搜的那家收到的 `input` 去掉 `web_search_call`，其余项原样。
- magpie 发给 ChatGPT 后端时「历史里有 `web_search_call` 却没声明工具就补上只读缓存的 `web_search`」（`search_history_test.go`）归 10 号工单，这里没做。

### 怎么做的

- 改在直通请求体上（`passthrough.ts` `upstreamBody` 的 Responses 分支，`gateway/web-search.ts` `withoutResponsesWebSearch`）：这家在 Responses 上不算会搜（`searchesWebItself(endpoint, "openai_responses")` 为假）、请求又要了搜索时，去掉 `type` 以 `web_search` 开头的工具、点名它的 `tool_choice`（`{"type":"web_search"}`；`allowed_tools` 里列了它的拿掉那一项，一项不剩整个去掉）和 `input` 里的 `web_search_call`；一个工具都不剩时 `tools` 与 `tool_choice` 一并去掉（同画图工具、advisor 的先例）。只改变了的顶层字段，其余字节原样。没要搜索的请求原样发出。
- 按每次发出去的候选判断，自动切换换家时下一家按它自己的开关重新判断；被拒重问（`refit`、去掉画图工具）也走 `upstreamBody`，同样生效。
- 翻译出去的请求（Responses → Chat / Anthropic）本来就剔掉 `web_search` 与 `web_search_call`（`translation/responses.ts`），所以只有 Anthropic 地址、打开了开关的接口现在等同没打开；06 号工单再改成翻译成 `web_search_20250305`。
- 不另加「上游以 400 拒收 `web_search` 就去掉重问」：不会搜的那家一开始就收不到这个工具。

## 06 搜索在 Anthropic 与 Responses 之间互译

04 节「筛出的候选只保留 Anthropic 地址」「只有 Responses 地址的要等 06 号工单」与 05 节「只有 Anthropic 地址、打开了开关的接口等同没打开」到此作废，以本节为准。

### 对照 magpie（7597c132）的结论

- **先挑会搜的协议**：magpie `gateway.go` translated 里 `request.WebSearch` 那段，按这家可用的协议顺序找第一个 `searchesFor` 成立的作为目标。Osuna：Claude Code 的搜索子请求只留这家会搜的地址（有 Anthropic 就只留 Anthropic、原样直通，否则只留 Responses、翻译过去，`gateway.ts` `webSearchCandidates`）；Codex 要了搜索时在这家会搜的格式里挑（`web-search.ts` `formatsToSearchOn`，接在 `askableFormat` 与按格式被拒换格式的 `nextFormat` 上），没有会搜的格式照原顺序挑。所以填了 Chat 与 Anthropic、Anthropic 上打开开关的接口，Codex 的搜索翻成 Anthropic，不再按平常的顺序翻成 Chat 丢掉搜索；Anthropic 地址说没有这个模型时照常换到 Chat（不带搜索）。
- **只对会搜的格式带搜索**：magpie 的 `searchesFor` 决定重建时写不写搜索工具。Osuna 在 `askOnce` 按这次的目标格式 `withWebSearchFor`：不会搜的去掉 `webSearch`，连同点名搜索的 `tool_choice`。
- **请求**：中间格式多一个 `webSearch`（magpie `ir.go` `WebSearch`）。Anthropic 解析照 `anthropic.go` 读服务端工具（`asksAnthropicWebSearch`），Responses 解析照 `searchAsked` 与 `allowed_tools`（`asksResponsesWebSearch`）。构建：Anthropic 在函数工具后面加 `{"type":"web_search_20250305","name":"web_search","max_uses":5}`（`anthropicBody`，缓存标记仍在最后一个函数工具上）；Responses 加 `{"type":"web_search"}` 并在 `include` 里要 `web_search_call.action.sources`（`buildResponses`），xAI 自己的地址不要（`vendor-rewrites.ts` `withSearchSourcesFor`，只去掉中转站加的，Codex 自己要的照留）。客户端写在工具上的 `max_uses`、域名过滤不保留（magpie 同样）。历史里的 `server_tool_use`、`web_search_tool_result`、`web_search_call` 照旧不读。
- **回复**：Responses 的 `web_search_call`（`output_item.done`）读成一次搜索（`responsesDecoder`），Anthropic 编码写成 `server_tool_use`（查询词走 `input_json_delta`）加带完整结果的 `web_search_tool_result`，整份回复写成同样两块（`anthropicEncoder` KSearch、`renderAnthropic`、`searchResultBlock`，不写搜索方的 `encrypted_content`）。Responses 编码写成 `output_item.added`、`response.web_search_call.completed`、`output_item.done`，前面说完的消息按 commentary（`responsesEncoder` KSearch、`responsesSearchItem`，`query` 与 `queries` 都写）。

### 与 magpie 不同的地方

- **点名搜索照 magpie**：Claude Code 子请求的 `{"type":"tool","name":"web_search"}` 发 Responses 时照 magpie `buildResponses` 写成 `{"type":"function","name":"web_search"}`，虽然 `tools` 里只有原生 `web_search`。曾考虑写成托管工具的 `{"type":"web_search"}`（openai-agents 的 JS、Python 库用这种写法），但这种写法和 magpie 的写法都没有对真实接口验证过，没有核实过的坏处就不偏离 magpie。magpie 这条路径没有测试（research/web-search.md 第 5 题）。
- **Anthropic 上游的搜索写回 Codex**：magpie 的 `anthropicDecoder` 跳过 `server_tool_use` 的内容、不读 `web_search_tool_result`，Codex 收不到 `web_search_call`；工单要求写回，所以 Osuna 按结果块的 `tool_use_id` 找到它的 `server_tool_use` 取查询词，结果项取 title、url、page_age；结果是错误对象时交出一次没有页面的搜索。属于比 magpie 多做。
- **Responses 结果项的标题**：magpie 只读 sources 的 url、标题也用 url；Osuna 在 source 带 `title` 时用它，否则同 magpie。
- 文字修补（`textCallFilter`）收到搜索时先交出扣着的文字，保住先后顺序；断流续写不把搜索当作调用（magpie `continuation.add` 同样只看 KToolStart、KToolArgs）。

## 07 Codex 模型目录写真实能力

### 对照 magpie（7597c132）的结论

| 项 | magpie | Osuna |
| --- | --- | --- |
| 上下文 | `codexcat.go` `entriesAt`：知道窗口才写 `context_window`；用户设了压缩阈值时写阈值，`max_context_window` 写整个窗口 | 知道就写 `context_window`，不写 `max_context_window`（Osuna 没有压缩阈值设置，窗口就是整个窗口）；不知道照旧两项都写 272K |
| 档位名 | `live.go` `levelsOf`：非空、去重、原样、顺序不变 | 同，另去掉首尾空白（`codexReasoningLevels`）。Codex 认得的九个名字之外的非空字符串它当作自定义档位收下（`codex-rs/protocol/src/openai_models.rs` `ReasoningEffort::Custom`），所以不改名、不丢认不得的；空串会让整个目录读不进来 |
| 默认档 | `ModelDefault` + `NearestEffort`（含 ultra，一样近取强的，不取 none）+ `DefaultEffort`（medium、high、第一档） | 照搬（`codexDefaultLevel`）。四档固定时的结果与之前相同，只有 `model_reasoning_effort = "ultra"` 由 medium 变成 xhigh |
| 知道没有档位 | `Efforts: []`、不写默认档、`supports_reasoning_summaries` 为假 | 同（models.dev 列着却没有一家给档位的模型） |
| 看图 | 写 `input_modalities`：`["text"]`，`Images` 为真再加 `image`；models.dev 按家数投票（`catalog.go` `load` 的 `votes`），清单读 `modalities.input` | 知道才写；models.dev 同样投票，打平算不收。清单另读 OpenRouter 的 `architecture.input_modalities` 与 Codex 的 `input_modalities`（多读，同 `readFacts` 已读这两家的窗口） |
| 档位说明 | 一律空串 | low / medium / high / xhigh 用 Codex 自带目录的说明，别的空串 |
| 回复上限 | 不写 | 不写：Codex 的 `ModelInfo` 没有这一项。资料里的 `output` 照旧只给 Claude Code 与中转站 |

### 回复上限为什么不写（工单与 PRD 第 23 条要求写）

【源码核实】openai/codex @ `ce0323f2f2d3b25e82806cd555237da3db4e1897`（2026-10-17，`git clone --depth 1` 到新的临时目录，只读）：

- Codex 读 `model_catalog_json` 用 `serde_json::from_str::<ModelsResponse>`（`codex-rs/core/src/config/mod.rs:2198-2200`），`ModelsResponse` 只有 `models: Vec<ModelInfo>`（`codex-rs/protocol/src/openai_models.rs:851-857`）。
- `ModelInfo` 的全部字段（`codex-rs/protocol/src/openai_models.rs:408-515`）里有 `context_window`、`max_context_window`、`auto_compact_token_limit`、`truncation_policy`，没有任何回复上限（max output / max tokens）字段。
- 在 `protocol/src/openai_models.rs` 与 `models-manager/src` 里搜 `max_output`、`output_token`、`max_tokens`，只命中 `tool_output_token_limit`（`models-manager/src/config.rs:8`，用到 `model_info.rs:32`）：那是工具输出的截断长度，不是模型的回复上限。

所以目录里没有地方写回复上限，写了 Codex 也不读；资料里的 `output` 照旧给 Claude Code 与中转站。10 号工单合并的清单是同一个 `ModelInfo` 格式，同样不写。

### 旧缓存里没有看图这一项

本次之前下载的 `models-dev.json`、之前拉的接口清单（`endpoints.json` 里的 `catalog`）都没有 `images`。在下次下载 models.dev（缓存满一天后）或重拉这家清单之前，这些模型的条目不写 `input_modalities`，Codex 按缺省（`default_input_modalities` 是文字加图片）当它们能看图，只收文字的模型这期间也会被当成能收图。

### 与 magpie 不同、要判断的地方

- **查不到的照旧，不照 magpie 写成「不知道」**：工单要求查不到的保持现在的写法，所以逐项回退：上下文 272K、四档固定、不写 `input_modalities`（Codex 缺省当能看图，`default_input_modalities`）。magpie 对不知道的模型写 `["text"]`、不给档位、不写窗口。
- **没做的 magpie 字段**：`withUltra`（别家卖的 OpenAI 模型补 ultra 档、标 multi-agent V2）、`multi_agent_reasoning_effort`、`service_tiers`、`supports_search_tool`、`auto_review_model_override`、`apply_patch_tool_type: freeform`、截断按 tokens。都不在工单的四项里，归 23、24 号或以后的工单。

### 怎么做的

- `codex-model-catalog.ts`：`codexModelEntry`（一个条目）、`codexReasoningLevels`、`codexDefaultLevel` 都导出，10 号工单合并 ChatGPT 清单时直接用 `codexModelEntry`。`buildCodexModelCatalog` 多一个 `factsFor`，光秃秃的名字按最早开着、选了它的那家查（与 Claude Code 起始模型、中转站先发给哪家一致）。
- `ModelFacts` 多一个 `images`；`models-dev.json` 与 `endpoints.json` 里存的清单资料旧文件没有这一项，下次下载、重拉清单补上（同 `sampling` 的先例）。
- models.dev 下载的条件改为价格表自动更新开着且 Claude Code 或 Codex 的总开关开着；两个都关着到有一个打开时马上检查一次。下载更新后、重拉某家清单后，Codex 开着就重写模型目录（内容不变不写）。
- 测试 daemon 可以换掉 models.dev 的下载函数和检查定时器（`modelsDevFetch`、`modelsDevTimers`，同 `retiredModelsTimers` 的先例），e2e 用它验证两个开关都关时到点不下载、只开 Codex 时下载并据此重写目录，不联网。
