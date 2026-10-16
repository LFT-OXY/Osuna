# 04 — 拒收重问：去掉不收的字段

**What to build:** 上游在开口前回 400 一类的错误，说它不收请求里的某个字段时，在同一家去掉这个字段重问一次，并记住：这家这个模型以后直接不发。认法和改法都照 magpie，记忆的规则同第 03 张。直通和翻译两条路都生效。共五种：

1. Claude Code 自动模式的审查字段（dangerous-tool-use beta、`safeguards`、`safeguard_results`）或 `display` 字段；
2. 上游说已弃用的 temperature、top_p、top_k；
3. 延后加载工具块（`tool_addition`、`tool_removal`、`tool_reference`）；只剩 `tool_reference` 的工具结果，补一句文字；
4. 工具的 `strict`；
5. Codex 的 `image_gen` 工具，被裸 400 拒绝时。

**Blocked by:** None
**Status:** ready-for-agent
**Impl:** ready

- [ ] 五种写法各有用例：被拒后，同一家收到去掉该字段的请求；同一家同一模型的下一次请求直接不带它；别的家、别的模型不受影响。
- [ ] 只剩 `tool_reference` 的工具结果去掉后补一句文字，对话结构仍然合法。
- [ ] 重问仍被拒时，按原规则处理：换家，或交给 CLI。
- [ ] 每记住一种写法，有一行 info 日志；daemon 重启后清零。
- [ ] 借鉴 magpie 的代码，文件头保留 MIT 声明。
- [ ] `npm run typecheck`、`npm run lint` 通过，改到的测试文件本机通过。

参考：prd.md 第 18、19.3、19.4、19.5、19.8、19.9 条；明细 01·B40、B42、B47、B49、B50。
