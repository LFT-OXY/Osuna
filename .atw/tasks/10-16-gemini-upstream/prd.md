# Gemini 上游格式

来源：总任务 [`10-16-magpie-osuna-gaps`](../10-16-magpie-osuna-gaps/prd.md) 的第 7 个子任务。总任务的 Constraints、Implementation Decisions、Testing Decisions 对本任务全部适用，下面只写本任务特有的。访谈的逐条决定与 magpie 出处见 [`research/decisions.md`](research/decisions.md)（2026-10-24，两轮，G1–G15、A1–A7）。

对照基准：magpie 最新 main（Gemini 翻译核心文件自 `7597c132` 起没改；之后的 `7ea0e047` 导入、`59289946` 最后一家的思考随来随发照做）；Osuna main `18eeb37b2`。

差距明细：01·B01、B60 的 Gemini 上游部分；02·A07；02·A06、A08 的 Gemini 部分。

## Problem Statement

用户靠中转服务（new-api、sub2api 一类）在 Claude Code、Codex、Pi、OMP 里干活，这些中转服务很多也卖 Gemini 模型，并且给出 Gemini 格式（Google 的 `generateContent`）的地址。Osuna 的第三方接口（**API endpoint**）只有三种请求格式（**Request format**）：Anthropic、OpenAI Chat、OpenAI Responses，内置中转站（**Gateway**）不会说 Gemini 格式：

- 只给了 Gemini 格式地址的中转服务加不进来；导入 CC Switch、Alma 或导入链接时，Gemini 地址被跳过，界面写着「Osuna 还不支持 Gemini」。
- 自动识别格式、测试连接、拉模型清单都不认 Gemini 地址。
- 就算模型能通过别的格式用上，也拿不到 Gemini 格式下才有的思考、工具调用细节。

用户不用 Gemini CLI，要的是在 Claude Code、Codex、Pi、OMP 里用中转服务的 Gemini 模型（总任务 Q14）。

## Solution

第三方接口可以多填一个 Gemini 地址，一家最多四个地址：

- 接口页、添加窗口多一个「Gemini 地址」框；格式下拉、逐个模型的结果表、只用这种格式都多一个 Gemini。
- 内置中转站把 Claude Code（Anthropic 入口）、Codex（Responses 入口）、Pi / OMP（Chat 入口）的请求翻成 Gemini 格式发出，把回复（含流式）翻回各自的格式；思考、工具调用、图片、用量照常。
- Gemini 地址出错时和别的格式一样判错、冷却、自动切换（**Failover**），还认得出 Gemini 特有的「key 无效」和「N 秒后再试」。
- 自动识别格式、测试连接、拉模型清单、逐个模型都支持 Gemini 地址。
- 导入别的软件的配置和导入链接时收下 Gemini 地址。
- 模板清单多一个「Google Gemini」。

一家同时有几种地址时，Gemini 排最后：Gemini 地址只在这家只有 Gemini 地址、模型设了「只用这种格式 = Gemini」、或前面的格式都拒了这个模型时才用（照 magpie）。

## User Stories

### 添加与管理

1. 作为只拿到 Gemini 格式地址的中转服务用户，我希望在添加窗口填一个 Gemini 地址就能加上这家，以便用它的 Gemini 模型。
2. 作为用户，我希望一家接口同时填 Anthropic、OpenAI Chat、OpenAI Responses、Gemini 四个地址，以便这家支持什么都能用上。
3. 作为用户，我希望 Gemini 地址框写明要填 `…/v1beta` 一级、key 怎么带，以便一次填对。
4. 作为用户，我希望只填主机名时 Osuna 自动补上 `/v1beta`、粘贴整条请求地址时自动剪回基础地址，以便不用自己改。
5. 作为用户，我希望把已填的地址切到 Gemini 格式时，Osuna 把 `/v1` 改成 `/v1beta`，以便格式和写法一致。
6. 作为用户，我希望在接口页看到这家的 Gemini 地址并能修改、删掉，以便和别的格式一样管理。
7. 作为用户，我希望格式名在每种界面语言里都显示为「Gemini」，以便认得出来。
8. 作为用户，我希望模板清单里有「Google Gemini」，以便直接加 Google 官方的 Gemini API。
9. 作为用户，我希望 Google Gemini 模板和 magpie 一样填 Google 的 Chat 兼容地址，以便和 magpie 用户的体验一致。

