# 访谈决定（子任务 1：中转站稳健性补齐）

2026-10-16，`/atw-askme-with-docs`，共 3 轮，用户最后回「确定」确认共识。对照基准同总任务：magpie HEAD `7597c132`，Osuna HEAD `21a4f721d`。明细行号用总任务的写法：`01·B05` 指 `../../10-16-magpie-osuna-gaps/research/gap-01-gateway-routing.md` 的 B05 行，`02·` 指 `gap-02`。

术语：「拒收」（Rejected shape）指上游不收请求里的某个写法；「拒答」（Refusal）指安全过滤不肯回答；「已下线模型」（Retired model）。三者与改过的「自动切换」（Failover）已写进 `docs/glossary.md`。

## 对现状的核实（读代码，未运行）

- 同名换家按模型名字面比较：`gateway/routing.ts:54`。
- 「开口」= 2xx 响应头 + 第一段数据：`gateway/upstream-call.ts:116,146`；等响应头最长 10 分钟，期间 CLI 收不到任何字节：`gateway/gateway.ts:49`。
- 开口后上游断流，两条路都直接断开 CLI 的连接：`gateway/passthrough.ts:151`、`gateway/translated.ts:149`；翻译路径上游没说完就结束时照样补上结尾：`gateway/translated.ts:154`。
- 翻译出去的请求不带 User-Agent（请求头从头拼）：`gateway/translated.ts:60-70`；直通原样转发 CLI 的请求头（含 User-Agent、`x-app`、`originator`），只去掉逐跳头、认证头等：`gateway/passthrough.ts` 的 `DROPPED_REQUEST_HEADERS`。
- 直通早已不止换模型名与认证：思考字段、DeepSeek 推理回放、Responses 工具往来修补（`gateway/passthrough.ts` 文件头注释、`gateway/gateway.ts` 的 `mendedBody`）。
- 已有一套「拒收后换写法重问并记住」：`gateway/refusals.ts`（只有 `none`、`thinkingOff` 两种）。
- 翻译已把拒答互转（`refusal` ↔ `content_filter`）：`translation/anthropic.ts:696,708`；不带 `stop_details`。
- 推断（未实测）：拒答若以 403 说出，会被 `failure.ts` 的 `endpointFailure` 判成 `auth`，接口被标「需要检查」。
- 接口文件读不懂就报错、不写不删，没有 `.bak` 回退：`store.ts:173,193`。只有 server 包用 `ApiEndpointStore`，daemon 是唯一写入方。
- 给 Agent 的模型列表都来自 `usableModels` / `endpointModelGroups`：`host-endpoints.ts:53`，用在中转站 `/v1/models`（`gateway/gateway.ts:736`）、Codex 模型目录（`codex-model-catalog.ts:44`）、Osuna 选择器（`service.ts:353`）、快照指纹（`service.ts:1378`）。
- 用户正式环境（`~/.paseo/api-endpoints/endpoints.json`，未读 key）只有 1 家接口，未选模型，两个「使用第三方接口」都关着；推荐因此偏向「照 magpie」。

## 两个 CLI 的行为（后台子代理读源码，未运行 CLI）

来源：Codex `codex-rs` main@`90f00bd`（2026-10-13，关键默认值与 `rust-v0.162.0` 一致）；Claude Code 2.1.299 二进制里的打包 JS 与 code.claude.com 文档；magpie `internal/gateway/fallback.go`、`gateway.go`、`continuation.go`。

