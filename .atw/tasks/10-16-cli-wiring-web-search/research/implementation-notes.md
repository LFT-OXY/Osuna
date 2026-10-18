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

## 08 ChatGPT 后端路径原样转发

### 对照 magpie（7597c132）的结论

| 项 | magpie（`internal/gateway/codex_backend.go`） | Osuna（`gateway/chatgpt-backend.ts`） |
| --- | --- | --- |
| 路径 | `CodexPath = "/backend-api/codex"`，挂在网关根上 | 同，挂在中转站入口下：`/api-endpoint-gateway/backend-api/codex/…` |
| 转去哪 | `provider.CodexBase` + 原路径 + 原查询串（`codexUpstreamOn`） | 同；地址可由测试换成本机假后端（`gatewayChatGptBaseUrl`、`gatewayOpenAiApiBaseUrl`） |
| 请求头 | `copyHeaders`：除 `hopHeader`（Connection、Keep-Alive、Proxy-Connection、Transfer-Encoding、Upgrade、Te、Trailer、Content-Length）、Host 与 magpie 的账号选择头外全带；另删 `Accept-Encoding` | 除同一组逐跳头与 Host 外全带，`Accept-Encoding` 与 `Content-Length` 也照带（见下） |
| 请求体 | 读出来（解 zstd）、改条目 id、补搜索工具，发出前再压回 zstd | 一个字节不改，`req` 直接 pipe 给上游（工单要求原样） |
| 回复 | 除逐跳头外的回复头照回，边收边回 | 同，`Content-Length` 也照回（字节没变） |
| WebSocket | 处理函数里看 `Upgrade: websocket` 回 426 | daemon 的 `upgrade` 事件里回 426（`answerChatGptWebSocket`，`bootstrap.ts`）：Node 的握手不进 Express。挂在 daemon 自己的 `/ws` 服务之前，`/ws` 跳过已经答完的 socket（见下） |
| `Bearer sk-` | `apiKey`：`Authorization` 去掉 `Bearer ` 后以 `sk-` 开头，除 `/models` 外转 `https://api.openai.com/v1` + 原路径 | 照做（`chatgptTarget`） |
| 认调用方 | 路由本身专给 Codex | `judgeCaller` 照旧先拦网页与转发；这组路径按路径认作 Codex（日志记 `agent: "codex"`），口令与 User-Agent 不影响它：原样转发用不到 Agent |
| API key 被拒 | `codexKeyRefused`：转去 OpenAI API 的请求得到 401 时，改写成带 OpenAI 原话的说明 | 照做（`apiKeyRefusedMessage`），说明里的「选 magpie 的模型」换成「选接口模型（<endpoint>/<model>）」；ChatGPT 自己的 401、403 原样回 |
| 连不上 | `codexUnreached`，502 | 502，OpenAI 形状，说明 ChatGPT 连不上、Codex 自带模型经中转站走 Codex 自己的登录 |

### `Bearer sk-` 的结论：照 magpie 转给 OpenAI API

ADR 0010 下 API key 登录写的是 Osuna 的 Codex 服务商表，不写 `openai_base_url`，正常不会有 `sk-` 的请求到这组路径。只有开关开着、用户从 ChatGPT 登录换成 API key 登录、Osuna 还没按新登录方式重写 `config.toml` 的空档里，Codex 仍按 `openai_base_url` 把 API key 发到这里。不转的话 ChatGPT 会以 401 拒收这个 key，这一轮失败；照 magpie 转给 OpenAI API，和用户没开开关时 API key 登录的 Codex 去的地方一样（`codex-wiring.md` 第 3 题：没有 base_url 时 API key 登录默认 `https://api.openai.com/v1`）。key 只发给 OpenAI，不发给第三方接口，符合 PRD 第 14 条。模型清单照 magpie 仍问 ChatGPT。

### 比 magpie 少做的（都超出「原样转」）

- 不删 `Accept-Encoding`、不把请求体解开再压回：magpie 这么做是为了从回复里读用量、改请求体；Osuna 这里只转发，Node 的 `http` 客户端不自动解压，回复按 ChatGPT 的编码原样回给 Codex。
- 不做 magpie 对自带模型的请求体修补（`plainItemIDs`、`boundCallIDs`、`DeclareSearch`、`withoutUnreadable` 重问）、ChatGPT 断连重问（`edgeMayDrop`）、额度重置（`autoResetSignedIn`）、网页当 502（`notAnAPIReply`）、空错误补说明（`codexFailedEmpty`）：工单要求请求体与回复原样，ChatGPT 的 401、403 原样回给 Codex。搜索工具补声明归 10 号工单（05 节）。
- magpie 的标题、描述、预测小请求另转、子 Agent 换模型、禁用的自带模型、多号轮换：Osuna 没有这些设置（多号轮换在子任务 9）。
- 模型清单合并、`/responses/compact` 与 `/alpha/search` 按模型分流归 10 号工单；本张一律原样转。

### WebSocket 426 的写法

daemon 的 `ws` 服务（`path: "/ws"`）原先用 `server` 选项自己挂 upgrade 监听，对路径不符的握手同步写 400 并销毁 socket，会和 426 抢同一个 socket。现在它改成 `noServer`，由 `websocket-server.ts` 自己挂 upgrade 监听：socket 已经结束或销毁（426 已经答完）就不碰，其余照旧交给 `wss.handleUpgrade`（路径不符照旧 400）；关闭时自己摘掉这个监听。e2e 直接读 socket 上的全部字节，断言只有一个 `HTTP/1.1 426`，后面没有 400。

## 09 用 ChatGPT 登录的 Codex 只改 ChatGPT 地址

### 对照 magpie（7597c132）的结论

| 项 | magpie（`internal/agent/codex.go`） | Osuna |
| --- | --- | --- |
| 判断登录方式 | `codexChatGPT`：读 `auth.json`（或钥匙串）看有没有 access token | 起临时 app-server（`codex -c model_provider="openai" app-server`，`CODEX_HOME` 设成正被改写的 `config.toml` 所在目录：Codex 提供方设置里的环境变量可能另设 `CODEX_HOME`，那样问的和改的会是两处），`initialize` 后发 `account/read`（`codex-sign-in.ts` `createCodexSignInReader`，经 `codex-app-server-agent.ts` `requestTemporaryCodexAppServer`）。覆盖成内置 openai 是因为当前服务商是 Osuna 的表时它报不出账号。`account.type` 为 `chatgpt` 才算 ChatGPT；`apiKey`、`null`（未登录）、其余（如 `amazonBedrock`）都按服务商接法 |
| 什么时候判断 | 每次 Sync | 打开开关（含「重新应用」）前、`list` 时（Codex 开着才问）、daemon 启动后（先按接管记录现在的接法对账，再在后台问，不让启动等 Codex）。同一时间只问一次 |
| 判断不出 | 关了账号发现时按上次接的样子（`joined() \|\| beside()`） | 同：没装 Codex、超时（20 秒，ChatGPT 账号的 `account/read` 会先向 chatgpt.com 查工作区路由，Codex 自己最多等 15 秒）、回答认不出时记日志，保持上次的结果；从没判断出时按接管记录现在的接法，没有接管记录按服务商接法 |
| ChatGPT 接法写什么 | `Join`：拿掉 `model_provider`、`model_catalog_json`，写 `openai_base_url = <网关>/backend-api/codex`，`model` 不动（Codex 上次选的），`putProvider` 照写服务商表 | 同（`codex-config-patch.ts` `wiringRaws`）。`openai_base_url` = 中转站地址 + `/backend-api/codex`（`CHATGPT_BACKEND_PATH`）。`model` 不归 Osuna、不进接管记录（用户自己的服务商除外，见下）：Codex 自己选过的原样留着，没选过就照旧没有（用 Codex 自己的默认模型）；从服务商接法换过来时放回接管前的样子；开着时 Codex 在 `/model` 里换的模型切回官方后也留着（magpie `Unwire`「a model of Codex's own picked while joined stays」） |
| 登录方式变了 | Sync 时重新 Join 或改成服务商模式 | 判断结果与接管记录的接法不同（记录里 `openai_base_url` 有写入值即 ChatGPT 接法，`isChatGptWiring`）就按新方式重写：上一种接法独有的 `openai_base_url` 按接管记录放回原样、不再记；两种都负责的键沿用第一次接管时记的原值 |

### 用户自己写的 `openai_base_url`

magpie 的 ChatGPT 接法（`Join`，以及选了 magpie 模型时的 beside 那段 `set`）不看原值，直接写成网关地址；断开时 `dropBase` 只在它是 magpie 的地址时删掉，原值不存，所以用户写的地址丢了。只有 magpie API 模式（`u == "" || viaBase()` 才写）和多号 failover（`codex.failover` 标记）不碰用户写的。

Osuna 照 magpie 的 ChatGPT 接法把它换成中转站地址（不换，Codex 自带模型的请求就不经过中转站，开关等于没开），另照 ADR 0004 在接管记录里记原值（值的原文，含引号），切回官方、或换成服务商接法时放回原处（比 magpie 多做）。用例：`codex-config-patch.test.ts`「replaces an openai_base_url the user wrote and puts it back on Official」、`api-endpoint-codex-sign-in.e2e.test.ts`「an openai_base_url the user wrote …」。

### 用户自己写的顶层 `model_provider`：照 magpie（用户 2026-10-18 决定）

接管前用的是用户自己的服务商（不是 `openai`、也不是 CC Switch 的 OpenAI 镜像，镜像照 magpie `isCCSwitchMirror` 认：名叫 OpenAI、`requires_openai_auth = true`、没有 `base_url`）时，magpie 的 `Join` 不接（`codex.go` `Join`），`connect`（`internal/agent/applied.go`）接着挑一个 magpie 模型 `set` 上；ChatGPT 登录、账号没被扣住时走 beside 那段：照样 `DelTOMLTop("model_provider", "model_catalog_json")`、写 `openai_base_url` 和 `model = <挑中的模型>`（`codex_ccswitch_test.go` `TestCodexTakesCCSwitchTables` 用带 ChatGPT 令牌的 auth 验证了这条路）。用户决定完全照做：Osuna 拿掉用户的 `model_provider`（记原值、关掉时放回），`model` 写成 magpie `connect` 挑的那个（`codex-config-patch.ts` `chatgptModel`、`magpieConnectPick`）：Codex 原来的模型去掉前缀后，先找同名的（含带 `[1m]` 的），再找光秃秃档位名所指那一族的，都没有取第一个；候选是开着的接口的「接口标识/模型名」，按聊天模型选择器的顺序（`service.ts` `cliModels` 的 `endpointModels`）。magpie 另有的 Codex 自带模型、订阅、经 magpie 的 ChatGPT 账号（`OwnVia`）几档 Osuna 没有。写进去的「接口标识/模型名」要等 10 号工单把接口模型并进 ChatGPT 清单、中转站按标识选路后才能用。其余情况（`openai`、镜像、没写服务商）照旧不碰 `model`。

### 其余做法

- 接管记录的 `keys.<键>.written` 可为 `null`：表示 Osuna 拿掉了这个键（ChatGPT 接法的 `model_provider`、`model_catalog_json`）。健康检查按「文件里不该有它」比对，所以别的程序加回 `model_provider` 也算「不再经过中转站」。
- 提示区的路由键加了 `openai_base_url`：被别的程序改了报 `not_through_gateway`（03 号工单的提示）。被改过时，登录方式变了也不自动重写，等用户点「重新应用」（与 `rewriteClaudeHints` 被改过就不动的先例一致），「重新应用」按新的登录方式写。
- 拿掉又放回的键（用户自己的 `model_provider`）回到最后一个顶层键后面：值一样，位置不保证（Claude 那边 `ANTHROPIC_MODEL` 等变量的先例）。接管前没有 `model_provider` 的文件切回官方逐字节还原。
- 生产以外不起真的 Codex：`createTestPaseoDaemon` 总是带一个回答「未登录」的 `readCodexSignIn`（用例自己传的优先）；app e2e 的 daemon 封条（`daemon-upgrade-seal.mjs` `isCodexSignInProbe`）把带 `app-server` 与 `model_provider="openai"` 的启动换成立刻以 1 退出的进程，daemon 按判断不出处理。

### ChatGPT 工作区路由会不会绕过中转站：不会

【源码核实】openai/codex @ `8d9f6466ff0294785d56f55b1fe363d132fe4133`（2026-10-17，`git clone --depth 1` 到新的临时目录，只读，没有运行）：

- 路由只在服务商是内置 openai、走第一方登录、地址为空或以 `/backend-api/codex` 结尾（`supports_codex_backend_routes`，`codex-rs/model-provider-info/src/lib.rs:620-627`）且是 ChatGPT 登录时才去问（`codex-rs/model-provider/src/provider.rs:216-247`）。Osuna 的地址满足这几条，所以确实会问。
- 问的是 app-server 的 `read_account(Some(request))`（`codex-rs/app-server/src/request_processors/account_processor/workspace_routing.rs`）：先向 `chatgpt_base_url`（缺省 `https://chatgpt.com/backend-api/`，不受 `openai_base_url` 影响）查账号的工作区，再判断这次请求是否「绑在工作区上」（同文件 `workspace_bound`，第 491-499 行），四个条件任一成立才改写：
  1. `previously_routed`（这个会话之前被改写过）；
  2. 服务商地址正好是 `https://chatgpt.com/backend-api/codex`；
  3. 服务商地址的 origin 等于这个会话的 `chatgpt_base_url` 的 origin；
  4. 两个 `chatgpt_base_url` 相同，且工作区后端的 origin 等于服务商地址的 origin。
