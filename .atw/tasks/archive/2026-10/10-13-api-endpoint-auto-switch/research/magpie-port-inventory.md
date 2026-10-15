# magpie 移植清单：判错词表、冷却常量、粘性规则、协议转换与测试样本

来源：`/Users/oxy/Documents/Configuration/dev-environment/demo/agent客户端源码/magpie`（MIT，只读）。调研日期 2026-10-13。所有 `文件:行号` 均指该仓库 `internal/gateway/` 下的文件，除非另有包名前缀。背景与总体设计见 `research/magpie.md`，本文只抄票里要的细节，不做取舍。

正则与常量**原文抄录**（Go 原始字符串，反引号内就是正则本身）；伪代码为简体中文注释；IR 结构抄成 TypeScript 接口草稿。

---

## 1. 判错

### 1.1 词表正则（`routing.go:124-168`）

```go
var (
	// creditWords: the account or key has no money left.
	creditWords = regexp.MustCompile(`(?i)insufficient.?(balance|credit|fund)|balance|credit|billing|payment|arrear|overdue|suspended|余额|欠费|充值|账户.*(不足|停)`)
	// brokeWords: a 429 that says the balance itself is spent
	brokeWords = regexp.MustCompile(`(?i)insufficient.?(balance|credit|fund)|\bcredits? (are )?exhausted\b|余额不足|欠费|请充值`)
	// quotaWords: it has used up what its plan allows for now.
	usedUpWords = regexp.MustCompile(`(?i)quota|usage.?limit|out of budget|budget (exceeded|exhausted)|limit.?reached|hit your .*limit|limit.{0,24}resets|exceeded.*(plan|limit)|额度|用量|套餐|上限`)
	// rateWords: a 429 that is a short rate limit — requests or tokens per minute
	rateWords = regexp.MustCompile(`(?i)rate.?limit|too many requests|per.?(second|sec|minute|min)\b|\b[rt]pm\b|频率|太频繁`)
	// plannedWords: a 429 that says the plan's own allowance is used, rate words or not
	plannedWords = regexp.MustCompile(`(?i)quota|usage.?limit|hit your .*limit|limit.{0,24}resets|per.?(day|week|month)|daily|weekly|monthly|额度|用量|套餐|限额已用完`)
	// resetsWords: Claude Code's "usage limit reached|<when it resets>".
	resetsWords = regexp.MustCompile(`(?i)limit reached\|(\d{10})\b`)
	// resetsWhen: a 429 that says in words when the account is back
	resetsWhen = regexp.MustCompile(`(?i)(?:\bresets? at|将在|将于)\s*(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2}):(\d{2})\s*(?:UTC|GMT)([+-])(\d{1,2})(?::?(\d{2}))?(?:\s*(?:重置|[,.;，。；]))`)
	// otherModels: a refusal that says the account's other models still answer
	otherModels = regexp.MustCompile(`(?i)switch(?:ing)? to (?:the )?other models?|切换(?:到)?其他模型`)
	// quotaCodes: a vendor's own code for a used-up allowance, which alone makes a 5xx one over the quota
	quotaCodes = regexp.MustCompile(`(?i)limit reached\|\d{10}\b|usage_limit_reached|RESOURCE_EXHAUSTED`)
)
```

注释里提到的厂商例子（均出自 `routing.go:124-168` 原注释）：

| 正则 | 厂商例子 |
|---|---|
| `creditWords` | 402 通用；中文"余额/欠费/充值/账户不足" |
| `brokeWords` | 智谱 GLM Coding Plan key 打到按量端点：429 `1113 "余额不足或无可用资源包，请充值"`；WorkBuddy 429 `14018 "Credits exhausted. Please visit the link below to purchase add-on packs…"` |
| `usedUpWords` | 任何 4xx 含 quota / usage limit / "额度 / 用量 / 套餐 / 上限" |
| `rateWords` | 曾把 "Rate limit exceeded" 误判成套餐用完而冷却 15 分钟（#153），故单列 |
| `plannedWords` | sub2api key 的 5 小时 / 日 / 7 日限额："api key 7天限额已用完"（以 `rate_limit_exceeded` 发出）；"a day's free requests" |
| `resetsWords` | Claude Code 的 `usage limit reached\|<unix>` |
| `resetsWhen` | WorkBuddy 两种构建：`将在 2026-10-11 20:16:02 UTC+8重置`、`your usage will reset at 2026-10-11 12:37:53 UTC+8, ...`（#1669）。只认"带整日期时间 + 时区偏移 + 紧跟 重置/标点"的写法，被截断的 "UTC+" 不算 |
| `otherModels` | WorkBuddy `您也可以切换其他模型继续使用` → 只冷却该模型 |
| `quotaCodes` | Claude Code 的 resets 行、ChatGPT 后端 `usage_limit_reached`、Google `RESOURCE_EXHAUSTED`。**反例**：中转站 500 `当前模型 … 负载已经达到上限，请稍后重试` 是负载上限不是套餐（#1418），5xx 只认 code 不认词 |

辅助正则（`routing.go:232`、`gateway.go:5834-5866`）：

```go
// routing.go:232 — 代理本身连不上
var proxyDown = regexp.MustCompile(`proxyconnect |socks connect `)

// gateway.go:5834 — 上下文超长（第二行来自 pi 的 overflow.ts 收集）
var tooLongRe = regexp.MustCompile(`(?i)context_length_exceeded|prompt is too long|input is too long|(exceeds?|exceeded|over|beyond)( the)?( model'?s?)?( maximum)? context|context (length|limit|window) (exceeded|is exceeded)|maximum context length|too many (input |prompt )?tokens|上下文(长度)?(超|过长)|超(过|出)(了)?(模型)?(的)?(最大)?上下文` +
	`|input token count.*exceeds the maximum|maximum prompt length is \d|reduce the length of the messages|maximum allowed input length|longer than the model'?s context length|available context size|greater than the context length|prompt token count of [\d,]+ exceeds the limit|context window exceeds limit|exceeded model token limit|configured context size|prompt too long|prompt exceeds max length|context_window_exceeded|exceeded (max |maximum )?context length|range of input length should be|token limit exceeded`)

// gateway.go:5866 — 速率类措辞，排除出 tooLong
var paceWords = regexp.MustCompile(`(?i)rate.?limit|per (minute|hour|day)|\bTP[MD]\b|please wait|try again later|throttl`)
```

`fallback.go` 里给 `retryable` / `modelRefused` 用的词表（`fallback.go:932-1050`）：

```go
// fallback.go:932 — 额度/余额/限流任一（比 routing.go 的宽）
var quotaWords = regexp.MustCompile(`(?i)quota|insufficient|balance|credit|billing|out of budget|budget (exceeded|exhausted)|exceeded|rate.?limit|usage.?limit|limit.?reached|hit your .*limit|limit.{0,24}resets|too many requests|overloaded|余额|额度|欠费|限流|频率|套餐|用量|上限`)
// fallback.go:936 — 该 key / 套餐不提供此模型
var unservedWords = regexp.MustCompile(`(?i)model.{0,80}(not (supported|accessible|available|found|enabled|allowed)|unsupported|does ?n[o']t exist|unknown|invalid)|(no such|unknown|invalid|unsupported) model|model_not_found|模型.{0,12}(不存在|不支持|无权|未开通)`)
// fallback.go:968 — 模型已退役
var retiredWords = regexp.MustCompile(`(?i)"ModelDeprecated"|model_deprecated|model.{0,80}(has been|was|is now|is) (deprecated|retired|discontinued|decommissioned|sunset)`)
// fallback.go:996 — OpenCode Zen 的 401 "Model X is not supported"
var zenModelGone = regexp.MustCompile(`(^|[\s:"])Model [^"\s]+ is not supported("|\s*$)`)
// fallback.go:1001 — 厂商拒收此客户端（WorkBuddy 对别家 system prompt）
var refusedWords = regexp.MustCompile(`(?i)unapproved channel|illegal api invocation`)
// fallback.go:1016 — 请求形状不被识别
var shapeWords = regexp.MustCompile(`(?i)failed to deserialize|unknown (item |content |input )?(type|variant|field|parameter)|unknown_parameter|unrecognized (request argument|field|parameter)|extra (inputs|fields) are not permitted|additional properties are not allowed|schema exceeds the maximum (nesting )?depth|schema[^"]{0,60}\bnesting depth\b`)
// fallback.go:1036 — 地区不支持
var regionWords = regexp.MustCompile(`(?i)\buser location is not supported for the api use\b|unsupported_country_region_territory|country, region,? or territory not supported`)
// fallback.go:1050
var protectionWords = regexp.MustCompile(`(?i)response protection is unavailable`)
```

厂商例子（原注释）：`unservedWords` — DeepSeek key 对 `deepseek-v4.1-flash` 答 "model is not available in the current token plan"（#1235）；`retiredWords` — OpenCode Zen 410 `{"type":"error","error":{"type":"ModelDeprecated","message":"Model exo-free has been deprecated."}}`、OpenAI "The model … has been deprecated"；`zenModelGone` — Zen 401 `{"type":"error","error":{"type":"ModelError","message":"Model glm-5-free is not supported"}}`（2026-10-10 免费榜下线后）；`refusedWords` — WorkBuddy "Illegal API invocation from an unapproved channel"；`shapeWords` — #350；`regionWords` — 阿里云 405 挡在 zcode.z.ai 前等。

### 1.2 匹配前的预处理 `wordsOf`（`routing.go:240-265`）

```
函数 wordsOf(body):
  若 body 不含 `\u` → 原样返回
  尝试 JSON 解析；失败 → 原样返回
  out = body 原文
  递归遍历 JSON：遇到字符串就追加 "\n" + 该字符串到 out
  返回 out
  // 目的：Python json.dumps 默认把中文转义成 \uXXXX，"用量""频率""将在…重置" 要解码后也能匹配（#1669）
