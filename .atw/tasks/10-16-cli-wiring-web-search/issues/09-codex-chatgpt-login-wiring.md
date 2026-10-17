# 09 — 用 ChatGPT 登录的 Codex：打开开关时只改 ChatGPT 地址

**What to build:** 用 ChatGPT 登录的 Codex 打开「使用第三方接口」后，仍用自己的 OpenAI 服务商和登录，开关前后的对话是同一组、都能续；API key 登录或未登录的照旧。

- **判断登录方式**：Osuna 不读 `auth.json`、钥匙串。起一个临时的 Codex app-server（覆盖成内置 openai 服务商）调 `account/read`，经可替换的「登录方式」适配器，测试里返回 ChatGPT、API key、未登录三种。打开开关时、daemon 启动时、读状态时各判断一次。
- **ChatGPT 登录**：
  - 写顶层 `openai_base_url`，指向中转站的 ChatGPT 后端地址（以 `/backend-api/codex` 结尾，Codex 才继续把它当 ChatGPT 后端）。
  - 拿掉 Osuna 写过的顶层 `model_provider`、`model_catalog_json`。
  - 顶层 `model` 写默认模型；打开时默认模型保持 Codex 自己上次选的（magpie 的 `joined`），接口模型由 10 号工单并进 `/model`。
  - 同时照旧写 Osuna 自己的 Codex 服务商表，给记在它名下的对话用；关掉时表保留（02 号工单）。
  - 用户自己写的 `openai_base_url` 怎么处理，对照 magpie 定，按 ADR 0004 记原值、关掉时还原。
- **API key 登录或未登录**：与现在一样，写 Osuna 的服务商表、顶层 `model_provider` 与 `model_catalog_json`。
- **登录方式变了**（用户登录或登出 ChatGPT）：下次判断时按新方式重写，旧方式写的键按接管记录还原。
- `openai_base_url` 被别的程序改了，算 03 号工单的「不再经过中转站」。
- **先核实一个推断**（读 Codex 源码，不运行）：`openai_base_url` 指向本机、以 `/backend-api/codex` 结尾时，ChatGPT 工作区路由会不会把请求改到 ChatGPT 自己的后端、绕过中转站。会的话，把事实和可选的处理办法写进实现记录，交用户决定。

**Blocked by:** 03, 08
**Status:** ready-for-agent
**Impl:** ready

- [ ] 端到端（假适配器返回 ChatGPT）：打开开关后 `config.toml` 只多 `openai_base_url`（指向中转站的 ChatGPT 后端地址）、`model` 与 Osuna 的 Codex 服务商表，没有 Osuna 写的 `model_provider`、`model_catalog_json`；关掉后按原样还原，服务商表保留。
- [ ] 端到端（API key、未登录）：与现在写的一样。
- [ ] 登录方式由 ChatGPT 变成 API key（或反过来）后，读状态时按新方式重写，旧方式写的键已还原。
- [ ] 用户自己写了 `openai_base_url` 时的处理有用例，做法写进实现记录。
- [ ] 外部改掉 `openai_base_url` 后，提示「不再经过中转站」。
- [ ] 判断登录方式不读 `auth.json`、钥匙串；测试不在本机跑真的 Codex 登录。
- [ ] 工作区路由那个推断有结论，写进实现记录。
- [ ] 借鉴 magpie 的代码，文件头保留 MIT 声明。
- [ ] `npm run typecheck`、`npm run lint` 通过，改到的测试文件本机通过。

参考：prd.md 第 6、12、13、28 条；research/codex-wiring.md 第 3、7、13 题；decisions.md Q9。