- Osuna 的地址是 `http://127.0.0.1:<端口>/api-endpoint-gateway/backend-api/codex`：不是 2；origin `http://127.0.0.1:<端口>` 不等于 `https://chatgpt.com`，3 不成立；工作区后端必须是 https origin（`parse_backend_url` 要求 `https`），4 不成立；新会话的 `previously_routed` 从 false 起（`WorkspaceRoutingContext::new`，`codex-rs/model-provider/src/workspace_routing.rs:28`），只有被改写过才变 true，1 不成立。于是 `workspace_routing = None`，`apply_workspace_routing` 不会把请求的 origin 改到 ChatGPT 的工作区后端，请求照旧发到中转站。

由此带出的两点（都不需要改 Osuna）：

- 用 ChatGPT 登录时 app-server 每个会话仍会直接向 chatgpt.com 查一次工作区（账号接口走 `chatgpt_base_url`，不经过中转站），查失败（401、超时等）这一轮会报错。这与没开开关时一样。
- 推断，未核实：开关打开前在同一个长期运行的 app-server 里已被路由改写过的会话（`previously_routed` 为 true），若不重开就换成新地址继续，可能仍被改写到工作区后端。这属于「改完设置正在运行的会话要重开」（27 号工单）的范围。

## 10 接口模型并进 ChatGPT 登录的 /model

### 对照 magpie（7597c132）的结论

| 项 | magpie | Osuna |
| --- | --- | --- |
| 模型清单 | `codex_backend.go` `codexModels`：带 Codex 的请求头（去掉 `Accept-Encoding`）问 ChatGPT 的 `/models`，等 3 秒（`codexModelsWait`）；2xx 用它的清单；401、403 原样回；别的失败、超时用 `codexcat.CacheEntries`（`$CODEX_HOME/models_cache.json` 去掉 magpie 加的） | 同（`gateway/chatgpt-models.ts`）。缓存去掉的是带 `+osuna-` 标记的清单里的斜杠名字（同 `MagpieAdded` 的第二条；Osuna 的条目没有 ` via magpie` 那样的说明可认） |
| 接口模型条目 | `codexcat.Entries(ms, len(own)+100)`，priority 接在后面 | 同：`codexEndpointEntries`（07 号的 `codexModelEntry`，visibility `list`），priority = ChatGPT 条数 + 100 + 序号；顺序同聊天模型选择器（`endpointModelGroups`），与 09 号 `magpieConnectPick` 的候选一致 |
| ETag | `WithTag(backend ETag, CodexListTag())`，回复的 `X-Models-Etag` 同样加（`modelsEtag`） | 同，标记是 `+osuna-<sha256 前 12 位>`，算的是接口模型条目加 Codex 的默认模型（`codexChatGptListing`）。`X-Models-Etag` 不加的话 Codex 每轮都会因为和缓存的 ETag 不同而重拉清单 |
| ChatGPT 清单里的自带模型 | 按用户在 magpie 里挑的、隐藏的、禁用的筛，可盖 V1 标记、auto-review | 原样：Osuna 没有这些设置 |
| 对话请求 | 斜杠名字走 `serveAgent`；光秃秃的修补条目 id 后转 ChatGPT | 斜杠名字走 `handleAgentRequest`（选路、换家、冷却同 `/v1/responses`）；光秃秃的、没有模型名的、请求体解不开的，把原样的字节转给 ChatGPT（08 号「原样」不变） |
| 发给接口的头 | `codexClientHeader`：User-Agent、originator、session-id、thread-id，加 `codexHeader`（`x-openai-*`、`x-codex-*`、version 等，去掉 authorization 类、`x-oai-attestation`、luna-reserve、turn-state） | 同一份名单（`codexIdentityHeaders`），另留 Content-Type 与 Accept（直通照原样带格式头）。翻译过去的请求本来就只带 Osuna 自己写的头 |
| `/responses/compact` | 斜杠名字回 400「use a compaction_trigger on /responses」 | 同，文案照 magpie |
| `/responses` 里的 `compaction_trigger` | `codexInputAs`：接口模型的 trigger 换成 Codex 的摘要提示（`codexCompactPrompt`），`tools: []`、`tool_choice: "auto"`、`parallel_tool_calls: false`，请求头与 `client_metadata` 里的轮次元数据 `compaction.implementation` 改成 `responses`（`localCompactionTurn`）；`codexCompact` 交给自己的 `serve`、整份读回（`compactReply`），失败照原样回，读不出或没写摘要回 502，有摘要就以 `compaction` 条目（`magpie1:` + base64）的流交回；之后的请求里这种条目换成带 `codexSummaryPrefix` 的用户消息（接口模型与 ChatGPT 自带模型都换） | 同（`gateway/codex-compaction.ts`），标记是 `osuna1:`。摘要请求交给中转站自己的 `/v1/responses`（同一个本机端口，`askOwnGateway`），照常选路、换家、冷却，相当于 magpie 的 `serve` + recorder。ChatGPT 自带模型的请求只在带着 Osuna 的条目时才改（解开后的 JSON，去掉 Content-Encoding），否则照旧逐字节原样 |
| `/alpha/search` | 斜杠名字由 magpie 代搜（`alphaSearchHere`），做不到时 200 加说明 | 200，`output` 只有一句「这个模型不能联网搜索」（decisions.md Q9，Osuna 没有代搜） |
| 缓存标过期 | `codexStaleCache`：缓存的 ETag 不带现在的标记、`fetched_at` 不是 1970 时改成 1970，其余照留；Join 与每次 Sync 都调 | 同（`codex-models-cache.ts`）。调用点：每次落下设置变更（含打开开关、默认模型、已选模型）、模型资料或下线模型重写目录后、登录方式变了重写接法后、daemon 启动对账后。只在 Codex 开着且接管记录是 ChatGPT 接法时；路径是正被改写的 `config.toml` 所在的 CODEX_HOME；没有缓存不新建 |

### 要判断的地方

- 标记里多算了 Codex 的默认模型：工单要求默认模型变了也标过期，清单本身不随它变，多一次重拉。
- 等 ChatGPT 清单的 3 秒在 e2e 里用 `gatewayChatGptModelsWaitMs` 缩成 300 毫秒，常量 `CHATGPT_MODELS_WAIT_MS` 是 3000。
- 走这几条要先看模型名的路径（`/responses`、`/responses/compact`、`/alpha/search`）时，ChatGPT 自带模型的请求体也先整个读出来再转（上限同中转站 64 MB，超了回 413）；magpie 同样先读。
- 压缩的补救照 magpie 做了（用户 2026-10-18 决定，`gateway/codex-compaction-fallback.ts`、`codex-compaction-answer.ts`）：摘要请求被 404、条目找不到的 400、中转站的「Upstream request failed」（4xx，不含 401、403、429）、「response protection is unavailable」（含开口后以它断掉的流）拒绝时，以纯文字的对话再问一次（`plainCompact`：去掉 `previous_response_id`，对话最多 40 万字、去掉最早的）；再失败就本地拼「摘要」（`localSummary`：用户的话最多 8 万字、最近的，加最后一次回复），压缩照样完成（magpie #866、#1008、#1270）。同一段对话（`prompt_cache_key`）在同一个模型上连续失败 3 次、每次间隔不到 5 分钟，之后直接回 400 说明、不问模型，到最后一次失败满 5 分钟为止；401、403 不算，有摘要就清零（`CompactionFailures`，magpie `compactFails` #2274），只记在内存里。
- 压缩仍比 magpie 少做的：服务商设成原生压缩时保留 trigger（`NativeCompaction`，#1099，Osuna 没有这个设置）；ChatGPT 自带模型请求里去掉推理条目（与压缩无关）。

## 11 CC Switch 的 OpenAI 镜像服务商

### 对照 magpie（7597c132）的结论

| 项 | magpie（`internal/agent/codex.go`） | Osuna（`codex-config-patch.ts`） |
| --- | --- | --- |
| 怎么认镜像表 | `isCCSwitchMirror`：id 不是 `openai`、不是 magpie 的；`name = "OpenAI"`、`requires_openai_auth = true`；`base_url` 没有或为空，或是 magpie 的 ChatGPT 后端地址且在 `codex.mirrors` 记录里（failover 那条 Osuna 没有） | 同；id 不是 `openai`、不是 `osuna_api_endpoint`，「在记录里」= 接管记录 `mirrors.<id>.written` 与表里的地址相同（端口变了也认得出，跟着改成新地址）。09 号认用户自己的 `model_provider` 用的是同一个判断 |
| profile 点名的镜像 | `profileNamed`：任何 `[profiles.*]` 的 `model_provider` 点名的表不动 | 同 |
| 只认哪种写法的表 | `edit.TOMLTables` / `parseTOMLFile`（`internal/edit/toml.go`）只列 `[…]` 表头，内联表、点号键写的服务商不在其中 | 同：只认 `[model_providers.<id>]` 表头写的表（`findOwnTable`） |
| 什么时候接 | `takeMirrors` 只在 `viaBase()`（经 `openai_base_url` 接着）时 | 只在 ChatGPT 接法；API key、未登录不动 |
| 写什么 | 表里 `base_url = <magpie 的 ChatGPT 后端>` | `base_url` = 写进 `openai_base_url` 的同一个中转站 ChatGPT 后端地址；表里有空的 `base_url` 就原地换值，没有就插在表的最后一个键后面 |
| 记录 | `stash` 的 `codex.mirrors`：只记 id，只增不减 | 接管记录 `mirrors.<id> = { original, written }`：照 ADR 0004 记原写法（没有，或 `""`），比 magpie 多记。同样只增不减：记过的表地址还是 Osuna 写的就一直记着，之后被 profile 点名、改了名也不去掉（这种表不再改写，端口变了也留在旧地址），关开关照样拿掉；地址已不是 Osuna 写的才去掉 |
| 撤出 | `giveMirrors`：地址还是 magpie 的才删 `base_url`；被改过的照现在的样子留着 | 同；原来写着 `base_url = ""` 的放回 `""`。切回官方、换成服务商接法（登录方式变了）都走这条 |
| 被外部改了 | 不查（`Check` 不看镜像表），下次 `takeMirrors` 也不再认它 | 地址不是上次写的（含整张表被删）就算 `model_providers.<id>.base_url` 被改，进提示区「不再经过中转站」（工单要求，比 magpie 多做）；「重新应用」时地址不是 Osuna 写的就从记录里去掉、不再接，提示随之消失 |

### 不在本张范围

- magpie 同一处的 `takeTables`（CC Switch 的普通中转表也指向 magpie）、`putThreadTables`（给对话点名但已不存在的服务商补表）、多号 failover 写镜像（`codex.mirror_failover`）：工单只要镜像表。
- 「保留当前设置」会忘掉接管记录，镜像表照被指着中转站的样子留下（ADR 0012 的「保留」）；之后再打开开关，这张表的地址不在记录里、不像镜像，不再接（magpie 同样只认记录里的）。

## 12 会话历史列出所有 Codex 服务商的对话

### 做法

- 内置 Codex 列提供方会话时 `thread/list` 带 `modelProviders: []`（全部服务商）；`extends: "codex"` 的自定义提供方照旧只要自己那一个。每条带 Codex 回的 `modelProvider`，经 `ImportableProviderSession.codexModelProvider` 进协议的可选字段 `RecentProviderSessionDescriptorPayload.codexModelProvider`。旧客户端忽略这个键；旧 daemon 不发，界面就不显示，不用能力位。
- 自定义 Codex 提供方开的对话现在内置 Codex 也列得出（同一 thread id）。daemon 合并时只对 Codex 去重：派生自 Codex 的提供方列出的、带 Codex 服务商的对话，内置 Codex 那条去掉（`AgentManager.dropStockCodexRowsCustomCodexOwns`）：自定义提供方带着自己的设置续；用内置 Codex 的 `codex resume` 续会因为 config.toml 里没有这个服务商的表而失败。自定义 Claude 提供方（如没设自己 `CLAUDE_CONFIG_DIR` 的 Z.AI）与内置 Claude 列出同一条时两条照旧都留。
- 会话历史的行在第二行显示「Codex 服务商」字样加服务商 id（id 用正文色，字样用次要色），排在目录前。第二行伸到时间下面，Explorer 默认宽度下英文「Codex model provider osuna_api_endpoint」也放得下；窄了先截目录，再截字样，id 最后。原生端同样显示，不靠悬停。

### 一次性核实（2026-10-18，codex-cli 0.163.0）

在 `/tmp` 下的临时目录里，`env -i HOME=<临时> CODEX_HOME=<临时>/codex-home`，未登录、没有 API key，不碰 `~/.codex`。在 `sessions/2026/10/18/` 放两份手写的 rollout（`session_meta.model_provider` 分别是 `openai`、`osuna_api_endpoint`，各带一条用户消息），起真的 `codex app-server`，按 Osuna 的参数发 `thread/list`：

| 参数 | 列出 |
| --- | --- |
| 不传 `modelProviders` | 只有 `openai` 那条 |
| `modelProviders: []` | 两条，各带自己的 `modelProvider` |
| `modelProviders: ["osuna_api_endpoint"]` | 只有中转站那条 |
| `modelProviders: []` 加 `cwd` | 两条 |

与 `codex-wiring.md` 第 1 题的源码结论一致；不需要登录。用完删掉了临时目录。挪对话相关的两项核实（挪过的能续、状态库重建后会不会改回）归工单 13。

### 测试

- daemon 端到端：`codex-history-all-model-providers.e2e.test.ts`，假 Codex 照上表的规则过滤夹具里两个服务商的对话；Osuna 不传空数组时这条用例失败（已验证）。
- app 浏览器：`session-history-codex-model-provider.spec.ts`，夹具 `e2e/fixtures/session-history-codex.mjs`。
- 截图：`screenshots/12-session-history_two-codex-model-providers_{desktop-1280,compact-390}_{en,zh}.png`，无头 Chromium、假 Codex、临时 daemon 目录。

## 13 把一段 Codex 对话挪到另一个 Codex 服务商

### 对照 magpie（7597c132）的结论

