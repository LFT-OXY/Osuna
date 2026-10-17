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
