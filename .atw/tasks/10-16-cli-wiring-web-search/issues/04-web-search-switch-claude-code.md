# 04 — 「自己能联网搜索」开关；Claude Code 的搜索

**What to build:** 用户给会联网搜索的那家接口打开「自己能联网搜索」，Claude Code 用这个模型时就能真的搜网页；没有这样的接口时，Claude Code 得到明确的「不能联网搜索」，模型不会把凭记忆写的话当成搜索结果。

- **字段**：接口多一个可选布尔字段「自己能联网搜索」，随接口保存；旧的 `endpoints.json` 没有它即为关。只在这家有 Anthropic 或 OpenAI Responses 地址时算数。
- **接口页**：「联网搜索」一行，Switch「自己能联网搜索」，下面一行说明：适用于 Anthropic 或 OpenAI 官方接口前面的中转，Claude Code 和 Codex 的联网搜索原样交给它；打开或关掉后，正在运行的 Claude Code 会话下一次请求就跟着变，这一次的提示缓存失效。只在有 Anthropic 或 Responses 地址时出现；默认关，Osuna 不自动探测、不按厂商自动打开。保存中、成功、失败三态。
- **`settings.json`**：至少一家开着的接口打开了这个开关时，Osuna 不写、并拿掉自己写的 `WebSearch` 禁止规则；一家都没有时照旧写。条件变了就重写（指纹包含这个条件）。用户自己写的规则不动。
- **中转站**：认出 Claude Code 的搜索子请求（请求里带 `web_search_*` 服务端工具）。候选只取同一个模型下、开着、打开了开关、有 Anthropic 地址的接口，在它们之间照常自动切换，原样直通；对话本身走哪家不影响；Subagent 里的搜索按 Subagent 的模型找。只有 Responses 地址的接口归 06 号工单，本张不把搜索交给它们。
- **一家都没有时**：回 Anthropic 格式的 400 `invalid_request_error`，文字说明这个模型没有开着「自己能联网搜索」的接口。不用 401、403（会让 Claude Code 要求重新登录），不用 429、5xx（会让它重试）；不剔掉工具后照发。

**Blocked by:** 03
**Status:** ready-for-agent
**Impl:** done

- [x] 协议：接口的新字段可选，列表与保存都带它；旧客户端保存接口时不丢这个字段（照 `manualModels` 的做法，省略即保留）。
- [x] 存储：旧 `endpoints.json` 照常读；保存后重启 daemon，字段还在。
- [x] 端到端（`settings.json`）：一家都没开 → 有 Osuna 的 `WebSearch` 禁止规则；打开一家 → 规则被拿掉；再关掉 → 规则回来；用户自己写的规则在三种情况下都原样在。
- [x] 端到端（中转站）：同一模型有 A（开了开关、有 Anthropic 地址）、B（没开）、C（开了开关）三家，对话指定 B 时搜索子请求先到 A，A 失败换到 C，从不到 B；工具与 system 原样到达。
- [x] 一家都没有时，CLI 收到 400 `invalid_request_error` 和说明文字，假上游没收到请求。
- [x] 浏览器测试：开关保存成功与失败两种，失败信息留在原处。
- [x] UI: 接口详情页 / 有 Anthropic 地址 / 桌面 1280 — 「联网搜索」一行和说明可见，开关是 Switch。
- [x] UI: 接口详情页 / 只有 Chat 地址 / 桌面 1280 — 没有「联网搜索」一行。
- [x] 新文案 9 种语言齐全，用词与 `docs/glossary.md`「自己能联网搜索」一致；截图用无头浏览器在临时文件夹里拍（用户 2026-10-18 已同意）。
- [x] 借鉴 magpie 的代码，文件头保留 MIT 声明。
- [x] `npm run typecheck`、`npm run lint` 通过，改到的测试文件本机通过。

参考：prd.md 第 7、8、9 条；research/web-search.md 第 1、5、8、9、10、11 题与第 12 题路线 B；decisions.md Q19、Q21。