| 项 | magpie（`internal/sessions/codex_provider.go`） | Osuna（`codex-conversations/move-to-model-provider.ts`） |
| --- | --- | --- |
| 找文件 | `codexFilesIn`：`sessions/`、`archived_sessions/` 下按 `rolloutName` 认，加 `rolloutTwin`（压缩的孪生文件） | 同；按路径排序后逐个改（中途失败的顺序因此确定） |
| 一分钟内写过 | 任一文件 `recent` 就整段拒绝（`ErrActive`），什么都不写 | 同，结果 `skipped` 的 `reason: "active"` |
| 备份 | `<magpie 目录>/trash/codex-provider/<时间>-<id>/files/<序号>-<文件名>` + `move.json`（id、from、to、at、items） | `$PASEO_HOME/codex-model-provider-moves/<UTC 时间>-<id>/`，同样的布局与字段；目录 0700、`move.json` 0600（对话内容是私人的） |
| 改哪一行 | 前 1024 字节含 `"type":"session_meta"`、顶层 type 是 session_meta、`payload.model_provider` 是字符串且不等于目标 | 同；用按字节走的小扫描器找到值的字节范围原地换掉，不重新序列化 |
| 写回 | 旁边的临时文件、`Sync`、保留修改时间、改名替换；压缩的照样 zstd 压回 | 同；Node 自带的 `zlib.createZstdCompress/Decompress`，按行流式处理 |
| 中途失败 | 已改的文件用备份 `keptCopy` 改回 | 同 |
| 状态库 | 每个 `state_*.sqlite`：有 `threads` 表（id、model_provider 两列）才 `UPDATE`；失败报「文件挪了、库没改」 | 同（`process.getBuiltinModule("node:sqlite")`，`busy_timeout = 5000`）；目录照 magpie：`CODEX_SQLITE_HOME`，其次 config.toml 的 `sqlite_home`，缺省 CODEX_HOME |
| 设置快照 | `thread_settings_applied` 里的旧服务商不改（已知局限） | 同 |
| 入口 | GUI `POST /api/sessions/codex-provider`，一次多条 | 新 RPC `provider.codex.session.move_model_provider`（一组 thread id + 目标），另有 `provider.codex.session.list_model_providers` 给对话框列目标；本张界面只挪一条，多选归 14 号 |

### 要判断的地方

- **在哪个 Codex 目录里挪**（审查后改）：会话历史列出这一行的那个提供方的 CODEX_HOME（`AgentClient.codexLocation`，Codex 提供方设置里的环境变量优先，缺省 `~/.codex`；派生自 Codex 的自定义提供方用它自己的环境），请求带 `providerId`。对话文件、状态库与列目标读的 config.toml 都在这里，相当于 magpie 的 `codexHomeOf(文件)`。与第三方接口改写的那份 config.toml 不是一处时，e2e 有用例。
- **目标列表**：内置 `openai`、`osuna_api_endpoint`（名字写 Osuna；这个 CODEX_HOME 的 config.toml 里没有这张表时照样列出但不能选，`unavailableReason: "no_table"`，下拉里写明续不上、排在最后）、config.toml 里每张 `[model_providers.<id>]`（有 `name` 就带上）。对话现在的服务商不在下拉里。目标 id 只按 magpie 的 `codexProviderRe` 校验，不要求在列表里。
- **能力位**：沿用还没发布的 `apiEndpointCliWiring`（v0.17.0），只改了注释；daemon 没有第三方接口服务时两个 RPC 回 `rpc_error`（`codex_conversations_unavailable`），也不声明这个能力位。
- **修改时间**：Node 的 `utimes` 只到微秒级，Codex 的文件是纳秒级，所以「修改时间不变」是毫秒以内相同（e2e 按 1 毫秒以内比）；magpie 的 Go 能保留到纳秒。
- **压缩文件挪回去**：解开后的内容与原来逐字节相同；压缩后的字节取决于压缩器（Codex app 自己压的与 Node 压的会不同），e2e 比的是解开后的内容，未压缩的文件比的是原字节。
- **失败的两种**（审查后改，ADR 0011 同步）：改对话文件时失败 → 已改的文件用备份改回，结果 `failed`；文件都改完、某个状态库 `UPDATE` 失败 → 文件留在新服务商（照 magpie），结果 `state_database_failed`，界面标题写「已挪动，但状态库没有更新」。两种都带 `backupPath`（备份那一步之前失败的没有）。读不懂的 config.toml 当作空的、查不了 `pragma_table_info` 的库当作没有 threads 表跳过，都照 magpie。
- **比 magpie 多做的**：开始改之前先确认 Node 有 `node:sqlite`（有状态库时）和 zstd（有压缩文件时），没有就整段不动、报原因，避免文件挪了库没改。
- 同一时间只挪一段对话（模块内的队列，相当于 magpie 的 `mu`）。
- 对话框归 `session-history/view.tsx`：`AdaptiveModalSheet` 会把 jsdom 单元测试解析不了的模块带进 `index.tsx`。

### 一次性核实（2026-10-18，codex-cli 0.163.0）

在 `/tmp` 下新建的临时目录里，`env -i HOME=<临时> CODEX_HOME=<临时>/codex-home PATH=/usr/bin:/bin`，未登录、没有 API key，不碰 `~/.codex`。config.toml 里只有一张 `[model_providers.cc]`（`base_url = "http://127.0.0.1:9/v1"`）。手写一份 rollout（`session_meta.model_provider = "openai"`，一条用户消息），起真的 `codex app-server` 按行发 JSON-RPC；挪动用 Osuna 的 `moveCodexConversation`。用完删掉了临时目录。

| 步骤 | 结果 |
| --- | --- |
| 第一次 `thread/list`（`modelProviders: []`） | 列出，`modelProvider: "openai"`；Codex 顺手建了 `state_5.sqlite`（WAL 模式），`threads` 行记 `openai` |
| `thread/resume`（服务商 openai） | 成功；rollout 末尾多了一条 `event_msg` / `thread_settings_applied`，`thread_settings.model_provider_id = "openai"`。另外它向 `wss://api.openai.com/v1/responses` 预连了一次，没带凭据，收到 401（只记日志） |
| 挪到 `cc` | `session_meta` 只有服务商变了，`state_5.sqlite` 的行变成 `cc`；设置快照仍是 `openai` |
| `thread/list` 带 `["cc"]` / `["openai"]` / 不带 | 只在 `cc` 下列出（`modelProvider: "cc"`），另两种为空 |
| 删掉 `state_5.sqlite*` 让 Codex 重建，再列 | 列表仍在 `cc` 下、`modelProvider: "cc"`（列表看的是 `session_meta`），但重建后的库记的是 `openai`（被设置快照盖回去了） |
| 这时 `thread/resume` | `thread.modelProvider` 是 `cc`，但续上用的 `modelProvider` 是 **openai**（恢复按状态库取），并又写了一条 `openai` 的快照：**挪动被改回** |
| 换个顺序：挪到 `cc` 后先 `thread/resume` 一次 | 续上用 `cc`（没有报 not found，配置按 cc 加载成功），写了一条 `model_provider_id = "cc"` 的快照；之后再删库重建，库里记 `cc`：挪动保住了 |

结论：Codex 从对话文件重建状态库时，按最后一条设置快照取服务商，所以**挪完还没续过的对话会被改回**；挪完续一次（新快照写的是新服务商）就不会。对话框里照此写明（`panels.sessionHistory.move.rebuildNote`），留给 30 号工单补进 ADR 0011 的 Consequences。

没核实的：挪完后真的发一轮对话（要模型请求与登录，按禁令不做）；`codex resume` 终端选择器里的表现（TUI 不便脚本化，app-server 的 `thread/list` 与它用同一套过滤，见 `codex-wiring.md` 第 1 题）。

### 测试

- daemon 端到端：`codex-model-provider-move.e2e.test.ts`（POSIX）——挪动只改服务商、修改时间不变、状态库已改、备份与 `move.json` 在；挪回逐字节相同；一分钟内写过的被跳过；第二个文件所在目录不可写时第一个被改回；列目标。去掉改回或状态库那一步时对应用例失败（已验证）。
- 协议：`messages.codex-session.test.ts`。
- app 浏览器：`session-history-codex-model-provider.spec.ts` 加挪动成功、一分钟内写过两种；假 Codex 有 `path` 时按对话文件第一行报服务商。
- 浏览器另有（审查后加）：Claude 的行没有这一项（假 Claude 只答 `--version`，会话从临时 CLAUDE_CONFIG_DIR 读）；挪动失败时错误连同备份目录留在框里，再按「挪动」重试成功。jsdom 单元测试打不开行菜单（菜单组件在 jsdom 里渲染不出），所以放在浏览器测试里。
- 截图：`screenshots/13-session-history_{row-menu-open,claude-row-menu-open}_desktop-1280_{en,zh}.png`、`13-move-dialog_{target-list-open,target-chosen}_{desktop-1280,compact-390}_{en,zh}.png`，无头 Chromium、假 Codex 与假 Claude、临时 CODEX_HOME 与 CLAUDE_CONFIG_DIR。
- 行菜单宽度：英文「Move to another Codex model provider…」实测文字 261pt、菜单项 302pt，280 宽时被截断，所以留 320；菜单往下让 12pt，不压住两行的行。

## 14 多选批量挪；续不上时报错里给挪动按钮

### 做法

- **续不上的原因码**：Codex 的 `thread/resume` 报 ``Model provider `<id>` not found``（app-server 前面加 `failed to load configuration: `）时，`ensureThreadLoaded` 抛 `CodexModelProviderMissingError`（`codex-conversations/model-provider-missing.ts`，带服务商 id，原文照旧）。导入失败的 `agent_create_failed` 带 `errorCode: "codex_model_provider_missing"`（协议常量 `CODEX_MODEL_PROVIDER_MISSING_ERROR_CODE`，`errorCode` 本来就是可选字符串，协议不变）。客户端 `importAgent` 改抛 `AgentImportError`（`message` 不变，多一个 `code`）。app 只看这个码，不匹配英文。
- **只覆盖会话历史的「导入」**：会话历史里能续对话的只有两条路：点行在终端里跑 `codex resume`（错误在终端里，界面接不到）与「导入为 Osuna Agent」（走 app-server 的 `thread/resume`）。报错和按钮放在后者的导入错误里；已有 Agent 在 Agent 页续不上的情况没有做（那里没有挪动对话框）。
- **导入错误**：有这个码且这一行是 Codex 行时，标题照旧，正文换成界面语言的说明（带服务商 id），下面一个 outline 按钮「挪到另一个 Codex 服务商…」打开同一个对话框。挪好、列表重列后这一行的服务商变了，错误自动收起；再导入成功。
- **多选**：工具栏多一个「选择」图标（只在主机有 `apiEndpointCliWiring` 时出现）。进入后工具栏换成「已选 N 条 / 取消 / 挪动…」；行首的提供方图标换成圆形选择环，选中时 accent 填充加勾，行用 `surfaceSidebarSelected` 加 1px 内描边（docs/design.md 行状态），点行切换选中，kebab 藏起。只有 Codex 行能选；一次挪动在一个提供方的 CODEX_HOME 里进行，所以选了一行后别的提供方的行变灰不能选。选中的 key 放在 `view.tsx`（受控），挪好后由它退出选择模式。
- **批量对话框**：同一个 `MoveCodexConversationSheet`，参数改成一组对话（`threads`）。标题下写「N 段对话」；目标列表只在所有对话都在同一个服务商名下时去掉那一个；备份与重建说明用不点名服务商的版本。全部挪好：关掉并提示「已把 N 段对话挪到 X」。有没挪成的：框留着，逐条列出「已挪到 X」或「没有挪动：原因」（失败带备份目录，状态库失败用「已挪动，但 Codex 的状态库没有更新」），底部只剩「关闭」；已挪的那些立刻重列。请求本身失败（`payload.error` 或断线）时错误留在框里、可重试。只挪一条时行为同 13 号。

### 测试

- daemon 端到端：`codex-model-provider-move.e2e.test.ts` 新用例——假 Codex 的 app-server 按对话文件第一行的服务商加载配置，config.toml 里没有这张表就照真 Codex 报错；导入失败带 `AgentImportError.code === "codex_model_provider_missing"`，挪到 `cc` 后再导入成功。去掉 session.ts 的映射时用例失败（已验证）。
- app 浏览器：`session-history-codex-model-provider.spec.ts` 新增三条：多选三条（一条一分钟内写过）挪完两条成功一条跳过并说明；批量里一条目录不可写时原因与备份留在框里、文件不变；续不上时错误带说明与按钮，挪到 openai 后错误收起、再导入成功。假 Codex 夹具加了 `thread/resume`、`thread/read`。
- 截图（无头 Chromium、假 Codex、临时 CODEX_HOME）：`screenshots/14-session-history_selection-3-selected_{desktop-1280,compact-390}_{en,zh}.png`、`14-move-dialog_batch-results_desktop-1280_{en,zh}.png`、`14-session-history_resume-error_desktop-1280_{en,zh}.png`。

### 审查修正（14 号第一轮）