```

### 1.3 错误分类常量（`routing.go:170-224`）

```go
const (
	failCredit = "credit"
	failQuota  = "quota"
	failRate   = "rate"
	failOther  = "other"
	failAuth   = "auth"
	failCanceled = "canceled"   // Agent 在答复前断开
	failForeign  = "foreign"    // 对话里的推理块是别的账号封的，去掉后重发
	failFloor    = "floor"      // 要求的输出比厂商最小值还短，按最小值重发
	failUpdate   = "update"     // 上游不收 configuration_update 项（#617），去掉后重发
	failVerify   = "verify"     // 账号要先去厂商验证（Google VALIDATION_REQUIRED）
	failRefused  = "refused"    // 安全过滤器拒答（#248）：问下一个，谁也不冷却
	failShape    = "shape"      // 厂商读不懂请求形状（#350）：问下一个，谁也不冷却
	failPrompt   = "prompt"     // 厂商拒收 Agent 的 system prompt：问下一个（同伴最后），谁也不冷却
	failEffort   = "effort"     // 套餐不支持该推理档位（#520）：问别的账号，谁也不冷却
	failProxy    = "proxy"      // 代理没连上（#381）：没到厂商，问下一个，谁也不冷却
	failOverflow = "overflow"   // 对话超过该模型上下文（#700）：问有余量的成员，谁也不冷却
	failSlow     = "slow"       // 组的 FirstToken 超时前没开口：问下一个，谁也不冷却
	failLoop     = "loop"       // 回复陷入循环被截断（#1359）：告诉 Agent，谁也不冷却
	failRestricted = "restricted" // 厂商限制了账号本身（WorkBuddy 403 11140）：冷却 restrictedRest
)
```

### 1.4 `failure()` 归类顺序（`routing.go:268-299`，`failureOf` `:304-316`）

```
函数 failureOf(候选 c, status, body):
  若 status ≥ 400 且 c 是 Claude 订阅账号 且 provider.ClaudeSignInRequired(body) → "auth"
  若 c 的订阅被厂商吊销 且 provider.SignInRevoked(status, body)            → "auth"
  若 restrictedRefused(c.p, status, body)   // magpie 自己的 WBRestrictedHint 字样，或 WorkBuddy 账号的 11140
                                              → "restricted"
  返回 failure(status, body)

函数 failure(status, body):                                // 顺序即优先级
  1. status == 502 且 proxyDown 匹配                        → "proxy"
  2. provider.Verification(body) 命中 且 status ∈ {401,403} → "verify"
  body = wordsOf(body)
  3. restrictedSaid(status, body)                          → "restricted"   // status≥400 且含 provider.WBRestrictedHint
  4. overflowed(status, body)                              → "other"        // Kimi "exceeded model token limit" 是对话太长不是套餐
  5. status == 402
     或 (creditWords 匹配 且 (status ≠ 429 或 brokeWords 匹配))
     或 body 含 "insufficient_quota"                       → "credit"
  6. status == 429 且 resetsWhen 匹配                       → "quota"        // 说了几点恢复，不论中英文
  7. status == 429 且 rateWords 匹配 且 !plannedWords 匹配   → "rate"
  8. (status ≥ 500 且 quotaCodes 匹配)
     或 (status < 500 且 usedUpWords 匹配)
     或 (status == 429 且 plannedWords 匹配)                → "quota"
  9. status == 429                                         → "rate"
  否则                                                     → "other"
```

`overflowed`（`gateway.go:5840-5844`）= `status ∈ {400,413,422}` 且 `tooLong(status, wordsOf(body))`；`tooLong`（`:5851-5863`）：status 不在 400-499 或为 429 → false；消息含 `max_tokens` / `max_output_tokens` / `max_completion_tokens` → false；`paceWords` 匹配 → false；否则 `tooLongRe` 匹配。

### 1.5 `retryable()` 判定表（`fallback.go:1075-1100`）

```
函数 retryable(status, body) → 是否值得换下一个候选:
  body = wordsOf(body)
  overflowed(status, body)                                   → false  // 每个账号都装不下，让 Agent 压缩
  status ∈ {401, 402, 403, 404, 408, 429} 或 status ≥ 500     → true
  modelRetired(status, body)                                 → true   // 别家可能还提供该模型
  status ≥ 400 且 provider.EdgeBlocked(body)                  → true   // 厂商防火墙挡了本地址，别家走别的路
  status ∈ {400, 422}  → quotaWords ∨ unservedWords ∨ refusedWords ∨ shapeWords ∨ regionWords 任一匹配
  其他                                                       → false
```

| status | 结论 |
|---|---|
| 401 / 402 / 403 / 404 / 408 / 429 / 5xx | 换 |
| 400 / 413 / 422 且 overflowed | 不换（直接回给 Agent） |
| 400 / 404 / 410 / 422（及 Zen 的 401）且 retiredWords | 换 |
| ≥400 且 EdgeBlocked | 换 |
| 400 / 422 | 仅当 quota / unserved / refused / shape / region 词命中才换 |
| 其余 4xx | 不换 |

配套：`lateRests(msg)`（`fallback.go:1108-1110`）— 流中途断掉时是否冷却账号：`!tooLong(400,msg) && !refusedWords && !protectionWords && !contains(emptyReply)`；`emptyReply = "an empty reply (the model answered nothing; try again)"`（`gateway.go:4956`）。

### 1.6 `modelRefused` / `modelRetired`（`fallback.go:945-985`）

```
函数 modelRetired(status, body):
  status ∈ {400, 404, 410, 422} → 继续
  status == 401                 → 返回 zenModelGone 匹配          // Zen 用 401 说模型下线，key 本身没问题
  其他                          → false
  body = wordsOf(body)
  返回 retiredWords 匹配 且 !quotaWords 匹配

函数 modelRefused(status, body):                // 只冷却该模型（restID），key 的其他模型照常
  modelRetired(status, body) → true
  status ∉ {400, 403, 404, 422} → false
  body = wordsOf(body)
  返回 unservedWords 匹配 且 !quotaWords 匹配 且 !refusedWords 匹配
```

---

## 2. 冷却

### 2.1 时长常量（`routing.go:90-122`，`fallback.go:36`，`routing.go:502`，`fallback.go:1166-1181`）

```go
// fallback.go:36
const fallbackCooldown = time.Minute

// routing.go:90-122
const (
	creditRest  = 30 * time.Minute // out of credit: until someone tops it up
	quotaRest   = 15 * time.Minute // out of quota, with no word of when it resets
	longestWait = time.Hour        // the most a vendor's own "try again at" is trusted
	longestQuota = 8 * 24 * time.Hour  // a week's window, and a day over
	longestRetry = 10 * time.Minute // failing again and again
	longestRateRest = 30 * time.Minute
	rateForget = 30 * time.Minute   // 上次限流冷却结束后超过这么久再限流，算新的一次，从 1 分钟重来
	verifyRest = 30 * time.Minute
	verifyHold = time.Minute
	restrictedRest = 2 * time.Hour
)

// routing.go:502 — 文字写明的重置时间最远信多久
const longestWritten = 7 * 24 * time.Hour

