# 差距清单 · 服务商、账号订阅与插件

范围：magpie 的 provider（预设、表单字段、多 key、检测与测试、拉取与挑选模型、模型设置、余额与额度、导入）、Google Vertex AI、订阅当 provider 与多账号、插件与网关中间件。
由子代理通读两边源码得出（2026-10-16）：magpie HEAD `7597c132`，Osuna HEAD `21a4f721d`。引用为各自仓库内的 `文件:行号`；文中的「你」指派活的主会话。只记事实，不做取舍。

---

## 1. 功能清单

**范围说明**

- 价格相关（每模型价格、价格倍率、插件价格、按地址取价格目录）和用量展示归另一位助手，表里不列。
- 「Connecting anything else」一节有不少中转站功能（路由、`X-Magpie-*` 头、`/v1/models` 字段），表里也列了，和 gap-gateway 可能重复，汇总时需要去重。

**路径缩写**（都换算成绝对路径）

- magpie 根目录 `M/` = `/Users/oxy/Documents/Configuration/dev-environment/demo/agent客户端源码/magpie/`
  - `ref` = M/docs/reference.md
  - `pa` / `pp` / `prt` / `pt` / `gm` / `csb` = M/docs/subsystems/ 下的 providers-accounts / provider-plugins / plugin-runtime / plugin-tools / gateway-middleware / claude-subscription-bridge .md
  - `app` = M/internal/gui/assets/app.js；`plg` = M/internal/gui/assets/plugins.js
  - `prov/` = M/internal/provider/；`RZ` = M/README.zh-CN.md；`sp` = M/site/public/docs/plugins.html
- Osuna 根目录 `O/` = `/Users/oxy/.paseo/worktrees/0x9u2djy/curvy-bullfrog/`
  - `S/` = O/packages/server/src/server/api-endpoints/
  - `A/` = O/packages/app/src/api-endpoints/
  - `P` = O/packages/protocol/src/api-endpoint/rpc-schemas.ts
  - `PL/` = O/packages/server/src/server/plugins/
  - `d/` = O/docs/；`pd` = O/public-docs/plugins/reference.md
  - `PPG` = O/packages/app/src/screens/settings/plugins-page.tsx
- 上一轮归档 = O/.atw/tasks/archive/2026-10/10-13-api-endpoint-auto-switch/ 下的 `map`、`prd`、`ui`（ui-direction.md）、`mg`（research/magpie.md）

**判「没有」时用到的搜索**（`rg -i`，都不含测试文件）

- **搜1**：在 `S/` `A/` `P` 搜 proxy、headers、extraBody、user-agent、insecure、rejectUnauthorized、balance、weight、rename、images、alias、preset、gemini、vertex、ollama、reorder、arrange、drag、search、curl、onPaste。
  - 只命中这几类：判错词表（S/gateway/failure.ts）、中转站内部响应头、中转站判断请求里有没有图片（S/gateway/affinity.ts:179,191）、家族名 gemini（A/internal/model-families.ts:37）、写文件用的 renameSync。
  - 都不是对应的用户功能。接口字段全集见 S/store.ts:47-69。
- **搜2**：在 O/packages/server/src、app/src、protocol/src、O/plugins 搜 switchAccount、account switch、logins.json、startSignIn、device code、oauth/authorize、refresh_token、warm up、预热、check in、签到。
  - 只命中 kimi、minimax 套餐用量源里只读解析的 refresh_token 字段（O/plugins/kimi-usage-source/server/usage.ts:244、minimax…/usage.ts:59），以及无关的 warmUpSnapshot。
- **搜3**：在 `PL/` `S/` O/packages/plugin/src 搜 onRequest、onEvent、onResponse、middleware、bun、login、sign in、mirror。
  - onEvent 只是 Agent 连接事件（PL/runtime.ts:970）；login 只出现在套餐用量源的注释里（O/packages/plugin/src/server/usage.ts:61,85）。
- **搜4**：在 `S/` `A/` `P` O/packages/desktop/src 搜 cc-switch、alma、importFrom、import link、magpie://、osuna://、deeplink。
  - 只有 S/claude-settings-patch.ts:11 的注释；桌面端只有打开 Agent 的 `paseo://h/<主机>/agent/<id>`（O/packages/protocol/src/agent-deep-link.ts:27-29）。
- **搜5**：在 O/packages/server/src 搜 https_proxy、http_proxy、ProxyAgent、EnvHttpProxyAgent、setGlobalDispatcher、socks。
  - 只命中传给 CLI 的选项（…/agent/providers/codex/options.ts:25-27、…/claude/options.ts:23）；中转站用 node:http/https 直连（S/gateway/upstream-call.ts:1-2）。
- **搜6**：在 O/packages/cli/src 搜 apiEndpoint，无命中；commands/provider/ 只有 ls、models、diagnostic。
- **搜7**：在 O/packages 搜 summary.json、statuspage、status.claude、status.openai，只命中测试产物的文件名。

### A. provider 本身

