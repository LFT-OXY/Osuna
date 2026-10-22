# 余额与套餐用量：访谈决定与 magpie 出处

本任务 `/atw-askme-with-docs` 两轮访谈（2026-10-22）的全部决定，以及照 magpie 实现时要对照的源码位置。magpie 基准 `7597c132`；路径相对 magpie 仓库的 `internal/`，`app.js` / `i18n.js` 指 `gui/assets/` 下的文件。最新版 `ea6be159` 的相关差异单列在末尾。

## 访谈决定

- Q10：只做显示，不做按额度提前换家。
- Q16：照 magpie 全做，「能查的话那就不需要省了」。

2026-10-22 `/atw-askme-with-docs` 第 1 轮（依据：magpie 7597c132 的 `internal/provider/balance.go`、`planquota.go`、`codex_resets.go`、`gui/assets/app.js`；Osuna 现状见下方各条引用）：

- R1-Q1：在分支 `magpie-osuna-gaps-balance-quota` 上开始本任务。
- R1-Q2 显示位置：接口列表每行多一小段（余额，或剩得最少的套餐窗口）；接口详情页新增「余额与套餐用量」分区（全部余额与窗口、已用、重置时间、配速）；编辑接口时有「查询余额」，结果就地显示。用量页本任务不动，留给子任务 5。（magpie 只放用量页卡片与编辑器就地结果，接口行不显示。）
- R1-Q3 查询时机：照 magpie（结果缓存 1 分钟，开机不查，暂时失败显示上次读数，「额度刷新：自动 / 仅手动」开关）。落到 Osuna：接口列表页或详情页开着时，自动查开着的接口，每家每分钟最多一次；关着的接口只在打开它的页面或点刷新时查。开关放在接口列表页，与「价格表自动更新」互不牵连。
- R1-Q4 中转站余额地址：照 magpie 由用户填「余额查询地址」，带 magpie 的纠错提示（令牌配 key 级地址、缺 `New-Api-User` 等）；另加按下才试的「自动识别」：只试 new-api `/api/usage/token` 与 sub2api `/v1/usage` 两个 key 级地址，试中就填上。做法同现有「自动识别格式」，不在后台自动试探。
- R1-Q5 用词：「余额」（Balance）= 账上还剩的钱或积分；套餐 key 的 5 小时 / 周 / 月窗口也叫「套餐用量」（Plan usage）；分区名「余额与套餐用量」。已写进 `docs/glossary.md`（新增 Balance，放宽 Plan usage 的定义）。
- R1-Q6 周边功能：做窗口配速、暂时失败显示上次读数、magpie 最新版的 DeepSeek「赠送 / 充值」拆分与 OpenCode Zen 说明卡，以及 Codex 重置卡（范围见第 2 轮）。不做、以后再挑：额度与余额提醒（03·I04）、45 天历史与走势（I05）、命令行查额度（I06–I07）、终端状态栏（I09）、卡片排序（I10）。整窗估算（I03）也不做。
- R1-Q7 阶跃 Step Plan：不做套餐窗口（magpie 要粘网页登录并以网页版身份续期，违背总任务第 15 条与子任务 8）；阶跃余额照常用 key 查。
- R1-Q8 智谱团队套餐：用户手动填团队组织 ID / 项目 ID，不读 ZCode 的登录。
- R1-Q9 身份：新加的查余额请求写 `User-Agent: Osuna/<version>`（magpie 用 Go 默认值，不跟）。现有拉模型、测试连接、厂商状态页、套餐用量插件不带 Osuna UA 的问题另开任务 `10-22-endpoint-requests-user-agent`，不在本任务里修。

2026-10-22 第 2 轮（用户：全部按推荐）：