// fallback.go:1166-1181 — 最后一个候选的原地重试
const (
	lastRetries  = 2
	rateRetries  = 3
	longestPause = 8 * time.Second
)
var retryPause = time.Second
```

其他相关常量：`lowShare = 90`、`usedShare = provider.SpentShare = 98`（`routing.go:828-831`，`internal/provider/codex_switch.go:50`）；`SpentShareOf(routing)` 在 `order` 模式返回 100（`codex_switch.go:56-60`）。

### 2.2 `Rest` 结构（`routing.go:373-395`）

```go
type Rest struct {
	Why    string    `json:"why"`    // failCredit, failQuota, failRate, failOther
	Status int       `json:"status"` // what it answered
	Until  time.Time `json:"until"`
	// By: "credit" / "retry-after" / "resets" / "window" / "quota" / "cooldown" / "backoff" / "restricted"
	By       string `json:"by"`
	Failures int    `json:"failures,omitempty"` // in a row, for a backoff
	Key string `json:"key,omitempty"`           // what it rests by, for Unrest
	Link string `json:"link,omitempty"`         // failVerify 的验证链接
	agent, user string                          // 订阅账号；key 时 agent=""、user=KeyAllowanceID
	said        string                          // 厂商原话，quotaHeld 原样回给 Agent
	hold        time.Time                       // failVerify 在此之前不再问直接答
}
```

冷却存在内存 `restingUntil.m[key]=Until` 与 `restingUntil.note[key]=Rest`（`routing.go:80-87`）。冷却键：`restKey()` = 订阅账号 `providerID@user`（小写）否则 `c.rest`（provider id 或 `id#key`）；`restID()` = `restKey() + "/" + model`（`fallback.go:92-116`）。

### 2.3 `restAfterMarked` 决策顺序（`routing.go:545-674`）

```
函数 restAfterMarked(c, status, header, body, sharedPool) → Rest:
  now = 现在；d = fallbackCooldown(1 分钟)
  why = failureOf(c, status, body)
  pooled   = why == "quota" 且 c.pooled(now)             // 订阅的额度池只算部分模型：只冷却该模型
  unserved = why == "other" 且 modelRefused(status, body) // 套餐不含此模型：只冷却该模型
  r = Rest{Why: why, Status: status, By: "cooldown"}

  若 why == "proxy" → 直接返回 r（不记冷却，账号没事）
  若 why ∈ {"credit","quota"} → r.said = provider.APIError(body, 状态短语)   // 留给 quotaHeld 复述

  按 why 分支：
    "credit":     d = creditRest(30 分钟), By = "credit"
    "quota":      d = quotaRest(15 分钟), By = "quota"
                  若 provider 自设 QuotaRestFor() > 0 → d = 它                      // #1772 Ollama Cloud 周限额
                  依次取第一个 > 0 的：
                    resetsAt(body, now)      → By = "resets"   // Claude Code resets 行 / ChatGPT resets_at / 文字日期
                    resetsNoted(header, now) → By = "resets"   // keepRetry 记在 X-Magpie-Resets-At 头里的
                    c.full(now) 非零         → d = 已知额度窗口重置时间 - now, By = "window"
                    retryAfter(header, now)  → By = "retry-after"
                  d = min(d, longestQuota = 8 天)
    "rate":       (d, By, Failures) = rateRest(...)               // 见 2.4
                  若 c.full(now) 为零 且 !(OpenRouter 免费模型 且 sharedPool) → sink(c.restKey(), now)  // 有额度却被限流：沉到队尾
    "restricted": d = restrictedRest(2 小时), By = "restricted"
    "verify":     d = verifyRest(30 分钟), By = "verify"; r.said = 厂商原话, r.hold = now + verifyHold(1 分钟); r.Link = 验证链接
    默认(other/auth/…):
                  counted = unserved ? c.restID() : c.restKey()
                  routed.failures[counted]++ ; n = 该计数
                  d = min(fallbackCooldown << min(n-1, 10), longestRetry=10 分钟), By = "backoff", Failures = n
                  若 c.full(now) 非零 且 c 是订阅账号 且 !unserved
                     → d = min(窗口重置 - now, longestQuota), By = "window"   // 订阅且窗口已满：不管它说什么都按窗口

  // 通知额度读取器重新读
  若 c 是订阅账号 且 why ∉ {other, verify, restricted} → staleAllowance(agent, user)
  否则 若 c 是 key 且 why ∉ {other, verify, restricted} → staleKeyAllowance(c.p)

  r.Until = now + d
  若 订阅账号 → r.agent, r.user = 账号
  否则 若 why == "quota" → r.user = provider.KeyAllowanceID(c.p)   // key 的窗口被读到不再满时提前恢复

  // 决定冷却键：整个账号/key 还是只该模型
  id = c.restKey()
  若 why == "rate" 且 OpenRouter 免费模型 且 sharedPool          → id = c.restID()
  若 pooled 或 unserved
     或 (why == "quota" 且 resetsWhen 匹配 且 otherModels 匹配)  → id = c.restID()   // WorkBuddy "您也可以切换其他模型"
  若 why ∈ {credit, quota} 且 c.p.PaidBesideFree(c.model)       → id = c.restID()   // 付费模型没额度，免费模型照常
  r.Key = id
  restingUntil.m[id] = r.Until; restingUntil.note[id] = r
  返回 r
```

辅助函数：

- `resetsAt(body, now)`（`routing.go:487-497`）：`resetsWords` 的 unix 秒 → `resetsIn`（ChatGPT `{"error":{"resets_at":<unix>,"resets_in_seconds":<n>}}`，`:466-481`）→ `resetsWritten`（`resetsWhen` 文字日期，自带时区偏移；偏移小时 > 14 或分钟 > 59、日期进位、已过去、超过 `longestWritten` 7 天均返回 0，`:508-536`）。
- `retryAfter(header, now)`（`routing.go:794-820`）：`Retry-After`（秒数或 HTTP 日期）；若无，再扫所有同时含 `ratelimit` 与 `reset` 的小写头名（OpenAI / Anthropic 风格），值按 RFC3339 / Go duration / unix 秒（>1e9）解析；结果 `min(d, longestWait = 1 小时)`。
- `resetsNoted(header, now)`（`:784-790`）：读 `X-Magpie-Resets-At`（unix 秒），是 keepRetry 阶段记下的。
- 提前恢复：`renewed(agent, user)`（`:398-408`）只清 `Why == quota` 或 `By == "window"` 的；`clearRest`（`:82-87`）答复成功即清；`Unrest` / `UnrestAll`（`:427-450`）手动。

### 2.4 `rateRest` 退避公式（`routing.go:685-722`）

```
函数 rateRest(c, header, body, sharedPool, now) → (d, by, n):
  id = c.restKey()；OpenRouter 免费模型且 sharedPool → id = c.restID()
  n = 1
  若 note[id] 存在 且 prev.Why == "rate":
      until = m[id]
      now < until                   → n = max(prev.Failures, 1)        // 还在冷却中又失败：计数不变（一次请求自己的重试不拉长）
      now - until < rateForget(30m) → n = max(prev.Failures, 1) + 1    // 冷却刚结束又限流：翻倍
      // 超过 30 分钟：n 回到 1
  d = min(fallbackCooldown << min(n-1, 10), longestRateRest=30 分钟)   // 1m, 2m, 4m, 8m, 16m, 30m…
  by = n > 1 ? "backoff" : "cooldown"
  // 厂商自己说的时间，取最大者，且只在 ≥ d 时覆盖
  said, saidBy = retryAfter(header, now), "retry-after"               // 已被 longestWait 截到 1 小时
  若 resetsNoted(header, now) > said → said = min(它, longestQuota), saidBy = "resets"
  若 resetsAt(body, now)      > said → said = min(它, longestQuota), saidBy = "resets"
  若 said > 0 且 said ≥ d → d, by = said, saidBy
  返回 d, by, n
```

### 2.5 `passing` 原地重试规则（`fallback.go:1185-1205`）与调用点

```
函数 passing(status, header, body, again) → (等待时长, 是否再试):
  wait = retryPause << again                 // 1s, 2s, 4s…
  若 retryAfter(header) > 0 → wait = 它
  wait > longestPause(8s)                                  → (0, false)   // 等太久，直接把错误给 Agent
  status ∈ {408, 500, 502, 503, 504, 529}                  → (wait, again < lastRetries=2)
  status == 429 → (wait, again < rateRetries=3
                          且 failure(status, body) == "rate"
                          且 !creditWords.Match(wordsOf(body)))          // 套餐用完或没钱不会几秒内好
  其他                                                     → (0, false)
```

调用点（`gateway.go` 主循环）：

1. `:2648` — 不是最后一个候选，但后面剩下的全在额度/余额冷却中（`spentAfter(cands[i+1:])`，`fallback.go:857`）：当前这个当作"最后一个"原地重试（`again++`，`i--`，`continue`）。
2. `:2700` — 不是最后一个、失败：`restAfterMarked` 冷却后 `continue` 到下一个候选。
3. `:2709` — 是最后一个、组设了 Patience、`busy(status, body)`（`patience.go:49-57`：408/5xx/529 且 failure==other；或 429 且 failure==rate 且无 creditWords）：按 `replan` 等一轮再把恢复的成员排上来重问（本任务不做路由组，仅记录）。
4. `:2743` — 是最后一个（`last`）、`passing` 说可以：等 `wait` 后同一个再试，`again++`；Agent 取消则 499。