| 编号 | magpie 功能 | magpie 出处 | Osuna 现状 | Osuna 证据 | 差在哪 | 上一轮的态度 |
|---|---|---|---|---|---|---|
| A01 | 从预设里挑 provider：分「厂商 / 中转站 / 本机 / 另一台电脑的 magpie」，另有赞助、订阅、插件、已移除四组；可搜索；国际站和中国站合成一行再选（清单见表后） | prov/presets.go:12-20,113-577；app:6970-7130 | 没有 | 搜1 无 preset；添加弹窗只有名称、key、地址、三种格式地址（A/connection-form-sheet.tsx:109-189）；d/custom-providers.md:120-243 只有 Z.AI、阿里云两篇手写 config.json 的说明，走自定义提供方 | — | 明确不做：map:53「预设中转站清单：08 票定为第一版不做」 |
| A02 | 选预设后只贴 key：地址、models.dev id、官网和「Get a key ↗」都内置，链接跟着所选套餐变 | ref:236-238；app:9124-9135 | 没有 | 同 A01 | — | 同 A01 |
| A03 | 预设的区域/套餐切换（如智谱按量/Coding Plan、方舟 Coding/Agent/按量、千帆个人/企业、Bedrock 十个区域），一换就是整套地址 | presets.go:66-96；app:9382-9411 | 没有 | 同 A01 | — | 同 A01 |
| A04 | 同一预设再加一个（Add another：换 key 或换工作区，名称和 ID 自动避让） | app:9566-9572,8776-8784 | 没有 | 只有「+」新建（A/host-list-section.tsx:60-70） | — | 没提到 |
| A05 | Duplicate：复制一个 provider 当新的起点（地址、key、头、模型、余额设置都带上） | app:9573-9578；pa:202 | 没有 | 同 A04 | — | 没提到 |
| A06 | 自定义 provider：名称加一个 Base URL，并标明它是哪种 API（OpenAI chat / 只有 Responses / Anthropic / Gemini / 决策 API）；切 API 时把已填地址改成那种写法 | app:8829-8899；ref:255-259 | 部分 | 一个地址框 + 三个格式地址框，靠「自动检测」填（A/connection-form-sheet.tsx:138-189）；粘进来的完整接口地址会剪成 base（S/upstream-detect.ts:75-91） | 没有 Gemini 和决策 API；不能指定这个地址是哪种 | 已做：prd R-E2 |
| A07 | 一家同时填四种地址（chat/responses/anthropic/gemini），另可填 Models URL | app:9481-9510；prov/provider.go:83-98,346 | 部分 | 三种格式、每种最多一个（P:55-59；S/store.ts:52-53）；列模型固定先试 `<base>/v1/models` 再试 `<base>/models`（S/upstream-models.ts:66） | 缺 Gemini 地址和自定义 Models URL | Gemini 明确不做：map:40「…Gemini 协议…均为第二期」；Models URL 没提到 |
| A08 | Detect APIs：用表单当前（未保存）的地址和 key，向每种 API 发最小请求；可指定试哪个模型；逐行显示耗时或错误；「Use these」一键采用 | app:10346-10440；prov/detect.go:43；pa:54 | 部分 | 先列一次模型挑人选，再三种格式各发一条；能区分 key 无效；可取消（S/upstream-detect.ts:94-221；S/service.ts:995-1012） | 不测 Gemini；不能指定试用模型；列不出模型时三种都判「未检测到」（S/upstream-detect.ts:111-131） | 已做：prd R-A5 |
| A09 | Each picked model：已选模型（最多 30 个）逐个在每种 API 上试，可把只通一种的模型钉到那种 API | app:10332-10346 | 没有 | 检测只按格式、不按模型（搜1） | — | 明确不做：map:53「按模型指定走哪种格式」 |
| A10 | 往 Base URL 或 key 框粘贴厂商文档里的 curl 命令，自动认出 API 和 base、取出 key（`$OPENAI_API_KEY` 这类占位符不算）、把 body 里的 model 加进来，并提示还没替换的占位 | app:9073-9094,14451；pa:55 | 没有 | 搜1 无 curl、onPaste | — | 没提到 |
| A11 | 一次贴多把 key（换行、逗号、空格分隔）；「Paste several」批量加 | app:9063-9072,9095-9104,14061 | 没有 | 一家一把 key（S/store.ts:115；A/connection-form-sheet.tsx:119-137） | — | 明确不做：map:39「同一接口多个 key：用户澄清切换单位是整家接口」 |
| A12 | 多 key 管理：命名、开关、Make first、原地换值（名字和设置保留）、复制、删除、看 SHA-256 指纹 | app:13845-14075；prov/keys.go:22-34,146,561 | 没有 | 同 A11 | — | 同 A11 |
| A13 | 每把 key 只用于某一种协议；没那种协议的地址时标「No {api} URL」 | keys.go:28-30；pa:30 | 没有 | 同 A11 | — | 同 A11 |
| A14 | 每把 key 的权重 | keys.go:31-33 | 没有 | 同 A11 | — | 同 A11；map:42 排序策略不做 |
| A15 | key 行显示「Resting · 原因 · 几点恢复」，可「Try now」立即结束冷却 | app:13923-13928 | 部分 | 整家接口冷却：列表行「冷却中」+「立刻恢复」（A/host-list-section.tsx:258-272；S/service.ts:524-537） | 没有按 key 的冷却 | 已做（按整家）：prd R-B9、R-E1 |
| A16 | key 很多时：超 8 把折叠，可按名称/key/关/冷却筛选，可批量删关着的或失败的；上千把 key 不卡（10-16） | app:14089-14176；pa:30 | 没有 | 同 A11 | — | 同 A11 |
| A17 | 多 key/多账号怎么分请求：Smart、按顺序、轮流、用得少优先、按周配速、按权重；还有粘性（Stays）和限流沉底（Sink） | app:11432-11500；ref:1414-1468 | 没有 | 只有整家接口按创建顺序同名换家（prd R-B7、R-B8） | — | 明确不做：map:42「magpie 的六种排序策略…」 |
| A18 | Show：读回已存 key 的原文 | app:9106-9122 | 没有 | 只显示打码（A/connection-section.tsx:91-93）；编辑时留空即不改（A/internal/connection-form-model.ts:13） | — | 没提到 |
| A19 | key 只存在自己的 0600 文件里，从不读 shell 环境变量 | ref:60-61；app:9161 | 有 | keys.json 0600，只有 daemon 读（S/store.ts:21-31）；响应只带 hasApiKey（P:5-6） | — | 已做：prd R-B2 |
| A20 | 自定义请求头（预设还会提示可加的头，如 anthropic-workspace-id）；anthropic-beta 是追加合并，被厂商拒的 beta 以后自动去掉 | ref:267-277；app:7941,9169-9175 | 没有 | 搜1：没有用户可配的请求头 | — | 自定义头没提到；「被拒的 beta 以后去掉」属「记住被拒」，明确不做：map:46 |
| A21 | Extra body：一段 JSON 加到每个请求体顶层（`!name` 覆盖；`${sessionId}` 换成会话 id；保留字段拒收） | pa:24；app:8036,9177 | 没有 | 搜1 无 extraBody | — | 没提到 |
| A22 | Key header：第三方 Anthropic 地址的 key 放两个头、只放 x-api-key 或只放 Bearer；碰到「两个头不能同时存在」的 401 自动换并记住 | pa:21；app:9201-9220 | 部分 | 固定两个头都带（S/upstream-detect.ts:41-45；prd R-B12） | 不能选；不会自动改用单个头 | 自动改单头属「记住被拒」重发，明确不做：map:46 |
| A23 | 「Send the agent's own User-Agent」：把 Agent 发来的 UA 原样转给只服务指定 Agent 的套餐 | ref:279-290；app:9221-9234 | 没有 | 搜1 无 user-agent | — | 没提到 |
| A24 | 不校验证书：只对这家自己的 https 主机（自签证书或公司 CA）（10-15） | pa:202；app:9249-9264 | 没有 | 搜1 无 insecure、rejectUnauthorized | — | 没提到 |
| A25 | 本机或局域网模型「Send requests unmasked」：不做隐私脱敏 | app:9236-9248 | 不适用 | Osuna 中转站没有隐私脱敏（见 E20） | 豁免开关没有作用对象 | 没提到 |
| A26 | 「Searches the web by itself」：把 WebSearch、web_search 原样交给自带搜索的中转站 | app:9187-9200；prov/provider.go:219 | 没有 | 翻译时剔掉服务端工具，Claude Code 写 WebSearch deny（prd R-C4、R-B3） | 不能对某家放开联网搜索 | prd:228「代替厂商联网搜索」不做；放行没提到 |
| A27 | 代理：每家选全局/直连/自定义，每把 key、每个账号可单独设；Settings › Proxy 有 Test；没设时读 *_PROXY 和系统代理 | app:7502-7522,7799-7830,20025；M/internal/netproxy/netproxy.go:1-12；RZ:130 | 没有 | 搜5；拉模型用全局 fetch（S/upstream-models.ts:112） | — | 没提到 |
| A28 | 并发、排队、每分钟请求数上限（按家、按账号） | prov/provider.go:154-173；app:7530-7567 | 没有 | 搜1 | — | 明确不做：map:42「并发与频率上限」 |
| A29 | Fallback 兜底「provider/model」名单 | app:11501；ref:1392 | 没有 | — | — | 明确不做：map:44「按接口配置的有序兜底名单…」 |
| A30 | 按家调冷却时长：quota-rest（含 `until 08:00` 每天定时恢复）、rest-cap（`off` 即不冷却） | ref:1493-1515 | 没有 | 冷却常量全局固定（prd R-B9） | — | 没提到（R-B9 定为照 magpie 常量） |
| A31 | 本机服务预设（Ollama、LM Studio、oMLX、MLX-Serve）：key 可不填；Server address 只换协议、主机、端口 | presets.go:555-575；prov/local_address.go:19；app:9022-9056 | 部分 | 可以手填 http 本机地址（A/internal/connection-form-model.ts:303），但 key 必填（同文件 :127,158-159；S/service.ts:393-396） | 没有预设；本地服务要随便填个 key | 没提到 |
| A32 | Azure OpenAI：填自己资源的 endpoint，部署名由 key 自动列出 | presets.go:396-401；app:9013-9020,9399-9402 | 没有 | 同 A01 | — | 同 A01 |
| A33 | Bedrock：选区域；没有 /models，用内置清单 | presets.go:378-395；pa:214 | 没有 | 同 A01 | — | 同 A01 |
| A34 | 决策 API（Jev、百炼/通义决策模型）只给路由组当分类器；百炼要填 Workspace ID | presets.go:520-553；app:9434-9460 | 没有 | 没有路由组 | — | 明确不做：map:42「路由组」 |
| A35 | 自定义 provider 选图标；预设用品牌图标 | app:8109,9165 | 没有 | 列表头像是名称首字（A/host-list-section.tsx:247-249） | — | ui:36「名称首字，实现可换成图标」 |
| A36 | 改名（预设加的也能改，10-15）、改 ID（Agent 和路由组跟着搬） | app:8786-8803 | 部分 | 名称能改（A/connection-form-sheet.tsx:109-118）；标识自动生成、锁定（S/store.ts:49-50） | 不能改标识 | 标识明确不做：prd:227 |
| A37 | 启停开关：关了保留设置，Agent 拿不到它的模型；网关会回「它关了」 | app:5921-5952；pa:211 | 有 | 接口开关和「已关闭」组（A/host-list-section.tsx:277-285；A/internal/host-list.ts:62-63；S/service.ts:524-537） | 点名关着的接口时按同名换家或 404，没有「它关了」的专门报错 | 已做：prd R-E1、R-A4 |
| A38 | 删除；它的模型离开目录，用它的 Agent 被挪走 | app:9562-9565；pa:213 | 有 | 删前确认，写明影响和新的默认模型（A/use-endpoint-detail.ts:278-290；S/service.ts:440-452） | — | 已做：prd R-A4 |
| A39 | 排序：拖图标、Alt+↑↓、右键移到顶/底；顺序决定同名模型先问哪家 | app:5755-5830,5885-5918；ref:1709-1712 | 没有 | 顺序即创建顺序（S/store.ts:73）；搜1 无 reorder、drag | 换家顺序不能调 | 没提到（prd R-B7 定为按创建顺序） |
| A40 | 搜索 provider：按名称、id、地址、模型、账号、key 名 | app:5827-5884 | 没有 | 搜1 | — | 没提到 |
| A41 | 列表行显示哪些 Agent 在用（点一下改模型）、key 掩码或套餐名、模型数 | app:5668-5720 | 部分 | 行里是格式 · 主机 · 已选数 · 状态（A/host-list-section.tsx:336-346）；Agent 页有汇总入口（A/agent-section.tsx:207-215） | 不显示谁在用、不显示 key 掩码 | 已做：prd R-E1 |
| A42 | 厂商状态页：Anthropic、OpenAI 等官方状态页说 API 降级时，在对应 provider 上标出来 | M/internal/upstream/upstream.go:1-12,43-60；app:5580 | 没有 | 搜7 | — | 没提到 |
| A43 | 配置文件读不出时报错、不当成空；有 .bak 回退；跨进程加锁 | pa:205-209 | 部分 | 读不懂就报错、什么都不写（S/store.ts:104-113,166-194） | 没有 .bak 回退，没有跨进程锁 | 已做：prd R-A3 |
| A44 | Test：每个地址发一个最小请求，显示耗时或「状态码 · 原因」；表单没保存也能测 | app:10211-10243；ref:248 | 部分 | 按格式各测一次，显示毫秒，key 无效单独提示（S/service.ts:922-963；A/connection-section.tsx:108-125） | 只能在保存后的详情页测 | 已做：prd R-E3 |
| A45 | 拉取模型：添加时就能用填好的 key 拉来挑（不保存）；之后「Fetch models again」；「Forget」丢掉拉回的清单 | app:10276-10345,11255-11275,11326-11337 | 部分 | 保存后进详情页自动拉一次，按格式依次试，第一个成功即止（A/use-endpoint-detail.ts:114-151）；有「重新拉取」和拉取时间（A/models-section.tsx:107-128） | 添加时不能先拉；没有 Forget | 已做：prd R-E3 |
| A46 | 多协议 provider 的模型清单合并各地址的结果（10-13） | 提交 12d82321 | 没有 | 只留第一个拉成功的格式的清单（A/use-endpoint-detail.ts:119-139） | — | 没提到 |
| A47 | 定时拉清单（refresh-every）+ 新模型按 glob/正则规则自动纳入（10-14，只有 CLI） | ref:246-247；pa:29；prov/autolist.go:239 | 没有 | 只在首次打开详情页和手点时拉（A/use-endpoint-detail.ts:146-151） | — | 没提到 |
| A48 | 模型服务范围三选一：跟随厂商清单（不选＝前 24 个，含以后新出的）/ 只用挑的 / 只看用量（10-14） | app:11150-11180；pa:28 | 部分 | 只有「挑选」，默认全关，只路由已选（S/store.ts:54,62-64） | 没有「跟随厂商清单」和「只看用量」 | 已做（默认全关）：prd R-E3 |
| A49 | 挑模型：Select all/none、Free only、Working only（去掉测试失败的）、筛选、超 80 个折叠、展开/收起 | app:10760-10800,11181-11240 | 部分 | 左家族右模型两栏、小开关、每组全选/全不选、搜索（A/models-section.tsx:188-205,320-393） | 没有 Free only、Working only | 已做：prd R-E3 |
| A50 | 模型 chip 上的小标：免费、倍率、上下文 | app:10780-10800 | 没有 | 模型行只有 id、「上游清单里没有了」和开关（A/models-section.tsx:356-393） | — | 没提到 |
| A51 | 手动加模型 id（逗号分隔可加多个） | app:11241-11258 | 有 | 「手动添加」（A/models-section.tsx:418-470；S/store.ts:65-66） | 一次只能加一个 | 已做：prd R-E3 |
| A52 | 重新拉取时：厂商不再列的已选模型去掉，手加的保留；原来是全选的，新模型自动选上 | app:11255-11275；pa:28 | 部分（形态不同） | 已选的全保留，上游没了的标「上游清单里没有了」，新模型以关着状态加入（A/models-section.tsx:375-383） | 没有「全选时新模型自动选上」 | 已做：prd R-E3 |
| A53 | 测模型：Test models 逐个测（红绿点、经哪种 API、耗时）；右键只测一个；Test as Codex / as Claude Code | app:10565-10575,10620-10700,11276-11320 | 没有 | 测试连接只挑一个模型试（S/upstream-detect.ts:213） | — | 没提到 |
| A54 | 模型右键：复制 ID；指定只走某种 API；标成图片/视频模型（10-13） | app:10650-10700 | 没有 | 模型名能选中复制（A/models-section.tsx:366-373），没有别的设置 | — | 按模型指定格式明确不做：map:53；其余没提到 |
| A55 | Names & levels：给模型改显示名，各处生效；Restore default | app:10838-10890,11109-11120；prov/modelprefs.go:487-501 | 没有 | 显示名只取上游列表的 display_name 或 name（S/upstream-models.ts:148-152） | — | 没提到 |
| A56 | 模型名后加「· provider」的显示方式（on / own / off） | app:10850-10860；M/internal/cli/model_cli.go:64-68 | 部分（形态不同） | 选择器按接口分组（prd R-E5）；`/model` 的说明是接口名（prd R-B3） | 不能选显示方式 | 已做：prd R-E5 |
| A57 | Same as：声明某 id 和别家的某模型是同一个，用于同名并组 | app:10891-10912 | 没有 | 同名只比模型名字面（prd R-B7） | 写法不同的同一模型不能换家 | 没提到 |
| A58 | 推理档位：只给其中几档；一档不勾就不发推理字段（10-14）；档位未知的能手勾 | app:11058-11108；model_cli.go:22-25 | 部分 | 档位自动得知，只告诉 Claude Code（S/claude-model-hints.ts:83-106）；Codex 目录固定四档（S/codex-model-catalog.ts:25-30） | 用户不能改 | 已做（自动）：prd R-B3、R-B4 |
| A59 | Accepts images：告诉 Agent 这个模型能不能看图 | app:11043-11053 | 没有 | 搜1；Codex 目录条目没有 input_modalities（S/codex-model-catalog.ts:83-106） | — | 没提到 |
| A60 | 上下文窗口和回复上限可手填（可对整家 `provider/*` 填）；按「模型 → 整家 → 厂商清单 → models.dev」的顺序取；写进各 Agent 的模型文件；补 max_tokens | ref:1140-1179；app:9412-9420,9730-9760 | 部分 | 自动得知后写给 Claude Code（`[1m]` 和两个环境变量，S/claude-model-hints.ts:11-15,46-73）；Codex 固定 272K（S/codex-model-catalog.ts:103-104） | 不能手填；Codex 不按模型区分 | 已做（自动）：prd R-B3 |
| A61 | Compact at：设 Codex、Claude Code 在多少 token 时压缩对话 | app:9790-9815 | 没有 | 搜1 | — | 没提到 |
| A62 | 上游名（wire）：发给厂商时用另一个名字，支持 `relay/*` 模板；目录和记账仍用原名 | ref:1181-1245；model_cli.go:47-55 | 没有 | 只把 `slug/模型名` 剥成模型名发出（prd R-B7、R-C5） | — | 没提到 |
| A63 | models.dev 补全：显示名、推理档位、没有列表的厂商的模型清单；可指定多个 catalog id；过期自动刷新 | ref:62-71；M/internal/catalog/catalog.go:1-3 | 部分 | 只取上下文、回复上限、档位三项，只给 Claude Code 用，并且要两个开关都开才下载（S/models-dev.ts:16-19；d/usage.md:122-150） | 不补名字，不补清单 | 已做（三项）：prd R-B3 |
| A64 | 显示名优先用厂商给的，models.dev 补缺，撞名时保留 id（10-13） | pa:130-141 | 部分 | 只用上游给的名字（S/upstream-models.ts:148-152） | 没有补名和防撞名 | 没提到 |
| A65 | 厂商说模型已下线（如 410），这家的这个模型从列表里拿掉一周 | ref:261-265 | 部分 | 只在中转站里冷却这个模型（S/gateway/failure.ts:52-53,153-158；cooldown.ts:276-283） | 不从列表拿掉 | 没提到 |
| A66 | `magpie model disable '<glob>'`：全局禁用模型，网关回 403 | model_cli.go:57-63 | 没有 | 只能按接口关模型 | — | 没提到 |
| A67 | 每个 Agent 自己的模型清单：单独隐藏某模型；「Only models I pick」 | ref:72-80 | 没有 | — | — | 明确不做：map:53「按 Agent 精简模型…第一版不做」 |
| A68 | Only through routing groups：模型只给路由组用，不进 Agent 清单 | app:11338-11348 | 没有 | 没有路由组 | — | 明确不做：map:42 |
| A69 | 图片/视频模型单独列出，在 Settings → Images 里选 | app:11360 | 没有 | 搜1 | — | 没提到 |
| A70 | 已知厂商的余额自动查：DeepSeek、Kimi、OpenRouter、SiliconFlow、StepFun、Command Code、Ollama Cloud、AiHubMix | prov/balance.go:1-8,56-78 | 没有 | 搜1；套餐用量源只读 Agent 自己的登录或环境变量（如 O/plugins/kimi-usage-source/server/usage.ts:308-320），不读第三方接口里存的 key | — | 没提到；主动读用量属第二期：map:40 |
| A71 | 自定义余额：Balance URL（GET 或 POST，10-15）+ 取值表达式（四则运算、%、多项、列表 sum/max，10-14）+ Check balance | app:9511-9560；pa:49 | 没有 | 同 A70 | — | 同 A70 |
| A72 | 账户级余额 token（new-api 系统令牌、sub2api 登录 token） | app:9265-9302 | 没有 | 同 A70 | — | 同 A70 |
| A73 | 套餐 key 的额度窗口（Kimi Code、GLM Coding Plan、MiniMax、OpenCode Go、Command Code、Ollama Cloud、sub2api），既显示也用于选路 | pa:49；prov/planquota.go:42-60 | 部分 | 内置 Kimi、MiniMax、OpenCode Go、Z.ai 用量源（PL/builtin/index.ts:5-17），只显示 | 不读接口里的 key，不参与换家 | 同 A70 |
| A74 | 要额外凭据才读得到的额度：火山方舟（AccessKey）、腾讯云企业版（SecretId/Key）、阶跃 Step Plan（平台登录）、智谱团队（org/project ID） | app:9303-9378；pa:217-218 | 没有 | 搜1 | — | 同 A70 |
| A75 | 厂商专属修正：GLM Coding Plan 的 key 填错地址时改问套餐地址并迁移（10-13）；智谱 200 包着的拒绝当拒绝（10-15）；Cline 把 DeepSeek 钉到官方 | pa:22-23；app:8911-8920 | 没有 | — | — | 明确不做：map:46「按厂商名的特殊改写…不做」 |
| A76 | 另一台电脑的 magpie 当 provider：用它的 provider、路由组、额度卡片、价格、Fast 档 | ref:412-450；pa:57-117 | 没有 | 中转站只收本机回环（S/gateway/gateway.ts:89-96；prd R-B2） | — | 明确不做：map:42「局域网共享」 |
| A77 | 赞助伙伴预设：从 usemagpie.ai 拉取，排最前、带「sponsored」（现在名单是空的） | pa:52；M/site/partners.js:1-35 | 不适用 | — | 这是 magpie 自己的赞助商业安排 | 没提到 |
| A78 | 从其他应用导入：Alma、CC Switch、Claude Code、Codex、OpenCode（OpenCode 只在用户点开导入时才读）；每条标「新 / 已添加 / 名称占用 / 同厂商」，可加为另一把 key、保留两份、替换或改名；只读不写 | prov/importapps.go:1-8,76-91,127；app:9905-10137 | 没有 | 搜4 | — | 没提到 |
| A79 | Providers 页主动提示「发现 N 个本地配置」→ 查看并导入，或忽略并记住 | app:9850-9903 | 没有 | 搜4 | — | 没提到 |
| A80 | 导入链接：`magpie://import?...` 或 `usemagpie.ai/import#...`；确认框写明 prompt 和 key 会发往哪些主机；只收 https；拒收 Vertex；终端版 `magpie import` | ref:2006-2040；app:10139-10210；prov/importurl.go:42 | 没有 | 搜4 | — | 没提到 |
| A81 | 「从 magpie 移除」但仍登录着的订阅列在添加页，可加回或登出 | app:7076-7097 | 没有 | 前提 B01 不存在 | — | 同 B01 |
| A82 | 用 CLI 或 TUI 管 provider：presets、providers、provider add、models（±）、refresh、test、key、rm、set header. 等 | ref:235-253,267-290 | 没有 | 搜6 | — | 没提到 |
| A83 | Claude 档位替身：opus/sonnet/haiku/fable 对应哪个模型（magpie 按 Agent 配） | mg:73 | 有（形态不同） | 按接口配档位映射（A/mapping-section.tsx；P:43-48） | 不能按 Agent 配 | 已做：prd R-E3、R-B7 |

