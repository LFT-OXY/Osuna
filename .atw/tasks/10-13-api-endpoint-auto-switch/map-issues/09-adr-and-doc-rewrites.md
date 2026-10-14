# 09 — 决策记录草稿与文档改写清单

Type: task
Status: resolved
Blocked by: 08

## Question

终点要求附一篇决策记录草稿。按 `atw-domain-modeling` 的 ADR 写法起草 `docs/adr/` 新 ADR（编号接现有最大号），说明：Agent 配置改指向 daemon 内置中转站（挂 daemon HTTP、口令代替真实 key、Claude 写顶层 `model`、Codex 口令明文 `experimental_bearer_token` 与 `model_catalog_json`）、第三方接口改为主机共用并单独成页、一家接口多格式地址与每次请求挑格式、部分取代 ADR 0004 的哪些条目。草稿放任务目录 `adr-draft.md`，不直接改 `docs/adr/`。

同时列出实现时要改写的文档清单（每项写明改哪一节、为什么）：ADR 0004、`docs/custom-providers.md`「While an API endpoint is active」一节（含 M3：`extends: "claude"` 手写地址会被中转站盖掉）、`docs/glossary.md` 的 **API endpoint** 词条与 prd 术语节的新词、`docs/i18n.md` 守卫涉及的新文案键、`THIRD_PARTY_NOTICES`（magpie MIT，含借用的厂商图标）。

## Answer

任务型票，由代理独立完成（2026-10-14）。决策记录草稿已写在任务目录 `adr-draft.md`，未动 `docs/adr/`。

### 决策记录草稿要点

- 文件名定为 `docs/adr/0007-api-endpoints-route-through-daemon-gateway.md`（现有最大号 0006；0001 与 0004 各有两份重号文件，不沿用这个毛病）。
- 结构照 ADR 0004：首段讲「接口改为主机共用、CLI 只指向 daemon 中转站、口令代替真实 key、中转站挑家 / 换家 / 翻译协议、用 TypeScript 重写 magpie 而不托管二进制」及原因；随后两节分别列「相对 ADR 0004 改了什么」（口令与网址是 daemon 的、Codex 口令明文去掉 `auth.command` 与版本检查、Claude 写顶层 `model` 不写 `ANTHROPIC_MODEL` 与档位变量、Codex 加 `model_catalog_json`、总开关 + 接口开关取代「当前启用」、会话不再记模式）与「中转站新增的规则」（挂现有 HTTP 服务、启动比对网址重写、首字前同名换家与内存冷却、每次请求挑格式、翻译范围、报错包装）。
- 明确写出 **ADR 0004 哪些规则保留**：只写自有键、记录与还原原值、原子写、解析失败不写、改名前重读、外部改动检测、WebSearch deny、`jsonc-parser` 与 TOML 节点拼接、专用表 `osuna_api_endpoint`。ADR 0007 只取代 0004 里「这些键写什么」的条目。
- Considered Options 六条：按接口配兜底名单、托管 magpie、单开端口、保留 `auth.command`、中转站另记用量、改官方手机 App；均写明否决理由（来源：M5、Q24、02/05 票、07 票）。
- Consequences 七条：`extends: "claude"` 自带地址被盖掉（M3）、总开关关掉后旧对话报「模型不存在」、daemon 不跑 CLI 就不通、档位映射须逐家配置、目录文件须随变化重生成、老客户端只见光秃秃模型名、借鉴文件保留 MIT 声明。

### 实现时要改写的文档清单

