# 18 — 让 Claude Code 正确认识接口模型（上下文、回复长度、思考档位）

**What to build:** Claude Code 碰到不认识的模型名（非 Claude 官方名），会按「上下文 20 万、单次回复最多 32000 token、不能调思考档位」来处理。接口模型因此过早压缩对话，长回复被截断（「response exceeded the 32000 output token maximum」），`/effort` 也不起作用。magpie 在接管 Claude Code 时另写了三项（`internal/agent/claude.go`）：

- 上下文 100 万及以上的模型，在 `model` / `modelPicker` 行的模型名后加 `[1m]`（`claude1M`，约 1820–1850 行）；
- `env.CLAUDE_CODE_MAX_OUTPUT_TOKENS` 设为这些模型能写的最长回复（`claudeOutputEnv`，约 183–195 行）；
- `env.CLAUDE_CODE_MODEL_CAPABILITIES` 写 `<模型>=effort,xhigh_effort;…`，只声明确知的档位（`claudeCapsEnv`，约 197–203 行）。

用户已经自己设了的值，magpie 一律不碰（「One the user set is theirs」）。

**开工前要定的事：** Osuna 现在不知道接口模型的上下文长度、最长回复、支持哪些思考档位（magpie 读 models.dev 和各家模型列表）。先查清 Osuna 拉取的上游模型列表里有没有这些字段、各家给不给；没有的话，从哪里拿（models.dev、用户在详情页手填，或者不知道就不写），需要用户拍板。查完写进 `research/claude-code-model-hints.md`，再决定这张票做多大。

**Blocked by:** 17
**Status:** ready-for-agent
**Impl:** done

- [x] 调研结论写进 `research/claude-code-model-hints.md`：Osuna 拿得到哪些数据、从哪里来，用户已拍板。
- [x] 已知上下文 ≥ 100 万的模型带 `[1m]`；已知回复上限的写 `CLAUDE_CODE_MAX_OUTPUT_TOKENS`；已知档位的写 `CLAUDE_CODE_MODEL_CAPABILITIES`；不知道的不写。（单元 + e2e）
- [x] 用户自己设了的这几个值原样不动；关总开关后 Osuna 写的被删掉，`settings.json` 回到接管前的原样。（e2e）

## Comments

- 2026-10-15 用户决定：数据先取接口自己的模型列表，再查 models.dev（magpie 的做法），下载归价格表自动更新开关管、只在 Claude Code 总开关开着时下载；另写 `CLAUDE_CODE_MAX_CONTEXT_TOKENS`，按起始模型取。
- 2026-10-15 实现补充：用 2.1.299 和本机假服务器验证过 Claude Code 发请求前去掉 `[1m]`、按 `CLAUDE_CODE_MAX_OUTPUT_TOKENS` 要回复长度、`CLAUDE_CODE_MODEL_CAPABILITIES` 的模型名要写小写。`[1m]` 也加在 Claude 模型上（照 magpie）；起始模型是 Claude 时不写回复上限。开关关掉后，之前下载过的 models.dev 缓存照用，只是不再下载。设置页开关文案仍是「自动更新 LiteLLM 价格」，没改。