**A01 预设清单**（prov/presets.go:113-577，共 57 个；【国】= 国内厂商或国内团队，【决】= 只给路由组当分类器的决策模型，【本】= 本机）

- **厂商 34 个**：Anthropic、OpenAI、Google Gemini、Google Vertex AI、DeepSeek【国】、xAI、Kimi【国】、Kimi (China)【国】、Kimi Code【国】、Kimi Code (China)【国】、Zhipu GLM【国：按量 / Coding Plan】、Z.ai【国：智谱海外】、MiniMax【国】、MiniMax (China)【国】、StepFun【国：Step Plan / 按量】、StepFun (China)【国】、Xiaomi MiMo【国：中国、新加坡、欧洲套餐 / 按量】、Baidu Qianfan【国：个人、企业 Token Plan / 按量】、Tencent Cloud【国：Plan / 按量中国、全球 / 企业 Plan】、Huawei Cloud MaaS【国】、Volcengine Ark【国：Coding / Agent / 按量】、Qwen【国】、Qwen (China)【国】、Qwen Token Plan【国】、Bailian Token Plan【国】、Mistral、Groq、Amazon Bedrock、Azure OpenAI、Ollama Cloud、Nous Portal、TypeSafe Jev【决】、Bailian Decision Model【国、决】、Qwen Decision Model【国、决】。
- **中转站 18 个**：OpenRouter、OpenCode Go、ClinePass、OpenCode Zen（免费模型不要 key）、Kilo Gateway（免费模型不要 key）、Command Code、Together AI、Fireworks、SiliconFlow【国：中国 / 全球】、NVIDIA NIM、ModelScope【国】、AiHubMix【国?】、PipeLLM、302.AI【国?】、CherryIN【国?】、鱼鱼连线【国?：Auto / Global / 中国大陆】、Jev · Vercel AI Gateway【决】、Cloudflare Workers AI · Jev, Clef【决】。
- **本机 4 个**：Ollama、LM Studio、oMLX、MLX-Serve【本】。
- **另一台电脑 1 个**：Remote magpie。

