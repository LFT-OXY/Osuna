# 子任务 7 访谈决定（2026-10-24）

依据：magpie 最新 main（7597c132 之后 Gemini 翻译核心文件 `gemini.go`、`codeassist.go`、`gemini_signature.go`、`gemini_api.go`、`gemini_list.go`、`detect.go` 没改过；行号按 7597c132）。临时克隆已删，要看源码时重新克隆 yetone/magpie。Osuna 基准：main `18eeb37b2`。

## magpie 的结构

magpie 发给自定义 Gemini 地址的请求没有单独的构建器：`buildGemini` 套 Code Assist 的构建器再拆外层信封（`internal/gateway/gemini.go:113-140` → `codeassist.go:166`），解码共用 `codeAssistDecoder`（`gateway.go:5706-5710`）。`gemini.go` 的 `parseGemini`、`geminiEncoder` 是 Gemini 入口方向，本任务不做。照搬时只取 Code Assist 构建器里非 Antigravity、非 Code Assist 的分支。

## 第 1 轮

- **G1 起步**：用访谈代替 `/atw-map`。
- **G2 叫法**：格式名「Gemini」，地址框「Gemini base URL」（zh-CN 照现有「<格式> 地址」）。`docs/glossary.md` 的 Request format、API endpoint 已改为四种（访谈时改）。magpie 界面同名：`internal/gui/assets/app.js` 的 PROTOS、`add("Gemini URL", …)`。
- **G3 选格式（照 magpie）**：Gemini 排最后，不加「Gemini 模型优先走 Gemini 地址」。magpie `Speaks()` 把 Gemini 排在 Chat、Responses、Anthropic 之后（`provider.go:1391-1418`），`Native()` 不含 Gemini（`:1509-1531`）；按模型名的偏好只有 GPT → Responses、Claude → Messages（`gateway.go:4660-4675`）；会用 Gemini 地址的情况：只有 Gemini 地址、用户给模型指定了 API（`modelprefs.go:459-476`）、前面的格式都拒了这个模型。
- **G4 key 无效（比 magpie 多）**：Gemini 的 400 `INVALID_ARGUMENT` "API key not valid" 认作 key 无效（Osuna 现在只有 401/403 才算，会漏）。
- **G5 恢复时间（比 magpie 多）**：读 `error.details` 里 RetryInfo 的 `retryDelay`。magpie 不读（ef1a203d 提交说明写明）。
- **G6 自动识别（比 magpie 严，用户选定）**：要求回复形状像 Gemini，与另外三种格式同一判法。magpie 只看 2xx（`internal/provider/test.go:552-563`）。依据：有的中转服务对任何地址都回成功的网页。
- **G7 模板**：照 magpie 加 Google Gemini 模板，只填 Chat 兼容地址 `…/v1beta/openai`（`internal/provider/presets.go:124-127`）。
- **G8 导入（照 magpie 最新 7ea0e047）**：`endpoints` 增加 gemini；CC Switch 的 `GOOGLE_GEMINI_BASE_URL` 经 `geminiCLIBase` 补 `/v1beta`（Gemini CLI 总在 base 后拼 v1beta）；Alma 的 base_url 原样用；319b86fe：判断同一家时 Gemini 地址的主机也算。删掉 Osuna 的 `gemini_unsupported`、`gemini_only`、`ignoredGemini` 跳过与提示（线上取值按协议规则保留，只是 daemon 不再发）。
- **G9 联网搜索（照 magpie）**：Gemini 算能搜的格式；只有联网搜索、没有别的工具时发 `googleSearch`（`codeassist.go:377-381`）。
- **G10 回退旧版**：接受「写进 Gemini 地址后装回旧版，旧版读不了 endpoints.json」，写进 `docs/data-model.md`，不另加存法。原因：Osuna 存储用严格枚举（`store.ts:116,120`），旧版无法修改。
- **G11 翻译细节照 magpie 最新，两处薄弱也照搬**：见下方「翻译细节」。

## 第 2 轮