- R2-Q1 Codex 重置卡（Codex 的 ChatGPT 账号持有的「额度重置次数」，magpie `provider/codex_resets.go`）：显示次数与最早过期时间（数量取自 Codex 套餐用量来源已在请求的 `wham/usage` 的 `rate_limit_reset_credits`，过期时间另 GET `wham/rate-limit-reset-credits`，同一份登录）；卡片上可手动用掉一次，先弹窗确认不可撤回（POST `wham/rate-limit-reset-credits/consume`，指定最早过期的那次，带幂等 id）。不做自动用掉（总任务 Out of Scope 02·B30）。显示在 Codex 的套餐用量卡片（侧边栏「套餐用量」与用量页），不在接口页。智谱团队套餐的按窗口重置次数只显示。
- R2-Q2 所有接口（含模板加的）在编辑框「高级」里都有余额查询地址 / 方法 / 取值写法 / 账户令牌；填了就按填的查，不再按地址自动认（同 magpie）。
- R2-Q3 new-api 账户余额另给一栏「用户 ID」，只在查余额时作为 `New-Api-User` 发出；接口的请求头里已有 `New-Api-User` 也认。
- R2-Q4 认不出且没填地址：列表行不显示；详情分区写「没认出这家的余额查法」并给「填写余额查询地址」按钮。查不到：详情就地显示原因，列表行只写「余额查不到」。原因五类：地址不对（404 / 回的是网页）、令牌被拒（401 / 403 / `success:false`）、这家不给查余额（如 OpenCode Zen）、取不到值（取值写法没取到数字）、暂时查不到（网络 / 429 / 5xx，显示上次读数并标时间）。对方原话打码 key 后附在原因下；带上 magpie 的具体提示（令牌配错地址、缺用户 ID、智谱 key 过期等）。
- 默认（用户认可）：复制出的同账户接口各自显示账户余额、不加总；同时有余额与窗口时列表行显示剩得最少的窗口；余额按对方币种显示、不换算（人民币归子任务 5）；火山方舟 / 腾讯云的 AK/SK 与 key 同样只存在 daemon、界面打码。
- 「自动 / 仅手动」做成 Switch（用户偏好），文案避开术语表禁用的「Quota」，暂定「自动查询余额与套餐用量」，`/atw-spec` 时定稿。它不管 Codex 等 CLI 登录的套餐用量卡片（那些保持现状）。

- 2026-10-22 写 spec 时更正 R1-Q3 的描述：访谈里说 magpie「仅手动」是「只在点刷新时才查」，不准确。magpie 的「仅手动」把**打开用量页**也算作用户要求的读取（30 秒内重开不再读），只停掉定时刷新、托盘轮询与提醒（`provider/quota_asked.go:28-57`、`plugins/usage/page.js:12-16`）。spec 照 magpie：开关关着时，打开接口列表页 / 详情页各读一次（30 秒内重开不再读）、点刷新或「查询余额」读，页面开着时不再每分钟重读。用户在 stop ② 确认。

- 2026-10-22 工单 06 实现时定下（照 magpie，或效果相同的写法差异）：
  - 账户令牌存在 `keys.json` 的 `balanceTokens`，客户端只拿 `balanceTokenMask`；「显示」走新 RPC `provider.api_endpoint.reveal_secret`（`secret` 现在只有 `balance_token`，留给工单 10 的云账号密钥）。保存的 `balanceToken`：非空换上、空字符串清掉、省略保留，复制时沿用原来那家的（同 magpie 的 `clearBalanceToken` 与复制草稿）。编辑窗口照 magpie 给「移除」，另有和 key 一样的「显示」。
  - 令牌配 key 级地址时 daemon 不发请求，读数是「地址不对」加提示 `token_on_key_url` 与该改用的 `useUrl`（magpie 的报错还写出账户查询的取值写法；这里不写，因为取值写法空着时按地址补默认写法，效果相同）。
  - 编辑窗口的「改用 …」把取值写法清空、占位显示新地址的默认写法；magpie 是把默认写法填进框里。保存后少存一个与默认相同的 `field`，查法相同。
  - 「令牌还要配余额查询地址」的提示在表单地址是 aihubmix.com 时不出：magpie 只对自定义接口给这条提示，AiHubMix 是它的已知厂商，填令牌不填地址就查账户余额。
  - sub2api 的限额窗口放在读数的 `windows`，字段名同套餐用量的窗口，另带 `used`、`limit`、`unit`；协议里另写一份而不是从 `ProviderUsageWindowSchema` 派生，因为 `messages.ts` 引用 `rpc-schemas.ts`，反过来引用会成环。窗口的配速留给工单 08 一起算；详情分区的已用 / 剩余跟随套餐用量现有的显示设置（工单 08 的切换做好后同一个选择）。

