# 地图：第三方接口自动切换（本地中转站）

## Destination

一份用户确认过的需求文档 `prd.md`，把数据怎么存、本地中转站怎么接、协议怎么转、界面长什么样全部定死，并附一篇决策记录草稿（`docs/adr/`，说明 Agent 改指向本机中转站、部分取代 ADR 0004 的理由）。到此可直接切成实现工单；实现不在本图内。

## Notes

- 领域：Osuna（Paseo 的分支）daemon + Expo 客户端；第三方接口现有实现见 `packages/server/src/server/api-endpoints/`、`packages/protocol/src/api-endpoint/rpc-schemas.ts`、`packages/app/src/api-endpoints/`；现有规则见 `docs/adr/0004-api-endpoint-rewrites-cli-config.md`、`docs/custom-providers.md`、`docs/glossary.md` 的 **API endpoint** 词条。
- 参考项目 magpie（MIT）的调研在 `research/magpie.md`；四轮访谈的决定在 `research/decisions.md`。每个会话先读这两份再选票。
- 总体路线已定（M5 = A）：**用 TypeScript 在 daemon 里重写 magpie 的发动机**，不托管 magpie 二进制。借鉴其设计的文件保留其 MIT 版权与许可声明。
- 访谈票一律同时加载 `atw-interview` 与 `atw-domain-modeling`；用户处于小白模式，所有面向用户的文字用大白话。
- 协议改动遵守 `docs/protocol-compatibility.md`：新字段可选，老客户端能解析。
- 本机不测 CLI 登录（见记忆），调研只读文档与源码。
- **手机端是官方 Paseo App，用户不改也不打包**；一切改动以官方 App 不改一行、照常能用为底线。老 App 投影是长期功能，不是 COMPAT 过渡层（07 票）。

## Decisions so far

