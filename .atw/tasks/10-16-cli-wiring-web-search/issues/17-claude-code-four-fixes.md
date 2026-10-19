# 17 — Claude Code 的四个修正

**What to build:** 照 magpie 修四处，开关开着时生效：

1. **带点的 Claude 版本**：写进 `model`、`modelPicker` 时，只有连字符写法能唯一对上一个在售 Claude id 才改写（`claude-opus-4.6` → `claude-opus-4-6`），免得 Claude Code 把它错认成老模型；别家的 id、用户自己的值不动。后台小任务模型与 Subagent 模型用同一规则，由 22 号工单接上。中转站按每家自己的写法发出（子任务 1 已有）。
2. **自动模式审查**：经中转站能到的模型都不会被 Anthropic 审查时，在 `env` 写 `CLAUDE_CODE_AUTO_MODE_SERVER=0`。「会被审查」指名字是 Claude 的模型，或地址是 `api.anthropic.com` 的接口。每次重写都重算；用户自己的值不动；关掉时拿掉。
3. **Ultra Code**：推理档位能到 max 却没有 xhigh 的模型，能力提示里也报 xhigh，好让 Claude Code 允许 Ultra Code；中转站按模型自己的档位发出（现有规则）。名字是 Claude 的模型不变。
4. **档位名兜底**：请求的是 Claude 档位名（opus、sonnet、haiku、fable，或 Claude Code 内置的档位 id），没有开着的接口为这个档位配映射时，改用 Claude Code 的默认模型，不再回 404。

**Blocked by:** 01
**Status:** ready-for-agent
**Impl:** done

- [x] 端到端：默认模型 `claude-opus-4.6`（某家这样列）写进 `settings.json` 的是连字符写法；别家的 `glm-4.6` 不改；用户自己写的值不改。
- [x] 条件成立时有 `CLAUDE_CODE_AUTO_MODE_SERVER=0`；加一家 `api.anthropic.com` 的接口后，重写时被拿掉；用户自己写了这个变量时不动；关掉开关后没有 Osuna 写的这一项。
- [x] 能到 max、没有 xhigh 的模型在能力提示里带 xhigh；Claude 模型不变。
- [x] 请求 `haiku` 而没有映射时，假上游收到默认模型的名字，CLI 不再收到 404。
- [x] 借鉴 magpie 的代码，文件头保留 MIT 声明。
- [x] `npm run typecheck`、`npm run lint` 通过，改到的测试文件本机通过。

参考：prd.md 第 26 条；research/claude-code-wiring.md 第 2b、5、6、7 题；decisions.md Q16。
