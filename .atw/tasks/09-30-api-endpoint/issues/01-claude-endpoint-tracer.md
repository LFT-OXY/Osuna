# 01 — Claude 第三方接口的最小通路

**What to build:** 主机声明了 `apiEndpoints` 能力后，Claude Code 的提供方详情面板里会出现「官方 / 第三方接口」模式区。用户在这里可以：

- 新建一个第三方接口：名称、Base URL、API key、手动填写的模型 id（至少一个，其中一个设为默认）。
- 在列表里看到这个接口，启用它，或者切回官方。确认框这一张只用一句通用提示，细节留给 07。

启用后，daemon 按 ADR 0004 改写 Claude 的 `settings.json`，只改自己负责的那几个键；切回官方时，把这些键恢复成原值。API key 只能写入，不会回显。它保存在 daemon 的私有文件里，任何 RPC 都不会返回它。

这张工单要把后续所有工单依赖的底座一起落地：数据存储、协议与能力门控、Claude 补丁纯函数、写文件服务（负责确定文件位置、首次写入前做完整副本、原子写入、解析失败时一个文件都不写），以及进程内 daemon 主测试层的测试工具。

**Blocked by:** None — can start immediately

**Status:** ready-for-agent
**Impl:** done

- [x] `server_info.features.apiEndpoints` 为真时，App 在 Claude Code 详情面板里显示模式区；主机没有这个能力时不显示。
- [x] 新 RPC 使用 `provider.api_endpoint.*` 点号命名空间，至少包含：列出接口与状态、创建或更新（key 可选，缺省表示保留原值）、删除、启用或切回官方。协议契约测试覆盖请求和响应。
- [x] 所有 RPC 响应里都拿不到 API key，只返回「是否已设置」。编辑时 key 留空，原 key 保留不变。
- [x] 启用后，`settings.json` 里只有负责的键发生变化：`ANTHROPIC_BASE_URL`、`ANTHROPIC_AUTH_TOKEN`、值为空字符串的 `ANTHROPIC_API_KEY`、`ANTHROPIC_MODEL`，以及关闭 WebSearch 所需的设置（具体写法按 Claude Code 文档确定，并补写进 ADR 0004）。其余字节不变。
- [x] 切回官方后，负责的键恢复成原值，包括「原本不存在」的情况。
- [x] 首次改写前留一份完整副本。`settings.json` 无法解析时拒绝写入，并返回明确的原因。
- [x] 文件位置遵循 daemon 环境里的 `CLAUDE_CONFIG_DIR`，缺省为 `~/.claude`。
- [x] Claude 补丁纯函数的测试覆盖以下边界：已有值、空值、缺失、与用户的 hooks / permissions / enabledPlugins 等其他键共存、输出稳定、无法解析。
- [x] 进程内 daemon 测试工具就位，包括临时 `PASEO_HOME`、临时 `CLAUDE_CONFIG_DIR`，并覆盖「创建 → 启用 → 核对文件 → 切回官方 → 核对文件」。
- [x] 所有测试都不碰真实的 `~/.claude` 和 `~/.codex`，不运行真 CLI，不访问真实的上游服务。
- [x] 新文案 9 种语言齐全；`npm run typecheck`、`npm run lint`、改动涉及的测试文件都通过。