- **Agent 页也覆盖**（用户 10-18 决定）：`toAgentResumeWireError`（`server/agent-resume-errors.ts`，照 `toWorktreeWireError` 的样子，以 `unknown` 收尾）统一给导入、`resume_agent_request`、`refresh_agent_request` 三处出码：导入的 `agent_create_failed.errorCode` 现在总是带码（认不出时 `unknown`）；另两处 `rpc_error.code` 认出时是 `codex_model_provider_missing`，否则照旧 `agent_resume_failed` / `agent_refresh_failed`。客户端导出 `DaemonRpcError`。
- **app 里真正走的是 refresh**：app 不发 `resume_agent_request`（只有 CLI 用）；Agent 页上续一个已有 Agent 的入口是已归档 Agent 的「取消归档」（`refreshAgent`）。说明与「挪动对话…」按钮放在 `ArchivedAgentCallout`，对话框同一个（一段对话，Agent 的提供方与 thread id；daemon 只给码不给服务商 id，所以 `from` 为 null，说明用不点名的版本）。
- **取消归档失败放回归档**：原来 refresh 先取消归档、续不上也不放回，Agent 变成未归档却没有运行，提示组件卸载、错误丢失。现在照 `resume_agent_request` 的做法续不上就 `archiveSnapshot` 放回；提示组件仍会被卸载又挂上一次，错误放在按主机与 Agent 分键的 store 里。
- 没做：daemon 重启后打开一个未归档、续不上的 Agent，走的是 `fetch_agent_timeline` 的「Failed to load agent」页，那条路径的错误码要穿过时间线同步的几层状态，没有接。
- 文字：按钮缩成「挪动对话…」（全称在对话框标题）；导入错误标题改成「Codex 续不上这段对话」；未选中的选择环描边用 `foregroundMuted`；不可选的行用 `theme.opacity[50]`。
- 测试：daemon 端到端加「已有 Agent 续不上带码、取消归档失败仍是归档的、挪好后 refresh 与 resume 都成功」；浏览器加 Agent 页挪动成功与失败两条。截图 `screenshots/14-agent-page_resume-error_desktop-1280_{en,zh}.png`，其余 14-* 重拍。

### 14 · 用户决定与留待以后（2026-10-18，编排会话记）

- 用户选「也做 Agent 页」：已覆盖已归档 Agent「取消归档」续不上（`refreshAgent`），以及导入、`resume_agent_request`。
- 用户选「保留」：「取消归档」续不上时放回归档、报错留着（照 `resume_agent_request` 的做法）。
- 用户选「另开工单以后做」：daemon 重启后打开未归档、续不上的 Codex Agent 显示「Failed to load agent」页，没有说明与挪动按钮——错误码要穿过时间线同步的几层，本任务不做。

## 15 settings.json 带 BOM、带注释也照改

### 先核实的推断：Osuna 的 Claude 对话遇到读不了的设置文件会怎样

结论：**整份跳过、不弹窗、不报错，于是不经中转站直接走官方。**【源码核实】CC 2.1.302（`npm pack @anthropic-ai/claude-code-darwin-arm64@2.1.302` 放进空临时目录，只用 `strings` 读二进制，没有运行），SDK 0.3.246（仓库 `node_modules`）。

- Osuna 经 SDK 的 `query()` 起 Claude（`agent/providers/claude/agent.ts`，`settingSources: ["user","project","local"]`，`pathToClaudeCodeExecutable` 是本机的 claude）。SDK 拉起 CLI 时带 `--output-format stream-json --verbose --input-format stream-json`，标准输入输出都是管道，没有 `-p`（`sdk.mjs`）。
- CLI 判断非交互：`function yet(e){let n=lb("-p",e)||lb("--print",e),t=lb("--init-only",e),o=…"--sdk-url"…;return n||t||o||!process.stdout.isTTY}`。SDK 拉起的进程 stdout 不是 TTY，所以是非交互。
- 「Settings Error」对话框只在交互会话里弹：`if(To){let{errors:h}=Bm(),M=ert(h);if(M.length>0&&(!w7o()||!b.handleInvalidSettings))nrt(M);else if(…handleInvalidSettings)…}`，`To` 只在走 `runOnboarding`（Ink 界面）时赋值。非交互时 `nrt` 只写调试日志：``Invalid setting skipped without dialog (automated session): ${file}: ${path}: ${message}``。
- 读不了的文件整份跳过（第 11 题已核实：`ft` 解析失败返回 null，`{settings:null, errors:[…]}`）。用户设置不是 `startupFatal`（只有托管设置解析失败才是），所以会话照常启动。
- Osuna 自己不往 SDK 会话的环境里塞 `ANTHROPIC_BASE_URL`（`agent/providers/claude/` 里没有），中转站地址只在 settings.json 的 `env` 里。文件被跳过，会话就用官方地址和本机的 claude.ai 登录。
- 提示文字据此写：终端会弹设置错误，Osuna 里的 Claude 对话直接走官方；修好后要在终端重开、在 Osuna 新开对话（已经在跑的会话启动时没读到这份文件）。

### 做法

- **读写**（`claude-settings-patch.ts`）：开头的 BOM 读时摘下、写回时放回；用 `jsonc-parser` 的 `parse`（`allowTrailingComma`）读，语法错误照旧拒绝。`inspectClaudeSettings` 多给 `isReadableByClaudeCode`：照 Claude Code 的读法（去 BOM 后严格 `JSON.parse`）判断。
- **注释留在原行**：`jsonc-parser` 的 `modify` 往容器末尾加键时插在上一个值紧后面，上一行末尾的 `// 注释` 会被挤到新键那一行；删末尾的键时从上一个值紧后面删起，会把那条注释一起删掉。`editBesideComment` 认出这两种情况：加键时新键另起一行放在注释之后（上一个值本来带尾随逗号，新键也带；没有就在上一个值后补逗号），删键时只删那几行并对称地处理逗号，所以「打开再关掉」逐字节还原。其他情况照 `modify` 的做法。
- **提示区**：新 code `settings_has_comments`（params：file），只在 Claude Code 的开关开着、文件带注释或尾随逗号时给。这是对工单的理解：工单说的后果（Osuna 的 Claude 对话不经中转站、直接走官方）只在开关开着时成立；开关关着时 Osuna 不管这份文件。不进老的 `health`。app 里是 warning 提示，正文写后果，带 outline 的「如何修复」按钮，点开显示修复步骤（不发请求）；`AgentIssueView.hasFixSteps` 标出哪些情况带它，24、28 号工单可复用。
- **一个区块一次一条**：打开开关被拒（`config_unparsable`）时，提示区里同样内容的「读不懂」先收起，只留红色那条；关掉红色那条后提示区的再出现。提示与拒绝里的文件路径把主目录缩写成 `~`（`shortenPath`）。
- **读不懂时用界面语言说明**：`config_unparsable` 的 params 在 settings.json 上多给 `reason`（`syntax` 带 `line`、`column`；`root_not_object`；`key_not_object` / `key_not_array` 带 `key`）。请求被拒的 `ApiEndpointError` 加了可选 `params`（同样的参数），app 打开开关、启用接口、提示区按钮失败时都按它翻译（`config-unparsable-copy.ts`）；没有 reason（Codex 的 config.toml、老主机）照旧显示文件与解析器原文。

### 测试

- 纯逻辑（`claude-settings-patch.test.ts`）：BOM 保留与还原；行注释、块注释、尾随逗号照收且报 Claude Code 读不了；紧挨负责的键的注释（值替换、末尾加键、末尾删键）逐字保留并能还原；改在注释旁的负责的键照样算被改；JSONC 也读不懂时给出行列。
- daemon 端到端（`api-endpoint-claude.e2e.test.ts`）：带 BOM 打开、BOM 在、关掉逐字节还原；带注释、尾随逗号打开后整份文本逐字比对，关掉还原；列表在开着且带注释时返回 `settings_has_comments`，删掉注释后消失，开关关着时不报；JSONC 也读不懂时拒绝并带 `reason`、行列。
- 浏览器（`settings-api-endpoints.spec.ts`）：带注释的文件照改、提示写后果、「如何修复」开合、删掉注释后提示消失；读不懂的文件在提示区和打开开关被拒时都用界面语言说明行列。
- 截图（无头 Chromium、临时 CLAUDE_CONFIG_DIR）：`screenshots/15-claude-code-page_settings-has-comments_desktop-1280_{en,zh}.png`、`15-claude-code-page_settings-has-comments-fix-open_desktop-1280_{en,zh}.png`、`15-claude-code-page_switch-refused-unparsable_desktop-1280_{en,zh}.png`。

## 16 云平台开关与管理员设置

### 对照 magpie（7597c132）

| 做什么 | magpie | Osuna |
| --- | --- | --- |
| 开关名单与云的叫法 | `agentenv.ClaudeProviders`、`claudeClouds` | 一样（`claude-cloud-switches.ts`） |
| 什么算开着 | `claudeSwitchOn`：1/true/yes/on，不分大小写、去空白 | 一样；JSON 的 true、数字 1 按字符串比（magpie 的 `GetJSON` 同样把它们读成 "true"/"1"） |
| 接管时拿掉 | `dropClouds`：settings.json 里开着的原样记进 stash 后删掉；每次写接入与 Sync 都做 | 每次 `applyClaudeApiEndpoint`（打开、重新应用、模型等变化引起的重写）都做；原值记进接管记录的 `clouds`，已有的保留、这次新拿掉的覆盖同名项（magpie 的 stash 也是覆盖） |
| 关掉时放回 | `putClouds`：settings.json 里已经有这个变量（不论开关）就不放 | 一样；放回的键排在 env 末尾（magpie 的 `SetJSON` 也是追加），所以不是逐字节还原 |
| 关着的开关、云的其他变量 | 不动 | 一样 |
| 写在哪 | `claudeCloud`：每个开关依次看托管设置、用户 settings.json、`~/.claude.json`（`CLAUDE_CONFIG_DIR` 时是它下面的），最先有这个变量的说了算；都没有才看登录 shell | 一样。几处同时开着时一次只报一条：按名单顺序找到的第一个（magpie 的 `claudeCloud` 也只返回一条），用户去掉它后下一次读状态再报下一个 |
| 托管设置的文件 | 只读 `managed-settings.json`；Windows 用 `C:\ProgramData\ClaudeCode` | 另读 `managed-settings.d/*.json`（按 Claude Code 文档：先主文件，再按字母序、跳过点开头与非 .json，env 逐键合并、后者盖前者，所以取最后一份有这个变量的）；Windows 用 `C:\Program Files\ClaudeCode`（decisions.md Q4）。MDM plist、注册表、服务器下发的不读，同 magpie |
| 托管的 `ANTHROPIC_BASE_URL` | `Check`：非空、不是网关、也不 `reachesMagpie` 时报；`reachesMagpie` 用 `proxyBase` 认出可能是代理的地址（另一台机器或域名，或本机回环上带自己路径的），问它的根路径是否答 `{"name":"magpie"}`，答案记 20 秒，没问过时先当作通到 | 非空、去掉末尾 `/` 后不等于中转站地址、也问不到中转站时报 `managed_base_url`（`gateway-reach.ts`）。中转站新增根路径的自我介绍 `GET <中转站>/` → `{"name":"osuna"}`。`proxyBase` 按 Osuna 的中转站带路径改了一处：magpie 从地址末尾切掉网关的路径再问根；Osuna 的中转站在 `/api-endpoint-gateway` 下，代理把自己的地址整个转到中转站，所以直接问这个地址的根，本机回环上路径正是 `/api-endpoint-gateway` 的算换了端口的中转站自己、不当代理。问法用等着问的 `probedNow`（列表本来就是异步的，答案确定、测试不用轮询），不是 Drift 那种后台问、没问过当作通到 |
| 登录 shell 的环境 | `claudeShellEnv` → `proc.LoginEnv`：起登录 shell（`-ilc`，答不上再 `-lc`）在标记之间打印变量，一分钟缓存；没答出的用 magpie 自己的环境；Windows 不问 | 一样（`login-shell-env.ts`）：只问云平台开关这几个变量，shell 带 `PASEO_SHELL_PROBE=1`、起在自己的会话里，5 秒超时；没答出的看 daemon 自己的环境。fish、nushell 也照 magpie（`termShells` / `FindShell` / `mergeShellEnv`，用户 2026-10-18 决定）：装了（常见安装目录、`/etc/shells`、PATH）且配置目录在（`$XDG_CONFIG_HOME` 或 `~/.config` 下的 fish、nushell，nushell 另看 `~/Library/Application Support/nushell`）的与登录 shell 同时问，每个变量取第一个答出的，登录 shell 在前；登录 shell 本身是它时不重复问 |
| 读设置文件 | `edit.GetJSON` | 照 Claude Code 的读法：去 BOM 后严格 `JSON.parse`；不存在、读不了、读不懂都按没写 |

### 线上形状

- `agentIssues` 新增两种 code，都只在 Claude Code 开关开着时给（关着时中转站不在用）：
  - `cloud_switch_on`：params `source`（`managed` / `settings` / `global_config` / `shell`）、`key`、`cloud`，有文件时带 `file`。
  - `managed_base_url`：params `file`、`url`。
- 都不进老的 `health`。
- shell 来源另带 `platform`（daemon 的 `process.platform`）：修复步骤在 Windows 上讲系统与账户的环境变量，其余系统讲 shell 配置文件。
- app 里两者同属「不再经过中转站」（ADR 0012 的情况表已写明）。写在 Osuna 改不了的地方（托管设置、`~/.claude.json`、shell、托管地址）时没有「重新应用」，只给「切回官方」「保留当前设置」和带步骤的「如何修复」；写回 settings.json 的照「不再经过中转站」给三个按钮、不给修复步骤（重新应用就会再拿掉它）。
- 「如何修复」与处理按钮现在同一排，展开的步骤占满下面一整行（15 号的写法在有按钮时把步骤挤在左半边）；箭头收着朝下、展开后朝上。文件路径都经 `shortenPath`。

### 可替换的入口

- 托管设置目录：服务选项 `claudeManagedSettingsDir`；缺省先看环境里的 `PASEO_CLAUDE_MANAGED_SETTINGS_DIR`，再按系统。进程内测试 daemon（`paseo-daemon.ts`）一律给临时目录，放在用例自己的 `apiEndpoints` 之前，传了 `env` 的用例也不会读到系统目录。
- 登录 shell：服务选项 `readLoginShellEnv`；进程内测试 daemon 缺省换成「什么都没设」的假读取器。代理探测：服务选项 `probeGatewayAt`。
- app e2e 的 daemon 是真进程：`withUpgradeSeal` 给所有 e2e daemon 设 `PASEO_CLAUDE_MANAGED_SETTINGS_DIR`（缺省一个不存在的临时路径），并去掉从终端带来的 `CLAUDE_CODE_USE_*`；封条把带 `PASEO_SHELL_PROBE=1` 的进程换成立刻失败的，所以不会起开发者的登录 shell。
- `~/.claude.json` 跟着服务的 `env.CLAUDE_CONFIG_DIR` 与 `homeDir`。

