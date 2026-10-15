# magpie 参考项目调研

来源：`/Users/oxy/Documents/Configuration/dev-environment/demo/agent客户端源码/magpie`（Go 单二进制，Wails GUI + TUI + Web）。调研日期 2026-10-13，由子代理通读源码得出，引用为该仓库内的 `文件:行号`。

## 运行形态

- 本机 HTTP 网关，默认 `127.0.0.1:3425`（`internal/gateway/gateway.go:42`），`MAGPIE_ADDR` 或 `settings.json` 的 `port` 可改。
- 回环上任何 key 都可用；按 Agent 区分的 token 为 `magpie-<agent>`（`gateway.go:46-51`），用于用量归属。局域网共享必须用网关 key。
- 路由：`/v1/chat/completions`、`/v1/responses`、`/v1/messages`、`/v1beta/models/*`（Gemini）、`/v1/models`、`/v1/magpie/quotas|usage|route|limit`（`gateway.go:521-581`）。

## 接入方式：改 Agent 自己的配置文件，不注入进程环境变量

`docs/subsystems/agent-wiring.md`。旧值存 `stash.json`，断开时还原；写过什么记在 `applied.json`，用于检测被外部改动。编辑保留注释、顺序、BOM，原子写入（`internal/edit`）。端口变了自动重写所有已接入 Agent（`Rewire`）。

| Agent | 文件 | 写入 |
|---|---|---|
| Claude Code | `~/.claude/settings.json` | `env.ANTHROPIC_BASE_URL`、`env.ANTHROPIC_AUTH_TOKEN=magpie-claude`、`ANTHROPIC_SMALL_FAST_MODEL`、`ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU,FABLE}_MODEL`、`CLAUDE_CODE_SUBAGENT_MODEL`、`model=provider/model`；主动删 `ANTHROPIC_MODEL`（它会盖过 `/model`）（`internal/agent/claude.go:24-37, 1070-1100`） |
| Codex | `~/.codex/config.toml` | 已登录 ChatGPT：只写 `openai_base_url`；否则写 `[model_providers.magpie]`（`wire_api="responses"`、`experimental_bearer_token`）+ `model_provider` + `model_catalog_json`（`internal/agent/codex.go:30-62`） |
| Gemini CLI | `~/.gemini/.env`、`settings.json` | `GOOGLE_GEMINI_BASE_URL`、`GEMINI_API_KEY`、`model.name`、`security.auth.selectedType` |
| OpenCode | `~/.config/opencode/opencode.json(c)` | `provider.magpie`（`@ai-sdk/openai-compatible`）+ `model`/`small_model` |

与 Osuna 现有「第三方接口」（ADR 0004）是同一招，区别是 magpie 让 Agent 指向自己。

## 配置模型（`providers.json`，0600）

`Provider{id, name, key, keys[]{name,key,off,protocol,weight}, chat/responses/anthropic/gemini 四种 URL, models[], fallback[]("provider/model"), routing, sink, affinity, maxConcurrency, maxRPM, quotaRest, headers, proxy}`（`internal/provider/provider.go:46-363`，`keys.go:21-31`）。`groups[]` 路由组可嵌套（`group.go:145-223`）。订阅账号运行时从 Agent 登录凭据推导，不落盘。Agent 看到的模型一律是 `provider/model` 或 `group/<id>`。

## 额度判断与切换（本任务最关心）

失败归类 `failure()`（`internal/gateway/routing.go:266-299`，正则 `:124-160`）：

| 归类 | 条件 |
|---|---|
| credit（没钱） | 402；或错误体含余额/欠费/insufficient balance/`insufficient_quota` |
| quota（套餐用完） | 429 且带重置时间；或 4xx 含 quota/usage limit/额度/用量/套餐/上限；或 5xx 带厂商额度码（Claude `limit reached|<unix>`、ChatGPT `usage_limit_reached`、Google `RESOURCE_EXHAUSTED`）；或 429 含 daily/weekly |
| rate（短时限流） | 429 含 rate limit/RPM/频率且不涉及套餐 |
| 其他 | auth、verify、restricted、proxy、overflow（上下文超长：不换，直接回给 Agent） |

