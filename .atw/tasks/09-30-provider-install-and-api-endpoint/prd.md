# 提供方安装指引与第三方接口

## Problem Statement

Osuna 靠底层的 CLI 提供方（Claude Code、Codex、Pi、OMP 等）干活，这给两类用户造成了障碍：

1. **不会装 CLI 的新手。** 设置页里没装的提供方只显示一个黄点和「未安装」，不告诉用户怎么装（`packages/app/src/screens/settings/providers-section.tsx:73`）。
2. **不用厂商订阅、而是用第三方 API 的用户**（OpenRouter 等中转站）。他们得自己搞清楚每个 CLI 该设哪些环境变量、改哪份配置文件。Osuna 虽然支持在 `config.json` 里手写自定义提供方，但界面上没有入口。

## Solution

拆成两个能分别验收、分别上线的子任务。

- **A 安装指引**（`09-30-provider-install-guide`）：为 Claude Code、Codex、Pi、OMP 按主机的操作系统展示安装命令，并附官方文档链接。
- **B 第三方接口**（`09-30-api-endpoint`）：Claude Code 和 Codex 可以在「官方」和「第三方接口」之间切换。用户填 URL 和 key，模型从上游拉取，切换时直接改写 CLI 自己的配置文件。

术语以 `docs/glossary.md` 为准，本任务涉及 **Provider**、**Custom provider**、**API endpoint** 三个词条。生效方式的取舍记在 `docs/adr/0004-api-endpoint-rewrites-cli-config.md`。

## 已定决策（2026-09-29/30 访谈）

### A 安装指引

- 覆盖 Claude Code、Codex、Pi、OMP，不做 OpenCode 和 Copilot。
- 只展示命令，给复制按钮和官方文档链接，不做一键安装。
- 默认选中**主机**的操作系统标签，另外两个系统的标签也能切换查看。
  - daemon 在 `server_info` 里新增一个可选字段上报主机系统。
  - 老 daemon 没有这个字段时，三个标签都显示，不预先选中。
- 安装数据放在 App 端的静态表里，按内置提供方 id 索引，参照 `packages/app/src/data/acp-provider-catalog.ts`。自定义提供方显示它所继承的内置提供方的安装指引。
- 指引放在提供方详情面板里。列表行上的「未安装」也能直接点开这份指引。
- 命令与文档链接见 `research/install-commands.md`。

### B 第三方接口

**范围**

- 只做 Claude Code 和 Codex。Pi 和 OMP 另外立项，因为它们没有 base URL 环境变量，需要改 `models.json`。

**形态**

- 每个提供方分「官方 / 第三方接口」两档。
- 第三方接口可以保存多套，同一时间最多启用一套，在设置里单选切换。
- 「官方」的意思是沿用 CLI 自身的配置，Osuna 不做任何写入。如果那份配置本身就指向某个中转站，就提示用户当前实际指向哪里。
- 不内置中转站预设。
- 所有客户端（桌面、网页、手机）都能用。
- 多个官方账号的管理不在本次范围内。

**生效方式**（细节见 ADR 0004）

- 直接改写 `~/.claude/settings.json` 和 `~/.codex/config.toml`，终端里的 CLI 也会跟着切换。
- 只改 Osuna 负责的键，并记录这些键的原值；切回官方时恢复原值。
- 第一次写入前留一份完整副本，仅供手动找回。
- 文件解析失败时，一个文件都不写。
- 写入前先算 hash，写入时重读；最多重算 3 次，仍然不一致就报冲突。
- Codex 通过 `auth.command` 读取 Osuna 自己保存的 key 文件（权限 0600）。
  - 完全不碰 `auth.json`。
  - 要求 Codex ≥ 0.118.0，版本不够时提示用户升级。
  - Osuna 写入的 provider id 不能和现有「自定义 Codex 提供方」注入用的 id 重复。
- Claude 写入 `ANTHROPIC_BASE_URL`、`ANTHROPIC_AUTH_TOKEN`，并把 `ANTHROPIC_API_KEY` 置为空。
- 切回官方时保留 Codex 的 `[model_providers.<id>]` 段，只有删除接口时才删掉它。
- 检测到外部改动时，显示「已被外部修改」，让用户选「重新应用」或「切回官方」，绝不静默覆盖。启用 Codex profile 时也要预先检查。