- **G12 粘贴 curl（照 magpie）**：不认 Gemini。magpie `curlOf` 只认 `/chat/completions`、`/messages`、`/responses`（`app.js` curlOf）。
- **G13 分步**：4 张工单、一个 PR，按 ①→②→③→④。
- **G14 截图**：无头 Chromium + 测试 daemon + 本机假中转服务；不另征求同意。
- **G15 ADR**：不新写；0007、0008、0009、0013 加注明日期的修改说明。

## 写需求时（/atw-spec）

- **G16 旧客户端保存**：旧客户端保存带 Gemini 地址的接口时会不会丢掉它，工单 ① 核实并写进 PR 说明，不加防护代码（用户 2026-10-24）。

- **G17 工单**：原 ② 拆成「文字对话」与「思考、工具、图片、联网搜索」，共 5 张；04 只等 02，05 只等 01（用户 2026-10-24，Q18、Q19）。

## 照 magpie、已告知用户且未被反对

- **A1 地址写法**：切到 Gemini 时 `respellURL`：主机后恰为 `/v1` 改 `/v1beta`，裸主机补 `/v1beta`，其余不动（`app.js` respellURL）。保存时 `GeminiBase`：去首尾空白与末尾 `/`、没协议补 `https://`、粘贴的方法地址（`…/models/x:streamGenerateContent?alt=sse`、`…/models`）剪回 base、只给裸主机补 `/v1beta`（`internal/provider/gemini_api.go:16-31`，`provider.go:1201`）；探测时 `/v1` 改 `/v1beta`（`detect.go:57-58`）。
- **A2 认证**：只发 `x-goog-api-key`，不发 Bearer（Google 把 Bearer 当 OAuth 拒，`test.go:457-462`）；拉清单也一样（`internal/catalog/gemini_list.go:69-71`）。Key header 选项不作用于 Gemini 地址。
- **A3** 接口的请求头、附加请求体、上游模型名也作用于 Gemini 请求。
- **A4** 被拒后降档重试只在 Chat 兼容与 Vertex 上做（`gateway.go:4878-4890,4937`），原生 Gemini 不做；关思考的改写同理。
- **A5** 「非 Anthropic 即 OpenAI」的二分判断逐个照 magpie 定，magpie 也没答案的再问用户。Osuna 里这类判断的清单见总任务调研时的子代理报告，主要在 refused-downgrades、refused-fields、refusals、no-thinking、safety-filter、continuation、reply-clock、grok-integral、vendor-rewrites、template-rewrites、broken-reply、translated（cacheKey）、passthrough、gateway 主文件。
- **A6** Pi / OMP 仍以 Chat 进中转站，配置不改。
- **A7** 余额查询、中转站账本照现有规则。

## 翻译细节（G11 的展开，行号按 7597c132）

