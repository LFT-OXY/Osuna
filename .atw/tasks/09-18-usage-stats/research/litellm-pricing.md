# LiteLLM 价格表：结构、体积、许可与 Paseo 出站策略

对应研究票：`map-issues/04-litellm-pricing.md`。采样时间 2026-09-18，来源文件 `https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json`（ETag `d390d265…eef2`，Content-Length 2793090）。统计脚本与原始输出见文末"复现"。

## 1. 条目结构与字段名

顶层是一个对象：`{ "<model key>": { …字段… } }`。第一个键 `sample_spec` 是字段说明样例（所有成本为 0），**读取时必须跳过**；参考项目的 `seed-snapshot.json` 没跳，把它当成了一个 0 价模型。

### 四列单价字段（票里问的四个名字全部确认）

| 字段                              | 出现条目数 | 占比（/4306） | 含义       |
| --------------------------------- | ---------- | ------------- | ---------- |
| `input_cost_per_token`            | 3676       | 85.4%         | 输入       |
| `output_cost_per_token`           | 3666       | 85.1%         | 输出       |
| `cache_read_input_token_cost`     | 1577       | 36.6%         | 缓存命中读 |
| `cache_creation_input_token_cost` | 469        | 10.9%         | 缓存写入   |

- 同时有 input+output 的 3646 条（84.7%）；任意含 `cache` 字样字段的 1597 条（37.1%）。
- **单位：美元 / 每 token**（`sample_spec` 里 `input_cost_per_token: 0.0`；`claude-sonnet-4-5` 为 `3e-06`，即 $3/MTok；`claude-opus-4-8` 为 `5e-06`/`2.5e-05`）。转成设置界面的"每百万"要乘 1e6，并按参考项目做十位小数取整（`matcher.js:373-375`，否则 `1e-7*1e6 = 0.09999999999999999`）。
- 缓存写入字段缺省很常见：OpenAI 全系（`gpt-5`、`gpt-5.1-codex`、`gpt-5.4` 等）只有 `cache_read_input_token_cost`，没有 `cache_creation_input_token_cost`（OpenAI 缓存不收写入费），计价时缺省按 0。
- DeepSeek 老条目用另一个名字 `input_cost_per_token_cache_hit`（38 条），新条目已同时带 `cache_read_input_token_cost`（如 `deepseek/deepseek-chat` 两个都有）。四列方案只读标准名即可，`deepseek-chat`/`deepseek-reasoner` 裸键都有标准字段。

### 四列之外、会影响估算精度的字段（本任务按 Q6/Q17 决定忽略，记录为已知偏差）

| 字段族                                                                | 条目数     | 说明                                                                                                                                                                      |
| --------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `*_above_200k_tokens` / `*_above_272k_tokens` / `*_above_128k_tokens` | 118/118/15 | 长上下文分档：Claude 1M 上下文 >200k 翻倍（`claude-sonnet-4-5.input_cost_per_token_above_200k_tokens: 6e-06`）、OpenAI >272k                                              |
| `cache_creation_input_token_cost_above_1hr`                           | 177        | Claude 1 小时缓存写入（`6e-06`，是 5 分钟档 `3.75e-06` 的 1.6 倍）。Claude Code 日志把 cache_creation 拆成 ephemeral_5m / 1h（见票 01），四列方案会把 1h 写入按 5m 价低估 |
| `*_priority` / `*_flex` / `*_batches`                                 | 201/95/304 | OpenAI 服务档位；Codex CLI 用户走订阅，不影响                                                                                                                             |
| `output_cost_per_reasoning_token`                                     | 71         | 极少数模型推理 token 单独计价；参考项目按 output 价计 reasoning，且 Codex 的 reasoning 已含在 output 里记 0                                                               |

### 元数据字段

`litellm_provider`（4305 条，几乎全有）、`mode`（4297 条；`chat` 3352、`responses` 139、其余是 image/embedding/audio 等非对话模型）、`max_input_tokens`/`max_output_tokens`、`deprecation_date`（792 条）、`source`（2558 条，官方定价页 URL，如 `https://platform.claude.com/docs/en/about-claude/pricing`）。四列精简时可顺带保留 `litellm_provider`（用于按 provider 匹配，见第 3 节），其余丢弃。

## 2. 条目数与体积

```
raw bytes: 2793090            # 2.66 MiB，严格 JSON（python json.load 通过，无注释）
entries (excluding sample_spec): 4306
slim entries: 3696; minified bytes: 444558; pretty bytes: 500591   # 只留四列、且至少一列有值
slim chat-only entries: 3208; minified bytes: 393225
gzip of slim4.min.json: 38522
gzip of raw: 128665
```

