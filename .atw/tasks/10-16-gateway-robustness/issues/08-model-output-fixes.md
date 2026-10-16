# 08 — 改模型输出

**What to build:** 有两项会改模型回给 CLI 的内容，触发条件照 magpie，其余回复一个字都不改：

- CLI 要的是 JSON（结构化输出或 `json_object`），模型却用 ``` 把它包住时，剥掉代码块。流式和整份回复都处理。
- 翻译 Chat 上游的回复时，把 Hermes `<tool_call>`、DeepSeek DSML、GLM `arg_key` 这三种写成文字的工具调用，转成真正的工具调用。

**Blocked by:** None
**Status:** ready-for-agent
**Impl:** ready

- [ ] 流式和整份各一例：CLI 收到的 JSON 外面没有 ```。
- [ ] 没要求 JSON 的回复，里面的 ``` 原样保留。
- [ ] 三种文字写法各一例：CLI 收到真正的工具调用事件，参数正确。
- [ ] 请求里没给工具时，同样的文字原样保留。
- [ ] 测试夹具照搬 magpie。
- [ ] 借鉴 magpie 的代码，文件头保留 MIT 声明。
- [ ] `npm run typecheck`、`npm run lint` 通过，改到的测试文件本机通过。

参考：prd.md 第 23、24 条；明细 01·B32、B52。