### V. Google Vertex AI

| 编号 | magpie 功能 | magpie 出处 | Osuna 现状 | Osuna 证据 | 差在哪 | 上一轮的态度 |
|---|---|---|---|---|---|---|
| V01 | 加 Vertex：不用 key，用 Google 凭据签名；填 Project ID、Location、Credentials file、Service account | ref:767-799；app:9136-9157；prov/vertex.go:55,158 | 没有 | 搜1；没有 Gemini 格式（P:55-59） | — | Gemini 协议第二期：map:40；Vertex 本身没提到 |
| V02 | 凭据查找：provider 指定的文件 → GOOGLE_APPLICATION_CREDENTIALS → gcloud ADC；支持三种凭据，token 只在内存，到期前或文件变了就重签 | pa:32；vertex.go:339-447 | 没有 | 同 V01 | — | 同 V01 |
| V03 | 每个 location 的模型清单内置（Vertex 没有列表接口），多的手打 | ref:801-820；vertex.go:223 | 没有 | 同 V01 | — | 同 V01 |
| V04 | Priority/Flex PayGo 的请求头提示 | ref:822-828；pa:223 | 没有 | 同 V01 | — | 同 V01 |
| V05 | 出错时给出具体办法（gcloud 命令、缺哪个 IAM 角色） | ref:830-855；pa:220-221 | 没有 | 同 V01 | — | 同 V01 |