- 只留四列后 **3696 条、约 434 KiB（压缩后 38 KiB）**；再顺带保留 `litellm_provider` 约 +60 KiB。作为 server 包内置快照没有问题：参考项目 2026-05 的 seed 是 2284 条 / 257 KB，同一量级；server 包已内置远大于此的资源（sherpa 语音模型目录等）。
- 每日拉取的传输量：原始 2.8 MB；`raw.githubusercontent.com` 返回 `etag` 且 `cache-control: max-age=300`，用 `If-None-Match` 条件请求可在未变更时拿 304，避免每天 2.8 MB。参考项目没做条件请求（`litellm-fetcher.js:54-66` 每次全量 GET）。
- 四列以外的字段占了体积的 84%，精简是必要的；不建议进一步按 `mode==chat` 过滤（少 51 KB，但 Codex 的 `gpt-5.1-codex` 等 `mode` 是 `responses`，过滤条件不好定）。

## 3. key 命名惯例与需要的归一化

### 惯例

```
no-prefix count: 629   distinct prefixes: 118
top prefixes: openrouter 460, fireworks_ai 323, azure 301, bedrock 178, vertex_ai 150, deepinfra 135, novita 135, azure_ai 130, vercel_ai_gateway 101, together_ai 96, mistral 94, gemini 82, …, github_copilot 33, ollama 29, moonshot 24, zai 16, deepseek 10, openai 4, anthropic 0
bare keys by litellm_provider: openai 179, bedrock_converse 171, bedrock 114, vertex_ai-language-models 37, anthropic 28, …
prefixed keys whose suffix also exists as bare key: 415
uppercase keys: 489 (HF 风格，如 anyscale/meta-llama/Meta-Llama-3-70B-Instruct)
keys with @ or : 432 (Bedrock/Vertex，如 anthropic.claude-opus-4-1-20250805-v1:0、anthropic.claude-haiku-4-5@20251001)
keys with dotted version: 1345 (如 openrouter/anthropic/claude-sonnet-4.5、gpt-5.1-codex)
keys with -YYYYMMDD suffix: 16
```

结论：

1. **Anthropic 与 OpenAI 直连模型是裸键**：`claude-sonnet-4-5`、`claude-opus-4-8`、`claude-fable-5-1`、`gpt-5.1-codex`、`gpt-5.4`。`anthropic/` 前缀在表里 **0 条**，`openai/` 只有 4 条。所以 `anthropic/claude-sonnet-4-5`、`openai/gpt-5-codex` 直接查会 miss，必须剥前缀。
2. **Claude 裸键同时有带日期与不带日期两种**：`claude-opus-4-1` 与 `claude-opus-4-1-20250805` 都在；但并非每个都有日期版（`claude-opus-4-8` 无日期版）。Claude Code 日志里的 model id 是带日期的（票 01），查不到时应退回去掉 `-YYYYMMDD` 的键。
3. **Claude 版本号在裸键里是横线（`4-5`），在网关前缀键里是点（`openrouter/anthropic/claude-sonnet-4.5`）**；GPT 系列裸键本来就是点（`gpt-5.1-codex`）。这就是参考项目 `normalizeClaudeModel`（`matcher.js:89-121`）存在的原因：只对 `claude-(sonnet|opus|haiku)-X.Y` 做点→横线，不动 GPT。
4. **同一模型多前缀重复** 415 条，Pi/OMP 走 OpenRouter 等中转时，日志里的 model id 是 `anthropic/claude-sonnet-4.5` 这类带上游 provider 的路径，对应表里的键是 `openrouter/anthropic/claude-sonnet-4.5`。Paseo 从 Pi/OMP 日志能拿到后端 provider（Q25），应先试 `<provider>/<model>`，再试裸模型。
5. `github_copilot/*` 条目四列全空（`github_copilot/gpt-5` 四列均为 null），订阅路由本来就该记 0（参考项目 `pricing/index.js:18-23`）。`ollama/*` 全为 0。

### 参考项目七级匹配的取舍（`matcher.js:1-12, 246-365`）