### 自动识别、测试与模型清单

10. 作为用户，我希望自动识别格式时也试 Gemini 格式，以便 Osuna 告诉我这个地址支不支持 Gemini。
11. 作为用户，我希望 Gemini 只在回复真的像 Gemini 的回复时才算识别成功，以便对任何地址都回成功网页的服务不会被误认。
12. 作为用户，我希望 key 填错时识别结果说「key 无效」，以便知道该改 key 而不是改地址。
13. 作为用户，我希望测试连接支持只有 Gemini 地址的接口，以便确认它能用。
14. 作为用户，我希望从 Gemini 地址拉到完整的模型清单（不止第一页），以便选到这家的全部 Gemini 模型。
15. 作为用户，我希望清单里的模型名不带 `models/` 前缀，以便和别的格式里的同名模型对上。
16. 作为用户，我希望清单只列能对话的模型，以便不会勾到向量模型之类用不了的。
17. 作为用户，我希望从 Gemini 清单读到的上下文长度和输出上限出现在模型设置里，以便 Claude Code 拿到正确的模型提示。
18. 作为用户，我希望「逐个模型」测试多一列 Gemini，以便看每个模型在 Gemini 格式下通不通。
19. 作为用户，我希望把只在 Gemini 格式下通的模型自动设成「只用这种格式 = Gemini」（同现有「采用这些」规则），以便它能被用上。

### 经过中转站使用

20. 作为 Claude Code 用户，我希望在 Claude Code 里选这家的 Gemini 模型能正常对话，以便不换工具就用 Gemini。
21. 作为 Codex 用户，我希望在 Codex 里选这家的 Gemini 模型能正常对话，以便同上。
22. 作为 Pi / OMP 用户，我希望 Pi、OMP 也能用这家的 Gemini 模型，配置不用改，以便四家一致。
23. 作为用户，我希望回复按 CLI 自己的格式流式回来，以便 CLI 照常逐字显示。
24. 作为用户，我希望 CLI 要一次性拿结果时也能用（Osuna 读流后拼成整份），以便非流式的调用不出错。
25. 作为用户，我希望 Gemini 模型的思考过程在 CLI 里照常显示，以便看到模型怎么想。
26. 作为用户，我希望在 CLI 里调的思考档位传给 Gemini（3 代起用档位、2 代用预算），以便档位真的生效。
27. 作为用户，我希望 Gemini 要求带回的「思考签名」被 Osuna 保存并在下一轮带回，以便多轮工具调用不被 Gemini 以「缺少签名」拒绝。
28. 作为用户，我希望签名很长时不把 CLI 的会话记录撑大，以便会话文件和别的工具不出问题。
29. 作为用户，我希望工具调用、并行工具调用、工具结果（含图片）都能来回翻译，以便 Agent 能正常用工具。
30. 作为用户，我希望 Gemini 不给调用编号时 Osuna 补上编号并两边一致，以便 CLI 能把结果对上调用。
31. 作为用户，我希望对话历史里没回答的调用、重复回答、以模型轮次开头或结尾的历史被修补成 Gemini 能收的样子，以便续聊、中断后重试不被拒。
32. 作为用户，我希望图片（截图、粘贴的图）能发给 Gemini 模型，以便它能看图。
33. 作为用户，我希望用量（输入、缓存、输出、思考）按统一口径记进账本和用量页，以便 Gemini 的花费和别的模型可比。
34. 作为用户，我希望 Gemini 因长度截断、安全拦截、正常结束、调用工具结束时，CLI 收到对应的结束原因，以便 CLI 行为正确。
35. 作为用户，我希望要求 JSON 输出、停止词、温度等参数也传给 Gemini，以便调用方的设置生效。
36. 作为用户，我希望在接口上设的请求头、附加请求体、上游模型名也作用于 Gemini 请求，以便和别的格式一样能调。
37. 作为用户，我希望打开「这家自己会联网搜索」后，Gemini 地址的请求用 Gemini 自己的 Google 搜索，以便 Claude Code 的联网搜索在这家也能用。