### B. 订阅当 provider、账号与订阅

magpie 支持的订阅共 19 个（app:11575-11632；★ = 添加前有封号风险警告）：Claude★、ChatGPT（Codex）、ChatGPT API、Cursor、Grok、Copilot、ZCode【国】、WorkBuddy【国】、WorkBuddy AI、Command Code★、Qoder★【国】、Qoder CN★【国】、Devin、Zed★、Factory★、Xiaomi MiMo★【国】、Kiro、Gemini CLI、Antigravity★。

| 编号 | magpie 功能 | magpie 出处 | Osuna 现状 | Osuna 证据 | 差在哪 | 上一轮的态度 |
|---|---|---|---|---|---|---|
| B01 | 已登录的 Agent 自动成为 provider，模型给其他所有 Agent 用；每次读 Agent 自己的凭据，Agent 登出就消失 | ref:1587-1605；pa:33 | 没有 | 中转站上游只有第三方接口（S/store.ts:47-69），用中转站的只有 claude/codex（S/store.ts:34）；搜2 | 每个订阅只能由它自己的 Agent 在官方模式下用 | 明确不做：mg:65「订阅账号（本任务不做，记录风险）」 |
| B02 | 订阅的模型清单向厂商要，启动时补拉 | pa:121 | 没有 | 同 B01 | — | 同 B01 |
| B03 | Claude 订阅：驱动本机真 `claude`（`--dangerously-skip-permissions`），调用方的工具经 MCP 桥接回来；同一对话续用同一进程或已存会话 | ref:1608-1616；csb:1-120；M/internal/claudebridge/mcp.go | 没有 | 同 B01（Osuna 只把 Claude Code 当 Agent 跑） | — | 同 B01（mg:68 记录过未做） |
| B04 | `magpie claude-code install`：给没装 Claude Code 的机器下载官方构建并校验 | csb:11-24；M/internal/claudecode/claudecode.go | 没有 | 同 B01 | — | 没提到 |
| B05 | 添加有封号风险的订阅前警告并要确认 | app:11575-11632,11726-11733 | 没有 | 同 B01 | — | 同 B01 |
| B06 | ChatGPT 订阅：读 auth.json 或 Codex 的钥匙串项（10-15/16）；按 Codex 的方式刷新 token 并写回；请求发往 ChatGPT 后端 | pa:34-35,201 | 没有 | Osuna 只为显示用量只读 auth.json（O/plugins/codex-usage-source/server/usage.ts:85-86,207），不读钥匙串、不写 | — | 同 B01；d/adr/0004:17「auth.json is never read or written」 |
| B07 | ChatGPT API：用 ChatGPT 套餐走 api.openai.com，带自己 Agent 的指令 | app:11581-11583 | 没有 | 同 B01 | — | 同 B01 |
| B08 | Copilot 订阅：读编辑器或 Copilot CLI 的 GitHub 登录；设备码登录；支持 GHE.com | pa:199,203 | 没有 | 只有 Copilot Agent（…/providers/copilot-acp-agent.ts）和用量源（O/plugins/copilot-usage-source/server/usage.ts:33-45） | — | 同 B01；map:41 |
| B09 | Gemini Code Assist：读 ~/.gemini 或在 magpie 里登录；需要 GCP 项目 | ref:1622-1628 | 没有 | 同 B01 | — | 同 B01；map:41「Gemini CLI（Osuna 不支持）」 |
| B10 | Antigravity：Google 登录走 Code Assist，加前警告；能从别的工具导出文件导入 | ref:1628-1630 | 没有 | Osuna 的 antigravity-provider 是把它当 Agent 跑（O/plugins/antigravity-provider/index.server.ts:1-7） | — | 同 B01 |
| B11 | Grok（SuperGrok）直连 grok CLI 用的接口（已迁社区插件） | ref:1617-1621 | 没有 | 只有 Grok 用量源（O/plugins/grok-usage-source/server/usage.ts:160-168） | — | 同 B01 |
| B12 | Cursor、Devin、Qoder、Kiro、ZCode、WorkBuddy、Command Code、Zed、Factory、MiMo（多数已迁社区插件） | app:11575-11632；M/AGENTS.md | 没有 | Osuna 的 Cursor/Kiro/Kimi/Trae 是 ACP Agent | — | 同 B01 |
| B13 | 一个订阅多个账号：记住见过的账号（logins.json），勾选用哪些 | pa:37；app:12535-12660 | 部分（手工） | config.json 可写多个 extends 条目，各自 env（d/custom-providers.md:299-347），新建 Agent 时手选 | 没有账号列表，没有自动切换 | 明确不做：map:38「订阅账号轮换…涉及改写登录文件与厂商条款边缘」 |
| B14 | 在 magpie 里登录新账号：浏览器 OAuth 或设备码；回调到不了可粘贴；登录走该账号的代理 | pa:38；prov/signin.go:224,541 | 没有 | 搜2 | — | 同 B13 |
| B15 | 从别的工具的文件导入账号（codexbar、CLIProxyAPI、Sub2API 等）；导入会让来源工具登出，先提示 | ref:1632-1647；prov/login_import.go:257 | 没有 | 搜2 | — | 同 B13 |
| B16 | 网关内换账号：额度用完就让账号歇着，同一请求在首字前交给下一个账号；可调账号顺序 | ref:1374-1412,1486-1516 | 没有 | 只在接口之间同名换家（prd R-B8） | — | 同 B13 |
| B17 | 网关外换账号：Agent 单独用时，用到 98% 就把它登录到下一个账号，原账号恢复后切回 | ref:1529-1540；prov/codex_switch.go:145,218 | 没有 | 搜2 | — | 同 B13 |
| B18 | Codex 多账号：写 openai_base_url 经网关换账号；或只切登录不经网关（10-13）；提示重启 Codex | ref:1542-1552；app:12740,12780-12803 | 没有 | 搜2 | — | 同 B13 |
| B19 | 暂停 Agent 自己正在用的账号 | pa:210 | 没有 | 搜2 | — | 同 B13 |
| B20 | 账号用量上限：按账号或按窗口设 | pa:224；prov/account_caps.go:136 | 没有 | 搜2 | — | 同 B13 |
| B21 | 账号或 key 只服务某些模型 | ref:1382-1383；prov/provider.go:298 | 没有 | 搜2 | — | 同 B13 |
| B22 | 账号别名；同一 GLM 席位只显示一张卡 | ref:1931-1943；prov/account_names.go:79 | 没有 | 搜2 | — | 同 B13 |
| B23 | 每账号代理；Claude 账号的代理写进 settings.json 的 env | pa:41 | 没有 | 搜5 | — | 同 B13 |
| B24 | 登录被厂商吊销时标「需要重新登录」并停用 | pa:36 | 没有 | 搜2 | — | 同 B13 |
| B25 | 账号发现总开关（Settings → Privacy、`accounts discovery off`、`MAGPIE_NO_ACCOUNTS=1`）：关了就不读任何凭据，关前会列出受影响的订阅 | pa:119；M/internal/settings/accounts.go:9-23；app:21139,21163-21169 | 没有 | Osuna 内置用量源会读 Claude 钥匙串（O/plugins/claude-usage-source/server/usage.ts:306）、auth.json 等；内置插件常开（d/plugins.md:105-106）；搜 usage discovery、disableUsage、PASEO_NO_ 无命中 | 没有关掉读取的开关 | 没提到 |
| B26 | 关掉或移除的订阅后台什么都不做（10-14） | pa:212 | 没有 | 前提 B01 不存在 | — | 同 B01 |
| B27 | 额度窗口读取并用于选路；Claude 只通过跑 Claude Code 的 `/usage` 读，从不直接问 Anthropic | ref:1554-1585；pa:43,197 | 部分 | 内置 9 个用量源，5 分钟缓存（pd:508）；Claude 是直接拿 OAuth token 调 api.anthropic.com/api/oauth/usage（O/plugins/claude-usage-source/server/usage.ts:537） | 只显示、不参与选路；Claude 的读法和 magpie 不同 | 主动读用量提前切换是第二期：map:40、prd:224 |
| B28 | 额度读取「When I ask」：只在用户打开或刷新时读 | pa:43；app:19760 | 没有 | — | — | 没提到 |
| B29 | ChatGPT 窗口用完后要不要继续花 credits（按账号） | ref:1917-1929 | 没有 | 搜2 | — | 同 B13 |
| B30 | Codex 重置次数自动使用（两个开关，10-14） | 提交 00afcf97 | 没有 | 搜2 | — | 同 B13 |
| B31 | 每日预热：在选定时间或窗口刚重置时，给每个 Claude/ChatGPT 账号发最小请求启动 5 小时窗口 | RZ:146；M/plugins/warmups/warmups.go:11-30；prov/warmup_daily.go:1-27 | 没有 | 搜2；Osuna 有定时任务（O/packages/server/src/server/schedule/），没有内置预热 | — | 没提到 |
| B32 | 每日签到（WorkBuddy、Trae CN、MiniMax、Qoder、插件签到）；可按账号关；不代解验证码 | ref:459-478；pp:39-53 | 没有 | 搜2 | — | 没提到 |
| B33 | 记住每个账号上次答话的时间，菜单栏跟随当前在用的账号 | pa:51 | 没有 | — | — | 没提到 |

