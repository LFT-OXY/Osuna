# 03 — 思考、工具、图片、联网搜索

**What to build:** 用 Gemini 地址时，Gemini 模型的思考过程照常显示，CLI 里调的思考档位生效；多轮工具调用不会因为缺思考签名被 Gemini 拒绝；工具调用（含并行）、工具结果、图片来回翻译正确；续聊、中断后重试的对话历史被修补成 Gemini 能收的样子；「这家自己会联网搜索」对 Gemini 地址生效。代码里「非 Anthropic 即 OpenAI」的判断逐个审过，Gemini 落在正确的一边。

**Blocked by:** 02
**Status:** ready-for-agent
**Impl:** ready

- [ ] 思考（照 magpie）：能思考时 `includeThoughts: true`，没要求思考不发；按模型名读代数，3 代起（含 `gemini-pro-agent*`）发 `thinkingLevel`，其余发 `thinkingBudget`（含 magpie 的薄弱：看不出代数的发 budget）；档位映射、思考关闭发 low / 4096 照 magpie；档位先按模型自己的档位表收敛。上游 `thought: true` 的部分作为思考流回 CLI。
- [ ] 签名：共用已有的 Gemini 签名存放（存盘、id 里只放短 key、写不进时退回放进 id、截断识别）；IR 的思考内容不回传；只回传文本与调用上的 `thoughtSignature`；一条消息有调用带签名时未签名的调用不带，整条都没签名时每个调用填 `skip_thought_signature_validator`。
- [ ] 工具：`parametersJsonSchema` 原样发，没有 schema 补空对象；`toolConfig` 的 mode 与 `allowedFunctionNames` 照 magpie；`tool_choice=none` 不发工具；上游没给调用 id 时补 `call_<随机>`，IR 有 id 就在 functionCall 与 functionResponse 两边都带；functionResponse 写 `response: {output|error}`；去 `default_api:` 前缀；正文里写成 `call:default_api:x{…}` 的解析回调用；发过调用且 STOP 时结束原因改 tool。
- [ ] 轮次修补（照 magpie）：带 functionResponse 的 user 轮次里用户文字拆成单独一轮；没被回答的调用补合成结果；同一调用回答两次只留第一次；历史以 model 开头时前插提示，以 model 结尾时补一条 user。
- [ ] 图片：有内容发 `inlineData`，只有网址发 `fileData`（照搬 magpie 的薄弱，不下载）；工具结果里的图片紧跟在对应 functionResponse 后；上游返回的 `inlineData` 作为图片回给 CLI；画图模型加 `responseModalities`。
- [ ] 联网搜索：「这家自己会联网搜索」的能搜格式加上 Gemini；请求里只有联网搜索、没有别的工具时发 `googleSearch`。
- [ ] 最后一家时思考随来随发、不暂扣；思考后空回复多重试一次（magpie 59289946）。
- [ ] 审查所有「非 Anthropic 即 OpenAI」的二分判断（被拒降档、被拒字段、关思考、拒答、续写、回复计时、Grok、厂商改写、模板改写、断流、缓存键、直通、中转站主文件等），逐个照 magpie 定 Gemini 落在哪边；被拒降档重试、关思考改写不对原生 Gemini 做。magpie 也没答案的停下来问用户。审查结论记进本工单的 Comments。
- [ ] 测试：daemon 端到端加用例覆盖思考（2 代 budget、3 代与 4 代 level、关闭）、多轮工具调用的签名经存盘带回、无 id 调用、并行调用、未回答与重复回答、以 model 开头或结尾的历史、图片（内容与网址）、联网搜索发 `googleSearch`；翻译套件与 Gemini 签名套件加用例，逐条覆盖 `research/decisions.md`「翻译细节」里的规则。
- [ ] 文档：ADR 0009 加修改说明（Gemini 算能搜的格式）；`docs/glossary.md` 核对 Searches the web by itself 条目；`THIRD_PARTY_NOTICES` 补上本工单新借鉴的 magpie 文件。

参考：prd「翻译层」「选路」，用户故事 25–32、37；`research/decisions.md`「翻译细节」。

实现时凡本工单没写明的细节，先查 magpie 最新 main 的做法并照做（源码要重新克隆 yetone/magpie 到 `/tmp` 下只读查看）；比 magpie 少做或更严一律不行，除非 prd 写明。测试绝不连真实中转服务或 Google。