### 判错、冷却与自动切换

38. 作为用户，我希望 Gemini 地址出错时和别的格式一样冷却并切到下一家同名模型，以便对话不中断。
39. 作为用户，我希望 Gemini 回「API key not valid」时这家被标成「需要检查」并换家，以便我知道 key 坏了。
40. 作为用户，我希望 Gemini 限流时按它给的「N 秒后再试」冷却，以便恢复得及时、不早不晚。
41. 作为用户，我希望 Gemini 的额度用尽、欠费按现有分类冷却，以便和别家一样。
42. 作为用户，我希望 Gemini 回空回复时自动重试或换家，以便不收到一个什么都没有的回答。
43. 作为用户，我希望 Gemini 回复中途断开被当作「回复不完整」而不是正常结束，以便 Osuna 换家而不是交给 CLI 半截回复。
44. 作为用户，我希望 Gemini 的安全拦截按拒答处理（不冷却、换下一家），以便一次拦截不把这家冷却掉。
45. 作为用户，我希望 Gemini 说「没有这个模型」时只跳过这个格式或这家，以便别的模型照常。

### 导入

46. 作为 CC Switch 用户，我希望导入时收下 Gemini 条目里的地址和 key（补上 `/v1beta`），以便不用重填。
47. 作为 Alma 用户，我希望导入时收下 Gemini 格式的服务商，以便一次导全。
48. 作为用户，我希望导入链接里的 `gemini=` 地址被收下，只给了 Gemini 地址的链接也能导入，以便分享来的链接都能用。
49. 作为用户，我希望导入时 Gemini 地址的主机也参与判断「是不是已经加过的同一家」，以便不重复加出第二份。
50. 作为用户，我希望「Osuna 还不支持 Gemini」的提示不再出现，以便不被过时的说法误导。

### 兼容与跨部分

51. 作为用官方 Paseo 手机 App 或旧客户端的用户，我希望 Osuna 升级后照常能用，以便不受这次改动影响。
52. 作为用新客户端连旧 daemon 的用户，我希望看不到 Gemini 地址框，以便不会填了却存不进去。
53. 作为用户，我希望文档写明「写进 Gemini 地址后装回旧版 Osuna，旧版读不了接口文件」，以便回退前知道风险。
54. 作为用别的界面语言的用户，我希望新文字在 9 种语言里都有，中文界面全是中文，以便看得懂。

## Implementation Decisions

### 格式与存储

- 请求格式新增 `gemini`，排在枚举最后。线上 `format` 本来是字符串，旧客户端照常解析；存储端仍是严格枚举，旧 daemon 读不了带 Gemini 地址的接口文件，用户已接受（G10），写进 `docs/data-model.md`。
- 一家接口最多四个地址，每种格式最多一个，至少一个。
- 新功能挂在 `server_info.features.apiEndpointGemini` 上：新客户端只有看到它才显示 Gemini 地址框、Gemini 格式选项与相关文案；旧 daemon 不发，新客户端就不显示。
- Gemini 地址保存时规范化（照 magpie `GeminiBase`）：去首尾空白与末尾 `/`；没协议补 `https://`；粘贴的方法地址（`…/models/x:generateContent`、`…:streamGenerateContent?alt=sse`、`…/models`）剪回 base；只有裸主机补 `/v1beta`，已带版本的不动。客户端把已填地址切到 Gemini 格式时照 magpie `respellURL`：主机后恰为 `/v1` 改 `/v1beta`，裸主机补 `/v1beta`。
- 认证：Gemini 地址一律只发 `x-goog-api-key`，不发 Bearer；接口的 Key header 选项只作用于 Anthropic 地址，不作用于 Gemini。认证头的取值多一种 Gemini 的。

