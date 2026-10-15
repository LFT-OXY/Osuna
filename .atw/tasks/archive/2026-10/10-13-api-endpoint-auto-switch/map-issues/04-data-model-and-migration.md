# 04 — 接口怎么存、旧数据怎么迁、老客户端怎么办

Type: interview
Status: resolved
Blocked by: 01

## Question

第三方接口改为主机共用（Q27）、带协议与兜底名单（Q24）、每个 Agent 一份启用名单与默认模型（Q19）。要定：

- 每家接口的字段：名称、地址、协议（Anthropic Messages / OpenAI Chat / OpenAI Responses）、key、勾选的模型、默认模型、兜底名单（有序「接口/模型」列表）、Claude 档位映射（仍按接口保存？还是按 Agent？）、手动暂停标记。
- 每个 Agent 的状态：官方 / 启用名单（哪些接口）+ 默认模型（接口/模型）。
- 存储：沿用 `$PASEO_HOME/api-endpoints/` 下的 `endpoints.json` / `keys.json` / 接管记录，还是改文件；现有按 Agent 保存的接口如何自动迁移（claude→Anthropic、codex→Responses），迁移失败怎么办。
- 协议（WebSocket RPC）：现有 `provider.api_endpoint.*` 七组请求响应怎么扩展才能让老客户端照常解析（`activeEndpointId` 只有一个值的语义如何保留；新增字段全部可选；是否新开 RPC 名）；`server_info.features` 加什么能力标记；COMPAT 标签。
- 测试连接、拉取模型按接口协议走。
- 01 的结论若是「不能带斜杠」，模型名写法在此改定。

产出：在本票 Answer 里写定字段表与迁移规则；更新 `prd.md` 对应节。

## Answer

访谈四轮（2026-10-13 晚 ～ 10-14），说明图见 `prototypes/04-model-flow.html`（图 2、图 3 的「兜底名单」「每家默认模型」已被本票推翻，只作讨论留档）。

### 推翻的旧决定

- **Q24 兜底名单作废**：不再按接口配置有序兜底名单。用尽时的换家规则改为自动同名换家（见下）。
- **Q20 修订**：`接口标识/模型名` 只是 Osuna 会话与 CLI 之间的内部写法，任何界面都不显示、不可编辑；终端里 `/model` 用光秃秃的模型名。
- **每家接口自己的「默认模型」字段去掉**（旧字段 `defaultModelId` 读时接受、只用于迁移、之后忽略）。
- Q12 的「没有同名就用下一家的默认模型」不采用：没有同名模型就报错，不擅自换模型。

### 每家接口（整台主机共用）

| 字段 | 说明 |
|---|---|
| `id` | 内部随机 id，沿用 |
| `slug` | 接口标识，Osuna 从名称自动生成（小写字母、数字、横杠，主机内唯一，生成不出来用 `api-N`），建好即锁定、不显示、不可编辑；只用于 `slug/模型名` 内部写法 |
| `name` | 名称，可改、可中文 |
| `baseUrl` | 地址 |
| `protocol` | `anthropic_messages` / `openai_chat` / `openai_responses`；线上是字符串不是枚举 |
| key | 仍存 `keys.json`，任何响应只带 `hasApiKey` |
| `models` | 勾选的模型 `{id, label?}`；这是控制模型选择器长度的唯一手段 |
| `modelMapping` | Claude 档位映射（opus/sonnet/haiku/fable → 勾选的某个模型），**任何协议的接口都可填、可不填**；Codex 忽略 |
| `paused` | 手动暂停，整台主机生效、持久保存；冷却状态仍只记内存 |
| `createdAt` / `updatedAt` | 创建顺序 = 分组显示顺序 = 换家查找顺序 |

删掉：`provider`、`defaultModelId`。

### 每个 Agent（claude / codex 各一份）

- `enabledEndpointIds`：开关打开的接口（无顺序，界面做开关按钮而非勾选）。空 = 「官方」，CLI 配置按现有逻辑还原。
- `defaultModelId`：**光秃秃的模型名**（不带 slug），从开着的接口勾选模型合并去重后选；写进 CLI 配置做终端新会话的起始模型；Osuna 新建对话优先用记住的上次选择，第一次或上次的模型已不在列表时才用它。开关非空而没选时自动取最早建的开着接口的第一个勾选模型。

### 路由与换家规则（中转站执行，写进 05/06 的实现）

