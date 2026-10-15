# 16 — 「不思考」按模型能收的方式发，Codex 目录写推理档位

**What to build:** 14 票真实验收时发现：用户自己的 `config.toml` 里写着 `model_reasoning_effort = "none"`，终端 Codex 经中转站问三个模型，全被上游 400 拒了——gpt-6.1-sol 不收 `none`；claude-opus-5-5 不许 `thinking: disabled`；claude-sonnet-5-5 要求关思考改用 `between_tools`。Osuna 对话里没事，因为 Osuna 自己传档位。Claude Code 自己也会发 `thinking: disabled`（自动模式的判定请求、后台小查询），经中转站透传到 Sonnet 5.5 / Opus 5.5 一样会被拒。照 magpie 的做法改（用户决定，2026-10-15；magpie 源码 `cb003877`）：

1. **Codex 模型目录**（`api-endpoints/codex-model-catalog.ts`）：每个条目写 `supported_reasoning_levels`（low、medium、high、xhigh）和 `supports_reasoning_summaries = true`。`default_reasoning_level` 取离用户 `config.toml` 顶层 `model_reasoning_effort` 最近的一档：按 none < minimal < low < medium < high < xhigh < max 的顺序找最近的，一样近取高的，永远不取 none；没设或读不出时取 medium。来源：magpie `internal/codexcat/codexcat.go` `ModelDefault`、`internal/catalog/catalog.go` `NearestEffort`。Osuna 不知道每个模型的真实档位（magpie 读 models.dev），所以四档固定。目录只在现有的重新生成时机读这个值，用户事后在 Codex 里改档位不触发重新生成。现在 `supported_reasoning_levels` 是空的，Codex `/model` 换模型时没法把不支持的档位换掉（codex-rs `session/turn_context.rs` `with_model`），日志里记着「Selected effort: none」。
2. **发往 OpenAI 格式（Responses / Chat）的 `none`**：照原样发。上游回 400，并且错误正文里列了它收的档位（magpie `effortLevelsNamed`：`\blow\b\W+(?:medium|high)\b`，正文里还有带引号的 none），就在同一家用 `low` 重发一次，同时在内存里记下「这家的这个模型不收 none」，以后直接发 `low`。直通与翻译两条路都这样做。这次重发发生在第一段到达之前，排在 R-B8 换家判断的前面；重发仍被拒，才按原规则处理。记录和冷却一样只存内存，daemon 重启清零。来源：magpie `gateway.go` 直通 3789–3800 行、翻译 4378–4386 行、`onEffort` 5456–5465 行。
3. **发往 Anthropic 格式的 Claude 模型的「关思考」**：移植 magpie `internal/gateway/anthropic.go` 的 `thinkingOffOf` / `thinkingOffAsTaken`（约 480–600 行），翻译过来的请求（Codex 的 `none`）和直通的 Claude Code 请求都用：

   | 模型 | 发出的写法 |
   |---|---|
   | Sonnet 5.5 | `thinking: {type: "between_tools"}`，不带别的字段；档位高于 high 的压到 high |
   | Opus 5.5、Fable 5.x、Mythos 5.x | 不带 `thinking`；没指定档位的，`output_config.effort` 设为 `low` |
   | Opus 5、Haiku 5.5 | `disabled`；档位高于 high 的压到 high |
   | 4.x 及更早、Sonnet 5、Haiku 5 | 原样 |
   | 认不出的版本 | 原样 |

   兜底：Anthropic 格式的上游回 400，错误正文表明「这个模型不能关思考」（移植 magpie `refusesThinkingOff`，含 `alwaysThinks` 的中英文正则，约 350–372 行），就打开思考、用最低档重发一次，并按上面同样的方式记住。R-C3 给非 Claude 模型补的 `disabled`（比如 GLM 这类总在思考的模型会拒）也走这个兜底。

借鉴的代码在文件头写 MIT 短式（R-C6）。对应 prd R-B4、R-C3、R-C5。

**Blocked by:** None
**Status:** ready-for-agent
**Impl:** ready

- [ ] 生成的 Codex 目录：每个条目（可见与隐藏）都带四档、`supports_reasoning_summaries = true`，默认档按 `model_reasoning_effort` 取（none → low、xhigh → xhigh、未设 → medium），Codex 仍能读进整份目录（沿用 03 票的目录 e2e）。（单元 + e2e）
- [ ] 假上游对 `none` 回列出档位的 400：中转站在同一家用 `low` 重发并成功；同一家同一模型的下一个请求直接发 `low`；上游接受 `none` 时发出的就是 `none`。直通与翻译各测一次。（单元 + 假上游 e2e）
- [ ] 关思考的请求发往 claude-sonnet-5-5 / claude-opus-5-5 / claude-opus-5 / claude-opus-4-8 时，上游收到的分别是上表的写法；Claude Code 直通请求与 Codex 翻译请求各测一次。（单元 + 假上游 e2e）
- [ ] 假上游回「不能关思考」的 400：重发时思考打开、用最低档，并被记住。（单元）
- [ ] 不关思考的请求，上游收到的内容与改动前一致。（单元）

## Comments

- 2026-10-15 初版写的是「none 一律改成 low」。看过 magpie 的做法后，用户改成：先原样发，被拒再降到 low 并记住；并补上 Claude Code 直通请求的关思考处理。
