# 第三方接口自动切换（本地中转站）

逐轮决策见 `research/decisions.md`，magpie 调研见 `research/magpie.md`，十张决策票见 `map.md` 与 `map-issues/`。实现时遵守 `docs/adr/0004-api-endpoint-rewrites-cli-config.md` 保留的文件编辑规则，并以 `adr-draft.md` 为 ADR 0007 定稿依据。

## Problem Statement

我手上有几家第三方中转站（每家一个地址、一把 key），想让 Claude Code 和 Codex 用它们的模型。现在 Osuna 只能让一个 Agent「当前启用」一家接口：一家额度用尽就得手动切到另一家，正在进行的对话还会报错；接口按 Agent 各存一份，同一家要录两次；Claude Code 只能接 Anthropic 格式的中转站、Codex 只能接 OpenAI 格式的，格式不对的那家就用不上；真实 key 还被写进了 CLI 自己的配置文件。

## Solution

第三方接口改为整台主机共用，在设置里单独一页管理：每家接口填一把 key、最多三种请求格式的地址（可自动检测），拉取上游模型后按家族挑选要用的。每个 Agent 一个「使用第三方接口」总开关和一个默认模型；打开后聊天里的模型列表按接口分组列出所有开着的接口的已选模型，选哪家的模型这段对话就走哪家，终端里 `/model` 也能选。

daemon 内置一个本机中转站替两个 CLI 转发请求：CLI 配置文件里只写中转站地址和一个随机口令，真实 key 从不离开 daemon。正在用的那家额度用尽、欠费、限流或出错时，中转站在回复第一个字之前自动换到另一家有同名模型的接口并让失败的那家冷却一段时间；没有同名模型就把错误交给 Agent 在对话里显示；冷却结束回到用户选的那家。中转站同时做 Anthropic Messages / OpenAI Chat / OpenAI Responses 三种格式互译，Claude Code 能跑 OpenAI 格式的中转站、Codex 能跑 Anthropic 格式的。对话里对此一律不提示，只记后台日志。旧数据自动换算；官方 Paseo 手机 App 不改一行、照常能用。做法参考 magpie（MIT），用 TypeScript 在 daemon 里重写，不托管其程序。

## 术语（实现时写入 docs/glossary.md）

- **第三方接口**：整台主机共用的一条上游连接：名称、一把 API key、最多三个格式地址（Anthropic / OpenAI Chat / OpenAI Responses，至少一个）、已选的模型、Claude 档位映射（可不填）、接口开关。不按 Agent 归属，没有自己的默认模型。
- **请求格式**：发给上游的请求用哪种协议格式；与模型家族无关，同一个地址能请求任何家族的模型。
- **接口开关**：每家接口自己的开 / 关，对所有 Agent 生效、持久保存；关着即「已关闭」。
- **使用第三方接口**：每个 Agent 一个总开关；打开后该 Agent 能用所有开着的接口的已选模型，关掉即「官方」。
- **默认模型**：每个 Agent 一个光秃秃的模型名，从开着的接口勾选模型合并去重后选；写进 CLI 自己的配置，终端新会话从它开始，Osuna 新对话只在没有记住的上次选择时用它。
- **自动切换**：中转站在回复第一个字节前，把失败的请求改发给另一家开着的、有同名模型的接口，模型不变。
- **冷却中**：接口因用尽、欠费、限流或服务器错误而暂时不被自动使用的状态；key 无效为「需要检查」，须用户编辑后才恢复。
- **已关闭**：接口开关关着的状态（取代原「已暂停」），不自动恢复。
- **模型家族**：按模型名前缀识别的厂商归类（Claude、GPT、Gemini、DeepSeek、Kimi、GLM、通义千问……其他），只用于拉取模型时分组挑选。

## User Stories

1. 作为同时用几家中转站的用户，我想把每家接口只录一次、所有 Agent 共用，以便不用给 Claude Code 和 Codex 各配一遍。
2. 作为用户，我想在设置里有一页专门管理第三方接口，以便一眼看到有哪几家、哪家开着、哪家在冷却。
3. 作为用户，我想添加接口时只填名称、key 和地址，由 Osuna 自动检测这家支持哪几种请求格式，以便不用自己弄懂协议。
4. 作为用户，我想在自动检测失败时分清是 key 错了还是地址不通，以便知道改哪一项。
5. 作为用户，我想保存接口后立刻拉取它的上游模型清单，并按 Claude / GPT / Gemini 等家族分组挑选，以便从几百个模型里快速找到要用的。
6. 作为用户，我想拉回来的模型默认一个都不选、每个家族能一键全选，以便列表里只出现我真要用的模型。
7. 作为用户，我想重新拉取模型时已勾选的保留、上游不再提供的有标记，以便更新清单不会弄丢我的选择。
8. 作为用户，我想手动添加一个上游清单里没有的模型名，以便用上中转站未公开列出的模型。
9. 作为用户，我想给每家接口单独配置 Claude 档位（opus / sonnet / haiku / fable）对应的模型，以便在 Claude Code 里按档位切换时走对模型。
10. 作为用户，我想用一个开关关掉某家接口，让所有 Agent 都不再用它，以便临时停用而不用删除。
11. 作为用户，我想删除接口前看到它会影响哪个 Agent 的默认模型，以便不会误删后 Agent 突然回到官方。
12. 作为 Claude Code 或 Codex 的用户，我想在该 Agent 的设置里用一个总开关决定它用不用第三方接口，以便一步在官方与第三方之间切换。
13. 作为用户，我想在总开关没法打开时看到原因（没有开着且选了模型的接口、daemon 以 socket 监听），以便知道先去做什么。
14. 作为用户，我想给每个 Agent 选一个默认模型，以便终端新会话和第一次新建对话从它开始。
15. 作为用户，我想默认模型在它所在的接口被关掉或删掉时自动改成别的可用模型，以便不会留下一个指向空处的设置。
16. 作为用户，我想在聊天的模型选择器里按接口名分组看到所有开着接口的已选模型，以便明确选用哪家的哪个模型。
17. 作为用户，我想选某家的模型后这段对话就固定走那家，以便知道自己的请求发给了谁。
18. 作为在终端里直接跑 CLI 的用户，我想终端里的 Claude Code / Codex 也走同一套接口和中转站，以便和 Osuna 里的体验一致。
19. 作为用户，我想正在用的接口额度用尽时自动换到另一家有同名模型的接口继续回答，以便不中断手上的工作。
20. 作为用户，我想在没有别家有同名模型时直接看到上游的报错而不是被换成别的模型，以便结果可预期。
21. 作为用户，我想失败的接口冷却一段时间后自动恢复、冷却期间不被再选，以便不在坏掉的接口上反复失败。
22. 作为用户，我想 key 无效的接口被标成「需要检查」且不再自动使用，直到我编辑它，以便一眼发现要换 key。
23. 作为用户，我想在设置里看到哪家在冷却、几分钟后恢复，并能「立刻恢复」，以便厂商已经恢复时不用白等。
24. 作为用户，我想换家和冷却在对话里完全无感，以便专注在工作上。
25. 作为排查问题的用户，我想在 daemon 日志里找到每次换家与冷却的记录，以便知道刚才到底发生了什么。
26. 作为用户，我想真实 key 只留在 daemon 里、CLI 配置文件里只有一个随机口令，以便 key 不会散落在多个文件中。
27. 作为用户，我想切回官方时两个 CLI 的配置文件完整恢复原样，以便随时退回去。
28. 作为手写过 CLI 配置的用户，我想 Osuna 改写配置时只碰它自己的键、其它内容一字不动，以便我的自定义不丢。
29. 作为 Claude Code 用户，我想用 OpenAI 格式的中转站上的模型，以便不被接口格式限制。
30. 作为 Codex 用户，我想用 Anthropic 格式的中转站上的模型，并在 `/model` 列表里看到它们，以便 Codex 也能跑 Claude 系模型。
31. 作为用户，我想在跨格式翻译时工具调用、图片、思考过程尽量保持可用，以便翻译后的体验接近原生。
32. 作为用户，我想在 Claude 模型有 Anthropic 地址时一律走 Anthropic 格式，以便提示缓存不被翻译破坏。
33. 作为升级 Osuna 的老用户，我想原来按 Agent 存的接口自动变成主机级接口、原来启用的那家继续生效，以便升级后不用重新配置。
34. 作为用官方 Paseo 手机 App 的用户，我想手机上照常能看到并切换接口（简化版），以便不升级 App 也能用。
35. 作为用户，我想总开关打开时套餐用量旁有一句不点名的提示，以便知道那里的额度不代表第三方的实际消耗。
36. 作为中文用户，我想所有新界面文案都有简体中文且用词统一，以便看懂每个状态。
37. 作为维护者，我想有一份决策记录说明接口为什么改走中转站、相对旧规则改了什么，以便日后不被反复质疑。
38. 作为维护者，我想借鉴 magpie 的文件保留其 MIT 声明并有一份第三方声明清单，以便许可合规。