### C. 「Connecting anything else」一节

| 编号 | magpie 功能 | magpie 出处 | Osuna 现状 | Osuna 证据 | 差在哪 | 上一轮的态度 |
|---|---|---|---|---|---|---|
| C01 | 网关地址可改，可单独跑 `magpie serve`；可设对外显示的公开地址 | ref:1651-1659 | 有（形态不同） | 中转站挂在 daemon 的 `/api-endpoint-gateway` 下（prd R-B1） | 没有独立端口和公开地址 | 已做；单开端口被 ADR 0007 否决 |
| C02 | 任何能填 base URL 的工具都能用（任意 key；模型可写 provider/model、路由组或裸 id） | ref:1703-1712,1725-1731 | 没有 | 只收本机来源 + Agent 口令，口令只发给 Claude Code 和 Codex（S/gateway/gateway.ts:89-105） | 外部工具拿不到口令 | 明确不做：prd R-B2、map:42 |
| C03 | 网关路径齐全：chat completions、responses、messages、count_tokens、Gemini、语音转写和翻译、models、codex models | ref:1677-1688,1713-1721 | 部分 | 只有 messages、count_tokens、responses、models、/api/hello（S/gateway/gateway.ts:64-68,107-125） | 缺 Chat Completions 入口、Gemini、语音 | 已做（五条）：prd R-B1 |
| C04 | `/v1/models` 每项带 reasoning、档位、哪些 API 直通 | ref:1690-1701 | 部分 | 只有基本字段（S/gateway/gateway.ts:735-752） | 缺档位和直通信息 | 没提到 |
| C05 | 回复头写明是哪个 provider、哪个模型答的 | ref:1722-1723 | 部分 | `x-osuna-api-endpoint: <标识>`（S/gateway/upstream-call.ts:15） | 不带模型 | 已做：prd R-B12 |
| C06 | 用 `X-Magpie-Account` 头把请求钉在某个账号上 | ref:1733-1737 | 没有 | 没有账号 | — | 同 B13 |
| C07 | 状态栏实时查「这一轮去了哪」 | ref:1739-1756 | 没有 | 换家只写日志（prd R-B8） | — | 明确不做（对用户无感）：map:50、map:52 |
| C08 | 额度 HTTP 接口；`magpie statusline` 给 Claude Code 状态栏用 | ref:1758-1790 | 部分 | 套餐用量只经 WebSocket RPC 给 Osuna 客户端（d/plugins.md:499） | 没有 HTTP 接口，没有 statusline | 没提到 |
| C09 | 用量、在途请求的 HTTP 接口；外部应用可上报自己的调用 | ref:1815-1890 | 没有 | 中转站不另记用量（ADR 0007） | — | 明确不做：map:49 |
| C10 | `magpie quota refresh`；`magpie quota wait`（等额度恢复后再继续） | ref:1892-1915 | 没有 | 搜6 | — | 没提到 |
| C11 | Gateway 页给出各种语言的接入示例、模型 id 列表、最近调用；调试日志开关 | ref:1961-1963 | 没有 | — | — | 没提到 |
| C12 | 接 Claude Code：写 env；选回原生模型就恢复原值 | ref:1965-1967 | 有 | prd R-B3、R-B5 | — | 已做 |
| C13 | 接 Claude Code 时保留 claude.ai 登录（/usage、connectors 等仍可用） | ref:1967-1977 | 没有 | 写口令、API key 置空（prd R-B3） | — | 没提到 |
| C14 | 接 Codex：专用表 + 模型目录；断开后表留着，旧线程还能打开 | ref:1979-1987 | 部分（形态不同） | 有专用表和目录（prd R-B4），但切回官方时删表（ADR 0007） | 旧线程不能经表续上 | 已做（刻意删表） |
| C15 | Codex 已登录 ChatGPT 时两者并存，账号没额度时 magpie 才接手 | ref:1987-1996 | 没有 | 总开关开着就整个改指向中转站（prd R-B4），官方和第三方二选一 | — | 没提到 |
| C16 | 给 OpenCode、Pi、Crush 写 provider 条目 | ref:1998 | 没有 | 只接 claude/codex（S/store.ts:34） | — | 明确不做：map:40-41 |
| C17 | Gemini CLI 切换认证方式并指向网关 | ref:2000-2004 | 没有 | 同 C16 | — | 明确不做：map:41 |
| C18 | 给开发者的接入指南 | M/docs/integrating.md:1-30 | 没有 | — | — | 没提到 |
| C19 | 经反代或隧道转来的请求按外部请求处理；可设信任自己做认证的代理 | ref:661-677 | 部分 | 带转发头一律 403（prd R-B2） | 没有信任代理的开关 | 已做（拒绝） |

### D. 插件

**magpie 插件和 Osuna 插件的对应关系**

magpie 的「插件」有五种：

1. 跑在 Bun 上的 OpenCode 登录插件或 pi 包，主要用来登录某个订阅、替它发请求，也就是当 provider；
2. 跑在网关里的 JS 中间件；
3. Agent 插件，给 magpie 不认识的 Agent 写配置、连上网关；
4. 工具插件和页面插件；
5. 内置插件开关。

Osuna 的插件是 Osuna 自己的格式（d/plugins.md:1-4,92-95）：daemon 用 esbuild 编译后放在 Node 子进程里跑。它能贡献 RPC、界面、新的 Agent 提供方、套餐用量源，以及生命周期钩子（只能改新建 Agent 的配置和环境变量）。它碰不到中转站的请求和回复，也不能给第三方接口加上游。

