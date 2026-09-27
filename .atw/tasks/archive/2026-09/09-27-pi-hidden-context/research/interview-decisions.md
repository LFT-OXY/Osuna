# 访谈决策记录（2026-09-27）

来源：/atw-askme-with-docs 访谈，全部为用户明确回答（多数为"按推荐"）。同批次的另两个任务：09-27-composer-branch-switch、09-27-markdown-preview-dom，执行顺序为本任务 → 分支切换 → md 预览。

## 事实（调研所得）

- 用户截图中的注入文本出自 **Pi** provider（模型 gpt-6-astra，Pi provider=openai-codex），不是 Codex。证据：`~/.pi/agent/sessions/--Users-oxy-Documents-code-My-Osuna--/2026-09-27T06-36-23-261Z_*.jsonl` 第 6 行 `custom_message, customType: "atw-runtime-context", display: false`。
- 注入方：`.pi/extensions/atw/index.ts:2023-2077`（`before_agent_start` 返回 `{ customType: "atw-runtime-context", content, display: false }`）；`<session-overview>` 在 `:1231`，`<workflow-state>` 在 `:1207`。
- Osuna 未读 `display`：
  - 实时：`packages/server/src/server/agent/providers/pi/agent.ts:2397-2420` `handleMessageEnd`，`role === "custom"` 一律发 `assistant_message`。
  - 回放：`pi/history-mapper.ts:116-133` `mapCustomMessage`，同样映射为 `assistant_message`。
  - `pi/rpc-types.ts:41-44` 的 custom 类型未声明 `customType`/`display`。
- OMP 已有过滤：`omp/custom-message.ts:5-7` `shouldDisplayOmpCustomMessage`（`display !== false`），用于 `omp/agent.ts:2016`、`omp/message-history.ts:121`（提交 5e47cff58）。
- 现有测试把 custom 当可见助手文本：`pi/agent.test.ts:876-896` 及其后、`pi/history-mapper.test.ts:131-141`（来自 #1290，扩展命令输出需可见）。
- Pi `/skill:name` 被 Pi 展开为 `<skill name=".." location="..">\nReferences are relative to ...\n\n{正文}\n</skill>\n\n{args}` 存为 user 消息（pi-coding-agent `dist/core/agent-session.js:1365-1377`）。回放经 `pi/history-mapper.ts:96-114` 生成含完整正文的 `user_message`；实时路径推断显示 canonical 原文（未实测）。
- 约定：`docs/timeline-sync.md:229-232`，系统注入内容不出现在 Paseo 时间线。
- 其他 provider：Claude Code 的 skill 正文（isMeta）已被丢弃、只剩 Skill 工具卡片；Codex `$skill` 显示 `$name args`；Codex hookPrompt 按 `threadItemToTimeline` default 分支被丢弃（未抓到样本）。

## 已定

| # | 决策 | 结论 |
|---|---|---|
| 1 | 隐藏方式 | 按 `display: false` 过滤（同 OMP），实时与历史回放都改；`display` 不为 false 的扩展输出照常显示（保留 #1290 语义） |
| 2 | Pi skill 消息 | 把展开的 `<skill>…</skill>\n\n{args}` 还原为 `/skill:name args`，不做可展开 UI（类比 Claude `<command-name>` → `/cmd`） |
| 3 | 范围 | 只修 Pi；顺带核对 OMP 的 skill 展开是否同样问题；Codex / Claude 不动 |
| 4 | 注入上下文 | 完全隐藏，不留痕迹 |
| 5 | 验收 | Pi 会话发"你好"和一次 `/skill:xxx`，实时时间线与重开后的历史回放都不出现注入内容，skill 显示为 `/skill:xxx 参数`；补单元测试并调整 #1290 相关测试 |
| 6 | 平台 | 以桌面 / Web 为准验收 |

discover 阶段无未决问题。