### 2.6 `quotaHeld`「全在冷却时不再请求」（`fallback.go:816-838`）

```
函数 quotaHeld(cs) → (首个候选的 Rest, 最早恢复时间, 是否成立):
  对每个候选 c（按顺序）:
    r = restingOf(c)                       // 先按 restKey 再按 restID 查；key 若因窗口冷却则顺手重读窗口
    若 不在冷却
       或 c 是订阅账号                      // 订阅不扣：可能自己花 reset，窗口会重读
       或 r.Why ∉ {quota, credit}
       或 !quotaStatus(r.Status)            // 只认 429 / 402
       或 r.said == ""                      // 没留厂商原话
       → 返回 (空, 零, false)
    i == 0 → first = r
    back = min(back, r.Until)
  返回 (first, back, len(cs) > 0)
```

成立时（`gateway.go:1976-1981, 2177-2187`，见 `research/magpie.md`）：不请求上游，把 `first.said` 原样回给 Agent，附 "(out of its allowance: not asked again before HH:MM)" 与 `Retry-After`。

相关排序：`restLast`（`fallback.go:727-746`）把冷却中的候选排到后面（只剩一个时照样请求）；`probeOne`（`:761-797`）冷却中的候选一个请求只保留最早恢复的那一个，就绪的全保留。

---

## 3. 粘性（Affinity）

### 3.1 常量与模式（`affinity.go:39-49`，`internal/provider/group.go:54-62`）

```go
const (
	cacheWorth = 1024              // 上次从厂商缓存读到 ≥ 这么多 token 才值得跨轮粘
	cacheCold  = 5 * time.Minute   // Anthropic / OpenAI 最短缓存存活
	stickKeep  = 24 * time.Hour    // 记住上次回答者多久
	sticksKept = 512               // affinity.json 最多存多少条对话
)
const heldFor = 30 * time.Minute   // affinity.go:430 — 对话多久内算仍"占着"某账号（leastHeld 用）

// provider/group.go
AffinitySession = "session"
AffinityTurn    = "turn"
AffinityOff     = "off"
AffinityStrict  = "strict"
// "" 为默认 auto
```

`Affinity` 结构（`affinity.go:53-69`）字段：`Mode, Turn, Within, Last, LastTurn, At, CacheRead, Kept, Why`；`Why` 取值 `session / turn / cache / strict / off / first / new-turn / no-cache / cold / resting / spent / gone`。

`stick`（`:71-79`）：`rest, who, model, effort, turn, at, cacheRead`。

### 3.2 `affine` 判定表（`affinity.go:337-405`）

```
函数 affine(scope, mode, rotate, 请求头, 协议, body, 候选 cs, 计划 pl):
  key = scope + "|" + conversationID(请求头, body)          // scope = "provider/model" 或 "group/<id>"
  a.Turn, a.Within = turnOf(协议, body)
  st, had = 查 sticks[key]
  若 had 且 now - st.at > stickKeep(24h) → had = false

  // 找上次回答者在本次候选里的位置：先精确到 账号+模型+effort，再 账号+模型，最后只账号
  at = -1
  按三级 same() 依次扫描 cs，第一个命中的 i → at = i, a.Last = c.rest

  a.Why 按顺序判定（第一个成立的）：
    1. mode == "off"                                       → "off"
    2. !had（没人答过）                                     → "first"
    3. at < 0（上次那家已不在候选里）                         → "gone"
    4. mode == "strict"                                    → "strict"      // 不管冷却/用完/封顶都只问它（#1797）
    5. pl.order[at].Rest != nil（上次那家在冷却）             → "resting"
    6. at > 0 且 pl.order[at].Known 且 Used ≥ SpentShareOf(routing)（≥98%，order 模式 100）
                                                           → "spent"       // 已被排到别人后面且几乎用完；at==0 时仍留在首位
    7. mode == "session"                                   → "session"
    8. a.Within（同一轮内，Agent 在回传工具结果）              → "turn"
    9. mode == "turn" 或 rotate                            → "new-turn"
   10. st.cacheRead < cacheWorth(1024)                     → "no-cache"
   11. now - st.at > cacheCold(5 分钟)                      → "cold"
   12. 否则                                                → "cache"

  动作：
    "session" / "turn" / "cache": a.Kept = true；把 cs[at] 挪到首位（pl.order 同步）；所有 order[].Turn = false
    "strict":                     a.Kept = true；cs 只留该账号的条目（strictOnly）
    "new-turn":                   rotate 时 cs 从 at 之后接着轮（after）
    "first":                      rotate 时放被最少对话占用的那个在首位（leastHeld）
    其他：不动，按 plan 原序
  返回 cs, pl, a, key
```

### 3.3 对话识别（`gateway.go:5355-5452`）与轮次计数（`affinity.go:199-245`）

```go
// gateway.go:5355-5358
var sessionHeaders = []string{
	"x-opencode-session", "x-session-affinity", "x-session-id",
	"session_id", "session-id", "x-claude-code-session-id",
}
const SessionHeader = "X-Magpie-Session"   // :5363，只用于用量日志的会话归属（sessionOf），不参与 affinity 键
const AccountHeader = "X-Magpie-Account"   // :5371，钉死某个账号（探测用）
```

```
函数 conversationID(请求头, body):
  按 sessionHeaders 顺序取第一个非空头值 → 直接返回（不截断；sessionOf 会截到 128）
  解析 body 的 messages / input / contents：
    items = messages；为空且 contents 非空 → items = contents（Gemini）
    items 为空且 input 是数组 → items = input（Responses）
  first = input 原文；items 非空 → first = items[0]
  遍历 items：第一条 role == "user"（Gemini 下 role 省略也算 user）→ first = 它，break
  first 为空 → first = 整个 body
  返回 "magpie-" + hex(sha256(first))[:24]      // 前 12 字节

函数 turnIn(req):                       // affinity.go:215-245
  answered = false
  对每条消息 m:
    assistant → answered = true；continue
    非 user   → continue
    said   = userSaid(m) != "" 或 含 Image/File 部件     // 用户真说了话
    result = 含 ToolResult 部件
    result            → within = true
    否则 said         → turn++, within = false
    否则 answered     → within = turn > 0               // Agent 自己写的 user 消息（任务通知、todo 提醒）延续当前轮
    answered = false
  返回 turn, within
```

`turnOf(proto, body)`（`:199-205`）= `parse(proto, body)` 后调 `turnIn`。

---

## 4. 协议转换

### 4.1 IR 结构 → TypeScript 接口草稿（`ir.go`）

字段名与注释保持原意；`json.RawMessage` 译为 `string`（原始 JSON 文本）或 `unknown`。