**表单与模型**

- 表单字段：名称、Base URL、API key、模型。
- key 只写不读，daemon 从不把它返回给客户端。
  - 现在的 `get_daemon_config` 会把 `env` 原样返回（`packages/server/src/server/bootstrap.ts:537`），第三方接口的 key 不能走这条路径。
- 模型由 daemon 从上游拉取（`/v1/models`，再试 `/models`），用户勾选后保存，可以重新拉取。
- 上游不支持列出模型时，提示后退回手动添加模型 id。
- Claude 的 Opus、Sonnet、Haiku、Fable 映射（`ANTHROPIC_DEFAULT_*_MODEL`）全部可选，留空的不写。另有默认模型。

**测试连接**

- 先拉取模型，再弹窗让用户选一个模型，发一条最小对话请求。
- 失败时，提示用户可以尝试 `/logout`，不强制要求。

**切换带来的影响**

- 正在运行的会话：确认框写明「N 个正在运行的会话会立即改用新配置」。Claude Code 会把 `settings.json` 的改动重新应用到正在运行的会话上。
- 启用第三方接口时，模型选择器只显示勾选的模型，并传递它们的真实 id，同时隐藏官方模型。原因是 `ANTHROPIC_DEFAULT_*_MODEL` 不会改写完整的官方 id。
- 恢复在另一种模式下创建的会话时，给出提示。为此需要记录每个 Agent session 创建时所处的模式。
- 删除正在启用的接口：确认后先自动切回官方，再删除。编辑正在启用的接口：保存后立即重新写入，提示方式同切换。
- 套餐用量旁边标注「当前使用第三方接口，此额度不代表实际消耗」。

**实现与验证**

- 以 cc-switch（MIT）的 `live/` 模块为参考，在 daemon 里用 TS 自行实现。移植过来的函数在文件头注明出处。
- Windows 上读取 key 的命令放到 GitHub Actions 的 Windows 机器上验证（只验证能否原样输出文件内容），**不在开发者本机测试**。

### 已知限制

- 用量页会把第三方接口的消耗算进官方来源，并按官方价格估算。
- 只有文档依据、没有实测过的一点：已经登录官方账号时再写入第三方 token，按官方文档是 token 优先。测试连接由 daemon 直接发出 HTTP 请求，查不出 CLI 这一侧的问题，所以这类冲突要到第一次真实对话时才会暴露，届时提示用户尝试 `/logout`（写规格时已和用户确认）。

## 子任务

| 子任务 | 目录 | 说明 |
|---|---|---|
| A 安装指引 | `09-30-provider-install-guide` | 规模小，写完规格后直接实现 |
| B 第三方接口 | `09-30-api-endpoint` | 规模大，写完规格后切成工单 |

两个子任务没有先后依赖，A 先上线。

## Acceptance Criteria

- [x] 子任务 A、B 各自验收并归档
- [x] `docs/glossary.md` 的 Provider、Custom provider、API endpoint 词条与最终界面文案一致
  - 验收时发现 Custom provider 词条写了 zh-CN 界面叫「自定义提供方」，但界面上没有这个标签，已删去这半句。
  - Provider 的 zh-CN 界面：侧栏是「提供方」，设置页仍有「Providers」「添加 Provider」「选择一个 Provider」（2026-06-11 上游 i18n 迁移遗留）。翻译移交给 `09-30-providers-settings-redesign`，那边正在改同一批文案。
- [x] ADR 0004 的规则与 B 的实现一致；如果实现中推翻了某条规则，同步修改 ADR
- [x] 全程没有在开发者本机运行 `claude` 或 `codex` 做验证
  - B 的 e2e 用假 codex；截图用桩 CLI、临时 `CLAUDE_CONFIG_DIR`/`CODEX_HOME` 和假上游，真实配置 mtime 未变；Windows 读 key 命令只在 CI 验证。A 只展示命令，不运行 CLI。