| 级别 | 做法                                                        | Paseo 是否需要                                                                                                                            |
| ---- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 0/1  | curated source 精确、curated 精确                           | 对应 Q17 用户覆盖表，用户覆盖优先级最高，需要                                                                                             |
| 2    | LiteLLM 精确（含大小写不敏感、`4-5`→`4.5` 点还原再查）      | 需要；先原样、再小写                                                                                                                      |
| 3/4  | curated 别名、curated 子串                                  | 不需要，参考项目用来对付 Cursor `auto`、kiro 等 Paseo 不支持的来源                                                                        |
| 5    | 剥推理档位后缀 `-xhigh/-high/-medium/-low/-fast`            | 视票 02 结论：Codex rollout 若把 effort 写进 model 字段则需要                                                                             |
| 5b   | 剥 provider 前缀：找所有以 `/<bare>` 结尾的键，取字典序最小 | 需要，但 Paseo 有 provider 信息，应先 `<provider>/<model>` 精确，再退到此级；字典序最小是为了确定性，价格可能取到别家网关的报价           |
| 6    | 反向子串（最长键优先，要求 model 包含 key）                 | 建议不做：误匹配风险（`gpt-5-pro-xyz` 命中 `gpt-5-pro` 尚可，但任意字符串含 `o3` 之类短键会乱命中），Q17 已有"无价格模型列表可直接填"兜底 |
| 7    | miss → 全零 + 负缓存                                        | 需要（Q6：记 $0 并标"无价格数据"），负缓存在价格表刷新时清空（`index.js:83`）                                                             |

建议的 Paseo 归一化最小集：`trim` → 小写 → Claude 点/横线互转与 `sonnet-4-5`→`claude-sonnet-4-5` 补前缀（`normalizeClaudeModel` 的三条规则）→ 去 `-YYYYMMDD` 日期后缀重试 → 剥 provider 路径取末段重试。所有归一化只用于查价，存储和展示保留原始 model id（参考项目同一原则，`matcher.js:191-193`）。

## 4. 许可证

LiteLLM 仓库根 `LICENSE`（`curl` 原文，摘录）：

```
* All content that resides under the "enterprise/" directory ... is licensed under ... "enterprise/LICENSE".
* Content outside of the above mentioned directories ... is available under the MIT license as defined below.
MIT License
Copyright (c) 2023 Berri AI
... The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
```

`model_prices_and_context_window.json` 在仓库根目录，不在 `enterprise/`，适用 **MIT**。内置快照与再分发允许；唯一义务是随快照附带版权与许可声明。Paseo 是 Apache-2.0（`docs/product.md:47`），MIT 兼容。做法沿用仓库先例：第三方代码在其目录旁放原 `LICENSE` 文件（`packages/highlight/src/astro/LICENSE`、`packages/app/modules/paseo-word-stream/LICENSE`、`packages/expo-two-way-audio/LICENSE`），没有集中的 THIRD-PARTY 文件。价格快照同样在其所在目录放一份 LiteLLM 的 MIT LICENSE 原文，快照 `_meta` 记 `source`、`fetchedAt`。

## 5. Paseo 出站策略

### 现有承诺与先例

- `docs/product.md:46`："No Paseo telemetry, tracking, or forced account. The relay is optional and end-to-end encrypted."；`README.md:48` 同义。承诺的是**不上报用户数据**，不是"daemon 永不联网"。
- 现有出站请求与门控方式：

| 请求                                                                                                                             | 触发                                                                                                                                       | 门控                                                                                                                                                                                         | 位置                                                          |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Plan usage：`api.anthropic.com/api/oauth/usage`、`chatgpt.com/backend-api/wham/usage`、`api.github.com/copilot_internal/user` 等 | **客户端按需**：app 打开用量 tooltip / Host Usage 设置页时发 `provider.usage.list.request`，daemon 不主动定时拉（`docs/providers.md:185`） | 只看本机是否有该 provider 凭证（`providers/claude.ts:359-363`），**没有 config 开关**；5 分钟内存缓存（`service.ts:20`）；15 秒超时（`usage.ts:10`）；失败降级 `unavailable`，`debug` 级日志 | `packages/server/src/services/quota-fetcher/`                 |
| 语音模型下载 `github.com/k2-fsa/sherpa-onnx/releases/…`                                                                          | 用户选用本地语音模型时                                                                                                                     | 用户动作                                                                                                                                                                                     | `server/speech/providers/local/sherpa/model-catalog.ts:20-38` |
| Relay（`daemon.relay.enabled`）、服务代理（`daemon.serviceProxy.enabled`）、MCP（`daemon.mcp.enabled`）                          | 常驻连接                                                                                                                                   | `config.json` 持久化布尔 + `PASEO_*` 环境变量覆盖（`server/config.ts:295-322, 351-356, 529`）；relay 默认关直到配对同意（`docs/architecture.md:170`）                                        | `server/config.ts`                                            |
| 桌面端 electron-updater 检查更新                                                                                                 | 桌面进程                                                                                                                                   | 与 daemon 无关                                                                                                                                                                               | `packages/desktop/src/features/app-update-service.ts`         |

