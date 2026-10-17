# 05 — Codex 的搜索工具按开关保留或拿掉

**What to build:** Codex 每一轮都带一个 `web_search` 工具。中转站发给某家接口时，这家打开了「自己能联网搜索」、而且有 Responses 地址（直通）的，原样带上；没打开的拿掉这个工具，点名它的 `tool_choice` 一并拿掉。这样不支持搜索的中转服务不会因为这个工具拒收整个请求。

- 自动切换换家时，每家按自己的情况决定带不带。
- 只有 Anthropic 地址、打开了开关的接口，本张先按没打开处理（拿掉）；06 号工单再改成翻译过去。
- 历史里的 `web_search_call` 项怎么处理，照 magpie 定，结论写进实现记录。发给 ChatGPT 后端时补工具的规则归 10 号工单。

**Blocked by:** 04
**Status:** ready-for-agent
**Impl:** ready

- [ ] 端到端：同一模型 A（开了开关、Responses 地址）、B（没开、Responses 地址）：发给 A 的请求带 `web_search`，发给 B 的不带，点名它的 `tool_choice` 也不在；A 失败换到 B 时，B 收到的请求同样不带。
- [ ] 用假上游模拟「带 `web_search` 就 400」：发给没开开关的这家时请求不再被拒。
- [ ] 历史里有 `web_search_call` 项的请求按 magpie 的做法处理，有用例。
- [ ] 借鉴 magpie 的代码，文件头保留 MIT 声明。
- [ ] `npm run typecheck`、`npm run lint` 通过，改到的测试文件本机通过。

参考：prd.md 第 10 条；research/web-search.md 第 6 题、「Codex 自身」、第 10 题；decisions.md Q20。
