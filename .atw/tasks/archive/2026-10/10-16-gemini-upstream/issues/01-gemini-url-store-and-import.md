# 01 — 能存、能填、能导入 Gemini 地址

**What to build:** 第三方接口多一种请求格式 Gemini，一家最多四个地址。用户能在添加窗口和接口页填 Gemini 地址（只填它也能保存），地址按 magpie 的写法自动规范化；模板清单多一个 Google Gemini；导入 CC Switch、Alma、导入链接时收下 Gemini 地址，「还不支持 Gemini」的提示不再出现。新客户端只在 daemon 声明支持时显示这些。本工单不让中转站真的用 Gemini 地址对话（02 做），但中转站遇到带 Gemini 地址的接口不能出错。

**Blocked by:** None — can start immediately
**Status:** ready-for-agent
**Impl:** done

- [x] 请求格式新增 `gemini`（枚举最后）；存储、保存 RPC、接口详情都能带 Gemini 地址；每种格式最多一个、至少一个。按格式穷举的地方都补上 Gemini（翻译与发出相关的留给 02，但要能编译、不出错）。
- [x] `server_info.features.apiEndpointGemini`：daemon 发出；新客户端没看到它时不显示 Gemini 地址框、Gemini 格式选项与相关文案。
- [x] 保存时规范化 Gemini 地址（照 magpie `GeminiBase`）：去空白与末尾 `/`、没协议补 `https://`、粘贴的方法地址剪回 base、只有裸主机补 `/v1beta`。客户端把已填地址切到 Gemini 时照 magpie `respellURL`（`/v1` → `/v1beta`，裸主机补 `/v1beta`）。
- [x] Key header 选项不作用于 Gemini 地址；认证头取值多一种 Gemini 的 `x-goog-api-key`（02 用它发请求）。
- [x] Google Gemini 模板照 magpie，只填 Chat 兼容地址 `…/v1beta/openai`；模板文件顶上的「等子任务 7」注释随之改掉。
- [x] 导入照 magpie 最新（7ea0e047、319b86fe）：CC Switch 的 Gemini 条目收下并给 `GOOGLE_GEMINI_BASE_URL` 补 `/v1beta`；Alma 的 Gemini 服务商收下；导入链接的 `gemini=` 收下，只有 Gemini 地址的链接也收；判断同一家时 Gemini 地址的主机也算；OpenCode 的 `google` 按 magpie 最新处理（先查源码）。
- [x] daemon 不再发 `gemini_unsupported`、`gemini_only`、`ignoredGemini`；协议里保留这几个取值并标 `COMPAT(...)`；客户端删掉对应文案与提示。
- [x] 中转站：带 Gemini 地址的接口在 02 之前不会把请求发到 Gemini 地址，也不会因为多了一种格式报错（有别的格式就照常用别的）。
- [x] 核实（G16）：没有 Gemini 的旧版 Osuna 客户端打开带 Gemini 地址的接口再保存，Gemini 地址会不会丢；结果记进本工单的 Comments，后面写进 PR 说明。不加防护代码。
- [x] 9 种语言：格式名「Gemini」、「Gemini 地址」标签、占位符、框下说明（key 放在 `x-goog-api-key`）；写着「三种格式」的句子改对；中文是真翻译。
- [x] 测试：daemon 端到端（保存、规范化、详情、导入 CC Switch / Alma / 导入链接、同一家不重复导入）；导入与地址规范化的纯逻辑套件加用例；app 浏览器测试（只填 Gemini 地址添加、切格式改写地址、模板、导入确认框，各测成功与失败）。
- [x] 文档：`docs/data-model.md` 的 `endpoints.json` 一行写明 `format` 可为 `gemini` 和装回旧版读不了的风险（G10）；ADR 0013 加修改说明（导入不再忽略 Gemini 地址）；`docs/glossary.md` 核对 Key header 等写死三种格式的条目。
- [x] UI：添加窗口 / 空表单与填好 Gemini 地址 / 1280 与 390 — 四个地址框，第四个中文标为 Gemini 地址，占位符以 `/v1beta` 结尾，保存按钮不被遮住。
- [x] UI：接口页 / 只有 Gemini 地址的接口 / 1280 — 显示这个地址。
- [x] UI：模板清单 / 1280 — 能找到 Google Gemini。
- [x] UI：导入确认框与导入链接确认框 / 带 Gemini 地址 / 1280 与 390 — 列出 Gemini 地址，没有「还不支持 Gemini」字样。
- [x] UI：英文界面没有露出的翻译键名；中文界面除格式名 Gemini 外没有残留英文。

参考：prd「格式与存储」「导入」「协议与兼容」，用户故事 1–9、46–54。

实现时凡本工单没写明的细节，先查 magpie 最新 main 的做法并照做（出处见 `research/decisions.md`，源码要重新克隆 yetone/magpie 到 `/tmp` 下只读查看）；比 magpie 少做或更严一律不行，除非 prd 写明。测试绝不连真实中转服务或 Google，不读写真实的 CC Switch、Alma 配置。

## Comments

- **G16 核实（2026-10-24，读代码）**：没有 Gemini 的旧版 Osuna 客户端打开带 Gemini 地址的接口再保存，**Gemini 地址会丢**。旧客户端的添加窗口只按它认得的三种格式建地址框（`connection-form-model.ts` 的 `urlsOf` 跳过不认识的格式），保存时只发这三种；daemon 的 `validateFields` 按请求整份替换 `baseUrls`。按 G16 不加防护，写进 PR 说明。官方 Paseo App 与更老的客户端走单接口投影的旧保存（`validateLegacyFields`），会保留别的格式的地址，Gemini 地址不丢。
- **ignoredGemini**：预览里它是必填字段，老客户端少了它会解析失败，所以 daemon 改成恒发 `false`（标 COMPAT），不是不发；`gemini_unsupported`、`gemini_only` 不再发，取值留在协议里。新客户端连老 daemon 时收到这两个值按「未知原因」说，不另留文案。
- **切格式改写地址**：Osuna 的添加窗口是四个独立的地址框，没有 magpie 那种「切换格式时把已填地址带过去」的动作，所以这一条只在 `respellUrl` 里补上 Gemini 写法（单元测试覆盖），浏览器测试里没有对应操作可测。自动识别时 `/v1` → `/v1beta` 的建议地址属于工单 05。
- **01 里的临时边界**：中转站选格式时 Gemini 不在翻译顺序里（只有 Gemini 地址的接口暂时挑不出格式、照常换下一家），`protocolOf` / `upstreamUrl` 对 Gemini 抛错（走不到）；探测、测试连接、测试模型只问三种格式（`PROBED_FORMATS`），Gemini 地址的测试连接回「暂不支持」。02、05 会去掉这些。自动识别说明里「三种请求格式各试一次」在 05 加 Gemini 探测时一起改。
- 模型「只用这种格式 = Gemini」时，Pi 仍按 Chat 问中转站（magpie `Native` 不含 Gemini）。