- 2026-10-22 工单 07 实现时定下（magpie 没有「自动识别」，细节照 magpie 相近的写法）：
  - 站点取表单各格式地址里依 Chat、Anthropic、Responses 先后第一个 http(s) 地址的 origin（scheme 加主机），同 magpie `errKeyUsageWithToken` 的 `u.Scheme + "://" + u.Host` 与编辑器「改用 …」的 `origin(draft.chat || draft.anthropic || draft.responses)`。工单写的「照 `keyQueryOf` 取站点」那里会保留账户查询前的路径前缀（如 `/relay/api/user/self` → `/relay/api/usage/token`）；从接口地址推不出可靠的路径前缀（`/relay/v1` 里哪段是站点说不准），所以不保留，部署在子路径下的中转站要自己填地址。magpie 只看第一个非空地址，这里遇到不是 http(s) 的会接着看下一种格式。
  - 试中的判定是读数 `status` 为 `ok`；两个默认写法都只会出一项或 `no_value`，不会出空的 `ok`。
  - 试中后表单填地址、方法改回 GET；取值写法同「改用 …」走 `fieldAfterUsing`：空的或 key 查询那几种写法清空、占位写出默认写法，用户自己写的别的写法留着（magpie balanceFix「An unrelated expression belongs to the user」）。工单的「把默认写法填进表单」照工单 06 的约定做成占位，效果相同。
  - 从不用账户令牌（令牌配这两个 key 级地址只会被拒）；没有 key 或找不到站点时 daemon 拒收（`invalid_input`），界面上按钮此时本就不可点。
  - 英文界面名叫「Detect URL」，不叫「Auto-detect」：同一个窗口顶上已有识别请求格式的「Auto-detect」。

## magpie 出处（照做时对照）

### 按地址认的厂商余额（`provider/balance.go:41-84, 255-470`）

- 填了 Balance URL 就一律走自定义余额；否则依次取 Chat、Responses、Anthropic 地址的主机名精确比对。`api.openai.com` 不在表里。
- DeepSeek `GET /user/balance` → `balance_infos[].total_balance`，币种按 `currency`（CNY/RMB→¥，USD→$，其他「代码 + 空格」），多币种「 · 」拼接，有余额的在前（:275-345）。
- Moonshot `.cn` / `.ai` `GET /v1/users/me/balance` → `data.available_balance`，¥ / $。
- OpenRouter `GET /api/v1/credits` → `total_credits - total_usage`，$。
- 硅基流动 `.cn` / `.com` `GET /v1/user/info` → `data.totalBalance`；410 或 code 20092 改说「接口已下线，去控制台看」（:405-422）。
- 阶跃 `.com` / `.ai` `GET /v1/accounts` → `balance`。
- Command Code `GET /alpha/billing/credits` → 月度 + 购买 + 赠送 credits 之和。
- Ollama Cloud `https://ollama.com/api/balance` → `purchased.balance_usd`，没有就不出卡（`provider/ollama_usage.go:142-158`）。
- AiHubMix 无令牌 `GET /dashboard/billing/remain` → `total_usage`（实为剩余，<0 表示 key 没设上限，报错提示填令牌，:449-464）；有令牌 `GET /api/user/self` → `data.quota / 500000`。
- 金额两位小数（:271-273），不换算汇率。

### new-api / one-api、sub2api、credit_grants（`balance.go:93-254, 1130-1460`）

- 默认取值：new-api key 级 `/api/usage/token` → `$data.total_available / 500000`；账户级 `/api/user/self` → `$data.quota / 500000`（系统访问令牌原样作 Authorization，另需 `New-Api-User`）；sub2api key 级 `/v1/usage` → `$remaining`；账户级 `/api/v1/user/profile` → `$data.balance`（登录 JWT）；`/dashboard/billing/credit_grants` 结尾 → `$total_available`。
- 令牌以 `eyJ` 开头且含两个点时加 `Bearer `，含空格的原样发（:1452-1460）。
- sub2api `/v1/usage` 另读 `rate_limits` 出 5 小时 / 1 天 / 7 天窗口（`provider/sub2api_usage.go:15-61`）；没 `remaining` 时取各窗口剩余额度的最小值（:1130-1140, 1226-1239）。
- 填了账户级地址没填令牌：改问同站点 key 级地址（`keyQueryOf`，:145-182）。令牌配 key 级地址：报错并说该改用哪个地址（:201-228, 1153-1160）。
- new-api `{"success":false,"message":…}` 不论状态码都算拒绝（:230-242），消息提到 New-Api-User 时前面加补请求头的提示（:244-254）。
- 编辑器提示：粘了令牌但地址不对时给「改用 {站点}/api/user/self」「改用 …/api/v1/user/profile」按钮；地址是 `/api/user/self` 却没 `New-Api-User` 时提示补上（`app.js:13042-13094`）。