### 翻译层

- 新增 Gemini 协议模块，只做上游方向：把中间格式（IR）的请求构建成 Gemini 请求，把 Gemini 的流解码成 IR 事件，整份回复由已有的「读流拼整份」得到。协议接口现在要求解析、构建、解码、编码、整份五件，Gemini 只有构建与解码；拆接口或让入口方向的函数不可用，由实现时按代码定，不加占位的假实现。
- 请求构建、思考档位、签名、工具、调用 id、轮次修补、图片、参数、用量、结束原因、流的结束、空回复，全部照 magpie 最新（细节与出处见 `research/decisions.md`「翻译细节」），含两处薄弱：只有网址的图片发 `fileData`；名字看不出代数的 Gemini 模型发 `thinkingBudget`。
- 思考签名共用 Osuna 已有的 Gemini 签名存放（存盘、id 里只放短 key、写不进时退回放进 id），不另建一套。IR 里的思考内容不回传给 Gemini，只回传文本与调用上的签名。
- 上游一律走 `streamGenerateContent?alt=sse`；模型名在路径里，去 `models/` 前缀后转义；请求体不带 `model`、`stream`。上游地址的拼法从「固定路径 + 模型在请求体」扩成能按格式把模型放进路径。
- 不设 safetySettings；工具 schema 原样发 `parametersJsonSchema`，不清洗。
- 接口的请求头、附加请求体、上游模型名作用于 Gemini 请求（A3）；附加请求体并进 Gemini 请求体的顶层。
- 被拒后降档重试、关思考的改写不对原生 Gemini 做（A4）。厂商专属改写清单（ADR 0008）不变。
- 代码里「非 Anthropic 即 OpenAI」的二分判断逐个审，照 magpie 定 Gemini 落在哪边；magpie 也没答案的停下来问用户（A5）。

### 选路

- Gemini 排在翻译顺序最后：Chat → Responses → Anthropic → Gemini。现有规则不变：Agent 自己的格式这家有就直通；Claude 模型有 Anthropic 地址时走 Anthropic；「只用这种格式」优先。没有 Agent 说 Gemini，所以 Gemini 永远经翻译到达。
- 「这家自己会联网搜索」的能搜格式加上 Gemini：请求里只有联网搜索、没有别的工具时发 `googleSearch`（G9）；ADR 0009 补注。
- Google Gemini 模板只填 Chat 兼容地址（G7），走现有的 Chat 兼容 Gemini 路径。

### 判错与冷却

- Gemini 错误走现有的状态码 + 词表分类。在此之上加两条（比 magpie 多）：
  - 400 且错误说 key 无效（`API key not valid` / `API_KEY_INVALID`）认作 key 无效：标「需要检查」、换家（G4）。
  - 读 `error.details` 里 RetryInfo 的 `retryDelay` 作为恢复时间，和现有的 Retry-After、重置时间同一优先级规则（G5）。
- 空回复、没见到 finishReason 就断开、安全拦截的处理照 magpie（见 `research/decisions.md`）；拒答不冷却、换下一家，沿用现有拒答规则。
- Gemini 说「没有这个模型」时，按现有规则去掉这个格式再试下一种或下一家。

### 自动识别、测试连接、模型清单

- 自动识别多一个 Gemini 探测：非流式 `POST {base}/models/{m}:generateContent`，带 `x-goog-api-key`，body 照 magpie；模型挑名字带 gemini 的，没有就用第一个。判定要求回复形状像 Gemini（有 `candidates`），与另外三种同一判法（G6）。建议地址的规则按 A1。
- 测试连接、逐个模型多一列 Gemini；「采用这些」把只在 Gemini 下通的模型设成只用 Gemini（同现有规则）。
- 拉清单：Gemini 地址 `GET {base}/models?pageSize=1000` 按 `nextPageToken` 翻页（最多 20 页、每页 8 秒），去 `models/` 前缀，有 `supportedGenerationMethods` 且不含 `generateContent` 的丢掉，读 `inputTokenLimit` / `outputTokenLimit` 进模型资料；和别的格式按 id 合并。
- 旧客户端走的按提供方测试连接不变。

