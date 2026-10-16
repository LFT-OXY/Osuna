# 06 — 直通的通用修补

**What to build:** 直通的请求体，除了模型名和认证，只多做下面这些修补。它们只看目标模型，不看是哪家，都照 magpie：

- **发给非 Claude 模型时**：去掉 Claude Code 的计费行（system 里的 `x-anthropic-billing-header` 块）和自动模式的审查字段。发给 Claude 模型时原样保留。
- **advisor 服务端工具**：在同一家的 Claude 上，改成上游的模型名；否则连同它的说明和 `tool_addition` 一起去掉。
- **4.6 起只认 adaptive 的 Claude**：客户端发来的 enabled 加预算改成 adaptive，xhigh 改成 max。
- **发往 Responses 上游之前**：去掉中转站翻译时自己造的推理项。
- **Responses 的工具往来**：补齐 magpie 的另外三处修补：
  - 从别的格式翻成 Responses 的请求也要修补；
  - 同一个调用的第二个答复去掉；
  - 一批调用中间夹着的模型文字，挪到第一个调用前面。
- **采样参数**：已知不收的模型不发 temperature、top_p；新版 Claude 去掉 temperature、top_p、top_k。

**Blocked by:** None
**Status:** ready-for-agent
**Impl:** ready

- [ ] 同一份 Claude Code 请求：发给非 Claude 模型时，没有计费行和审查字段；发给 Claude 模型时，除了模型名和认证，和原请求逐字节一致。
- [ ] advisor 的两种情况各有一例。
- [ ] 4.6 起的 Claude 直通时收到 adaptive；更早的 Claude 不变。
- [ ] 一段 Codex 对话先走翻译、再换到直通的 Responses 上游时，直通请求里没有中转站自己造的推理项。
- [ ] 三处 Responses 配对修补各有用例，夹具照搬 magpie。
- [ ] 除了上面这些和现有的修补，直通请求体逐字节不变，用一份夹具断言。
- [ ] 借鉴 magpie 的代码，文件头保留 MIT 声明。
- [ ] `npm run typecheck`、`npm run lint` 通过，改到的测试文件本机通过。

参考：prd.md 第 3、20 条；明细 01·B14、B19、B39、B42、B44、B45、B46。