### 测试

- 纯逻辑：`claude-settings-patch.test.ts`（拿掉开着的、留下关着的与其他云变量；yes/on/TRUE 算开、空串算关；放回；用户又设了的不覆盖；重新应用时又开的再拿掉、原值都能放回；旧记录没有 `clouds` 时什么都不放）；`claude-cloud-switches.test.ts`（各来源、优先顺序、关着的盖过下层开着的、drop-in 取最后一份、托管地址、drop-in 文件顺序）。
- daemon 端到端（`api-endpoint-claude.e2e.test.ts`）：工单的端到端验收（BEDROCK=1 拿掉、VERTEX=0 不动、关掉放回、中途用户自己写了的不覆盖）；settings.json 又写回开关时报出、重新应用拿掉；托管 drop-in、`.claude.json`、shell 各一条提示写明来源；托管地址不指向中转站时提示、改成中转站地址后消失。全部用临时目录与假环境。
- `login-shell-env.test.ts`：假 shell（临时目录里的脚本，不读任何配置）答出变量、一分钟内不再问、Windows 不问、起不来时答空；假 fish 与登录 shell 一起问、登录 shell 的值在前；`terminalShells` 按装没装、配置目录在不在、`XDG_CONFIG_HOME`、登录 shell 本身挑出 fish 与 nushell（找 shell 一律换成假的）；解析标记、没展开的引用、nushell 的问法。`gateway-reach.test.ts`：哪些地址算可能的代理、答案记 20 秒。daemon 端到端另加：登录 shell 的值先于 daemon 环境；托管地址是转到中转站的假代理时不报，同一代理换成不通到中转站的路径时报。
- 浏览器（`settings-api-endpoints.spec.ts`）：托管设置里的开关在设置页写明来源与改法，没有「重新应用」，「如何修复」展开步骤，管理员删掉后提示消失。
- 截图：`screenshots/16-claude-code-page_cloud-switch-in-managed-settings-fix-open_desktop-1280_{en,zh}.png`（截图里的托管文件路径是临时目录）。

## 17 Claude Code 的四个修正

### 对照 magpie（7597c132）

| 做什么 | magpie | Osuna |
| --- | --- | --- |
| 带点的 Claude 版本 | `ClaudeSpelled`（`internal/provider/claudedash.go`）：opus/sonnet/haiku/fable/mythos 的点版本换连字符，连字符写法本身在售、或两个在售 id 换完一样时不改；拆出 `:档位` 与 `[1m]` | 一样（`claude-spelling.ts`）。在售 = 开着的接口已选模型的光秃秃 id 加 `标识/模型名`（去掉已下线的）。写进 `model` 与 Osuna 写的 `modelPicker`；后台小任务与 Subagent 模型由 22 号工单调同一个函数。magpie 还改四个档位变量，Osuna 接管时本来就拿掉它们 |
| 读回 | `ClaudeRead` 把连字符写法认回在售 id | 不需要单独做：中转站的 `sameModel` 已把连字符写法认回这家自己的写法（第 4 步）；接管记录里记的就是写进去的连字符写法，比对不会误报 |
| 到 max 无 xhigh 也报 xhigh | `claudeCapabilities`（d1c485f7） | 一样（`claude-model-hints.ts`）；名字是 Claude 的模型本来就整个不报，不变 |
| 什么算会被审查 | `AutoModeReviewed`：Claude 订阅账号、名字匹配 `(?:^\|[/.:-])claude-`、Anthropic 地址的主机是 `api.anthropic.com` | 后两条一样（`host-endpoints.ts` 的 `isAutoModeReviewed`）；Osuna 没有 Claude 订阅账号这种接口 |
| 能到的模型 | `claudeReviewed`：Claude Code 列表里的条目（含路由组成员、provider 兜底）与当前模型 | 开着、选了模型的接口：已选模型与档位映射到的模型（Osuna 没有路由组与兜底；第 4 项的兜底是默认模型，已在已选模型里）。没选模型的接口不算，即使地址是 `api.anthropic.com` |
| 写与拿掉 | `writeReview` / `dropReview`：用户写了的不碰，自己写的记在 stash；每次设模型与 Sync 重算；断开时删 | 同样的归属规则，记在接管记录的 `hintEnv` 里（规则与模型提示完全相同，没加新字段）；`cliFingerprint` 带上它，加一家 `api.anthropic.com` 的接口就重写；关掉开关时删掉自己写的 |
| 档位名兜底 | `claudeTierStandIn`：Claude 家族 id（`claudeFamily`）一律换成档位变量或主模型，在售的也换；主模型本身就是这个 id 时照常；光秃秃的档位名没人在售时经 `standIn` 走同样的 `claudeStandInAt`；只在 settings.json 指向 magpie 时 | 照 magpie（用户 2026-10-18 决定）：Claude Code 开关开着、调用方认作 Claude Code 时（认不出时按 Anthropic 路径算，所以 hook 脚本也接住），家族 id 先于按名字找，换成第一家映射了该档位的接口，没有映射换成存的默认模型；默认模型就是这个 id 时照常按名字找。光秃秃的档位名与对不上档位的 `claude-` id（如 `claude-mythos-5-1`）先按名字找，再按映射，最后默认模型（routing.ts 第 5、6 步，用户 2026-10-18 决定照 magpie）。差别：magpie 的 haiku 档另看 `ANTHROPIC_SMALL_FAST_MODEL`，Osuna 的后台模型由 22 号工单接上；magpie 的路由组 Osuna 没有；换成存的默认模型而不读 settings.json，因为 ADR 0012 里 CLI 选的模型会被收成默认模型 |

### 测试

- 纯逻辑：`claude-spelling.test.ts`（改写、保留前缀 `[1m]` `:high`、五个家族、别家 id 不改、连字符写法在售与两个撞车时不改）；`claude-model-hints.test.ts`（到 max 无 xhigh 报 xhigh）；`host-endpoints.test.ts`（各种 Claude 名字、`api.anthropic.com`、映射到的 Claude、关着的和没选模型的不算）；`claude-settings-patch.test.ts`（写 0、能审查时拿掉、用户写的 1 和 0 都不碰、还原逐字节）；`gateway/routing.test.ts`（档位名、内置 id 与对不上档位的 `claude-mythos-5-1` 按默认模型找、默认模型带标识时直达；选了内置 id 的接口也让给档位映射、没映射换默认模型、默认模型就是它时照常、开关关着时照常；开关关着、Codex、非档位名、带厂商前缀的不兜底）。
- daemon 端到端：`api-endpoint-claude.e2e.test.ts`（`claude-opus-4.6` 写成连字符、`glm-4.6` 不改、用户 modelPicker 里的点写法不改；`CLAUDE_CODE_AUTO_MODE_SERVER=0`，加 `api.anthropic.com` 接口后拿掉，关掉后逐字节还原；用户写的不动）；`api-endpoint-gateway.e2e.test.ts`（`haiku`、`claude-haiku-4-5-20251001` 与 `claude-mythos-5-1` 没映射时假上游收到默认模型 `glm-4.6`；一家选了 `claude-haiku-4-5-20251001`、另一家把 haiku 映射到 `glm-4.6` 时请求到映射那家）。原有用例里拿光秃秃的 Claude id 测别的事的两条（思考关闭的形状、Subagent 的搜索）改成带接口标识。原有用例里接口模型都不是 Claude 的，settings.json 多了 `CLAUDE_CODE_AUTO_MODE_SERVER`，已照改。

## 18 保留 claude.ai 登录

### 对照 magpie（7597c132）

| 做什么 | magpie | Osuna |
| --- | --- | --- |
| 选项 | Claude Code 的 `login` 字段：`""`（magpie 的 key）或 `claudeai`（`internal/agent/claude.go` 的 `loginKey`、`claudeSignIns`），存在 stash 里，断开后留着 | Claude Code 设置页「使用第三方接口」区的 Switch「保留 claude.ai 登录」，默认关；存在 `endpoints.json` 的 `agents.claude.keepsClaudeAiLogin`，总开关关着也能设、关着也留着。线上是 `set_agent_settings` 的可选 `keepsClaudeAiLogin`（与 `enabled` 一起发，app 发当前的 `enabled`），列表的 `agents.claude` 带回来；给 Codex 回 `invalid_input`。随 `apiEndpointCliWiring` 能力位显示 |
| 只在网关收任意 key 时提供 | `signInHere`：本机回环、WSL 镜像；共享到网络时只收共享 key，不提供 | Osuna 的中转站只在本机回环上收，恒可提供，不做这条判断 |
| 写配置 | `wiredKey`：开着写空 `ANTHROPIC_AUTH_TOKEN`，关掉写回 key | 一样：`cliWiring` 的 token 写空，仍是负责的键、按接管记录还原；`cliFingerprint` 带上选项，切换就重写。接管记录里写入值为空串也算指向中转站（`writtenGateway`），启动对账不会每次重写 |
| 没走 magpie 时设 | 拒绝（「先选一个经 magpie 的模型」） | 照存，下次打开总开关时生效（工单写「默认关」、未要求拒绝；关着时改它不碰文件）。比 magpie 宽：没有误导模型的风险 |
| 认调用方 | 本机请求一律收 | 02 号已做：claude.ai 令牌不是口令，按 User-Agent 认 |
| 不转发登录 | 网关从不带 Agent 的凭证 | 直通早就丢掉 `authorization`、`x-api-key`；翻译的请求不带 Agent 的头 |
| `oauth-` beta | `askedBetas`：Agent 的 `anthropic-beta` 去掉 `oauth-` 开头的项，接口自己配的 beta 照发 | `fittedBetas`（`claude-code-fields.ts`）：直通时一律去掉 `oauth-` 项（与原来对非 Claude 去掉审查 beta 合在一起）。Osuna 的接口没有自己配的 beta |
| 改报错 | `keepsSignIn` 包 `POST /v1/messages`、`/messages`、`/v1/messages/count_tokens`；只看请求的 `Authorization: Bearer sk-ant-oat…`（不看选项） | `keepClaudeSignIn`（`gateway/claude-signin.ts`）包同样判断的 Anthropic 路径与 count_tokens（Osuna 没有不带 `/v1` 的 `/messages`）。Node 里改写 `res.writeHead/write/end`：报错状态码扣到看见正文；401、正文含「OAuth token has been revoked」的 403 改 502 `api_error`，文字「<接口名> refused Osuna's credential (HTTP 401): <原因>」，接口名从「名字: 原因」拆出，拆不出用回复头 `x-osuna-api-endpoint` 的标识，再没有用「The API endpoint」；其余报错保持状态码、`x-api-key` 换成 `API key`；没有正文的 401 也改 502；开口 200 后流里 `event: error` 事件同样换掉 `x-api-key` |
| 流里错误的认法 | 一次写入以 `event: error\n` 开头才换 | 一次写入里出现 `event: error\n` 就只换它之后的部分（直通的转发可能把前一帧和错误事件写在一起）；不动之前的模型输出 |
| 日志 | 用量与 Recent calls 记接口原状态 | Osuna 的日志在包装之前就记了接口原状态与原话 |
| count_tokens | 上游 401 照样改 | Osuna 的 count_tokens 上游失败时本地估算、回 200，CLI 本来就收不到 401；包装照装，保证一致 |
| 两种不一致 | `Check`：开着却有口令 → 报；关着口令空或没了 → 报「建议设成 claude.ai」；地址被改先报地址 | 列表的 `agentIssues` 新增 `claude_ai_login_token_set`（file）与 `claude_ai_login_token_empty`（file、how：empty / missing），只在总开关开着时查；地址也被改时只报「不再经过中转站」。这两种不算「不再经过中转站」（中转站照收）。按钮：前者「重新应用」「不再保留 claude.ai 登录」，后者「保留 claude.ai 登录」「重新应用」。开着、口令被删掉是要的样子，不报也不算被改。magpie 只有文字、没有按钮（TUI 里改字段） |
| `keyOurs` / 换端口 | 空口令只在 magpie 最后写的地址旁才算 magpie 的 | Osuna 按接管记录判断归属，没有「用户自己的地址配空口令」被误认的问题 |
| 说明文字 | `claudeSignIns` 两个选项各一段 | 一段：打开后语音、claude.ai 连接器、`/usage` 套餐额度、云端会话能用，登录从不转给接口；Remote Control、ultrareview 仍不能用。9 种语言 |

剩下与 magpie 不同的：没走中转站时也能设（magpie 拒绝）；不做「只在网关收任意 key 时提供」（Osuna 没有共享）；流里错误事件不要求出现在一次写入的开头；提示区带按钮。

### 测试

- daemon 端到端 `api-endpoint-gateway.e2e.test.ts`「Claude Code signed in to claude.ai」（照 magpie `claude_signin_test.go`）：假上游收到的请求里没有 claude.ai 令牌、用的是这家的 key、`anthropic-beta` 去掉 `oauth-` 项；401 → 502 带接口名与 `API key`；吊销的 403 → 502，别的 403 保持状态码；400 保持状态码换掉 `x-api-key`，带中转站口令的请求原样；带口令的 401 仍是 401；流里错误事件换掉 `x-api-key`。
- daemon 端到端 `api-endpoint-claude.e2e.test.ts`「keeping Claude Code's claude.ai sign-in」：打开后口令为空、关掉写回、关总开关逐字节还原；总开关关着设、打开时生效；两种不一致各一条、对应处理后消失；Codex 拒绝。
- 纯逻辑：`claude-settings-patch.test.ts`（口令三种状态）；app `agent-settings.test.ts`（两种提示的按钮、选项的读法）。
- 浏览器 `settings-api-endpoints.spec.ts`：说明文字、只读目录下保存失败留在原处且口令不变、成功后口令为空、关掉写回。`resetApiEndpoints` 一并把选项关掉。
- 截图：`screenshots/18-claude-code-page_keep-claude-ai-login-off_desktop-1280_{en,zh}.png`、`18-claude-code-page_token-empty-issue_desktop-1280_{en,zh}.png`。

