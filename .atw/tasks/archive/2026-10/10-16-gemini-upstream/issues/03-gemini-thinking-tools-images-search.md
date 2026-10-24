# 03 — 思考、工具、图片、联网搜索

**What to build:** 用 Gemini 地址时，Gemini 模型的思考过程照常显示，CLI 里调的思考档位生效；多轮工具调用不会因为缺思考签名被 Gemini 拒绝；工具调用（含并行）、工具结果、图片来回翻译正确；续聊、中断后重试的对话历史被修补成 Gemini 能收的样子；「这家自己会联网搜索」对 Gemini 地址生效。代码里「非 Anthropic 即 OpenAI」的判断逐个审过，Gemini 落在正确的一边。

**Blocked by:** 02
**Status:** ready-for-agent
**Impl:** done

- [x] 思考（照 magpie）：能思考时 `includeThoughts: true`，没要求思考不发；按模型名读代数，3 代起（含 `gemini-pro-agent*`）发 `thinkingLevel`，其余发 `thinkingBudget`（含 magpie 的薄弱：看不出代数的发 budget）；档位映射、思考关闭发 low / 4096 照 magpie；档位先按模型自己的档位表收敛。上游 `thought: true` 的部分作为思考流回 CLI。
- [x] 签名：共用已有的 Gemini 签名存放（存盘、id 里只放短 key、写不进时退回放进 id、截断识别）；IR 的思考内容不回传；只回传文本与调用上的 `thoughtSignature`；一条消息有调用带签名时未签名的调用不带，整条都没签名时每个调用填 `skip_thought_signature_validator`。
- [x] 工具：`parametersJsonSchema` 原样发，没有 schema 补空对象；`toolConfig` 的 mode 与 `allowedFunctionNames` 照 magpie；`tool_choice=none` 不发工具；上游没给调用 id 时补 `call_<随机>`，IR 有 id 就在 functionCall 与 functionResponse 两边都带；functionResponse 写 `response: {output|error}`；去 `default_api:` 前缀；正文里写成 `call:default_api:x{…}` 的解析回调用；发过调用且 STOP 时结束原因改 tool。
- [x] 轮次修补（照 magpie）：带 functionResponse 的 user 轮次里用户文字拆成单独一轮；没被回答的调用补合成结果；同一调用回答两次只留第一次；历史以 model 开头时前插提示，以 model 结尾时补一条 user。
- [x] 图片：有内容发 `inlineData`，只有网址发 `fileData`（照搬 magpie 的薄弱，不下载）；工具结果里的图片紧跟在对应 functionResponse 后；上游返回的 `inlineData` 照 magpie 算模型回答了（不当空回复），不写给 CLI（三种 Agent 的格式都装不下，magpie 的编码器同样不写；用户 2026-10-24 选定）；画图模型加 `responseModalities`。
- [x] 联网搜索：「这家自己会联网搜索」的能搜格式加上 Gemini；请求里只有联网搜索、没有别的工具时发 `googleSearch`。
- [x] 最后一家时思考随来随发、不暂扣（Osuna 开口前不扣思考，思考一到就开口，本来成立）。「思考后空回复多重试一次」挪到 04：Osuna 开口后还没有空回复重问，那是 04 要建的（04 已加这一条）。
- [x] 审查所有「非 Anthropic 即 OpenAI」的二分判断（被拒降档、被拒字段、关思考、拒答、续写、回复计时、Grok、厂商改写、模板改写、断流、缓存键、直通、中转站主文件等），逐个照 magpie 定 Gemini 落在哪边；被拒降档重试、关思考改写不对原生 Gemini 做。magpie 也没答案的停下来问用户。审查结论记进本工单的 Comments。
- [x] 测试：daemon 端到端加用例覆盖思考（2 代 budget、3 代与 4 代 level、关闭）、多轮工具调用的签名经存盘带回、无 id 调用、并行调用、未回答与重复回答、以 model 开头或结尾的历史、图片（内容与网址）、联网搜索发 `googleSearch`；翻译套件与 Gemini 签名套件加用例，逐条覆盖 `research/decisions.md`「翻译细节」里的规则。
- [x] 文档：ADR 0009 加修改说明（Gemini 算能搜的格式）；`docs/glossary.md` 核对 Searches the web by itself 条目；`THIRD_PARTY_NOTICES` 补上本工单新借鉴的 magpie 文件。

参考：prd「翻译层」「选路」，用户故事 25–32、37；`research/decisions.md`「翻译细节」。

实现时凡本工单没写明的细节，先查 magpie 最新 main 的做法并照做（源码要重新克隆 yetone/magpie 到 `/tmp` 下只读查看）；比 magpie 少做或更严一律不行，除非 prd 写明。测试绝不连真实中转服务或 Google。

## Comments

- 2026-10-24 实现：Gemini 构建与解码照 magpie `buildCodeAssistSent` 的非 Antigravity 分支与 `codeAssistDecoder`（`translation/gemini.ts`）。调用的签名在解码时藏进交给 Agent 的调用 id（`signedId`，存盘只带短 key），每次问一家之前在中间格式上取下（`unsignCalls`，三种 Agent 都做，原来只给 Chat 在文字层取下、签名丢掉）；Chat 客户端放在 `extra_content` 里的签名也读。文字上的签名不交给 Agent（magpie 的三种编码器同样不写），效果一致。
- 以 model 结尾补 user 轮：压缩对话时请它写总结，照 magpie `compacting` + `modelLastAsk`（新文件 `translation/compacting.ts`），其余补 `Continue.`。
- 二分判断审查结论（照 magpie 定）：
  - 改了：`refused-downgrades.ts` 认出 Gemini 的结构化输出被拒（读 `generationConfig`，magpie `format.go` 不分格式）；`reply-clock.ts` Gemini 的推理算摘要、不计可见推理起点（magpie `ttft.go`）；`web-search.ts` Gemini 算能搜的格式（magpie `search.go`，ADR 0009 加注、接口页对只有 Gemini 地址的接口也显示开关、9 种语言的提示加上 Google）；`refused-fields.ts` Gemini 的 functionDeclarations 也做根联合包装（magpie `objectRootsReq`，用户选定）。
  - 不用改：`refusals.ts` 与 `translated.ts` 的关思考（Gemini 请求体没有 `reasoning.effort`，记不下 none，不做关思考改写，合 A4）；`continuation.ts` Gemini 不续写（magpie `prefillHow` 同）；`broken-reply.ts` 没有结束原因算没说完（magpie `replyEnds`）；`upstream-call.ts` 不按用量判空回复（magpie 同）；`safety-filter.ts` 拒答说法按 Agent 格式写，没有 Gemini 专属的；`vendor-rewrites.ts`、`template-rewrites.ts` 不碰 Gemini（magpie 也不改 Gemini 的工具 schema）；`grok-integral.ts`、`passthrough.ts`、`no-thinking.ts` 的分支只在直通时走到，Gemini 永远经翻译。
  - `translated.ts` 的 `sendsCacheKey`：Gemini 落在「带 cacheKey」一边，没说原因的 400 会白重问一次同样的请求；magpie 也这样，用户选定照 magpie 不改。
  - magpie 也没答案的：无。
- 审查后留着的判断项（未改）：`signatures` 从 `attemptTranslated` 一路传到 `decoder()`；Gemini 的 part 用 `Record<string, unknown>`，没写成判别联合；正文里写成调用的解析（`textCall` 一组）留在 `gemini.ts`，没拆文件。