1. 收到 `slug/模型名`（只有 Osuna 会话会发）：走该接口，模型须在它勾选列表里，否则报错给 Agent。
2. 收到光秃秃的模型名（终端 `/model`、hook/statusline 脚本、默认模型）：按创建顺序找这个 Agent 开着的、勾选列表含该名字的第一家；找不到且名字是 Claude 档位名（含 opus/sonnet/haiku/fable），按创建顺序找第一家映射了该档位的接口、换成映射到的模型；仍找不到报错给 Agent。
3. 用尽/欠费/限流/服务器错误：该家进冷却；按创建顺序在其它开着、未暂停、未冷却的接口里找**同名模型**换过去，模型名不变；一家都没有，把原错误原样交给 Agent；全在冷却中同样交错误。换家成功的那轮，时间线加一行「本轮由接口 B 回答」（模型不变，只说换了家）。粘性（Q25）不变。

### 存储与迁移

- 仍用 `$PASEO_HOME/api-endpoints/endpoints.json`，不另建迁移程序。读到旧格式在内存换算：`provider: claude` → `anthropic_messages`，`codex` → `openai_responses`；生成 `slug`；`active[provider] = id` → `agents[provider] = { enabledEndpointIds: [id], defaultModelId: 该接口旧 defaultModelId }`；未启用的旧接口只是保存着、不开关。下次写入按新格式。旧字段读时接受、忽略。
- 文件解析失败照现在：报错、不写、不删。
- 删除接口：从各 Agent 的开关里拿掉；某 Agent 默认模型若只有这家有，改成剩下第一家的第一个勾选模型，一家不剩回官方；确认框写明影响哪些 Agent（样子归 08）。
- 旧文件里存过的「冷却」不存在；`paused` 新增，默认 false。

### 协议（WebSocket RPC）与老客户端

- 现有 `provider.api_endpoint.*` 七组原地扩展，新字段全部可选，不改 RPC 名；新增 `server_info.features.apiEndpointGateway`（名字实现时可调）加 COMPAT 标签，新 App 只在它为 true 时启用新界面，否则提示升级主机。
- 老 App（无新标记）的投影规则，带 COMPAT 标签：`list(provider)` 返回主机上全部接口（`provider` 填请求的那个，`defaultModelId` 填该 Agent 默认模型若在此接口勾选列表里、否则其第一个勾选模型）；`activeEndpointId` = 持有该 Agent 默认模型的开着接口中创建最早的一家，官方时 null；`set_active(id)` = 只开这一家、默认模型取它的第一个勾选模型（若当前默认模型它也有则保留）；`set_active(null)` = 全关回官方；老 `save` 按 provider 推断协议、生成 slug；`delete` 按上面级联。
- 新 App 需要的新增：列表响应里 `endpoints[].protocol / slug / paused` 与 `agent: { enabledEndpointIds, defaultModelId }`；一条设置开关与默认模型的请求；一条暂停/恢复接口（含「立刻恢复」冷却）的请求；`fetch_models` / `test_connection` 请求加可选 `protocol`，缺省按 provider 推断。命名遵守 `docs/rpc-namespacing.md`。
- 会话里记的 `apiEndpointId` 语义交 07 定。

### 对其它票的影响

- **05**（另一会话在做，本票未改其文件）：CLI 配置里写的默认模型是光秃秃的名字；`ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU,FABLE}_MODEL` 不必再写，档位改由中转站按规则 2 翻译；Codex 的 `model_catalog_json` 要同时列出去重后的光秃秃模型名（可见）与各家的 `slug/模型名`（隐藏，供 Osuna 会话用，否则每轮警告，见 01）。
- **06**：换家与路由规则属于发动机实现范围；现有四个 `api-endpoint-*.e2e.test.ts` 的去留并入其测试策略项。
- **07**：时间线提示改为「本轮由接口 B 回答」，模型不变。**已被 07 票推翻**：不加时间线提示；老 App 投影改为长期功能、不打 COMPAT 标签；老客户端模型列表只给光秃秃模型名；不可用接口（已删除 / 已暂停 / 未打开）视同冷却走同名换家。
- **08**：接口开关做开关按钮；Agent 级默认模型下拉只列模型名；接口表单去掉「默认模型」；删除确认框写影响范围。
- `prd.md` 术语节与新增「数据与迁移」节已按本票更新；`research/decisions.md` 追加本轮。

## 修订（08 票，2026-10-14）

本票部分结论被 08 票修订（Agent 总开关 + 接口全局开关取代每 Agent 每家开关；「暂停」并入接口开关；一家接口最多三个格式地址 + 自动检测；迁移与老 App 投影相应调整）。以 `map-issues/08-ui-prototype.md` 的 Answer「数据模型修订」与「对其它票的影响」为准。

> **10 票修订（2026-10-14）**：总开关只在「至少一家接口开着且已选至少一个模型」时允许打开；默认模型失踪规则扩展到关接口开关、关模型小开关，与删除接口同样处理，只在导致回官方时弹确认。以 `prd.md` R-A2、R-A4 为准。