| 事实 | 可信度 |
|---|---|
| Claude Code 连自定义地址时，5 分钟内一个字节都没有就被 Bun 掐断（`API_FORCE_IDLE_TIMEOUT=0` 可关），之后按连接错误重发。Osuna 现在等上游最长 10 分钟不发字节，超过 5 分钟就会这样 | 代码已核实；Bun 1.3.14 本机实测 300 s 断；端到端未测 |
| Claude Code 收到开头后：字节看门狗 300 s（要求 `text/event-stream`）；事件看门狗 300 s，`ping` 与注释只按字节算，每 10 s 有新字节算一次合成心跳，最多 30 次 | 已核实；总上限约 10–12 分钟是推算 |
| Claude Code 重试：`CLAUDE_CODE_MAX_RETRIES` 默认 10；重试 408/409/429/5xx/529、连接错误；`retry-after` 超过 60 s 就放弃 | 已核实 |
| Claude Code 已有内容时断流或收到流内错误：保留已显示的部分、不重发，只是提示文字不同。还没内容时：断连重试最多 10 次；`overloaded_error` 重试 3 次后换备用模型或改非流式；`api_error` 立刻改发非流式请求 | 已核实 |
| Claude Code 收到 `stop_reason: refusal` 时，配了拒答备用模型就换模型重答 | 机制已核实；经自定义中转站是否生效未核实 |
| Codex `stream_idle_timeout_ms` 默认 300 000，只在收到响应头后生效；收到响应头前没有任何超时 | 已核实 |
| Codex 不认注释行（SSE 注释被丢弃），只有带非空 `data:` 的事件才重置计时；`response.in_progress` 被显式忽略，但会重置计时 | 已核实 |
| Codex 流没给 `response.completed` 就断、收到 `error` 事件或 `response.failed(server_error)`：整轮重问，最多 5 次（`stream_max_retries`）；`error` 事件的文字不显示，只有 `response.failed` 能把原因带到最终报错；`context_length_exceeded`、额度类、`invalid_prompt` 等 code 直接终止 | 已核实 |
| Codex 只在「ChatGPT 登录 + 服务商名字正好是 `OpenAI`」时 zstd 压缩请求体；Osuna 写的名字是 `Osuna`，现在不压缩 | 已核实 |
| magpie 的数字：15 s 后开始保活、每 15 s 一次（因 Cloudflare 125 s，#947，Osuna 只服务本机不受此限）；上游 5 分钟毫无动静停止保活；Codex 方向累计最多扣 4 分钟（`holdLead`）；翻译回复用协议自带的保活（Anthropic `ping`，Responses `response.in_progress`） | 读 magpie 源码 |

## 决定

### 第 1 轮

- **Q1 拒收后改写重问 → 全做（照 magpie）**。在同一家换写法重问一次，按「接口 + 模型」记住到 daemon 重启，每次记住写一行 info 日志。9 种：
  1. 这个地址说「没有这个模型」→ 用这家另一种请求格式的地址再问（01·B05，magpie `unfit`）；
  2. 「两种认证头不能同时带」的 401 → 只带一种（02·A22 的自动部分）；
  3. 不认 Claude Code 自动模式的审查字段或 `display` 字段 → 去掉（01·B40）；
  4. 说 temperature、top_p 已弃用 → 去掉（01·B42 的被拒部分）；
  5. 不认延后加载工具块（`tool_addition`、`tool_removal`、`tool_reference`）→ 去掉（01·B47 的被拒部分）；
  6. 结构化输出被拒 → 先改 `json_object` 并把 schema 写进 system，再退到只用文字说明（01·B31）；
  7. 以 assistant 结尾（预填）被拒 → 补一个 user 轮（01·B48）；
  8. 工具的 `strict` 被拒 → 去掉（01·B49）；
  9. Codex 的画图工具 `image_gen` 被裸 400 拒 → 去掉（01·B50）。

  01·B19 的「拒收后去掉自造推理项重问」不需要了，见 Q4。推翻 ADR 0007「A rejected request is never re-sent to the same endpoint in a changed shape」，写新 ADR。
- **Q2 按厂商改写 → 只做 Kimi、MiniMax、DeepSeek、Grok**（01·B22 的这几家，含 01·B47、B51 里这几家的部分）。不做 Mistral、Azure、Bedrock、Copilot、ModelScope、Cline、WorkBuddy、Command Code、Kiro、OpenCode Zen；OpenCode Zen 免费模型要冒充 OpenCode，按总任务第 15 条本来就不能做。每家具体改哪几处，写需求时照 magpie 代码逐条列出。
  - 按厂商**读懂报错**不算改写，归判错，照做：智谱用 200 包着的拒绝、智谱不带时区的恢复时间、Command Code 不说原因的 400、Cline 免费模型额度。
  - 02·A75 的「GLM Coding Plan 的 key 填错地址时改问套餐地址并迁移」改的是保存的接口地址，**挪到子任务 3**；「Cline 把 DeepSeek 钉到官方」不做。
