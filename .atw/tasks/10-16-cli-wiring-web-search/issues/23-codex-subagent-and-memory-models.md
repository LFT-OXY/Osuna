# 23 — Codex 的默认 Subagent 模型与记忆模型

**What to build:** Codex 设置页「使用第三方接口」区加两项（照 magpie；负责的键，关掉时还原）：

- **默认 Subagent 模型与思考档位**：主对话没指定时 Subagent 用它。写 `[agents]` 的 `default_subagent_model`、`default_subagent_reasoning_effort`；档位按模型能收的校验，换模型后新模型不支持的档位被拿掉。模型名必须是 Codex 认得的（API key 接法下在模型目录里，ChatGPT 接法下是 `/model` 里的「接口标识/模型名」），否则 Codex 每次派 Subagent 都会失败。
- **记忆模型**：`[memories]` 的 `extract_model` 与 `consolidation_model` 写成同一个，免得 Codex 的记忆功能向第三方接口要 OpenAI 自家的模型名。界面说明只在 Codex 的记忆功能打开时有用；Osuna 不碰那个功能开关。

**Blocked by:** 20
**Status:** ready-for-agent
**Impl:** ready

- [ ] 端到端：设好后 `config.toml` 有这四个键；关掉开关后还原；用户原有的 `[agents]`、`[memories]` 其他键不动。
- [ ] 默认 Subagent 档位是新模型不支持的时被拿掉；选项只列模型能收的档位。
- [ ] ChatGPT 接法下写进去的名字与 `/model` 里的写法一致。
- [ ] 浏览器测试：保存成功与失败两种。
- [ ] UI: Codex 设置页 / 两项都设了 / 桌面 1280 与窄窗口 390 — 两项可见，记忆模型有「记忆功能打开时才有用」的说明。
- [ ] 借鉴 magpie 的代码，文件头保留 MIT 声明；新文案 9 种语言齐全；截图用无头浏览器在临时文件夹里拍（用户 2026-10-18 已同意）。
- [ ] `npm run typecheck`、`npm run lint` 通过，改到的测试文件本机通过。

参考：prd.md 第 33 条；research/claude-code-wiring.md 第 2c 题；decisions.md Q14、Q29。