请求：
- URL：`GeminiPath` 去 `models/` 前缀后 `url.PathEscape`，拼 `/models/{m}:streamGenerateContent?alt=sse`（`gemini_api.go:38-44`）。上游一律流式（`gateway.go:5610-5611`）；CLI 要整份时读 SSE 拼成整份（`gateway.go:3454-3463`）。请求体去掉 `model`、`stream`（`gateway.go:3636-3641,3988-3993`）。
- 角色：assistant → `model`，其余 `user`（`codeassist.go:185-188`）；`systemInstruction` 不带 role（`codeassist.go:340-342`，`gemini.go:135-137`）；相邻同角色合并（`codeassist.go:313-322`）；带 functionResponse 的 user 轮次里用户文字拆成单独一轮（`:301-312`）；历史以 model 开头时前插 `[Continuing from previous AI thoughts...]`（`:325-331`），以 model 结尾时补一条 user（`:332-338`）。
- 思考：能思考时 `thinkingConfig.includeThoughts: true`（`:583`），没要求思考不发；代数由 `(?:^|/)gemini-(\d+)` 读（`:618-633`）。3 代起（含 `gemini-pro-agent*`）发 `thinkingLevel`：默认 high；low → low；off/none → low（画图模型 high）；medium：Flash 或 3 代以后 → medium，3 代 Pro → high；minimal 只给带档位后缀的 Flash 变体（`:584-603`，52be997b）。其余发 `thinkingBudget = budgetOf(effort)`：low 4096、medium 10000、high 24000、xhigh/max 32000、空 10000（`:605-612`，`ir.go:753-765`）；思考关闭发 4096 不发 0（`ir.go:706-709`）。档位先按模型自己的档位表收敛（`gateway.go:4031-4039`）。
- 签名：上游 `thought:true` 的部分 → 思考，其签名 → 签名事件（`codeassist.go:895-902`）。IR 的思考内容不回传给上游（`:279-280`）；只回传文本部分上的与 functionCall 上的 `thoughtSignature`（`:202-208,223-231`）。一条消息里有调用带签名时，未签名的调用什么都不带；整条都没签名时每个调用填 `skip_thought_signature_validator`（`:28,193-198,223-231`）。签名藏在调用 id：`<id>__ts<n>__<base64url>`，`n` 是长度用来认截断，非标准 base64 用 `__tsr`（`gemini_signature.go:12-124`）；682e4253 起存盘 `gemini-signatures/<key>`，key 是 SHA-256 前 12 字节的 base64url，id 只带 `__tsk16__<key>`，先写临时文件再改名、读时校验哈希、90 天没读清掉、每小时最多清一次，写不进时退回放进 id（`gemini_sigstore.go:14-109`，`gemini_signature.go:63-70`）。Osuna 已有同一套（`gemini-signatures.ts`、存储目录 `gemini-signatures/`），共用。
- 工具：自定义 Gemini 地址发 `parametersJsonSchema`，原样不清洗；没有 schema 补 `{"type":"object","properties":{}}`（`codeassist.go:352-359`）。`plainSchema` 只给 Antigravity，不用。`toolConfig.functionCallingConfig.mode`：required → ANY；指定名字 → ANY + `allowedFunctionNames`；其余 AUTO；`tool_choice=none` 不发工具（`:344,362-376`）。
- 调用 id：上游 functionCall 没 id 时生成 `call_<random>`（`:882-885`）；IR 有 id 就在 functionCall 与 functionResponse 两边都带 `id`（`:219-221,246-248`）。functionResponse 写 `response: {output|error: text}`（`:238-245`）；工具结果里的图片紧跟在对应 functionResponse 后（`:257-277`）。名字去 `default_api:` / `default_api.` 前缀（`:962-970`）；模型把调用写成正文 `call:default_api:x{…}` 时解析回调用（`:958-1014`）。没被回答的调用补合成结果（`pairFunctionTurns`，`:493-552`）；同一调用回答两次只留第一次（`dropSecondAnswers`，`:433-473`）。
- 图片：有内容发 `inlineData{mimeType,data}`，只有网址发 `fileData{mimeType,fileUri}`（`:210-215`）；http 图片 mimeType 为空，可能被拒，magpie 没实测（薄弱一）。
- 其他参数：`maxOutputTokens`、`temperature`、`topP`、`stopSequences`；要 JSON 时 `responseMimeType: application/json`，有 schema 加 `responseJsonSchema`；画图模型加 `responseModalities`（`:384-417`）。不设 safetySettings；topK、penalty、candidateCount 不映射。