```ts
// ir.go:21-31
type Kind = "text" | "image" | "file" | "tool_call" | "tool_result" | "thinking" | "web_search";

// ir.go:84-89
interface Hit {
  title: string;
  url: string;
  page_age?: string; // 搜索说这页多旧，"" 表示没说
}

// ir.go:34-70
interface Part {
  kind: Kind;
  text: string; // text、thinking，或 tool result 的输出

  // image 或 file
  mediaType?: string;
  data?: string; // base64
  url?: string;

  // tool_call
  id?: string;
  name?: string;
  args?: string; // JSON 对象原文

  // tool_result
  callId?: string;
  isError?: boolean;
  images?: Part[]; // 工具随文字一起返回的图片
  standalone?: Record<string, unknown>; // Responses 原生的无 call_id 通知

  // thinking：签名（Anthropic 的，或 Gemini thought 的）；tool_call 与 text 上也可能带 Gemini 的 thoughtSignature
  signature?: string;
  // 上游封存的推理，按其 API 原样写入：Anthropic redacted_thinking、Responses reasoning item（含 id/summary/encrypted_content）。
  // 只有同一 API 的 builder/encoder/renderer 会逐字节写回；到别的 API 就是无文字的推理
  sealed?: string;
  sealedBy?: "anthropic" | "responses"; // ir.go:73-76

  // web_search：text 是查询词
  hits?: Hit[];
}

// ir.go:101-104
interface Message {
  role: "user" | "assistant";
  parts: Part[];
}

// ir.go:136-141
interface Tool {
  name: string;
  description: string;
  schema: string; // 参数的 JSON schema
  strict: boolean; // 客户端要求参数严格贴合 schema
}

// format.go:14-24
interface Format {
  type: "json_schema" | "json_object"; // json_schema 时 schema 有值；json_object 任意 JSON 对象
  name: string; // OpenAI 系要求有名；客户端 API 没给则用 "response"
  description: string;
  schema: string;
  strict?: boolean; // 客户端的 strict，未说则 undefined
}

// ir.go:239-242
interface NsTool {
  namespace: string;
  name: string;
  search: boolean; // Codex 自己的 tool search
  custom: boolean; // 自定义（freeform）工具
}

// ir.go:144-231
interface Request {
  model: string;
  system: string;
  messages: Message[];
  tools: Tool[];
  toolChoice: "" | "auto" | "none" | "required" | `name:${string}`;
  maxTokens: number;
  temp?: number;
  topP?: number;
  stop: string[];
  stream: boolean;
  effort: "" | "low" | "medium" | "high" | "xhigh" | "max"; // 客户端明确要求时
  thinking: boolean; // 客户端要求可见推理
  // 客户端关闭推理：effort "none"（Effort 读成 low，供无法关闭的厂商）或 Anthropic 请求 thinking disabled
  thinkOff: boolean;
  parallel?: boolean; // 允许并行工具调用
  webSearch: boolean; // 客户端提供了厂商自带的联网搜索
  fast: boolean; // service_tier priority（Codex Fast）
  ultrafast: boolean; // service_tier "ultrafast"；设了它也设 fast
  tier: string; // 客户端原样发来的 service_tier
  ownTier: boolean; // 用户按地址加的 provider：tier 原样转发，被拒就去掉重发（optionalFields）
  cacheKey: string; // 客户端的 prompt_cache_key（Codex 发线程 id）
  include: string[]; // Responses 客户端的 include（Codex 的 reasoning.encrypted_content）
  clientMetadata?: string; // Responses 客户端的 client_metadata，仅转发给 Responses 上游
  text?: string; // Responses 客户端的 text（verbosity），其 format 读进 format 字段
  metadata?: string; // Anthropic 客户端的 metadata（Claude Code 的 user_id），仅转发给 Anthropic 上游
  safeguards?: string; // 调用方的安全上下文，网关不解读
  safeguardBeta: string;
  format?: Format; // 结构化输出；null 为纯文本
  geminiCompat: boolean; // 上游是 Gemini 的 OpenAI 兼容 API
  offLevel: string; // 该 API 在客户端关推理时仍要给的 thinking level（"" 为 minimal）
  resume: boolean; // 续写：最后一条是已发出去一部分的 assistant 消息
  lastIsTurn: boolean; // Chat/Responses 把末尾 assistant 消息当已说完的一轮，不是 prefill
  namespaced?: Record<string, NsTool>; // Responses 客户端的命名空间工具，按扁平名索引
  grok: boolean; // 模型是 Grok：参数里的零小数要去掉（grok_integral.go）
}

// ir.go:247-269
type EventKind =
  | "start" // MsgID, Model, Usage（输入侧）
  | "text" // Text
  | "think" // Text（推理）
  | "sig" // Text（thinking 签名）
  | "tool_start" // ID, Name
  | "tool_args" // Text（参数的部分 JSON）
  | "stop" // Stop
  | "usage" // Usage
  | "error" // Text
  | "search" // Text（查询词）, Hits
  | "image" // Name（media type）, Text（base64）：模型生成的图
  | "think_start" // 新的推理块开始（Anthropic thinking block / Responses reasoning item，ID 为其 id）
  | "sealed" // Text 是上游封存的整块推理，Name 是哪个 API（见 Part.sealed）
  | "text_sig"; // Text 是 Gemini 对前一段文字的 thoughtSignature

// ir.go:272-297
interface Event {
  kind: EventKind;
  status?: number; // error 时上游 HTTP 状态
  text?: string;
  id?: string;
  name?: string;
  msgId?: string;
  model?: string;
  stop?: "stop" | "length" | "tool" | "filter";
  code?: string; // error 时的来源错误码或安全过滤码（rate_limit, server_error, bio_policy, content_filter…）
  requestId?: string; // 厂商给这次请求的 id
  usage?: Usage;
  hits?: Hit[];
  safeguardResults?: string;
  stopDetails?: string; // Anthropic 的 stop_details，原样带给客户端（#1768）
  wait?: number; // error 时厂商说的等待毫秒数，转成 Retry-After
}

// ir.go:299-334
interface Usage {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
  cache_write_1h?: number; // 其中写入 1 小时缓存的 token（Anthropic 按 2× 计费，5 分钟的 1.25×）
  reasoning: number;
  served?: string; // 厂商回复里说实际回答的模型
  upstream?: string; // 聚合商说的背后 provider（OpenRouter 的 "provider"）
  request_id?: string;
  response_id?: string; // 最终客户端回复 id
  err_type?: string; // 失败请求错误体里的类型
  stop?: string; // 上游自己的结束原因原话（stop_reason / finish_reason / Responses status），"" 表示没说
  tier?: string; // 回复说实际跑的 service tier
  deferred?: Usage; // 本回复替之前请求补记的用量：计费算这次，不算这次的 prompt
}

// ir.go:404-412 — 非流式客户端的整份回复
interface Result {
  id: string;
  model: string;
  parts: Part[];
  stop: string;
  usage: Usage;
  safeguardResults?: string;
  stopDetails?: string;
}
```

IR 辅助（移植时要一起带）：`Usage.billed()`（`ir.go:338-349`，把 deferred 加进来）、`Usage.prompt()`（`:354-356`，`input + cache_read + cache_write`，OpenAI/Gemini 口径的全量 prompt）、`Usage.add()`（`:358-401`，非零字段覆盖）、`collector`（`:416-552`，把事件流攒成 `Result`，`finish()` 时若 `Stop` 为空或 "stop" 而含 tool_call 则改为 "tool"）、`joinSplitCalls`（`:113-123`，连续两条 assistant 且前一条有工具调用则合并）、`stringOrText`（`:604-636`，含 Claude Code `tool_reference` 的处理）、`toolOutput`（`:643-681`）、`effortOf`（`:684-694`）、`budgetOf` / `effortOfBudget`（`:731-758`，low 4096 / medium 10000 / high 24000 / xhigh,max 32000；反向 ≤4096 low、≤12000 medium、≤24000 high、否则 xhigh）。

### 4.2 三协议的五件套签名与职责

统一分发（`gateway.go:5025-5200`）：

```go
func parse(proto provider.Protocol, body []byte) (*Request, error)                         // :5025，解析后 unsignCalls、设 LastIsTurn = Chat||Responses
func build(proto provider.Protocol, r *Request, model, host string, rejectTemp bool) ([]byte, error)  // :5080
func decoder(proto provider.Protocol) func(data string, emit func(Event)) error              // :5104，每个 SSE data 行调一次
func encoder(proto provider.Protocol, w *sseWriter, r *Request, usage ...*Usage) streamEncoder // :5165
func render(proto provider.Protocol, res Result, r *Request) []byte                           // :5190，非流式
type streamEncoder interface { event(Event); finish(); keepalive() }                          // :5130-5136
```

| 协议 | parse | build | decoder | encoder | render |
|---|---|---|---|---|---|
| Anthropic Messages | `parseAnthropic(body []byte) (*Request, error)` `anthropic.go:113` | `buildAnthropic(r *Request, model string) []byte` `:775` → `anthropicBody(r, model, replay bool)` `:782` | `type anthropicDecoder struct{server, whole map[int]bool}` `:1079`；`(d *anthropicDecoder) decode(data string, emit func(Event)) error` `:1083`；无状态版 `decodeAnthropic` `:1128` | `type anthropicEncoder` `:1294`；`start/close/openBlock/thinking/delta/event/keepalive/finish` `:1368-1522` | `renderAnthropic(res Result, model string) []byte` `:1524` |
| OpenAI Chat | `parseChat(body []byte) (*Request, error)` `chat.go:69` | `buildChat(r *Request, model, host string, rejectTemp bool) []byte` `:248` | `type chatDecoder struct{started; tool int; toolID; choice; lead; thought; thoughtClose; past}` `:826`；`decode` `:916` | `type chatEncoder` `:1092`；`chunk/start/event/keepalive/finish` `:1102-1183` | `renderChat(res Result, model string) []byte` `:1185` |
| OpenAI Responses | `parseResponses(body []byte) (*Request, error)` `responses.go:251` | `buildResponses(r *Request, model, host string, rejectTemp bool) []byte` `:1001` | `type responsesDecoder struct{started, called, calling; args strings.Builder; full string}` `:1236`；`decode` `:1273` | `type responsesEncoder` ；`send/response/start/closeItem/closeAs/openItem/event/keepalive/finish` `:1475-1681` | `renderResponses(res Result, model string, named map[string]nsTool) []byte` `:1684` |

职责要点（取自各函数注释）：

