# 17 — 终端 Claude Code 的 /model 列出接口模型

**What to build:** 工单 14 真实验收发现：终端 Claude Code 的 `/model` 只有官方的 Default / Opus / Fable / Sonnet / Haiku，看不到接口模型。网关自动发现（`CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1`）只收名字里带 `claude` 或 `anthropic` 的模型（code.claude.com/docs/en/llm-gateway-protocol.md「Model discovery」），GPT 这类进不了列表，所以不用它。改用 `settings.json` 顶层 `modelPicker`（Claude Code v2.1.242 起支持，只从用户 / `--settings` / 托管设置读；settings.md「Lists merge instead of overriding」；2.1.299 二进制校验文案为 `{ options: [{ model, label?, description?, behavesAs? }] }`）。magpie 同样这么做（`internal/agent/claude.go` `writePicker`）。

Claude Code 总开关打开时写 `modelPicker.options`：每家开着的接口的每个已选模型一行，`model` 为 `标识/模型名`（直达该家），`label` 为模型名，`description` 为接口名，顺序同聊天模型选择器（按接口创建顺序分组）。接口、已选模型、接口开关、总开关任一变化时重写（与 Codex 目录同一时机）；关总开关时删掉。用户原有的 `modelPicker` 按 ADR 0004 记录、接管期间替换、切回官方时原样还原。不加 `replace`，官方行保留（magpie 也不加）。实现时核实：非 Claude 名字的行是否需要 `behavesAs` 才能选中且不报警告；需要的话取什么值。对应 prd R-B3。

**Blocked by:** None
**Status:** ready-for-agent
**Impl:** ready

- [ ] 总开关打开后 `settings.json` 多出 `modelPicker`，行与开着的接口的已选模型一一对应（`标识/模型名`、模型名、接口名）；其它内容一字不差。（e2e，沿用 claude 手写配置不丢断言）
- [ ] 改已选模型、关掉某家接口后 `modelPicker` 随之更新；关总开关后键被删，`settings.json` 回到接管前原样。（e2e）
- [ ] 用户原有 `modelPicker`：接管时被记录并替换，切回官方后原样回来。（e2e）
- [ ] 真实 CLI 由用户在 14 票复验：终端 `/model` 能看到并选中某家的 GPT 类模型并正常回复。
