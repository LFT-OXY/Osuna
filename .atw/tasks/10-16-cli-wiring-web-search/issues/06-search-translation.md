# 06 — 搜索在 Anthropic 与 Responses 两种格式之间互译

**What to build:** 打开了「自己能联网搜索」的接口只有一种地址时，另一个 CLI 的搜索也能交给它：

- **Claude Code → 只有 Responses 地址的接口**：照 magpie 把搜索子请求里的 `web_search_20250305` 写成 Responses 的原生 `web_search`；回复里的搜索写回 Claude Code 认得的 `server_tool_use` 与 `web_search_tool_result`，结果项要有 title、url。做完后，04 号工单里「同一模型下打开了开关的接口」也包括只有 Responses 地址的。
- **Codex → 只有 Anthropic 地址的接口**：把 `web_search` 写成 `web_search_20250305`；回复里的搜索写回 Codex 的 `web_search_call`。做完后，05 号工单里这类接口不再拿掉搜索工具。
- 流式与整份两种回复都处理。

**Blocked by:** 05
**Status:** ready-for-agent
**Impl:** done

- [ ] 端到端：只有 Responses 地址、开了开关的假上游收到原生 `web_search`；Claude Code 收到的回复里有 `server_tool_use` 与带 title、url 的 `web_search_tool_result`，流式与整份各一例。
- [ ] 端到端：只有 Anthropic 地址、开了开关的假上游收到 `web_search_20250305`；Codex 收到的回复里有 `web_search_call`，流式与整份各一例。
- [ ] 翻译的纯逻辑用例覆盖两个方向的请求与回复。
- [ ] 改写规则对照 magpie，结论写进实现记录；借鉴 magpie 的代码，文件头保留 MIT 声明。
- [ ] `npm run typecheck`、`npm run lint` 通过，改到的测试文件本机通过。

参考：prd.md 第 9、10 条；research/web-search.md 第 5 题（「重建时先找这家会搜的那个协议」）、第 10 题。