值得换下一个候选的错误 `retryable()`（`fallback.go:1075-1100`）：401/402/403/404/408/429/5xx；400/422 仅当命中额度、模型不支持、格式、地区关键词。`modelRefused`/`modelRetired` 只冷却该模型不冷却账号。

切换前提：回复还没开始发给客户端，由 `holdWriter` 先缓冲（`fallback.go:1279`）。主循环在 `gateway.go:1299 serve` 遍历候选，失败调 `restAfterMarked` 冷却后 `continue`。最后一个候选遇 408/5xx/529/限流原地重试：普通 2 次、限流 3 次，退避 1s/2s/4s 或 `Retry-After`（≤8s）。

冷却 `restAfterMarked`（`routing.go:545-674`，常量 `:91-122`，`rateRest` `:685-722`）：

| 原因 | 时长 |
|---|---|
| credit | 30 分钟 |
| quota | 错误体重置时间 → 已知额度窗口重置时间 → `Retry-After` → 默认 15 分钟（`quotaRest` 可改）；上限 8 天 |
| rate | 1 分钟起翻倍，最长 30 分钟；有 `Retry-After` 按它 |
| 其他 | 1 分钟起指数退避，最长 10 分钟 |
| restricted | 2 小时 |

提前恢复：额度窗口重置回调 `renewed()`；成功回答立即清冷却（`servedCandidate`）；GUI 可手动 `Unrest`。

排序模式 `weighRouted()`（`routing.go:895-1137`）：smart（默认，按额度富余 <90% / 偏低 / 用完 ≥98% 分档，富余档优先最早重置）、order、rotate、usage、pace、weight。另有 Sink（被 429 的沉到队尾，仅内存）和 Affinity（同一对话粘在上次账号上以复用提示词缓存，`affinity.json`）。

主动读额度：`SpentShare = 98`（`codex_switch.go:50`），order 模式下 100。

持久化：冷却、sink、轮转计数**只在内存**；affinity、quotas、served、logins、usage.jsonl 落盘。

## 协议互转

统一中间表示 IR（`internal/gateway/ir.go`），四协议各一文件五件套 parse/build/decoder/encoder/render（`anthropic.go`、`chat.go`、`responses.go`、`gemini.go`）。同协议直通 `passthrough`（`gateway.go:3479`），否则 `translate`（`:4810`）。本任务第一版不做互转。

## 订阅账号（本任务不做，记录风险）

- ChatGPT：读 `~/.codex/auth.json` 或自跑 OAuth PKCE（复用 Codex 的 client_id），刷新后写回 `auth.json`；请求发 `chatgpt.com/backend-api/codex`。
- Claude：不调 API，而是后台启动真 `claude -p ... --dangerously-skip-permissions`，工具经 MCP 桥接（`claude_subscription.go`）。
- 两者都在厂商条款边缘，magpie 自己正把部分迁到社区插件（`AGENTS.md:26-45`）。Osuna ADR 0004 明确不碰 `auth.json`。

## 模型名映射

主要靠 Agent 配置里直接写 `provider/model`。Claude 档位替身：正则 `claudeFamily` 识别 `claude-haiku-4-5-…` 这类完整 id，映射到该档位配置的模型（`gateway.go:85-176`）。通用替身 `StandIn`：请求了网关不提供的模型名时改用该 Agent 当前配置的模型。`modelWires` 做上游改名（`modelprefs.go:800-835`）。

## 可观测

每个回复带 `X-Magpie-Provider` / `X-Magpie-Model` 头；Routing 页实时显示候选、冷却原因、最终服务方（`trace.go`）；`usage.jsonl` 请求账本；`magpie quota|accounts|usage|sessions` CLI。

## 追问：兜底、粘性、协议转换规模、许可证（2026-10-13 第二次调研）

### 用尽后退到哪家（`plan`，`fallback.go:330-361`）

