# 21 — 跟着 CLI 里存下的模型与思考档位走

**What to build:** 用户在 Claude Code 或 Codex 里用 `/model`、`/effort` 存成默认的选择，如果是某家接口提供的，Osuna 的默认模型、默认思考档位跟着变，不报「被改过」，以后改配置也不再改回去；换成哪家都没有的模型时，提示「模型被换掉」，由用户决定。

- 读状态时（以及改写前），CLI 配置里的模型变成另一个接口提供的模型（光秃秃的、带接口标识的、带 `[1m]` 的都算）：Osuna 把它当成新的默认模型，更新接管记录里记的写入值，不算被改过；跟随主模型的字段一起跟过去（照 magpie）。
- 变成哪家接口都没有的模型：提示区报「模型被换掉」，写明换成了哪个模型。按钮「重新应用」（写回 Osuna 的默认模型和其余字段）、「保留当前设置」（这里的意思是不再提示、开关照开）。
- Osuna 以后重写配置时不再改回 CLI 存下的模型。
- 思考档位同样处理：Codex 的 `model_reasoning_effort`，Claude Code 的 `effortLevel` 与 `modelSettings`，跟到「默认思考档位」。

**Blocked by:** 20
**Status:** ready-for-agent
**Impl:** done

- [x] 端到端：开关开着时，把 `settings.json` 的 `model` 改成另一家接口提供的模型（光秃秃、带标识、带 `[1m]` 各一例）→ 列表里默认模型变成它，没有「被改过」提示；之后加一家接口触发重写，`model` 仍是它。
- [x] 改成哪家都没有的模型 → 提示「模型被换掉」；「重新应用」写回默认模型；「保留当前设置」后不再提示，开关仍开。
- [x] Codex 的 `model` 同样处理，API key 接法与 ChatGPT 接法各一例。
- [x] 思考档位：CLI 改了 `effortLevel`、`modelSettings` 或 `model_reasoning_effort` 后，默认思考档位跟着变，之后重写不改回。
- [x] UI: Claude Code 设置页 / 模型被换掉 / 桌面 1280 — 提示写明换成了哪个模型，两个按钮可见。
- [x] 借鉴 magpie 的代码，文件头保留 MIT 声明；新文案 9 种语言齐全；截图用无头浏览器在临时文件夹里拍（用户 2026-10-18 已同意）。
- [x] `npm run typecheck`、`npm run lint` 通过，改到的测试文件本机通过。

参考：prd.md 第 30、34 条；research/claude-code-wiring.md 第 12 题；decisions.md Q13、Q28。