### 自定义余额与取值表达式（`balance.go:509-1125, 1161-1284`）

- 方法只有 GET、POST，POST 不带请求体。请求头：key 认证头 + 接口自定义请求头 + `Accept: application/json`。地址或请求头里的 `{key}` `{apiKey}` `{api_key}` `{token}` `{{key}}` `${API_KEY}` 替换成 key（URL 里先转义）。回复最多读 1 MB。
- 表达式：点分路径与数组下标；`+ - * /`、括号、一元负号、数字；除以 0 报错，列表逐项计算时那一项记缺失；前缀 `$ ¥ € £` 只加符号；后缀 `%` 把 0.25 显示成 25% 并带进度条；`a.*.x` 展开、`a[k=v]` / `[k!=v]` 过滤可叠加；`sum()` `max()` `min()` `count()`，列表不进函数报错；`;` 分隔多项，每项可加 `标签:`，缺失项显示「—」；单条路径取到字符串原样显示。示例见 :513-522 与 `cli/providers_cli.go:121-130`。

### 套餐窗口（`provider/planquota.go:37-69, 503-643`）

- GLM Coding（bigmodel.cn / api.z.ai）`/api/monitor/usage/quota/limit`，裸 key 作 Authorization；unit 3 = N 小时（团队无 number 按 5）、unit 6 = 7 天、TIME_LIMIT =「MCP · Month」放一旁；`percentage`、`nextResetTime`（毫秒）。401 或 1000–1005：「key 过期或已删除，去某处换」（:542-571）。团队：个人窗口为空时请求 `?type=2`，带 `Bigmodel-Organization`、`Bigmodel-Project`、`Set-Language`（:605-618, 789-837）；团队按窗口的重置次数只显示（`codex_resets.go` 的 `ByWindow`、`zcode_team.go`）。**不照做**：没填 ID 时读 ZCode 登录（R1-Q8）。
- Kimi Code（api.kimi.com/.ai 且路径含 `/coding`）`{base}/coding/v1/usages`，Bearer；`limits[]` 按 duration/timeUnit 命名，`usage` 记为 7 天。
- MiniMax（minimaxi.com / minimax.io）`/v1/token_plan/remains`；每桶区间 + 周两个窗口，非 general 桶加桶名前缀放一旁；status 3 不限、2 用完；`100 − remaining_percent`、`end_time`。
- OpenCode Go（路径含 `/zen/go`）`opencode.ai/zen/go/v1/usage`；rolling = 5 小时、weekly、monthly；0% 的 `resetsAt` 丢弃；401 / 403 专门提示（:524-533）。最新版也认 `/inference/go`。
- Command Code `/alpha/billing/credits`：5 小时、Weekly 与 Credits 窗口（`provider/commandcode_plan.go`）。
- Ollama Cloud `ollama.com/api/balance`：Allowance（27–32 天叫 Month），旧套餐 Session + Weekly（`provider/ollama_usage.go:84-137`）。
- 套餐请求只带 Authorization、`Accept: application/json`、`Accept-Language: en-US,en`（:508-517），不带接口自定义请求头。
- 配速 = 已用% − 100 × 已过时间 / 窗口长度，正数表示会提前用完；窗口起点 = 重置时间 − 窗口长度，月窗口取一个自然月前（`provider/window_pace.go:12-22`、`window_holds.go:54-70`）；前端「配速 +12%」（`app.js:13555-13584`）。

### 要额外凭据的套餐