## Implementation Decisions

逐项契约在下文 Requirements，这里只列决定与理由。

- **接口主机共用**：一家接口 = 名称 + 自动生成且不显示的标识 + 一把 key + 最多三个格式地址 + 已选模型 + Claude 档位映射 + 接口开关，不按 Agent 归属，没有自己的默认模型。每个 Agent 只存总开关与一个光秃秃的默认模型名。（04、08 票）
- **daemon 内置中转站，TypeScript 重写 magpie 发动机，不托管二进制**：挂在 daemon 现有 HTTP 监听的固定前缀下，不单开端口；只接受本机回环来源 + 每个 Agent 一个随机口令，口令兼身份。（M5、02、05 票）
- **CLI 只指向中转站**：Claude Code 写中转站地址、口令、顶层 `model`，不再写档位环境变量；Codex 写专用提供方表（口令明文）与模型目录文件 `model_catalog_json`，去掉 `auth.command` 与版本检查。ADR 0004 的文件编辑规则全部保留。（01、05 票）
- **模型名决定走哪家**：Osuna 会话内部用 `标识/模型名` 直达某家；光秃秃模型名按创建顺序找第一家开着且已选的；Claude 档位名按各家映射翻译；都找不到报错。会话不再记录「创建时的模式」。（04、07 票）
- **自动切换只换同名模型、只在首字前**：按创建顺序跳过已关闭 / 冷却 / 已删除；判错词表、冷却时长与粘性规则照 magpie；冷却只记内存。不做兜底名单。（D8、Q15、Q16、Q25）
- **每次请求挑格式**：有 Agent 自己格式的地址就直通；Claude 模型且有 Anthropic 地址一律走 Anthropic；否则翻译到第一个可用格式。直通只换模型名与认证。（U5、06 票）
- **协议转换范围照 magpie 减去厂商专属**：三协议经 server 内部中间格式互转；历史思考只回原厂；文件附件照 magpie 处理；不代搜；不做「记住被拒」重发。（06 票）
- **协议原地扩展 + 能力标记**：`provider.api_endpoint.*` 新字段全部可选；`features.apiEndpointGateway` 标记新能力；无标记的客户端（含官方手机 App）得到单接口投影，作为长期功能不打 COMPAT。（04、07 票）
- **迁移读时换算、写时升级**：同一个文件，不另建迁移程序，解析失败不写不删。（D4）
- **对用户无感**：不提示、不加时间线、不加小横条；换家与冷却只写 daemon 日志。（07、08、10 票）
- **默认模型失踪统一处理**：删除接口 / 关接口开关 / 关模型小开关同样处理；只在导致回官方时弹确认。（10 票）
- **总开关前提**：至少一家接口开着且已选至少一个模型；socket 监听时禁开。（10 票 Q2、05 票）

## UI and Design

完整结构、控件、状态词与用户喜好见 `ui-direction.md`（08 票定稿），原型在 `prototypes/08-ui-r2/`；这里只概括。

- **方向**：magpie 式三层。设置里新开「第三方接口」页（列表 → 添加弹窗 → 详情页）；Claude Code / Codex 页只剩总开关、默认模型、入口；聊天模型选择器按接口分组。用户喜欢按家族分组挑模型、左家族右模型的两栏与小开关；不喜欢把接口塞进 Agent 页、把「协议」做成单选、等宽字体与蓝框勾选、蓝色链接。
- **必须存在的画面与状态**：列表页（已开启 / 已关闭两组、空状态、冷却中 + 立刻恢复、需要检查）；添加 / 编辑弹窗（自动检测中、检测通过 / 未检测到 / key 无效、一个地址都没有时不能保存）；详情页（连接、模型区加载中 / 拉取失败 / 200+ 模型、搜索无结果、档位映射）；Agent 页（总开关可开 / 不可开并说明原因、默认模型下拉、入口汇总）；聊天模型选择器分组；删除与回官方确认框。
- **视口**：只做桌面端，Electron 与浏览器 Web；设置栏 720 宽；不做手机端。
- **设计规则**：沿用 `docs/design.md`、`docs/forms.md`、`docs/menus.md`，与现有「提供方」列表页、提供方详情页同组件同密度；`.atw/spec/app/frontend/` 的前端规范。开关一律用 Switch 不用勾选框，模型名不用等宽字体，次要操作不用蓝色链接。
- **可在截图上核对的验收**：见下文 Acceptance Criteria「界面」一节。

