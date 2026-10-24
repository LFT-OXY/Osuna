# 05 — 自动识别、测试连接、拉清单、逐个模型

**What to build:** 添加或编辑接口时，自动识别格式也试 Gemini，只有回复真的像 Gemini 的回复才算识别成功，key 错时显示「key 无效」；测试连接支持只有 Gemini 地址的接口；从 Gemini 地址能拉到完整的模型清单（翻页拉全、名字不带 `models/`、只留能对话的、带上下文与输出上限）；「逐个模型」的结果表多一列 Gemini。

**Blocked by:** 01
**Status:** ready-for-agent
**Impl:** ready

- [ ] 自动识别多一个 Gemini 探测：非流式 `POST {base}/models/{m}:generateContent`，带 `x-goog-api-key`，body 照 magpie；模型挑名字带 gemini 的，没有就用第一个；要求回复有 `candidates` 才算识别成功（G6，与另外三种同一判法）；建议地址按 01 的规范化规则（`/v1` → `/v1beta`）。
- [ ] key 错（含 Gemini 的 400 key 无效）时识别结果写 key 无效。
- [ ] 测试连接、测试模型支持 Gemini 地址；旧客户端走的按提供方测试连接不变。
- [ ] 拉清单：Gemini 地址 `GET {base}/models?pageSize=1000`，按 `nextPageToken` 翻页（最多 20 页、每页 8 秒），去 `models/` 前缀，有 `supportedGenerationMethods` 且不含 `generateContent` 的丢掉，`inputTokenLimit` / `outputTokenLimit` 进模型资料；和别的格式按 id 合并。认证只发 `x-goog-api-key`。
- [ ] 逐个模型：结果表多一列 Gemini；「采用这些」把只在 Gemini 下通的模型设成「只用这种格式 = Gemini」（同现有规则）。
- [ ] 9 种语言：识别结果、逐个模型表里新增的文字。
- [ ] 测试：往现有的识别、测试连接、模型清单、逐个模型的 daemon 端到端测试里加 Gemini 用例，假上游回 Gemini 探测回复、分页清单（含非对话模型）、回成功网页的「假 Gemini」、回 key 无效的 400；app 浏览器测试的假中转服务加 Gemini 的探测与清单路由，覆盖识别结果的 Gemini 行（成功与失败）与逐个模型的 Gemini 列。
- [ ] 文档：`docs/glossary.md` 核对 Each picked model、Use only this format 条目。
- [ ] UI：添加窗口 / 自动识别完成（Gemini 成功）与 key 错 / 1280 与 390 — 结果有 Gemini 一行，key 错时这一行写着 key 无效，失败信息留在原处。
- [ ] UI：逐个模型结果表 / 1280 与 390 — 有 Gemini 一列，宽 390 下能横向看全或换行，不被截掉。
- [ ] UI：模型清单 / Gemini 地址拉清单进行中、成功、失败、空清单 / 1280 — 四种状态都有对应显示，模型名不是等宽字体。

参考：prd「自动识别、测试连接、模型清单」，用户故事 10–19；`research/decisions.md`「模型清单」「探测」。

实现时凡本工单没写明的细节，先查 magpie 最新 main 的做法并照做（源码要重新克隆 yetone/magpie 到 `/tmp` 下只读查看）；比 magpie 少做或更严一律不行，除非 prd 写明（G6 是写明的更严）。测试绝不连真实中转服务或 Google。
