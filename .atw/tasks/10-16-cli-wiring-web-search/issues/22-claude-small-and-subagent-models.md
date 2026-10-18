# 22 — Claude Code 的后台小任务模型与 Subagent 模型

**What to build:** Claude Code 设置页「使用第三方接口」区加两项，用户可以给后台小任务选一个便宜的模型、给 Subagent 选合适的模型和思考档位，不再一律跟主模型花一样多的钱。两项都是负责的键，关掉时还原；选项来自开着的接口的已选模型；都不设就跟主模型。

- **后台小任务模型**（起标题、读网页这类）：写 `env.ANTHROPIC_SMALL_FAST_MODEL`。
- **Subagent 模型与它的思考档位**：写 `env.CLAUDE_CODE_SUBAGENT_MODEL`。选了思考档位时，照 magpie 写成「模型名:档位」；中转站认出这个后缀，去掉后再选接口，并按目标格式设好档位。
- 带点的 Claude 版本按 17 号工单的规则改写。

**Blocked by:** 20
**Status:** ready-for-agent
**Impl:** done

- [ ] 端到端：两项设好后，`settings.json` 的 `env` 有对应的值；关掉开关后还原（原来没有就删掉）。
- [ ] 请求模型是「模型名:high」时，假上游收到的是去掉后缀的模型名，档位按这家的格式设成 high（Anthropic、Responses、Chat 各一例）。
- [ ] 带点的 Claude 版本写成连字符。
- [ ] 浏览器测试：保存成功与失败两种。
- [ ] UI: Claude Code 设置页 / 两项都设了 / 桌面 1280 与窄窗口 390 — 两项可见，模型名不是等宽字体，Subagent 保留英文。
- [ ] 借鉴 magpie 的代码，文件头保留 MIT 声明；新文案 9 种语言齐全；截图用无头浏览器在临时文件夹里拍（用户 2026-10-18 已同意）。
- [ ] `npm run typecheck`、`npm run lint` 通过，改到的测试文件本机通过。

参考：prd.md 第 32 条；research/claude-code-wiring.md 第 2a、2b 题；decisions.md Q14、Q29。