| 编号 | magpie 功能 | magpie 出处 | Osuna 现状 | Osuna 证据 | 差在哪 | 上一轮的态度 |
|---|---|---|---|---|---|---|
| D01 | 装 OpenCode 登录插件：插件负责登录、列模型、发请求，它的订阅像普通 provider 一样用；id 冲突时加 `-plugin` | ref:857-879；M/internal/plugin/store.go:1-8 | 没有 | 插件格式不同，不能给中转站加上游；搜3 | — | 明确不做：map:42「中间件/插件系统」 |
| D02 | 装 pi 包（旁边装 pi，只取它注册的 provider） | ref:895-905；M/internal/plugin/pi.js | 没有 | 同 D01 | — | 同 D01 |
| D03 | Bun 第一次用到时自动下载（校验 SHA-256，可走镜像，自动适配平台，之后跟进新版） | ref:864-866；M/internal/plugin/bun.go:31-62；pp:164-166 | 没有 | 用 esbuild 加 Node 子进程（PL/compiler.ts:5-20；PL/runtime.ts:234） | — | 同 D01 |
| D04 | 插件自己的登录流程（登录前的问题、密码不回显、浏览器或 key、可粘贴回调） | ref:871-873,921-927 | 没有 | 插件 SDK 没有登录概念（搜3） | — | 同 D01 |
| D05 | 插件的增、删、开关、更新 | ref:868-875；plg:954-1176 | 有（形态不同） | `paseo plugin install/enable/disable/remove/update`（d/plugins.md:9-88,119-158）；应用页（PPG:40,101-137,164-166） | 管的是 Osuna 格式的插件 | 没提到 |
| D06 | 两个插件登录同一个 id 时都保留，选一个来服务 | ref:881-893；pp:88-111 | 没有 | 重复注册直接报错（PL/plugin-process.ts:151,177） | — | 没提到 |
| D07 | 插件图标可用 https、data URI 或包里的文件；插件给 key 输入框写标题和占位 | ref:913-927 | 部分 | 只能用插件目录里 64KB 以内的 SVG，会做净化（d/plugins.md:488-493） | 没有 URL 图标，没有登录框 | 没提到 |
| D08 | 插件给自己的 provider 声明开关，显示在 provider 编辑器里（10-14） | ref:480-485；pp:55-61 | 部分（形态不同） | 插件能贡献设置页和持久化的值（pd:1429-1569） | 不在接口编辑器里 | 没提到 |
| D09 | 插件的签到、自带搜索、决策 API、拿到 Agent 工作目录 | pp:39-86 | 没有 | 插件不经过中转站 | — | 同 D01 |
| D10 | 应用里的发现页：分五类；推荐、npm 搜索、GitHub 上带标签的非官方插件 | plg:698-848；M/internal/plugin/market.go:24-48 | 部分 | 有官方注册表，网站上浏览（d/plugins.md:119-142）；应用里只能填来源装（PPG:527-542） | 应用里不能浏览、搜索 | 没提到 |
| D11 | npm 上没有时从社区仓库的 dist 分支装；包丢了自动重装 | pp:148-150 | 不适用 | — | 是 magpie 社区为 npm 发布受阻做的补救 | 没提到 |
| D12 | 检查更新、全部更新，检查时带 GitHub token | plg:974-1040；pp:144-146 | 有（形态不同） | Git 源更新要用户批准（d/plugins.md:123-125,156-158；PPG:549） | — | 没提到 |
| D13 | 国内镜像开关 | plg:737；M/internal/source/source.go | 没有 | 搜3 | — | 没提到 |
| D14 | 从本机文件夹装；在应用里看 README | plg:903-904,1365-1415 | 部分 | 能装目录源（d/plugins.md:9-41）；应用里的描述是纯文本（d/plugins.md:127-132） | 应用里没有 README | 没提到 |
| D15 | 内置订阅迁到插件（迁过去、迁回来、自动接管） | pp:113-152 | 不适用 | — | Osuna 没有内置订阅 | 同 B01 |
| D16 | 内置插件开关：groups、otel、warmups、middleware、redact、search、budget、tools 等 | prt:25-31,266-305 | 没有 | 内置插件常开（d/plugins.md:105-108） | — | 没提到 |
| D17 | Agent 插件：给 magpie 不认识的 Agent 写配置连网关 | ref:1004-1028；M/internal/agentplug | 部分（形态不同） | 可以 registerProvider 新增 Agent（d/plugins.md:409-493） | 那是 Osuna 直接驱动 Agent，第三方 Agent 接不了中转站 | 明确不做：map:40-41 |
| D18 | 插件工具经 MCP 给所有 Agent（10-15） | pt:1-47；M/internal/gateway/tools_mcp.go | 部分 | 钩子能给新建的 Agent 注入 MCP 配置（pd:557-597） | 没有汇总所有插件工具的 MCP 服务 | 没提到 |
| D19 | 插件页面跑在沙箱 iframe 里，只能读声明过的数据（10-15） | prt:262；M/internal/plugin/page.go | 有（形态不同） | 能贡献设置页、侧栏、面板等（d/plugins.md:1-4），客户端不沙箱（d/plugins.md:7） | 没有沙箱和读取白名单 | 没提到 |
| D20 | 插件加载失败、stderr 都能看到 | plg:1081；pp:170 | 有 | 日志（PPG:118,248-287）；加载失败说明（pd:2443） | — | 没提到 |
| D21 | 插件联网走 magpie 的代理；局域网直连；SOCKS 桥接 | pp:162-168 | 没有 | 搜5 | — | 没提到 |

### E. 网关中间件

| 编号 | magpie 功能 | magpie 出处 | Osuna 现状 | Osuna 证据 | 差在哪 | 上一轮的态度 |
|---|---|---|---|---|---|---|
| E01 | 声明方式：在 package.json 写 middleware，或放一个 `*.middleware.js` 文件 | ref:946-953；gm:9-10 | 没有 | 搜3 | — | 明确不做：map:42 |
| E02 | `onRequest`：路由前改请求，改 model 就换路由 | ref:946-951；sp:666 | 没有 | 同 E01 | — | 同 E01 |
| E03 | `ctx.reject` 拒绝请求，按 Agent 的格式报错 | sp:666 | 没有 | 同 E01 | — | 同 E01 |
| E04 | `onEvent`：逐个流式事件改写或丢弃，可只订阅某些事件名 | gm:27；sp:667-670 | 没有 | 同 E01 | — | 同 E01 |
| E05 | `onResponse`：改非流式的整份回复 | sp:668 | 没有 | 同 E01 | — | 同 E01 |
| E06 | ctx 提供协议、模型、是否流式、路径、Agent、选项、请求内共享状态 | sp:670 | 没有 | 同 E01 | — | 同 E01 |
| E07 | 跑在网关进程里的 Go 写的 JS 引擎，没有定时器、fetch、Node API | ref:969-972；M/internal/jsmod/jsmod.go | 没有 | 同 E01 | — | 同 E01 |
| E08 | 出错就放行：超时上限 250ms/50ms/1s，抛错或超时一律原样转发 | gm:44-50；RZ:194 | 没有 | 同 E01 | — | 同 E01 |
| E09 | 插件页显示每个中间件的调用次数、耗时、失败数 | ref:973；plg:1303-1328 | 没有 | 同 E01 | — | 同 E01 |
| E10 | 选项：在插件页用 JSON 编辑，或用 `magpie plugin options` 设置 | ref:984-994；plg:1162-1232 | 没有 | 同 E01 | — | 同 E01 |
| E11 | 改了配置或文件，1 秒内生效 | gm:51 | 没有 | 同 E01 | — | 同 E01 |
| E12 | 有总开关；只作用于 Agent 发来的请求 | ref:977-980；gm:33 | 没有 | 同 E01 | — | 同 E01 |
| E13 | param-override：沿用 New API 的 param_override 写法，按条件改写请求字段 | sp:640；RZ:210 | 没有 | 同 E01 | — | 同 E01 |
| E14 | model-map：沿用 New API 的 model_mapping，按名字或正则改名 | sp:641,650-651 | 部分 | 只有 Claude 档位映射（A/mapping-section.tsx） | 不能任意改名 | 档位已做；其余同 E01 |
| E15 | system-prompt：给某些 Agent 或模型加系统提示 | sp:642 | 部分（形态不同） | 钩子能改新建 Agent 的 systemPrompt（pd:786） | 不是每个请求都生效，也管不到终端里的 CLI | 同 E01 |
| E16 | word-guard：敏感词拒绝或打码 | sp:643 | 没有 | 同 E01 | — | 同 E01 |
| E17 | think-tags：去掉 `<think>`，或把 reasoning_content 放进正文 | sp:644 | 部分 | 内置固定把 `<think>` 拆成思考块（prd R-C3） | 不能选 | 已做 |
| E18 | 中间件里的 JS 路由策略（10-15） | gm:35-43 | 没有 | 同 E01 | — | 明确不做：map:42 |
| E19 | onUsage 用量观察（10-15） | gm:41,49 | 没有 | 生命周期钩子只有 Agent 和工作区事件（O/packages/plugin/src/server/lifecycle.ts:48-71） | — | 同 E01 |
| E20 | 隐私脱敏；要求脱敏却没有脱敏器时回 503、什么都不发 | ref:980-982；prt:218-219 | 没有 | 只有报错文字里的 key 打码（S/upstream-models.ts:62） | — | 没提到 |

## 2. 10-13 之后 magpie 新加或大改的功能

我负责的目录在 10-13 之后有 212 个提交，GUI 文件里另有约 50 个。下面只列用户能感知到的。