## Requirements

编号用于切票与验收引用。各条的细节以对应票的 Answer 为准，本节只定「做到什么算做了」。

### A. 数据与迁移（04 票、08 票修订）

- R-A1 `endpoints.json` 改为主机级接口：`slug`（自动生成、锁定、不显示）、`name`、三个可选格式地址（至少一个）、`models`（已选）、`modelMapping`（Claude 档位，可空）、`enabled`（接口开关）、创建顺序；`keys.json` 一家一把 key。去掉 `provider`、`defaultModelId`、`active`。例外（01 票实现时用户同意）：每家另存隐藏字段 `legacyDefaultModelId`，只供 R-A6 的老客户端投影使用（老表单上次为这家选的默认模型，迁移时取旧 `defaultModelId`），其它任何逻辑不读它。线上格式地址为 `baseUrls: [{ format, url }]`，格式是字符串。
- R-A2 每个 Agent（claude、codex）一组 `{ enabled: 使用第三方接口总开关, defaultModelId: 光秃秃模型名 }`。总开关只在至少一家接口开着**且已选至少一个模型**时允许打开；打开时没选默认模型则自动取最早建的开着接口的第一个已选模型；总开关关 = 官方，CLI 配置按现有逻辑还原、口令作废；关总开关从不被拒，请求里带的默认模型被忽略、已存的默认模型保留。
- R-A3 旧格式读时换算、写时升级，不另建迁移程序：旧 `baseUrl` 按旧 `provider` 填进格式地址（claude → Anthropic，codex → OpenAI Responses）；某 Agent 旧「当前启用」的接口 → 开着，该 Agent 总开关打开、默认模型取它旧的 `defaultModelId`；其余旧接口 → 已关闭。旧字段读时接受、忽略；解析失败报错，不写不删。
- R-A4 默认模型失踪统一规则（删除接口、关掉接口开关、关掉模型小开关三种操作同样处理）：某 Agent 的默认模型在所有开着接口的已选模型里都找不到时，改成最早建的开着接口的第一个已选模型；一个能用的模型都不剩时该 Agent 总开关自动关、回官方。只有「会导致某个 Agent 回官方」的操作才弹确认框，写明「<Agent> 将回到官方」；删除接口的确认框另写明默认模型会改成什么。
- R-A5 协议 `provider.api_endpoint.*` 原地扩展，新字段全部可选；`server_info.features.apiEndpointGateway` 作为能力标记。新增请求：设置总开关与默认模型（`provider.api_endpoint.set_agent_settings`，01 票）；接口开关 + 立刻恢复冷却（`provider.api_endpoint.set_endpoint_state`，字段 `enabled` / `clearCooldown`，01 票；冷却在 04 票之前无可清）；自动检测格式地址（`provider.api_endpoint.detect_formats`，08 票：请求 `endpointId?` / `baseUrl` / `apiKey?`，key 规则同 `fetch_models`、可 `cancel`；响应每种格式一条 `{ format, url, status, httpStatus, message }`，`status` 为字符串 `ok` / `auth_failed` / `not_detected`。照 magpie `detect.go`：先列一次模型给每种格式挑一个（Anthropic 问 Claude 模型、Responses 问 OpenAI 模型、Chat 问第一个非 Claude 的），再各发一条最小对话请求，2xx 且响应形状对才算通过；列模型被拒（401 / 403）时三种都是 `auth_failed`、不再发对话请求；列不出模型时三种都是 `not_detected`、什么都不问，用户只能手填。建议地址：整段粘进来的接口地址先剪到 base，Anthropic 取不带 `/v1` 的根，OpenAI 两种以版本段结尾、没有就补 `/v1`。实现在 server `api-endpoints/upstream-detect.ts`，其中 `probeUpstreamFormat` 供 09 票按格式测试连接复用）。列表响应新增可选 `agents`（按 provider 的总开关与默认模型）与每家 `baseUrls`、`enabled`；`save` 请求新增可选 `baseUrls`，带它时 `baseUrl` / `defaultModelId` 可省、`models` 可为空。`fetch_models` / `test_connection` 改为按「地址 + 格式」（09 票实现：两条请求加可选 `format`，带它时 `provider` 不起作用、认证头按格式；`test_connection` 带 `format` 时 `modelId` 可省，daemon 从这家已选模型、再从上游清单里按 `pickProbeModel` 挑，都没有就先列一次；上游 401 / 403 的结论 `error.code` 为 `auth_failed`。`fetch_models` 同时带 `endpointId` 时把列出的模型记成这家的上游清单。每家接口新增可选 `catalog: { fetchedAt, models }`（上次拉回来的清单，只由按格式拉取写入）与 `manualModels`（手动添加的模型名，开没开都保留），存进 `endpoints.json` 并随列表下发；`save` 新增可选 `manualModels`，省略即保留。路由与 Codex 模型目录只看已选的 `models`）。命名遵守 `docs/rpc-namespacing.md`。
- R-A6 无能力标记的客户端（含官方 Paseo 手机 App）得到单接口投影（规则见 08 票 Answer「老 App 投影修订」）：模型列表只含去重后的光秃秃模型名、`isModelListAuthoritative` 随总开关；老 `set_active(id)` 不关别的接口。这层是长期功能，不打 COMPAT 标签。01 票实现时定下的细节：投影的 `defaultModelId` 依次取「总开关开着且这家有的 Agent 默认模型」「`legacyDefaultModelId`」「第一个已选模型」，老 `set_active(id)` 的默认模型同样取它；老 `set_active` 一律重写 CLI 配置（老 App 的「重新应用」就是再启用一次）；老 `save` 新建的接口默认关（和以前「保存不启用」一样），新客户端 `save` 新建的默认开；老 `save` 编辑该 Agent 正指向的那家时，表单的默认模型成为该 Agent 的默认模型；Codex 老表单保存时保留这家已有的档位映射。03 票之前 CLI 直接指向的地址是「该 Agent 自己格式的地址，没有才取第一个」。