- **Q3 拒答 → 照 magpie 换家再问**（01·C05）。开口前的拒答问遍剩下所有有同名模型的接口，不做可调次数；拒答不冷却任何一家、不标「需要检查」；全都拒答时，Claude Code 收到排第一那家的原样拒答（200 + `stop_reason: refusal`，带 `stop_details`），Codex 收到 400；「The request was rejected because it was considered high risk」算拒答。助手原推荐「不换家」，理由写进 ADR：同一模型在别家多半也拒，挨家问多等多花钱；把一家安全过滤拦下的内容转给别家，可能被看作绕过安全检查。用户按 magpie 选择换家。
- **Q4 直通规则改准 → 同意**。新措辞：「直通不翻译；除了换模型名与认证，只做让目标模型收得下、看目标模型而不看是哪家的通用修补；不改请求自称是谁（User-Agent 等表明身份的请求头与字段）」。随新 ADR 改 ADR 0007，并在总任务第 15 条注明。归入通用修补的直通改动：
  - 发给非 Claude 模型时去掉 Claude Code 的计费行（01·B45）与自动模式审查字段（01·B44）；
  - advisor 工具：同一家的 Claude 改成上游模型名，否则连说明一起去掉（01·B46）；
  - 4.6 起只认 adaptive 的 Claude，直通时也改写思考字段（01·B39）；
  - 直通发往 Responses 上游前，一律去掉 Osuna 翻译时自造的推理项（01·B19；与上一轮「历史思考只回原厂」一致）；
  - Responses 工具往来的三处修补（01·B14）。

  计费行发给 Claude 模型时原样保留，不算对 Anthropic 隐瞒身份。
