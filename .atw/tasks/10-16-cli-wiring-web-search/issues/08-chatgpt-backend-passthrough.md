# 08 — 中转站接住 Codex 发给 ChatGPT 的请求，原样转发

**What to build:** 中转站在现有入口下新增 ChatGPT 后端那组路径。Codex 的 `openai_base_url` 指到这里（以 `/backend-api/codex` 结尾）时，它发给 ChatGPT 的请求先到中转站，再原样转给 ChatGPT。本张只建这条通道：Codex 怎么接上归 09 号工单，接口模型归 10 号工单。

- 对话请求、`/responses/compact`、模型清单、`/alpha/search` 和其余路径：原样转给 `https://chatgpt.com/backend-api/codex` 加原路径与查询串；除逐跳头、`Host` 外的请求头全部原样带上（含用户的 ChatGPT 令牌与账号 id），回复原样回给 Codex，流式照样逐段转。
- WebSocket 握手回 426，让 Codex 立刻改用 HTTP。
- 请求体原样转，不解压也不改（zstd 子任务 1 已能解，这里用不上）。
- 这些请求按路径认作 Codex（02 号工单的规则）。
- 测试里 ChatGPT 的地址换成本机假 ChatGPT 后端。
- 身份如实：转给 ChatGPT 的请求不加 Osuna 自己的任何头。
- 实现时对照 magpie 定：带 API key（`Bearer sk-`）的请求要不要照 magpie 转给 OpenAI API（用户在开关开着时从 ChatGPT 登录换成 API key 登录、Osuna 还没重写配置的空档里会出现）。结论写进实现记录。

**Blocked by:** 02
**Status:** ready-for-agent
**Impl:** ready

- [ ] 端到端：假 ChatGPT 后端收到的对话请求，路径、查询串、请求头（除逐跳头、`Host`）与请求体都与「Codex」发出的一致；回复（含流式）原样回到「Codex」。
- [ ] 模型清单、`/responses/compact`、`/alpha/search` 与一条其他路径同样原样转。
- [ ] WebSocket 握手得到 426。
- [ ] ChatGPT 回的 401、403 原样回给 Codex。
- [ ] 借鉴 magpie 的代码，文件头保留 MIT 声明。
- [ ] `npm run typecheck`、`npm run lint` 通过，改到的测试文件本机通过。

参考：prd.md 第 5、14 条；research/codex-wiring.md 第 3、8 题；decisions.md Q9。