- `anthropicDecoder`：跳过 Anthropic 服务端工具（web search）的 block；`tool_use` 的 start 若已带整个 input（中转站常见）就保留，不等 `input_json_delta`（`anthropic.go:1072-1081`）。
- `chatDecoder`：工具调用按 index 分片拼接；只认第一个 choice（`chatChoiceIndex` `:1041`）；文首 `<thought>…</thought>` / `<think>…</think>` 转成 thinking（`thoughtTags` `:847`）。
- `responsesDecoder`：函数调用参数以 done 事件为准，不以 delta 为准（#613，`:1229-1235`，`pickArgs` `:1261`）。
- Chat/Responses 的 build 需要 `host`（判断 DeepSeek 是否回放 reasoning_content、Gemini 兼容端点等）与 `rejectTemp`（模型拒收 temperature）。
- `anthropicBody` 的 `replay`：上游要求回放 thinking 时无签名的 thinking 也以文字发回（`anthropicReplaysThinking` `:251`）。

### 4.3 stop reason 映射表

IR 四值：`stop | length | tool | filter`（`ir.go:280`）。

| 方向 | 函数 | 映射 |
|---|---|---|
| Anthropic → IR | `stopFromAnthropic` `anthropic.go:1262-1279` | `max_tokens`, `model_context_window_exceeded` → length；`tool_use`, `tool_calls`, `function_call` → tool；`length` → length；`refusal`, `content_filter` → filter；其他（含 `end_turn`, `stop_sequence`）→ stop |
| IR → Anthropic | `stopToAnthropic` `:1281-1291` | length → `max_tokens`；tool → `tool_use`；filter → `refusal`；其他 → `end_turn` |
| Chat → IR | `stopFromChat` `chat.go:1067-1077` | `length` → length；`tool_calls`, `function_call` → tool；`content_filter` → filter；其他 → stop |
| IR → Chat | `stopToChat` `:1079-1089` | length → `length`；tool → `tool_calls`；filter → `content_filter`；其他 → `stop` |
| Responses → IR | decoder `response.completed/incomplete` 分支 `responses.go:1376-1393` | `response.failed` / `status=="failed"` / 有 error → KError；`status=="incomplete"` → length，且 `incomplete_details.reason=="content_filter"` → filter；曾流出 function_call（`d.called`）或 output 里有 `function_call` → tool；其他 → stop |
| IR → Responses（流） | `responsesEncoder.finish` `:1664-1681` | length → `response.incomplete` + `incomplete_details.reason="max_output_tokens"`；filter → `response.incomplete` + `reason="content_filter"`；其他 → `response.completed` |
| IR → Responses（非流） | `renderResponses` `:1726-1733` | 同上，`status` 为 `incomplete` / `completed` |

`collector.finish()`（`ir.go:540-552`）：`Stop` 为空或 "stop" 但 parts 含 tool_call → 改 "tool"（中转站的 `end_turn` 旁带 tool_use 的情况）。

### 4.4 usage 映射表

| 协议 | 线上结构 | → IR（`usage()`） | IR →（渲染） |
|---|---|---|---|
| Anthropic `aUsage` `anthropic.go:1227-1241` | `input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens, cache_creation{ephemeral_5m_input_tokens, ephemeral_1h_input_tokens}` | `:1243-1250` Input=input_tokens；Output=output_tokens；CacheRead=cache_read_input_tokens；CacheWrite=max(cache_creation_input_tokens, 5m+1h)；CacheWrite1h=1h | `Usage.anthropic()` `:1254-1260`：四字段原样；CacheWrite1h>0 时拆出 `cache_creation{5m: write-1h, 1h}` |
| Chat `cUsage` `chat.go:755-784` | `prompt_tokens, completion_tokens, total_tokens, prompt_tokens_details{cached_tokens, cache_write_tokens(OpenRouter)}, completion_tokens_details{reasoning_tokens}`；别名 `prompt_cache_hit_tokens`(DeepSeek), `cached_tokens`(Moonshot), `cache_read_input_tokens`/`cache_creation_input_tokens`(Anthropic 风格中转)；`magpie_deferred{...}` | `:786-815` CacheRead 依次取 details.cached_tokens → prompt_cache_hit_tokens → cached_tokens；两者都 0 时取 Anthropic 名字且据 `prompt_tokens ≥ read+write` 判断 prompt_tokens 是否全量；全量时 Input = prompt_tokens − read − write，否则 Input = prompt_tokens；Reasoning = reasoning_tokens；magpie_deferred → Deferred | `Usage.chat()` `:817-822`：`prompt_tokens = input+cache_read+cache_write`；`completion_tokens`；`total_tokens`；`prompt_tokens_details{cached_tokens, cache_write_tokens}`；`completion_tokens_details{reasoning_tokens}` |
| Responses `rUsage` `responses.go:1199-1212` | `input_tokens, output_tokens, total_tokens, input_tokens_details{cached_tokens, cache_write_tokens}, output_tokens_details{reasoning_tokens}` | `:1216-1220` Input = input_tokens − cached − cache_write（input_tokens 是全量）；其余直取 | `Usage.responses()` `:1222-1227`：`input_tokens = prompt()`；`output_tokens`；`total_tokens`；`input_tokens_details{cached_tokens, cache_write_tokens}`；`output_tokens_details{reasoning_tokens}` |

口径差异：Anthropic 的 `input_tokens` 不含缓存读写，OpenAI / Gemini 的 `prompt_tokens` / `input_tokens` 含（`ir.go:351-356`）。

### 4.5 magpie 自己加 `cache_control` 的三处（`anthropic.go`）

IR 没有 cache_control 字段；只在构建 Anthropic 请求时由 `anthropicBody` 加 `ephemeral = {"type":"ephemeral"}`（`anthropic.go:72`）：

1. **最后一条消息的最后一个非 thinking block**（`:880-888`）：从末尾往前找第一个 `Type` 不是 `thinking` / `redacted_thinking` 的 block，设 `CacheControl = ephemeral`。注释："Two marks at most, with the one Claude's sign-in adds kept within Anthropic's four."
2. **system**（`:893`）：`r.System != ""` 时 `system = [{type:"text", text, cache_control: ephemeral}]`。
3. **最后一个工具**（`:946-948`）：仅当 `r.System == "" && len(tools) > 0` 时 `tools[last]["cache_control"] = ephemeral`（有 system 时不标工具，让总数不超过两个）。

`aBlock.CacheControl map[string]string \`json:"cache_control,omitempty"\``（`:46`）。同协议直通（passthrough）时客户端原标记保留，不经过这里。

### 4.6 工具调用配对修补

三条路径各一个，共用的占位文本：

```go
// anthropic.go:772
const interruptedTool = "[The result of this tool call is unavailable: the turn was interrupted.]"
```

**Anthropic `pairToolBlocks(msgs []aMessage) []aMessage`（`anthropic.go:989-1055`）**，在 `anthropicBody` 构建完消息后调用（`:876`）：

```
pending = 当前 assistant 消息里的 tool_use id 列表；open/answered 集合
遇到 assistant 消息：
  先 closeExchange()：上一轮 pending 中未被回答的，各补一条 synthetic tool_result（is_error=true，内容 interruptedTool）组成一条 user 消息
  收集它的 tool_use id → pending/open；原样输出
遇到 user 消息：
  对每个 block：
    不是 tool_result → 放进 rest
    tool_use_id 不在 open 里 → resultSaid(b)：转成 text block（空内容则 "Tool result received."；content 本身是 block 数组则原样）放进 rest
    已回答过 → 丢弃（第一条算数）
    否则 → kept
  pending 里未回答的 → 追加 synthetic 到 kept
  输出 user{kept + rest}；清空 pending/open/answered
结束时再 closeExchange()
// 形状正确的对话逐字节不变
```

**Chat `pairToolMessages(msgs []map[string]any) []map[string]any`（`chat.go:531-619`）**：

```
pending / order（id→在 tool_calls 中的序号）/ answered / tools（暂存的 tool 消息）
assistant：
  无 tool_calls：若 pending 非空且 emptyAssistant(m)（无 content、无 tool_calls、无 reasoning_content）→ 丢弃（thinking-only 轮不能夹在调用和结果之间）；否则 flushPending 后输出
  有 tool_calls：flushPending；输出；登记 pending/order
tool：
  id 不在 order 里 → flushPending；toolAsUser(m)：转成 user 消息（空则 "Tool result received."；若上一条已是 user 则合并，避免两条 user 相邻）
  已回答 → 丢弃
  否则 → 暂存 tools
其他角色：flushPending；输出
flushPending = flushTools（按 order 排序后输出暂存的 tool 消息）+ 未回答的 pending 各补一条 {role:"tool", tool_call_id, content: interruptedTool}
```

**Responses（三个函数，作用于原始 JSON body 的 `input` 数组）**：

