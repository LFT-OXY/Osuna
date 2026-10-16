# 16 — 四家厂商改写

**What to build:** 只做四家，触发条件照 magpie：

- **Kimi**（接口地址是 Kimi 或 Moonshot 的官方地址）：消息里的 `reasoning_details` 改成 `reasoning_content`；工具 schema 里有 enum 或 const 却没写 type 的，补上 type。
- **MiniMax**（官方地址）：Chat 历史里的思考，写回 `<think>`。
- **DeepSeek**（官方地址）：工具 schema 里的 `\0` 改成 `\u0000`。
- **Grok**（按模型名认，不论谁提供）：回复里工具参数的 `2500.0` 改回 `2500`；工具 schema 里的正则改成 Grok 认得的写法。
- **Kimi、DeepSeek** 不发延后加载工具块，沿用第 04 张「去掉」的做法。

经中转服务用 Kimi、MiniMax、DeepSeek 的模型时，不做这些改写。Osuna 没有预设，只按地址认。

**Blocked by:** 04
**Status:** ready-for-agent
**Impl:** ready

- [ ] 在直通和翻译套件里，把接口地址设成官方域名，各家的改写都生效；同一请求发到中转服务的地址时，请求体不变。
- [ ] Grok 经任意地址：CLI 收到的工具参数是整数；工具 schema 的正则按 magpie 改写。
- [ ] 没有别的按厂商改写：用一份不属于这四家的夹具，断言请求体不变。
- [ ] 借鉴 magpie 的代码，文件头保留 MIT 声明。
- [ ] `npm run typecheck`、`npm run lint` 通过，改到的测试文件本机通过。

参考：prd.md 第 25 条；明细 01·B22、B47、B51。