| 功能 | 提交 | Osuna |
|---|---|---|
| 粘贴 curl 示例自动填表 | 7597c132（10-16） | 没有 |
| 上千把 key 不卡；每把 key 的代理行超过 8 把时折叠 | 0bbb2f3c、674b6ca2（10-16） | 没有 |
| 编辑器把少用的字段收进「高级」 | 0cad76cd（10-16） | 不适用 |
| 已添加的预设可改名 | 15a8656b（10-15） | 有 |
| 跳过证书校验 | 3f4186fd（10-15） | 没有 |
| 余额：POST、表达式里的列表函数、token 改进 | dc8dcc85、80211e70、ef0c515e 等 | 没有 |
| Command Code 的月度 credits 作为额度窗口 | ba17c4f9（10-16） | 没有 |
| 定时拉清单、新模型按规则自动纳入 | ee4a7ab4（10-14） | 没有 |
| 模型服务范围加「只看用量」 | 54a2b0d0（10-14） | 没有 |
| 一档不勾就不发推理字段 | f074996d（10-14） | 没有 |
| 模型可标成图片/视频模型 | a65f2131（10-13） | 没有 |
| 多协议的模型清单合并 | 12d82321（10-13） | 没有 |
| 显示名的取法与 models.dev 匹配改进 | 7df0a5bf、c8b4ac77、f51863b3 | 部分 |
| 本机服务可填地址 | 79099d6a、26465bc0（10-13） | 部分 |
| 新预设：Nous Portal、硅基流动国际站、Vertex 新模型 | 591ed58b、430871d6、4faa9313 | 没有 |
| 智谱的两处专属修正 | 48856922、35aa50cf | 没有 |
| 导入改进（OpenCode 的 key、继续导入、Gemini 地址匹配） | 37fec124、c19a8d13、319b86fe | 没有 |
| 导入链接支持 gemini=、带 region、中文名截断不坏字 | c3bef99e、94e3d39b、e3ea77f8 | 没有 |
| Codex 登录存在钥匙串时也能读写 | 7dc5cd8f、014fbdbc、d830d460、056cfe33 | 没有 |
| Codex token 刷新改成安全写入 | d5847f19 | 不适用 |
| Codex 只切自己的登录、不经网关 | d6fd9b3a（10-13） | 没有 |
| Codex 重置次数自动使用 | 00afcf97 | 没有 |
| 关掉的订阅不在后台发请求 | 75cbc7e1、62fc1b4b | 没有 |
| Claude 桥接四处修正 | 641f00e4、b789bcc4、c4f4aaaa、11367250 | 没有 |
| 登录取消与占用的修正 | 40df6dbd、6641e1b0 | 没有 |
| Step Plan 的登录按 provider 存 | cc09c5bd | 没有 |
| 每个账号有自己的队列和限额 | 5e5b6a5a | 没有 |
| 签到可按账号关 | ab1006bb | 没有 |
| 插件声明自己的开关 | 20769439（10-14） | 没有 |
| 插件密码问题不回显 | 9e76fcdc | 没有 |
| 插件 searches:true | 77f90fd8 | 没有 |
| 删掉插件时保存它的模型选择 | 33da86c7 | 没有 |
| 插件自动重装、从 dist 分支装 | a0ebe003、118f4f28 | 没有 |
| Bun 支持 Windows ARM | 4e9335c9 | 没有 |
| 更新检查带 GitHub token | 334bb182、43170794 | 没有 |
| 发现页新增两类插件、筛选、「Replaces built-in」标记 | b6533893、dfdb6f8a、acb0d4ba | 没有 |
| 内置插件运行时与开关；五个页面改成插件页（P0–P2） | 3ccbe6bc、2dcc5141、eb7199e1、3c7ec4ba 等 | 没有 |
| 网关的五个扩展点（P3） | 9916a946、af9bd6c3、b1d02fa6、4ac4d9ba、9d97fd07、a1f7b8c1 | 没有 |
| P4：JS 路由策略、onUsage、插件工具、插件页面 | 3f913b3d、6ac7032b、64b0f3a2、e679f110 | 没有（页面形态不同） |
| Agent 插件的改进 | dbf33121、49639cd1、db8b7917 | 没有 |
| 代理测试 | 536b15a8、cf5a6f9c | 没有 |

## 3. 需要你拍板的取舍点

1. **订阅当 provider**（Claude 驱动真 claude 并用 `--dangerously-skip-permissions`、ChatGPT、Copilot、Gemini、Antigravity、Grok……）
   - magpie 自己在添加前就警告可能封号（app:11575-11632），还因为「Reaching them can break their vendors' terms」把一批订阅迁出了内置（M/AGENTS.md）。
   - 上一轮记作「本任务不做，记录风险」（mg:65-69）。
2. **多账号和自动切换要改写 Agent 的登录文件并替它刷新 token**。这和三条现有规则正面冲突：
   - ADR 0004:17「auth.json is never read or written」；
   - pd:453「Never redeem refresh tokens or write credential stores」；
   - map:38「订阅账号轮换…不碰 auth.json」。
3. **只读登录信息要不要加开关**：Osuna 现在为了显示套餐用量，已经在只读 Claude 钥匙串、auth.json 等，而且关不掉（O/plugins/claude-usage-source/server/usage.ts:306；d/plugins.md:105-106）。是否照 magpie 加「账号发现」总开关。
4. **Claude 额度的读法**：magpie 刻意不用 token 直接问 Anthropic（ref:1571-1573），Osuna 现在是直接调用（usage.ts:537）。这个差异要不要管。
5. **每日预热**：按时自动替用户用订阅、消耗额度（RZ:146）。
6. **第三方插件**：要从网上下载 Bun、从 npm 装无沙箱代码（bun.go:31-62）。与 map:42 冲突。
7. **网关中间件**：要在每个请求、每个流式事件上跑用户写的 JS（gm:44-50）。与 map:42 冲突，影响延迟和安全。
8. **预设清单（57 个）和赞助位**：上一轮 map:53 定为不做；预设需要跟着厂商持续维护。
9. **导入**：要读别的应用的配置文件，里面有明文 key，OpenCode 的 auth.json 里还有订阅登录（importapps.go:85-91）。
10. **导入链接**：要么注册新的 URL scheme，要么用网页中转；手机官方 App 不能改（map:15、map:51），只能做桌面端。
11. **同一接口多 key**：上一轮明确不做（map:39）。
12. **「发送 Agent 自己的 User-Agent」**：等于向只服务指定 Agent 的套餐冒用身份（ref:279-290）。
13. **跳过证书校验**：安全上的取舍（pa:202）。
14. **代理**：daemon 现在完全没有出站代理（搜5）。
15. **余额查询和 models.dev 扩大用途**：会新增 daemon 主动发出的请求，有的还带着用户的 key。这要改 d/usage.md:122-150 的规则——那里写明 daemon 主动只发两个公开 GET，models.dev 只留三项数据。
16. **Vertex**：要读 gcloud 的凭据文件，而且依赖 Gemini 格式（map:40 定为第二期）。
17. **Remote magpie、让外部工具也用中转站**：要放开「只收本机回环」（prd R-B2）。与 map:42 冲突。
18. **按 Agent 隐藏模型、按模型指定格式**：上一轮 map:53 定为不做。

## 4. 拿不准的地方

1. **国内标注**：DeepSeek、Kimi、智谱等是按常识标的；302.AI、AiHubMix、CherryIN、鱼鱼连线是看名称和域名推测的（推测）；PipeLLM 没标，不确定。
2. **社区中间件的选项格式**：只读了 magpie 仓库里 README 和 sp 的说明。包本身在 magpie-community/plugins，不在本地，没读源码。已迁到社区插件的那些订阅也没逐个核对插件现状。
3. **Osuna 不走代理**：代码里确实没有任何代理配置（看过源码），但 Node 运行时默认会不会读 HTTPS_PROXY 没核实（推测）。
4. **几处是推测**：
   - C13（开着第三方接口时 Claude Code 失去 claude.ai 功能）是照 magpie 文档推的，本机不验 CLI 登录；
   - B13 用 CLAUDE_CONFIG_DIR 分开多个订阅账号，推测可行，文档例子只用了 API key；
   - B31 用 Osuna 的定时任务替代预热，推测。
5. **magpie 文档和代码说法不一处，我按代码列**：
   - README（RZ:130）说导入支持 4 个应用，代码有 5 个；
   - 预设以 presets.go 的 57 个为准；
   - 赞助名单在代码里当前是空的（M/site/partners.js:35）。
6. **行号**：magpie 以 HEAD 7597c132 为准。app.js 有 2.3 万行，部分行号是函数起始行或区块的大致范围。

总的来看：provider 这块 Osuna 只有「一家一把 key、三种格式、检测、拉模型、挑模型、档位映射、开关、冷却」；订阅、插件生态、中间件三块基本空白，其中大部分上一轮已经明确不做。