| 文档 | 改哪里 | 改成什么 / 为什么 |
|---|---|---|
| `docs/adr/0004-api-endpoint-rewrites-cli-config.md` | 文首加 status 行；正文中 Codex `auth.command` 与 0.118 版本检查条、Claude 四个 env 键条、`ANTHROPIC_DEFAULT_*` 条；Consequences 的「记录会话创建时模式以便警告」「版本检查只覆盖 Osuna 跑的 codex」两条 | 标 `superseded in part by ADR 0007`，被取代的条目各加一句指向 0007；两条 Consequences 删除（07 票删掉模式记录；版本检查不再有）。其余规则原文保留，0007 只链接不重述 |
| `docs/custom-providers.md` 第 108 行与「While an API endpoint is active」一节 | 整节重写 | Claude：总开关打开时 `settings.json` `env` 指向中转站，所有 `extends: "claude"` 的自定义提供方不管自己的 `env` 写什么都走中转站（M3），模型列表仍由其自己的 `models` 决定、须是某家开着接口已选的模型；档位名由中转站翻译；WebSearch deny 照旧。Codex：带 `OPENAI_BASE_URL` 的仍走自己的地址，不带的跟顶层 `model_provider` 走中转站。「切换确认框计数运行中的会话」一句删除（不再有切换确认框，改为开关）。「Its row in the provider list says which endpoint it goes through」改为「says it goes through the gateway」 |
| `docs/custom-providers.md` 第 754 行「Claude settings.json model discovery」末段 | 一句话 | 「总开关打开时该提供方的模型列表是所有开着接口的已选模型（按接口分组）；关掉后 settings.json 发现、`models`、`additionalModels` 回来」。另：`ANTHROPIC_MODEL` 不再由 Osuna 写入，发现逻辑读的是用户自己写的值，不必改 |
| `docs/custom-providers.md` 第 208 行「### API endpoints」（Alibaba 段） | 标题与表头 | 这一节讲的是阿里云的两个地址，与本功能「API endpoint」同名易混；标题改「Base URLs」，并补一句「用作第三方接口时把地址填进 Anthropic 格式地址栏」 |
| `docs/glossary.md` **API endpoint** 词条 | 重写 | 定义改为「整台主机共用的第三方连接：名称、一把 key、最多三个格式地址、已选模型、Claude 档位映射、接口开关；不按提供方归属、没有自己的默认模型」。UI 改为「设置 › 第三方接口」页，提供方页只剩「使用第三方接口」总开关与默认模型；「In use / 使用中」「Paused / 已暂停」退役；「mode」用法删除。zh-CN 保留「第三方接口」「官方」 |
| `docs/glossary.md` 新词条 | 新增 | **Gateway**（中转站，daemon 内置、不在 UI 显示，zh-CN「中转站」，禁用「代理」「中继」）、**Endpoint switch**（接口开关）、**Use API endpoints**（使用第三方接口，提供方总开关）、**Default model**（默认模型，光秃秃模型名）、**Request format**（请求格式：Anthropic / OpenAI Chat / OpenAI Responses）、**Model family**（模型家族）、状态词 **Available / Cooling down / Needs attention / Off**（可用 / 冷却中 / 需要检查 / 已关闭）、**Failover**（自动切换）。以 `prd.md` 术语节为准，英文 UI 标签实现时定 |
| `docs/glossary.md` **Custom provider** 词条 | 一句 | 「Don't confuse with API endpoint, which switches a built-in provider itself」改为「which routes a built-in provider through the gateway」 |
| `docs/data-model.md` 第 9 节「API endpoints」 | 整表重写 | `endpoints.json` 新形状（`slug`、三个格式地址、`enabled`、无 `provider` / `defaultModelId` / `active`，加 `agents: { claude, codex: { enabled, defaultModelId } }`）、旧格式读时换算一句；`takeover-codex.json` 去掉 `codex-api-key` 行，加 `model_catalog_json` 键；新增 `gateway-tokens.json`（口令，0600）、`codex-models.json`（目录）两行；`takeover-*.json` 加「写入的中转站网址」字段 |
| `docs/data-model.md` 第 121 行 `apiEndpointId` | 删行 | 07 票删掉该字段；协议里 `apiEndpointModeMismatch` 保留不发，可在 protocol-compatibility 相关处不提 |
| `docs/i18n.md`「Adding Copy」 | 不改正文，改守卫 | `resources.test.ts`：`zhCNRetiredTermPattern` 加「使用中」「已暂停」（仅当这两个词在别处没有合法含义；`pausedStopFailed` 等已有「已暂停」用法，若保留则不加入模式、改为删掉旧键即可）；`zhCNEnglishAllowlist` 可能需要加 `API key`、`Anthropic`、`OpenAI Chat`、`OpenAI Responses`、家族名 `GPT` / `Gemini` / `DeepSeek` / `Kimi` / `GLM` 等品牌类键；删除的旧键（`inUse`、`deleteActiveMessage`、`saveActiveMessage`、`codexVersionUnsupported`、五条 `endpointToOfficial` 类提示、`zhCNRetiredTermExemptKeys` 里的 `codexProfileOverride` 若不再有）一并从八个语言资源与守卫表移除 |
| `THIRD_PARTY_NOTICES`（根目录新建） | 新建 | 根 `LICENSE` 已声明「第三方组件按各自许可」，但没有清单；新建文件列 magpie（MIT，Copyright (c) 2026 yetone，仓库地址）：借鉴其 `internal/gateway/` 设计的 TypeScript 文件、搬来的 JSON 测试夹具、`internal/gui/assets/icons/` 的厂商图标。借鉴的源文件头写 MIT 短式并指向此文件 |
| `docs/protocol-compatibility.md` | 不改正文 | 只核对：`features.apiEndpointGateway` 的 COMPAT 标签打在 App 端能力门控处；老 App 投影不打 COMPAT（07 票）。若该文档有 feature 标记清单则加一行 |
| `CLAUDE.md` 文档表 | 不加行 | 本功能不新增主题文档；中转站网址、口令与排错写进 `docs/custom-providers.md` 或 `docs/data-model.md`，不另立 |

### 对其它票的影响

- **10**：需求与验收条目须把上表作为「文档改写」验收项逐条纳入（ADR 0007 落盘、ADR 0004 标 superseded、词条、数据模型表、守卫表、THIRD_PARTY_NOTICES）。