### B. 中转站（02、05 票）

- R-B1 挂在 daemon 现有 HTTP 监听的 `/api-endpoint-gateway` 前缀下（Codex 加 `/v1`），应答 `/v1/messages`、`/v1/messages/count_tokens`、`/v1/responses`、`/v1/models`、`/api/hello`；绕开 daemon 密码中间件与全局 JSON 解析上限，响应体流式。请求体由中转站自己整体读入（要读出模型名并改写，上限 64 MB，超出回 413），不受 100 kb 限制。中继不暴露它（中继只接 WebSocket，不走 HTTP 路由）。
- R-B2 只接受回环来源 + 正确口令：非回环或带 `Forwarded` / `X-Forwarded-For` / `X-Real-IP`（经代理转来）回 403，无口令或错口令回 401；口令可放 `Authorization: Bearer` 或 `x-api-key`，`/api/hello` 同样要口令。每个 Agent 一个随机口令兼身份，存 `$PASEO_HOME/api-endpoints/gateway-tokens.json`（0600）；总开关从关到开时生成，关时作废。真实 key 只在 daemon 内替换进上游请求，不出现在任何 CLI 配置文件与日志里。
- R-B3 Claude Code 接管写法：`ANTHROPIC_BASE_URL`（中转站）、`ANTHROPIC_AUTH_TOKEN`（口令）、`ANTHROPIC_API_KEY` 置空、顶层 `model`（默认模型）；不写 `ANTHROPIC_MODEL`、`ANTHROPIC_DEFAULT_*_MODEL`、`ANTHROPIC_SMALL_FAST_MODEL`，接管时存在则记录并删除、切回官方时还原（03 票实现：值原样回来，但排到 `env` 末尾，`jsonc-parser` 放不回原位置）。WebSearch deny 照旧。另写顶层 `modelPicker.options`（Claude Code v2.1.242 起），让终端 `/model` 列出每家开着的接口的已选模型：`model` 为 `slug/模型名`、`label` 为模型名、`description` 为接口名，随接口、已选模型与开关变化重写，关总开关时删除；用户原有的 `modelPicker` 记录、替换、还原。不用网关自动发现：它只收名字带 `claude` / `anthropic` 的模型（14 票真实验收发现，17 票实现）。
- R-B4 Codex 接管写法：顶层 `model_provider = "osuna_api_endpoint"`、`model`、`model_catalog_json`（指向 `$PASEO_HOME/api-endpoints/codex-models.json`）；专用表写 `base_url`（中转站 `/v1`）、`wire_api = "responses"`、`experimental_bearer_token`（口令明文）。去掉 `auth.command`、`codex-api-key` 文件与 Codex 最低版本检查。目录文件列去重后的光秃秃模型名（可见）与各家 `slug/模型名`（隐藏），在接口、已选模型或任一开关变化时重新生成，切回官方时删除并还原该键。03 票实现：每个条目必须带指令，否则 Codex 整个目录读不进来，条目带 Codex 自己给未知模型用的基础指令（取自 openai/codex，Apache-2.0）、其余字段照 Codex 的未知模型回退元数据；切回官方时专用表一并删除（ADR 0004 原规定留着它，被本条取代）。口令文件在两个 Agent 都关着时删除。每个条目写 `supported_reasoning_levels`（low、medium、high、xhigh）与 `default_reasoning_level = "medium"`，Codex 换模型时才能把不支持的档位换成支持的（14 票真实验收发现，16 票实现）。
- R-B5 ADR 0004 的文件编辑规则全部保留：只写自有键、记录与还原原值、原子写、解析失败不写、改名前重读、外部改动检测、`jsonc-parser` 与 TOML 节点拼接；用户手写的其它配置一字不动。
- R-B6 daemon 启动绑定端口后比对接管记录里的中转站网址，不一致则重写 CLI 配置；非 TCP 监听（socket / 管道）时「使用第三方接口」总开关不可打开并说明原因；daemon 未运行时不做额外处理。03 票实现：列表新增可选 `gatewayUnavailable`（`gateway_requires_tcp`；绑定端口前为 `gateway_not_ready`），拒绝打开总开关的错误用同一个 code；已开着的 Agent 在 socket 下不动 CLI 配置（换默认模型时沿用记录里的中转站地址，记录里没有就跳过，等下次以 TCP 启动对账）；启动时还清理 v0.15 在官方模式下留着的 Codex 专用表与 `codex-api-key`。
- R-B7 路由：`slug/模型名` 直达该家，该家已删除 / 已关闭 / 冷却中 / 没选这个模型视同不可用、按同名换家；整个名字是某家已选的模型时（模型名本身可带斜杠）按光秃秃模型名处理；光秃秃模型名按创建顺序找开着的、已选该模型的第一家，Claude 档位名（只对 Claude Code）在没有任何开着的接口选了这个名字时，取第一家映射了该档位的接口、换成映射到的模型；都找不到回 404、按 Agent 协议包装。
- R-B8 自动切换只在上游回复第一段到达前发生（2xx 响应头到了但第一段前断开也换家）、只换同名模型、按创建顺序跳过已关闭 / 已删除 / 需要检查的接口，冷却中的排到最后且只留最早恢复的一家；首字后不再换家，流中断的错误原样交给 Agent 且那家照样冷却。值不值得换照 magpie 的 `retryable`：上下文超长等请求本身的错误不换家直接交给 Agent；请求形状读不懂、客户端被拒、地区不支持的 400 / 422 换家但不冷却。最后一家照 magpie 原地重试（服务器忙两次、限流三次，等待超过 8 秒或开口超时不重试）。每次换家与进入 / 退出冷却都写一行 daemon 日志（接口名、失败分类、恢复时间），不进对话。04 票实现。
- R-B9 判错与冷却照 magpie（`research/magpie-port-inventory.md`，20 条判错正则全部移植；只移植中转站会产生的失败分类，订阅账号、厂商专属与路由组用的 13 种不搬）：欠费 30 分钟；额度用完按厂商重置时间、没给 15 分钟；限流 1 分钟起翻倍最长 30 分钟；其他服务器错误、开口超时与连不上 1 分钟起翻倍最长 10 分钟；key 无效 / 无权限（401 / 403 且不是额度、模型下线、套餐不含该模型、地区原因）标「需要检查」，对这家接口的任何编辑都解除；只因这把 key 不提供该模型时只冷却这家的这个模型（列表不显示）。全部因额度用完 / 欠费冷却时不再请求，把最后一家的错误交给 Agent 并带 `Retry-After`；都需要检查时同样交最后一家的错误；其他冷却仍去问最早恢复的那家。冷却只记内存，daemon 重启清零；「立刻恢复」清掉这家（含各模型）的冷却；改了 key 或地址也清掉，只改模型不清。列表每家带可选 `cooldown: { state: cooling_down | needs_check, reason, until }`。04 票实现。
- R-B10 粘性照 magpie auto 模式：同一轮留在接手那家；新一轮回到用户选的那家，除非接手那家 5 分钟内缓存命中 ≥ 1024 token 则继续用到缓存冷掉；冷却中的不粘。会话对应读 Claude 的 `x-claude-code-session-id`、Codex 的 `thread-id` / `session-id`（兼容 `thread_id` / `session_id` / `x-client-request-id`），都没有时按第一条用户消息取摘要；粘性按「Agent + 请求的模型名 + 会话」记在内存，最多 512 段、24 小时。04 票实现。
- R-B11 每次请求挑格式：Claude 模型（最后一个斜杠后以 claude 开头）且这家有 Anthropic 地址时一律走 Anthropic，即使有 Agent 自己格式的地址（decisions U5「保住缓存」）；否则有 Agent 自己格式的地址就直通；再否则翻译到第一个可用格式（Chat → Responses → Anthropic）。OpenAI 两种地址按 SDK 惯例以 `/v1` 结尾，Chat 拼 `/chat/completions`。05 票实现：只在当前能翻译的格式里挑（07 票起三种格式互通，不再筛），`count_tokens` 问用户选的那家（冷却中的跳过）的 Anthropic 地址，没有地址或它数不了就本地估算，不换家不冷却；翻译上游回了 2xx 却不是事件流时按开口前 502 换家并冷却。
- R-B12 等上游响应头最长 10 分钟，超时按服务器错误冷却换家。换不了家时状态码照抄，错误文字为「<接口名>: <上游原文>」并按 Agent 协议包装，欠费 / 额度 / 限流在后面附「(available again at HH:MM)」（daemon 本机时间，不是当天带日期），带回 `Retry-After` 与含 `ratelimit`+`reset` 的头，429 没有 `Retry-After` 时按冷却结束时刻补一个；选定接口之后的每个响应（含报错）加 `x-osuna-api-endpoint` 头，值是接口标识（接口名可能含中文，放不进 HTTP 头）。直通时请求 `accept-encoding: identity`，Anthropic 地址同时带 `Authorization: Bearer` 与 `x-api-key`。不另记用量。

