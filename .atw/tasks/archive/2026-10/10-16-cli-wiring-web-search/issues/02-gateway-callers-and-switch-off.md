# 02 — 中转站认调用方；关掉开关后会话和旧对话照样能用

**What to build:** 中转站不再靠口令挡人，改成照 magpie 认调用方；关掉「使用第三方接口」不再打断正在用的会话和用过中转站的旧 Codex 对话。

- **收谁**：本机回环来的、不带转发头的请求一律收（magpie「Loopback takes any token」）。照 magpie 拒收网页发来的请求（带 `Origin` 头的跨站请求、DNS 重绑定）和带转发头的请求；转发头名单照 magpie（比现在多 Cf-Connecting-IP、True-Client-IP、Tailscale-User-Login 等）。
- **认是哪个 Agent**：口令对得上就按口令；对不上（ChatGPT 令牌、claude.ai 令牌、空值）就按请求路径和 User-Agent 认，规则照 magpie。ChatGPT 后端那组路径由 08 号工单加，那时按路径认作 Codex。
- **口令不再作废**：口令照旧写进 CLI 配置（CLI 要一个值），打开、关掉开关都保持不变。关掉开关后正在运行的会话继续经中转站，直到用户重开它们。
- **Osuna 的 Codex 服务商表写了就保留**：关掉开关时不删；daemon 启动时即使开关关着，也按新端口改写这张表。开着时开的 Codex 对话，关掉后在 Osuna 和终端都能续（要 daemon 在运行），中转站照常接这些请求。

**Blocked by:** 01
**Status:** ready-for-agent
**Impl:** done

- [x] 端到端：不带口令、带 ChatGPT 形式令牌、带 claude.ai 形式令牌的本机请求都被收下，并认对 Claude Code、Codex。
- [x] 带 `Origin` 头、DNS 重绑定形式、带任一转发头的请求被拒，回 Agent 认得的错误格式。
- [x] 关掉开关后，带原口令的请求照常被接；再打开开关，CLI 配置里的口令不变。
- [x] 关掉 Codex 的开关后，`config.toml` 里 Osuna 的 Codex 服务商表还在，其余负责的键照 ADR 0004 还原；daemon 换端口重启后，即使开关关着，表里的地址指向新端口；用这张表发来的请求照常被接。
- [x] 认调用方的规则有纯逻辑用例；User-Agent 规则与拒收规则对照 magpie，结论写进实现记录。
- [x] 借鉴 magpie 的代码，文件头保留 MIT 声明。
- [x] `npm run typecheck`、`npm run lint` 通过，改到的测试文件本机通过。

参考：prd.md 第 15、19、37 条；research/codex-wiring.md 第 8、12、13 题；research/claude-code-wiring.md 第 1e 题；decisions.md Q10、Q17、Q24。