### 导入

- 照 magpie 最新：CC Switch 的 Gemini 条目（有 `GEMINI_API_KEY` / `GOOGLE_API_KEY` 的）收下，`GOOGLE_GEMINI_BASE_URL` 补 `/v1beta`；Alma 的 Gemini 服务商收下，地址原样；导入链接的 `gemini=` 收下，只有 Gemini 地址的链接也收；判断同一家时 Gemini 地址的主机也算。
- daemon 不再发 `gemini_unsupported`、`gemini_only`、`ignoredGemini`；协议里这几个取值按兼容规则保留（旧客户端可能还认），标 `COMPAT` 注明以后删除。客户端删掉对应文案与提示。OpenCode 的 `google` 照 magpie 处理。

### 协议与兼容

- 新字段可选；不新增 RPC；功能开关 `apiEndpointGemini`。
- 官方 Paseo 手机 App 与旧客户端照常工作；ADR 0007 给旧客户端的「单个启用接口」投影不变。
- 旧客户端（没有 Gemini 的 Osuna 版本）打开带 Gemini 地址的接口再保存时，会不会把 Gemini 地址丢掉，工单 ① 里核实并在 PR 说明里写出结果；不为此加兼容分支（G16，用户已定）。

### 文档与术语

- `docs/glossary.md`：Request format、API endpoint 已在访谈时改为四种。实现完再核对 Key header、Use only this format、Each picked model、Failover、Searches the web by itself 等条目里写死三种格式或只提 Anthropic / OpenAI 的说法。
- ADR（G15，不新写，在原文加注明日期的修改说明）：0007「三种格式互译」改四种；0008 请求头与附加请求体也作用于 Gemini 请求；0009 Gemini 算能搜的格式；0013 导入不再忽略 Gemini 地址。
- `docs/data-model.md`：`endpoints.json` 一行写明 `format` 可为 `gemini`，以及装回旧版读不了的风险（G10）。
- 照 magpie 写的 Gemini 翻译、清单、探测、地址规范化的文件顶上留 MIT 声明；`THIRD_PARTY_NOTICES` 补上 `gemini.go`、`codeassist.go`、`gemini_api.go`、`gemini_list.go`、`detect.go` 等对应条目。

## UI and Design

- **方向**：沿用现有接口页与添加窗口的地址框、格式下拉、自动识别结果、逐个模型结果表、导入确认框，不另做样式。遵守 `docs/design.md`、`docs/forms.md`、`docs/hover.md`、`docs/unistyles.md`、`docs/menus.md`、`docs/i18n.md` 与 `.atw/spec/app/frontend/`。
- **用户定过的偏好**：开 / 关一律用 Switch；模型名不用等宽字体；次要操作不用蓝色链接。
- **要有的界面与状态**：
  - 添加窗口与接口页：第四个地址框「Gemini 地址」，占位符 `https://…/v1beta`，框下说明 key 放在 `x-goog-api-key`；只填 Gemini 地址也能保存。
  - 自动识别结果：多一行 Gemini，显示耗时或错误（含「key 无效」）；进行中、成功、失败三种状态，失败留在原处直到重试或关掉。
  - 逐个模型结果表：多一列 Gemini。
  - 模型设置的「只用这种格式」：选项多一个 Gemini（这家有 Gemini 地址时）。
  - 模板清单：「Google Gemini」一行。
  - 导入确认框与导入链接确认框：Gemini 地址照常列出，不再有「不支持 Gemini」的提示。
  - 拉模型清单：Gemini 地址拉清单的进行中、成功、失败；清单为空时有空状态说明。