### C. 协议转换（03、06 票）

- R-C1 三种协议经 server 内部的中间格式互转，每种协议一个文件负责解析请求、构建请求、解码流、编码流、渲染整份回复；上游一律流式请求，Agent 未要流式时攒齐再回；回复里的模型名回 Agent 请求时写的名字。中间格式类型不进 `packages/protocol`。
- R-C2 支持：文字、工具调用与 `tool_choice`、三协议的工具配对修补（Responses 直通前也做）、本轮思考实时翻译、base64 与 URL 图片（URL 原样转发不下载，Responses 最新一轮只给 `file_id` 的报 400、更早轮次的丢掉；07 票实现：只跳过要翻译的候选，能直通 Responses 的候选照问，一家都不剩才回 400）、结束原因与用量映射、结构化输出字段互转（Anthropic 无 schema 的改写进 system）、翻成 Anthropic 时三处自动 `cache_control`、`count_tokens` 非 Anthropic 上游本地估算（字节 / 4）。
- R-C3 历史思考只回原厂：Anthropic 签名块只回 Anthropic、Responses 加密推理只回 Responses、无签名文字丢弃；模型名含 `deepseek` 时按 magpie 补回放（直通与翻译两条路都做）。解码 Chat 回复时文首 `<think>` / `<thought>` 拆成思考块。直通发给非 Claude 模型的 Anthropic 请求剥掉 adaptive thinking 与 `output_config.effort`，交给模型自己的默认；Agent 原请求根本没提 `thinking` 时补 disabled（06 票用户决定）。翻译成 Anthropic 的请求跟 magpie 不补 disabled。客户端的「不思考」统一当最低档 low 发出（用户决定，16 票）：Responses / Chat 的 effort `none` 在直通与翻译两条路上都换成 `low`；翻译成 Anthropic 时 Claude 5 系不发 `thinking: disabled`（Opus 5.5、Fable 5.x 不许，Sonnet 5.5 只认 `between_tools`），改为不带 `thinking`、`output_config.effort = "low"`，4.x 及更早照旧。
- R-C4 文件附件照 magpie：Anthropic `document` 与 Responses `input_file` 丢弃，Chat `file` 换成 `[attachment <mime>]` 占位文字。联网搜索：翻译时剔除服务端工具、解码时跳过 `server_tool_use`，不代搜。
- R-C5 同协议直通只换模型名与认证、读用量与错误、保留客户端 `cache_control`；不做按厂商名的改写（例外：R-C3 里发给非 Claude 模型的思考字段与 DeepSeek 回放，只用 jsonc 改这几处），不做「记住被拒」重发；上游 400 原文按 R-B12 包装交给 Agent。例外再加一处：直通 Responses 时把 `reasoning.effort = "none"` 改成 `low`（16 票）。
- R-C6 中转站代码作为 server 现有「第三方接口」模块下的一个 gateway 子模块，内部分协议转换、路由两部分与一个入口；借鉴 magpie 的文件头写 MIT 短式并指向根目录 `THIRD_PARTY_NOTICES`。

### D. 会话与提示（07 票）

- R-D1 会话不记「创建时的模式」：删除现有的恢复时模式提示模块、会话记录的 `apiEndpointId` 及其读写；协议字段 `apiEndpointModeMismatch` 保留不发。恢复旧对话不检查、不提示；换家不加时间线提示；不做 composer 小横条。
- R-D2 套餐用量旁的提示：新客户端在总开关打开时显示「已启用第三方接口，此额度不代表实际消耗」，不点名；老客户端照旧按投影那家点名。

### E. 界面（08 票，细节见 `ui-direction.md`）

