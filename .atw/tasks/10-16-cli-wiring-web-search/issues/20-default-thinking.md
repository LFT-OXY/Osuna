# 20 — 默认思考档位

**What to build:** Claude Code、Codex 设置页「默认模型」旁加「默认思考档位」（英文 Default thinking），终端里新开的会话从这一档起步，用户不用每开一个会话再调。

- **通用**：按提供方设，选项来自默认模型的档位；开关开着时写进 CLI 配置，关掉时还原；换默认模型后，档位不被新模型支持时照 magpie 改到最近一档。Osuna 里的新对话在没有记住的上次选择时也用它。
- **Claude Code**：
  - low 到 xhigh 写顶层 `effortLevel`；默认模型是 Claude 时另写 `modelSettings.<模型>.effortLevel`。
  - max 写 `env.CLAUDE_CODE_EFFORT_LEVEL`，设置页写明：选 max 后所有会话锁在 max，会话里 `/effort` 调不低。
  - Ultra Code 写 `ultracode: true`，只在模型支持 xhigh 时提供（含 17 号工单第 3 项）。
  - Osuna 自己的 Claude 对话没选 Ultra Code 时，明确传「不用」，免得设置文件里的默认值盖过来。
  - 核实（读 Claude Code 与 Agent SDK 的源码，不在本机运行）：默认是 max 时，Osuna 对话里每次选的思考档位会不会被锁住；会的话，在 Osuna 对话的思考档位旁写明原因。
- **Codex**：写顶层 `model_reasoning_effort`，Codex 收的档位都可以选。

**Blocked by:** 17, 19
**Status:** ready-for-agent
**Impl:** done

- [ ] 端到端（Claude Code）：选 high 写顶层 `effortLevel`（Claude 模型时另写 `modelSettings`）；选 max 写 `env.CLAUDE_CODE_EFFORT_LEVEL=max`；选 Ultra Code 写 `ultracode: true`；关掉开关后这些都还原。
- [ ] 端到端（Codex）：写顶层 `model_reasoning_effort`，关掉后还原。
- [ ] 默认模型不支持 xhigh 时选项里没有 Ultra Code；换成不支持当前档位的模型后，档位改到最近一档。
- [ ] 浏览器测试：Osuna 新对话没有记住的选择时，思考档位是默认思考档位；保存成功与失败两种。
- [ ] Osuna 的 Claude 对话没选 Ultra Code 时，交给 Agent SDK 的设置里明确是「不用」（单元测试，不运行 Claude Code）。
- [ ] max 锁定的核实结论写进实现记录；会锁住时，Osuna 对话的思考档位旁有说明。
- [ ] UI: Claude Code 设置页 / 默认思考档位选了 max / 桌面 1280 — 写明会锁住所有会话。
- [ ] UI: Codex 设置页 / 默认思考档位下拉展开 / 窄窗口 390 — 选项完整可见。
- [ ] 借鉴 magpie 的代码，文件头保留 MIT 声明；新文案 9 种语言齐全，用词与 `docs/glossary.md`「默认思考档位」一致；截图用无头浏览器在临时文件夹里拍（用户 2026-10-18 已同意）。
- [ ] `npm run typecheck`、`npm run lint` 通过，改到的测试文件本机通过。

参考：prd.md 第 31 条；research/claude-code-wiring.md 第 3、7 题；decisions.md Q6、Q27。
