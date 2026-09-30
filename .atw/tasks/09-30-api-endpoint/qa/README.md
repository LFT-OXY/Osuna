# 工单 09 截图验收

2026-09-30，macOS dev 桌面端（Electron，界面语言 zh-CN），浅色与深色主题各一套。

## 隔离方式

- dev 桌面端以 `CLAUDE_CONFIG_DIR=/tmp/osuna-qa/claude`、`CODEX_HOME=/tmp/osuna-qa/codex`、`CLAUDE_HOME=/tmp/osuna-qa/claude-home` 启动，daemon 在 6769，数据目录 `.dev/paseo-home`。
- dev `config.json` 把 `claude`、`codex` 指向只打印版本号的桩脚本，没有运行真实 CLI。Codex 行因此显示 app-server 错误，与本功能无关。
- 上游是 `127.0.0.1:18765` 上的本地假服务：72 个模型，`missing/retired-model` 的对话请求回 404，其余回 200；key 为测试 key。
- 截图开始前与结束后用 `stat` 比对真实 `~/.claude/settings.json`、`~/.codex/config.toml`、`~/.codex/auth.json` 的 mtime，全程未变。
- 结束后删除 `.dev/paseo-home/api-endpoints`，还原 dev `config.json`。

## 截图

| 界面 | 浅色 | 深色 |
| --- | --- | --- |
| 模式区（仅官方） | light-01 | — |
| 模式区（有接口，官方启用） | light-08 | dark-01 |
| 模式区（接口启用，模型列表只剩勾选的 3 个） | light-10 | dark-10 |
| 表单（新建 / 编辑，key 显示「已设置，留空则保留」） | light-02 | dark-02 |
| 拉取模型，只画前 50 条并提示其余 22 条 | light-03 | dark-03 |
| 搜索并勾选模型、使用的模型与默认 | light-04 | dark-04 |
| 测试连接的模型选择 | light-05 | dark-05 |
| 测试结果：成功 | light-06 | dark-06 |
| 测试结果：失败（404，上游原因） | light-07 | dark-07 |
| 确认框：切换 | light-09 | dark-09 |
| 确认框：重新应用 | light-12 | — |
| 确认框：切回官方 | light-13 | dark-12 |
| 确认框：删除 | — | dark-13 |
| 已被外部修改（重新应用 / 切回官方） | light-11 | dark-11 |

确认框是 Electron 原生对话框，用 `screencapture -l <窗口 ID>` 截取，跟随系统外观而非应用主题。

## 文件结果

- 启用后临时 `settings.json` 只多出负责的键：`env` 下的 `ANTHROPIC_BASE_URL`、`ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_API_KEY`（空）、`ANTHROPIC_MODEL`、映射的 Opus / Haiku 两档，以及 `permissions.deny` 里的 `"WebSearch"`；首次写入前留了副本。
- 外部改 `env.ANTHROPIC_BASE_URL` 后显示「已被外部修改」；「重新应用」写回接口地址；「切回官方」收回全部负责的键。
- 原本单行的 `permissions.allow` 数组在插入 `deny` 后变成多行，切回官方后仍是多行，与 ADR 0004 记录的重排行为一致。

## 观察到的问题（不在本工单范围）

- macOS 上所有原生确认框都不显示标题（`packages/desktop/src/features/dialogs.ts` 把标题放在 `showMessageBox` 的 `title`，macOS 不显示），所以切换、删除确认框里看不到接口名称。
- 新建表单一打开就显示红色的「至少勾选或添加一个模型」（`form-sheet.tsx` 在模型为空时总是给出错误），用户还没操作就看到报错。`docs/forms.md` 没有规定校验错误何时出现，留给维护者判断。