- R-E1 只做桌面端（Electron / 浏览器 Web），全部沿用现有设置页组件与密度。侧栏「主机」组「提供方」下方新增「第三方接口」页：「已开启 N / 已关闭 N」两组，每行名称、格式、主机名、已选数、状态（可用 / 冷却中 x 分钟后恢复 / 需要检查 / 已关闭）、接口开关；冷却中有「立刻恢复」。08 票实现：可用只显示成功色状态点（「可用」等状态词读在整行的无障碍名称里）；冷却中 / 需要检查的状态色文字接在摘要后、以「·」隔开；「立刻恢复」是行尾开关左侧的 outline sm 按钮（不塞进状态行，免得行高不齐）；冷却满一小时改按小时显示。页面说明按 `docs/design.md` §7 放在「已开启」标题的 info 提示里，并在一家都没有时写进空状态卡片，不在标题与卡片之间放段落（与原型不同）。关掉接口导致回官方的确认框正文是每个回官方的 Agent 一行「<Agent> 将回到官方。」加一句「没有别的开着且选了模型的接口了。」。
- R-E2 添加弹窗只填连接：名称、API key、地址 +「自动检测」、三种格式地址（每项显示检测结果，可手改，至少一个才能保存）；主按钮「保存并拉取模型」，保存后进详情页（拉取模型由 09 票的详情页做）。08 票实现：检测中可「取消」；检测通过的格式填入建议地址，没通过的保留用户已填的值；改 key 或地址清掉全部检测结论，改某一格只清那一格；操作按钮在弹窗固定底栏。编辑连接复用同一弹窗，key 留空 = 不改。「自动检测」与详情页「测试连接」都区分两种失败：上游回认证失败（401 / 403）时显示「key 无效」并在 key 框下标红，其余失败显示「未检测到」/「连不上」；「测试连接」对每个已填地址各测一次、分别显示。
- R-E3 接口详情页：连接区（三格式地址、打码 key、编辑）、模型区（搜索框；左栏家族目录、右栏当前家族模型，每行小开关、不用勾选、默认全关、每组可全选 / 全不选；「重新拉取」只把新模型以关着状态加进清单，已勾选的全部保留，上游清单里没了的在行尾加弱色小字「上游清单里没有了」；「手动添加」的模型同样保留）、Claude 档位映射区（Opus / Sonnet / Haiku / Fable 四个下拉）、头部开关 / 测试连接 / 编辑 / 删除。家族按模型名前缀识别，厂商图标借 magpie（MIT）。09 票实现：打开还没拉过清单的接口就自动拉一次，按 Anthropic → Chat → Responses 依次试已填的地址，第一个成功即止；两栏在固定高度（右栏露出半行提示可滚）里各自滚动，加载、失败、空、无结果占同样高度；全选 / 全不选只作用于这组当前显示（搜索命中）的模型；手动添加的模型直接打开；关掉模型会让某 Agent 回官方时按 R-A4 先确认；关掉被档位映射指向的模型时该档位一并清掉。「测试连接」的结果接在「连接」区对应地址的行尾，失败原因另起一行。删除确认框正文第一行点名接口（macOS Electron 的确认框只显示正文），默认模型变化与回官方各一行。删除、保存模型或映射失败显示在头部下方的一个错误提示里。头部徽标仍只反映 daemon 的冷却状态，不随一次测试结果改变。
- R-E4 Claude Code / Codex 提供方页「第三方接口」区只剩：「使用第三方接口」总开关（没有「开着且已选模型」的接口或 socket 监听时不可打开并说明）、「默认模型」下拉（光秃秃模型名，总开关关时隐藏）、「管理第三方接口 ›」入口（汇总开着数与冷却状态）。现有「官方 / 使用」单选、行内编辑删除、健康提示去掉。
- R-E5 聊天模型选择器在 Claude Code / Codex 下按接口名分组（创建顺序）、模型名前加家族小图标、只列开着的接口的已选模型；选哪家下的模型，会话内部就用 `slug/模型名`，界面不显示斜杠拼接名。
- R-E6 全部文案走 i18n（英文为源，九种语言补齐，zh-CN 按本文术语节），遵守 `docs/i18n.md` 守卫；旧键（`inUse`、`deleteActiveMessage`、`saveActiveMessage`、`codexVersionUnsupported`、`endpointToOfficial` 类提示等）从八个语言资源与守卫表移除。「使用中」「已暂停」不加入 `zhCNRetiredTermPattern`（「不使用中继」「计划已暂停」是别处的合法用法），只删旧键。
- R-E7 模型选择弹框的固定高度按列表实际行数（模型行加接口分组标题行）估算，上下限 220 / 400 不变（14 票真实验收发现，15 票实现）。

### F. 文档与决策记录（09 票）

- R-F1 `adr-draft.md` 定稿为 `docs/adr/0007-api-endpoints-route-through-daemon-gateway.md`；ADR 0004 文首标 `superseded in part by ADR 0007`，被取代条目各加一句指向 0007，删除「记录会话创建时模式」「版本检查只覆盖 Osuna 跑的 codex」两条 Consequences。
- R-F2 按 09 票 Answer 的表逐项改写：`docs/custom-providers.md` 三处（「While an API endpoint is active」整节、「Claude settings.json model discovery」末段、Alibaba 段「API endpoints」改「Base URLs」）；`docs/glossary.md` **API endpoint** 词条重写、**Custom provider** 一句、新增 Gateway / Endpoint switch / Use API endpoints / Default model / Request format / Model family / Failover 与四个状态词；`docs/data-model.md` 第 9 节整表重写、删 `apiEndpointId` 行；`docs/protocol-compatibility.md` 若有 feature 清单则加 `apiEndpointGateway` 一行；根目录新建 `THIRD_PARTY_NOTICES`（magpie，MIT，列借鉴文件、搬来的夹具、厂商图标）。`CLAUDE.md` 文档表不加行。13 票实现：ADR 0007 用「gateway token」（与 `gateway-tokens.json` 一致，不用草稿的 passphrase），翻译例外写全「发给非 Claude 模型的思考字段与 DeepSeek 回放」，400 的说法改成「不以改过的形状重发给同一家」（R-B8 部分 400 会换家）；ADR 0004 用 frontmatter `status:` 行，另给「Official 保留专用表」「专用表装着最后启用的那家」「改名前重读含 key 文件」「确认框计数会话」「自定义提供方跟随当前接口」五处加指向 0007。`custom-providers.md` 小节改名「While Claude Code or Codex uses API endpoints」（0004 锚点同步），「Its row in the provider list says…」整句删掉而不是改写——自定义提供方那一行在代码里不显示任何接口；回官方写成「关掉 Use API endpoints」，界面没有「Official」按钮。术语表状态词按界面实际标签「Needs a check」，四个状态合成一条 **Endpoint status**。`protocol-compatibility.md` 没有能力清单，不改。没有夹具目录（测试把 magpie 的例子写在用例里），`THIRD_PARTY_NOTICES` 改列测试文件；另补 `gateway.ts`、三个 gateway 测试、`model-families.test.ts`，并新增 OpenAI Codex（Apache-2.0）一节对应 `codex-base-instructions.ts`。

