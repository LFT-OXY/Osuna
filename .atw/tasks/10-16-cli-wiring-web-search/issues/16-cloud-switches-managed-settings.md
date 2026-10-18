# 16 — 云平台开关与管理员设置

**What to build:** Claude Code 开着云平台开关（Bedrock、Vertex、Foundry 等），或管理员下发的设置写了自己的地址时，请求根本不经过中转站。做完后，Osuna 能改的地方替用户拿掉、关掉时放回；改不了的地方给提示，说明在哪、怎么改。

- **接管时**：拿掉 `settings.json` 的 `env` 里开着的 `CLAUDE_CODE_USE_BEDROCK`、`_VERTEX`、`_FOUNDRY`、`_ANTHROPIC_AWS`、`_ANTHROPIC_GOOGLE_CLOUD`、`_MANTLE`，原值记进接管记录；关掉时放回，用户之后又自己设了的除外。关着的开关和云平台的其他变量不动。
- **只提示**：写在管理员设置（macOS `/Library/Application Support/ClaudeCode`、Linux `/etc/claude-code`、Windows `C:\Program Files\ClaudeCode`，含 `managed-settings.d/`）、`~/.claude.json` 的 `env`、登录 shell 环境里的云平台开关。
- 管理员设置的 `env.ANTHROPIC_BASE_URL` 不指向中转站时，算「不再经过中转站」并说明原因。
- 读管理员设置、`~/.claude.json`、登录 shell 环境都经可替换的入口，测试用临时目录与假环境。

**Blocked by:** 03
**Status:** ready-for-agent
**Impl:** done

- [ ] 端到端：`settings.json` 里开着 `CLAUDE_CODE_USE_BEDROCK=1`、关着 `CLAUDE_CODE_USE_VERTEX=0`：打开开关后前者被拿掉、后者不动；关掉后前者放回；中间用户自己又写了前者的，关掉时不覆盖。
- [ ] 管理员设置、`~/.claude.json`、登录 shell 里有云平台开关时，各有一条提示，写明来源。
- [ ] 管理员设置的地址不指向中转站时，提示「不再经过中转站」。
- [ ] 测试不读真实的管理员设置目录与 `~/.claude.json`。
- [ ] UI: Claude Code 设置页 / 云平台开关写在管理员设置里 / 桌面 1280 — 提示写明来源与改法。
- [ ] 借鉴 magpie 的代码，文件头保留 MIT 声明；新文案 9 种语言齐全；截图用无头浏览器在临时文件夹里拍（用户 2026-10-18 已同意）。
- [ ] `npm run typecheck`、`npm run lint` 通过，改到的测试文件本机通过。

参考：prd.md 第 25 条；research/claude-code-wiring.md 第 4 题；decisions.md Q4。