- **Q5 改模型输出 → 两项都做（照 magpie）**：CLI 要 JSON 时剥掉模型包的 ``` 代码块（01·B32）；把 Hermes、DSML、GLM `arg_key` 写法的文字工具调用转成真调用（01·B52）。触发条件照 magpie，写需求时列出。
- **Q6 同一个模型 → 照 magpie 四种都忽略**（01·E02）：版本号里的点、下划线、连字符，厂商前缀，快照日期。发给每家用它自己列出的写法。Osuna 的 `接口标识/模型` 写法优先认作指定某家，其余斜杠前缀才当厂商前缀。
- **Q7 已下线模型 → 照 magpie 全做**（01·C14、02·A65）：记一周，存文件，重启不丢。细节见第 2 轮默认项 2。
- **助手定、用户未反对的默认项（照 magpie，除标明的一条）**：
  1. 判错与冷却：402 只有说用量上限才算额度（01·C09）；认智谱无时区（按北京时间）与「resets in 0h 19min」（01·C10）；防火墙拦截、不说原因的 400 也换家（01·C15）；模型自己的失败计数与整家分开（01·C13）；后面剩下的都在额度冷却时原地再问当前这家（01·C23）；「几点恢复」带时区，复述排第一那家的原话（01·C20，现为最后一家）。
  2. 按厂商读懂报错：见 Q2。
  3. 粘性：缓存写入也算（01·D02）；悄悄缓存的厂商（OpenAI、Gemini）把这轮发出的 prompt 当写入（01·D03）；写过 1 小时缓存的 1 小时内都算（01·D04）；找上次回答者时多比推理档（01·D07）。
  4. 对话太长：发出前跳过已知窗口装不下的候选，窗口未知不跳（01·C18）；估算超过窗口 1.2 倍按超长让 CLI 压缩；中转服务自己的单次输入上限也算超长（01·C17）。**Osuna 自加（magpie 只在路由组里做）**：超长被拒时，后面有已知窗口更大的同名候选就换过去。
  5. 通用修补：Codex 的 `prompt_cache_key`、`include`、`client_metadata`、`text.verbosity` 翻译时带上（01·B34）；推理档按模型真实档位（01·B41）；没给回复上限时按模型公布的上限填，不知道才用 16384（01·B43）；已知不收采样参数的模型不发，新版 Claude 去掉 temperature/top_p/top_k（01·B42）；工具 schema 根是 anyOf/oneOf/allOf 时包成 object（01·B51 的通用部分）；读 `reasoning_details` 与 Vertex 的 `extra_content.google.thought`（01·B17）；翻给 Codex 的回复标 `phase`（01·B55）；Codex 中途改档位用 `configuration_update`（01·B56）。
  6. 回复处理：上游无视流式、回整份 JSON 时转成 Agent 要的流，不是本协议回复的 2xx 当 502 换家（01·B08）；直通也认 HTML 登录页、Cloudflare 挑战页、空体，当 502 换家并冷却，原因写页面标题（01·B09）；流里的错误保留厂商的 type/code/param，Responses 流里的 `invalid_request_error` 读成 400，只靠 `event:` 行命名的错误也认（01·B12）。
  7. 连接与请求体：复用连接被掐（EOF、broken pipe）立刻在新连接重发，不算失败（01·C28）；按 Content-Encoding 解开 zstd/gzip，上限仍 64 MB（按解开后算），413 提示用 `/compact`（01·A33）。
  8. 模型名：`~` 当 `/`（01·F10）；找不到模型时 404 给出最接近的三个 id（01·F11）；Codex 记忆整理与 auto-review 没有对应模型时，用这段对话上一轮的模型（01·F07）。
  9. 数据文件：写坏时改读上一份好的（`.bak`），坏的另存 `.bad-<时间>`，写日志（01·H07、02·A43）；不加跨进程锁（唯一写入方是 daemon）；Windows 上读与改名遇占用短暂重试，最多 0.5 秒（01·H08）。
  10. 不在本任务：更多会话头（01·D10，Pi/OMP 的归子任务 6）；子代理 `x-claude-code-agent-id` 记录（01·D12，归子任务 5；路由组规则不做）；直通推理陷入循环时再问（magpie a0a4d55e，不在本块明细里）。

### 第 2 轮

- **Q8 → 第 3 轮。**
- **Q9 第一组厂商改写的触发条件 → 照 magpie**，不扩大成「看到模型名就改」：Kimi（`api.moonshot.ai`、`api.moonshot.cn`、`api.kimi.com`、`api.kimi.ai` 或 kimi/moonshot 预设）、MiniMax（`minimax.io`、`minimaxi.com`）、DeepSeek（`api.deepseek.com` 或 deepseek 预设）只在直连官方地址时做；Grok 不论谁提供都做（`grok_schema.go`、`grok_integral.go` 的 `grokModel`）。经中转服务碰到 Kimi 那类拒收，由 Q1 接住。
- **Q10 保活 → 两个 CLI 都做（照 magpie）**（01·C03）。等 15 秒先回 200 开头，之后每 15 秒一次；上游 5 分钟毫无动静停止保活，交给 CLI 自己超时。
  - Claude Code 用 `ping` 事件。
  - Codex **必须用真事件** `response.in_progress`，注释会在 300 s 被断。magpie 的 4 分钟上限（`holdLead`）在全程用真事件后还要不要，写需求时对照 magpie 代码定。
  - 200 发出后再失败，在流里补错误事件：Claude Code 收到 `api_error`（它会改发非流式请求，那次能回真实状态码），Codex 收到 `response.failed` + `server_error`。15 秒内失败仍回真实 HTTP 状态码。
  - 助手原推荐只给 Claude Code 保活；用户选两个都做，已知代价：等超过 15 秒才失败的情况，Codex 会自己把整轮重问最多 5 次。
- **Q11 开口 → 只做第一步**（01·C02，不做 01·C04）。开口 = 第一段真内容（文字、思考、工具调用）；之前的帧（`message_start`、`response.created`、`ping` 等）先扣着不发，这期间的出错、空回复、拒答都能换家。思考过程不扣，实时显示。改掉 ADR 0007 与术语表里「before the first byte」的说法（术语表已改）。
  - 空回复（01·B11）：同一家再问一次，还空就当这家失败、换下一家，都空才报 empty reply。
- **Q12 回复到一半断了 → 照 magpie**（01·B10、C26）。
  - 翻译路径不再假装说完：Anthropic 没有 `stop_reason`/`message_stop`、Responses 没有 `response.completed` 的算没说完；Chat 可以不带 `[DONE]`，不算。
  - 翻译回复先「接着写」：把已发出的部分交回上游续写，最多 2 次（magpie `streamRetries`）。条件照 `continuation.go`：上游能从一半接着写（Anthropic 原生支持；Chat 只限厂商自己的预填模式，magpie `prefillHow`）、还没开始任何工具调用、不是拒答、模型没拒过预填。
  - 接不上、或走直通：在流尾补协议内的错误事件，前面先空一行（Claude Code 收到 `api_error`，Codex 收到 `response.failed`），写明哪家、什么原因，文字后加「(<状态码>: you can retry your request)」（为以后接入的 Pi 准备）；收到 `data: [DONE]` 算结束。
- **默认项（用户未反对）**：
  1. Q3 细节：问遍剩下的；不做「最多问几家」设置（要的话放子任务 3）。
  2. Q7 细节：
     - 从所有给 Agent 选模型的列表里拿掉这家的这个模型：中转站 `/v1/models`、Codex 模型目录、Claude Code 的 `modelPicker`、Osuna 的选模型列表。接口页上的已选模型与「默认模型」设置不动。
     - 请求写了 `接口标识/模型` 指定这家的照样发，厂商的回答交给 CLI，答成功一次就恢复。只写模型名的跳过这家；没有别家时回「找不到模型」并给最接近的三个名字（照 magpie）。
     - 本任务只记 daemon 日志；接口页显示交给子任务 5。
  3. 流里补错误时附「状态码 + 可重试」，见 Q12。

### 第 3 轮

- **Q8 User-Agent → 丙**（01·A36）：直通和翻译都原样发 CLI 自己的 User-Agent；CLI 没带的、Osuna 自己发的请求（以后查余额、取汇率）写 `Osuna/<版本>`；子任务 3 的「自定义请求头」里用户自己设的优先。效果等于 magpie 对每家都打开「Send the agent's own User-Agent」。
  - magpie 的做法：默认所有转发都写 `magpie/<版本>`；10-13 加了每家的开关，默认关（提交 `248a6859`，#1851：只服务点名 Agent 的编程套餐靠 User-Agent 认人，把 magpie 挡在外面）；magpie 原则是「从不编造别的客户端的身份」。
  - 选丙不选 magpie 默认的理由：sub2api 的分组可设「只允许 Claude Code 客户端」（`ClaudeCodeOnly`），第一关要求 User-Agent 匹配 `^claude-cli/\d+\.\d+\.\d+`（`Wei-Shaw/sub2api` 的 `backend/internal/service/claude_code_validator.go`，2026-10-16 经 GitHub 读取）。照 magpie 默认，今天经直通能用的这类 key 会被拒，补救开关要等子任务 3 的界面；直通里其他请求头仍说是 Claude Code / Codex，身份前后不一；也和 Q4、总任务第 15 条相反。代价：中转服务看不出中间有 Osuna；翻译后的请求格式不是那个 CLI 会发的，但 User-Agent 写的是它（说的是谁发起的，属实）。
- **共识确认**：用户回「确定」（2026-10-16）。

## 要写的文档

- 新 ADR 一篇，取代 ADR 0007 中被推翻的规则，并在 ADR 0007 里标出：
  - 被拒的请求不改写后重发（→ Q1）；
  - 翻译不做厂商专属改写的例外清单（→ Q2、Q9）；
  - 开口是第一个字节、开口前 CLI 收不到字节（→ Q10、Q11）；
  - 拒答的处理（→ Q3）；
  - 已下线模型落盘（冷却本身仍只在内存，→ Q7）；
  - 直通措辞与 User-Agent（→ Q4、Q8，并在总任务第 15 条注明）。
- `docs/glossary.md`：已改「自动切换」，新增「拒答」「拒收」「已下线模型」（本次访谈中写入）。
- `docs/data-model.md`：加已下线模型的记录文件、`.bak` / `.bad-<时间>` 规则。
- 借鉴 magpie 的新文件保留 MIT 声明，`THIRD_PARTY_NOTICES` 覆盖。

## 交给别的子任务

- **子任务 2**：第 22 条只剩「往 Claude Code 的模型列表里写什么名字」（中转站这边由 Q6 覆盖）。改用 OpenAI 自带服务商接 Codex 后，Codex 会发 zstd 压缩的请求，依赖本任务的解压。
- **子任务 3**：GLM Coding Plan 地址迁移（02·A75）；key 放哪个请求头（02·A22 的可选部分）；手改推理档位与回复上限、「不发任何推理字段」开关（01·B41、B43 的用户设置）；拒答后最多问几家（如果要）；自定义请求头里用户设的 User-Agent 优先于 Q8。
- **子任务 5**：接口页显示已下线模型与模型级冷却；记录 Claude Code 子代理是谁（01·D12）。
- **子任务 6**：Pi、OMP 的会话头（01·D10）；流里错误附的「可重试」文字是给 Pi 看的。

## 不做

- 思考过程先扣住（01·C04）；直通推理陷入循环时重问；第二组厂商的改写；路由组相关（01·D12 的 firstWords）；任何界面改动。