## Testing Decisions

好的测试只看外部行为：CLI 发出的请求与收到的回复、配置文件的最终内容、协议消息、用户看到的画面；不断言内部函数调用顺序。四处接缝（用户确认）：

1. **整条链路（主接缝）**：沿用 `daemon-e2e` 的「隔离 daemon + 正式协议客户端」端到端测试，本机起假上游服务器扮演中转站（现有 `api-endpoint-models` / `api-endpoint-test-connection` 用例已这样做）。覆盖迁移、总开关与配置文件改写、口令校验、路由、换家、冷却与立刻恢复、老 App 投影、Codex 模型目录文件、`count_tokens`、非流式攒齐。现有四个第三方接口 e2e：`models`、`test-connection` 保留并加按格式的用例；`claude`、`codex` 按新写法重写并保留「用户手写配置不丢」断言。
2. **翻译器与路由单元测试**：三协议互转、工具配对修补、思考块、`<think>` 拆解、图片、文件占位、结构化输出、`cache_control`、stop / usage 映射、DeepSeek 回放，用 magpie 搬来的 JSON 夹具驱动；判错正则、冷却常量、粘性判定、路由挑家、挑格式各有用例。先例：server 现有 `claude-settings-patch.test.ts`、`codex-config-patch.test.ts`、`upstream-models.test.ts`。
3. **界面**：`packages/app/e2e/browser` 的 Playwright 用例，照 `provider-settings-refresh.spec.ts`、`composer-provider-selector.spec.ts`、`model-search-in-provider.spec.ts` 写；文案走 `resources.test.ts`。截图取证 Electron 与浏览器 Web 各一次、浅深主题各一次。
4. **协议兼容**：`packages/protocol` 现有 `messages.api-endpoint.test.ts` 与 wire-compat 测试加新字段样本，验证老消息仍能解析、新字段全部可选。

真实 CLI 验收由用户用自己的接口手动完成（见 Acceptance Criteria「收尾」）；原生端免验。按 `docs/testing.md` 本机只跑改到的单个测试文件，整套交给 CI。

## Acceptance Criteria

每条须有可看的证据（命令与输出、测试结果、截图），按 `docs/qa.md`。

### 数据与迁移

- [ ] 用旧格式 `endpoints.json`（两个 Agent 各若干接口、各有一家「当前启用」）启动 daemon：列表返回主机级接口，原启用的两家开着、两个 Agent 总开关打开、默认模型等于旧默认模型，其余已关闭；地址落在对应格式栏；文件在首次写入后变为新格式，旧字段消失；损坏的文件不被改写也不被删除，日志有报错。（单元 / e2e）
- [ ] 删除一家接口、关掉接口开关、关掉默认模型的小开关三种操作后：各 Agent 默认模型按 R-A4 改变，一个能用的模型都不剩时总开关关、CLI 配置还原；只有导致回官方的操作弹确认框，文字写明哪个 Agent 回官方，删除接口的另写明新默认模型。（e2e + 截图）
- [ ] 没有「开着且已选模型」的接口时总开关打不开（接口全关、或唯一开着的一家一个模型都没勾，两种情形各一例）；打开总开关且未选默认模型时自动得到最早建的开着接口的第一个已选模型。（e2e）
- [ ] 不带 `features.apiEndpointGateway` 的客户端：`list` 得到单接口投影、模型列表只有光秃秃模型名；`set_active(id)` 打开总开关、开这一家、不关别的；`set_active(null)` 关总开关；老 `save` 的 `baseUrl` 落进对应格式栏。（协议 + e2e；官方手机 App 实机免验，没有模拟环境）
- [ ] `packages/protocol` 的 wire-compat 测试通过：新字段全部可选，旧消息样本仍能解析。

### 中转站

- [ ] 总开关打开后 `~/.claude/settings.json` 只多出 R-B3 的键、`~/.codex/config.toml` 只多出 R-B4 的键与专用表，用户原有的其它内容一字不差（沿用 `api-endpoint-claude` / `api-endpoint-codex` e2e 的「手写配置不丢」断言并按新写法重写）；关掉总开关后两个文件回到接管前原样、口令文件删除、`codex-models.json` 删除。
- [ ] `codex-models.json` 列出去重后的光秃秃模型名与各家 `slug/模型名`，改已选模型、接口开关、总开关任一项后文件更新。（e2e）
- [ ] 中转站只应答回环来源且口令正确的请求：非回环、错口令、无口令各返回 401 / 403；daemon 密码中间件不拦它；超过 100 kb 的请求体能通过。（e2e）
- [ ] daemon 改端口重启后 CLI 配置里的中转站网址被重写为新端口；以 socket 监听启动时总开关请求被拒并带原因。（e2e）
- [ ] 起两家假上游：A 返回 429 / 402 / 5xx / 超时时请求换到有同名模型的 B 且模型名不变、响应头有 `x-osuna-api-endpoint: B`；B 没有同名模型时返回「A: <原文>」包装错误、状态码与 `Retry-After` 照抄；首字已发出后 A 断流不换家；A 进入冷却后列表状态为「冷却中」并带恢复时间，「立刻恢复」后下一请求回 A；401 使 A 变「需要检查」且编辑接口后恢复；全部冷却时返回最后一家的错误。daemon 日志有每次换家与冷却记录。（e2e）
- [ ] 判错正则（20 条，04 票按清单实数改）、冷却常量（13 个）与粘性判定对照 `research/magpie-port-inventory.md` 的清单逐条有单元测试。
- [ ] `slug/模型名` 直达、光秃秃模型名按创建顺序、Claude 档位名按映射翻译、已关闭 / 已删除的 slug 视同冷却换家、都找不到报错：五种路由各有用例。（单元）
- [ ] 请求格式选择的四种情形（直通、Claude 模型强走 Anthropic、翻译到 Chat、翻译到 Responses）各有用例。（单元）

### 协议转换

