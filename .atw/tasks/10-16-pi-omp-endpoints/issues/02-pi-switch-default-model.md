# 02 — Pi 打开、关掉「使用第三方接口」并选默认模型

**What to build:** Pi 的提供方设置页出现「使用第三方接口」开关和默认模型。打开后 Osuna 改写 Pi 的全局配置（`models.json` 加 `providers.osuna`，`settings.json` 的默认服务商与模型），在 Pi 自己的模型列表和终端新会话里都能用 `osuna/<模型>`；关掉前列出会改回什么，关掉后还原。

**Blocked by:** 01
**Status:** ready-for-agent
**Impl:** ready

- [ ] 协议：新能力位挂在 `server_info.features.*` 上；Agent 设置的 provider 取值接受 `pi`；新字段都可选。旧 daemon 下新 App 不显示 Pi 的第三方接口设置；官方 Paseo 手机 App 照常。
- [ ] 目录照 Osuna 现有的 Pi 规则（daemon 环境的 `PI_CODING_AGENT_DIR`，否则 `~/.pi/agent`）。
- [ ] `models.json` 的 `providers.osuna`：`baseUrl` 指中转站 `/v1`、`api: "openai-completions"`、`apiKey` 为 Pi 的中转站口令、`compat.sendSessionAffinityHeaders: true`（用户在这一项里自设的 compat 值保留）。
- [ ] 模型清单同 Codex 的 `/model`（按「接口名显示方式」带接口名）；每个模型写已知的 `name`、`reasoning`、`thinkingLevelMap`（7 档全列，没有的写 null）、`contextWindow`、`maxTokens`（不超过上下文）、`input`、`cost`、`promptCache`、自适应思考的 `compat`。
- [ ] 每个模型的格式按 prd「每个模型的格式」：默认 Chat；GPT 系在 Responses 条件满足时走 Responses；Claude 在 Anthropic 条件满足时走 Anthropic 并写中转站根地址；「只用这种格式」按钉的格式。
- [ ] `settings.json`：`defaultProvider: "osuna"`、`defaultModel` 为默认模型。
- [ ] 改写规则同 ADR 0004 / 0012：只动自有键、接管记录存原值、首次改写前留副本、原子替换、写前重读、解析不了不写并报出文件名；用户在 Pi 配置里的其他键与注释原样保留。
- [ ] 关开关：先给关前预览（列出 Pi 配置里会改回的键）；关掉后放回原值、删掉 `providers.osuna`；开着期间用户自改的键保留。再打开时放回上次的默认模型。
- [ ] 能打开的条件同现有（有开着且选了模型的接口、daemon 在 TCP 上监听），不满足时开关不可打开并说明原因。
- [ ] 测试：新加 Pi 接入的 daemon 端到端测试（先例：Codex / Claude Code 接入测试），配置目录指向临时目录，检查打开、改默认模型、关掉后的文件内容；与 Claude Code、Codex 配置改写套件并列加 Pi 的套件，覆盖格式规则与保留用户键。
- [ ] 浏览器测试：Pi 设置页的开关、默认模型、关前预览；打开失败（配置文件解析不了）时错误留在这一块。
- [ ] 9 种语言的新文字齐全，中文没有残留英文。
- [ ] UI：Pi 提供方设置页 / 已打开 / 1280 与 390 — 能看到「使用第三方接口」Switch 和默认模型，模型名不是等宽字体，宽 390 不被遮住。
- [ ] UI：Pi 提供方设置页 / 关前预览 / 1280 — 预览列出 Pi 的默认服务商、默认模型等具体设置项。
- [ ] 文档：ADR 0004 管理的文件扩到 Pi；ADR 0012 情况表补上 Pi。

参考：prd「提供方与设置」「写进 Pi 配置的内容」「改写规则与还原」「协议与兼容」，用户故事 12–15、19–21、36–42、51–53。

实现时凡本工单没写明的细节，先查 magpie `7597c132` 的做法并照做（出处见 `research/decisions.md`，源码在 `/tmp/magpie-7597`，不在就重新克隆 yetone/magpie 切到该提交）；比 magpie 少做或更严一律不行，除非 prd 写明。测试绝不读写真实的 `~/.pi`、`~/.omp`，不运行真的 Pi / OMP。