- 带 `/` 的模型名（`kimi/kimi-k2.5`）**永远不进自动组**（`group.go:607-613`），候选 = 该 provider 自己的每个 key/账号 + 该 provider 配置的 `fallback[]`（每项是 `provider/model`，`Resolve` 后加入，去重，**只展开一层**，fallback 的 fallback 不算）。冷却中的候选排到最后（`restLast`，`fallback.go:727-746`）。
- **没有全局 fallback**；路由组成员的 fallback 也不算组的。
- 自动组 `auto-<slug>` 只在请求裸模型名时触发；成员顺序按 `providers.json` 的 `order[]`，其余按添加顺序（`provider_order.go:8-31`），同名判定 `sameModel`（去厂商前缀、版本点改连字符、去快照日期）。
- **没有 fallback 时直接失败**：只剩一个冷却候选照样请求它；候选全是 key 且都因额度/余额冷却时不再请求上游，把上次厂商错误原样回给 Agent，附 "(out of its allowance: not asked again before HH:MM)" 与 `Retry-After`（`quotaHeld`，`fallback.go:816-833`；`gateway.go:1976-1981, 2177-2187`）。冷却中的候选一个请求只试最早恢复的那一个（`probeOne`，`fallback.go:761-797`）。
- 退到 fallback 时**用 fallback 条目里写的模型名**，再套 `modelWires` 改名（`modelprefs.go:817-835`）；回复头 `X-Magpie-Provider/Model` 标明实际回答者。

### 冷却结束回不回原来那家（`affine`，`affinity.go:335-405`）

- 粘性 scope = `provider/model` 或 `group/<id>`；对话 id 优先取请求头 `x-opencode-session`、`x-session-affinity`、`x-session-id`、`session_id`、`session-id`、`x-claude-code-session-id`，否则取第一条 user 消息的 sha256 前 12 字节（`gateway.go:5355-5358, 5412-5452`）。记录保留 24 小时，`affinity.json` 最多 512 条。
- 默认 `auto`：同一轮内（Agent 回传工具结果）粘在上次回答者；新一轮只有当上次 `cacheRead ≥ 1024` 且不超过 5 分钟才继续粘，否则回到 `plan` 首位，即用户选的那家。回答者在冷却或用量 ≥98% 时不粘。
- 其他模式：`session` 整个会话粘（冷却/用完除外）；`turn` 只同轮粘；`off` 从不粘；`strict` 永远只用上次那个，出错直接回给 Agent。

### 协议转换规模（`internal/gateway/`，`wc -l`）

| 文件 | 源码 | 对应测试 |
|---|---|---|
| ir.go | 758 | 0 |
| anthropic.go | 1628 | 1374 |
| chat.go | 1231 | 647 |
| responses.go | 1739 | 770 |
| gemini.go | 712 | 1543 |
| codeassist.go | 1127 | 537 |
| gemini_signature.go | 340 | 416 |
| sse.go | 141 | 0 |
| 合计 | 7676 | 另有 wire_test 1254、translate_stream_test 388、count_tokens_test 351 等 |

> 更正（票 03 复核）：上表「对应测试」一列按 `<名>_*_test.go` 通配统计，仓库里并没有 `anthropic_test.go`、`chat_test.go`、`responses_test.go`、`gemini_test.go`、`ir_test.go` 这些同名文件，数字只表示文件名前缀匹配的合计，不能当作单文件测试量；可搬夹具的准确清单以 `magpie-port-inventory.md` 第 5 节为准。

IR 覆盖：流式事件（Start/Text/Think/Sig/ToolStart/ToolArgs/Stop/Usage/Error/Search/Image/ThinkStart/Sealed/TextSig，`ir.go:245-297`）；工具调用与 ToolChoice（auto/none/required/name）、断开的工具配对修补；thinking 及签名、`Sealed/SealedBy` 原样保留各家加密推理；图片/文件；web_search（上游不会就由 magpie 代搜）；结构化输出 `Format`；stop reason 四值映射；usage 字段双向映射。上游一律以流式请求，非流式回复先收齐再渲染。

**不覆盖 / 限制**：推理内容不能跨 API 携带（各家加密推理只回给自己）；IR 没有 `cache_control` 字段，转换到 Anthropic 时 magpie 自己在 system、最后一条消息、最后一个工具加 `ephemeral`，客户端原标记只在同协议直通时保留；无 URL 的 `input_image` 返回 400；Responses 不走 WebSocket；上游不返回流则 502；Vertex 的 grounding 不用。