<!-- 一张已关闭的票一行：票名 — 一句话结论 -->
- [01 两个 Agent 能不能接受带斜杠的模型名](map-issues/01-slash-model-ids.md) — 都能。Claude Code 不校验模型名、认不出的原样发，`/model` 切换时会向接口探测一次，口令认证下后台小任务跟主模型同名；Codex 也接受，但 Osuna 必须生成模型目录 JSON 写进 `model_catalog_json`，否则列表不含接口模型且每轮警告。中转站要剥掉 Claude 发给非 Claude 上游的 adaptive thinking / effort 字段。详见 `research/slash-model-ids.md`。
- [02 daemon 现有的 HTTP 服务能不能直接挂中转站](map-issues/02-daemon-http-host.md) — 能挂：Host 白名单放行本机 IP、一个监听同时跑 HTTP 与 WebSocket、0600 写法现成；需改四处：口令路由要绕开 daemon 密码中间件并自校验、全局 `express.json()` 100 kb 上限要避开、现有上游请求是整包缓冲须新写流式转发、daemon 换端口没有重写 Agent 配置的钩子（端口真值在 `paseo.pid`）。中继不暴露 HTTP，中转站可达范围等于 daemon 监听范围。详见 `research/daemon-http-host.md`。
- [03 从 magpie 抄出判错词表、冷却常量与协议转换样本清单](map-issues/03-magpie-port-inventory.md) — 已抄齐：18 条判错正则与 19 个失败分类原文、13 个冷却常量与 restAfterMarked / rateRest / passing / quotaHeld 伪代码、粘性 12 步判定与对话识别规则、IR 结构的 TypeScript 接口草稿、三协议五件套签名与 stop/usage 映射表、约 20 个可直接搬的 JSON 夹具加 13 个上游响应样本、MIT 声明。未抄函数体与订阅额度读取。详见 `research/magpie-port-inventory.md`。
- [04 接口怎么存、旧数据怎么迁、老客户端怎么办](map-issues/04-data-model-and-migration.md) — 接口主机共用：名称、自动生成且不露面的标识、地址、协议、勾选模型、Claude 档位映射（任何协议可填）、暂停标记；每个 Agent 一组开关 + 一个光秃秃的默认模型名。**推翻 Q24 兜底名单**：用尽时按创建顺序在开着的接口里找同名模型换家，没有同名就把错误交给 Agent；光秃秃模型名按同一规则路由，`slug/模型名` 只在 Osuna 会话内部用。同一个 `endpoints.json` 读时换算、写时升级；七组 RPC 原地扩展加 `features.apiEndpointGateway`，老 App 保留简化版操作。每家接口的「默认模型」字段去掉。（**08 票修订**：每 Agent 每家开关 → Agent 总开关 + 接口全局开关，「暂停」并入接口开关；单协议 → 一把 key 最多三个格式地址；迁移与老 App 投影随之调整。）
- [05 中转站的对外样子](map-issues/05-gateway-surface.md) — 前缀 `/api-endpoint-gateway`（Codex 加 `/v1`），五条路径；每个 Agent 一个随机口令兼身份，只认本机来源 + 口令；Claude 改写顶层 `model` 不再写 `ANTHROPIC_MODEL`、档位与后台模型交中转站翻译；Codex 口令明文 `experimental_bearer_token`、新增 `model_catalog_json` 指向 Osuna 目录；启动时比对网址重写、socket 模式禁开开关；10 分钟开口超时、流式、「接口名: 原文」包装式报错；不另记用量。
- [06 协议转换第一版做到哪一步、代码放哪](map-issues/06-translation-scope.md) — 能力表照 magpie 逐项定：流式、工具与配对修补、本轮思考实时翻、历史思考只回原厂（DeepSeek 按模型名补回放）、`<think>` 拆解、URL 图片原样转、文件附件完全照 magpie（Anthropic/Responses 丢、Chat 占位）、联网搜索剔除不代搜、结构化输出互转但拒收不重发、三处 `cache_control`。直通只换模型名与认证并做 Responses 配对修补；厂商专属改写与「记住被拒」机制不做。代码放 `api-endpoints/gateway/{protocol,routing}` + 入口，中间格式只在 server，根目录加 `THIRD_PARTY_NOTICES`。单元测试搬 magpie JSON 夹具，端到端起假上游；`models`/`test-connection` 保留加用例，`claude`/`codex` 重写。
- [07 会话恢复时的提示怎么改](map-issues/07-session-mode-mismatch.md) — **不提示**：恢复旧对话不做检查，现有「可能无法继续」黄条与会话记录的 `apiEndpointId` 删除；对话点名的接口已删除 / 已暂停 / 未打开视同冷却，按同名换家规则处理，无路可走时报错由 Agent 自然显示；换家也不加时间线提示，小横条归 08。手机端是官方 Paseo App、长期不改：老 App 投影为长期功能不打 COMPAT 标签，老客户端模型列表只给光秃秃模型名；套餐用量提示新端不点名。会话请求对应办法见 `research/session-request-identity.md`。
- [08 界面](map-issues/08-ui-prototype.md) — 四轮原型后定为 magpie 式三层：设置里**新开「第三方接口」页**（推翻 Q7），列表分已开启 / 已关闭、每家一个全局开关；添加弹窗只填连接（一把 key + 自动检测三种格式地址）；详情页模型区左栏家族目录、右栏模型 + 小开关（不用勾选、默认全关）；Claude Code / Codex 页只剩「使用第三方接口」总开关、默认模型与入口（推翻 04 票每 Agent 每家开关）；不做 composer 小横条。界面细节见 `ui-direction.md`，数据模型修订见本票 Answer。
- [09 决策记录草稿与文档改写清单](map-issues/09-adr-and-doc-rewrites.md) — 草稿在 `adr-draft.md`，定稿为 ADR 0007「接口主机共用、经 daemon 中转站转发」：写明相对 ADR 0004 改了什么（口令代替 key、Codex 口令明文去 `auth.command`、Claude 顶层 `model`、`model_catalog_json`、双开关、会话不记模式）、保留了什么（自有键、原值还原、原子写、外部改动检测等全部文件编辑规则）、六个否决方案与七条后果。文档改写清单 13 项（ADR 0004 标 superseded in part、custom-providers 三处、glossary 词条重写与九个新词、data-model 第 9 节与 `apiEndpointId`、i18n 守卫表、新建 `THIRD_PARTY_NOTICES`）在票内表格，10 票须作为验收项纳入。