- `joinToolRuns(body []byte) []byte`（`responses.go:526-607`）：把夹在一串 call/output 中间、不带 call_id 的项（Codex 的 `<image_resize_notice>`，#1752/#1822）挪到这一串末尾；带 call_id 的项永不移动；模型自己的项（reasoning、assistant message、`*_call`）在第一个 output 之前不动。无需改动则逐字节返回原 body。
- `orphanedToolOutputs(body []byte) []byte`（`:609-698`）：`function_call_output` / `custom_tool_call_output` 没有 `call_id` 的（Codex 跨线程通知）→ 改成 `{type:"message", role:"user", content:[input_text / input_image…]}`；若正处在一串 call 中，暂存到这串结果之后再插入。
- `pairToolItems(body []byte) []byte`（`:700-760`）：`function_call` / `custom_tool_call` 没有对应 output 的 → 在其所在的 call/output 串末尾补 `{type:"function_call_output"|"custom_tool_call_output", call_id, output: interruptedTool}`。
- `mergeTurns(msgs []Message) []Message`（`:762-772`）：相邻同角色消息合并（Responses 把一个 assistant 轮拆成多个 item）。

Anthropic 侧在 `parse` 阶段还有 `joinSplitCalls`（`ir.go:113-123`）：连续两条 assistant 且前一条有工具调用则合并，供 Messages 的并行 tool_use 被拆成两条的情况（#1275）。

---

## 5. 测试样本清单

`internal/gateway/` 共 **550** 个 `_test.go`。下表只列与 Anthropic / Chat / Responses 三种协议转换直接相关的；judge 列按：`http=0 且直接调 parse/build/decode/render/pair*` → **JSON 夹具可直接搬**；`http>0 且不直接调` → **Go 逻辑需重写**（起假上游、走整个网关）；两者皆有 → **混合**。"直接调"统计的是对 `parseAnthropic/buildAnthropic/decodeAnthropic/renderAnthropic/anthropicBody/parseChat/buildChat/chatDecoder/renderChat/parseResponses/buildResponses/responsesDecoder/renderResponses/pairToolBlocks/pairToolMessages/pairToolItems/joinToolRuns/orphanedToolOutputs/stopFrom*/stopTo*/.usage()/collector/translateStream/*Encoder` 的引用次数。

> 注：`research/magpie.md` 曾写"anthropic.go 对应测试 1374 行、chat.go 647、responses.go 770"，但仓库里**没有** `anthropic_test.go` / `chat_test.go` / `responses_test.go` / `gemini_test.go` / `ir_test.go`，那些数字无法复核；测试按功能点分散在下列文件里。

| 文件 | 行数 | 测什么 | 判定 |
|---|---|---|---|
| anthropic_tool_pairing_test.go | 345 | `pairToolBlocks`：未回答的 call 补 synthetic、孤儿 tool_result 变 text、末尾未回答、干净对话不变、外来 id 编码保留、重复答复丢弃 | JSON 夹具可直接搬 |
| chat_tool_pairing_test.go | 337 | `pairToolMessages`：结果按 call 顺序、跨 user 消息收集、孤儿结果变 user、迟到结果并入 user、重复保留第一、空 id、thinking-only assistant 在交换内丢弃/外保留 | JSON 夹具可直接搬 |
| pair_tool_items_test.go | 110 | `pairToolItems` 给孤 call 补 output；中转时同样 | JSON 夹具可直接搬 |
| join_tool_runs_test.go | 315 | `joinToolRuns` 把串中间的项挪到末尾、整串不动、只挪破坏串的 | JSON 夹具可直接搬（55 段内联 JSON） |
| orphan_tool_output_test.go | 175 | `orphanedToolOutputs`：无 call_id 的 output 变 user 消息、内容与 no-op、Codex 原生直通不变 | JSON 夹具可直接搬 |
| translate_stream_test.go | 388 | Chat 流解码：只认首个 choice、字符串 index、usage 在 choice 前、无 index 块延续、并行工具 id、reasoning 双名、流式 call 以 tool 结束、重复 tool_call id 只开一个块 | JSON 夹具可直接搬（45 段 SSE/JSON） |
| reasoning_state_anthropic_test.go | 248 | 封存 thinking（redacted_thinking）原样回传、流式/整份保留、只留在 Messages | 混合（1 处 httptest） |
| reasoning_state_responses_test.go | 161 | Responses encrypted reasoning 原样回传、文字仍不带、流式/整份保留、只留在 Responses | JSON 夹具可直接搬 |
| anthropic_cache_ttl_test.go | 52 | `aUsage.usage` 的 5m/1h 缓存写拆分 | JSON 夹具可直接搬 |
| responses_cache_write_test.go | 36 | `rUsage.usage` 的 cache_write_tokens | JSON 夹具可直接搬 |
| stop_context_test.go | 39 | `model_context_window_exceeded` → length | JSON 夹具可直接搬 |
| chat_inbound_reasoning_test.go | 90 | `parseChat` 读各种 reasoning 拼写、取第一个 | JSON 夹具可直接搬 |
| anthropic_schema_test.go | 59 | `objectSchema` 工具 schema 根必须是 object | JSON 夹具可直接搬 |
| tool_strict_test.go | 59 | Responses 工具 strict 透传 | JSON 夹具可直接搬 |
| responses_include_test.go | 73 | `include` 保留；Codex search 时保留 | JSON 夹具可直接搬 |
| responses_metadata_test.go | 68 | `client_metadata` 只发给 Responses | JSON 夹具可直接搬 |
| responses_allowed_tools_test.go | 104 | `parseResponses` 的 allowed_tools / 命名空间工具 | JSON 夹具可直接搬 |
| devin_tool_ids_test.go | 158 | 非 `[A-Za-z0-9_-]` 的 call id 双向安全编码（`anthropicOutID/InID`） | JSON 夹具可直接搬 |
| codex_custom_tools_test.go | 165 | Codex custom tool / 命名空间转换 | JSON 夹具可直接搬 |
| thinking_block_test.go | 38 | 有签名无文字的 thinking 保留字段 | JSON 夹具可直接搬 |
| deferred_usage_test.go | 202 | `magpie_deferred` 用量：解析、计费不计 prompt、chatDecoder 保留 | 混合（1 处 httptest，7 处直接调） |
| format_test.go | 280 | 结构化输出跨四 API、Responses text verbosity 与 format 并存、被拒改成文字说明 | 混合（4 处 httptest，8 处直接调） |
| prompt_cache_test.go | 209 | Codex thread 在 Chat 上游缓存、prompt_cache_key 被拒、Chat usage cache、Anthropic prompt cache 标记 | 混合 |
| claude_prompt_cache_test.go | 208 | Claude 订阅路径的 instructions / history / tool loop 缓存 | 混合（订阅路径，本任务不做） |
| reasoning_replay_test.go | 108 | DeepSeek 回放 reasoning | 混合 |
| reasoning_passthrough_test.go | 253 | DeepSeek reasoning 直通、组内 ChatGPT 之后、转换后不带 reasoning | 混合 |
| codex_developer_cache_test.go | 109 | Codex 后续 developer 消息保留 system | 混合 |
| minimax_think_test.go | 146 | `<think>` 标签 ↔ reasoning | 混合 |
| toolsearch_test.go | 258 | Codex tool search 转换、流式渲染、经 Chat、中转 | 混合 |
| upstream_bytes_test.go | 151 | 用 `testdata/upstream_bodies/*.json` 校验构建出的上游请求体逐字节不变（大体用 sha256） | 混合：13 个 JSON 夹具（58–879 B）可搬；5 个 `.sha256` 对应的大体在 Go 里生成，需重写 |
| anthropic_call_ids_test.go | 192 | call id 双向安全编码经网关 | Go 逻辑需重写 |
| anthropic_ids_test.go | 40 | 回复 id `msg_` 规范化 | 混合 |
| anthropic_image_source_test.go | 139 | image source 字段保留、挪动的图片保留 source 变体 | Go 逻辑需重写 |
| anthropic_max_tokens_test.go | 152 | max_tokens 取模型自己的上限 | Go 逻辑需重写 |
| anthropic_shapes_test.go | 334 | 中转站拒收 Claude Code 新形状时降级；system 消息被拒放顶部 | Go 逻辑需重写 |
| anthropic_upstream_ids_test.go | 61 | Anthropic 上游收别家 call id | Go 逻辑需重写 |
| chat_reasoning_relay_test.go | 65 | Chat reasoning 原样中转 | Go 逻辑需重写 |
| chat_tool_reasoning_test.go | 155 | 工具轮无 reasoning 时的处理（Mistral 例外） | Go 逻辑需重写（11 段 JSON 可做夹具） |
| chattidy_test.go | 152 | Chat 中转整理：空 reasoning、CodeBuddy 流、拆行、finish_reason、tool 名 | Go 逻辑需重写 |
| claude_chat_usage_test.go | 70 | Claude 走 Chat 时的 cache write | Go 逻辑需重写 |
| claude_tool_result_text_test.go | 252 | 订阅路径的 tool result 文字处理 | Go 逻辑需重写（订阅，本任务不做） |
| continuation_test.go | 744 | 流中断续写（continuation.go）：各协议、thinking 中断、prefill | 混合（本任务一期可不做） |
| count_tokens_test.go | 351 | count_tokens 转发/估算/故障转移 | Go 逻辑需重写 |
| deepseek_anthropic_thinking_test.go | 219 | DeepSeek Anthropic 端点工具轮补 thinking | Go 逻辑需重写（14 段 JSON 可做夹具） |
| messages_first_test.go | 213 | Claude 模型有 Anthropic URL 时改走 Messages | Go 逻辑需重写 |
| passthrough_severed_test.go | 86 | 直通流被切断/提前结束/完整 | Go 逻辑需重写 |
| prefill_test.go | 260 | 末尾 assistant 到不支持 prefill 的模型 | Go 逻辑需重写 |
| reasoning_text_test.go | 190 | reasoning 文字被拒就去掉 | Go 逻辑需重写 |
| refusal_thinking_test.go | 136 | thinking 后被拒的故障转移 | Go 逻辑需重写 |
| relay_stop_test.go | 286 | 中转站 stop reason：tool_calls 以 tool 结束、start 里带 input、流提前结束、stop 记录 | Go 逻辑需重写（28 段 JSON 可做夹具） |
| required_tools_test.go | 159 | tool_choice required + 空 allowlist | Go 逻辑需重写 |
| responses_file_id_test.go | 80 | Responses file_id 路由 | Go 逻辑需重写 |
| responses_hidden_thinking_test.go | 96 | 工具后隐藏 thinking 的流 | Go 逻辑需重写 |
| responses_tells_cache_test.go | 211 | model scope 下 Messages/Responses/Chat 选择 | Go 逻辑需重写 |
| responses_socket_test.go | 34 | WebSocket 升级要求 | Go 逻辑需重写 |
| responses_only_draw_test.go | 68 | 只有 Responses 的 provider 参与 draw | Go 逻辑需重写 |
| stream_cut_test.go | 111 | 流被切断的错误文案、内容前重试 | Go 逻辑需重写 |
| stream_error_open_test.go | 105 | 流错误保持打开时立刻转移 | Go 逻辑需重写 |
| stream_error_shape_test.go | 189 | 畸形流错误让回复失败 | Go 逻辑需重写 |
| stream_only_test.go | 45 | 只流式上游，非流式客户端转换 | Go 逻辑需重写 |
| thinking_display_test.go | 236 | 转换后 Claude 推理可见、display 被拒去掉、budget 转 adaptive | Go 逻辑需重写 |
| thinking_off_test.go | 343 | thinking off 按模型适配；sampling 适配 | 混合（54 段 JSON 可做夹具） |
| thinking_only_error_test.go | 35 | 只 thinking 后出错算错误 | Go 逻辑需重写 |
| thinking_streams_test.go | 229 | thinking 跨组流式、held | Go 逻辑需重写 |
| thinks_test.go | 106 | 无档位模型的 reasoning | Go 逻辑需重写 |
| tool_choice_refused_test.go | 81 | 强制 tool_choice 被拒 | Go 逻辑需重写 |
| tool_images_test.go | 311 | 工具结果图片到 Chat / Responses 模型；纯文字模型描述图片 | Go 逻辑需重写 |
| tool_images_1861_test.go | 107 | Codex 工具图片到 Anthropic 插件 | 混合 |
| tools_need_responses_test.go | 152 | 需要 Responses 的工具走 Responses | Go 逻辑需重写 |
| translate_severed_test.go | 107 | 转换时上游被切断：缓冲 / 流式 / 完整 | Go 逻辑需重写 |
| translated_probe_test.go | 103 | 转换后的模型探测 | Go 逻辑需重写 |
| wire_effort_test.go | 152 | 转换后 effort 日志、thinking off 被拒 | Go 逻辑需重写 |
| wire_test.go | 1254 | 上游模型名（`modelWires`）在各路径的使用（**不是**协议转换本身） | Go 逻辑需重写 |
| late_stream_error_test.go | 112 | 迟到的流错误不保留 | Go 逻辑需重写 |
| image_tool_test.go | 207 | image tool 被拒去掉 | Go 逻辑需重写 |
| toolsearch_history_test.go | 109 | search 历史无 search 时 | Go 逻辑需重写（5 段 JSON） |
| pi_responses_test.go | 149 | Pi 的 Responses 中转 | Go 逻辑需重写 |
| omp_messages_test.go | 65 | OMP 的 Messages 原样中转 | Go 逻辑需重写 |
| glm_responses_test.go | 125 | GLM Coding Plan 的 Responses | Go 逻辑需重写 |
| kimi_reasoning_details_test.go | 96 | Kimi reasoning_details 作 content | Go 逻辑需重写（11 段 JSON） |
| mistral_reasoning_test.go | 136 | Mistral reasoning 作 thinking | Go 逻辑需重写（13 段 JSON） |
| bare_reasoning_test.go | 234 | 裸 reasoning 被拒去掉 | Go 逻辑需重写 |
| azure_reasoning_test.go | 151 | Azure compaction | Go 逻辑需重写 |
| adaptive_wire_test.go | 123 | adaptive-only 模型不给 budget | Go 逻辑需重写（19 段 JSON） |
| upstream_test.go | 139 | `Usage.Upstream` 记录 | Go 逻辑需重写 |
| stream_accounting_test.go | 120 | 流失败的用量记账 | Go 逻辑需重写 |