- **视口**：桌面端宽 1280（浏览器），窄窗口宽 390。原生端免实机验收。截图用无头 Chromium、测试 daemon、本机假中转服务（G14）。
- **界面验收**（看截图就能判断）：
  - 添加窗口在 1280 和 390 下都能看到四个地址框，第四个标为 Gemini 地址（中文界面），占位符以 `/v1beta` 结尾。
  - 只填 Gemini 地址的接口保存后，接口页显示这个地址。
  - 自动识别结果有 Gemini 一行；key 错时这一行写着 key 无效。
  - 逐个模型结果表有 Gemini 一列，宽 390 下表格能横向看全或换行，不被截掉。
  - 模板清单里能找到 Google Gemini。
  - 导入确认框里出现 Gemini 地址，没有「还不支持 Gemini」字样。
  - 中文界面没有残留英文（格式名 Gemini 本身除外）；英文界面没有露出的翻译键名。
  - 宽 390 下，保存、识别等主要操作不被遮住。

## Testing Decisions

- **好测试的标准**：只测外部看得到的行为，即 CLI 收到什么、上游收到什么、RPC 返回什么、界面显示什么；不测内部结构。确定性要求见 `docs/testing.md`。
- **接缝一（主）：daemon 端到端测试**，往现有中转站端到端测试里加一组 Gemini：进程内启动真实 daemon，本机起假 Gemini 上游（按路径里的模型名与 `:streamGenerateContent?alt=sse` 回 SSE），用 fetch 带中转站口令扮演 Claude Code（Anthropic 入口）、Codex（Responses 入口）、Pi / OMP（Chat 入口）。检查：
  - 上游收到的地址、认证头（只有 `x-goog-api-key`）、请求体（角色、systemInstruction、思考配置按代数、签名回传、调用 id、轮次修补、图片、参数、附加请求体）。
  - CLI 收到的流与整份回复（文字、思考、工具调用、用量、结束原因）。
  - 多轮工具调用的签名经存盘后在下一轮带回。
  - 只有 Gemini 地址、两种地址都有时的选格式；「只用这种格式 = Gemini」。
  - 判错：key 无效、`retryDelay`、额度、限流、空回复、中途断开、安全拦截、没有这个模型；每种的冷却与自动切换。
  - 联网搜索：开关打开时发 `googleSearch`。
  - 先例：现有中转站端到端测试与 Chat 入口测试（它们按格式参数化，各自写假上游）。
- **自动识别、测试连接、拉清单、逐个模型、导入**：往现有的识别、测试连接、模型清单、逐个模型、导入的 daemon 端到端测试里加 Gemini 用例，假上游回 Gemini 的探测回复与分页清单、回成功网页的「假 Gemini」、回 key 无效的 400。
- **接缝二：app 浏览器测试**，往第三方接口设置页的浏览器测试里加用例，假中转服务加 Gemini 的探测与清单路由。覆盖：只填 Gemini 地址添加、切格式改写地址、识别结果的 Gemini 行（成功与失败）、逐个模型的 Gemini 列、模板、导入确认框。每个会失败的操作测成功和失败两种。
- **已有的纯逻辑套件继续加用例**：翻译套件旁边加 Gemini 翻译的用例（和 Anthropic、Chat、Responses 的翻译测试并列，同一套件、同一 npm 脚本）；判错套件（key 无效、`retryDelay`）；冷却套件；Gemini 签名套件；导入与地址规范化的套件。不另加 npm 脚本或 CI 任务。
- **不连真实中转服务或 Google**：所有上游都是本机假服务。
- **本机只跑改到的测试文件**，全量交给 CI。

## Out of Scope

