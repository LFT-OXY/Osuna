# 18 — 保留 claude.ai 登录

**What to build:** 用 claude.ai 登录的 Claude Code 用户，走中转站时可以选择保留登录，语音、claude.ai 连接器、`/usage` 的套餐额度、云端会话照常能用；claude.ai 令牌只用在 Anthropic，从不转给接口。

- **设置页**：Claude Code 设置页「使用第三方接口」区加「保留 claude.ai 登录」（Switch，默认关）。说明打开后哪些能用（语音、claude.ai 连接器、`/usage` 套餐额度、云端会话），哪些仍不能用（Remote Control、ultrareview）。
- **写配置**：打开时 `ANTHROPIC_AUTH_TOKEN` 写成空值（负责的键），Claude Code 于是带着 claude.ai 登录发请求；关掉选项时写回口令。
- **中转站**：收下 claude.ai 的令牌但从不转发给接口；去掉 `anthropic-beta` 里 `oauth-` 开头的项。
- **错误**：对话与 count_tokens 请求，上游回 401，或回 403 且说 OAuth 令牌已吊销时，改回 502 `api_error` 并写明是哪家接口，免得 Claude Code 以为用户的登录失效、要求重新登录；其他错误保持状态码，只把正文里的 `x-api-key` 换成 `API key`（照 magpie）。
- **两种不一致**（照 magpie 检查并在提示区提示）：选项开着但口令被手填回去；选项关着但口令是空的。

**Blocked by:** 02, 03
**Status:** ready-for-agent
**Impl:** ready

- [ ] 端到端：选项打开后 `settings.json` 的 `ANTHROPIC_AUTH_TOKEN` 为空；关掉选项后写回口令；关掉总开关时按接管记录还原。
- [ ] 带 claude.ai 形式令牌和 `oauth-` beta 的请求：假上游收到的请求里没有这个令牌（用这家接口自己的 key），`anthropic-beta` 里没有 `oauth-` 项。
- [ ] 上游 401、吊销的 403 让 CLI 收到 502 和接口名；其他 4xx 保持状态码，正文里的 `x-api-key` 换成 `API key`。
- [ ] 两种不一致各有提示。
- [ ] 浏览器测试：开关保存成功与失败两种。
- [ ] UI: Claude Code 设置页 / 「保留 claude.ai 登录」关着、说明可见 / 桌面 1280 — 能用与不能用的功能都写明，开关是 Switch。
- [ ] 借鉴 magpie 的代码，文件头保留 MIT 声明；新文案 9 种语言齐全；截图用无头浏览器在临时文件夹里拍（用户 2026-10-18 已同意）。
- [ ] `npm run typecheck`、`npm run lint` 通过，改到的测试文件本机通过。

参考：prd.md 第 27 条；research/claude-code-wiring.md 第 1 题；decisions.md Q15、Q24。