回复：
- 用量：`input = promptTokenCount − cachedContentTokenCount`，`cacheRead = cached`，`output = candidatesTokenCount + thoughtsTokenCount`，`reasoning = thoughts`（`codeassist.go:861-865`）；第一个 chunk 随开始事件发 prompt 用量，收到 finishReason 再发完整用量（`:866-876,943-946`）。
- 结束原因：`MAX_TOKENS` → length；`STOP`、`FINISH_REASON_UNSPECIFIED`、`OTHER`、`MALFORMED_FUNCTION_CALL`、`UNEXPECTED_TOOL_CALL` → stop；其余 → filter；发过调用且是 stop 时改 tool（`:937-939,1202-1213`）。
- 流的结束：没有 `[DONE]`，带 finishReason 的 candidate 才算结束；`usageMetadata` 不算；没有 candidate 的 chunk 也算结束、交给空回复逻辑（`continuation.go:67-95`）；没见到 finishReason 就断开 → 回复不完整（`gateway.go:4562-4563,5508-5515`）。
- 空回复：什么都没说、且不是 length / filter 结束的，按 502「an empty reply」重试（`gateway.go:5517-5546`）。59289946：最后一个候选上思考随来随发不暂扣；思考后空回复多重试一次。
- 拒答：`promptFeedback.blockReason`，或 finishReason 属于 SAFETY、PROHIBITED_CONTENT、BLOCKLIST、SPII、IMAGE_SAFETY 且还没输出内容时，按拒答（不冷却、换下一家）（`fallback.go:2486,2495-2505,2730-2758,3044-3051`）。Osuna 的拒答词表已有这几个词。

判错：
- magpie 统一走状态码 + 关键词（`routing.go:283-321`）：`RESOURCE_EXHAUSTED` 只在 5xx 单独判配额；429 文字带 quota / daily → 配额，只带 rate / per minute 或都不带 → 限流（`:136-147,174-179,313-320`）。Osuna 的 `failure.ts` 词表已有 `RESOURCE_EXHAUSTED`；G4、G5 是在此之上加的。

模型清单（`internal/catalog/gemini_list.go`）：
- `GET {base}/models?pageSize=1000`，按 `nextPageToken` 翻页，最多 20 页，每页超时 8 秒（`:23-49,60-62`）；去 `models/` 前缀；有 `supportedGenerationMethods` 且不含 `generateContent` 的丢掉；读 `inputTokenLimit` / `outputTokenLimit`（`:95-105`）。和其他格式的清单按 id 原样合并（`internal/provider/models.go:643-707`）。

探测（Detect）：
- Gemini 是第四个探测的格式（`detect.go:27`）；模型挑名字带 "gemini" 的，找不到用第一个（`detect.go:324-347`）；请求为非流式 `POST {base}/models/{m}:generateContent`，带 `x-goog-api-key`，body `{"contents":[{"role":"user","parts":[{"text":"hi"}]}],"generationConfig":{"maxOutputTokens":16}}`（`test.go:186-193`）。判定按 G6 另加回复形状。

## Osuna 现状要点（2026-10-24 子代理报告，供工单参考）

- 格式枚举只在 protocol 定义一处；线上 `format` 是字符串，存储端是严格枚举。
- 加第四个值后编译会报错的：按格式穷举的 `Record` 与 switch（翻译注册表、上游地址拼接、探测、导入链接、导入别的软件、整份回复拼接、固定档位）。不报错、要人工改的：翻译顺序、模板的地址字段与认证头与格式顺序、能搜的格式、按 CLI 的样子测、余额、各 Agent 的格式、拉清单的认证头、旧客户端测试连接、存储的认证头、翻译出去的请求、直通、中转站主文件，以及 A5 列的二分判断。
- 上游地址现在是「base + 固定路径 + 模型在请求体」，Gemini 的模型在路径里、流式与非流式是两个方法，要改拼法。
- 认证头的取值现在是 both / xApiKey / bearer / apiKey，要加 Gemini 的 `x-goog-api-key`。
- 协议接口要求五件套（解析、构建、解码、编码、整份），Gemini 只做上游，只需构建与解码（含整份）。
- 拉清单现在只认 `data[].id` 与 `models[].slug`、只认 Anthropic 的分页，读 Gemini 清单会得到「成功但空」。
- 已有 Gemini 相关：Chat 兼容地址的签名藏 id（`gemini-signatures.ts`）、`<thought>` 标签与 `extra_content.google.thought`、附加请求体认 `contents`、拒答词表、`RESOURCE_EXHAUSTED`；三处注释写着等子任务 7（模板、导入别的软件、导入链接）。
- 功能开关先例：`server_info.features` 里每个子任务一个（`apiEndpointCliWiring`、`apiEndpointManagement`、`apiEndpointBalance`、`apiEndpointPi`、`apiEndpointOmp`）。