## 19 打开开关时怎么挑默认模型；默认模型可指定某一家

### 对照 magpie（7597c132）

| 项 | magpie（`internal/agent/applied.go`） | Osuna（`default-model-pick.ts`） |
| --- | --- | --- |
| 顺序 | `ConnectHow`：已接入 → kept；`connect`：`reconnect` → again；`Join` → joined；same / default / alike / own / sub / first | joined（ChatGPT 登录、模型归 Codex 自己时排最前）→ kept（开关本来开着，或 CLI 配置还指向中转站且它的模型有接口提供）→ again → same → default → alike → first |
| CLI 现在的模型 | `connectWas`：字段值去掉最后一个斜杠前的前缀；Claude Code 读 settings.json 的 `model` | 同；Claude Code 读 `model`（`readClaudeModel`），Codex 读顶层 `model`（`readCodexModel`）；另去掉 `[1m]` |
| same | 去掉前缀后与 magpie 模型 id 相同或差 `[1m]`，按「登录的账号 > 订阅 > key」取 | 原样是能选的名字（光秃秃或「接口标识/模型名」）就用它；否则去掉前缀后与接口模型同名或只差写法（`sameModel`），取光秃秃的名字。Osuna 没有账号与订阅，不分档 |
| default | CLI 没设模型：取它自己那一组的第一个，有就沿用 | Claude Code：models.dev 上 Anthropic 的 claude- 文字模型按发布日期新的在前的第一个（照 magpie `catalog.Provider` + `textModel` + `claudeOwn`，存进 `models-dev.json` 的 `claude`，旧缓存下次下载补上）；Codex：`models_cache.json` 里可见、priority 最小的那个（`codexOwnFirstModel`） |
| alike | 没有连字符的别名，名字里有 `-别名-` 的模型 | 先找第一家为这个档位配了映射的接口，取「接口标识/映射到的模型」（工单写「档位名指向的映射模型」）；再照 magpie 按名字找这一族，光秃秃的名字在前 |
| again | 断开时记 `reconnection{Magpie, Routed, Left}`，所有字段都还是断开后的样子、记下的值 magpie 还在路由才放回 | 切回官方时在接管记录文件里记 `reconnect: { model: 默认模型, left: 还原后 CLI 配置里的模型 }`；CLI 的模型还等于 `left`、记下的默认模型还能选才放回。下一次接管整份重写记录时去掉。「保留当前设置」不还原、不记 |
| joined | `Join` 接得上（ChatGPT 登录、内置 openai 或 CC Switch 镜像）就不挑 | 同（`codexKeepsOwnModel` + 登录方式），且排在 kept、again 之前：这种接法 config.toml 的 `model` 归 Codex，关掉再打开也照旧报 joined，与写进去的一致。Osuna 的默认模型（只给 Osuna 自己的新对话）保留原来的、不能用时取第一个 |
| ChatGPT 登录、用户自己的服务商 | `connect` 挑一个 magpie 模型 `set` 上（值是 `provider/model`） | 挑中的光秃秃名字换成第一家提供它的「接口标识/模型名」再存成默认模型；写进 `model` 的就是它，`connection.model` 与之相同 |
| 没有模型 | `NoModelsError` / `AllHiddenError` | 照旧 `no_usable_model` |
| 结果给界面 | `Connection{How, Field, Value}`，GUI 弹 7 秒的状态条（`connectedSaid`） | `set_agent_settings.response` 的可选 `connection: { how, model, previousModel }`；设置页在开关说明下面写一句，直到下一次改设置。kept、alike、没设模型的 first 各有自己的一句 |
| 默认模型的写法 | 一律 `provider/model` | 光秃秃的模型名或「接口标识/模型名」（ADR 0012）；后者中转站先发给那家，冷却时换同名的别家 |
| 指定某一家的选项 | — | 接口标识不进接口列表的回复（规范：任何回复都不带标识）；app 取提供方快照里聊天模型选择器同一份 `apiEndpointModelGroups`（id 就是「接口标识/模型名」，组名是接口名），显示「模型名（接口名）」；主机没声明 `apiEndpointCliWiring` 时不列 |

### 剩下与 magpie 不同的

- **Codex 的 default 比 magpie 多**：magpie 的 `connect` 只认 `o.Group == a.Name` 的选项为「它自己的」，Codex 自己的模型分组是 "OpenAI" 或服务商 id（`codex.go` `modelOptions` 的 `group("OpenAI", …)`），不等于 "Codex"，所以 magpie 对 Codex 从不走 default。Osuna 按协调要求照 `models_cache.json` 做了。
- **Claude Code 的 default 只在 settings.json 没指别的地址时与 magpie 相同**：magpie 的分组名在 `ANTHROPIC_BASE_URL` 指向别处时变成「Claude Code · 主机名」，也就不走 default；Osuna 接管前不看这个。
- **没有 `magpie`、OwnVia 与账号 / 订阅分档**：Osuna 没有「唯一设置是 provider」的 App，也没有经中转站的 ChatGPT 账号与订阅。
- **again 只比模型一个字段**：Osuna 在这里负责的 CLI 选择只有模型；magpie 比它改过的所有字段。
- **CLI 还指向中转站时的 kept 照样重写配置**：magpie 什么都不做；Osuna 打开开关一律按当前设置接管。
- **界面**：一行说明，不是 7 秒的状态条；kept、alike、default 与 first 分开说。

### 要判断的地方

- 指定某一家的默认模型在那家关掉或去掉这个模型、别家还有同名的时，变成光秃秃的名字；都没有就取第一个（`settleAgentSettings`）。
- 老客户端：`activeModels` 的 isDefault 标去掉标识后的模型名；`projectedDefaultModelId` 只在默认模型指定的是这一家时去掉标识。
- 「接口标识/模型名」的选项来自快照，开关刚打开、快照还没推到时只有光秃秃的名字；快照里去掉了已下线的模型，所以已下线的那家那个模型不在选项里。
- 默认模型下拉在桌面端朝上开（`SelectField` 新增的 `desktopPlacement`，透传 Combobox 已有的 top-start）：这一行在提供方页最下面一张卡片里，朝下开会伸出窗口底边。窄窗口底部弹层标题与选项左边距不一样是 Combobox 弹层原有的样式，本张没动。

### 测试

- 纯逻辑：`default-model-pick.test.ts`（七种挑法、ChatGPT 接法先前关掉过仍是 joined、只认「接口标识/模型名」时的写法、`[1m]` 与前缀与写法差别、映射优先于名字、没有模型）、`models-dev.test.ts`（Claude Code 自己的模型新的在前、去掉非文字模型、重启后还在）、`codex-models-cache.test.ts`（`codexOwnFirstModel`）、`host-endpoints.test.ts`、`codex-config-patch.test.ts`。
- daemon 端到端 `api-endpoint-default-model.e2e.test.ts`：kept（重新应用、「保留当前设置」后再打开）、again（改过后不再放回）、same、default（Claude Code 按 models.dev 缓存、Codex 按 models_cache.json）、alike（magpie TestConnectKeepsTheModel）、first、joined（先开关一轮再打开）、ChatGPT 登录 + 用户自己服务商时 `connection.model` 与 config.toml 的 `model` 同为 `relay-a/glm-4.6`、没有模型时拒绝；Codex API key 接法下「接口标识/模型名」写进 `model` 且在模型目录里；Claude Code 的「relay-b/kimi-k2」先到 B、B 回 503 换到 A、冷却期间直接到 A。`api-endpoint-chatgpt-backend.e2e.test.ts`：ChatGPT 接法合并的清单里有这个名字。`api-endpoint-host-wide.e2e.test.ts` 照旧断言回复里没有标识。
- 浏览器 `settings-api-endpoints.spec.ts`：打开后的一句说明、选项同时有光秃秃的名字和「模型名（接口名）」、只读目录下保存失败留在原处且模型不变、保存成功写进 settings.json。另把「删除接口」用例里 `toEqual` 改成 `toMatchObject`（18 号的 `resetApiEndpoints` 让列表多带 `keepsClaudeAiLogin: false`）。
- 截图：`screenshots/19-claude-code-page_just-turned-on_desktop-1280_{en,zh}.png`（中文那张是同一台 daemon 上第二次打开，说的是 again）、`19-default-model-dropdown_open_{desktop-1280,compact-390}_{en,zh}.png`。

## 20 默认思考档位

### max 会不会锁住 Osuna 对话（只读源码，没有运行）

【源码核实】结论：会。

- Agent SDK（`@anthropic-ai/claude-agent-sdk@0.3.246` 的 `sdk.mjs`）把 Osuna 对话选的档位作为命令行参数 `--effort <档位>` 传给 Claude Code。
- Claude Code 2.1.302（`/tmp/cc-bin-Pdu8` 里的 darwin-arm64 二进制，`strings` 读出）算每次请求的档位：`function bw(e,n,{turnEffort:r,…}){… let c=Cx(); … m=c??(c===null?E:void 0)??r??n??E; … return I(m,e)}`，其中 `Cx()` 读 `CLAUDE_CODE_EFFORT_LEVEL`（`auto`/`unset` 当作没设），`n` 是会话档位（来自 `--effort`），`r` 是这一轮的档位。环境变量排在最前，所以它一设，`--effort` 和会话里改的档位都不起作用；`I()` 只在模型不支持 max 时降成 high。
- SDK 中途改档位走 `apply_flag_settings`，同一版本里有提示 `apply_flag_settings: CLAUDE_CODE_EFFORT_LEVEL overrides effort for this session`；`/effort` 也有 `CLAUDE_CODE_EFFORT_LEVEL=… overrides effort this session`。
- 项目里 SDK 自带的 Claude Code 2.1.246 同样：`function h(e,t){… f=Qe(); … return nt(f??(n?o:void 0)??t??o,e)}`，`Qe()` 读同一个环境变量。
- 这个变量从哪来：settings.json 的 `env` 在 Claude Code 启动时并进进程环境（Osuna 的 Claude 对话按 `settingSources` 读用户设置，中转站地址也是这样生效的），所以默认思考档位是 max 时，Osuna 里每个 Claude 对话都跑在 max。
- 界面：快照的 `lockedThinkingOptionId: "max"`（只在 Claude Code 开着开关、默认思考档位是 max 时），对话的思考档位浮层在滑条下写明原因。

### 对照 magpie（7597c132）

审查后改成完全照 magpie：

| 项 | magpie | Osuna |
| --- | --- | --- |
| Claude Code 写什么 | `effort` 字段：low–xhigh 写顶层 `effortLevel`，Claude 模型另写 `modelSettings.<claudeName>.effortLevel`，并删掉 `CLAUDE_CODE_EFFORT_LEVEL`；max 写这个变量 | 同；没设（null）时一个都不碰，上次写过的放回原值。写过的键记原值（`thinking.keys`）与为 modelSettings 新建的容器（`thinking.created`），关掉开关时放回 / 删掉 |
| Ultra Code | 独立的 `ultracode` 开关，与档位任意组合，只在模型支持 xhigh 时可开；off 删掉 | 同：`usesUltraCode`（true 写 `ultracode: true`，false 拿掉，没设不碰）；选档位从不碰 `ultracode`；设置页是一个 Switch，只在默认模型支持 xhigh 时出现 |
| Claude Code 的选项 | `claudeEffortsFor`：Claude 模型按 2.1.285 的表，别家模型五档都给 | 同 |
| Claude Code 换模型后 | 不改文件，读时 `claudeClamp`（不高于它的最高一档） | 同：存下的设置不改；daemon 回给客户端的设置照 magpie 的 Get 报 clamp 后的那一档，默认模型不支持 xhigh 时 Ultra Code 报关（文件里的 `ultracode` 留着，换回支持的模型又报开）；Claude Code 自己也这样降（`I()`）。app 不另算 |
| Codex 的选项与设置 | `Set` 收任何档位；选项是模型收的档位 | 同：Codex 收任何非空档位，不要求先有默认模型；设置页列模型收的档位 |
| Codex 换模型后 | `settle`：不收就 `codexcat.ModelDefault`（最近一档，没有就 medium、high、第一档）；不知道档位时不动 | 同，只在默认模型变了时做 |
| CLI 自己存下的档位 | 跟着走（`Follow`） | 不算被改过；21 号工单起跟着改 Osuna 的设置 |
| 正在跑的会话 | 提示「重开会话才用上」 | 没做，留给 27 号工单 |
| Osuna 自己的对话 | — | 接口模型带思考档位（Claude 支持 xhigh 时另有 Ultra Code 一档）；新对话从默认思考档位起步（Claude 按 clamp，开着 Ultra Code 时是 Ultra Code；Codex 按 ModelDefault）；没选 Ultra Code 时明确传 `settings.ultracode: false` |
| 锁住的说明 | — | 设置页与对话都按快照的 `lockedThinkingOptionId` 显示，规则只在 daemon；对话里锁住时滑条置灰 |

### 要判断的地方

- 新对话没选模型时（没有记住的选择），草稿的思考档位原来不显示；现在按实际会用的默认模型和它的起步档位显示，与提交时一样（`composer/draft/input-draft.ts` 的 `shownFormState`）。影响所有提供方的新对话草稿。
- 接口模型在 Osuna 对话里的思考档位原来没有，现在由 daemon 给出；档位显示名两个 CLI 一致（Low、Extra High…）。
- 窄窗口下默认模型与默认思考档位的下拉放到说明下面、占满整行。
- 下拉里选中的一行与悬停的一行用同一种底色（Combobox 现有样式），选中的另有勾；截图前把指针移开。没有改 Combobox。