- [10 需求文档收口：需求条目、验收标准与用户确认](map-issues/10-prd-requirements-signoff.md) — `prd.md` 定稿：六组 32 条需求 + 32 条验收（含 09 票 13 项文档改写），用户确认可切工单。新定：总开关前提加「已选模型」；默认模型失踪三种操作统一处理、只在回官方时确认；重新拉取保留已勾选；自动检测区分 key 无效；换家写 daemon 日志；旧词不进守卫黑名单；后台小任务不分流。一个任务切工单；真实 CLI 验收由用户做。

## Not yet specified

<!-- 十张票全部关闭，地图到达终点：`prd.md` 已确认，下一步由用户运行 /atw-tickets 切实现工单。 -->

## Out of scope

- 订阅账号轮换（多个 Claude / ChatGPT 登录互切）：涉及改写登录文件与厂商条款边缘，ADR 0004 明确不碰 `auth.json`。
- 同一接口多个 key：用户澄清切换单位是整家接口。
- Pi、OMP 的接线与切换；Gemini 协议；主动读套餐用量提前切换：均为第二期，另起一张图。
- Copilot、OpenCode、Antigravity、Muse；Gemini CLI（Osuna 不支持）。
- magpie 的六种排序策略、路由组、中间件/插件系统、局域网共享、代替厂商联网搜索、并发与频率上限、OTLP 导出。
- 托管 magpie 二进制（M5 的 B 方案）：用户选择自己重写。
- 按接口配置的有序兜底名单（magpie 做法，Q24）：04 票改为自动同名换家、没有同名就报错；第一版不做名单，以后要精细指定再另起。
- `config.json` 手写的自定义提供方（`extends` 条目）：不动。其「换地址并存」用途被本功能覆盖；其余用途（ACP Agent、自定义程序路径、多套启动选项）与本图无关。文档须写明：启用中转站后，`extends: "claude"` 条目里手写的地址会被 settings.json 盖掉而走中转站（M3）。
- magpie 按厂商名的特殊改写（DeepSeek/Mistral/Kimi/MiniMax/Azure/xAI/Copilot/Bedrock/OpenAI）与「记住被拒」重发机制：06 票定为不做，上游拒收把错误交给 Agent；DeepSeek 思考回放是唯一例外，按模型名做。
- 第三方接口上读 PDF 的改进（翻成对方文件格式或中转站自行解析）：06 票选完全照 magpie（Anthropic/Responses 丢弃、Chat 占位文字），有人读出问题再另起。
- 流中断续写（magpie `continuation.go`）：Q16 已定流中断的错误原样交给 Agent。
- 中转站另记转发用量并与 Agent 自报用量去重：05 票定为不做。
- 会话恢复时的模式提示、换家时的时间线提示：07 票定为不做，对用户无感；接口不可用的后果靠换家与 Agent 自然报错。
- 修改官方 Paseo 手机 App：用户只打桌面端包，手机端用上游官方 App，不改不打包。用量页照旧读 CLI 会话记录，价格匹配已能剥掉 `slug/` 前缀。
- composer 上方「当前实际在用」小横条（Q17）：08 票定为不做，与 07 票「对用户无感」一致。
- 按 Agent 精简模型（magpie 的隐藏 / 只用挑选的模型）、预设中转站清单、按模型指定走哪种格式：08 票定为第一版不做，以后需要再另起。
