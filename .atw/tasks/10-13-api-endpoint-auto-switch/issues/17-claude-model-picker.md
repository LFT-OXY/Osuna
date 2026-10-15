# 17 — 终端 Claude Code 的 /model 列出接口模型

**What to build:** 14 票真实验收时发现：终端里 Claude Code 的 `/model` 只列出官方的 Default / Opus / Fable / Sonnet / Haiku，接口模型一个都没有。网关自动发现（`CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1`）只收名字里带 `claude` 或 `anthropic` 的模型（code.claude.com/docs/en/llm-gateway-protocol.md 的「Model discovery」一节），GPT 这类进不了列表，所以不用它。改用 `settings.json` 顶层的 `modelPicker`：Claude Code v2.1.242 起支持，只从用户设置、`--settings` 和托管设置里读（settings.md 的「Lists merge instead of overriding」一节）；2.1.299 二进制里的校验文案写的格式是 `{ options: [{ model, label?, description?, behavesAs? }] }`。照 magpie 的做法实现（`internal/agent/claude.go` 的 `writePicker`，约 705–770 行；用户决定，2026-10-15）：

- Claude Code 总开关打开时写 `modelPicker.options`：每家开着的接口的每个已选模型一行。`model` 为 `标识/模型名`（直达该家），`label` 为模型名，`description` 为接口名，顺序与聊天模型选择器一致（按接口创建顺序）。不加 `replace`，官方自带的行保留；不写 `behavesAs`（magpie 也不写）。
- 接口、已选模型、接口开关变化时重写（与 Codex 目录同一时机）；关总开关时删掉自己写的那份。
- 接管时 `settings.json` 里已经有用户自己的 `modelPicker`：完全不碰，接口模型也就不进列表（magpie：「One the user wrote is theirs」）。接管记录里标明这份 `modelPicker` 是不是 Osuna 写的；不是 Osuna 写的，关总开关时也不删。
- 上下文 100 万标记、回复长度上限、思考档位声明归 18 票。

对应 prd R-B3。

**Blocked by:** None
**Status:** ready-for-agent
**Impl:** done

- [x] 总开关打开后，`settings.json` 多出 `modelPicker`，每一行与开着的接口的已选模型一一对应（`标识/模型名`、模型名、接口名）；文件其它内容一字不差。（e2e，沿用 claude 那条「手写配置不丢」断言）
- [x] 改已选模型、关掉某家接口后，`modelPicker` 跟着更新；关总开关后这个键被删掉，`settings.json` 回到接管前的原样。（e2e）
- [x] 用户原本就有 `modelPicker`：接管期间和关总开关后都原样不动。（e2e）
- [x] 真实 CLI 由用户在 14 票复验：终端 `/model` 里能看到并选中某家的 GPT 类模型，并能正常回复。

## Comments

- 2026-10-15 初版写的是「用户的 `modelPicker` 先存原样、接管时替换、关掉时还原」。看过 magpie 的做法后，用户改成完全不碰。
- 2026-10-15 实现补充：`label` 取模型的显示名（没起名时就是模型名），与聊天模型选择器一致；总开关已经开着的用户升级后，daemon 启动时补写一次 `modelPicker`（旧接管记录里没有这一项）；Osuna 写过之后被用户手改的那份仍算 Osuna 的，下次重写会盖掉（magpie 同样）。
- 2026-10-15 用户在 dev 桌面端（临时 CLAUDE_CONFIG_DIR）实测：打开总开关后 `/model` 选中 chinhae 的 `gpt-6.1-sol` 正常回复；关总开关后 settings.json 与接管前原件逐字节一致。