### 测试

- 纯逻辑：`default-thinking.test.ts`（选项、claudeClamp、Codex 的 settle 与 ModelDefault、Claude 模型名）、`claude-settings-patch.test.ts`（high、Claude 模型的 modelSettings、max、Ultra Code 单独开关、拿掉用户的档位变量但留着他的 ultracode、换档位后放回、没设时不碰、CLI 改的档位不算被改过）、`codex-config-patch.test.ts`（写入与放回、两种接法、CLI 改的不算被改过）、`agent.test.ts`（没选 Ultra Code 时 `ultracode: false`）、app `agent-settings.test.ts`。
- daemon 端到端 `api-endpoint-default-model.e2e.test.ts`「default thinking」：Claude Code 的 high / modelSettings / max / Ultra Code 开关与关掉后逐字节还原；不支持 xhigh 时拒绝 Ultra Code 与 xhigh、换到不收的模型后设置不改；Codex 收任何档位、换模型后改到最近一档、关掉放回；快照里接口模型的档位、起步档位与 `lockedThinkingOptionId`。
- 浏览器 `settings-api-endpoints.spec.ts`：选项与 Ultra Code 开关、只读目录下保存失败留在原处、Max 写进环境变量并显示锁住的说明、High 写进 effortLevel、Ultra Code 单独开关不动档位、新对话从 High 起步、Max 时对话浮层写明原因。
- 截图：`screenshots/20-claude-code-page_default-thinking-max_desktop-1280_{en,zh}.png`、`20-codex-page_default-thinking-rows_compact-390_{en,zh}.png`、`20-codex-page_default-thinking-dropdown-open_compact-390_{en,zh}.png`、`20-chat-thinking_locked-at-max_desktop-1280_{en,zh}.png`。

### 留给 29 号工单（用户 2026-10-18 决定）

- 下拉（Combobox）里选项文字左边距约 12px、标题约 24px，没对齐。
- 下拉里选中行与悬停行同一种底色（全局 Combobox 样式），选中行只靠勾区分。
- 对话思考档位浮层左上角（「Max」左边）有一块很淡的胶囊形残影。
- 「模型被换掉」提示（工单 21）：只有中文文案带手动换行 `\n`，其余 8 种语言没有；提示正文里的 settings.json 完整路径太长（临时目录时占近两行），提示区各处一起定怎么缩写。

## 21 跟着 CLI 里存下的模型与思考档位走

### 对照 magpie（7597c132）

| 做什么 | magpie | Osuna |
| --- | --- | --- |
| 什么时候看 | `Follow` 在画 Agents 页时跑（`gui/api.go`），`Drift` 读状态时算 | 读状态（`list`）时，以及每个会改写 CLI 配置的操作之前（`exclusiveFollowing`；`attachGateway` 在绑定地址之后） |
| 换成 magpie 的模型 | `Follow`：`/model` 选的 magpie 模型就是新的主模型，跟随它的档位与 Subagent 一起换过去（`set(bare)`） | 换成某家接口提供的（光秃秃、`接口标识/模型名`、带 `[1m]`、只差写法，`servedModel`；Claude Code 的档位名按映射，`mappedTierModel`）就是新的默认模型，`commit(…, { isFollowingCli: true })` 重写跟随默认模型的字段（模型提示、`modelSettings` 档位路径、Codex 模型目录与起步档位）。不提示 |
| 写回模型 | `set(bare)` 按 magpie 自己的写法重写 `model` | 不重写：CLI 存下的原样留着（ADR 0012「Osuna never writes back over a model the CLI saved」；工单要求重写后 `model` 仍是它，如 `glm-4.6[1m]`）。接管记录的模型记 `held: "followed"` 与现在的值 |
| 换成别的 | `Drift` 的 `replaced`：字段离开了 magpie 模型 | 提示区 `model_replaced`（`file`、`model`、`defaultModel`；CLI 删掉了模型时 `model` 为空串，文案说改用它自己的默认）。之后的重写不碰这个模型 |
| 重新应用 | `Reapply`：写回被换掉的字段与其余设过的 | `set_agent_settings { reapply: true }`：整份重写、写回默认模型（`shouldRewriteModel`），清掉 `held` |
| 保留当前设置 | `Keep`：忘掉记录，不再报 | `keep_current_settings { code: "model_replaced" }`：记 `held: "kept"`，总开关照开；之后再换成别家都没有的也不提示（magpie 之后没有记录可比），换成接口提供的照样跟过去 |
| ChatGPT 登录的 Codex | `Joined` / `Beside`：在它自己的 `/model` 里选 ChatGPT 模型不算；模型一律读文件 | 同：只认 `接口标识/模型名`；选 ChatGPT 自带模型不提示、重写不改回。Osuna 没写 `model` 的 joined 接法也读文件，选了接口模型照样变成默认模型 |
| 档位 | effort 字段的 `Get`：`CLAUDE_CODE_EFFORT_LEVEL` → 这个模型的 `modelSettings` → 顶层（`claudeReadsTop`）；Codex 读 `model_reasoning_effort` | 同样的读法（`CLAUDE_TOP_EFFORT` 照 `claudeTopEffort`）；读到的与 Osuna 存的默认思考档位（没设也算）不同就跟过去，重写时按新档写，不改回。Ultra Code 同样按文件 |
| Osuna 换默认模型 | `Pick` 走 `Apply` | 在 Osuna 里换默认模型（或接口关掉、删掉后默认模型变了）照样写 `model`、清掉 `held`（`shouldRewriteCliModel`） |

### 与 magpie 不同、要判断的地方

- **跟随先落设置、后记归属**：先落下跟过去的设置，再把模型记作 CLI 的；写 settings.json 失败时记录不动，下次读状态照样跟（审查第 8 条）。
- **Codex 删掉档位**（`/model` 选 Default）：跟成没设，并忘掉接管前的原值，关掉开关时不把旧档位放回（magpie 关掉时也不碰档位）。Claude Code 的 `/effort auto` 删掉 `modelSettings` 里的档位：读顶层的模型照读 Osuna 写的顶层，档位看作没变；只读 `modelSettings` 的模型（Opus 5.5 起）跟成没设，Osuna 写过的档位键放回接管前的样子。
- **不重写模型**：magpie Follow 会按自己的写法重写 `model`，Osuna 留着 CLI 的写法，理由见上表。
- **Claude Code 内置的 Claude id**（如 `claude-opus-4-6`，没有接口提供）报「模型被换掉」，与 magpie 相同；中转站本身会把这种 id 兜底到档位映射或默认模型（工单 17）。
- 跟着走的写入失败（`config_conflict`、读不懂）只记日志，读状态照常；别的错误（如目录只读）照抛，这次读状态报错，下次再跟。
- 「保留当前设置」的 `code` 在 session 收成 `"model_replaced"`，别的值回 `invalid_input`，不再当成关开关。
- zh 文案把操作说明另起一行、按钮名加「」，避免「重新应用」在说明里断行；按钮本身不收缩，放不下整个换行。

### 测试

- 纯逻辑：`claude-settings-patch.test.ts`「the CLI's own picks」（读出 `/model` 存下的、重写不碰、`shouldRewriteModel` 写回、`kept` 后不算被改、关掉还原逐字节；档位按环境变量 → `modelSettings` → 顶层读，Opus 5.5 只改顶层不算）；`codex-config-patch.test.ts`「Codex's own picks」（模型与档位、重写不碰与写回、`kept` 与关掉还原）。
- daemon 端到端 `api-endpoint-default-model.e2e.test.ts`「following the CLI's own picks」：Claude Code 光秃秃 / 带标识 / 带 `[1m]` 三例变成默认模型、没有提示、加一家接口后 `model` 原样；哪家都没有的报 `model_replaced`、重写不改回、「重新应用」写回、「保留当前设置」后不再提示且开关照开、再加接口也不改回；Codex API key 接法同样；ChatGPT 接法下 `接口标识/模型名` 跟过去、ChatGPT 自带模型不提示也不改回，joined 接法（Osuna 没写 model）同样；settings.json 写不进时下次读状态照样跟；不认得的 `code` 被拒、开关照开；默认思考档位没设时也跟 CLI 的档位与 Ultra Code；`effortLevel`、`modelSettings`、`model_reasoning_effort` 跟到默认思考档位、重写不改回。`api-endpoint-claude.e2e.test.ts`、`api-endpoint-codex.e2e.test.ts` 原来「只改模型不报」的用例改成只报 `model_replaced`。
- app：`agent-settings.test.ts`（`model_replaced` → 重新应用、保留当前设置）；浏览器 `settings-api-endpoints.spec.ts`「Model replaced」：写明换成的模型、两个按钮，「重新应用」与「保留当前设置」各自失败留在原处、成功后照说的做。
- 截图（无头 Chromium、临时 CLAUDE_CONFIG_DIR、假数据）：`screenshots/21-claude-code-page_model-replaced_desktop-1280_{en,zh}.png`（文件路径是临时目录）。

## 22 Claude Code 的后台小任务模型与 Subagent 模型

### 对照 magpie（7597c132）

| 做什么 | magpie | Osuna |
| --- | --- | --- |
| 后台小任务模型 | 不单独设：`ANTHROPIC_SMALL_FAST_MODEL` 一律写 haiku 档位的模型（`writeTiers`） | 照工单单独一项 `backgroundModelId`，写 `env.ANTHROPIC_SMALL_FAST_MODEL`；没设时拿掉（接管前用户自己的记下、关掉放回），Claude Code 跟主模型。Osuna 没有 magpie 那种按档位写模型的做法（档位由中转站按各家映射翻译），所以不跟 haiku 档 |
| Subagent 模型与档位 | `subagent`、`subagent_effort` 两个字段；只设档位时写「主模型:档位」；`tierWith` 把档位放在 `[1m]` 之前 | 同：`subagentModelId`、`subagentThinkingOptionId`；只设档位时接在写完后文件里的主模型后面（CLI 自己换过的就是它的，`claudeModelAt` 在补丁里拼） |
| 档位能设什么 | `Set` 收 `MemberEfforts` 任一档（none–max），选项是模型的档位 | 同：收 none、minimal、low、medium、high、xhigh、max，不按模型的档位卡；选项由 daemon 放在提供方快照的 `subagentThinkingOptions`（Subagent 模型的档位，跟主模型时是 settings.json 里主模型的），app 照显示 |
| 接管时用户自己的 `CLAUDE_CODE_SUBAGENT_MODEL` | 在 `claudeEnv` 里：记下、拿掉，断开时放回 | 同：加进接管时删掉的变量 |
| 带点的 Claude 版本 | `spell` | `claudeSpelled`（工单 17），1M 的模型标 `[1m]`（`markOneMillion`） |
| 中转站认「模型名:档位」 | `askedAt`：最后一段是档位名、整个名字不是哪家的模型才拆；`withFixedEffort` 按 Agent 自己的格式改档位，翻译时按模型落定 | 同：`gateway/fixed-effort.ts`，在 `routeAgentRequest` 里拆，「整个名字是哪家的模型」按 `isDefaultModelChoice`；每个候选按自己模型的档位落定（`fitFixedEffort`，magpie `fitLevel`），直通在 `upstreamBody` 里改、翻译交给 `requestForModel`；count_tokens 只数去掉后缀的模型（magpie 同样） |
| CLI 改了这两个变量 | Subagent 字段的 `Get` 读文件：换成 magpie 的模型就跟过去；后台小任务不回读，下次写入盖掉 | 同：Subagent 变量被改成某家提供的模型（可带档位）就跟过去，删掉就跟主模型；哪家都没有的不跟，仍算「被改过」，下次改写写回 Osuna 的。后台小任务变量被改仍算「被改过」（工单以前就是这样），改写时盖掉 |
| 模型不再有人提供 | `subagentOwn` 只认 magpie 在售的，不是就删掉 | 同：`settleAgentSettings` 把没人提供的后台小任务模型改回没设；Subagent 模型没人提供时连档位一起忘掉 |

### 与 magpie 不同、要判断的地方

- **直通给 Anthropic 地址的非 Claude 模型**：Osuna 原有的 `fitAnthropicBody` 会去掉 Claude Code 带的自适应思考与 `output_config.effort`；固定了档位时照 magpie 留着（自适应思考加 `output_config.effort`），没固定时照旧去掉。
- **请求里不会有 `[1m]`**：Claude Code 发请求前去掉 `[1m]`，所以发来的是「模型名:档位」；`askedAt` 照 magpie 仍认得带 `[1m]` 的写法。
- 老主机：app 按 `server_info.features.apiEndpointCliWiring` 一次决定显示这三行（同前几张工单）。

### 测试

- 纯逻辑：`claude-settings-patch.test.ts`「background task and Subagent models」（写进 env、关掉逐字节还原、没设时拿掉用户自己的并放回、改回没设时放回原值、读出被改过的 Subagent 变量）。
- daemon 端到端 `api-endpoint-default-model.e2e.test.ts`「background task and Subagent models」：两项写进 env、`claude-opus-4.6` 写成 `claude-opus-4-6:high`、只设档位写「默认模型:high」、改回没设拿掉、关掉开关后逐字节还原（原来有的放回、原来没有的删掉）；只有 Claude Code、模型要在售、档位要是 magpie 的那几档；手改成在售模型被跟过去且不报被改过；接口关掉后两项回到没设（Subagent 档位一起）；只设档位时选项来自主模型、设了 Subagent 模型后来自它（快照）；手改成没人提供的模型只报普通的「被改过」、不报「不再经过中转站」。补丁单测另有：只设档位时接在 CLI 自己换过的主模型后面（`glm-4.6:high[1m]`）。
- `api-endpoint-gateway.e2e.test.ts`「a model asked for at an effort of its own」：Anthropic（`output_config.effort`）、Chat（`reasoning_effort`）、Responses（`reasoning.effort`）各一例收到去掉后缀的模型名与 high；模型没有 max 时 `:max` 落到最近的 high；Anthropic 地址上的别家模型留着自适应思考与档位；整个名字是某家的模型时原样。
- app：`agent-settings.test.ts`；浏览器 `settings-api-endpoints.spec.ts`「the background task and Subagent models」：只读目录下保存失败留在原处、保存后写进 env（连字符写法与「模型:档位」）、改回与默认模型相同拿掉、关掉开关拿掉。
- 截图：`screenshots/22-claude-code-page_side-models-set_{desktop-1280,compact-390}_{en,zh}.png`（无头 Chromium、临时 CLAUDE_CONFIG_DIR、假数据）。