### 与价格表拉取的差异

价格表拉取是 **daemon 自发、定时、无用户动作** 的第一个出站 GET，这在 daemon 里没有先例（quota-fetcher 是客户端触发；relay 是常驻但需同意）。请求本身不携带任何用户数据（无鉴权、无查询参数），GitHub 只能看到 IP 与 UA；不违反"无遥测"，但它是 headless/Docker 主机会在日志里看到的新网络行为。

### 结论

1. **需要开关**（Q6 已定），沿用现有模式：`config.json` 里 `daemon.usage.pricingAutoUpdate`（或同类命名，命名归实现票）+ `PASEO_*` 环境变量覆盖，默认开；关掉时只用内置快照与用户覆盖。
2. **开关之外还需要三件事**，否则"无遥测"表述会被质疑：
   - `docs/product.md` 隐私条目或用量功能文档写明：用量功能唯一的网络请求是向 GitHub raw 拉公开价格表，不含任何用户数据，可关闭，离线时用内置快照。
   - 请求用 `If-None-Match` 条件 GET 与超时（沿用 15 秒），未变更返回 304 不落盘；失败只在 `debug`/`info` 记一条，不重试风暴（参考项目 24 小时 TTL + 10 秒超时 + 失败退回陈旧缓存 → seed，`litellm-fetcher.js:107-164`，这个降级链可以照搬）。
   - 磁盘缓存只存精简四列（参考项目 `writeCache` 同样只存四列，`litellm-fetcher.js:68-105`），放 `$PASEO_HOME/usage/` 下与 Q7 的存储同目录，便于用户检查。
3. 不需要把拉取挪到客户端：计价在 daemon 做（Q7 行里带估算成本），价格表归 daemon 所有；客户端只读。

## 复现

```bash
cd $SCRATCH
curl -sSL -o litellm_prices.json https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json
curl -sSL -o litellm_LICENSE https://raw.githubusercontent.com/BerriAI/litellm/main/LICENSE
curl -sI https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json | grep -iE 'etag|cache-control|content-length'
python3 stats.py   # 见下方
```

`stats.py` 要点：`json.load` 后 `pop('sample_spec')`；`Counter` 统计字段频率；前缀取 `key.split('/')[0]`；精简 = 每条只留四列且至少一列为数值，`json.dumps(separators=(',',':'))` 计字节；`gzip.compress` 计压缩后体积。原始输出（节选）：

```
raw bytes: 2793090
entries (excluding sample_spec): 4306
  3676  input_cost_per_token
  3666  output_cost_per_token
  1577  cache_read_input_token_cost
   469  cache_creation_input_token_cost
entries with input+output cost: 3646 (84.7%)
entries with any cache field: 1597 (37.1%)
mode==chat: 3352 (77.8%)
no-prefix count: 629 distinct prefixes: 118
anthropic 0 / openai 4 / openrouter 460 / github_copilot 33 / ollama 29
slim entries: 3696; minified bytes: 444558; gzip: 38522
prefixed keys whose suffix also exists as bare key: 415
claude-sonnet-4-5 {'input_cost_per_token': 3e-06, 'output_cost_per_token': 1.5e-05, 'cache_read_input_token_cost': 3e-07, 'cache_creation_input_token_cost': 3.75e-06}
gpt-5.1-codex     {'input_cost_per_token': 1.25e-06, 'output_cost_per_token': 1e-05, 'cache_read_input_token_cost': 1.25e-07, 'cache_creation_input_token_cost': None}
anthropic/claude-sonnet-4-5 -> MISSING
openai/gpt-5-codex -> MISSING
github_copilot/gpt-5 -> 四列均 None
HTTP/2 200  cache-control: max-age=300  etag: "d390d265…"  content-length: 2793090
```

参考项目文件：`TokenTracker/src/lib/pricing/{index.js, matcher.js, litellm-fetcher.js, curated-overrides.json, seed-snapshot.json}`；seed `_meta.generated_at: 2026-05-26`, `kept_models: 2284`（含被误保留的 `sample_spec`）。