`testdata/` 目录（`internal/gateway/testdata/`）：`upstream_bodies/` 13 个 JSON + 5 个 sha256（见上）；`context/claude-code.json, codex.json`；`workdir/claude-code-2.1.296.json, codex-0.162.0.json, codex-0.162.1-tool-search.json, pi-1.1.0.json`（Agent 真实请求样本，可作 parse 夹具）；`reasoning-speed-visible.json`；`vertex_openai_thoughts.sse`；`codex_image_gen_tool.json`；`qoder_queued_10605.json`；`grok_integral_args/*.jsonl`；`you/`。

**判错 / 冷却 / 粘性相关的测试**（票外，顺手列出便于移植第 1-3 组）：`fallback_test.go` 536（11 个 Test）、`routing_test.go` 316（5）、`retry_test.go` 267（5）、`rest_all_test.go` 201（5）、`resting_probe_test.go` 186（4）、`written_reset_test.go` 289（5，`resetsWritten`）、`rate_backoff_test.go` 92（1，`rateRest`）、`ratewords_test.go` 34（1）、`quota_rest_test.go` 102（1）、`window_rest_test.go` 42（1）、`sink_test.go` 171（2）、`user_said_test.go` 191（6，`turnIn`）、`toolong_test.go` 129（3）、`region_fallback_test.go` 94（4）、`verify_test.go` 79（2）、`workbuddy_restricted_test.go` 276（3）、`workbuddy_refused_test.go` 77（1）、`credit_scope_test.go` 146（2）、`pool_rest_test.go` 59（1）、`gateway_test.go` 1536（38，综合）。这些多为走整个网关的 Go 逻辑测试，但 `ratewords_test.go`、`written_reset_test.go`、`toolong_test.go`、`user_said_test.go` 里的错误体字符串可直接当 TS 的正则用例。

---

## 6. 许可证声明

`LICENSE`（仓库根目录）原文：

```
MIT License

Copyright (c) 2026 yetone

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

借鉴文件头可用的短式（版权行 + 许可名 + 原仓库出处）：

```ts
// 部分逻辑移植自 magpie（https://github.com/yetone/magpie，internal/gateway/routing.go 等）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES 或原仓库 LICENSE。
```

---

## 没抄全 / 需注意的地方

- 票里给的行号与当前源码略有偏移（如常量块实际在 `routing.go:90-122`，`affine` 在 `affinity.go:337`，`passing` 在 `fallback.go:1185`），本文以实际行号为准。
- 第 2 组 `restAfterMarked` 里 `c.full()` / `c.pooled()` / `PaidBesideFree()` 依赖 `internal/provider` 的额度读取（订阅账号用量），本任务不做订阅，只记录了调用语义未抄其实现。
- 第 4 组只抄了 parse/build/decoder/encoder/render 的签名与职责要点，各函数体（`anthropicBody` 约 190 行、`buildChat` 约 280 行、`buildResponses` 约 215 行、三个 decoder 各 100-160 行）未逐行抄；`anthropicBody` 中与 cache_control 相关的段落已全文抄录。Gemini / CodeAssist 协议按 `map.md` 不在范围，未抄。
- 第 5 组的「可搬 / 需重写」是按 httptest 与直接函数调用的计数做的机械判定，没有逐个打开文件核对；标为"混合"的需要移植时再看。
- 票里要求的"厂商例子"均取自源码注释，没有另行抓取厂商真实错误体。