## 23 Codex 的默认 Subagent 模型与记忆模型

### 对照 magpie（7597c132）

| 做什么 | magpie | Osuna |
| --- | --- | --- |
| 默认 Subagent 模型 | `subagents` 字段：`[agents] default_subagent_model`，`Set("")` 删键 | 同一个键，设置项沿用 `subagentModelId`；没设时不碰（用户自己的留着），设过又改回没设时放回接管前的写法 |
| 默认 Subagent 档位 | `subagent_effort`：`Set` 按 `subEfforts`（Subagent 模型，没设时文件里的主模型）校验，档位不清楚时都收，选项回落 low–xhigh | 同：`codexSubagentLevels`（没设 Subagent 模型时是默认模型；ChatGPT 接法下是 config.toml 里接口提供的模型，ChatGPT 自带的档位不清楚）；拒绝文案照 magpie。选项经快照 `subagentThinkingOptions` 给 |
| 换模型后档位 | `settle` 每次都跑 `dropSubEffort`：新模型不收的删掉（不是改到最近一档） | `commit` 里 `settleSubagentThinking`，每次改写都看 |
| 记忆模型 | `memories`：`extract_model` 与 `consolidation_model` 写成同一个，`Get` 读 consolidation 再 extract，不碰 `[features] memories` | 同；新字段 `memoryModelId`，只有 Codex |
| ChatGPT 接法下的写法 | 选项的值就是 `/model` 里的写法 | 光秃秃的模型写成第一家提供它的「接口标识/模型名」（`chatgptListedName`），与默认模型同一规则 |
| 编辑文件 | `SetTOMLKey` 只换值、接在表末尾、没有表就加；`DelTOMLKey` 表空了整张删 | 同（按节点位置拼接）；Osuna 加的表记在 `createdTables`，空了才删，用户原有的空表不动；新表放在专用表前面，重写不挪位置 |
| 模型不再有人提供 | `dropSubagent` 删掉 magpie 的 Subagent 与记忆模型 | `settleAgentSettings` 把两项改回没设；档位是单独的键，留给 settle 按主模型看（Claude Code 照旧连档位一起忘） |
| 读文件 | 三个字段的 `Get` 都读文件 | `readCodexCliPicks` 的 `subagent`、`subagentLevel`、`memory`：模型改成接口提供的就跟过去，档位照文件跟（不算被改过），哪家都没有的模型不跟、报「被改过」，下次改写写回。没写过时用户自己的值也算（magpie 显示文件里的） |

### 与 magpie 不同、要判断的地方

- **Codex 自己的模型**（审查后补，照 magpie `modelOptions` 与 `models()`）：用 ChatGPT 登录时，两个下拉在接口模型前列出 Codex 自己的模型（读 `models_cache.json` 里可见的，经快照 `cliOwnModels` 给 app，标「（ChatGPT）」），同名时光秃秃的名字指它自己的；档位按缓存条目的 `supported_reasoning_levels` 校验与给选项，换到不收的模型时同样拿掉；手改成它们的照文件跟，不报被改过、不写回。选项由 daemon 合好经快照 `sideModelOptions` 给，同名去重也在 daemon。magpie 用内置的 `catalog.Codex()`，Osuna 用 Codex 自己存的清单（工单 19 已在读）。
- **API key 接法下不列 Codex 自己的模型**（magpie 的 `modelOptions` 在各种接法下都列 own，这里偏离，依据读 openai/codex @ `8c076942` 源码，未运行 Codex）：
  - 默认 Subagent 模型：config.toml 写了 `model_catalog_json`（Osuna 的 API key 接法），模型管理器只用这份目录（`codex-rs/model-provider/src/provider.rs:401-405`，`StaticModelsManager::new(…, model_catalog)`；`core/src/thread_manager.rs:453-461` 传入 `config.model_catalog`）。派 Subagent 时 `default_subagent_model` 在这份清单里按名字找（`core/src/agent/child_config.rs:212-228`），找不到报「Unknown model `{x}` for spawn_agent」（`child_config.rs:326-352`）。目录里只有接口模型，所以 Codex 自己的模型名会让每次没指定模型的 spawn 失败。
  - 记忆模型：记忆请求走会话的 `model_provider`（`memories/write/src/runtime.rs:146-147`），模型名就是 `extract_model`（`memories/write/src/phase1.rs:162`）；API key 接法下这是 Osuna 的中转站，中转站对哪家接口都没有的模型回 404（`packages/server/src/server/api-endpoints/gateway/gateway.ts:557-560`），没有转给 ChatGPT 的路。
- **改回没设**：magpie 删键；Osuna 照 ADR 0004 放回接管前用户自己的写法。
- magpie 另有「subagent model」（中转站强制改 Subagent 请求的模型），不在本工单。

### 测试

- 纯逻辑：`codex-config-patch.test.ts`「the default Subagent model and level and the memory model」：四个键写入、用户的其他键与行尾注释不动、关掉逐字节还原；没有表时加表、重写不变、关掉删表；只设档位；改回没设放回用户的；ChatGPT 接法的写法；读出手改并只把模型算作被改过；没写过时读出用户自己的。
- daemon 端到端 `api-endpoint-default-model.e2e.test.ts`「Codex's default Subagent model and memory model」：ChatGPT 登录时 Codex 自己的模型在快照里、档位按它自己的、换模型拿掉不收的档位、手改成它的被跟且不写回；四个键与关掉还原；档位按模型校验、快照选项、换 Subagent 模型或主模型后拿掉不收的档位；ChatGPT 接法写成「接口标识/模型名」；只有 Codex 有记忆模型、模型要在售；手改成在售模型被跟、不在售的报被改过；接口关掉后两项回到没设、表拿掉。
- app：`agent-settings.test.ts`；浏览器 `settings-api-endpoints.spec.ts`：记忆模型在只读目录下保存失败留在原处、四个键写进 config.toml、关掉开关拿掉。
- 截图（无头 Chromium、临时 CODEX_HOME、假数据）：`screenshots/23-codex-page_subagent-and-memory-models-set_{desktop-1280,compact-390}_{en,zh}.png`。

## 24 Codex 的强制 Subagent 模型、派 Subagent 时的完整清单、「Codex Subagent 可用任意模型」

### 对照 magpie（7597c132）

| 做什么 | magpie | Osuna |
| --- | --- | --- |
| 认出 Subagent 的请求 | `callKind` 读 `x-openai-subagent`，`usage.PurposeOf` 把 `collab_spawn`、`thread_spawn`、`agent_job` 归成 Subagent | 同（`gateway/codex-subagents.ts`，`callKind` 从 `codex-side-calls.ts` 导出）。Codex @8c076942 发的是 `thread_spawn`（`protocol/src/protocol.rs:3183`） |
| 强制模型改不改 | `codexSubagentPick`：没设、与主对话相同不改；没人提供、或任务被 ChatGPT 封存而它不是 ChatGPT 账号的模型时照主对话的发并说明原因；网关 key 不许用的也不改 | 同，原因写进日志；Osuna 没有网关 key 的限制。API key 接法「有人提供」按 `resolveGatewayRoute`；ChatGPT 接法另认 Codex 自己的模型（`models_cache.json` 可见的），光秃秃的名字同名时归它自己（与工单 23 一致），只有它打得开封存的任务 |
| 封存的任务 | `sealedTaskIn`：去掉标题是「Message Type: MESSAGE」的封存消息后仍有封存的 agent_message | 同（`hasSealedAgentTask`，同一个 `gAAAAA…` 正则） |
| 强制模型不再有人提供 | `SetCodexSubagentModel` 照存，网关照主对话的发直到又有人提供 | 同：`settleAgentSettings` 不清它；设的时候仍要是在售的（同工单 23 的下拉） |
| 改到哪 | ChatGPT 后端路径上光秃秃的模型在 `codexBackend` 里改，带斜杠的在 `serveAgent` 里改 | 都在入口改：`/v1/responses`（API key 接法）在 `routeAgentRequest` 读出请求体后改；ChatGPT 后端路径在 `serveChatGptBackend` 读出模型名后改，改到 Codex 自己的模型转 ChatGPT，改到接口模型走接口 |
| spawn_agent 补清单 | `spawnAgentModels`：含 `"spawn_agent"` 与「Available model overrides」才改；`tools`（含 namespace 内层）与 `tool_search_output.tools`；补在 Codex 那段后面，最多 200 个，已列的跳过 | 同（`gateway/codex-spawn-models.ts`），文字照搬（「More models that may be set as `model`:」） |
| 补哪些模型 | `/v1`：Codex 拿到的目录；CodexPath：Codex 自己的（缓存里可见的，按 priority）再接 magpie 的；V1 关着、主对话在 ChatGPT 自己的模型上时只补 Codex 自己的 | 同：API key 接法补目录里 /model 列着的光秃秃名字；ChatGPT 接法补 `models_cache.json` 里可见的再接 `codexEndpointEntries` 的「接口标识/模型名」，开关关着且主对话光秃秃时只补 Codex 自己的 |
| 「可用任意模型」标哪些 | `CodexAgentsV1`：ChatGPT 账号自己的条目（`own`）与 `codex/`、含 OpenAI 的分组条目标 v1，别家的不标 | 工单写明接口模型也标：API key 接法目录里每个条目、ChatGPT 接法合并清单里 ChatGPT 自带的与接口的都标。比 magpie 多标别家的条目；Codex 对没写 `multi_agent_version` 的条目按 feature 取版本（`codex-rs core/src/config/mod.rs:1660-1667`），标 v1 只是写明，不改变 multi_agent_v2 关着时的结果 |
| 开关一换 Codex 重拉 | `PolicyTag`：清单标记前加 `v1.` | 同：`agentsV1Tag`，`+osuna-v1.<hash>`；API key 接法目录内容变了照常重写文件 |
| 缓存里的 v1 | `Remember` 记下后端给的版本（`codex-agent-versions.json`），`CacheEntries` 读到标过 V1 的缓存时放回 | 同（`codex-agent-versions.ts`，文件在 `$PASEO_HOME/api-endpoints/`）：ChatGPT 的清单到了就记，拿不到 ChatGPT 的清单改用缓存时、缓存标记带 `v1.` 就放回 |
| multi_agent_v2 盖过 | `codexSubAgentsV1Warning`：开关开着且经 magpie 时读整份 config.toml；`[features]` 的布尔值或 `[features.multi_agent_v2]` 的 `enabled`，三种写法；旧式 `profile` 的 features 盖过顶层；读不了另一条，不当作没开；不写 | 同（`readCodexMultiAgentV2`，提示区 `codex_multi_agent_v2_on` / `codex_multi_agent_v2_unreadable`），只在 Codex 总开关开着时查；两条都只给「如何修复」 |

### 要判断的地方

- **提示文案**：magpie 的英文照意思改成 Osuna 的说法（「API endpoint models」），另加修复步骤（magpie 只有一句话，「如何修复」是工单要的）。读不了配置时 `config_unparsable` 那条也在，两条并列（magpie 同样 Check 与 V1 提示各报各的）。
- **界面**：两行放在默认 Subagent 档位之后、记忆模型之前；强制模型的下拉选项与默认 Subagent 模型相同（daemon 合好的 `sideModelOptions`）。

### 测试

- 纯逻辑：`codex-spawn-models.test.ts`（namespace、tool_search_output、200 个上限、不改的四种）；`codex-subagents.test.ts`（三种写法、不改的情况、没人提供、封存的任务与消息）；`codex-config-patch.test.ts`「Codex's own multi_agent_v2」（三种写法、false、不认的值、profile 盖过与不盖、没文件、读不懂）；`codex-model-catalog.test.ts` 跟着改签名。
- daemon 端到端：`api-endpoint-default-model.e2e.test.ts`「Codex's forced Subagent model and Subagents on any model」（只给 Codex、要在售、不碰 config.toml；目录每个条目标 v1、关掉拿掉；三种写法与 `[features.multi_agent_v2]` 表报提示、false 与开关关着不报；读不懂另报）。`api-endpoint-gateway.e2e.test.ts`（Subagent 请求到达假上游时是强制模型、主对话与 review 不变；没人提供、封存的任务照主对话的发；spawn_agent 补上其余模型、不带的请求不变）。`api-endpoint-chatgpt-backend.e2e.test.ts`「Subagents of a Codex signed in with ChatGPT」（合并清单标 v1 与标记、关着照 ChatGPT 给的；拿不到 ChatGPT 时缓存里的 v1 放回；ChatGPT 自带模型上的 Subagent 改到接口模型、不带 ChatGPT 登录；改到 Codex 自己的模型转 ChatGPT；封存的任务留在 ChatGPT；spawn_agent 补的清单按开关与主对话所在）。
- app：`agent-settings.test.ts`；浏览器 `settings-api-endpoints.spec.ts`「Codex's forced Subagent model and Subagents on any model」：接口在选的同时被关掉时保存被拒、原处不变；模型目录写不进时开关留在关；保存后中转站读到强制模型、目录标 v1、config.toml 不变；multi_agent_v2 开着时提示与「如何修复」。
- 截图（无头 Chromium、临时 CODEX_HOME、假数据）：`screenshots/24-codex-page_any-model-on-overridden-by-multi-agent-v2_desktop-1280_{en,zh}.png`。
