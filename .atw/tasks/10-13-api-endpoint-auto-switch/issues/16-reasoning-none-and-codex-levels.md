# 16 — 「不思考」不再被上游拒，Codex 目录写推理档位

**What to build:** 工单 14 真实验收发现：用户自己的 `config.toml` 写着 `model_reasoning_effort = "none"`，终端 Codex 经中转站问三个模型全被上游 400 拒：gpt-6.1-sol 不收 `none`；claude-opus-5-5 不许 `thinking: disabled`；claude-sonnet-5-5 要求关思考改用 `between_tools`。Osuna 对话里不受影响（Osuna 自己传档位）。两处修：

1. Codex 模型目录（`api-endpoints/codex-model-catalog.ts`）每个条目写 `supported_reasoning_levels`（low、medium、high、xhigh）与 `default_reasoning_level = "medium"`。现在两者为空，Codex 的 `/model` 换模型时没法把不支持的档位换成支持的（codex-rs `session/turn_context.rs` `with_model` 取支持列表中间档），日志里是「Selected effort: none」。
2. 中转站把客户端的「不思考」统一当最低档 low 发出（用户决定，2026-10-15）：Responses `reasoning.effort = "none"`、Chat `reasoning_effort = "none"` 在直通与翻译两条路上都换成 `low`；翻译成 Anthropic 时 Claude 5 系（版本读法同 `claudeVersionOf`）不发 `thinking: disabled`，改为不带 `thinking`、`output_config.effort = "low"`；4.x 及更早照旧。依据：Anthropic 官方模型说明（claude-api 技能，2026-10-06 缓存）——Opus 5.5、Fable 5.x 任何档位都不许 disabled，Sonnet 5.5 disabled 回 400、只认 `between_tools`，官方建议先用 low。直通 Responses 的这一处改写按 R-C3 的做法只用 jsonc 改该字段。

对应 prd R-B4、R-C3、R-C5。

**Blocked by:** None
**Status:** ready-for-agent
**Impl:** ready

- [ ] 生成的 Codex 目录每个条目（可见与隐藏）都带四档推理与默认 medium，Codex 仍能读进整份目录（沿用 03 票目录 e2e，新增字段断言）。（单元 + e2e）
- [ ] Codex 发 `reasoning.effort: "none"`、目标为 OpenAI 格式接口：上游收到 `low`；目标为 Anthropic 格式的 Claude 5 系模型：上游请求不含 `thinking`、`output_config.effort` 为 `low`；目标为 Claude 4.x：仍为 `thinking: disabled`。（单元 + 假上游 e2e）
- [ ] Chat 格式请求 `reasoning_effort: "none"` 同样换成 low（直通与翻译）。（单元）
- [ ] 非 none 的档位、未带档位的请求，上游收到的内容与改动前一致。（单元）