- [ ] 从 magpie 搬来的 JSON 夹具全部通过：三协议互转（请求与流式回复）、工具配对修补、思考块、`<think>` 拆解、图片、文件占位、结构化输出、`cache_control`、stop / usage 映射、DeepSeek 回放。夹具文件头与 `THIRD_PARTY_NOTICES` 注明来源。
- [ ] 端到端：Claude Code 协议请求经假 OpenAI Chat 上游与假 Responses 上游各回一份流式回复；Codex 协议请求经假 Anthropic 上游回一份流式回复；非流式请求攒齐后一次返回；`count_tokens` 对非 Anthropic 上游返回本地估算。
- [ ] 直通请求只改模型名与认证头（发给非 Claude 模型的 Anthropic 请求另按 R-C3 改思考字段），其它字段（含客户端 `cache_control`）与原请求逐字节一致；上游 400 原文按 R-B12 包装返回。（e2e）

### 会话与提示

- [ ] 恢复时模式提示模块与会话记录的 `apiEndpointId` 读写已删除，在 server 与 app 两个包里搜 `apiEndpointId` 无业务代码命中；旧会话文件含该字段仍能加载。恢复一段点名已删除接口的旧对话再发消息：无黄条、无提示，请求按同名换家或由 Agent 显示报错。（e2e + 截图）
- [ ] 总开关打开时套餐用量旁显示不点名的提示；老客户端投影照旧点名。（组件测试）

### 界面（Electron 与浏览器 Web 各取证一次，浅色、深色各取证一次）

- [ ] 「第三方接口」页：两组列表、每行信息与开关、冷却 / 需要检查状态文字与「立刻恢复」、空状态，与「提供方」列表页同组件同密度。
- [ ] 添加弹窗：填 key 后「自动检测」对三种格式各发一次最小请求，通过的地址填入并标「✓ 检测通过」、未通过标「未检测到」；假上游回 401 时三项显示「key 无效」且 key 框标红；可手改；一个地址都没有时不能保存；保存后进入详情页并开始拉取模型。详情页「测试连接」对每个已填地址各显示一个结果。
- [ ] 详情页模型区：拉回 200+ 模型时左栏不滚出卡片、右栏可滚；默认全关；全选 / 全不选；搜索跨家族时左栏只剩有命中的家族；每行是小开关不是勾选框；模型名普通字体。重新拉取后已勾选的保留，上游不再提供的带「上游清单里没有了」小字；手动添加的模型保留。
- [ ] Claude 档位映射四个下拉只列本接口已选模型 +「不映射」；保存后 Claude Code 里选 opus 的请求被翻成映射模型。（e2e）
- [ ] Claude Code / Codex 页只剩总开关、默认模型下拉、入口行；入口行汇总正确；总开关不可打开时说明文字正确；旧的单选行与行内操作不再出现。
- [ ] 聊天模型选择器按接口名分组、带家族图标、只列开着接口的已选模型；选某家下的模型发消息，daemon 收到的是该家的 `slug/模型名`，界面显示光秃秃模型名。
- [ ] 删除确认框文字与 R-A4 一致。
- [ ] 新增与修改的文案在九种界面语言里都有，旧键已删除；`resources.test.ts` 通过，zh-CN 用词与本文术语节一致（可用 / 冷却中 / 需要检查 / 已关闭 / 使用第三方接口 / 默认模型 / 请求格式）。

### 文档与决策记录

- [ ] `docs/adr/0007-api-endpoints-route-through-daemon-gateway.md` 落盘，内容与 `adr-draft.md` 一致；ADR 0004 标 `superseded in part`、被取代条目指向 0007、两条 Consequences 删除。
- [ ] `docs/custom-providers.md` 三处、`docs/glossary.md`（API endpoint 重写、Custom provider 一句、新词条与状态词）、`docs/data-model.md`（第 9 节、`apiEndpointId` 行）、`docs/protocol-compatibility.md`（如有清单）按 R-F2 改完；`THIRD_PARTY_NOTICES` 建好并被借鉴文件头引用。
- [ ] 旧 ADR 0004 保留的规则在 0007 里只链接不重述。

### 收尾

- [ ] 真实 CLI 验收由用户用自己的第三方接口完成：Claude Code 与 Codex 在终端与 Osuna 对话里各走一次中转站并正常回复；`/model` 能选到接口模型；切回官方后两个 CLI 恢复原样。
- [ ] `npm run typecheck`、`npm run lint` 通过；新增与改动的测试文件按单文件方式本机跑过；CI 全绿（Nix 两项常红不计）；PR 以 merge commit 并入 main。
- [ ] 原生端（iOS / Android）实机验收：免验（没有模拟环境；手机端用官方 App，不改）。

## Out of Scope

- 同一接口多 key；订阅账号轮换（Claude / ChatGPT 多账号）。
- Pi、OMP（第二期，先补接线）；Copilot、OpenCode、Antigravity、Muse；Gemini CLI。
- Gemini 协议（第二期）；主动读套餐用量提前切换（第二期）。
- 冷却状态持久化（只记内存，daemon 重启清零）。
- 按接口配置的有序兜底名单（magpie 做法）；用尽时换到不同名的模型。
- 接口标识的显示与编辑：由 Osuna 自动生成，只在 Osuna 会话与 CLI 之间内部使用。
- 按厂商名的特殊改写与「记住被拒」重发（DeepSeek 思考回放除外）；代替厂商联网搜索；第三方接口上 PDF 的额外处理；流中断续写。
- 会话恢复时的模式提示与换家时的时间线提示：一律不做（07 票）；修改官方 Paseo 手机 App。
- composer 上方「当前实际在用」小横条；按 Agent 精简模型（magpie 的隐藏 / 只用挑选）；预设中转站清单；按模型指定走哪种格式；被拒后换格式重发（08 票）。
- Claude Code 后台小任务（起标题、压缩上下文）单独指定便宜模型：口令认证下小模型与主模型同名、走同一家同一个模型，第一版不分流（10 票）。

图外清单的完整版与各项排除理由见 `map.md`「Out of scope」。

## Further Notes

- 原型产物（`prototypes/`、对比页、截图、生成脚本）留在本任务目录、随任务进 main，不另开一次性分支；只作决策依据，正式界面按 `ui-direction.md` 重新实现。
- 组织方式：一个任务切工单，不拆子任务（各部分不能独立上线）。
- 本机不测 CLI 登录与真实调用；研究只读文档与源码。
- 协议改动遵守 `docs/protocol-compatibility.md`；新 RPC 命名遵守 `docs/rpc-namespacing.md`。