- Gemini 入口（给 Gemini CLI 用，01·A13）、Vertex（02·V01–V05）、Code Assist、Antigravity 的 schema 清洗与 Claude-on-Antigravity 规则。
- 粘贴 curl 认出 Gemini 地址与 key（G12，照 magpie 不认）。
- 「Gemini 模型优先走 Gemini 地址」（G3，照 magpie 不加）。
- 给原生 Gemini 做被拒降档重试、关思考改写（A4）。
- 只有网址的图片下载后内联、名字看不出代数时猜档位：magpie 的两处薄弱照搬，不补（G11）。
- 自定义 Models URL（02·A07 的另一半）。
- 「按 CLI 的样子测模型」用 Gemini 地址：CLI 不说 Gemini，不适用。
- 余额查询、中转站账本为 Gemini 另做规则（A7）。

## Acceptance Criteria

- [x] 接口能存四种地址；只填 Gemini 地址的接口能保存、能用；地址按 A1 规范化；新客户端只在 `features.apiEndpointGemini` 存在时显示 Gemini 相关界面。
- [x] Claude Code、Codex、Pi / OMP 三个入口的请求经中转站发到 Gemini 地址：地址、认证头、请求体按本文规则；流式与整份回复都对，含文字、思考、工具调用（含并行）、图片、用量、结束原因。
- [x] 思考档位按代数发 level 或 budget；多轮工具调用的思考签名存盘并在下一轮带回，缺签名时按 skip 规则；Gemini 没给调用 id 时补的 id 两边一致。
- [x] 一家有几种地址时 Gemini 排最后；「只用这种格式 = Gemini」生效；「这家自己会联网搜索」对 Gemini 地址生效。
- [x] 判错：key 无效标「需要检查」并换家；`retryDelay` 作为恢复时间；额度、限流、空回复、中途断开、安全拦截、没有这个模型都按本文处理并自动切换。
- [x] 自动识别多 Gemini 一行，回成功网页的地址不被认成 Gemini；测试连接、逐个模型支持 Gemini；拉清单翻页拉全、去 `models/` 前缀、只留能对话的、带上下文与输出上限。
- [x] 导入 CC Switch、Alma、导入链接时收下 Gemini 地址；同一家不重复导入；「还不支持 Gemini」的提示不再出现。
- [x] Google Gemini 模板出现在模板清单里，地址是 Chat 兼容地址。
- [ ] 官方 Paseo 手机 App 与旧客户端照常工作；旧客户端保存带 Gemini 地址的接口时的行为已核实并写进 PR 说明。
- [x] 界面验收（UI and Design 一节）逐条有截图；9 种语言的 i18n 测试通过。
- [x] 文档：`docs/glossary.md` 相关条目已核对；ADR 0007、0008、0009、0013 加了修改说明；`docs/data-model.md` 写明 `gemini` 与回退风险；`THIRD_PARTY_NOTICES` 与借鉴文件的 MIT 声明齐全。
- [ ] typecheck、lint 通过；改到的测试文件本机通过；PR 的 CI 通过（已知常红的 Nix 两项除外）。

## Further Notes

- **先后**：排在子任务 1（翻译与判错）和子任务 6（Chat 入口）之后，两者都已归档。
- **工单拆法（G13，拆工单时改为 5 张，G17）**：一个 PR，见 `issues/`：01 能存、能填、能导入 Gemini 地址；02 用 Gemini 地址文字对话（等 01）；03 思考、工具、图片、联网搜索（等 02）；04 出错时冷却和自动切换（等 02）；05 自动识别、测试连接、拉清单、逐个模型（等 01）。按 01→05 顺序做。
- **magpie 源码**：临时克隆已删；实现时重新克隆 yetone/magpie 到 `/tmp` 下只读查看。不读 `~/.cache/magpie`、`~/.config/magpie`。本文没写明的细节先查 magpie 并照做；比 magpie 少做或更严一律不行，除非本文写明（G4、G5、G6 是写明的例外）。
- **风险**：Gemini 400 最常见的来源是轮次结构与签名规则（magpie 靠逐个 issue 修出来），工单 ② 的测试要逐条覆盖 `research/decisions.md`「翻译细节」里的修补规则。