provider 讲哪种协议由四个 URL 字段决定（`Speaks()`，`provider.go:1251-1304`）；`usable()` 去掉曾被上游拒绝的协议（`unfit`，仅内存），`ResponsesFirst`/`MessagesFirst` 排序；Claude 模型有 Anthropic URL 时即使客户端讲 Chat 也改走 Messages 以保留缓存断点（`gateway.go:3058-3070`）。

`count_tokens`：只转发给有 Anthropic URL 的候选；只讲 Chat/Responses/Gemini 的上游不计数，直接本地估算（字节数 / 4，`gateway.go:1285-1296`）；上游 404/405/501 或 400 表示不支持时也退回估算。

### 许可证

MIT（`LICENSE`，Copyright (c) 2026 yetone），无附加条款；README 称不接受 PR，`docs/reference.md:2462-2470` 却说欢迎。移植代码须保留版权与许可声明。

## 追问：能否被 Osuna 当外部工具托管（2026-10-13 第三次调研）

- **安装/分发**：`curl -fsSL https://usemagpie.ai/install.sh | sh`（支持 `--proxy/--mirror`）、`go install`、Docker `ghcr.io/yetone/magpie`（默认 `serve`）、二进制发布在 GitHub `yetone/magpie-releases`；无 brew/scoop/winget。平台 darwin/linux/windows 的 amd64+arm64、android/arm64；`make cli` 为 `CGO_ENABLED=0 -tags nogui` 纯终端版。Mac 已签名公证，Windows/Linux 未签名。自更新默认每 6 小时查 `usemagpie.ai/api/latest`，`magpie update auto off` 可关。
- **无界面运行**：`magpie serve` 不起 GUI/tray；端口只能用 `MAGPIE_ADDR` 或 `settings.json` 的 `port`（serve 无参数）；无 PID 文件；探活 `GET /` 返回 `{"name":"magpie","version",...}`，`magpie healthcheck` 命令可用；SIGTERM 直接结束、不等进行中的请求。serve 内还跑登录续期、账号切换、签到、插件/Bun 更新、防休眠、WebDAV 同步等后台任务（`gateway.go:435-490`）。
- **配置热加载**：无 fsnotify；`providers.json` 每次用到都重读（`provider.go:392-438`），`settings.json` 按 mtime/size 重读；改端口须重启。外部直接改 `providers.json` 不触发 Agent 模型目录同步（只有 magpie 自己保存才触发 `SyncCatalog`）。`providers.json` 无跨进程锁，仅原子写 + `.bak`。
- **可编程管理**：CLI `provider add|set|key|fallback|rm|test|off|on|models` 等齐全；`magpie claude <model>` 接入 Agent。`--json` 仅 accounts/plugin list/quota/sessions；providers/models/groups 列表无 JSON，需直接读 `providers.json`。网关 HTTP 管理接口只读：`/v1/magpie/quotas|usage|usage/requests|quotas/history|route|concurrency|limit`；GUI 的 `/api/*` 写接口不在网关上、文档未承诺稳定。provider 级 routing/affinity/sink 只有 GUI 能改。
- **接入冲突点**：`serve` 本身不做首次接入（只有 GUI 开关或 `magpie <agent> <model>` 才接入），但 magpie 保存 provider 时会对已接入 Agent 跑 Sync；Codex 登录 ChatGPT 且 magpie 有多个 ChatGPT 账号时会主动写 `openai_base_url`，可用 `magpie accounts switch-only codex on` 关闭。写 `~/.codex/auth.json` 的时机：token 刷新、额度用完自动切换（须有备用账号）、手动 switch、导入账号；`magpie accounts discovery off` 或 `MAGPIE_NO_ACCOUNTS=1` 关闭全部账号读写。无「只跑网关、绝不碰 Agent 文件」的总开关。
- **稳定性**：无 CHANGELOG；首个提交 2026-09-22，3202 次提交，1225 个 tag，10-13 一天 12 个 tag，版本一直 `0.1.x`；`providers.json` 无版本字段、逐字段兼容；文档无 CLI/文件格式兼容承诺，`docs/integrating.md` 建议第三方只读 `settings.json` 的 `port`、"never write it"。
- **规模**（非测试 Go）：`internal/gateway` 56,695 行、`internal/provider` 68,359 行、`internal/` 共 275,169 行；测试 314,522 行；GUI 前端 65,054 行。
