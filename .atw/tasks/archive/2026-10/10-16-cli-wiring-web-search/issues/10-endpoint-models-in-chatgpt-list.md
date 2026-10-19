# 10 — 接口模型并进 ChatGPT 登录的 /model

**What to build:** 用 ChatGPT 登录、打开了开关的 Codex，`/model` 里 ChatGPT 自带模型和第三方接口的模型都在，在一个列表里随时换；用户的 ChatGPT 令牌从不发给任何第三方接口。

- **模型清单**：中转站把 Codex 的清单请求原样转给 ChatGPT（等 3 秒），拿不到就用上次的结果；ChatGPT 的 401、403 原样回给 Codex。后面接上开着的接口的已选模型，写成「接口标识/模型名」，带 07 号工单的真实能力，按 Codex 的格式返回。
- **对话请求**：模型名带接口标识的，按现有规则选接口、自动切换。转给接口时，用户的 ChatGPT 令牌、账号 id 一律不带，只带 Codex 表明身份的那些头（User-Agent、originator、会话与线程 id、magpie 转发的那些 `x-codex-*`）。不带标识的名字一律指 ChatGPT 自带的模型，照旧原样转给 ChatGPT（08 号工单）。
- **`/responses/compact`**：接口模型照 magpie 拒绝。
- **`/alpha/search`**（Codex 的独立搜索）：接口模型回 200，`output` 是一句「这个模型不能联网搜索」的说明；不回 404，404 会让 Codex 结束这一轮。
- **模型缓存**：打开开关、默认模型或接口的已选模型变了时，照 magpie 把 Codex 的模型缓存标成过期，让它尽快重新拉清单。
- API key 登录或未登录时，清单与现在一样。

**Blocked by:** 07, 09
**Status:** ready-for-agent
**Impl:** done

- [x] 端到端：模型清单里 ChatGPT 自带模型在前，接口模型以「接口标识/模型名」在后，带真实上下文与档位；假 ChatGPT 后端不应答时，3 秒内用上次结果；401、403 原样回。
- [x] 端到端：选接口模型的对话请求到达那家假上游，请求里没有 ChatGPT 令牌和账号 id，有 Codex 的身份头；那家失败时照常换同名的另一家。
- [x] `/responses/compact` 对接口模型按 magpie 拒绝；`/alpha/search` 对接口模型回 200 和说明，对 ChatGPT 自带模型照旧转给 ChatGPT。
- [x] 打开开关后 Codex 的模型缓存被标成过期（照 magpie 的写法），有用例。
- [x] 借鉴 magpie 的代码，文件头保留 MIT 声明。
- [x] `npm run typecheck`、`npm run lint` 通过，改到的测试文件本机通过。

参考：prd.md 第 10、13、14、16 条；research/codex-wiring.md 第 5、8 题；research/web-search.md 第 6 题（`/alpha/search`）；decisions.md Q9、Q25。