- 火山方舟（`provider/volcengine_usage.go`）：`ark.<region>.volces.com` 路径 `/api/coding` → GetCodingPlanUsage，`/api/plan` → GetAFPUsage；POST `https://open.volcengineapi.com/?Action=…&Version=2024-01-01`，body `{}`；HMAC-SHA256 签名，签名头 `content-type;host;x-content-sha256;x-date`，scope `日期/region/ark/request`（:185-277）；session / weekly / monthly。
- 腾讯云 Token Plan 企业版（`provider/tencent_usage.go`）：`tokenhub(-intl).tencentmaas.com/plan` → ap-guangzhou / ap-singapore；POST `tokenhub.tencentcloudapi.com`，Version 2026-03-22，DescribeTokenPlanList（Limit 100）再 DescribeTokenPlan；TC3-HMAC-SHA256（:326-352）；一个月窗口。magpie 注释说没在真实接口上测过（:19-21）。
- 没填 AK/SK 时也出卡，提示「需要 AccessKey」并带打开设置的按钮（`provider/access_key_card.go`）。
- 阶跃 Step Plan（`provider/stepfun_plan.go`）：**不做**（R1-Q7）。

### 查询时机、失败与界面

- 缓存 1 分钟，保存接口后清空（`balance.go:1318-1333`、`planquota.go:630-643`）。编辑器「查询余额」15 秒超时（`gui/providers.go:1822-1850`），单卡刷新 30 秒（`gui/usage.go:205-215`）。每家最多 8 个请求并行（`provider/keys.go:264-295`）。
- 暂时性失败（429、5xx、超时、网络错误，`provider/quota_last.go:44`）显示磁盘上 `quotas.json` 的上次读数。
- 失败文字：网络错误原样（key 打码）；`success:false` 显示站点 message；≥300 的 JSON 回复显示「状态 + 前 200 字」，HTML 只显示状态码；不是 JSON、路径取不到、取到的不是数字各一句（:622-648, 970-972, 1191-1243）。前端 `quotaError` 把已知错误换成短句，其余「暂时无法获取额度」，原文放悬停（`app.js:12956-13042`）。
- 界面文字（`i18n.js`）：Balance URL / 余额查询地址（1804）、Balance request method / 余额查询方法（1805）、Balance field / 余额字段（1810）、Check balance / 查询余额（2768）、Account balance / 账户余额（2729）、optional · the account's system access token / 可选 · 账户的系统访问令牌（2758）、Balance / 余额（1812）、Pace {n} / 配速 {n}（942）、Resets {when} / 重置于 {when}（2773）。界面上的「额度」类词按术语表改说「余额」「套餐用量」。
- 余额行：标签 + 粗体金额，多项每项一行，带 % 的加进度条，90% 起变琥珀色（`app.js:17457-17485`）。窗口：名称 + 已用 / 剩余（点击切换）+ 进度条 +「重置于 {when}」+「配速 ±N%」（`app.js:17660-17745`）。
- 查询身份：magpie 余额与套餐请求都不设 User-Agent（Go 默认值）。**不照做**：Osuna 写 `Osuna/<version>`（R1-Q9）。

### Codex 重置卡（`provider/codex_resets.go`、`subscription_usage.go:956-1014`）

- 次数取 `wham/usage` 回复的 `rate_limit_reset_credits.available`；有次数时另 `GET {base}/wham/rate-limit-reset-credits`（带 `chatgpt-account-id`，4 秒超时，失败只留次数）取每张的 `expires_at`，最早过期的在前，永不过期的在后。
- 用掉一张：先读清单挑最早过期的那张（读不到就不用），`POST {base}/wham/rate-limit-reset-credits/consume`，body `{credit_id, redeem_request_id}`（随机 UUID v4 作幂等键），回 `{code, windows_reset}`；`code` 为 reset / nothing_to_reset / no_credit / already_redeemed，各有一句说明。用完立刻重读用量。不可撤回，调用方先确认。
- **不照做**：自动用掉（`quota auto-reset`）、关掉「用 credits」（总任务 Out of Scope 02·B30 与块 12）。

### 最新版（`ea6be159`）的相关差异

- DeepSeek 余额拆「赠送 / 充值」两项显示在总额下（1bc61b66，`readDeepSeekSplit`）。做。
- OpenCode Zen 出一张说明卡：OpenCode 不给 API key 查余额，请去控制台 Overview → Credits（c483fead，`errOpenCodeNoBalance`）。做。
- OpenCode Go 也认 `/inference/go`。做。
- 卡片默认按供应商页顺序（5c557c79）：本任务不做卡片排序，不涉及。
